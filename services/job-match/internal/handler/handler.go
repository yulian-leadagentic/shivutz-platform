package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shivutz/job-match/internal/matcher"
	"github.com/shivutz/job-match/internal/models"
	"github.com/shivutz/job-match/internal/publisher"
)

type Handler struct {
	db  *sql.DB
	pub *publisher.Publisher
}

func New(db *sql.DB, pub *publisher.Publisher) *Handler {
	return &Handler{db: db, pub: pub}
}

// rematchDebounceWindow — a search that was matched more recently than this
// is treated as "fresh" and skipped by the corp-change rematch path.
// Contractor-side changes pass force=true and bypass this check.
const rematchDebounceWindow = 5 * time.Minute

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func nullStr(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// normalizeLangs accepts either ["he","ro"] or [{"language":"he","level":"..."}] and returns ["he","ro"] as JSON.
func normalizeLangs(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return "[]"
	}
	var codes []string
	if json.Unmarshal(raw, &codes) == nil {
		out, _ := json.Marshal(codes)
		return string(out)
	}
	var objs []struct {
		Language string `json:"language"`
	}
	if json.Unmarshal(raw, &objs) == nil {
		for _, o := range objs {
			codes = append(codes, o.Language)
		}
		out, _ := json.Marshal(codes)
		return string(out)
	}
	return "[]"
}

// ── GET /searches — list searches for the requesting contractor ───────
//
// Each row carries a quick summary (best fill % from match_cache) so the
// dashboard can render without re-running matches.
func (h *Handler) ListSearches(w http.ResponseWriter, r *http.Request) {
	contractorID := r.Header.Get("x-org-id")
	if contractorID == "" {
		// admins can pass ?contractor_id=… to fetch on behalf
		contractorID = r.URL.Query().Get("contractor_id")
	}
	if contractorID == "" {
		writeError(w, 400, "contractor_id required")
		return
	}

	rows, err := h.db.Query(
		`SELECT ws.id, ws.contractor_id, ws.recruitment_type,
		        COALESCE(ws.region,'') AS region,
		        ws.profession_type, ws.quantity,
		        DATE_FORMAT(ws.start_date,'%Y-%m-%d') AS start_date,
		        COALESCE(DATE_FORMAT(ws.end_date,'%Y-%m-%d'),'') AS end_date,
		        COALESCE(ws.origin_preference,'[]') AS origin_preference,
		        ws.status, ws.created_at,
		        COALESCE(mc.best_fill_pct, -1) AS best_fill_pct,
		        COALESCE(mc.best_is_complete, 0) AS best_is_complete
		   FROM worker_searches ws
		   LEFT JOIN match_cache mc ON mc.search_id = ws.id
		  WHERE ws.contractor_id = ?
		  ORDER BY ws.created_at DESC
		  LIMIT 200`,
		contractorID,
	)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer rows.Close()

	type row struct {
		ID               string    `json:"id"`
		ContractorID     string    `json:"contractor_id"`
		RecruitmentType  string    `json:"recruitment_type"`
		Region           string    `json:"region"`
		ProfessionType   string    `json:"profession_type"`
		Quantity         int       `json:"quantity"`
		StartDate        string    `json:"start_date"`
		EndDate          string    `json:"end_date"`
		OriginPreference []string  `json:"origin_preference"`
		Status           string    `json:"status"`
		CreatedAt        time.Time `json:"created_at"`
		BestFillPct      float64   `json:"best_fill_pct"` // -1 = no match run yet
		BestIsComplete   bool      `json:"best_is_complete"`
	}
	result := []row{}
	for rows.Next() {
		var x row
		var originsJSON string
		if err := rows.Scan(&x.ID, &x.ContractorID, &x.RecruitmentType,
			&x.Region, &x.ProfessionType, &x.Quantity,
			&x.StartDate, &x.EndDate, &originsJSON, &x.Status, &x.CreatedAt,
			&x.BestFillPct, &x.BestIsComplete); err != nil {
			continue
		}
		if originsJSON != "" {
			_ = json.Unmarshal([]byte(originsJSON), &x.OriginPreference)
		}
		if x.OriginPreference == nil {
			x.OriginPreference = []string{}
		}
		result = append(result, x)
	}
	writeJSON(w, 200, result)
}

