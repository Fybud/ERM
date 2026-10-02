# `infra/` — Fybud Deploy contract

This folder is what **Fybud Deploy** reads when you push to `main`.

```
your-tool/
  infra/
    README.md              ← this file (keep it)
    docker-compose.yml     ← ONLY file Deploy sparse-clones
  api/ | web/ | …          ← app code as folders (not separate repos)
  .github/workflows/…      ← build & push images to Docker Hub `fybud/*`
```

Pipeline:

`git push main` → GitHub Actions builds `fybud/<service>:…` → Deploy webhook →  
`docker compose pull && up` → Cloudflare DNS (if needed) → host nginx + TLS →  
`https://{tool}.fybud.com`

First deploy: open [deploy.fybud.com](https://deploy.fybud.com), paste secrets, approve.  
Later pushes redeploy automatically — **only if every required env value is already set**.

---

## 1. Create `docker-compose.yml`

One compose file. Public services get a domain; private workers do not.

### Public service (internet)

```yaml
services:
  web:
    image: fybud/mytool-web:${IMAGE_TAG:-latest}
    restart: unless-stopped
    ports:
      - "127.0.0.1:${WEB_HOST_PORT}:5173"   # host port = Deploy; container port = yours
    labels:
      fybud.expose: "true"
      fybud.domain: mytool.fybud.com
      fybud.health: "/"
      fybud.role: web
    networks: [fybud-net]

  api:
    image: fybud/mytool-api:${IMAGE_TAG:-latest}
    restart: unless-stopped
    env_file: [.env]
    environment:
      # See §2 — every variable the process reads must appear here
      PORT: 4100
      JWT_SECRET:
      DATABASE_URL: ${DATABASE_URL:?DATABASE_URL required}
    ports:
      - "127.0.0.1:${API_HOST_PORT}:4100"
    labels:
      fybud.expose: "true"
      fybud.domain: api.mytool.fybud.com
      fybud.health: "/health"
      fybud.role: api
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:4100/health"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks: [fybud-net]
```

### Private service (no domain, no host ports)

```yaml
  worker:
    image: fybud/mytool-api:${IMAGE_TAG:-latest}
    command: ["worker"]
    env_file: [.env]
    environment:
      JWT_SECRET:
      DATABASE_URL: ${DATABASE_URL:?DATABASE_URL required}
    # no ports:
    # no fybud.expose / fybud.domain
    networks: [fybud-net]
```

### Networks

```yaml
networks:
  fybud-net:
    name: fybud-net
    external: true
  # optional: keep frontends / crawlers off the DB network
  # internal:
  #   driver: bridge
```

### Labels (public services only)

| Label | Meaning |
|---|---|
| `fybud.expose: "true"` | Publish + DNS + nginx |
| `fybud.domain` | FQDN, e.g. `mytool.fybud.com` / `api.mytool.fybud.com` |
| `fybud.health` | Path Deploy probes after `up` (`"/health"`, `"/"` , or `"any"`) |
| `fybud.role` | Optional `web` / `api` |

Do **not** hardcode host ports (`9000:5173`). Always `127.0.0.1:${…_HOST_PORT}:<container>`.

---

## 2. Environment variables (required reading)

`env_file: [.env]` loads values, but it does **not** declare which keys exist.  
Every variable a service reads must also appear under `environment:`.  
**How you write the value tells Deploy (and humans) who fills it.**

```yaml
    env_file: [.env]
    environment:
      PORT: 4100                              # fixed in the image — never pasted
      NODE_ENV: production                    # public / safe default — keep filled
      JWT_SECRET:                             # EMPTY → paste in Deploy UI (required)
      SEED_EMAIL: ${SEED_EMAIL:-}             # optional — may stay empty
      TARGET_QUALIFIED: ${TARGET_QUALIFIED:-100}  # optional with default
      DATABASE_URL: ${DATABASE_URL:?DATABASE_URL required}  # Deploy injects — never paste
      API_HOST_PORT:                          # NEVER leave empty like a secret — use ${API_HOST_PORT:?…} in ports only
```

| Compose form | Who fills it | Deploy UI |
|---|---|---|
| `PORT: 4100` | Repo (literal) | Shown pre-filled; usually leave as-is |
| `NODE_ENV: production` | Repo (safe public value) | Shown pre-filled |
| `JWT_SECRET:` (nothing after `:`) | **Human in Deploy → Environment** | Required empty until pasted |
| `${NAME:-}` or `${NAME:-default}` | Human optional / default | Shown; default used if blank |
| `${DATABASE_URL:?…}`, `${*_HOST_PORT}` / ports line | **Deploy** on every deploy | Hidden from paste list |

### Rules

1. **Secrets** (`JWT_SECRET`, OAuth, API keys): declare **empty** (`KEY:`) so Deploy blocks deploy until they are pasted.
2. **Non-secret defaults** you are happy to commit: put the value in compose (`PORT: 4100`).
3. **Optional**: `${KEY:-}` or `${KEY:-default}` — deploy can proceed without a paste.
4. **Never paste** `DATABASE_URL`, `IMAGE_TAG`, or `*_HOST_PORT` — Deploy injects them.
5. Changing compose keys updates the Deploy Environment page: **new keys appear, removed keys are dropped** from stored env.

### Deploy will not start containers until required env is filled

- Empty `KEY:` paste-me keys and tool-spec `requiredEnv` must have non-empty values.
- Approve / Save & Deploy returns `400` with `missing: […]` if anything required is blank.
- The deploy runner re-checks before `docker compose up`. A push to `main` that lost a secret **fails naming the key** instead of booting a broken container.

Fill everything under **Deploy → project → Environment**, then **Save & Deploy** (first time) or rely on auto-redeploy after that.

---

## 3. Minimal checklist for a new tool

1. Add this `infra/` folder (keep this README).
2. Write `infra/docker-compose.yml` with expose/domain/health + every `environment:` key.
3. Add Actions: build → `fybud/<service>` → webhook `https://api.deploy.fybud.com/webhooks/github-actions`.
4. Register the tool slug in Fybud Deploy (Settings → Tool specs) if needed.
5. Push `main` → open Deploy UI → paste required env → approve once.
6. Confirm `https://{tool}.fybud.com` and `https://api.{tool}.fybud.com`.

### Do not

- Coolify / CapRover / Traefik / `captain-definition`
- Per-tenant `infra/{customer}/` trees or hand-written nginx in the repo
- Per-app Postgres containers (use shared `fybud-postgres` on `fybud-net`)
- Commit `.env` secrets
- Expose workers/redis/DB on host ports

---

## 4. Example (API + web)

```yaml
name: mytool

services:
  api:
    image: fybud/mytool-api:${IMAGE_TAG:-latest}
    restart: unless-stopped
    env_file: [.env]
    environment:
      PORT: 4100
      NODE_ENV: production
      JWT_SECRET:                          # paste in Deploy
      GOOGLE_CLIENT_ID:                    # paste in Deploy
      GOOGLE_CLIENT_SECRET:                # paste in Deploy
      DATABASE_URL: ${DATABASE_URL:?DATABASE_URL required}
    ports:
      - "127.0.0.1:${API_HOST_PORT}:4100"
    labels:
      fybud.expose: "true"
      fybud.domain: api.mytool.fybud.com
      fybud.health: "/health"
      fybud.role: api
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:4100/health"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks: [fybud-net]

  web:
    image: fybud/mytool-web:${IMAGE_TAG:-latest}
    restart: unless-stopped
    ports:
      - "127.0.0.1:${WEB_HOST_PORT}:80"
    labels:
      fybud.expose: "true"
      fybud.domain: mytool.fybud.com
      fybud.health: "/"
      fybud.role: web
    depends_on: [api]
    networks: [fybud-net]

networks:
  fybud-net:
    name: fybud-net
    external: true
```

Replace `mytool` with your repo/tool slug. Images must match what CI pushes to Docker Hub org `fybud`.
