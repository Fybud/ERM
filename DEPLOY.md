# Fybud Deploy — make a repo shippable

Drop this file at the **repo root**. It is the only file Fybud org automation seeds into new repos.
Follow it to add GitHub Actions + `docker-compose.deploy.yml` so push-to-`main` goes live on
`https://{tool}.fybud.com`.

Pipeline (no Coolify / CapRover / Traefik):

`git push main` → GitHub Actions builds/pushes `fybud/*` images → Fybud Deploy webhook →
downloads only root `docker-compose.deploy.yml` (no repo clone) → free host ports + `.env` →
`docker compose pull && up` → Cloudflare A if missing → host nginx → TLS.

First deploy: paste secrets in Deploy UI + approve. Later pushes auto-redeploy.

---

## 0. Repo layout (required)

```
MyTool/
  DEPLOY.md                         ← this file
  AGENTS.md                         ← agent contract (copy from Fybud workspace)
  docker-compose.deploy.yml         ← ONLY compose Deploy reads (repo root)
  .github/workflows/build-push.yml  ← build → Hub → Deploy webhook
  api/  web/  worker/ …             ← app code as folders, not separate repos
```

| File | Role |
|---|---|
| `docker-compose.deploy.yml` | **At repo root only** (not `.yaml`). Deploy downloads this single file via GitHub API — no git clone. |
| `.github/workflows/build-push.yml` | Builds images, pushes to Docker Hub `fybud/*`, POSTs the Deploy webhook. |
| `DEPLOY.md` | This playbook. |

Do **not** put the deploy compose under `infra/`. Do **not** create `infra/{tenant}/`, hand-written
nginx, or per-app Postgres containers.

---

## 1. Create `docker-compose.deploy.yml` (repo root)

Image-only (CI already built the images). Public services need labels + loopback host ports.
Private workers/redis: no `ports:`, no `fybud.expose` / `fybud.domain`.

```yaml
name: mytool

services:
  api:
    image: fybud/mytool-api:${IMAGE_TAG:-latest}
    restart: unless-stopped
    env_file: [.env]
    environment:
      PORT: 4100                                            # literal — fixed in compose
      JWT_SECRET:                                           # empty — PASTE in Deploy UI
      STRIPE_SECRET_KEY:                                    # empty — PASTE (every secret the app reads)
      DATABASE_URL: ${DATABASE_URL:?DATABASE_URL required}  # Deploy-injected — never paste
    ports:
      - "127.0.0.1:${API_HOST_PORT}:4100"                   # HOST port filled by Deploy
    labels:
      fybud.expose: "true"
      fybud.domain: api.mytool.fybud.com
      fybud.role: api
      fybud.health: "/health"                               # strict — must match healthcheck path
    healthcheck:
      # Prefer Node/Python over wget — many slim images do not ship wget/curl.
      test: ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:4100/health').then(r=>process.exit(r.status<400?0:1)).catch(()=>process.exit(1))\""]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks: [fybud-net]

  web:
    image: fybud/mytool-web:${IMAGE_TAG:-latest}
    restart: unless-stopped
    ports:
      - "127.0.0.1:${WEB_HOST_PORT}:5173"
    labels:
      fybud.expose: "true"
      fybud.domain: mytool.fybud.com
      fybud.role: web
      fybud.health: "any"                                   # SPA / static — process-up only
    networks: [internal]

  worker:                       # private — no ports, no expose labels
    image: fybud/mytool-api:${IMAGE_TAG:-latest}
    restart: unless-stopped
    command: ["worker"]
    env_file: [.env]
    environment:
      # Declare every key the worker reads (empty = paste, or ${:?} = injected).
      JWT_SECRET:
      DATABASE_URL: ${DATABASE_URL:?DATABASE_URL required}
    networks: [fybud-net, internal]

networks:
  fybud-net: { name: fybud-net, external: true }   # only DB-facing services
  internal: { driver: bridge }
```

### Labels (only these)

| Label | When | Meaning |
|---|---|---|
| `fybud.expose: "true"` | Public only | Publish + DNS + nginx |
| `fybud.domain` | Required if expose | FQDN e.g. `cep.fybud.com` |
| `fybud.health` | **Required** if expose | How Deploy probes the host port after `compose up` |
| `fybud.role` | Optional | `web` / `api` — disambiguates domains for env computation |

