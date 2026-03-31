FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY . .
RUN go mod tidy && go build -o job-match ./cmd/server

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/job-match .
EXPOSE 3004
CMD ["./job-match"]
