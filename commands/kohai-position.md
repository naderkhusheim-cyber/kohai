---
description: Move Kohai to a corner — bottom-right, bottom-left, top-right, top-left, or center
argument-hint: bottom-right | bottom-left | top-right | top-left | center
allowed-tools: ["Bash"]
---

The user invoked `/kohai-position` with position: `$ARGUMENTS`

Valid positions: `bottom-right`, `bottom-left`, `top-right`, `top-left`, `center`. If the argument isn't one of these, default to `bottom-right` and note the correction.

```bash
curl -s -X POST -H "X-Kohai-Token: $(cat ~/.kohai/token)" -H "Content-Type: application/json" \
  -d '{"name":"$ARGUMENTS"}' http://127.0.0.1:17455/control/position
```

Confirm in one short sentence (e.g. `Kohai moved to center.`).
