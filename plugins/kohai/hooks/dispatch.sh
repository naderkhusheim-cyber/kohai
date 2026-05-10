#!/bin/bash
# Kohai hook dispatcher — forwards Claude Code lifecycle events to the local
# Kohai companion app on 127.0.0.1:17455. Auto-launches Kohai on SessionStart
# if she isn't already running.

EVENT_TYPE="$1"
TOKEN_FILE="$HOME/.kohai/token"

[ -z "$EVENT_TYPE" ] && exit 0
# Bail out on recursive calls (Kohai is itself shelling out to `claude -p`).
[ "$KOHAI_INSIDE" = "1" ] && exit 0

is_kohai_up() {
  curl -s -m 0.4 "http://127.0.0.1:17455/health" >/dev/null 2>&1
}

# URL Kohai sends users to when no installation is detected.
# Replace this with your live Gumroad/store URL before shipping.
KOHAI_STORE_URL="${KOHAI_STORE_URL:-https://gumroad.com/l/kohai}"

open_url() {
  local url="$1"
  if command -v open >/dev/null 2>&1; then            # macOS
    open "$url" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then      # Linux / WSL
    xdg-open "$url" >/dev/null 2>&1 &
  elif command -v powershell.exe >/dev/null 2>&1; then # Windows (Git Bash/WSL)
    powershell.exe -NoProfile -Command "Start-Process '$url'" >/dev/null 2>&1 &
  elif command -v cmd >/dev/null 2>&1; then           # Windows (Git Bash)
    cmd //c start "" "$url" >/dev/null 2>&1 &
  elif command -v explorer >/dev/null 2>&1; then      # Windows (raw)
    explorer "$url" >/dev/null 2>&1 &
  fi
}

launch_kohai() {
  # 1. macOS — installed app bundle.
  if [ -d "/Applications/Kohai.app" ]; then
    open -ga "/Applications/Kohai.app" 2>/dev/null
    return 0
  fi
  # 2. Windows — installed via Squirrel/electron-builder NSIS.
  if [ -n "$LOCALAPPDATA" ] && [ -f "$LOCALAPPDATA/Programs/Kohai/Kohai.exe" ]; then
    "$LOCALAPPDATA/Programs/Kohai/Kohai.exe" >/dev/null 2>&1 &
    return 0
  fi
  if [ -n "$ProgramFiles" ] && [ -f "$ProgramFiles/Kohai/Kohai.exe" ]; then
    "$ProgramFiles/Kohai/Kohai.exe" >/dev/null 2>&1 &
    return 0
  fi
  # 3. Linux — installed via AppImage / system bin.
  if command -v kohai >/dev/null 2>&1; then
    nohup kohai >/dev/null 2>&1 &
    return 0
  fi
  # 4. Dev fallback: launch from a checked-out repo with node_modules.
  local root="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
  if [ -f "$root/main.js" ] && [ -d "$root/node_modules/electron" ]; then
    (cd "$root" && nohup ./node_modules/.bin/electron . >/tmp/kohai.log 2>&1 &) </dev/null >/dev/null 2>&1 & disown
    return 0
  fi
  # 5. Nothing installed. Send the user to the store (one prompt per
  #    machine — we drop a marker so we don't keep popping a browser).
  local marker_dir="${KOHAI_HOME:-$HOME/.kohai}"
  local marker="$marker_dir/.store-prompted"
  if [ ! -f "$marker" ]; then
    mkdir -p "$marker_dir" 2>/dev/null
    touch "$marker" 2>/dev/null
    open_url "$KOHAI_STORE_URL"
  fi
  return 1
}

# On session start, bring Kohai up if she's offline. Briefly wait so the
# SessionStart event itself isn't lost.
if [ "$EVENT_TYPE" = "SessionStart" ] && ! is_kohai_up; then
  launch_kohai
  for _ in 1 2 3 4 5 6; do
    is_kohai_up && break
    sleep 0.5
  done
fi

[ ! -f "$TOKEN_FILE" ] && exit 0
TOKEN=$(cat "$TOKEN_FILE")
PAYLOAD=$(cat)

curl -s -X POST \
  -H "X-Kohai-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  --max-time 1 \
  --data "$PAYLOAD" \
  "http://127.0.0.1:17455/event/$EVENT_TYPE" >/dev/null 2>&1 &

exit 0
