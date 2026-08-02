# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

**README.md owns the commands, the deploy flow and the local setup.** Read it
first. This file deliberately does not repeat them — it covers what the code
does not say about itself, and the traps where the obvious move is the wrong
one.

## Project Overview

Budgeter is a full-stack budgeting app for two people. It tracks shared and
individual budgets with temporal versioning of budget values, plus a shared
"tabs" ledger and childcare cost calculators.

**This repo is public.** No secrets in the tree — everything sensitive is
vault-backed in `envars.yml`. `.gitignore` blocks `*.sqlite3` and `.env*` for
this reason; do not weaken it, and do not commit a database dump.

**Where it runs.** Both demo and prod run on `192.168.0.137`, deployed by CI on
merge to `main` (prod only after a human approves it — see README).
`budgeter.ddns.net` points there via the Nginx Proxy Manager on `192.168.0.207`.
To reach a running container, `ssh root@192.168.0.137` then `docker logs` /
`docker exec` on `budgeter` (prod) or `budgeter-demo` (demo). `.191` is being
decommissioned.

## Gotchas

Places where the obvious action is the wrong one.

- **`docker exec <c> env` will not show the app's secrets.** The Dockerfile's
  `CMD envars -f /app/envars.yml exec -e $APP_ENV` decrypts them at container
  start and injects them into PID 1 only. Read `/proc/1/environ` instead.
  `settings.py` reads plain env vars; it does not load `envars` itself.
- **All `uv run manage.py` commands must run from `backend/`.**
- **The OAuth email whitelist is in `settings.py` (`ALLOWED_GOOGLE_EMAILS`), not
  in `adapters.py`.** `adapters.py` only reads the setting — grepping for
  "adapter" sends you to the wrong file to edit the list.
- **Add and rotate secrets with `envars add`**, not the raw `bao`/`vault` CLI.
- **Never add `pull_request_target` to `.github/workflows/ci.yml`**, and never
  give that workflow secrets. The `deploy-*` jobs run on a self-hosted homelab
  runner; the `if:` guards are *not* the security control. Read the comment
  block above `deploy-demo` before touching anything in that file.
- **`build.json` and `config.demo.yaml` are dead.** They are leftovers from the
  old Home Assistant addon packaging; no other tracked file references them and
  neither the Dockerfile nor CI reads them. Ignore them; don't wire them back in.

## Architecture

**Backend**: Django 5 + django-ninja (type-annotated REST API) + django-allauth (Google OAuth)
**Frontend**: React 19 + Vite 7 + Tailwind CSS 4
**Database**: SQLite (volume-mounted at `/data/db.sqlite3`)
**Deployment**: Docker multi-stage build → Nginx serves static + proxies to Gunicorn
**Secrets**: `envars.yml` with Openbao vault (`http://192.168.0.137:8200`)

### Request flow (production)
```
Client → Nginx Proxy Manager (HA) → Docker container
  Nginx (:80) inside container:
    /api/*, /accounts/* → Gunicorn (unix socket) → Django
    /static/*           → /app/staticfiles/
    /*                  → React SPA (/app/static_root/index.html)
```

### Deploy
See README.md for the pipeline. Three things worth knowing before you edit it:

