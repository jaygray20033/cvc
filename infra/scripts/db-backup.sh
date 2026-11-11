#!/usr/bin/env bash
# Backup MySQL before migrate (P1.14). Writes backups/cvc-<stamp>.sql.gz.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE=(docker compose --env-file "$ROOT/.env" -f "$ROOT/infra/docker-compose.prod.yml")
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$ROOT/backups/cvc-$STAMP.sql.gz"
mkdir -p "$ROOT/backups"

echo "==> Dumping database to $OUT"
"${COMPOSE[@]}" exec -T mysql \
  sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction "$MYSQL_DATABASE"' \
  | gzip > "$OUT"

echo "==> Backup written: $OUT"