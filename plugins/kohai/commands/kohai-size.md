---
description: Resize Kohai's window — small, medium, large, xl, or fullbody (tall for back-turned reach poses)
argument-hint: small | medium | large | xl | fullbody
allowed-tools: ["Bash"]
---

The user invoked `/kohai-size` with size: `$ARGUMENTS`

Valid sizes: `small` (240×320), `medium` (320×400), `large` (480×600), `xl` (640×800), `fullbody` (420×960 — narrow + tall, fits the full standing figure with arm extended for "touching the terminal" reach poses). If the argument isn't one of these, default to `medium` and note the correction.

```bash
curl -s -X POST -H "X-Kohai-Token: $(cat ~/.kohai/token)" -H "Content-Type: application/json" \
  -d '{"name":"$ARGUMENTS"}' http://127.0.0.1:17455/control/size
```

Confirm in one short sentence (e.g. `Kohai resized to large.`).
