:; # Runs a plugin script with node, finding node when the shell's PATH does not have it. Works in sh (macOS, Linux, Git Bash) and in cmd (Windows).
:; # Used by the hook, which cannot be given a PATH. When node is nowhere, the script is skipped (exit 0) and one line says so,
:; # except the hook (--hook) while a test run is active: it blocks (exit 2), so a missing node does not open the boundary.
:; d=$(cd "$(dirname "$0")" && pwd); script=$1; shift
:; n=$(command -v node 2>/dev/null)
:; if [ -z "$n" ]; then for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node "$HOME/.volta/bin/node" "$HOME/.local/share/fnm/aliases/default/bin/node"; do [ -x "$c" ] && n=$c && break; done; fi
:; if [ -z "$n" ]; then n=$(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1); fi
:; m="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/quality-code/run.active"
:; if [ -z "$n" ]; then case " $* " in *" --hook "*) if [ -f "$m" ]; then echo "quality-code: node was not found and a test run is active, so this is blocked. Install Node.js 18 or later, or delete $m to end the run." >&2; exit 2; fi;; esac; fi
:; if [ -z "$n" ]; then echo "quality-code: node was not found, so $script was skipped. Install Node.js 18 or later." >&2; exit 0; fi
:; exec "$n" "$d/$script" "$@"
@echo off
setlocal enabledelayedexpansion
set "D=%~dp0"
set "S=%~1"
shift
set "ARGS="
:args
if "%~1"=="" goto run
set "ARGS=!ARGS! %1"
shift
goto args
:run
where node >nul 2>nul
if not errorlevel 1 (
  node "%D%%S%" %ARGS%
  exit /b
)
set "NODE_EXE="
for /f "tokens=1,* delims==" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%D%find-node.ps1" 2^>nul ^| findstr /b "NODE_EXE="') do set "NODE_EXE=%%b"
if defined NODE_EXE (
  "!NODE_EXE!" "%D%%S%" %ARGS%
  exit /b
)
set "M=%CLAUDE_PROJECT_DIR%"
if not defined M set "M=%CD%"
if defined ARGS if not "!ARGS:--hook=!"=="!ARGS!" if exist "!M!\.claude\quality-code\run.active" (
  echo quality-code: node was not found and a test run is active, so this is blocked. Install Node.js 18 or later, or delete .claude\quality-code\run.active to end the run. 1>&2
  exit /b 2
)
echo quality-code: node was not found, so %S% was skipped. Install Node.js 18 or later. 1>&2
exit /b 0
