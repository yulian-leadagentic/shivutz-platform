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

// scoreThresholds define match tiers based on total score.
const (
	scorePerfect = 80
	scoreGood    = 50
	maxBundles   = 20
)

// Run executes the matching algorithm and returns ranked bundles.
// Uses two-phase fetching: strict (with visa filter) + relaxed (without visa filter)
// to maximise the number of matches returned.
// SLA target: < 5 seconds end-to-end.
func Run(ctx context.Context, request models.JobRequest, lineItems []models.LineItem) ([]models.Bundle, error) {
	type result struct {
		lineItem models.LineItem
		workers  []models.Worker
		err      error
	}

	ch := make(chan result, len(lineItems))

	// Phase 1: parallel candidate fetch — one goroutine per line item
	// Uses two-pass: strict fetch (visa filter) merged with relaxed fetch (no visa filter)
	var wg sync.WaitGroup
	for _, li := range lineItems {
		wg.Add(1)
		go func(li models.LineItem) {
			defer wg.Done()
			workers, err := fetchCandidatesWithFallback(ctx, li, request.Region)
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
		scored := scoreWorkers(r.workers, r.lineItem, request.Region)
		liWorkers[r.lineItem.ID] = scored
	}

	// Phase 2: assemble bundles per corporation
	bundles := assembleBundles(lineItems, liWorkers)

	// Sort: complete bundles first, then by fill percentage, then by total score
	sort.Slice(bundles, func(i, j int) bool {
		if bundles[i].IsComplete != bundles[j].IsComplete {
			return bundles[i].IsComplete
		}
		if bundles[i].FillPercentage != bundles[j].FillPercentage {
			return bundles[i].FillPercentage > bundles[j].FillPercentage
		}
		return bundles[i].TotalScore > bundles[j].TotalScore
	})

	if len(bundles) > maxBundles {
		bundles = bundles[:maxBundles]
	}
	return bundles, nil
}

// fetchCandidatesWithFallback runs two fetches and merges the results:
//  1. Strict: with visa date filter (workers whose visa covers the job period)
//  2. Relaxed: without visa filter (catch workers with shorter visas — still useful)
//
// Workers are de-duplicated by ID; strict results are preferred.
func fetchCandidatesWithFallback(ctx context.Context, li models.LineItem, region string) ([]models.Worker, error) {
	type fetchResult struct {
		workers []models.Worker
		err     error
	}

	strictCh  := make(chan fetchResult, 1)
	relaxedCh := make(chan fetchResult, 1)

	go func() {
		w, err := fetchCandidates(ctx, li, region, true)
		strictCh <- fetchResult{w, err}
	}()
	go func() {
		w, err := fetchCandidates(ctx, li, region, false)
		relaxedCh <- fetchResult{w, err}
	}()

	strict  := <-strictCh
	relaxed := <-relaxedCh

	// Merge: strict workers first, then add any additional workers from relaxed pass
	seen := map[string]bool{}
	var merged []models.Worker

	if strict.err == nil {
		for _, w := range strict.workers {
			seen[w.ID] = true
			merged = append(merged, w)
		}
	}

	if relaxed.err == nil {
		for _, w := range relaxed.workers {
			if !seen[w.ID] {
				seen[w.ID] = true
				merged = append(merged, w)
			}
		}
	}

	// If both failed, return the strict error
	if strict.err != nil && relaxed.err != nil {
		return nil, strict.err
	}

	return merged, nil
}

func fetchCandidates(ctx context.Context, li models.LineItem, region string, withVisaFilter bool) ([]models.Worker, error) {
	url := fmt.Sprintf("%s/workers?profession=%s&status=available&limit=200", workerServiceURL, li.ProfessionType)

	// Visa filter: only in strict pass, and only if job has an end date
	if withVisaFilter && !li.EndDate.IsZero() {
		minVisa := li.EndDate.AddDate(0, 0, 30).Format("2006-01-02")
		url += "&visa_until_min=" + minVisa
	}

	reqCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
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
		return nil, fmt.Errorf("unmarshal error: %v (body: %.200s)", err, string(body))
	}
	return workers, nil
}

