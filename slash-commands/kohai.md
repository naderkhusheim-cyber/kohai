---
description: Kohai help — list available subcommands
argument-hint: say | motion | size | position | hide | show
allowed-tools: ["Bash"]
---

The user invoked `/kohai` with arguments: `$ARGUMENTS`

If `$ARGUMENTS` is empty, just print a short list of the available `/kohai-*` subcommands and stop. Otherwise, parse the legacy syntax (`/kohai <subcommand> <args>`) and route to the right curl call below.

**Available subcommands** (each is also its own slash command for autocomplete):
- `/kohai-say <text>` — make Kohai say something
- `/kohai-motion <state>` — set mood (idle | thinking | happy | error | sleepy | panic)
- `/kohai-size <name>` — resize (small | medium | large | xl)
- `/kohai-position <name>` — move to corner (bottom-right | bottom-left | top-right | top-left | center)
- `/kohai-hide` — hide the window
- `/kohai-show` — bring it back

Kohai is a local desktop anime companion app running an HTTP server at `http://127.0.0.1:17455`. The auth token lives at `~/.kohai/token`.

Parse the arguments and run the appropriate `curl` command. Then briefly confirm with one short sentence (e.g. "Done — Kohai resized to large.").

## Subcommands

| user types | what to do |
|---|---|
| `/kohai say <text>` | POST `/control/say` with `{"text": "<text>"}` |
| `/kohai motion <state>` | POST `/control/motion` with `{"state": "<state>"}` where state ∈ idle, thinking, happy, error, sleepy, panic |
| `/kohai size <name>` | POST `/control/size` with `{"name": "<name>"}` where name ∈ small, medium, large, xl |
| `/kohai position <name>` | POST `/control/position` with `{"name": "<name>"}` where name ∈ bottom-right, bottom-left, top-right, top-left, center |
| `/kohai hide` | POST `/control/hide` (empty body) |
| `/kohai show` | POST `/control/show` (empty body) |
| `/kohai` (no args) | print this help |

## Curl template

```bash
TOKEN=$(cat ~/.kohai/token)
curl -s -X POST \
  -H "X-Kohai-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '<JSON_BODY>' \
  http://127.0.0.1:17455/control/<CMD>
```

## Examples

`/kohai say hello senpai`
```bash
curl -s -X POST -H "X-Kohai-Token: $(cat ~/.kohai/token)" -H "Content-Type: application/json" \
  -d '{"text":"hello senpai"}' http://127.0.0.1:17455/control/say
```

`/kohai size large`
```bash
curl -s -X POST -H "X-Kohai-Token: $(cat ~/.kohai/token)" -H "Content-Type: application/json" \
  -d '{"name":"large"}' http://127.0.0.1:17455/control/size
```

`/kohai motion happy`
```bash
curl -s -X POST -H "X-Kohai-Token: $(cat ~/.kohai/token)" -H "Content-Type: application/json" \
  -d '{"state":"happy"}' http://127.0.0.1:17455/control/motion
```

If Kohai's server is not running, the curl will fail silently — tell the user to launch the Kohai app first.
