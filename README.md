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
inv release --env prod    # asks you to type "prod" before it does anything
```

Today it is also the **only** way to update the live app, because
`budgeter.ddns.net` still points at the old host (`192.168.0.191`). Once that
moves to `.137`, merging to `main` becomes the way real releases happen and
`inv` is purely the emergency exit.

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

- **Run tests**:
  ```bash
  cd backend && uv run manage.py test      # Django
  cd frontend && npm run test              # vitest
  cd frontend && npm run test:e2e          # Playwright (boots both servers itself)
  python3 -m unittest discover -s tests    # deploy config, from the repo root
  ```
