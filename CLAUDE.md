# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Budgeter is a full-stack budgeting app. It is deployed by CI (GitHub Actions) to 192.168.0.137 on every merge to `main`; the live instance still runs on 192.168.0.191 until the data is migrated. See README.md for the deploy flow. It tracks shared and individual budgets for multiple users with temporal versioning of budget values.

## Commands

```bash
# Install dependencies (backend + frontend)
cd backend && uv sync
cd frontend && npm install

# Run locally (two terminals)
cd backend && uv run manage.py runserver 0.0.0.0:8000
cd frontend && npm run dev

# Database
cd backend && uv run manage.py migrate
cd backend && uv run manage.py makemigrations

# Tests
cd backend && uv run manage.py test
cd backend && uv run manage.py test budget.tests.TestClassName.test_method

# Frontend linting
cd frontend && npm run lint

# Deploy — NORMAL PATH: merge a PR to main. CI builds, deploys demo,
# health-checks it, then promotes to prod after a human approval.
#
# The invoke tasks below are the FALLBACK for when the pipeline is broken.
# They bypass tests, health checks and rollback. deploy/release/stop ask for
# a typed confirmation (--yes skips it; CI skips it automatically).
inv build                # Build Docker image (SHA + latest)
inv push                 # Push to the registry
inv deploy --env prod    # Deploy to prod  (confirmation required)
inv release --env prod   # Build + push + deploy (confirmation required)
inv logs --env prod      # Tail logs
inv status --env prod    # Show containers
```

All `uv run manage.py` commands must be run from the `backend/` directory.

## Architecture

**Backend**: Django 5 + django-ninja (type-annotated REST API) + django-allauth (Google OAuth)
**Frontend**: React 19 + Vite 7 + Tailwind CSS 4 (single-file SPA in `App.jsx`)
**Database**: SQLite (volume-mounted at `/data/db.sqlite3`)
**Deployment**: Docker multi-stage build → Nginx serves static + proxies to Gunicorn
**Secrets**: envars.yml with Openbao vault (`http://192.168.0.191:8200`)

### Request Flow (Production)
```
Client → Nginx Proxy Manager (HA) → Docker container on 191
  Nginx (:80) inside container:
    /api/*, /accounts/* → Gunicorn (unix socket) → Django
    /static/*           → /app/staticfiles/
    /*                   → React SPA (/app/static_root/index.html)
```

### Deploy Flow
```
merge to main
  1. PR checks (Django, vitest+lint+build, docker build, Playwright e2e) — all required
  2. deploy-demo   on a self-hosted runner ON 192.168.0.137:
       build -> push to localhost:5000 -> write .env + compose.yml -> up -d
       -> poll /api/health (200 + status:ok + matching sha)
       -> on failure, redeploy the previous IMAGE_TAG and fail the run
  3. deploy-prod   same host, PROMOTES demo's exact image (no rebuild),
       gated on the `prod` environment: waits for a reviewer to approve
```
Fallback (`inv release --env prod`) still does build -> push -> SSH -> up -d
against 192.168.0.191, with no health check or rollback.

`deploy_config.py` holds the host/registry/stack-dir values so they can be
unit-tested and overridden by `BUDGETER_*` env vars in CI; `tasks.py` consumes it.

Remote directory structure:
- Demo: `/opt/stacks/budgeter-demo/`
- Prod: `/opt/stacks/budgeter/`

### Key Backend Files
- `budget/models.py` — Three models: `Month`, `BudgetItem`, `BudgetItemVersion`
- `budget/api.py` — All REST endpoints under `/api/`
- `budgeter/adapters.py` — OAuth email whitelist
- `budgeter/settings.py` — Django config. Reads plain env vars; it does NOT load
  envars itself. The Dockerfile's `CMD envars -f /app/envars.yml exec -e $APP_ENV`
  decrypts them at container start and injects them into PID 1. So
  `docker exec <c> env` will NOT show them — read `/proc/1/environ` instead.
- `envars.yml` — Vault-backed secrets per environment

### Data Model Concepts
- **BudgetItem**: A budget category (expense/income) with an owner (shared/keith/tild)
- **BudgetItemVersion**: Temporal versioning — tracks value changes per month via `effective_from_month`. Supports rollover and one-off items
- **Calculation types**: `fixed` (monthly amount) or `weekly_count` (value × weekly occurrences in that month)
- **Soft deletion**: Items expire via `last_payment_month` rather than being deleted

### Frontend
`App.jsx` (~390 lines) holds routing and top-level state; components live in `src/components/`, with `src/hooks/`, `src/services/api.js` and `src/utils/` alongside. It's a PWA with a service worker that excludes `/api/`, `/accounts/`, `/admin/`, `/static/` routes.

### Auth
Google OAuth with a hardcoded email whitelist in `adapters.py`. In local dev, authentication is bypassed/simplified. CSRF tokens are required for state-changing API calls.

### Environment Variables (managed by envars.yml + Openbao vault)
- `APP_ENV` — environment name (demo/prod/local/test), set via docker-compose .env
- `DJANGO_SECRET_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADDON_DOMAIN`
- `HA_ACCESS_TOKEN`, `HA_API_URL`, `HA_NOTIFY_ENTITY`
- `DEBUG` — defaults to false; true for local/test
