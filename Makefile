.PHONY: help install dev dev-worker build start lint format test test-watch \
        typecheck db-up db-down db-migrate db-studio seed docker-up docker-down docker-logs \
        docker-up-observability docker-migrate load-test

help:
	@echo "fanilab-backend — common tasks"
	@echo "  make install               Install dependencies"
	@echo "  make dev                   Run the API in watch mode"
	@echo "  make dev-worker            Run the BullMQ worker process in watch mode"
	@echo "  make build                 Compile TypeScript"
	@echo "  make lint                  Run ESLint"
	@echo "  make format                Run Prettier (writes changes)"
	@echo "  make test                  Run the test suite once"
	@echo "  make test-watch            Run the test suite in watch mode"
	@echo "  make typecheck             Run the TypeScript compiler with no output"
	@echo "  make db-up                 Start Postgres + Redis only (docker compose)"
	@echo "  make db-down               Stop Postgres + Redis"
	@echo "  make db-migrate            Run Prisma migrations (dev)"
	@echo "  make db-studio             Open Prisma Studio"
	@echo "  make seed                  Run the database seed script"
	@echo "  make docker-up             Start the full stack (api, worker, postgres, redis)"
	@echo "  make docker-down           Stop the full stack"
	@echo "  make docker-logs           Tail logs for the full stack"
	@echo "  make docker-up-observability   Also start local Prometheus + Grafana (see docs/OBSERVABILITY.md)"
	@echo "  make docker-migrate        Re-run Prisma migrations against the Docker Compose stack"
	@echo "  make load-test             Run scripts/load-test.ts against BASE_URL (default localhost:3000)"

install:
	pnpm install

dev:
	pnpm dev

dev-worker:
	pnpm dev:worker

build:
	pnpm build

lint:
	pnpm lint

format:
	pnpm format

test:
	pnpm test

test-watch:
	pnpm test:watch

typecheck:
	pnpm typecheck

db-up:
	docker compose up -d postgres redis

db-down:
	docker compose stop postgres redis

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
