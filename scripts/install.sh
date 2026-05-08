#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Port Manager Setup ==="
echo ""

if ! command -v node &> /dev/null; then
  echo "❌ Node.js is not installed. Please install Node.js 18+ first."
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//')
echo "✓ Node.js $NODE_VER detected"

echo ""
echo "Installing dependencies..."
cd "$PROJECT_DIR"
npm install --production

echo ""
echo "Linking CLI commands..."
npm link 2>/dev/null || echo "⚠ npm link failed — you may need sudo or use npx"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Usage:"
echo "  port-manager       Open the GUI"
echo "  port-manager list  List ports in terminal"
echo "  npm start          Open the GUI (from project directory)"
