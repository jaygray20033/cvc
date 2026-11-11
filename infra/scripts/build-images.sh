#!/usr/bin/env bash
# Build cvc-api and cvc-web production images (P1.13). Tag = git SHA or semver.
set -euo pipefail

TAG="${1:-$(git rev-parse --short HEAD)}"
REGISTRY="${REGISTRY:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "==> Building cvc-api:${TAG} and cvc-web:${TAG}"
docker build -f apps/api/Dockerfile --target prod -t "${REGISTRY}cvc-api:${TAG}" .
docker build -f apps/web/Dockerfile --target prod -t "${REGISTRY}cvc-web:${TAG}" .

echo "==> Built images:"
docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep 'cvc-' || true