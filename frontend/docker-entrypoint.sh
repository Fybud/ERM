#!/bin/sh
set -e

# Deploy injects VITE_API_BASE_URL (https://api.erm.fybud.com) into the container
# env; bake it into /env.js so the SPA never falls back to same-origin /api.
ENV_JS="${ENV_JS_PATH:-/usr/share/nginx/html/env.js}"

{
  printf 'window.__ENV__ = window.__ENV__ || {};\n'
  env | grep '^VITE_' | while IFS= read -r line; do
    key=${line%%=*}
    val=${line#*=}
    esc=$(printf '%s' "$val" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf 'window.__ENV__["%s"] = "%s";\n' "$key" "$esc"
  done
} > "$ENV_JS"

exec nginx -g "daemon off;"
