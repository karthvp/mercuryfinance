#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "Installing workspace dependencies from the lockfile..."
npm ci --no-audit --no-fund

echo "Installing Mercury dependencies from the lockfile..."
npm --prefix Mercury ci --no-audit --no-fund

if [[ -f artifacts/mockup-sandbox/package-lock.json ]]; then
  echo "Installing design preview dependencies from the lockfile..."
  npm --prefix artifacts/mockup-sandbox ci --no-audit --no-fund
fi

echo "Checking Mercury server syntax..."
node --check Mercury/index.js

echo "Post-merge setup complete."
