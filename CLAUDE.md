# Kohai — Claude Code Instructions

This project is Kohai: an anime VRM companion for Claude Code users.
There are TWO modes you operate in:

## Conversation mode (the user is talking *to* Kohai, not coding)

Signals you're in conversation mode: the user's message is addressed to
Kohai ("hi kohai", "what are you thinking", "are you okay?"), or invokes
a `/kohai-*` slash command, or you're switching personalities.

**Required behavior in conversation mode:**

1. **Prefer MCP tools** over Bash whenever they're loaded in the
   session. They are: `mcp__kohai__kohai_say`, `kohai_motion`,
   `kohai_pose`, `kohai_turn`, `kohai_personality`, `kohai_asset`,
   `kohai_screenshot`, `kohai_play_animation`, etc. MCP calls render
   compactly in the UI — they don't clutter the terminal with a curl
   for every gesture.
2. **If MCP tools aren't loaded**, use the short wrapper at
   `/Users/nader/kohai/bin/k` instead of raw `curl`. Examples:
   ```bash
   k say "hi senpai"
   k motion happy
   k personality girlfriend
   k turn 90
   k pose '{"rightUpperArm":{"rz":-1.7}}' -0.55     # bones + hipsY
   k asset water-bottle rightHand
   k snap                                             # /tmp/k.png
   ```
   The wrapper exists specifically so conversational replies look like
   one tidy line, not a screenful of curl + token + JSON.
3. **Never run raw `curl -s -X POST -H "X-Kohai-Token: …"`** in
   conversation mode. That's the visible noise the user complained
   about. Use MCP first, `bin/k` second.
4. Compose pose + say + motion **together** for any response.
   "Conversation" without a body gesture is a regression to text-bot
   mode; she has a 3D body, use it.

## Coding mode (the user is doing real dev work, Kohai is the companion)

Signals: Edit / Write / Bash / Read tool use, debugging, building
features, file changes.

In this mode showing tool calls is expected — devs *want* to see what
Claude is doing. The kohai companion runs in the background; you can
still drive her via MCP / `bin/k`, but don't worry as much about
visible bash noise.

## Architecture pointers

- `docs/anatomy.md` — every bone, axis convention (empirical, not VRM
  spec). READ THIS before posing.
- `docs/capabilities.md` — every MCP tool with worked examples + the
  full drink-water lifecycle.
- `personalities/<name>.md` — voice/triggers/gestures per personality.
- `assets/library/manifest.json` — registered drop-in scene props.
- `renderer/vrm-character.js` — the actual rig + ticker. The
  `CONTROL_HANDLERS` map at the bottom is the source of truth for
  what each control command does. The `rig sanity dump` at VRM-load
  time prints every bone's bind orientation to the Electron console.

## Hard rules

- Never re-introduce hardcoded scene recipes (`chair_sit`, `sit`,
  `sleep`, `code_at_desk`). They were intentionally deleted; compose
  live from `docs/anatomy.md`.
- The two reliable invariants: `kohai_play_animation stand` always
  resets her to A-pose; `kohai_pose { bones: { name: null } }`
  releases a single bone back to idle.
- `hipsY` (top-level on the pose call) is REQUIRED for any seated
  pose, or she floats with bent legs.
- Window stays at compact `medium` size, pinned to the bottom-right
  corner of the active terminal. Never resize her up to fill the
  terminal — the user explicitly said that's ugly and disturbing.
- **Stub bones in this rig — never pose them, they're no-ops**:
  `chest`, `upperChest`, `leftShoulder`, `rightShoulder`, every finger
  bone (`*Thumb*`, `*Index*`, `*Middle*`, `*Ring*`, `*Little*`),
  `leftToes`, `rightToes`. They show up in the humanoid map but the
  mesh isn't skinned to them; rotating them does nothing visible.
  Use `spine` for ALL torso bend (drive it harder, ~-0.7 for a bow);
  use `upperArm.rz` for all arm raise; for "holding/gripping" use
  `kohai_prop` or `kohai_asset` (bone-attached SVG) instead of fingers.
