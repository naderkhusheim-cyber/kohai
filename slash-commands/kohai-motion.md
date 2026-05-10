---
description: Set Kohai's mood — idle, thinking, happy, error, sleepy, or panic
argument-hint: idle | thinking | happy | error | sleepy | panic
allowed-tools: ["Bash"]
---

The user invoked `/kohai-motion` with state: `$ARGUMENTS`

Valid states: `idle`, `thinking`, `happy`, `error`, `sleepy`, `panic`. If the argument isn't one of these, default to `idle` and note the correction.

```bash
curl -s -X POST -H "X-Kohai-Token: $(cat ~/.kohai/token)" -H "Content-Type: application/json" \
  -d '{"state":"$ARGUMENTS"}' http://127.0.0.1:17455/control/motion
```

Confirm in one short sentence (e.g. `Kohai is now happy.`).
