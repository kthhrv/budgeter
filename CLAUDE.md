# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Budgeter is a full-stack budgeting app deployed via Dockge on 192.168.0.191. It tracks shared and individual budgets for multiple users with temporal versioning of budget values.

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

# Deploy (via invoke)
inv build                # Build Docker image (SHA + latest)
inv push                 # Push to 192.168.0.191:5000 registry
inv deploy               # Deploy to demo (default)
inv deploy --env prod    # Deploy to prod
inv release              # Build + push + deploy (demo)
inv release --env prod   # Full release to prod
inv logs                 # Tail logs (demo)
inv logs --env prod      # Tail logs (prod)
inv status               # Show containers
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
inv release --env demo
  1. docker build (tagged with git SHA + latest)
  2. docker push to 192.168.0.191:5000
  3. SSH to 191: write .env, sync compose.yml, pull, up -d
```

Remote directory structure:
- Demo: `/opt/stacks/budgeter-demo/`
- Prod: `/opt/stacks/budgeter/`

### Key Backend Files
- `budget/models.py` — Three models: `Month`, `BudgetItem`, `BudgetItemVersion`
- `budget/api.py` — All REST endpoints under `/api/`
- `budgeter/adapters.py` — OAuth email whitelist
- `budgeter/settings.py` — Django config (loads envars at startup)
- `envars.yml` — Vault-backed secrets per environment

### Data Model Concepts
- **BudgetItem**: A budget category (expense/income) with an owner (shared/keith/tild)
- **BudgetItemVersion**: Temporal versioning — tracks value changes per month via `effective_from_month`. Supports rollover and one-off items
- **Calculation types**: `fixed` (monthly amount) or `weekly_count` (value × weekly occurrences in that month)
- **Soft deletion**: Items expire via `last_payment_month` rather than being deleted

### Frontend
The frontend is a monolithic `App.jsx` containing all components, state management, and an `apiService` object for API calls. It's a PWA with a service worker that excludes `/api/`, `/accounts/`, `/admin/`, `/static/` routes.

### Auth
Google OAuth with a hardcoded email whitelist in `adapters.py`. In local dev, authentication is bypassed/simplified. CSRF tokens are required for state-changing API calls.

### Environment Variables (managed by envars.yml + Openbao vault)
- `APP_ENV` — environment name (demo/prod/local/test), set via docker-compose .env
- `DJANGO_SECRET_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADDON_DOMAIN`
- `HA_ACCESS_TOKEN`, `HA_API_URL`, `HA_NOTIFY_ENTITY`
- `DEBUG` — defaults to false; true for local/test
