#!/usr/bin/env bash
# Stop + remove the MVPClaw launchd LaunchAgent.
set -euo pipefail

PLIST_LABEL="com.mvpclaw.daemon"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

if [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm "$PLIST_PATH"
  echo "Removed $PLIST_PATH and stopped the daemon."
else
  echo "No daemon installed at $PLIST_PATH (already uninstalled)."
fi
