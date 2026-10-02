# ERM — Ecommerce Resource Manager

Unified commerce operations for vendors: manage orders and inventory across Amazon, Flipkart, and Shopify from one place.

## Stack
- **Frontend**: React (Vite) + React Router — `frontend/`
- **Backend**: TypeScript Express modular monolith — `backend/`
- **Database**: PostgreSQL 16
- **Cache / events**: Redis 7

## Domains

| Service | Production (Fybud Deploy) | Local Docker |
| --- | --- | --- |
| Frontend | https://erp.fybud.com | http://localhost:3000 |
| Backend | https://api.erp.fybud.com | http://localhost:4000 |

Deploy: root [`docker-compose.deploy.yml`](./docker-compose.deploy.yml) + [`DEPLOY.md`](./DEPLOY.md).
Rules: [`AGENTS.md`](./AGENTS.md).

## Quick start (local Docker)

```bash
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend: http://localhost:4000/health
- Login password: `ADMIN_PASSWORD` in `.env` (default `12345`)

## Production (Fybud Deploy)

Production does **not** use local `docker compose` or hand-written nginx. Push to `main`:

1. `.github/workflows/build-push.yml` builds `fybud/erp-api` + `fybud/erp-web` and notifies Deploy.
2. Deploy sparse-clones root `docker-compose.deploy.yml`, allocates host ports, writes nginx + DNS.
3. Paste once in Deploy UI: `ADMIN_PASSWORD`, `ENCRYPTION_KEY` (not host ports / `DATABASE_URL`).
4. Approve → live at `https://erp.fybud.com` / `https://api.erp.fybud.com`.

## Local development (without Docker frontend/backend)

```bash
docker compose up db redis -d
cd backend && cp .env.example .env && npm install && npm run dev
cd frontend && npm install && npm run dev
```

Vite proxies `/api` to `http://localhost:4000`.

## Channel architecture

```
Frontend → Backend API → Core Services → ChannelManager → ChannelAdapter
                                              ├── AmazonAdapter
                                              ├── FlipkartAdapter
                                              └── ShopifyAdapter
```

Credentials are entered in Settings, encrypted, and stored only in `channels_config`.

## Pages
- Dashboard — order pipeline, low stock, channel health
- Orders — multi-channel board (Awaiting Packaging → Delivered / RTO)
- Inventory — master catalog with images; quantity syncs to connected channels
- Settings — connect/disconnect channels with only the credentials each platform requires