- **This setup is not bespoke.** The `deploy_config.py` + `tasks.py` +
  self-hosted-runner-on-`.137` shape follows the homelab CI/CD onboarding
  standard, which is also where the required repo settings (including the fork
  pull request approval policy that `ci.yml`'s security block depends on) are
  specified. Read it before changing the pipeline's shape, and prefer keeping
  in step with it over local improvements:
  `kthhrv/homelab` → `docs/onboarding-an-app-to-cicd.md`.
  *That repo is private — the link is unreachable for anyone outside it.*
- `deploy_config.py` holds the host/registry/stack-dir values as stdlib-only
  functions so they can be unit-tested and overridden by `BUDGETER_*` env vars
  in CI. `tasks.py` consumes it. Put config logic there, not in `tasks.py` —
  `tasks.py` imports `invoke`, which is not a project dependency, so anything
  living there cannot be tested. Its docstrings explain each override.
- Remote stack directories: demo `/opt/stacks/budgeter-demo/`, prod
  `/opt/stacks/budgeter/`.

## Domain model

Six models in `budget/models.py`. Field-level meaning is in each field's
`help_text` — read that rather than guessing. What follows is the part the
field definitions don't tell you.

**`Month`** — an explicit row per budget month, with `start_date`/`end_date`.
Months are rows, not values derived from a date, and both `BudgetItemVersion`
foreign keys point at them — so month logic means joins, not date arithmetic.

**`BudgetItem`** — a budget category. The interesting axes:
- `item_type`: `expense`, `income`, or `savings`.
- `owner`: `shared`, `keith`, or `tild`.
- `expense_pot`: `bills` or `groceries` — which pot the expense is funded from.
- `calculation_type`: `fixed` (a monthly amount) or `weekly_count` (value ×
  the number of times `weekly_payment_day` falls in that month).
- `is_extra` — funded, but treated as a buffer line: excluded from the joint
  Expenses total and reflected in Remaining instead.
- `is_auto_extra` — an Extra whose value *rebalances itself* each month to hold
  joint Remaining at the stored target.
- `is_tab_repayment` — this item's monthly value is also emitted as an
  automatic repayment on the tabs ledger.
- `childcare_link` — binds the item to a frontend calculator
  (`ellis_nursery`, `gaspard_care`, `gaspard_holiday`) for the
  "Sync from Nursery" action.

**`BudgetItemVersion`** — temporal versioning, and the concept most likely to
trip you up. A value change is a *new version*, not an update in place.

It carries **two** `Month` foreign keys, and conflating them is the classic
mistake:
- `month` — the month this row was recorded *for*. Unique per item
  (`unique_together = ('budget_item', 'month')`).
- `effective_from_month` — the month the value starts applying from. This is
  what drives rollover.

Resolution lives in `_effective_version_for_month` (`api.py:156`) and goes in
this order:
1. **An exact `month` match wins outright** — including a one-off.
2. Otherwise, fall back to the most recent version that is *not* a one-off and
   whose `effective_from_month` is at or before the target month.

So values roll forward until superseded, `is_one_off` opts a version out of
that roll-forward, and an explicit entry for a month always beats the rolled-
forward value. Versions must be prefetched ordered by
`-effective_from_month__start_date` for that function to be correct — it
breaks on the first match and trusts the ordering.

**Soft deletion**: items are never deleted. They expire by setting
`last_payment_month`; anything after that month ignores them. Code that walks
months must honour this — see the filtering in `api.py`'s tabs endpoint.

**`TabItem` / `TabRepayment`** — a shared-purchase ledger: who paid, the total,
and how much the other person owes (defaults to 50%, overridable). Repayments
are of two kinds, and `GET /api/tabs/` merges them: manual `TabRepayment` rows,
and *synthetic* ones computed from every `BudgetItem` with
`is_tab_repayment=True`. The synthetic ones are only surfaced for months that
have already started — future months must not show a repayment yet.

**`NurserySettings`** — a per-user `JSONField` blob (one-to-one with `User`)
holding the nursery calculator's inputs. Schema-less by design; the shape is
defined by the frontend calculators, not the model.

**Childcare calculators live in the frontend**, not the backend:
`src/utils/nurseryCalc.js` (Ellis's nursery invoice model, funded hours, TFC
caps) and `src/utils/childcareCalc.js` (Gaspard's school breakfast/after-school
and holiday clubs). Both carry hardcoded rates, term dates and bank holidays
with source comments — update them there, and note that Gaspard transitions
from the nursery model to the childcare model at `GASPARD_CARE_START_DEFAULT`.

## Frontend

`App.jsx` holds routing and top-level state. Components live in
`src/components/`, with `src/hooks/`, `src/services/api.js` and `src/utils/`
alongside. Unit tests (vitest) sit in `src/test/`; Playwright specs live in
`frontend/e2e/` and are excluded from the vitest run by `vite.config.js`.

It's a PWA. The service worker's `navigateFallbackDenylist` excludes `/api`,
`/accounts`, `/admin` and `/static` so those reach the backend instead of being
answered by the SPA shell — if you add a new server-rendered route, add it
there too.

## Auth

Google OAuth via django-allauth, restricted to the `ALLOWED_GOOGLE_EMAILS`
whitelist in `settings.py`.

The API is `NinjaAPI(auth=django_auth)`, so **every endpoint requires an
authenticated session — including in local dev.** The one exception is
`/api/health`, which is explicitly `auth=None` because the deploy pipeline
polls it unauthenticated; leave it that way or every deploy fails. `DEBUG` does
not relax authentication — it only affects the secret-key fallback,
`ALLOWED_HOSTS`, cookie flags and http vs https.

State-changing calls need a CSRF token; `services/api.js` sends `X-CSRFToken`
on every mutation. The Playwright suite gets a session via
`backend/e2e_seed_session.py`, driven from `frontend/e2e/global-setup.js`.

## Environment variables

Managed by `envars.yml` (vault-backed, per environment: demo/local/prod/test).

Consumed by the app:
- `APP_ENV` — environment name, set via the compose `.env` file
- `DJANGO_SECRET_KEY` — required unless `DEBUG` or running tests
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — read by the `setup_oauth`
  management command at container start
- `ADDON_DOMAIN` — falls back to the hostname in `run.sh`
- `DEBUG` — defaults to false; true for local/test

`HA_ACCESS_TOKEN`, `HA_API_URL` and `HA_NOTIFY_ENTITY` are still defined in
`envars.yml`, but no tracked file outside `envars.yml` reads them. Treat them
as unused unless you are deliberately reviving a Home Assistant integration.
