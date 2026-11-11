#!/bin/sh
# Generate runtime config.js from env at container start (one image for staging/production).
set -e
cat > /usr/share/nginx/html/config.js <<EOF
window.__CVC_CONFIG__ = {
  apiUrl: "${API_URL:-}",
  wsUrl: "${WS_URL:-}"
};
EOF