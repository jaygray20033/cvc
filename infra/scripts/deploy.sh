#!/usr/bin/env bash
# Deploy chain (P1.14): backup -> import images -> migrate -> up -> health.
# Aborts and does NOT start the new version if migrate fails.
set -euo pipefail

TAG="${1:?usage: deploy.sh <tag>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# Load .env (REGISTRY, IMAGE_TAG, secrets) into the environment for compose + scripts.
set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a
export IMAGE_TAG="$TAG"

COMPOSE=(docker compose --env-file "$ROOT/.env" -f "$ROOT/infra/docker-compose.prod.yml")

echo "==> 1/5 Backup database"
bash infra/scripts/db-backup.sh

echo "==> 2/5 Import images (tag $TAG)"
bash infra/scripts/import-images.sh "$TAG"

echo "==> 3/5 Run migrations"
if ! "${COMPOSE[@]}" run --rm migrate; then
  echo "Migration failed; NOT starting the new version." >&2
  exit 1
fi

echo "==> 4/5 Start services"
"${COMPOSE[@]}" up -d

echo "==> 5/5 Health check"
for _ in $(seq 1 30); do
  if curl -fsS http://localhost/health >/dev/null 2>&1 && curl -fsS http://localhost/ >/dev/null 2>&1; then
    echo "==> Healthy. Deploy complete."
    exit 0
  fi
  sleep 3
done

echo "Health check failed after deploy." >&2
exit 1