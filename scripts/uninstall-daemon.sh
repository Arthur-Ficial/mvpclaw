#!/usr/bin/env bash
# Stop + remove the MVPClaw daemon. Cross-platform: systemd (Linux) / launchd (macOS).
set -euo pipefail

LABEL="com.mvpclaw.daemon"
OS="$(uname -s)"

if [ "$OS" = "Linux" ]; then
  UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  UNIT_PATH="${UNIT_DIR}/${LABEL}.service"
  if [ -f "$UNIT_PATH" ]; then
    systemctl --user disable --now "${LABEL}.service" 2>/dev/null || true
    rm "$UNIT_PATH"
    systemctl --user daemon-reload 2>/dev/null || true
    echo "Removed $UNIT_PATH and stopped the daemon."
  else
    echo "No daemon installed at $UNIT_PATH (already uninstalled)."
  fi
  exit 0
fi

PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
if [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm "$PLIST_PATH"
  echo "Removed $PLIST_PATH and stopped the daemon."
else
  echo "No daemon installed at $PLIST_PATH (already uninstalled)."
fi
