---
description: Hide Kohai's window
allowed-tools: ["Bash"]
---

Hide Kohai. Run:

```bash
curl -s -X POST -H "X-Kohai-Token: $(cat ~/.kohai/token)" \
  http://127.0.0.1:17455/control/hide
```

Confirm: `Kohai hidden.`
