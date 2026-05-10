# Kohai

Your anime kohai who lives next to your terminal and reacts to your Claude Code session.

She thinks when Claude thinks. Cheers when tools succeed. Pouts on errors. Sleeps when you wander off. Panics when your context window fills up.

## Install

```bash
npm install
npm run start              # launch Kohai (floating window appears)
npm run install-hooks      # wire her up to Claude Code
```

To package as a `.dmg`:

```bash
npm run build
```

To uninstall the Claude Code hooks:

```bash
npm run uninstall-hooks
```

## How it works

1. Electron app runs a tiny local HTTP server on `127.0.0.1:17455` with a randomly generated token (stored at `~/.kohai/token`).
2. Hook installer adds entries to `~/.claude/settings.json` for `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `UserPromptSubmit`, `Notification`.
3. Each hook runs `hooks/dispatch.sh <EventType>`, which POSTs the JSON payload from stdin to the local Kohai server.
4. The renderer process updates Kohai's facial expression and plays a voice clip based on the event.

A backup of your `settings.json` is written to `settings.json.kohai-backup` before any changes.

## Roadmap

- v1.0 — emoji placeholder character, English voice clips
- v1.1 — Live2D Hiyori model swap (already legally cleared, just needs integration)
- v1.2 — character pack #2 (tsundere)
- v2.0 — Kohai After Dark (paid DLC)

## Credits

- Voice clips generated with ElevenLabs
- Character model upgrade path: Live2D Inc. (Hiyori sample model under Live2D Free Material License)
