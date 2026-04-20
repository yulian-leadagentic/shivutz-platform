package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shivutz/job-match/internal/matcher"
	"github.com/shivutz/job-match/internal/models"
)

type Handler struct {
	db *sql.DB
}

func New(db *sql.DB) *Handler {
	return &Handler{db: db}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// GET /job-requests — list requests for the requesting contractor (x-org-id header)
func (h *Handler) ListJobRequests(w http.ResponseWriter, r *http.Request) {
	contractorID := r.Header.Get("x-org-id")

	var rows *sql.Rows
	var err error
	baseSelect := `SELECT jr.id, jr.contractor_id,
	        COALESCE(jr.project_name,'') as project_name,
	        COALESCE(jr.project_name_he,'') as project_name_he,
	        COALESCE(jr.region,'') as region,
	        jr.status, jr.created_at,
	        COALESCE(DATE_FORMAT(jr.project_start,'%Y-%m-%d'),'') as project_start,
	        COALESCE(DATE_FORMAT(jr.project_end,'%Y-%m-%d'),'') as project_end,
	        COUNT(li.id) as professions_count,
	        COALESCE(SUM(li.quantity),0) as total_workers,
	        COALESCE(mc.best_fill_pct, -1) as best_fill_pct,
	        COALESCE(mc.best_is_complete, 0) as best_is_complete
	        FROM job_requests jr
	        LEFT JOIN job_request_line_items li ON li.request_id = jr.id
	        LEFT JOIN match_cache mc ON mc.request_id = jr.id`

	if contractorID != "" {
		rows, err = h.db.Query(
			baseSelect+` WHERE jr.contractor_id=? AND jr.deleted_at IS NULL GROUP BY jr.id ORDER BY jr.created_at DESC`,
			contractorID,
		)
	} else {
		rows, err = h.db.Query(
			baseSelect+` WHERE jr.deleted_at IS NULL GROUP BY jr.id ORDER BY jr.created_at DESC LIMIT 200`,
		)
	}
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer rows.Close()

	type lineItemSummary struct {
		ID             string `json:"id"`
		ProfessionType string `json:"profession_type"`
		Quantity       int    `json:"quantity"`
		Status         string `json:"status"`
	}
	type row struct {
		ID               string            `json:"id"`
		ContractorID     string            `json:"contractor_id"`
		ProjectName      string            `json:"project_name"`
		ProjectNameHe    string            `json:"project_name_he"`
		Region           string            `json:"region"`
		Status           string            `json:"status"`
		CreatedAt        time.Time         `json:"created_at"`
		ProjectStart     string            `json:"project_start_date"`
		ProjectEnd       string            `json:"project_end_date"`
		ProfessionsCount int               `json:"professions_count"`
		TotalWorkers     int               `json:"total_workers"`
		BestFillPct      float64           `json:"best_fill_pct"`   // -1 = no match run yet
		BestIsComplete   bool              `json:"best_is_complete"`
		LineItems        []lineItemSummary `json:"line_items"`
	}
	var result []row
	idOrder := []string{}
	byID := map[string]*row{}
	for rows.Next() {
		var req row
		if err := rows.Scan(&req.ID, &req.ContractorID, &req.ProjectName, &req.ProjectNameHe,
			&req.Region, &req.Status, &req.CreatedAt,
			&req.ProjectStart, &req.ProjectEnd,
			&req.ProfessionsCount, &req.TotalWorkers,
			&req.BestFillPct, &req.BestIsComplete); err != nil {
			continue
		}
		req.LineItems = []lineItemSummary{}
		result = append(result, req)
		idOrder = append(idOrder, req.ID)
		idx := len(result) - 1
		byID[req.ID] = &result[idx]
	}

	// Batch-load line item summaries for all returned requests
	if len(idOrder) > 0 {
		placeholders := make([]string, len(idOrder))
		args := make([]interface{}, len(idOrder))
		for i, id := range idOrder {
			placeholders[i] = "?"
			args[i] = id
		}
		liRows, liErr := h.db.Query(
			`SELECT id, request_id, profession_type, quantity, COALESCE(status,'open') as status
			 FROM job_request_line_items
			 WHERE request_id IN (`+strings.Join(placeholders, ",")+`)
			 ORDER BY request_id, id`,
			args...,
		)
		if liErr == nil {
			defer liRows.Close()
			for liRows.Next() {
				var li lineItemSummary
				var reqID string
				if err := liRows.Scan(&li.ID, &reqID, &li.ProfessionType, &li.Quantity, &li.Status); err != nil {
					continue
				}
				if r, ok := byID[reqID]; ok {
					r.LineItems = append(r.LineItems, li)
				}
			}
		}
	}

	if result == nil {
		result = []row{}
	}
	writeJSON(w, 200, result)
}

// POST /job-requests — create request + optional line items in one call
func (h *Handler) CreateJobRequest(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ContractorID    string `json:"contractor_id"`
		ProjectName     string `json:"project_name"`
		ProjectNameHe   string `json:"project_name_he"`
		Region          string `json:"region"`
		Address         string `json:"address"`
		ProjectStart    string `json:"project_start_date"`
		ProjectEnd      string `json:"project_end_date"`
		CreatedBy       string `json:"created_by"`
		LineItems       []struct {
			ProfessionType    string          `json:"profession_type"`
			Quantity          int             `json:"quantity"`
			StartDate         string          `json:"start_date"`
			EndDate           string          `json:"end_date"`
			MinExperience     int             `json:"min_experience"`
			OriginPreference  []string        `json:"origin_preference"`
			RequiredLanguages json.RawMessage `json:"required_languages"`
		} `json:"line_items"`
	}
	bodyBytes, _ := io.ReadAll(r.Body)
	log.Printf("[CreateJobRequest] body (%d bytes): %s", len(bodyBytes), string(bodyBytes))
	if err := json.Unmarshal(bodyBytes, &body); err != nil {
		log.Printf("[CreateJobRequest] decode error: %v", err)
		writeError(w, 400, err.Error())
		return
	}

	// Read contractor_id from gateway header if not supplied in body
	if body.ContractorID == "" {
		body.ContractorID = r.Header.Get("x-org-id")
	}
	if body.CreatedBy == "" {
		body.CreatedBy = r.Header.Get("x-user-id")
	}

	// Default project_start to today if not provided (column is NOT NULL)
	projectStart := body.ProjectStart
	if strings.TrimSpace(projectStart) == "" {
		projectStart = time.Now().Format("2006-01-02")
	}

	id := uuid.NewString()
	status := "draft"
	if len(body.LineItems) > 0 {
		status = "open"
	}

	tx, err := h.db.Begin()
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec(
		`INSERT INTO job_requests (id, contractor_id, project_name, project_name_he, region, address, project_start, project_end, status, created_by)
		 VALUES (?,?,?,?,?,?,?,?,?,?)`,
		id, body.ContractorID, body.ProjectName, nullStr(body.ProjectNameHe),
		body.Region, nullStr(body.Address),
		projectStart, nullStr(body.ProjectEnd),
		status, nullStr(body.CreatedBy),
	)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	var lineItemIDs []string
	for _, li := range body.LineItems {
		liID := uuid.NewString()
		origins, _ := json.Marshal(li.OriginPreference)
		// Normalize required_languages: accept both []string and [{language,level}] formats
		langs := normalizeLangs(li.RequiredLanguages)
		_, err = tx.Exec(
			`INSERT INTO job_request_line_items
			 (id, request_id, profession_type, quantity, start_date, end_date, min_experience, origin_preference, required_languages)
			 VALUES (?,?,?,?,?,?,?,?,?)`,
			liID, id, li.ProfessionType, li.Quantity,
			nullStr(li.StartDate), nullStr(li.EndDate), li.MinExperience,
			string(origins), langs,
		)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		lineItemIDs = append(lineItemIDs, liID)
	}

	if err := tx.Commit(); err != nil {
		writeError(w, 500, err.Error())
		return
	}

	writeJSON(w, 201, map[string]any{"id": id, "status": status, "line_item_ids": lineItemIDs})
}