// ── POST /searches — create a single worker search ────────────────────
//
// Required: profession_type, quantity, start_date.
// Optional: recruitment_type (default domestic), region, end_date,
//           min_experience, origin_preference, required_languages.
func (h *Handler) CreateSearch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RecruitmentType   string          `json:"recruitment_type"`
		ProfessionType    string          `json:"profession_type"`
		Quantity          int             `json:"quantity"`
		StartDate         string          `json:"start_date"`
		EndDate           string          `json:"end_date"`
		Region            string          `json:"region"`
		Address           string          `json:"address"`
		MinExperience     int             `json:"min_experience"`
		OriginPreference  []string        `json:"origin_preference"`
		RequiredLanguages json.RawMessage `json:"required_languages"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "invalid JSON: "+err.Error())
		return
	}

	contractorID := r.Header.Get("x-org-id")
	if contractorID == "" {
		writeError(w, 400, "contractor_id missing (x-org-id)")
		return
	}

	if body.ProfessionType == "" {
		writeError(w, 400, "profession_type required")
		return
	}
	if body.Quantity < 1 {
		body.Quantity = 1
	}
	if strings.TrimSpace(body.StartDate) == "" {
		writeError(w, 400, "start_date required")
		return
	}
	recruitment := body.RecruitmentType
	if recruitment != "foreign" {
		recruitment = "domestic"
	}

	// end_date default: start_date + 30 days (column is NOT NULL).
	endDate := strings.TrimSpace(body.EndDate)
	if endDate == "" {
		if t, err := time.Parse("2006-01-02", body.StartDate); err == nil {
			endDate = t.AddDate(0, 0, 30).Format("2006-01-02")
		} else {
			endDate = body.StartDate
		}
	}

	// ── Server-side dedupe window ─────────────────────────────────
	// Before inserting, look for an identical worker_search this
	// contractor created in the last 90 seconds. If found, return
	// it instead of creating a duplicate. Covers:
	//   - Frontend double-click race (the primary cause — frontend
	//     guard helps too but a network blip can race past it)
	//   - Backend retries when the gateway times out at exactly
	//     the wrong moment
	//   - Legitimate "I submitted the same thing again by accident"
	// 90s is short enough that the same contractor genuinely
	// wanting to re-post (e.g. fix a typo + resubmit minutes later)
	// can still do so.
	var existingID string
	dedupeRow := h.db.QueryRow(
		`SELECT id FROM worker_searches
		  WHERE contractor_id   = ?
		    AND recruitment_type = ?
		    AND COALESCE(region, '')          = COALESCE(?, '')
		    AND profession_type = ?
		    AND start_date      = ?
		    AND status         IN ('open', 'partially_matched')
		    AND created_at     >= DATE_SUB(NOW(), INTERVAL 90 SECOND)
		  ORDER BY created_at DESC
		  LIMIT 1`,
		contractorID, recruitment, nullStr(body.Region),
		body.ProfessionType, body.StartDate,
	)
	if err := dedupeRow.Scan(&existingID); err == nil && existingID != "" {
		// Idempotent — return the existing search rather than insert
		// a duplicate. Status code is 200 (not 201) so a careful
		// caller can tell the difference, but the body shape is
		// identical so the existing frontend path doesn't break.
		writeJSON(w, 200, map[string]any{"id": existingID, "status": "open", "deduped": true})
		return
	}
	// (err == sql.ErrNoRows is the expected path — no existing
	// match, fall through to insert below.)

	id := uuid.NewString()
	origins, _ := json.Marshal(body.OriginPreference)
	langs := normalizeLangs(body.RequiredLanguages)

	_, err := h.db.Exec(
		`INSERT INTO worker_searches
		   (id, contractor_id, recruitment_type, region, address,
		    profession_type, quantity, start_date, end_date,
		    min_experience, origin_preference, required_languages, status)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'open')`,
		id, contractorID, recruitment,
		nullStr(body.Region), nullStr(body.Address),
		body.ProfessionType, body.Quantity,
		body.StartDate, endDate,
		body.MinExperience, string(origins), langs,
	)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	h.publishSearchChanged(id)
	writeJSON(w, 201, map[string]any{"id": id, "status": "open"})
}

// ── GET /searches/open — list active searches across all contractors ──
//
// Corp-facing browse surface. Returns every worker_search currently in
// an active state (open / partially_matched) with the contractor
// identity stripped to an anonymous "קבלן N" label. The index is
// assigned in created_at order so the same caller sees a stable list
// during a session; on the wire the response is reversed to newest-
// first for natural top-of-feed reading.
//
// Different corps may see different N for the same contractor in this
// version — the mapping is per-response, not per-caller. Acceptable for
// a browse view; if/when we add per-corp accept history this will need
// to become stable per (caller_corp, contractor) pair.
func (h *Handler) ListOpenSearches(w http.ResponseWriter, r *http.Request) {
	// R12 — drop searches the contractor already settled with another
	// corp. Once a deal moves into accepted/active/reporting/completed
	// for a given search, that search is "spoken for" and shouldn't
	// keep showing up on other corps' browse list. corp_committed deals
	// don't disqualify the search (the contractor may still pick a
	// different corp's proposal), so they're intentionally excluded
	// from the NOT EXISTS list.
	rows, err := h.db.Query(
		`SELECT ws.id, ws.contractor_id, ws.recruitment_type,
		        COALESCE(ws.region,'') AS region,
		        ws.profession_type, ws.quantity,
		        DATE_FORMAT(ws.start_date,'%Y-%m-%d') AS start_date,
		        COALESCE(DATE_FORMAT(ws.end_date,'%Y-%m-%d'),'') AS end_date,
		        COALESCE(ws.origin_preference,'[]') AS origin_preference,
		        ws.status, ws.created_at,
		        -- R5 #6 — count distinct corps + total workers already
		        -- committed against this search so the frontend can
		        -- render "עסקה בתהליכי סגירה" when the cap is hit.
		        (SELECT COUNT(DISTINCT d.corporation_id)
		           FROM deal_db.deals d
		          WHERE d.search_id = ws.id
		            AND d.deleted_at IS NULL
		            AND d.status IN ('corp_committed','approved','accepted','active','reporting','completed','closed')
		        ) AS committed_corp_count,
		        (SELECT COALESCE(SUM(
		             (SELECT COUNT(*) FROM deal_db.deal_workers dw
		               WHERE dw.deal_id = d.id AND dw.removed_at IS NULL)
		           ), 0)
		           FROM deal_db.deals d
		          WHERE d.search_id = ws.id
		            AND d.deleted_at IS NULL
		            AND d.status IN ('corp_committed','approved','accepted','active','reporting','completed','closed')
		        ) AS committed_worker_sum
		   FROM worker_searches ws
		  WHERE ws.status IN ('open','partially_matched')
		    AND NOT EXISTS (
		      SELECT 1 FROM deal_db.deals d
		       WHERE d.search_id = ws.id
		         AND d.status IN ('accepted','active','reporting','completed')
		         AND d.deleted_at IS NULL
		    )
		  ORDER BY ws.created_at ASC
		  LIMIT 200`,
	)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer rows.Close()

	type row struct {
		ID                   string    `json:"id"`
		AnonLabel            string    `json:"anon_label"`
		RecruitmentType      string    `json:"recruitment_type"`
		Region               string    `json:"region"`
		ProfessionType       string    `json:"profession_type"`
		Quantity             int       `json:"quantity"`
		StartDate            string    `json:"start_date"`
		EndDate              string    `json:"end_date"`
		OriginPreference     []string  `json:"origin_preference"`
		Status               string    `json:"status"`
		CreatedAt            time.Time `json:"created_at"`
		// R5 #6 — surface the 3-corp cap state so the corp browse
		// list can mark "עסקה בתהליכי סגירה — לא ניתן להציע" without
		// the frontend having to refetch deals per search.
		CommittedCorpCount   int  `json:"committed_corp_count"`
		CommittedWorkerSum   int  `json:"committed_worker_sum"`
		SearchLocked         bool `json:"search_locked"`
	}
	result := []row{}
	anonMap := map[string]int{}
	nextIdx := 1
	for rows.Next() {
		var x row
		var contractorID, originsJSON string
		if err := rows.Scan(&x.ID, &contractorID, &x.RecruitmentType,
			&x.Region, &x.ProfessionType, &x.Quantity,
			&x.StartDate, &x.EndDate, &originsJSON, &x.Status, &x.CreatedAt,
			&x.CommittedCorpCount, &x.CommittedWorkerSum); err != nil {
			continue
		}
		x.SearchLocked = x.CommittedCorpCount >= 3 && x.CommittedWorkerSum >= x.Quantity
		idx, ok := anonMap[contractorID]
		if !ok {
			idx = nextIdx
			anonMap[contractorID] = idx
			nextIdx++
		}
		x.AnonLabel = fmt.Sprintf("קבלן %d", idx)
		if originsJSON != "" {
			_ = json.Unmarshal([]byte(originsJSON), &x.OriginPreference)
		}
		if x.OriginPreference == nil {
			x.OriginPreference = []string{}
		}
		result = append(result, x)
	}
	// Reverse to newest-first for display.
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	writeJSON(w, 200, result)
}

// ── GET /searches/{id} ────────────────────────────────────────────────
func (h *Handler) GetSearch(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s, err := h.loadSearch(id)
	if err != nil {
		writeError(w, 404, "not found")
		return
	}
	writeJSON(w, 200, s)
}

// ── POST /searches/{id}/match — run the matcher synchronously ────────
func (h *Handler) RunMatch(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s, err := h.loadSearch(id)
	if err != nil {
		writeError(w, 404, "search not found")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	corps, err := matcher.Run(ctx, s)
	if err != nil {
		writeError(w, 500, fmt.Sprintf("matching failed: %v", err))
		return
	}

	corpsJSON, _ := json.Marshal(corps)
	var bestFillPct float64
	var bestIsComplete bool
	if len(corps) > 0 {
		bestFillPct = corps[0].FillPercentage
		bestIsComplete = corps[0].IsComplete
	}
	uiState := "none"
	if bestIsComplete {
		uiState = "complete"
	}
	h.db.Exec(
		`INSERT INTO match_cache
		   (search_id, result_json, computed_at, expires_at,
		    best_fill_pct, best_is_complete, last_notified_fill_state)
		 VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 30 MINUTE), ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
		   result_json              = VALUES(result_json),
		   computed_at              = VALUES(computed_at),
		   expires_at               = VALUES(expires_at),
		   best_fill_pct            = VALUES(best_fill_pct),
		   best_is_complete         = VALUES(best_is_complete),
		   last_notified_fill_state = VALUES(last_notified_fill_state)`,
		id, string(corpsJSON), bestFillPct, bestIsComplete, uiState,
	)

	// Zero-match broadcast: tell every relevant corp to come upload
	// workers in this profession. The notification service listens on
	// search.no_match and resolves which corps to SMS based on
	// recruitment_type + profession + their tier_2 status.
	if len(corps) == 0 && h.pub != nil {
		h.pub.Publish("search.no_match", map[string]any{
			"search_id":         s.ID,
			"contractor_id":     s.ContractorID,
			"profession_type":   s.ProfessionType,
			"recruitment_type":  s.RecruitmentType,
			"region":            s.Region,
			"quantity":          s.Quantity,
		})
	}

	writeJSON(w, 200, map[string]any{"search_id": id, "corps": corps})
}

// ── GET /searches/{id}/match-results — read cached matcher output ────
func (h *Handler) GetMatchResults(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	row := h.db.QueryRow(
		`SELECT result_json, computed_at FROM match_cache
		  WHERE search_id=? AND expires_at > NOW()`, id)
	var resultJSON string
	var computedAt time.Time
	if err := row.Scan(&resultJSON, &computedAt); err != nil {
		writeError(w, 404, "no cached results — run /match first")
		return
	}
	var corps any
	json.Unmarshal([]byte(resultJSON), &corps)
	writeJSON(w, 200, map[string]any{"search_id": id, "computed_at": computedAt, "corps": corps})
}

// ── PATCH /searches/{id} — let the contractor tweak quantity/dates/etc.
func (h *Handler) UpdateSearch(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Quantity      *int    `json:"quantity"`
		StartDate     string  `json:"start_date"`
		EndDate       string  `json:"end_date"`
		Region        *string `json:"region"`
		MinExperience *int    `json:"min_experience"`
		Status        string  `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}

	var sets []string
	var args []any
	if body.Quantity != nil && *body.Quantity > 0 {
		sets = append(sets, "quantity=?")
		args = append(args, *body.Quantity)
	}
	if body.StartDate != "" {
		sets = append(sets, "start_date=?")
		args = append(args, body.StartDate)
	}
	if body.EndDate != "" {
		sets = append(sets, "end_date=?")
		args = append(args, body.EndDate)
	}
	if body.Region != nil {
		sets = append(sets, "region=?")
		args = append(args, nullStr(*body.Region))
	}
	if body.MinExperience != nil {
		sets = append(sets, "min_experience=?")
		args = append(args, *body.MinExperience)
	}
	if body.Status != "" {
		sets = append(sets, "status=?")
		args = append(args, body.Status)
	}
	if len(sets) == 0 {
		writeError(w, 400, "no fields to update")
		return
	}

	args = append(args, id)
	q := "UPDATE worker_searches SET " + strings.Join(sets, ", ") + " WHERE id=?"
	res, err := h.db.Exec(q, args...)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeError(w, 404, "not found")
		return
	}
	h.publishSearchChanged(id)
	writeJSON(w, 200, map[string]string{"id": id})
}

