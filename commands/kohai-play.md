---
description: Play a VRM animation clip from assets/vrm-animations/ (e.g. wave, celebrate, sit)
argument-hint: <name> [loop]
allowed-tools: ["Bash"]
---

The user invoked `/kohai-play` with: `$ARGUMENTS`

Parse `$ARGUMENTS`. The first word is the animation name, optional `loop` to loop it.

```bash
NAME="$(echo "$ARGUMENTS" | awk '{print $1}')"
LOOP="$(echo "$ARGUMENTS" | grep -q loop && echo true || echo false)"
curl -s -X POST -H "X-Kohai-Token: $(cat ~/.kohai/token)" -H "Content-Type: application/json" \
  -d "{\"name\":\"$NAME\",\"loop\":$LOOP}" \
  http://127.0.0.1:17455/control/play_animation
```

Confirm in one short sentence (e.g. `Playing wave.`).

Available animations depend on what `.vrma` files are dropped at `assets/vrm-animations/<name>.vrma`. Common names: `idle`, `wave`, `celebrate`, `thinking`, `walking`, `bow`, `sit`, `type`.