// GET /job-requests/{id}
func (h *Handler) GetJobRequest(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	row := h.db.QueryRow(
		`SELECT id, contractor_id, project_name, COALESCE(project_name_he,'') as project_name_he,
		        COALESCE(region,'') as region, status, created_at
		 FROM job_requests WHERE id=? AND deleted_at IS NULL`, id)
	var req struct {
		ID            string    `json:"id"`
		ContractorID  string    `json:"contractor_id"`
		ProjectName   string    `json:"project_name"`
		ProjectNameHe string    `json:"project_name_he"`
		Region        string    `json:"region"`
		Status        string    `json:"status"`
		CreatedAt     time.Time `json:"created_at"`
	}
	if err := row.Scan(&req.ID, &req.ContractorID, &req.ProjectName, &req.ProjectNameHe,
		&req.Region, &req.Status, &req.CreatedAt); err != nil {
		writeError(w, 404, "not found")
		return
	}

	// Fetch line items (include origin_preference, required_languages for edit support)
	liRows, err := h.db.Query(
		`SELECT id, profession_type, quantity,
		        COALESCE(start_date,'') as start_date, COALESCE(end_date,'') as end_date,
		        min_experience,
		        COALESCE(origin_preference,'[]') as origin_preference,
		        COALESCE(required_languages,'[]') as required_languages
		 FROM job_request_line_items WHERE request_id=?`, id)
	if err != nil {
		writeJSON(w, 200, req)
		return
	}
	defer liRows.Close()
	type LI struct {
		ID                string   `json:"id"`
		ProfessionType    string   `json:"profession_type"`
		Quantity          int      `json:"quantity"`
		StartDate         string   `json:"start_date"`
		EndDate           string   `json:"end_date"`
		MinExperience     int      `json:"min_experience"`
		OriginPreference  []string `json:"origin_preference"`
		RequiredLanguages []string `json:"required_languages"`
	}
	var lineItems []LI
	for liRows.Next() {
		var li LI
		var origins, langs string
		liRows.Scan(&li.ID, &li.ProfessionType, &li.Quantity, &li.StartDate, &li.EndDate,
			&li.MinExperience, &origins, &langs)
		json.Unmarshal([]byte(origins), &li.OriginPreference)
		json.Unmarshal([]byte(langs), &li.RequiredLanguages)
		if li.OriginPreference == nil { li.OriginPreference = []string{} }
		if li.RequiredLanguages == nil { li.RequiredLanguages = []string{} }
		lineItems = append(lineItems, li)
	}
	if lineItems == nil {
		lineItems = []LI{}
	}

	writeJSON(w, 200, map[string]any{
		"id":              req.ID,
		"contractor_id":   req.ContractorID,
		"project_name":    req.ProjectName,
		"project_name_he": req.ProjectNameHe,
		"region":          req.Region,
		"status":          req.Status,
		"created_at":      req.CreatedAt,
		"line_items":      lineItems,
	})
}