// ── DELETE /searches/{id} — cancel a search ──────────────────────────
func (h *Handler) DeleteSearch(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	res, err := h.db.Exec(
		`UPDATE worker_searches SET status='cancelled' WHERE id=? AND status<>'cancelled'`,
		id,
	)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeError(w, 404, "not found or already cancelled")
		return
	}
	writeJSON(w, 200, map[string]string{"id": id, "status": "cancelled"})
}

// loadSearch returns a fully-hydrated WorkerSearch from the DB.
func (h *Handler) loadSearch(id string) (models.WorkerSearch, error) {
	row := h.db.QueryRow(
		`SELECT id, contractor_id, recruitment_type,
		        COALESCE(region,'') AS region,
		        COALESCE(address,'') AS address,
		        profession_type, quantity,
		        start_date, end_date,
		        min_experience,
		        COALESCE(origin_preference,'[]') AS origin_preference,
		        COALESCE(required_languages,'[]') AS required_languages,
		        COALESCE(special_requirements,'') AS special_requirements,
		        status, created_at
		   FROM worker_searches
		  WHERE id=?`,
		id,
	)
	var s models.WorkerSearch
	var origins, langs string
	if err := row.Scan(&s.ID, &s.ContractorID, &s.RecruitmentType,
		&s.Region, &s.Address,
		&s.ProfessionType, &s.Quantity,
		&s.StartDate, &s.EndDate,
		&s.MinExperience,
		&origins, &langs, &s.SpecialRequirements,
		&s.Status, &s.CreatedAt); err != nil {
		return models.WorkerSearch{}, err
	}
	json.Unmarshal([]byte(origins), &s.OriginPreference)
	json.Unmarshal([]byte(langs), &s.RequiredLanguages)
	if s.OriginPreference == nil {
		s.OriginPreference = []string{}
	}
	if s.RequiredLanguages == nil {
		s.RequiredLanguages = []string{}
	}
	return s, nil
}

