# VRM Animations

Drop `.vrma` (VRM Animation) files in this directory to give Kohai professionally-authored motions. The filename (without extension) becomes the animation name.

## How Kohai uses them

On startup the renderer attempts to load these names:

- `idle.vrma` — auto-plays in a loop when nothing else is happening
- `wave.vrma` — greeting / SubagentStop
- `celebrate.vrma` — successful tool calls
- `thinking.vrma` — WebSearch / long thinking
- `walking.vrma` — scenario walk steps
- `bow.vrma` — SessionStart greeting
- `sit.vrma` — sitting at her desk
- `type.vrma` — coding mode

Add additional names by editing `animationLibrary` in `renderer/vrm-character.js`.

## How to play one manually

```
/kohai-play wave
/kohai-play idle loop
```

Or via MCP: `kohai_play_animation({name: "wave"})`.

## Where to get .vrma files

Free sources for anime-style VRM animations:

- **VRM Hub** — https://hub.vroid.com/ has user-uploaded motions on some character pages
- **BOOTH** — https://booth.pm/ search `VRMA` or `VRMアニメーション`
- **Mixamo retargeted** — Adobe Mixamo (free) has animation packs; convert with the [Mixamo→VRMA converter](https://github.com/saturday06/VRM-Addon-for-Blender) in Blender
- **Make your own** — Unity's UniVRM exporter or Blender's VRM Add-on can save mocap as .vrma

## Why this matters

Hand-coding bone rotations works for tiny gestures (head tilts, fist pumps) but doesn't scale to natural-looking complex motion (walking, sitting, picking something up). Professional .vrma files are mocap-quality and play back through `THREE.AnimationMixer` with proper easing and timing.

When a .vrma exists for a behavior, the renderer prefers it over the procedural fallback.
