#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Port Manager Uninstall ==="
echo ""

cd "$PROJECT_DIR"
npm unlink port-manager 2>/dev/null || true

echo "✓ CLI commands removed"
echo ""
echo "To fully remove, delete the project directory:"
echo "  rm -rf $PROJECT_DIR"