func (h *Handler) publishSearchChanged(searchID string) {
	if h.pub == nil {
		return
	}
	h.pub.Publish("worker_search.changed", map[string]any{
		"search_id": searchID,
	})
}

// ── Internal: rematch flows ──────────────────────────────────────────

type matchInternalResult struct {
	SearchID     string `json:"search_id"`
	ShouldNotify bool   `json:"should_notify"`
	Skipped      bool   `json:"skipped"` // true when debounced or search not found

	// Populated whenever the matcher ran (Skipped=false), regardless
	// of ShouldNotify — downstream consumers (notification service)
	// need these fields to materialise new deals + SMS the corps,
	// not just on the complete-transition path.
	ContractorID string  `json:"contractor_id,omitempty"`
	ContactName  string  `json:"contact_name,omitempty"`
	ContactPhone string  `json:"contact_phone,omitempty"`
	ContactEmail string  `json:"contact_email,omitempty"`
	Profession   string  `json:"profession,omitempty"`
	Region       string  `json:"region,omitempty"`
	WorkerCount  int     `json:"worker_count,omitempty"`
	BestFillPct  float64 `json:"best_fill_pct,omitempty"`

	// Every corp that matched the search (sorted by best-first).
	// Used by the notification consumer to materialise deals for
	// any corp that doesn't already have one on this search.
	MatchedCorps []string `json:"matched_corps,omitempty"`
}

