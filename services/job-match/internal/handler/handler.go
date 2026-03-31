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

// POST /job-requests
func (h *Handler) CreateJobRequest(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ContractorID string `json:"contractor_id"`
		ProjectName  string `json:"project_name"`
		Region       string `json:"region"`
		Address      string `json:"address"`
		ProjectStart string `json:"project_start"`
		ProjectEnd   string `json:"project_end"`
		CreatedBy    string `json:"created_by"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "invalid JSON"); return
	}

	id := uuid.NewString()
	_, err := h.db.Exec(
		`INSERT INTO job_requests (id, contractor_id, project_name, region, address, project_start, project_end, created_by)
		 VALUES (?,?,?,?,?,?,?,?)`,
		id, body.ContractorID, body.ProjectName, body.Region, body.Address,
		body.ProjectStart, nullStr(body.ProjectEnd), body.CreatedBy,
	)
	if err != nil {
		writeError(w, 500, err.Error()); return
	}
	writeJSON(w, 201, map[string]string{"id": id})
}

// GET /job-requests/{id}
func (h *Handler) GetJobRequest(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	row := h.db.QueryRow("SELECT id, contractor_id, project_name, region, status, created_at FROM job_requests WHERE id=? AND deleted_at IS NULL", id)
	var req models.JobRequest
	if err := row.Scan(&req.ID, &req.ContractorID, &req.ProjectName, &req.Region, &req.Status, &req.CreatedAt); err != nil {
		writeError(w, 404, "not found"); return
	}
	writeJSON(w, 200, req)
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
		writeError(w, 400, "invalid JSON"); return
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
		writeError(w, 500, err.Error()); return
	}
	// Update parent request status to open
	h.db.Exec("UPDATE job_requests SET status='open' WHERE id=?", requestID)
	writeJSON(w, 201, map[string]string{"id": id})
}

// POST /job-requests/{id}/match
func (h *Handler) RunMatch(w http.ResponseWriter, r *http.Request) {
	requestID := r.PathValue("id")

	// Load request
	row := h.db.QueryRow("SELECT id, contractor_id, project_name, region, status FROM job_requests WHERE id=? AND deleted_at IS NULL", requestID)
	var req models.JobRequest
	if err := row.Scan(&req.ID, &req.ContractorID, &req.ProjectName, &req.Region, &req.Status); err != nil {
		writeError(w, 404, "job request not found"); return
	}

	// Load line items
	rows, err := h.db.Query(
		"SELECT id, profession_type, quantity, start_date, end_date, min_experience, origin_preference, required_languages FROM job_request_line_items WHERE request_id=?",
		requestID,
	)
	if err != nil {
		writeError(w, 500, err.Error()); return
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
		writeError(w, 400, "no line items on this request"); return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	bundles, err := matcher.Run(ctx, req, lineItems)
	if err != nil {
		writeError(w, 500, fmt.Sprintf("matching failed: %v", err)); return
	}

	// Cache result in MySQL (best-effort)
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
		writeError(w, 404, "no cached results — run /match first"); return
	}
	var bundles any
	json.Unmarshal([]byte(resultJSON), &bundles)
	writeJSON(w, 200, map[string]any{"request_id": requestID, "computed_at": computedAt, "bundles": bundles})
}

// GET /contractors/{id}/job-requests
func (h *Handler) ListByContractor(w http.ResponseWriter, r *http.Request) {
	contractorID := r.PathValue("id")
	rows, err := h.db.Query(
		"SELECT id, project_name, region, status, created_at FROM job_requests WHERE contractor_id=? AND deleted_at IS NULL ORDER BY created_at DESC",
		contractorID,
	)
	if err != nil {
		writeError(w, 500, err.Error()); return
	}
	defer rows.Close()

	var result []models.JobRequest
	for rows.Next() {
		var req models.JobRequest
		rows.Scan(&req.ID, &req.ProjectName, &req.Region, &req.Status, &req.CreatedAt)
		req.ContractorID = contractorID
		result = append(result, req)
	}
	writeJSON(w, 200, result)
}

func nullStr(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}