// POST /job-requests/{id}/line-items
func (h *Handler) AddLineItem(w http.ResponseWriter, r *http.Request) {
	requestID := r.PathValue("id")
	var body struct {
		ProfessionType    string   `json:"profession_type"`
		Quantity          int      `json:"quantity"`
		StartDate         string   `json:"start_date"`
		EndDate           string   `json:"end_date"`
		MinExperience     int      `json:"min_experience"`
		OriginPreference  []string `json:"origin_preference"`
		RequiredLanguages []string `json:"required_languages"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}

	id := uuid.NewString()
	origins, _ := json.Marshal(body.OriginPreference)
	langs, _ := json.Marshal(body.RequiredLanguages)

	_, err := h.db.Exec(
		`INSERT INTO job_request_line_items
		 (id, request_id, profession_type, quantity, start_date, end_date, min_experience, origin_preference, required_languages)
		 VALUES (?,?,?,?,?,?,?,?,?)`,
		id, requestID, body.ProfessionType, body.Quantity,
		body.StartDate, body.EndDate, body.MinExperience, string(origins), string(langs),
	)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	h.db.Exec("UPDATE job_requests SET status='open' WHERE id=?", requestID)
	writeJSON(w, 201, map[string]string{"id": id})
}

// POST /job-requests/{id}/match
func (h *Handler) RunMatch(w http.ResponseWriter, r *http.Request) {
	requestID := r.PathValue("id")

	row := h.db.QueryRow(
		"SELECT id, contractor_id, COALESCE(project_name,'') as project_name, COALESCE(region,'') as region, status FROM job_requests WHERE id=? AND deleted_at IS NULL",
		requestID)
	var req models.JobRequest
	if err := row.Scan(&req.ID, &req.ContractorID, &req.ProjectName, &req.Region, &req.Status); err != nil {
		writeError(w, 404, "job request not found")
		return
	}

	rows, err := h.db.Query(
		"SELECT id, profession_type, quantity, start_date, end_date, min_experience, origin_preference, required_languages FROM job_request_line_items WHERE request_id=?",
		requestID,
	)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer rows.Close()

	var lineItems []models.LineItem
	for rows.Next() {
		var li models.LineItem
		var origins, langs string
		if err := rows.Scan(&li.ID, &li.ProfessionType, &li.Quantity, &li.StartDate, &li.EndDate, &li.MinExperience, &origins, &langs); err != nil {
			continue
		}
		json.Unmarshal([]byte(origins), &li.OriginPreference)
		json.Unmarshal([]byte(langs), &li.RequiredLanguages)
		lineItems = append(lineItems, li)
	}

	if len(lineItems) == 0 {
		writeError(w, 400, "no line items on this request")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	bundles, err := matcher.Run(ctx, req, lineItems)
	if err != nil {
		writeError(w, 500, fmt.Sprintf("matching failed: %v", err))
		return
	}

	bundlesJSON, _ := json.Marshal(bundles)
	// Store summary stats for fast list-page display
	var bestFillPct float64
	var bestIsComplete bool
	if len(bundles) > 0 {
		bestFillPct = bundles[0].FillPercentage
		bestIsComplete = bundles[0].IsComplete
	}
	h.db.Exec(
		"REPLACE INTO match_cache (request_id, result_json, computed_at, expires_at, best_fill_pct, best_is_complete) VALUES (?,?,NOW(),DATE_ADD(NOW(), INTERVAL 30 MINUTE),?,?)",
		requestID, string(bundlesJSON), bestFillPct, bestIsComplete,
	)

	writeJSON(w, 200, map[string]any{"request_id": requestID, "bundles": bundles})
}

// GET /job-requests/{id}/match-results
func (h *Handler) GetMatchResults(w http.ResponseWriter, r *http.Request) {
	requestID := r.PathValue("id")
	row := h.db.QueryRow("SELECT result_json, computed_at FROM match_cache WHERE request_id=? AND expires_at > NOW()", requestID)
	var resultJSON string
	var computedAt time.Time
	if err := row.Scan(&resultJSON, &computedAt); err != nil {
		writeError(w, 404, "no cached results — run /match first")
		return
	}
	var bundles any
	json.Unmarshal([]byte(resultJSON), &bundles)
	writeJSON(w, 200, map[string]any{"request_id": requestID, "computed_at": computedAt, "bundles": bundles})
}

// GET /contractors/{id}/job-requests
func (h *Handler) ListByContractor(w http.ResponseWriter, r *http.Request) {
	contractorID := r.PathValue("id")
	rows, err := h.db.Query(
		`SELECT id, project_name, COALESCE(project_name_he,'') as project_name_he,
		        COALESCE(region,'') as region, status, created_at
		 FROM job_requests WHERE contractor_id=? AND deleted_at IS NULL ORDER BY created_at DESC`,
		contractorID,
	)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer rows.Close()

	var result []models.JobRequest
	for rows.Next() {
		var req models.JobRequest
		rows.Scan(&req.ID, &req.ProjectName, &req.Region, &req.Status, &req.CreatedAt)
		req.ContractorID = contractorID
		result = append(result, req)
	}
	if result == nil {
		result = []models.JobRequest{}
	}
	writeJSON(w, 200, result)
}

// PATCH /job-requests/{id} — update project metadata (name, region, dates)
func (h *Handler) UpdateJobRequest(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		ProjectNameHe string `json:"project_name_he"`
		Region        string `json:"region"`
		ProjectStart  string `json:"project_start_date"`
		ProjectEnd    string `json:"project_end_date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}

	var setClauses []string
	var params []any
	if body.ProjectNameHe != "" {
		setClauses = append(setClauses, "project_name_he=?")
		params = append(params, body.ProjectNameHe)
	}
	if body.Region != "" {
		setClauses = append(setClauses, "region=?")
		params = append(params, body.Region)
	}
	if body.ProjectStart != "" {
		setClauses = append(setClauses, "project_start=?")
		params = append(params, body.ProjectStart)
	}
	if body.ProjectEnd != "" {
		setClauses = append(setClauses, "project_end=?")
		params = append(params, body.ProjectEnd)
	}
	if len(setClauses) == 0 {
		writeError(w, 400, "no fields to update")
		return
	}

	params = append(params, id)
	query := "UPDATE job_requests SET " + strings.Join(setClauses, ", ") + " WHERE id=? AND deleted_at IS NULL"
	result, err := h.db.Exec(query, params...)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		writeError(w, 404, "not found")
		return
	}
	writeJSON(w, 200, map[string]string{"id": id})
}