func (h *Handler) runMatchInternal(ctx context.Context, searchID string, force bool) matchInternalResult {
	res := matchInternalResult{SearchID: searchID}

	// Debounce
	if !force {
		var computedAt sql.NullTime
		_ = h.db.QueryRow("SELECT computed_at FROM match_cache WHERE search_id=?", searchID).
			Scan(&computedAt)
		if computedAt.Valid && time.Since(computedAt.Time) < rematchDebounceWindow {
			res.Skipped = true
			return res
		}
	}

	s, err := h.loadSearch(searchID)
	if err != nil || s.Status != "open" {
		res.Skipped = true
		return res
	}

	mctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	corps, err := matcher.Run(mctx, s)
	if err != nil {
		log.Printf("[rematch] matcher.Run failed for %s: %v", searchID, err)
		res.Skipped = true
		return res
	}

	var bestFillPct float64
	var bestIsComplete bool
	if len(corps) > 0 {
		bestFillPct = corps[0].FillPercentage
		bestIsComplete = corps[0].IsComplete
	}
	corpsJSON, _ := json.Marshal(corps)

	var prevState string
	_ = h.db.QueryRow("SELECT last_notified_fill_state FROM match_cache WHERE search_id=?", searchID).
		Scan(&prevState)
	if prevState == "" {
		prevState = "none"
	}
	newState := "none"
	if bestIsComplete {
		newState = "complete"
	}

	if _, err := h.db.Exec(
		`REPLACE INTO match_cache
		   (search_id, result_json, computed_at, expires_at,
		    best_fill_pct, best_is_complete, last_notified_fill_state)
		 VALUES (?,?,NOW(),DATE_ADD(NOW(), INTERVAL 30 MINUTE),?,?,?)`,
		searchID, string(corpsJSON), bestFillPct, bestIsComplete, newState,
	); err != nil {
		log.Printf("[rematch] match_cache write failed for %s: %v", searchID, err)
	}

	// Always surface the corp IDs + contractor metadata so the
	// notification consumer can materialise deals for any newly
	// matched corp, even when this isn't the first-complete edge.
	matched := make([]string, 0, len(corps))
	for _, c := range corps {
		matched = append(matched, c.CorporationID)
	}
	res.MatchedCorps = matched

	if len(corps) > 0 {
		var contactName, contactPhone, contactEmail sql.NullString
		if err := h.db.QueryRow(
			`SELECT c.contact_name, c.contact_phone, c.contact_email
			   FROM org_db.contractors c WHERE c.id=?`,
			s.ContractorID,
		).Scan(&contactName, &contactPhone, &contactEmail); err != nil {
			log.Printf("[rematch] contact lookup failed for contractor %s: %v", s.ContractorID, err)
		}
		res.ContractorID = s.ContractorID
		res.ContactName = contactName.String
		res.ContactPhone = contactPhone.String
		res.ContactEmail = contactEmail.String
		res.Profession = s.ProfessionType
		res.Region = s.Region
		res.WorkerCount = s.Quantity
		res.BestFillPct = bestFillPct
	}

	// ShouldNotify keeps the "first time we hit complete" semantics —
	// that's the only edge where the existing SMS-to-contractor "match
	// found!" template fires. New-deal materialisation runs separately
	// in the notification consumer off MatchedCorps.
	if prevState != "complete" && newState == "complete" {
		res.ShouldNotify = true
	}
	return res
}

