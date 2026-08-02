# Budgeter

## Deploying

**Normal path — merge a PR to `main`.** That's it. CI does the rest:

1. Your PR runs the tests (Django, vitest, lint, a Docker build, and the
   Playwright end-to-end suite). All five must pass before it can merge.
2. On merge, the app deploys to **demo** automatically, on `192.168.0.137`.
   CI then polls `/api/health` and, if the release is unhealthy, **rolls back
   to the previous image by itself** and marks the run red.
3. **prod waits for a human.** It only deploys after demo is green *and*
   someone approves it in the Actions tab. Keith and Tild can both approve.

Watch it at https://github.com/kthhrv/budgeter/actions.

### Fallback: deploying by hand

`inv` still deploys directly over SSH, bypassing all of the above — no tests,
no health check, no rollback, no record of what was deployed. Use it when the
pipeline is broken or GitHub is unreachable.

```bash
inv release --env prod    # build + push + deploy (asks you to type "prod" first)
inv build                 # build the Docker image (SHA + latest)
inv push                  # push it to the registry
inv deploy --env prod     # deploy an already-pushed image (confirmation required)
inv logs --env prod       # tail the logs
inv status --env prod     # show the containers
inv stop --env prod       # stop the stack (confirmation required)
```

`deploy`, `release` and `stop` ask for a typed confirmation. `--yes` skips it,
and it never prompts in CI. With no terminal and no `--yes` it **refuses**
rather than proceeding, so a cron job or script can't deploy prod silently.

Both demo and prod now run on `192.168.0.137`, and `budgeter.ddns.net` (via the
Nginx Proxy Manager on `192.168.0.207`) points there — so merging to `main` is
how real releases ship, and `inv` is purely the emergency exit.

### Logs and status

Both stacks run on `192.168.0.137`; the containers are named `budgeter` (prod)
and `budgeter-demo` (demo). Straight to the host:

```bash
ssh root@192.168.0.137 'docker logs -f --tail=50 budgeter'        # prod
ssh root@192.168.0.137 'docker logs -f --tail=50 budgeter-demo'   # demo
ssh root@192.168.0.137 'docker ps'                                # what's running
```

`inv logs` / `inv status` work too, but `inv` talks to a **single** host that
still defaults to the old `.191`, so point it at `.137` (the `--env` flag
selects the stack, not the host — both stacks live on the same host):

```bash
BUDGETER_PROD_HOST=192.168.0.137 inv logs   --env demo
BUDGETER_PROD_HOST=192.168.0.137 inv status --env prod
```

The app's *decrypted* secrets don't show up in `docker exec <c> env` — they're
injected into PID 1 only. Read `/proc/1/environ` in the container instead (see
CLAUDE.md's Gotchas).

## Building and running locally

### build

```
docker build -t budgeter -f Dockerfile .
```

### run

```
docker run -p8000:80 -v /tmp/data:/data -it budgeter
```

## Local Development

**Prerequisites:**
- `uv` (for Python dependency management)
- `npm` (for Frontend dependency management)

**Commands:**

- **Install dependencies**:
  ```bash
  cd backend && uv sync
  cd frontend && npm install
  ```

- **Run backend**:
  ```bash
  cd backend && uv run manage.py runserver 0.0.0.0:8000
  ```

- **Run frontend**:
  ```bash
  cd frontend && npm run dev
  ```

- **Database** (all `manage.py` commands run from `backend/`):
  ```bash
  cd backend && uv run manage.py migrate
  cd backend && uv run manage.py makemigrations
  ```

- **Lint the frontend**:
  ```bash
  cd frontend && npm run lint
  ```

- **Run tests**:
  ```bash
  cd backend && uv run manage.py test      # Django
  cd frontend && npm run test              # vitest
  cd frontend && npm run test:e2e          # Playwright (boots both servers itself)
  python3 -m unittest discover -s tests    # deploy config, from the repo root
  ```

  All four run in CI and all four must pass before a PR can merge.

  To run a single Django test — the backend suite is split across
  `tests.py`, `tests_health.py`, `tests_tabs.py` and `tests_weekly.py`:
  ```bash
  cd backend && uv run manage.py test budget.tests_tabs.TestClassName.test_method
  ```
