# Nicho Capital — atalhos. No Windows sem make, use: powershell -File scripts/nicho.ps1 <alvo>
.PHONY: help setup dev test lint db-up db-down migrate pipeline demo

help:
	@echo "setup    instala dependências (Python via uv, Node via npm)"
	@echo "dev      sobe o site em modo desenvolvimento (http://localhost:3000)"
	@echo "test     roda os testes do pipeline e do site"
	@echo "lint     ruff, mypy, eslint e typecheck"
	@echo "db-up    sobe Postgres + pgvector local (Docker)"
	@echo "migrate  aplica as migrations e sincroniza o universo"
	@echo "pipeline coleta preços e macro e regrava o snapshot demo/"
	@echo "demo     build de produção em modo demo (sem chaves e sem internet)"

setup:
	cd pipeline && uv sync --python 3.12
	cd web && npm ci

dev:
	cd web && npm run dev

test:
	cd pipeline && uv run pytest
	cd web && npm test

lint:
	cd pipeline && uv run ruff check . && uv run ruff format --check . && uv run mypy
	cd web && npm run lint && npm run typecheck

db-up:
	docker compose up -d db

db-down:
	docker compose down

migrate:
	cd pipeline && uv run nicho migrate && uv run nicho sync-universo

pipeline:
	cd pipeline && uv run nicho rodar && uv run nicho export-demo

demo:
	cd web && DEMO_MODE=true npm run build && DEMO_MODE=true npm run start
