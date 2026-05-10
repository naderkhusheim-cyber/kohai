# Kohai Skins

Drop additional `.vrm` files in this directory to give Kohai swappable outfits/skins. Each filename (without extension) becomes a skin name.

## Switching skins

```
/kohai-skin school
/kohai-skin casual
/kohai-skin default     # back to the bundled character
```

Or via MCP: `kohai_skin({name: "school"})`.

## Suggested starter skins

- `default` — the bundled VRM (always available, no file needed)
- `school` — school uniform
- `casual` — t-shirt + skirt / hoodie
- `formal` — business / suit
- `sleep` — pajamas (use with the late-night roommate moments!)
- `summer` — yukata / swimsuit

## Sourcing skins

Each `.vrm` is a complete character model with its own outfit baked in. Free options:

- **VRoid Studio** — free Mac app, design any outfit in 1–2 hours, export `.vrm`
- **VRoid Hub** — search by outfit / aesthetic, filter "free"
- **BOOTH** — many fully-clothed VRM models for ~¥1000

Drop the file as `<skin-name>.vrm`, then `/kohai-skin <skin-name>` to switch live.