`fybud.health` values:

| Value | Behaviour | Use when |
|---|---|---|
| `"/health"` (or `"/api/health"`) | **Strict**: host probe requires HTTP &lt; 400 (4xx/5xx → fail → auto-rollback) | Public **API** with a real health route |
| `"any"` | Process-up: any HTTP response on that port counts | **Web/SPA/static** (no health route), or APIs that auth-guard every path |
| *(absent)* | Legacy lenient probe of `/` — Deploy warns you to declare the label | Never for new services |

Rules:

- Every **public API** declares a compose `healthcheck:` **and** a matching strict `fybud.health` path.
- Every **public web** service uses `fybud.health: "any"` unless it has a dedicated health route.
- Deploy’s gate requires containers **running**, then probes `127.0.0.1:<hostPort>` using `fybud.health`. Docker’s own `healthy`/`starting` status is **not** a hard fail (images often lack wget).
- Do not invent health endpoints just for Deploy — use `"any"` instead.

### Env: declare every variable under `environment:`

`env_file: [.env]` loads values but does **not** say which keys must exist. Every variable a
service reads must also appear under `environment:` — **literally all of them**, including every
secret in the tool’s `requiredEnv` (Deploy Settings → Tool specs / `tools.ts`). There is **no
optional** form — only:

| Value in `environment:` | Meaning |
|---|---|
| `PORT: 4100` | **Literal** — value is fixed in the compose file |
| `JWT_SECRET:` (empty) | **Paste** in the Deploy UI — empty value *is* the flag |
| `${VAR:?message}` | **Deploy-injected** (`*_HOST_PORT`, `DATABASE_URL`, URLs) — never pasted |

Do **not** use `${KEY:-}`, `${KEY:-default}`, or an “optionalEnv” list. If the app needs a key,
either give it a literal in compose or leave it empty and paste it in Deploy.

Cross-check before merge:

1. Every `requiredEnv` key appears as `KEY:` (empty) under some service’s `environment:`.
2. Every empty `KEY:` in compose is listed in that tool’s `requiredEnv`.
3. Every Deploy-injected key uses `${KEY:?…}` (never empty, never `${KEY:-}`).

Deploy refuses approve / env-save without every empty key (`missing[]`). Host ports and
`DATABASE_URL` are injected — do not paste them.

### Ports / network / DB

- Ports: always `127.0.0.1:${*_HOST_PORT}:<container>` — never hardcode host ports.
- Shared Postgres hostname: `fybud-postgres` on external `fybud-net`. Deploy **creates the
  database if it does not exist** before `docker compose up`, then injects `DATABASE_URL`.
- Shared Postgres login (superuser / admin): **username `postgres`, password `postgres`**.
  Example: `postgresql://postgres:postgres@fybud-postgres:5432/<db_name>`. Apps still get a
  Deploy-injected `DATABASE_URL` — do not paste the URL yourself unless you are wiring local
  tools against that shared instance.
- **Database name is not required to match the tool slug.** Set `DB_NAME=my_app_db` in the
  Deploy Environment (or leave it unset to default to the tool / `tool-slug` credential).
  **Multiple projects may share one database** (e.g. CEP + CEP-Admin both use `cep`). Deploy
  reuses the existing role password so sharing does not break the other project. CEP-Admin
  defaults to `DB_NAME=cep`. See the **Databases** sidebar for mappings (one DB can list
  several projects).
- Before compose, Deploy also checks for conflicting `container_name:` values and domains.
  Fix the compose / env and redeploy — you will get a toast with the conflict.
- Disk writers need a named volume (containers are recreated every deploy).
- Domains: web `{tool}.fybud.com`, API `api.{tool}.fybud.com`.

---

## 2. Create `.github/workflows/build-push.yml`

Builds each service image, pushes `fybud/<service>:sha-…` + `:latest`, then notifies Deploy.

