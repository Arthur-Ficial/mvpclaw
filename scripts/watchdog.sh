#!/bin/bash
# MVPClaw watchdog — runs every 300s under com.mvpclaw.watchdog.plist.
#
# Behavior:
#   1. If the killswitch sentinel exists at ~/.mvpclaw/killswitch → log + exit 0.
#      The user has explicitly asked us to STAY DOWN.
#   2. Else if `pgrep -f "main\.js start"` finds the daemon → log + exit 0.
#   3. Else (daemon is down AND no killswitch) → `launchctl kickstart -k` it.
#
# `kickstart -k` is the canonical "restart" for a launchd job: it kills any
# existing instance and respawns immediately. If the job is currently
# unloaded (e.g. someone ran `launchctl bootout` but didn't drop the sentinel),
# the `kickstart` will fail; we then attempt a `bootstrap` as a fallback.
#
# All output goes to data/watchdog.log via launchd's StandardOutPath.

set -u

KILLSWITCH="${HOME}/.mvpclaw/killswitch"
LABEL="com.mvpclaw.daemon"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OS="$(uname -s)"

# NOTE: on Linux the systemd unit uses `Restart=always`, so it self-supervises
# and `mvpclaw kill` (systemctl stop) keeps it down — this watchdog is mainly a
# macOS belt-and-suspenders (launchd KeepAlive can resurrect a bootouted job).

if [[ -f "${KILLSWITCH}" ]]; then
  echo "${TS} watchdog: killswitch present at ${KILLSWITCH} — staying down"
  # On Linux, ensure systemd respects the sentinel by stopping the unit.
  [[ "$OS" == "Linux" ]] && systemctl --user stop "${LABEL}.service" 2>/dev/null || true
  exit 0
fi

if pgrep -f "main\.js start" >/dev/null 2>&1; then
  echo "${TS} watchdog: daemon alive"
  exit 0
fi

echo "${TS} watchdog: daemon DOWN — restart"
if [[ "$OS" == "Linux" ]]; then
  systemctl --user restart "${LABEL}.service" 2>&1 || true
  exit 0
fi

# macOS: kickstart (kills + respawns); fall back to bootstrap if unloaded.
if /bin/launchctl kickstart -k "gui/${UID_NUM}/${LABEL}" 2>&1; then
  echo "${TS} watchdog: kickstart issued"
  exit 0
fi
echo "${TS} watchdog: kickstart failed (job likely unloaded) — bootstrap"
/bin/launchctl bootstrap "gui/${UID_NUM}" "${PLIST}" 2>&1 || true
exit 0
