// Package publisher emits events to the marketplace.events RabbitMQ
// exchange. Mirrors the Python publisher in services/user-org/app/publisher.py:
// same exchange name, topic routing, persistent delivery.
//
// Failures are logged and swallowed — publishing is best-effort. Callers
// must not assume an event was delivered.
package publisher

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

const exchangeName = "marketplace.events"

type Publisher struct {
	url string
	mu  sync.Mutex
	ch  *amqp.Channel
	cn  *amqp.Connection
}

func New() *Publisher {
	url := os.Getenv("RABBITMQ_URL")
	if url == "" {
		url = "amqp://guest:guest@rabbitmq:5672"
	}
	return &Publisher{url: url}
}

func (p *Publisher) ensure() error {
	if p.ch != nil && !p.ch.IsClosed() {
		return nil
	}
	cn, err := amqp.Dial(p.url)
	if err != nil {
		return err
	}
	ch, err := cn.Channel()
	if err != nil {
		cn.Close()
		return err
	}
	if err := ch.ExchangeDeclare(exchangeName, "topic", true, false, false, false, nil); err != nil {
		ch.Close()
		cn.Close()
		return err
	}
	p.cn = cn
	p.ch = ch
	return nil
}

// Publish emits an event with the given routing key. Best-effort:
// connection issues are logged and swallowed.
func (p *Publisher) Publish(routingKey string, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[publisher] marshal %s: %v", routingKey, err)
		return
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	if err := p.ensure(); err != nil {
		log.Printf("[publisher] connect failed for %s: %v", routingKey, err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if err := p.ch.PublishWithContext(ctx, exchangeName, routingKey, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Timestamp:    time.Now(),
		Body:         body,
	}); err != nil {
		log.Printf("[publisher] publish %s: %v", routingKey, err)
		// Drop the channel so the next call reconnects.
		p.ch.Close()
		p.ch = nil
	}
}

func (p *Publisher) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.ch != nil {
		p.ch.Close()
	}
	if p.cn != nil {
		p.cn.Close()
	}
}
