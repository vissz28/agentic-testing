# When `node` is not found

Every plugin script runs with `node`. If a script call fails with `node is not recognized`, `command not found: node` or `node: not found`, do not stop and do not tell the user to install Node yet: Node is often installed, but not on the PATH of the shell the agent started (a per-user install, a version manager, or a shell that was opened before Node was installed).

## Windows

1. Run the finder, exactly as written (one command, nothing added):

   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/bin/find-node.ps1"
   ```

   It looks, in order, in this shell's PATH; the Machine and User PATH of the registry; `C:\Program Files\nodejs`, `%LOCALAPPDATA%\Programs\nodejs`, nvm, fnm, Volta and Scoop of this user; then every profile in `C:\Users`. It prints `NODE_EXE=`, `NODE_VERSION=`, `NODE_DIR=`, `NODE_PROFILE=` and `USE_IT=`.
2. Exit 0: say in one line where it found Node (`Node <version> found in <NODE_DIR>`; when `NODE_PROFILE` is another user's name, say whose profile it is). Put its folder first on the PATH for this shell with the `USE_IT` line, then run the failed script again. For the rest of the session run the plugin's scripts the same way; never edit the user's system PATH or settings.
3. Exit 1: `NODE_TOO_OLD` means Node is there but older than 18; `NODE_NOT_FOUND` means it is not installed. Say which, and ask the user to install Node.js 18 or later from https://nodejs.org (for all users: choose the installer's "for all users" option, so it lands in `C:\Program Files\nodejs`), then open a new terminal. Stop.

## macOS and Linux

Look for `node` in `/usr/local/bin`, `/opt/homebrew/bin`, `~/.nvm/versions/node/*/bin`, `~/.volta/bin`, `~/.fnm` and `~/.local/share/fnm`. Found: put its folder first on the PATH for this shell and run the script again. Not found: ask the user to install Node.js 18 or later, then stop.

Never type a password, never install Node yourself, and never run the installer.
