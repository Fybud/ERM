# Fybud — AI / agent deploy rules

**Copy this file to the root of every new Fybud repo** (or keep it as the default agent context). Follow it for all infrastructure and deploy work.

## Goal

Push to `main` on a Fybud GitHub org repo → GitHub Actions builds/pushes Docker images → **Fybud Deploy** pulls them, allocates free host ports, writes nginx, creates Cloudflare DNS if missing → `https://{tool}.fybud.com` is live.

First time only: paste secrets in Deploy UI and approve. Later pushes redeploy automatically. This is Fybud's **own control plane** — no Coolify, no CapRover, no Traefik.

## Repo layout

```
MyTool/
  AGENTS.md                 ← this file
  README.md                 ← the step-by-step agent README (same folder)
  .github/workflows/build-push.yml
  infra/
    docker-compose.yml      ← ONLY compose Deploy reads (sparse clone)
  <app code folders>        ← api/, web/, worker/ etc. — NOT separate GitHub repos
```

- One GitHub repo = one product (frontend + backend + workers as **folders**).
- Do **not** create `infra/demo/`, `infra/{company}/`, or hand-written nginx configs.
- Private sidecars (workers, redis, classifiers): own services in the same compose **or** a separate compose project with **no** public labels.

## `infra/docker-compose.yml` contract

### Public service (needs domain)

```yaml
services:
  web:
    image: fybud/mytool-web:${IMAGE_TAG:-latest}
    ports:
      - "127.0.0.1:${WEB_HOST_PORT}:5173"   # container port fixed; HOST port filled by Deploy
    labels:
      fybud.expose: "true"
      fybud.domain: mytool.fybud.com
      fybud.health: "/"                      # SPA entry point: probe requires HTTP < 400
    networks: [fybud-net]

  api:
    image: fybud/mytool-api:${IMAGE_TAG:-latest}
    ports:
      - "127.0.0.1:${API_HOST_PORT}:4100"
    labels:
      fybud.expose: "true"
      fybud.domain: api.mytool.fybud.com
      fybud.health: "/health"                 # must match the compose healthcheck path
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:4100/health"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks: [fybud-net]
```

### Private service (no internet)

```yaml
  worker:
    image: fybud/mytool-api:${IMAGE_TAG:-latest}
    command: ["worker"]
    # NO ports:
    # NO fybud.expose / fybud.domain
    networks: [fybud-net]
```

### Labels (only these)

| Label | When | Meaning |
|---|---|---|
| `fybud.expose: "true"` | Public only | Publish + DNS + nginx |
| `fybud.domain` | Required if expose | FQDN e.g. `cep.fybud.com` |
| `fybud.health` | Recommended | Path Deploy probes from the host after `docker compose up` |
| `fybud.role` | Optional | `web` / `api` — disambiguates which domain is which for env computation |

`fybud.health` values:

| Value | Behaviour |
|---|---|
| `"/health"` | **Strict**: the gate requires HTTP < 400 at that path (4xx/5xx fails the deploy → auto-rollback) |
| `"any"` | Process-up only: any HTTP response counts (use when the service has no health route) |
| *(absent)* | Legacy lenient probe of `/` — Deploy logs a warning telling you to declare the label |

The label must agree with the service's compose `healthcheck:` path, and every
public API service must declare both. A typo in the label fails the deploy loudly
instead of silently probing the wrong path.
### Env: declare every variable in the compose file

`env_file: [.env]` tells Docker to load keys, but it does **not** say *which* keys must exist — a
forgotten variable then only shows up as a container crash loop. So every variable a service reads
must **also** be declared under `environment:`, with a required reference:

```yaml
    env_file: [.env]
    environment:
      PORT: 4100
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET required}   # no value → the deploy fails by name
```

- `${VAR:?message}` makes `docker compose config` / `up` fail with **that message** when the value
  is absent, so the run log names the key instead of the app dying later with a stack trace.
- Keep `env_file` for the values; `environment:` is the **manifest of required keys**.
- Deploy-injected values (`WEB_HOST_PORT`, `API_HOST_PORT`, `DATABASE_URL`) are declared the same
  way but are never pasted into the UI.
