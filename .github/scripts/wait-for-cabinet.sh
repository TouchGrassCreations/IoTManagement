#!/usr/bin/env bash
# Waits for the container to answer, rather than sleeping a guessed interval.
set -euo pipefail

url="${1:-http://localhost:3000/}"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "$url"; then exit 0; fi
  sleep 2
done

echo "no answer from $url after 120s" >&2
exit 1
