#!/bin/bash
# Kohai hook dispatcher — forwards Claude Code hook events to the local Kohai app.
# Receives JSON via stdin, fires-and-forgets a POST to 127.0.0.1:17455.

EVENT_TYPE="$1"
TOKEN_FILE="$HOME/.kohai/token"

[ -z "$EVENT_TYPE" ] && exit 0
[ ! -f "$TOKEN_FILE" ] && exit 0
# Bail out on recursive calls (Kohai is itself shelling out to `claude -p`).
[ "$KOHAI_INSIDE" = "1" ] && exit 0

TOKEN=$(cat "$TOKEN_FILE")
PAYLOAD=$(cat)

curl -s -X POST \
  -H "X-Kohai-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  --max-time 1 \
  --data "$PAYLOAD" \
  "http://127.0.0.1:17455/event/$EVENT_TYPE" >/dev/null 2>&1 &

exit 0
