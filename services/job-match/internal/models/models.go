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
	// Try date-only first
	if t, err := time.Parse("2006-01-02", s); err == nil {
		f.Time = t
		return nil
	}
	// Try RFC3339
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		f.Time = t
		return nil
	}
	// Try datetime without timezone
	if t, err := time.Parse("2006-01-02T15:04:05", s); err == nil {
		f.Time = t
		return nil
	}
	return nil // swallow unknown formats gracefully
}

func (f FlexDate) IsZero() bool {
	return f.Time.IsZero()
}

func (f FlexDate) After(t time.Time) bool {
	return f.Time.After(t)
}

type JobRequest struct {
	ID           string     `json:"id"`
	ContractorID string     `json:"contractor_id"`
	ProjectName  string     `json:"project_name"`
	Region       string     `json:"region"`
	Address      string     `json:"address,omitempty"`
	ProjectStart time.Time  `json:"project_start"`
	ProjectEnd   *time.Time `json:"project_end,omitempty"`
	Status       string     `json:"status"`
	CreatedBy    string     `json:"created_by"`
	CreatedAt    time.Time  `json:"created_at"`
}

type LineItem struct {
	ID                  string    `json:"id"`
	RequestID           string    `json:"request_id"`
	ProfessionType      string    `json:"profession_type"`
	Quantity            int       `json:"quantity"`
	StartDate           time.Time `json:"start_date"`
	EndDate             time.Time `json:"end_date"`
	MinExperience       int       `json:"min_experience"`
	OriginPreference    []string  `json:"origin_preference"`
	RequiredLanguages   []string  `json:"required_languages"`
	SpecialRequirements string    `json:"special_requirements,omitempty"`
	Status              string    `json:"status"`
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

// MatchTier describes how well a worker matches the line item requirements.
// perfect: all criteria met | good: most criteria met | partial: some criteria met
type WorkerMatch struct {
	Worker          Worker   `json:"worker"`
	Score           int      `json:"score"`
	LineItemID      string   `json:"line_item_id"`
	MatchTier       string   `json:"match_tier"`        // "perfect" | "good" | "partial"
	MatchedCriteria []string `json:"matched_criteria"`  // e.g. ["profession","region","experience"]
	MissingCriteria []string `json:"missing_criteria"`  // e.g. ["visa","language"]
}

type Bundle struct {
	CorporationID  string         `json:"corporation_id"`
	LineItems      []LineItemFill `json:"line_items"`
	TotalScore     int            `json:"total_score"`
	IsComplete     bool           `json:"is_complete"`
	FillPercentage float64        `json:"fill_percentage"` // 0-100: pct of total workers filled
	FilledWorkers  int            `json:"filled_workers"`
	NeededWorkers  int            `json:"needed_workers"`
}

type LineItemFill struct {
	LineItemID string        `json:"line_item_id"`
	Profession string        `json:"profession"`
	Needed     int           `json:"needed"`
	Workers    []WorkerMatch `json:"workers"`
	IsFilled   bool          `json:"is_filled"`
}