// PUT /job-requests/{id}/line-items — replace all line items atomically
func (h *Handler) ReplaceLineItems(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		LineItems []struct {
			ProfessionType    string          `json:"profession_type"`
			Quantity          int             `json:"quantity"`
			StartDate         string          `json:"start_date"`
			EndDate           string          `json:"end_date"`
			MinExperience     int             `json:"min_experience"`
			OriginPreference  []string        `json:"origin_preference"`
			RequiredLanguages json.RawMessage `json:"required_languages"`
		} `json:"line_items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer tx.Rollback()

	// Delete all existing line items for this request
	if _, err := tx.Exec("DELETE FROM job_request_line_items WHERE request_id=?", id); err != nil {
		writeError(w, 500, err.Error())
		return
	}

	// Re-insert the new set
	for _, li := range body.LineItems {
		liID := uuid.NewString()
		origins, _ := json.Marshal(li.OriginPreference)
		langs := normalizeLangs(li.RequiredLanguages)
		if _, err := tx.Exec(
			`INSERT INTO job_request_line_items
			 (id, request_id, profession_type, quantity, start_date, end_date, min_experience, origin_preference, required_languages)
			 VALUES (?,?,?,?,?,?,?,?,?)`,
			liID, id, li.ProfessionType, li.Quantity,
			nullStr(li.StartDate), nullStr(li.EndDate), li.MinExperience,
			string(origins), langs,
		); err != nil {
			writeError(w, 500, err.Error())
			return
		}
	}

	// Update status: open if has line items, else draft
	newStatus := "draft"
	if len(body.LineItems) > 0 {
		newStatus = "open"
	}
	tx.Exec("UPDATE job_requests SET status=? WHERE id=? AND status IN ('draft','open')", newStatus, id)

	if err := tx.Commit(); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"id": id, "line_items_count": len(body.LineItems)})
}

// normalizeLangs accepts either ["he","ro"] or [{"language":"he","level":"..."}] and returns ["he","ro"] as JSON.
func normalizeLangs(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return "[]"
	}
	// Try []string first
	var codes []string
	if json.Unmarshal(raw, &codes) == nil {
		out, _ := json.Marshal(codes)
		return string(out)
	}
	// Try [{language, level}] format
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

func nullStr(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}
