# Kohai — Demo Video Script

Two cuts: 30s vertical (TikTok / Reels / Shorts), 45s horizontal (X / Hacker News / Product Hunt).

**Goal:** in the first 2 seconds, viewer understands what it is and laughs.
**Hook:** the gag is "an anime girl is reacting in real-time to my code in a floating window."
**Format:** screen recording. No talking. Sound effects + Kohai's voice clips only. Captions burned in.

---

## 30-second vertical cut (TikTok / Reels)

| t (s) | left of screen | right of screen | audio | caption |
|---|---|---|---|---|
| 0.0 | terminal: typing `claude` | empty | keyboard typing | **i added an anime girl to my terminal** |
| 1.5 | claude code session opens | Kohai pops in, waves | "Hi senpai!" | she lives in a floating window |
| 3.0 | typing prompt: "fix the login bug" | Kohai → thinking | "Hmm, let me see..." | **she reacts to claude in real-time** |
| 6.0 | Bash tool runs (visible in CC) | Kohai → thinking, eyes scan | "Working on it senpai!" | every tool call... |
| 9.5 | Bash tool succeeds (green ✓) | Kohai → happy, sparkles | "Yatta!" | ...she celebrates |
| 12.0 | rapid sequence: 4 tool calls | Kohai cycles thinking → happy x4 | beats on each | tool calls = vibes |
| 16.5 | edit tool fails (red ✗) | Kohai → pouts | "Eh?? Gomen senpai..." | errors? she's sad |
| 20.0 | nothing happening, idle | Kohai → yawns, sleepy | (yawn) | leave for 5 min? |
| 22.5 | still idle | Kohai dozing | (snore) | she falls asleep |
| 24.0 | context % bar fills 95% | Kohai → panic mode (red, shaking) | "Senpai I'm running out of memory!" | context full = chaos |
| 27.0 | Stop event (task complete) | Kohai → big celebration | "All done!" | every ✓ feels like a win |
| 29.0 | logo "Kohai — $9 launch weekend" | URL: kohai.gumroad.com | soft chime | **kohai.gumroad.com** |

**Subtitles styling:** Bold sans, white with thin black stroke, bottom-third positioned to leave Kohai visible. Use Inter or similar.

**Music bed:** subtle lo-fi anime piano loop, -20 LUFS so voice clips cut through. NOT pop or trap (will date the video).

---

## 45-second horizontal cut (X / HN / PH)

Same beats but slower pacing + 3 added scenes:

| extra scene | what to show |
|---|---|
| 4–6s | tray menu: "show / hide / quit" — proves it's a real app, not just a demo |
| 18–22s | install one-liner: `npm run install-hooks` — proves easy setup |
| 35–40s | quick character-pack tease at end: silhouettes of upcoming tsundere / yandere variants with "more characters soon" |

---

## Filming checklist

- [ ] OBS or QuickTime screen recording at 60fps
- [ ] Terminal: iTerm2 with large readable font (16pt+), dark theme
- [ ] Kohai window positioned in bottom-right, NOT covering the terminal
- [ ] Hide all macOS notifications, dock auto-hide on
- [ ] Use a fresh repo with a fake `loginBug.js` for the "fix the login bug" prompt — must run fast and visibly
- [ ] Pre-script the Claude session: write prompts that produce 4–5 quick tool calls (not a 60s thinking session)
- [ ] Record audio separately from voice clips (clean) and mix in editor
- [ ] Burn captions BEFORE export, not auto-captions

---

## Common mistakes to avoid

- Showing Kohai for too long before any reaction — viewer scrolls.
- Using a real production codebase — too much noise.
- Recording at 30fps — the breathing animation looks janky.
- Forgetting to test mute — 70% of viewers watch silent. Captions must carry the gag alone.
- Filming the terminal in light mode — high contrast eats Kohai's color palette.
