FROM python:3.12-slim
WORKDIR /app

# Build context is the repo root (set in docker-compose / Railway service
# settings) so this Dockerfile can pull in db/migrations + scripts/ for
# the entrypoint runner.
COPY services/user-org/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/user-org/app/ ./app/
COPY db/migrations/         /db/migrations/
COPY scripts/               /scripts/

EXPOSE 3002

# Entrypoint: apply pending migrations → seed first admin if env vars set →
# launch uvicorn. The migration runner is idempotent and the seed script
# is a no-op once any admin exists, so this is safe on every container
# boot. A migration failure exits non-zero and Railway holds the deploy.
CMD ["sh", "-c", "python /scripts/run_migrations.py --dir /db/migrations && python /scripts/seed_admin.py && uvicorn app.main:app --host :: --port 3002"]
