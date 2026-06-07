package models

import (
	"strings"
	"time"
)

// FlexDate can unmarshal both "2006-01-02" and RFC3339 date strings.
type FlexDate struct {
	time.Time
}

func (f *FlexDate) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "null" || s == "" {
		return nil
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		f.Time = t
		return nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		f.Time = t
		return nil
	}
	if t, err := time.Parse("2006-01-02T15:04:05", s); err == nil {
		f.Time = t
		return nil
	}
	return nil
}

func (f FlexDate) IsZero() bool {
	return f.Time.IsZero()
}

func (f FlexDate) After(t time.Time) bool {
	return f.Time.After(t)
}

// WorkerSearch — a contractor's standalone request for N workers of a
// given profession starting on a date. Wave 3 (2026-05-06) replaced
// the project + line-items model with this single self-contained row.
type WorkerSearch struct {
	ID                  string    `json:"id"`
	ContractorID        string    `json:"contractor_id"`
	RecruitmentType     string    `json:"recruitment_type"` // "domestic" | "foreign"
	Region              string    `json:"region,omitempty"`
	Address             string    `json:"address,omitempty"`
	ProfessionType      string    `json:"profession_type"`
	Quantity            int       `json:"quantity"`
	StartDate           time.Time `json:"start_date"`
	EndDate             time.Time `json:"end_date"`
	MinExperience       int       `json:"min_experience"`
	OriginPreference    []string  `json:"origin_preference"`
	RequiredLanguages   []string  `json:"required_languages"`
	SpecialRequirements string    `json:"special_requirements,omitempty"`
	Status              string    `json:"status"`
	CreatedAt           time.Time `json:"created_at"`
}

type Worker struct {
	ID              string    `json:"id"`
	CorporationID   string    `json:"corporation_id"`
	ProfessionType  string    `json:"profession_type"`
	ExperienceYears int       `json:"experience_years"`
	OriginCountry   string    `json:"origin_country"`
	Languages       []string  `json:"languages"`
	VisaValidUntil  *FlexDate `json:"visa_valid_until,omitempty"`
	Status          string    `json:"status"`
	AvailableRegion string    `json:"available_region,omitempty"`
}

// WorkerMatch describes how well a worker matches a search.
type WorkerMatch struct {
	Worker          Worker   `json:"worker"`
	Score           int      `json:"score"`
	SearchID        string   `json:"search_id"`
	MatchTier       string   `json:"match_tier"`       // "perfect" | "good" | "partial"
	MatchedCriteria []string `json:"matched_criteria"` // e.g. ["profession","region","experience"]
	MissingCriteria []string `json:"missing_criteria"` // e.g. ["visa","language"]
}

// CorpMatch — for a single search, a single corporation's offer of
// up to N workers. The matcher returns a sorted list of these per
// search (one entry per corp that has any matching worker).
type CorpMatch struct {
	SearchID       string        `json:"search_id"`
	CorporationID  string        `json:"corporation_id"`
	Profession     string        `json:"profession"`
	Needed         int           `json:"needed"`
	Workers        []WorkerMatch `json:"workers"`
	FilledWorkers  int           `json:"filled_workers"`
	IsComplete     bool          `json:"is_complete"`     // FilledWorkers >= Needed
	FillPercentage float64       `json:"fill_percentage"` // 0-100
	TotalScore     int           `json:"total_score"`
}
