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

launch_kohai() {
  # Prefer the installed app bundle.
  if [ -d "/Applications/Kohai.app" ]; then
    open -ga "/Applications/Kohai.app" 2>/dev/null
    return
  fi
  # Fallback: launch from plugin source directory if node_modules is present.
  local root="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
  if [ -f "$root/main.js" ] && [ -d "$root/node_modules/electron" ]; then
    (cd "$root" && nohup ./node_modules/.bin/electron . >/tmp/kohai.log 2>&1 &) </dev/null >/dev/null 2>&1 & disown
  fi
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
