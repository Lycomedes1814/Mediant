#!/usr/bin/env bash
set -euo pipefail

source .env

npm run build

scp dist/index.html \
  "${DEPLOY_HOST}:${DEPLOY_PATH}/"
scp dist/assets/* \
  "${DEPLOY_HOST}:${DEPLOY_PATH}/assets/"
