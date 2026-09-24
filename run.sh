#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ -n "${TESLA_ENV:-}" && -f "${TESLA_ENV}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${TESLA_ENV}"
  set +a
elif [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

exec npx --no-install tsx src/index.ts "$@"
