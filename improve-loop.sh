#!/usr/bin/env bash
set -euo pipefail

CYCLES=${1:-3}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Starting $CYCLES improvement cycle(s)..."
echo "Project: $SCRIPT_DIR"
echo ""

for i in $(seq 1 "$CYCLES"); do
  echo "===== Cycle $i of $CYCLES ====="
  echo ""

  if bun run "$SCRIPT_DIR/app/improve.ts" --single-cycle; then
    echo ""
    echo "===== Cycle $i complete (success) ====="
  else
    echo ""
    echo "===== Cycle $i complete (with errors) ====="
  fi

  echo ""
done

echo "All $CYCLES cycle(s) complete. See improvements.log for details."
