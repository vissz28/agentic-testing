#!/usr/bin/env bash
# Refresh the two plugins from the warehouse repos. The repos stay the source of truth for the
# skills and commands; this copies them in and rewrites the few paths that must point into the
# plugin instead of the project.
#
#   scripts/sync-from-repos.sh [FRONTEND_REPO] [BACKEND_REPO]
#
# Defaults: ../warehouse-frontend at origin/agentic-testing-fe, ../warehouse-backend at
# origin/agentic-testing-be. Override the refs with FE_REF / BE_REF.
#
# What stays in the repos (not copied): the harness scripts under .claude/harness/, the ticket
# standard, the boundary guard and the per-ticket records. The skills call those from the project,
# so the project must be on a branch that has them.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FE_REPO="${1:-$ROOT/../warehouse-frontend}"
BE_REPO="${2:-$ROOT/../warehouse-backend}"
FE_REF="${FE_REF:-origin/agentic-testing-fe}"
BE_REF="${BE_REF:-origin/agentic-testing-be}"

copy() { # copy <repo> <ref> <plugin dir> <paths...>
  local repo="$1" ref="$2" dest="$3"; shift 3
  rm -rf "$dest/skills" "$dest/commands"
  git -C "$repo" archive "$ref" "$@" | tar -x -C "$dest" --strip-components=1
}

git -C "$FE_REPO" fetch -q origin || true
git -C "$BE_REPO" fetch -q origin || true

copy "$FE_REPO" "$FE_REF" "$ROOT/plugins/warehouse-frontend" .claude/skills/spec-frontend .claude/commands
copy "$BE_REPO" "$BE_REF" "$ROOT/plugins/warehouse-backend" .claude/skills/spec .claude/skills/check .claude/commands

# The backend /spec command only points at the spec skill, and inside a plugin a skill and a
# command with the same name collide (/warehouse-backend:spec). The skill is the entry point.
rm -f "$ROOT/plugins/warehouse-backend/commands/spec.md"

# Skills and commands now live in the plugin, not in the project's .claude/ folder.
find "$ROOT/plugins" -name '*.md' -print0 | xargs -0 sed -i.bak \
  -e 's#\.claude/skills/#${CLAUDE_PLUGIN_ROOT}/skills/#g' \
  -e 's#\.claude/commands/spec\.md#${CLAUDE_PLUGIN_ROOT}/commands/spec.md#g'
find "$ROOT/plugins" -name '*.md.bak' -delete

echo "synced: frontend from $FE_REF ($(git -C "$FE_REPO" rev-parse --short "$FE_REF")), backend from $BE_REF ($(git -C "$BE_REPO" rev-parse --short "$BE_REF"))"
