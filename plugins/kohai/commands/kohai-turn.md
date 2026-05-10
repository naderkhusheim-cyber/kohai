---
description: Rotate Kohai's body around the vertical axis (degrees, 0 = facing camera, 180 = back)
argument-hint: <degrees>  e.g. 0 | 90 | 180 | -90
allowed-tools: ["Bash"]
---

The user invoked `/kohai-turn` with degrees: `$ARGUMENTS`

Parse `$ARGUMENTS` as a number (degrees). If empty, default to 0.

```bash
curl -s -X POST -H "X-Kohai-Token: $(cat ~/.kohai/token)" -H "Content-Type: application/json" \
  -d '{"degrees":$ARGUMENTS}' http://127.0.0.1:17455/control/turn
```

Confirm in one short sentence (e.g. `Kohai turned to 90°.`).
