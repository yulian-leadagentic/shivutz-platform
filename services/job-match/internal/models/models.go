package models

import "time"

type JobRequest struct {
	ID           string    `json:"id"`
	ContractorID string    `json:"contractor_id"`
	ProjectName  string    `json:"project_name"`
	Region       string    `json:"region"`
	Address      string    `json:"address,omitempty"`
	ProjectStart time.Time `json:"project_start"`
	ProjectEnd   *time.Time `json:"project_end,omitempty"`
	Status       string    `json:"status"`
	CreatedBy    string    `json:"created_by"`
	CreatedAt    time.Time `json:"created_at"`
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
	VisaValidUntil  *time.Time `json:"visa_valid_until,omitempty"`
	Status          string    `json:"status"`
}

type WorkerMatch struct {
	Worker      Worker  `json:"worker"`
	Score       int     `json:"score"`
	LineItemID  string  `json:"line_item_id"`
}

type Bundle struct {
	CorporationID string        `json:"corporation_id"`
	LineItems     []LineItemFill `json:"line_items"`
	TotalScore    int           `json:"total_score"`
	IsComplete    bool          `json:"is_complete"`
}

type LineItemFill struct {
	LineItemID string        `json:"line_item_id"`
	Profession string        `json:"profession"`
	Needed     int           `json:"needed"`
	Workers    []WorkerMatch `json:"workers"`
}
