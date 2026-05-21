#!/usr/bin/env bash
# Install the MVPClaw daemon as a supervised service.
#
# Cross-platform: Linux (the primary deploy target) uses a systemd USER service;
# macOS uses a launchd LaunchAgent. Run once after `pnpm build`. Re-running is
# safe — it reinstalls + restarts.
#
# Uninstall: ./scripts/uninstall-daemon.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.mvpclaw.daemon"
ENV_FILE="${REPO_ROOT}/.env"
NODE_BIN="$(command -v node)"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Copy .env.example to .env and fill secrets first." >&2
  exit 1
fi
mkdir -p "${REPO_ROOT}/data"

OS="$(uname -s)"

if [ "$OS" = "Linux" ]; then
  # ── systemd --user service ──────────────────────────────────────────
  UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  UNIT_PATH="${UNIT_DIR}/${LABEL}.service"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_PATH" <<EOF
[Unit]
Description=MVPClaw daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_ROOT}
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
ExecStart=${NODE_BIN} ${REPO_ROOT}/dist/cli/main.js start
Restart=always
RestartSec=5
StandardOutput=append:${REPO_ROOT}/data/daemon.stdout.log
StandardError=append:${REPO_ROOT}/data/daemon.stderr.log

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now "${LABEL}.service"
  echo ""
  echo "MVPClaw daemon installed (systemd --user)."
  echo "  unit:    $UNIT_PATH"
  echo "  Status:  systemctl --user status ${LABEL}"
  echo "  Stop:    mvpclaw kill   (or: systemctl --user stop ${LABEL})"
  echo "  Restart: mvpclaw revive (or: systemctl --user restart ${LABEL})"
  echo ""
  echo "  For a headless server (run without an active login):"
  echo "    sudo loginctl enable-linger \$USER"
  systemctl --user --no-pager status "${LABEL}" 2>/dev/null | head -5 || true
  exit 0
fi

# ── macOS launchd LaunchAgent ─────────────────────────────────────────
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
TEMPLATE="${REPO_ROOT}/scripts/com.mvpclaw.daemon.plist"
mkdir -p "$HOME/Library/LaunchAgents"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Build a plist with the real clone path, detected node, + secrets injected.
python3 - <<EOF
import plistlib, os

repo_root = "$REPO_ROOT"
node_bin = "$NODE_BIN"

with open("$TEMPLATE","rb") as f:
    raw = f.read().decode("utf-8").replace("__REPO_ROOT__", repo_root)
p = plistlib.loads(raw.encode("utf-8"))

args = p.get("ProgramArguments", [])
if args and args[0] != node_bin and node_bin:
    args[0] = node_bin
    p["ProgramArguments"] = args

env = p.get("EnvironmentVariables", {})
for k in ("TELEGRAM_BOT_TOKEN","OPENROUTER_API_KEY","ANTHROPIC_API_KEY","GEMINI_API_KEY"):
    v = os.environ.get(k, "")
    if v:
        env[k] = v
p["EnvironmentVariables"] = env
with open("$PLIST_PATH","wb") as f:
    plistlib.dump(p, f)
print(f"wrote plist for {repo_root} with {len(env)} env vars to $PLIST_PATH")
EOF

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load -w "$PLIST_PATH"

echo ""
echo "MVPClaw daemon installed (launchd)."
echo "  plist:   $PLIST_PATH"
echo "  Stop:    mvpclaw kill   (or: launchctl unload $PLIST_PATH)"
echo "  Restart: mvpclaw revive"
sleep 2
launchctl list | grep "$LABEL" || echo "(daemon not yet visible — check log files)"
