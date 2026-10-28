#!/usr/bin/env bash
# Installs the local Quality Code MCP server for a developer: a virtual environment next to this file,
# then a check, then the config to paste into your MCP client. Needs Python 3.10+ and Node.js 18+.
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-python3}"
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || { echo "Python 3.10 or later is needed (set PYTHON=/path/to/python3)." >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js 18 or later is needed: https://nodejs.org" >&2; exit 1; }
"$PY" -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -e .
.venv/bin/quality-code-mcp --check
echo
echo "Paste this into your MCP client:"
echo
.venv/bin/quality-code-mcp --print-config
