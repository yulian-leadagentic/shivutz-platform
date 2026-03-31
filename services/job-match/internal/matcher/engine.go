package matcher

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/shivutz/job-match/internal/models"
)

var workerServiceURL = func() string {
	if u := os.Getenv("WORKER_SERVICE_URL"); u != "" {
		return u
	}
	return "http://worker:3003"
}()

// Run executes the matching algorithm and returns ranked bundles.
// SLA target: < 3 seconds end-to-end.
func Run(ctx context.Context, request models.JobRequest, lineItems []models.LineItem) ([]models.Bundle, error) {
	type result struct {
		lineItem models.LineItem
		workers  []models.Worker
		err      error
	}

	ch := make(chan result, len(lineItems))

	// Phase 2: parallel candidate fetch — one goroutine per line item
	var wg sync.WaitGroup
	for _, li := range lineItems {
		wg.Add(1)
		go func(li models.LineItem) {
			defer wg.Done()
			workers, err := fetchCandidates(ctx, li, request.Region)
			ch <- result{lineItem: li, workers: workers, err: err}
		}(li)
	}

	go func() {
		wg.Wait()
		close(ch)
	}()

	// Collect results
	liWorkers := map[string][]models.WorkerMatch{}
	for r := range ch {
		if r.err != nil {
			fmt.Printf("[matcher] fetch error for %s: %v\n", r.lineItem.ProfessionType, r.err)
			liWorkers[r.lineItem.ID] = []models.WorkerMatch{}
			continue
		}
		scored := scoreWorkers(r.workers, r.lineItem)
		liWorkers[r.lineItem.ID] = scored
	}

	// Phase 4: assemble bundles per corporation
	bundles := assembleBundles(lineItems, liWorkers)

	// Sort: complete bundles first, then by total score
	sort.Slice(bundles, func(i, j int) bool {
		if bundles[i].IsComplete != bundles[j].IsComplete {
			return bundles[i].IsComplete
		}
		return bundles[i].TotalScore > bundles[j].TotalScore
	})

	if len(bundles) > 10 {
		bundles = bundles[:10]
	}
	return bundles, nil
}

func fetchCandidates(ctx context.Context, li models.LineItem, region string) ([]models.Worker, error) {
	url := fmt.Sprintf("%s/workers?profession=%s&status=available&limit=100", workerServiceURL, li.ProfessionType)
	if !li.EndDate.IsZero() {
		minVisa := li.EndDate.AddDate(0, 0, 30).Format("2006-01-02")
		url += "&visa_until_min=" + minVisa
	}

	reqCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	req.Header.Set("X-Internal-Service", "job-match")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var workers []models.Worker
	if err := json.Unmarshal(body, &workers); err != nil {
		return nil, err
	}
	return workers, nil
}

func scoreWorkers(workers []models.Worker, li models.LineItem) []models.WorkerMatch {
	var matches []models.WorkerMatch
	for _, w := range workers {
		score := 30 // profession match guaranteed by query

		if w.ExperienceYears >= li.MinExperience {
			score += 20
		}

		if len(li.OriginPreference) > 0 && contains(li.OriginPreference, w.OriginCountry) {
			score += 15
		}

		if allPresent(li.RequiredLanguages, w.Languages) {
			score += 10
		}

		if w.VisaValidUntil != nil && w.VisaValidUntil.After(li.EndDate.AddDate(0, 0, 90)) {
			score += 10
		}

		matches = append(matches, models.WorkerMatch{
			Worker:     w,
			Score:      score,
			LineItemID: li.ID,
		})
	}

	sort.Slice(matches, func(i, j int) bool {
		return matches[i].Score > matches[j].Score
	})
	return matches
}

func assembleBundles(lineItems []models.LineItem, liWorkers map[string][]models.WorkerMatch) []models.Bundle {
	// Group workers by corporation
	corpLineItems := map[string]map[string][]models.WorkerMatch{} // corp -> liID -> workers

	for liID, workers := range liWorkers {
		for _, wm := range workers {
			corp := wm.Worker.CorporationID
			if corpLineItems[corp] == nil {
				corpLineItems[corp] = map[string][]models.WorkerMatch{}
			}
			corpLineItems[corp][liID] = append(corpLineItems[corp][liID], wm)
		}
	}

	var bundles []models.Bundle
	for corpID, liMap := range corpLineItems {
		bundle := models.Bundle{CorporationID: corpID}
		totalScore := 0
		filledCount := 0

		for _, li := range lineItems {
			workers := liMap[li.ID]
			needed := li.Quantity
			if len(workers) > needed {
				workers = workers[:needed]
			}
			fill := models.LineItemFill{
				LineItemID: li.ID,
				Profession: li.ProfessionType,
				Needed:     li.Quantity,
				Workers:    workers,
			}
			bundle.LineItems = append(bundle.LineItems, fill)
			if len(workers) >= needed {
				filledCount++
			}
			for _, w := range workers {
				totalScore += w.Score
			}
		}

		bundle.IsComplete = filledCount == len(lineItems)
		bundle.TotalScore = totalScore
		bundles = append(bundles, bundle)
	}
	return bundles
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if strings.EqualFold(s, item) {
			return true
		}
	}
	return false
}

func allPresent(required, available []string) bool {
	avSet := map[string]bool{}
	for _, a := range available {
		avSet[strings.ToLower(a)] = true
	}
	for _, r := range required {
		if !avSet[strings.ToLower(r)] {
			return false
		}
	}
	return true
}
