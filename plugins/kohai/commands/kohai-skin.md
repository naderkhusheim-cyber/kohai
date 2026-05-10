---
description: Switch Kohai's outfit / skin (loads a different VRM model)
argument-hint: default | school | casual | formal | sleep | <name>
allowed-tools: ["Bash"]
---

The user invoked `/kohai-skin` with: `$ARGUMENTS`

Parse `$ARGUMENTS` as the skin name. If empty, default to `default`.

```bash
NAME="${ARGUMENTS:-default}"
curl -s -X POST -H "X-Kohai-Token: $(cat ~/.kohai/token)" -H "Content-Type: application/json" \
  -d "{\"name\":\"$NAME\"}" \
  http://127.0.0.1:17455/control/skin
```

Confirm in one short sentence (e.g. `Kohai changed to school skin.`).

Skins are `.vrm` files in `assets/vrm-skins/`. The `default` skin always works (it's the bundled character). Other skins require a corresponding `<name>.vrm` file.