// scoreWorkers scores each worker against a line item and returns WorkerMatch entries
// with full match tier and matched/missing criteria details.
//
// Scoring model (max 110):
//   - Profession match:  30 (guaranteed — filtered by query)
//   - Region match:      20 (exact), 10 (no region preference)
//   - Experience:        20 (meets req), 12 (within 50%), 6 (some experience)
//   - Origin preference: 15 (in list), 0 if no preference → not penalised
//   - Languages:         10 (all), 5 (partial ≥50%)
//   - Visa validity:     15 (>90d buffer), 8 (meets minimum), 0 (short/missing)
func scoreWorkers(workers []models.Worker, li models.LineItem, requestRegion string) []models.WorkerMatch {
	var matches []models.WorkerMatch

	for _, w := range workers {
		score := 30 // profession match guaranteed by query
		var matched []string
		var missing  []string

		matched = append(matched, "profession")

		// ── Region ─────────────────────────────────────────────
		workerRegion := strings.ToLower(strings.TrimSpace(w.AvailableRegion))
		jobRegion    := strings.ToLower(strings.TrimSpace(requestRegion))
		if jobRegion == "" {
			// No region preference — give neutral bonus
			score += 10
		} else if workerRegion == jobRegion {
			score += 20
			matched = append(matched, "region")
		} else if workerRegion == "" {
			// Worker has no preferred region — minor penalty, could still work
			score += 5
		} else {
			missing = append(missing, "region")
		}

		// ── Experience ─────────────────────────────────────────
		// MinExperience stored in months; worker.ExperienceYears in years
		workerMonths := w.ExperienceYears * 12
		if li.MinExperience == 0 {
			// No requirement → full score
			score += 20
			matched = append(matched, "experience")
		} else if workerMonths >= li.MinExperience {
			score += 20
			matched = append(matched, "experience")
		} else if li.MinExperience > 0 && workerMonths >= li.MinExperience/2 {
			// Within 50% of requirement
			score += 12
			matched = append(matched, "experience_partial")
		} else if workerMonths > 0 {
			// Has some experience
			score += 6
		} else {
			missing = append(missing, "experience")
		}

		// ── Origin preference ───────────────────────────────────
		if len(li.OriginPreference) > 0 {
			if contains(li.OriginPreference, w.OriginCountry) {
				score += 15
				matched = append(matched, "origin")
			} else {
				missing = append(missing, "origin")
			}
		}
		// No origin preference → not penalised

		// ── Languages ──────────────────────────────────────────
		if len(li.RequiredLanguages) > 0 {
			presentCount := countPresent(li.RequiredLanguages, w.Languages)
			if presentCount == len(li.RequiredLanguages) {
				score += 10
				matched = append(matched, "languages")
			} else if presentCount > 0 && float64(presentCount)/float64(len(li.RequiredLanguages)) >= 0.5 {
				score += 5
				matched = append(matched, "languages_partial")
			} else {
				missing = append(missing, "languages")
			}
		}

		// ── Visa validity ───────────────────────────────────────
		if w.VisaValidUntil != nil && !w.VisaValidUntil.IsZero() && !li.EndDate.IsZero() {
			buffer := w.VisaValidUntil.Time.Sub(li.EndDate)
			bufferDays := int(buffer.Hours() / 24)
			if bufferDays >= 90 {
				score += 15
				matched = append(matched, "visa")
			} else if bufferDays >= 0 {
				score += 8
				matched = append(matched, "visa_tight")
			} else {
				missing = append(missing, "visa")
			}
		} else if w.VisaValidUntil == nil && !li.EndDate.IsZero() {
			missing = append(missing, "visa")
		} else if w.VisaValidUntil != nil && !w.VisaValidUntil.IsZero() && w.VisaValidUntil.After(time.Now().AddDate(0, 3, 0)) {
			// Has visa valid >3 months from now, no job end date specified
			score += 10
			matched = append(matched, "visa")
		}

		// ── Match tier ─────────────────────────────────────────
		tier := "partial"
		if score >= scorePerfect {
			tier = "perfect"
		} else if score >= scoreGood {
			tier = "good"
		}

		matches = append(matches, models.WorkerMatch{
			Worker:          w,
			Score:           score,
			LineItemID:      li.ID,
			MatchTier:       tier,
			MatchedCriteria: matched,
			MissingCriteria: missing,
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

	// Calculate total needed workers across all line items
	totalNeeded := 0
	for _, li := range lineItems {
		totalNeeded += li.Quantity
	}

	var bundles []models.Bundle
	for corpID, liMap := range corpLineItems {
		bundle := models.Bundle{
			CorporationID: corpID,
			NeededWorkers: totalNeeded,
		}
		totalScore   := 0
		filledItems  := 0
		filledWorkers := 0

		for _, li := range lineItems {
			workers := liMap[li.ID]
			needed  := li.Quantity
			if len(workers) > needed {
				workers = workers[:needed]
			}
			isFilled := len(workers) >= needed
			fill := models.LineItemFill{
				LineItemID: li.ID,
				Profession: li.ProfessionType,
				Needed:     li.Quantity,
				Workers:    workers,
				IsFilled:   isFilled,
			}
			bundle.LineItems = append(bundle.LineItems, fill)
			if isFilled {
				filledItems++
			}
			filledWorkers += len(workers)
			for _, w := range workers {
				totalScore += w.Score
			}
		}

		bundle.IsComplete    = filledItems == len(lineItems)
		bundle.TotalScore    = totalScore
		bundle.FilledWorkers = filledWorkers
		if totalNeeded > 0 {
			bundle.FillPercentage = float64(filledWorkers) / float64(totalNeeded) * 100
		}
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

// countPresent returns how many of the required items are present in available.
func countPresent(required, available []string) int {
	avSet := map[string]bool{}
	for _, a := range available {
		avSet[strings.ToLower(a)] = true
	}
	count := 0
	for _, r := range required {
		if avSet[strings.ToLower(r)] {
			count++
		}
	}
	return count
}

func allPresent(required, available []string) bool {
	return countPresent(required, available) == len(required)
}
