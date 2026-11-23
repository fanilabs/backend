.PHONY: help install dev dev-worker build start lint format format-check test test-watch \
        typecheck db-up db-down db-migrate db-create-test db-studio seed docker-up docker-down docker-logs \
        docker-up-observability docker-migrate load-test

help:
	@echo "fanilab-backend — common tasks"
	@echo "  make install               Install dependencies"
	@echo "  make dev                   Run the API in watch mode"
	@echo "  make dev-worker            Run the BullMQ worker process in watch mode"
	@echo "  make build                 Compile TypeScript"
	@echo "  make start                 Start the compiled API (pnpm start); run make build first to produce dist/"
	@echo "  make lint                  Run ESLint"
	@echo "  make format                Run Prettier (writes changes)"
	@echo "  make format-check          Run Prettier in check mode (read-only)"
	@echo "  make test                  Run the test suite once"
	@echo "  make test-watch            Run the test suite in watch mode"
	@echo "  make test-coverage         Run the test suite with coverage report (pnpm test:coverage)"
	@echo "  make test-e2e              Run the E2E test suite (requires Postgres + Redis; see tests/e2e/README.md)"
	@echo "  make typecheck             Run the TypeScript compiler with no output"
	@echo "  make db-up                 Start Postgres + Redis only (docker compose)"
	@echo "  make db-down               Stop Postgres + Redis"
	@echo "  make db-create-test        Create the local test database (fanilab_backend_test)"
	@echo "  make db-migrate            Run Prisma migrations (dev)"
	@echo "  make db-studio             Open Prisma Studio"
	@echo "  make seed                  Run the database seed script"
	@echo "  make docker-up             Start the full stack (api, worker, postgres, redis)"
	@echo "  make docker-down           Stop the full stack"
	@echo "  make docker-logs           Tail logs for the full stack"
	@echo "  make docker-up-observability   Also start local Prometheus + Grafana (see docs/OBSERVABILITY.md)"
	@echo "  make docker-migrate        Re-run Prisma migrations against the Docker Compose stack"
	@echo "  make load-test             Run scripts/load-test.ts against BASE_URL (default localhost:3000)"
	@echo "  make check-dockerfile-parity   Verify Dockerfile and Dockerfile.worker shared stages are in sync"

install:
	pnpm install

dev:
	pnpm dev

dev-worker:
	pnpm dev:worker

build:
	pnpm build

start:
	pnpm start

lint:
	pnpm lint

format:
	pnpm format

format-check:
	pnpm format:check

test:
	pnpm test

test-watch:
	pnpm test:watch

test-coverage:
	pnpm test:coverage

test-e2e:
	pnpm test:e2e

typecheck:
	pnpm typecheck

db-up:
	docker compose up -d postgres redis

db-down:
	docker compose stop postgres redis

db-create-test:
	createdb -h localhost -U fanilab -d fanilab_backend_test 2>/dev/null || echo "Test database already exists or created"

db-migrate:
	pnpm prisma:migrate

db-studio:
	pnpm prisma:studio

seed:
	pnpm seed

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-up-observability:
	docker compose --profile observability up -d --build

docker-migrate:
	docker compose run --rm migrate

load-test:
	pnpm load-test

check-dockerfile-parity:
	bash scripts/check-dockerfile-parity.sh
