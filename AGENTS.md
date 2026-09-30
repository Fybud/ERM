# Fybud — AI / agent deploy rules

**Copy this file to the root of every new Fybud repo** (or keep it as the default agent context). Follow it for all infrastructure and deploy work.

## Goal

Push to `main` on a Fybud GitHub org repo → GitHub Actions builds/pushes Docker images → **Fybud Deploy** pulls them, allocates free host ports, writes nginx, creates Cloudflare DNS if missing → `https://{tool}.fybud.com` is live.

First time only: paste secrets in Deploy UI and approve. Later pushes redeploy automatically.

## Repo layout

```
MyTool/
  AGENTS.md                 ← this file
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
    networks: [fybud-net]

  api:
    image: fybud/mytool-api:${IMAGE_TAG:-latest}
    ports:
      - "127.0.0.1:${API_HOST_PORT}:4100"
    labels:
      fybud.expose: "true"
      fybud.domain: api.mytool.fybud.com
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

**Do not** put host ports in labels. Deploy:

1. Finds free host ports on the VPS  
2. Writes `WEB_HOST_PORT=…` / `API_HOST_PORT=…` into runtime `.env`  
3. Compose becomes `127.0.0.1:<host>:<container>`  
4. Nginx: `domain → http://127.0.0.1:<host>`  
5. Cloudflare: create A record if missing (VPS IP from Deploy settings)

### Network / DB

- Join external network `fybud-net`.
- Shared Postgres container hostname: `fybud-postgres` (one login; Deploy creates per-app databases).
- Never run a Postgres service inside the tool compose unless explicitly required and private.

## CI

- Workflow builds images → Docker Hub org `fybud` (`fybud/<service>:sha-…` + `:latest`).
- Notify Deploy webhook with tool slug + tag.
- Org secrets: `DOCKERHUB_*`, `DEPLOY_WEBHOOK_*` (public repos on free GitHub org plan).

## Deploy UI

- Paste app secrets once (JWT, OAuth, etc.).
- Do **not** paste host ports or DATABASE_URL if Deploy provisions DB — it injects those.
- Control-plane secrets (Cloudflare, Hub, webhook) live in Deploy’s own `.env` on the VPS, not in tool repos.

## Domain convention

- Web: `{tool}.fybud.com`
- API: `api.{tool}.fybud.com`
- No company/tenant subfolders for now.

## What agents must not do

- Do not invent Coolify/Traefik as the edge unless explicitly asked — Fybud uses **host nginx + dynamic host ports**.
- Do not hardcode host port numbers in compose (no `9000:5173` without `${…_HOST_PORT}`).
- Do not add per-tenant `infra/{customer}` trees.
- Do not commit `.env` secrets.
- Do not expose workers/redis/DB on host ports.

## Checklist for a new tool

1. Add root `AGENTS.md` (this file).  
2. Add `infra/docker-compose.yml` with expose/domain labels + `${*_HOST_PORT}` port lines.  
3. Add Actions build-push → `fybud/*` images + Deploy webhook.  
4. Register tool slug in Fybud Deploy `tools.ts`.  
5. Push `main` → approve once in Deploy UI with env → later pushes auto-deploy.