- `verify-all.mjs` fails any service that has `env_file` without `environment:`.

**Do not** put host ports in labels. Deploy:

1. Finds free host ports on the VPS
2. Writes `WEB_HOST_PORT=…` / `API_HOST_PORT=…` into runtime `.env`
3. Compose becomes `127.0.0.1:<host>:<container>`
4. Nginx: `domain → http://127.0.0.1:<host>`
5. Cloudflare: create A record if missing (VPS IP from Deploy settings)

### Network / DB

- Shared Postgres container hostname: `fybud-postgres`. Deploy provisions a **per-app role and
  database** (`cep` role owns the `cep` database) and injects `DATABASE_URL`; the shared
  superuser login is never handed to an app.
- Never run a Postgres service inside the tool compose unless explicitly required and private.
- **Network isolation:** only Postgres-facing services join external `fybud-net`. Every other service
  (web frontends, admin UIs, crawlers) stays on a project-local network:
  ```yaml
  networks:
    fybud-net: { name: fybud-net, external: true }
    internal: { driver: bridge }
  ```
- **Healthchecks:** every API service gets a compose `healthcheck:` against its health endpoint
  (`/health`, `/api/health`, …) **and** a matching `fybud.health` label. Deploy's gate blocks on
  unhealthy containers, then probes `127.0.0.1:<hostPort><fybud.health>` from the host.
- **State:** any service that writes to disk (uploads, media) must declare a named volume —
  containers are recreated on every deploy and local files are wiped.

## CI

- Workflow builds images → Docker Hub org `fybud` (`fybud/<service>:sha-…` + `:latest`).
- Notify Deploy webhook with tool slug + tag.
- Cancel superseded builds so two pushes never race the VPS:
  ```yaml
  concurrency:
    group: build-push-${{ github.ref }}
    cancel-in-progress: true
  ```
- Org secrets: `DOCKERHUB_*`, `DEPLOY_WEBHOOK_URL=https://api.deploy.fybud.com/webhooks/github-actions`, `DEPLOY_WEBHOOK_SECRET` (public repos on free GitHub org plan).

## Deploy UI

- Paste app secrets once (JWT, OAuth, etc.) — the onboarding checklist on the project page shows
  exactly which required variables are still missing.
- Required/optional env per tool live in **Deploy → Settings → Tool specs** (stored in the Deploy
  database). Approving or saving env is rejected with a `missing[]` list when a required var is absent.
- Live deploy output streams into the project's Logs tab
  (`/api/projects/:tool/runs/:id/stream`, Server-Sent Events).
- Do **not** paste host ports or DATABASE_URL if Deploy provisions DB — it injects those.
- Control-plane secrets (Cloudflare, Hub, webhook) live in Deploy’s own `.env` on the VPS, not in tool repos.

## Domain convention

- Web: `{tool}.fybud.com`
- API: `api.{tool}.fybud.com`
- No company/tenant subfolders for now.

## What agents must not do

- Do not invent Coolify / CapRover / Traefik as the edge unless explicitly asked — Fybud uses its **own control plane (host nginx + dynamic host ports + Cloudflare DNS + certbot)**.
- Do not add a `captain-definition*`, a PaaS manifest, or hand-written nginx — there is no third-party PaaS in this stack.
- Do not hardcode host port numbers in compose (no `9000:5173` without `${…_HOST_PORT}`).
- Do not add per-tenant `infra/{customer}` trees.
- Do not commit `.env` secrets.
- Do not expose workers/redis/DB on host ports.

## Checklist for a new tool

1. Add root `AGENTS.md` (this file) and `README.md` (the step-by-step agent README).
2. Add `infra/docker-compose.yml` with expose/domain/health labels + `${*_HOST_PORT}` port lines, and declare every variable under `environment:`.
3. Add Actions build-push → `fybud/*` images + Deploy webhook (`concurrency` set).
4. Register tool slug in Fybud Deploy `tools.ts` (or edit its spec in Settings → Tool specs).
5. Push `main` → approve once in Deploy UI with env → later pushes auto-deploy.
6. Verify from the Deploy repo: `node scripts/verify-all.mjs` (contract) and
   `node scripts/smoke-robust.mjs` (end-to-end).

