#!/usr/bin/env bash
# Install the MVPClaw daemon as a launchd LaunchAgent (per-user).
#
# Run once after `pnpm build`. It generates a plist with secrets injected
# from your `.env`, loads it, and reports the PID. Re-running is safe — it
# unloads + reloads.
#
# Uninstall: ./scripts/uninstall-daemon.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_LABEL="com.mvpclaw.daemon"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
TEMPLATE="${REPO_ROOT}/scripts/com.mvpclaw.daemon.plist"
ENV_FILE="${REPO_ROOT}/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Copy .env.example to .env and fill secrets first." >&2
  exit 1
fi

# Source the .env to pull TELEGRAM_BOT_TOKEN / OPENROUTER_API_KEY / etc.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "${REPO_ROOT}/data"

# Build a plist with secrets injected. We append to EnvironmentVariables
# rather than relying on `source .env` at runtime, because launchd does NOT
# read the user's shell rc files when starting a LaunchAgent.
python3 - <<EOF
import plistlib, os
with open("$TEMPLATE","rb") as f:
    p = plistlib.load(f)
env = p.get("EnvironmentVariables", {})
for k in ("TELEGRAM_BOT_TOKEN","OPENROUTER_API_KEY","ANTHROPIC_API_KEY","GEMINI_API_KEY"):
    v = os.environ.get(k, "")
    if v:
        env[k] = v
p["EnvironmentVariables"] = env
with open("$PLIST_PATH","wb") as f:
    plistlib.dump(p, f)
print(f"wrote {len(env)} env vars to $PLIST_PATH")
EOF

# Unload if already present, then load.
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load -w "$PLIST_PATH"

echo ""
echo "MVPClaw daemon installed."
echo "  plist:  $PLIST_PATH"
echo "  stdout: ${REPO_ROOT}/data/daemon.stdout.log"
echo "  stderr: ${REPO_ROOT}/data/daemon.stderr.log"
echo ""
echo "  Status:  launchctl list | grep $PLIST_LABEL"
echo "  Stop:    launchctl unload $PLIST_PATH"
echo "  Restart: launchctl unload $PLIST_PATH && launchctl load -w $PLIST_PATH"
echo ""
sleep 2
launchctl list | grep "$PLIST_LABEL" || echo "(daemon not yet visible — check log files)"
