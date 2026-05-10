# Kohai

Your anime kohai who lives next to your terminal and reacts to your Claude Code session.

She thinks when Claude thinks. Cheers when tools succeed. Pouts on errors. Sleeps when you wander off. Panics when your context window fills up. She knows the file you're editing, speaks aloud through VOICEVOX, and can be addressed directly — just say her name.

## Install (as a Claude Code plugin)

In any Claude Code session:

```
/plugin marketplace add naderkhusheim-cyber/kohai
/plugin install kohai@kohai-marketplace
```

That registers the slash commands (`/kohai-say`, `/kohai-motion`, `/kohai-size`, `/kohai-position`, `/kohai-hide`, `/kohai-show`), wires the lifecycle hooks, and registers the `kohai_*` MCP tools. The first time you start a Claude Code session after installing, Kohai auto-launches her Electron window.

## Install (standalone, from source)

```bash
git clone https://github.com/naderkhusheim-cyber/kohai.git ~/kohai
cd ~/kohai
npm install
npm run start              # launch Kohai's floating window
npm run install-hooks      # wire to ~/.claude/settings.json
npm run install-command    # copy slash commands into ~/.claude/commands/
```

To package as a `.dmg`:

```bash
npm run build              # bundles the VOICEVOX engine + builds Kohai.dmg (~2.5 GB)
```

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
