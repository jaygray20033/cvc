#!/usr/bin/env bash
# Save app + infra images to one compressed tarball + SHA-256 for offline transfer (P1.13).
# A blank server needs only Docker + this tarball + compose + .env to run the whole system.
set -euo pipefail

TAG="${1:?usage: export-images.sh <tag>}"
REGISTRY="${REGISTRY:-}"
OUT="cvc-images-${TAG}.tar.gz"

# Infra image tags must match infra/docker-compose.prod.yml.
INFRA_IMAGES=(
  "nginx:1.27-alpine"
  "mysql:8.4"
  "redis:7-alpine"
  "chrislusf/seaweedfs:4.53"
)

echo "==> Saving images to ${OUT}"
docker save "${REGISTRY}cvc-api:${TAG}" "${REGISTRY}cvc-web:${TAG}" "${INFRA_IMAGES[@]}" | gzip > "$OUT"
sha256sum "$OUT" > "${OUT}.sha256"

echo "==> Wrote ${OUT} ($(du -h "$OUT" | cut -f1)) and ${OUT}.sha256"