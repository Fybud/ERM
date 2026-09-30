# ERP tenant stacks (FiberAI Deploy)

Image-only Compose. Shared Postgres = `fiberai-postgres` on `fiberai-net`. Per-tenant Redis stays in this compose (private network).

| Folder | Domains | DB |
|---|---|---|
| `demo/` | `erp.fybud.com`, `api.erp.fybud.com` | `erp-demo` |

GitHub Actions: `.github/workflows/build-push.yml` → `fiberai/erp-api`, `fiberai/erp-web`.
