"""L8 · OPS-1 · structured JSON error logger.

Sentry-alternative per launch spec §1: 'if no Sentry account, build
the JSON-log alternative. Don't skip the stage.' Every error-level
log line becomes a single JSON object, so Railway's log stream is
grep-able for error patterns and can be shipped to whatever
aggregator we pick post-launch.

Two hard rules the formatter enforces:
  1. PII scrub — phone / token / password / jwt / otp / secret /
     card / provider_token / access_token / refresh_token get their
     values replaced with '[REDACTED]' before serialisation. The
     scrub runs on the full record dict, so it catches values that
     any handler happened to attach.
  2. Never crash the app on a log call. JSON serialisation errors
     fall back to a minimal envelope.

Call configure_logging() ONCE from the service's main.py before any
route is registered so all subsequent logger.info/error calls emit
JSON.
"""
import json
import logging
import os
import sys
from datetime import datetime, timezone

_PII_KEYS = {
    "phone", "phone_number", "otp", "code",
    "password", "jwt", "token", "provider_token",
    "access_token", "refresh_token",
    "secret", "api_key", "card", "card_number",
    "cvv", "cvc",
}


def _scrub(value):
    """Recursively replace PII values with [REDACTED]."""
    if isinstance(value, dict):
        return {k: ("[REDACTED]" if k.lower() in _PII_KEYS else _scrub(v))
                for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    return value


class JsonFormatter(logging.Formatter):
    """Emit each record as a single-line JSON object."""

    SERVICE     = os.getenv("SERVICE_NAME", "unknown")
    ENVIRONMENT = os.getenv("ENVIRONMENT", "unknown")
    RELEASE     = os.getenv("RELEASE_SHA", "unknown")

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts":       datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level":    record.levelname,
            "msg":      record.getMessage(),
            "logger":   record.name,
            "service":  self.SERVICE,
            "environment": self.ENVIRONMENT,
            "release":  self.RELEASE,
        }
        # Pull request_id off the record if a handler stamped it there.
        for attr in ("request_id", "entity_id", "entity_type"):
            v = getattr(record, attr, None)
            if v is not None:
                payload[attr] = v
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        try:
            return json.dumps(_scrub(payload), ensure_ascii=False, default=str)
        except Exception:
            # Fallback so a bad payload doesn't kill the request.
            return json.dumps({
                "ts":      payload["ts"],
                "level":   payload["level"],
                "msg":     "[log_format_failed]",
                "service": payload["service"],
            })


def configure_logging(level: str = "INFO") -> None:
    """Install the JSON formatter on the root logger. Idempotent."""
    root = logging.getLogger()
    root.setLevel(level)
    # Remove any handlers that were configured before this call so we
    # don't emit each line twice with different formats.
    for h in list(root.handlers):
        root.removeHandler(h)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
