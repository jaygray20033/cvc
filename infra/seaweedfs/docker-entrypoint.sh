#!/bin/sh
# Generate the SeaweedFS S3 identity config from env, then start the S3 gateway.
# Same image runs dev + production; only S3_ACCESS_KEY/S3_SECRET_KEY differ.
set -e
: "${S3_ACCESS_KEY:?set S3_ACCESS_KEY}"
: "${S3_SECRET_KEY:?set S3_SECRET_KEY}"

cat > /tmp/s3.json <<EOF
{
  "identities": [
    {
      "name": "cvc",
      "credentials": [{ "accessKey": "${S3_ACCESS_KEY}", "secretKey": "${S3_SECRET_KEY}" }],
      "actions": ["Admin", "Read", "Write"]
    }
  ]
}
EOF

exec weed server -dir=/data -s3 -s3.port=9000 -s3.config=/tmp/s3.json "$@"