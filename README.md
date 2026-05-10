# Kohai

Your anime kohai who lives next to your terminal and reacts to your Claude Code session.

She thinks when Claude thinks. Cheers when tools succeed. Pouts on errors. Sleeps when you wander off. Panics when your context window fills up. She knows the file you're editing, speaks aloud through VOICEVOX, and can be addressed directly — just say her name.

## Install (one step)

Just open Kohai. The first time the app launches it **auto-installs itself into Claude Code** — slash commands, lifecycle hooks, and the MCP server all wire up to `~/.claude/` silently. No marketplace dance.

```bash
git clone https://github.com/naderkhusheim-cyber/kohai.git ~/kohai
cd ~/kohai
npm install
npm start                  # everything else happens automatically
```

After this, every new Claude Code session has:
- `/kohai-say`, `/kohai-motion`, `/kohai-size`, `/kohai-position`, `/kohai-hide`, `/kohai-show`, `/kohai-turn`, `/kohai-pose`, `/kohai-play` slash commands.
- All 9 lifecycle hooks (`SessionStart`, `PreToolUse`, etc.) forwarding events to her.
- 13 native MCP tools (`kohai_say`, `kohai_pose`, `kohai_choreograph`, `kohai_walk`, `kohai_turn`, `kohai_read_file`, `kohai_edit_file`, …) so Claude can drive her body during work.

To package as a `.dmg` for end users:

```bash
npm run build              # bundles VOICEVOX engine + Kohai.app (~2.5 GB)
```

The DMG is one drag-and-drop install. On first open Kohai self-installs into Claude Code; from then on every session has her.

To uninstall the Claude Code hooks:

```bash
npm run uninstall-hooks
```

## How it works

1. Electron app runs a tiny local HTTP server on `127.0.0.1:17455` with a randomly generated token (stored at `~/.kohai/token`).
2. Lifecycle hooks (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `Notification`) forward Claude Code events to the Kohai server via `hooks/dispatch.sh`.
3. The renderer process picks the right Live2D motion + bubble line per event — including the file you're editing or the command you're running.
4. When you address Kohai by name in a prompt, an embedded keyword matcher (and `claude -p` fallback for unmatched lines) generates a contextual reply. No API key needed — she rides your existing Claude Code auth.
5. Bubble lines are voiced via a bundled VOICEVOX engine running on `127.0.0.1:50021`. Default voice: VOICEVOX:春日部つむぎ (Tsumugi Kasukabe).
6. The MCP server in `mcp-server/` exposes `kohai_say`, `kohai_motion`, `kohai_size`, `kohai_position`, `kohai_hide`, `kohai_show` so Claude can call Kohai natively as tools.

## Slash commands

| command | what it does |
|---|---|
| `/kohai` | help — list available Kohai commands |
| `/kohai-say <text>` | display + speak a line |
| `/kohai-motion <state>` | set mood (idle, thinking, happy, error, sleepy, panic) |
| `/kohai-size <name>` | resize (small, medium, large, xl) |
| `/kohai-position <name>` | move (bottom-right, bottom-left, top-right, top-left, center) |
| `/kohai-hide` | hide the window |
| `/kohai-show` | bring it back |

## Credits

See [CREDITS.md](./CREDITS.md). Default voice character (VOICEVOX:春日部つむぎ) requires attribution per her usage terms.
