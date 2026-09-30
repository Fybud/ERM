# ERP tenant stacks (fybud Deploy)

Image-only Compose. Shared Postgres = `fybud-postgres` on `fybud-net`. Per-tenant Redis stays in this compose (private network).

| Folder  | Domains                              | DB         |
| ------- | ------------------------------------ | ---------- |
| `demo/` | `erp.fybud.com`, `api.erp.fybud.com` | `erp-demo` |

GitHub Actions: `.github/workflows/build-push.yml` → `fybud/erp-api`, `fybud/erp-web`.