// POST /internal/rematch-for-search — re-runs match for a single search.
func (h *Handler) RematchForSearch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SearchID string `json:"search_id"`
		Force    bool   `json:"force"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}
	if body.SearchID == "" {
		writeError(w, 400, "search_id required")
		return
	}
	res := h.runMatchInternal(r.Context(), body.SearchID, body.Force)
	writeJSON(w, 200, res)
}

// POST /internal/rematch-for-corp — re-runs every open search whose
// profession matches the changed worker. Each individual re-match is
// debounced by rematchDebounceWindow.
//
// Body: { "corporation_id": "...", "profession_type": "..." }
// Response: { "results": [matchInternalResult, ...] }
func (h *Handler) RematchForCorp(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CorporationID  string `json:"corporation_id"`
		ProfessionType string `json:"profession_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}
	if body.ProfessionType == "" {
		writeError(w, 400, "profession_type required")
		return
	}

	rows, err := h.db.Query(
		`SELECT id FROM worker_searches
		  WHERE status='open' AND profession_type=?`,
		body.ProfessionType,
	)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer rows.Close()

	var searchIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			searchIDs = append(searchIDs, id)
		}
	}

	results := make([]matchInternalResult, 0, len(searchIDs))
	for _, id := range searchIDs {
		results = append(results, h.runMatchInternal(r.Context(), id, false))
	}
	writeJSON(w, 200, map[string]any{"results": results})
}
