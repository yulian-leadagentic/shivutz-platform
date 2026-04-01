package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
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
	if contractorID != "" {
		rows, err = h.db.Query(
			`SELECT id, contractor_id, project_name, COALESCE(project_name_he,'') as project_name_he,
			        COALESCE(region,'') as region, COALESCE(address,'') as address,
			        status, created_at
			 FROM job_requests WHERE contractor_id=? AND deleted_at IS NULL
			 ORDER BY created_at DESC`,
			contractorID,
		)
	} else {
		// admin — return all
		rows, err = h.db.Query(
			`SELECT id, contractor_id, project_name, COALESCE(project_name_he,'') as project_name_he,
			        COALESCE(region,'') as region, COALESCE(address,'') as address,
			        status, created_at
			 FROM job_requests WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`,
		)
	}
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer rows.Close()

	type row struct {
		ID            string    `json:"id"`
		ContractorID  string    `json:"contractor_id"`
		ProjectName   string    `json:"project_name"`
		ProjectNameHe string    `json:"project_name_he"`
		Region        string    `json:"region"`
		Address       string    `json:"address"`
		Status        string    `json:"status"`
		CreatedAt     time.Time `json:"created_at"`
	}
	var result []row
	for rows.Next() {
		var req row
		if err := rows.Scan(&req.ID, &req.ContractorID, &req.ProjectName, &req.ProjectNameHe,
			&req.Region, &req.Address, &req.Status, &req.CreatedAt); err != nil {
			continue
		}
		result = append(result, req)
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
			ProfessionType    string   `json:"profession_type"`
			Quantity          int      `json:"quantity"`
			StartDate         string   `json:"start_date"`
			EndDate           string   `json:"end_date"`
			MinExperience     int      `json:"min_experience"`
			OriginPreference  []string `json:"origin_preference"`
			RequiredLanguages []string `json:"required_languages"`
		} `json:"line_items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "invalid JSON")
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
		langs, _ := json.Marshal(li.RequiredLanguages)
		_, err = tx.Exec(
			`INSERT INTO job_request_line_items
			 (id, request_id, profession_type, quantity, start_date, end_date, min_experience, origin_preference, required_languages)
			 VALUES (?,?,?,?,?,?,?,?,?)`,
			liID, id, li.ProfessionType, li.Quantity,
			nullStr(li.StartDate), nullStr(li.EndDate), li.MinExperience,
			string(origins), string(langs),
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

	// Fetch line items
	liRows, err := h.db.Query(
		`SELECT id, profession_type, quantity, start_date, end_date, min_experience
		 FROM job_request_line_items WHERE request_id=?`, id)
	if err != nil {
		writeJSON(w, 200, req)
		return
	}
	defer liRows.Close()
	type LI struct {
		ID            string `json:"id"`
		ProfessionType string `json:"profession_type"`
		Quantity      int    `json:"quantity"`
		StartDate     string `json:"start_date"`
		EndDate       string `json:"end_date"`
		MinExperience int    `json:"min_experience"`
	}
	var lineItems []LI
	for liRows.Next() {
		var li LI
		liRows.Scan(&li.ID, &li.ProfessionType, &li.Quantity, &li.StartDate, &li.EndDate, &li.MinExperience)
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
	h.db.Exec(
		"REPLACE INTO match_cache (request_id, result_json, computed_at, expires_at) VALUES (?,?,NOW(),DATE_ADD(NOW(), INTERVAL 5 MINUTE))",
		requestID, string(bundlesJSON),
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

func nullStr(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}
