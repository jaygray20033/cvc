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
APP_IMAGES=("${REGISTRY}cvc-api:${TAG}" "${REGISTRY}cvc-web:${TAG}")

# App images are ours -> must already be built (run build-images.sh first).
for img in "${APP_IMAGES[@]}"; do
  docker image inspect "$img" >/dev/null 2>&1 || { echo "Missing $img; run build-images.sh first." >&2; exit 1; }
done
# Infra images are public -> pull any that are not local yet.
for img in "${INFRA_IMAGES[@]}"; do
  docker image inspect "$img" >/dev/null 2>&1 || docker pull "$img"
done

echo "==> Saving images to ${OUT}"
docker save "${APP_IMAGES[@]}" "${INFRA_IMAGES[@]}" | gzip > "$OUT"
sha256sum "$OUT" > "${OUT}.sha256"

echo "==> Wrote ${OUT} ($(du -h "$OUT" | cut -f1)) and ${OUT}.sha256"