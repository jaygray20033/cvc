#!/bin/sh
# Create the S3 buckets only if missing, so re-running on every deploy stays clean.
set -e
MASTER=seaweedfs:9333

existing=$(weed shell -master="$MASTER" <<'EOF'
s3.bucket.list
EOF
)

for bucket in cvc-public cvc-private; do
  if echo "$existing" | grep -q "$bucket"; then
    echo "bucket $bucket already exists"
  else
    weed shell -master="$MASTER" <<EOF
s3.bucket.create -name $bucket
EOF
    echo "created bucket $bucket"
  fi
done