```yaml
name: build-push

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: build-push-${{ github.ref }}
  cancel-in-progress: true

env:
  DOCKERHUB_ORG: fybud
  TOOL: mytool          # Deploy tool slug

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.tag.outputs.tag }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - name: api
            image: mytool-api
            context: api
            dockerfile: api/Dockerfile
          - name: web
            image: mytool-web
            context: web
            dockerfile: web/Dockerfile
    steps:
      - uses: actions/checkout@v4

      - name: Compute image tag
        id: tag
        run: echo "tag=sha-${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - uses: docker/build-push-action@v6
        with:
          context: ${{ matrix.context }}
          file: ${{ matrix.dockerfile }}
          push: true
          tags: |
            ${{ env.DOCKERHUB_ORG }}/${{ matrix.image }}:${{ steps.tag.outputs.tag }}
            ${{ env.DOCKERHUB_ORG }}/${{ matrix.image }}:latest
          cache-from: type=gha,scope=${{ matrix.image }}
          cache-to: type=gha,scope=${{ matrix.image }},mode=max

  notify:
    needs: build
    if: success()
    runs-on: ubuntu-latest
    steps:
      - name: Notify fybud Deploy
        env:
          DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK_URL }}
          DEPLOY_WEBHOOK_SECRET: ${{ secrets.DEPLOY_WEBHOOK_SECRET }}
          COMMIT_SHA: ${{ github.sha }}
          COMMIT_MSG: ${{ github.event.head_commit.message || github.event_name }}
          COMMIT_AUTHOR: ${{ github.event.head_commit.author.name || github.actor }}
          COMMITTED_AT: ${{ github.event.head_commit.timestamp || github.event.repository.updated_at }}
          REPO: ${{ github.repository }}
        run: |
          if [ -z "$DEPLOY_WEBHOOK_URL" ]; then
            echo "DEPLOY_WEBHOOK_URL not set — skipping notify"
            exit 0
          fi
          TAG="sha-${COMMIT_SHA::7}"
          PUSHED_AT="${COMMITTED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
          payload=$(jq -n \
            --arg tool "$TOOL" \
            --arg tag "$TAG" \
            --arg repo "$REPO" \
            --arg commit "$COMMIT_SHA" \
            --arg commitMessage "$COMMIT_MSG" \
            --arg commitAuthor "$COMMIT_AUTHOR" \
            --arg pushedAt "$PUSHED_AT" \
            --arg api "${DOCKERHUB_ORG}/mytool-api:${TAG}" \
            --arg web "${DOCKERHUB_ORG}/mytool-web:${TAG}" \
            '{tool:$tool,tag:$tag,repo:$repo,commit:$commit,commitMessage:$commitMessage,commitAuthor:$commitAuthor,pushedAt:$pushedAt,images:{api:$api,web:$web}}')
          echo "$payload"
          curl -sf -X POST "$DEPLOY_WEBHOOK_URL" \
            -H "Content-Type: application/json" \
            -H "X-Deploy-Secret: $DEPLOY_WEBHOOK_SECRET" \
            -d "$payload"
```

### Org secrets (GitHub → org → Secrets)

| Secret | Value |
|---|---|
| `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | Docker Hub org `fybud` |
| `DEPLOY_WEBHOOK_URL` | `https://api.deploy.fybud.com/webhooks/github-actions` |
| `DEPLOY_WEBHOOK_SECRET` | Same secret as Deploy VPS `.env` |

Adjust the matrix `context` / `dockerfile` / image names to match your folders. Keep
`concurrency` so two pushes never race the VPS.

---

## 3. First deploy in the UI

1. Register the tool slug in Deploy (`tools.ts` or **Settings → Tool specs**).
2. Push `main` (Actions builds + webhook).
3. In Deploy UI: paste required env (JWT, OAuth, …) — not host ports / `DATABASE_URL`.
4. Approve once. Later pushes redeploy automatically.
5. Confirm `https://{tool}.fybud.com` and `https://api.{tool}.fybud.com`.

---

## 4. Checklist

- [ ] `DEPLOY.md` at repo root (this file)
- [ ] `docker-compose.deploy.yml` at repo root with `fybud.expose` / `fybud.domain` / `fybud.health`
- [ ] Every pasteable / injected variable declared under `environment:`
- [ ] Public ports are `127.0.0.1:${*_HOST_PORT}:…`
- [ ] Private services have no ports and no expose labels
- [ ] `.github/workflows/build-push.yml` with Hub push + Deploy webhook + `concurrency`
- [ ] Tool registered in Deploy; secrets pasted; first approve done

Verify from the Deploy repo: `node scripts/verify-all.mjs` and `node scripts/smoke-robust.mjs`.
