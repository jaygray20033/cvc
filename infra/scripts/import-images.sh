#!/usr/bin/env bash
# Verify SHA-256 then load images from the tarball (P1.13).
set -euo pipefail

TAG="${1:?usage: import-images.sh <tag>}"
FILE="cvc-images-${TAG}.tar.gz"

if [ ! -f "$FILE" ]; then
  echo "Missing $FILE" >&2
  exit 1
fi

echo "==> Verifying checksum"
sha256sum -c "${FILE}.sha256"

echo "==> Loading images"
gunzip -c "$FILE" | docker load
echo "==> Done"