# Kohai — Gumroad Listing Copy

## Product Title
**Kohai — Your anime kohai for Claude Code**

## Subtitle / one-liner
A floating anime companion who lives next to your terminal and reacts in real-time to your Claude Code session.

## Hero description (top of listing)

She thinks when Claude thinks.
She cheers every time a tool succeeds.
She pouts when your build breaks.
She panics when your context window fills up.
She sleeps when you wander off to make coffee.

Kohai is a tiny floating macOS app that sits next to your terminal and reacts in real-time to your Claude Code session. She has 6 emotional states, 28 voice lines, and zero use whatsoever — except making your AI coding sessions feel a little less lonely.

**Launch weekend price: $9** (regular $15)

## What's included

- Kohai macOS app (.dmg, signed and notarized)
- 28 voice clips
- Auto-installer for Claude Code hooks
- Tray menu: show / hide / quit
- Lifetime updates (v1.x)

## Requirements

- macOS 14 or later (Sonoma / Sequoia)
- Claude Code installed
- ~120 MB disk space

## How it works

1. Drag Kohai.app to /Applications
2. Open Kohai (one-time security prompt)
3. Run the included hook installer
4. Start any Claude Code session — Kohai will react automatically

A backup of your Claude settings is saved before any change. Uninstaller included.

## FAQ

**Does she work outside Claude Code?**
Not yet. v2 will support generic terminal events, GitHub Actions, and CI failures.

**Is she safe / does she leak my data?**
Yes — she only listens to a local port on your machine (`127.0.0.1:17455`) with a randomly generated auth token stored at `~/.kohai/token`. No telemetry, no analytics, no network calls outbound.

**Why does she require macOS Sonoma+?**
Older macOS versions had a buggy transparent-window implementation that made her flicker.

**Can I use my own character?**
Character pack 2 (tsundere) drops next month. Custom character SDK is on the v2 roadmap.

**I bought it but it shows "damaged" on first open.**
You're on macOS Sequoia and your Gatekeeper is suspicious. Right-click → Open, then click "Open" in the dialog. It's signed and notarized — Apple just likes to be cautious with new dev IDs.

**Refunds?**
Yes, within 14 days, no questions asked. DM me on X @[handle] or email [refund@kohai.app].

---

## Tags
`claude code` `claude` `ai` `anime` `waifu` `developer tools` `terminal` `macos` `electron` `kawaii` `productivity` `companion app` `vibecoding`

---

## Hero image / GIF
Loop the 5-second sequence: idle → thinking (tool starts) → happy (tool succeeds) → idle. Loop seamlessly.

## Product page screenshots (4)
1. Kohai window in bottom-right of a real desktop with iTerm + Claude Code
2. Close-up of all 6 facial states in a 3x2 grid
3. Speech bubble examples: "Yatta!", "Eh?? Something went wrong…", "Senpai, I'm running out of memory!"
4. Tray menu screenshot

## License key flow
- Gumroad generates a unique key per sale (toggle in product settings)
- App's first launch shows a "Enter license key" dialog
- Key is verified via `POST https://api.gumroad.com/v2/licenses/verify` with `product_id` + `license_key`
- On success, a `~/.kohai/license` file is written; subsequent launches skip the check
- (License verify code is a v1.0.1 add — ship without for the launch weekend, soft-enforce starting week 2)
