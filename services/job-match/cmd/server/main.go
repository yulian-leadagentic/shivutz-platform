package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"

	_ "github.com/go-sql-driver/mysql"
	"github.com/shivutz/job-match/internal/handler"
)

func main() {
	dsn := fmt.Sprintf("root:%s@tcp(%s:%s)/%s?parseTime=true&charset=utf8mb4",
		os.Getenv("MYSQL_ROOT_PASSWORD"),
		getEnv("MYSQL_HOST", "mysql"),
		getEnv("MYSQL_PORT", "3306"),
		getEnv("DB_NAME", "job_db"),
	)

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Fatalf("DB open error: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("DB ping error: %v", err)
	}
	log.Println("Job-Match DB connected")

	h := handler.New(db)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintln(w, `{"status":"ok","service":"job-match"}`)
	})
	mux.HandleFunc("POST /job-requests", h.CreateJobRequest)
	mux.HandleFunc("GET /job-requests/{id}", h.GetJobRequest)
	mux.HandleFunc("POST /job-requests/{id}/line-items", h.AddLineItem)
	mux.HandleFunc("POST /job-requests/{id}/match", h.RunMatch)
	mux.HandleFunc("GET /job-requests/{id}/match-results", h.GetMatchResults)
	mux.HandleFunc("GET /contractors/{id}/job-requests", h.ListByContractor)

	port := getEnv("PORT", "3004")
	log.Printf("Job-Match service listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
