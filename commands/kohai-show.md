---
description: Show Kohai's window (after hiding)
allowed-tools: ["Bash"]
---

Show Kohai. Run:

```bash
curl -s -X POST -H "X-Kohai-Token: $(cat ~/.kohai/token)" \
  http://127.0.0.1:17455/control/show
```

Confirm: `Kohai is back.`
