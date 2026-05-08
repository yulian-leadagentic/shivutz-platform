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
	"time"

	"github.com/shivutz/job-match/internal/models"
)

var workerServiceURL = func() string {
	if u := os.Getenv("WORKER_SERVICE_URL"); u != "" {
		return u
	}
	return "http://worker:3003"
}()

const (
	scorePerfect = 80
	scoreGood    = 50
	maxCorps     = 20
)

// Run executes the matching algorithm for a single search and returns
// ranked CorpMatch entries (one per corporation with matching workers).
//
// SLA target: < 5 seconds end-to-end.
func Run(ctx context.Context, search models.WorkerSearch) ([]models.CorpMatch, error) {
	workers, err := fetchCandidatesWithFallback(ctx, search)
	if err != nil {
		return nil, err
	}

	scored := scoreWorkers(workers, search)

	// Group by corporation — top N per corp where N=quantity.
	corpWorkers := map[string][]models.WorkerMatch{}
	for _, wm := range scored {
		corp := wm.Worker.CorporationID
		corpWorkers[corp] = append(corpWorkers[corp], wm)
	}

	results := make([]models.CorpMatch, 0, len(corpWorkers))
	for corpID, ws := range corpWorkers {
		take := ws
		if len(take) > search.Quantity {
			take = take[:search.Quantity]
		}
		filled := len(take)
		totalScore := 0
		for _, w := range take {
			totalScore += w.Score
		}
		fillPct := 0.0
		if search.Quantity > 0 {
			fillPct = float64(filled) / float64(search.Quantity) * 100
		}
		results = append(results, models.CorpMatch{
			SearchID:       search.ID,
			CorporationID:  corpID,
			Profession:     search.ProfessionType,
			Needed:         search.Quantity,
			Workers:        take,
			FilledWorkers:  filled,
			IsComplete:     filled >= search.Quantity,
			FillPercentage: fillPct,
			TotalScore:     totalScore,
		})
	}

	// Sort: complete first, then by fill%, then by total score.
	sort.Slice(results, func(i, j int) bool {
		if results[i].IsComplete != results[j].IsComplete {
			return results[i].IsComplete
		}
		if results[i].FillPercentage != results[j].FillPercentage {
			return results[i].FillPercentage > results[j].FillPercentage
		}
		return results[i].TotalScore > results[j].TotalScore
	})

	if len(results) > maxCorps {
		results = results[:maxCorps]
	}
	return results, nil
}

// fetchCandidatesWithFallback merges strict (with visa filter) +
// relaxed (without visa filter) results, de-duped by worker ID.
func fetchCandidatesWithFallback(ctx context.Context, s models.WorkerSearch) ([]models.Worker, error) {
	type fetchResult struct {
		workers []models.Worker
		err     error
	}

	strictCh := make(chan fetchResult, 1)
	relaxedCh := make(chan fetchResult, 1)

	go func() {
		w, err := fetchCandidates(ctx, s, true)
		strictCh <- fetchResult{w, err}
	}()
	go func() {
		w, err := fetchCandidates(ctx, s, false)
		relaxedCh <- fetchResult{w, err}
	}()

	strict := <-strictCh
	relaxed := <-relaxedCh

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

	if strict.err != nil && relaxed.err != nil {
		return nil, strict.err
	}
	return merged, nil
}

func fetchCandidates(ctx context.Context, s models.WorkerSearch, withVisaFilter bool) ([]models.Worker, error) {
	url := fmt.Sprintf("%s/workers?profession=%s&status=available&limit=200", workerServiceURL, s.ProfessionType)

	if withVisaFilter && !s.EndDate.IsZero() {
		minVisa := s.EndDate.AddDate(0, 0, 30).Format("2006-01-02")
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

// scoreWorkers — same scoring rubric as before, just keyed off
// WorkerSearch instead of LineItem + JobRequest.
func scoreWorkers(workers []models.Worker, s models.WorkerSearch) []models.WorkerMatch {
	var matches []models.WorkerMatch

	for _, w := range workers {
		score := 30 // profession match guaranteed by query
		var matched []string
		var missing []string

		matched = append(matched, "profession")

		// ── Region ─────────────────────────────────────────────
		workerRegion := strings.ToLower(strings.TrimSpace(w.AvailableRegion))
		jobRegion := strings.ToLower(strings.TrimSpace(s.Region))
		if jobRegion == "" || workerRegion == "" || workerRegion == jobRegion {
			score += 20
			matched = append(matched, "region")
		} else {
			missing = append(missing, "region")
		}

		// ── Experience ─────────────────────────────────────────
		workerMonths := w.ExperienceYears * 12
		if s.MinExperience == 0 {
			score += 20
			matched = append(matched, "experience")
		} else if workerMonths >= s.MinExperience {
			score += 20
			matched = append(matched, "experience")
		} else if s.MinExperience > 0 && workerMonths >= s.MinExperience/2 {
			score += 12
			matched = append(matched, "experience_partial")
		} else if workerMonths > 0 {
			score += 6
		} else {
			missing = append(missing, "experience")
		}

		// ── Origin preference ───────────────────────────────────
		if len(s.OriginPreference) == 0 {
			score += 15
			matched = append(matched, "origin")
		} else if contains(s.OriginPreference, w.OriginCountry) {
			score += 15
			matched = append(matched, "origin")
		} else {
			missing = append(missing, "origin")
		}

		// ── Languages ──────────────────────────────────────────
		if len(s.RequiredLanguages) == 0 {
			score += 10
			matched = append(matched, "languages")
		} else {
			presentCount := countPresent(s.RequiredLanguages, w.Languages)
			if presentCount == len(s.RequiredLanguages) {
				score += 10
				matched = append(matched, "languages")
			} else if presentCount > 0 && float64(presentCount)/float64(len(s.RequiredLanguages)) >= 0.5 {
				score += 5
				matched = append(matched, "languages_partial")
			} else {
				missing = append(missing, "languages")
			}
		}

		// ── Visa validity ───────────────────────────────────────
		if s.EndDate.IsZero() {
			score += 15
			matched = append(matched, "visa")
		} else if w.VisaValidUntil != nil && !w.VisaValidUntil.IsZero() {
			buffer := w.VisaValidUntil.Time.Sub(s.EndDate)
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
		} else {
			missing = append(missing, "visa")
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
			SearchID:        s.ID,
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

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if strings.EqualFold(s, item) {
			return true
		}
	}
	return false
}

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
