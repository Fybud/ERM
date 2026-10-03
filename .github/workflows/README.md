# ERM CI — build / push / notify

Triggers: push to `main`, or manual `workflow_dispatch`.

Secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `DEPLOY_WEBHOOK_URL`, `DEPLOY_WEBHOOK_SECRET`.

Images: `fybud/erm-api`, `fybud/erm-web`.
