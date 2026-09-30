# ERP CI — build / push / notify

Triggers: push to `main`, or manual `workflow_dispatch`.

Secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `DEPLOY_WEBHOOK_URL`, `DEPLOY_WEBHOOK_SECRET`.

Images: `fiberai/erp-api`, `fiberai/erp-web`.
