---
description: Make Kohai say something in her speech bubble (and speak it aloud if VOICEVOX is up)
argument-hint: <text>
allowed-tools: ["Bash"]
---

The user invoked `/kohai-say` with text: `$ARGUMENTS`

POST the text to Kohai's local server. Run:

```bash
curl -s -X POST -H "X-Kohai-Token: $(cat ~/.kohai/token)" -H "Content-Type: application/json" \
  -d "$(printf '{"text":%s}' "$(printf '%s' "$ARGUMENTS" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" \
  http://127.0.0.1:17455/control/say
```

If `python3` isn't available, fall back to a simpler quoted form (escape inner double-quotes with `\"`):

```bash
curl -s -X POST -H "X-Kohai-Token: $(cat ~/.kohai/token)" -H "Content-Type: application/json" \
  -d '{"text":"<ESCAPED_TEXT>"}' http://127.0.0.1:17455/control/say
```

Then confirm in one short sentence (e.g. `Kohai said: "<text>"`).
