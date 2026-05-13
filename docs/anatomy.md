# Kohai — Anatomy Spec

This is the **source of truth** for Kohai's rig. Read this before posing
her so you don't have to guess which axis is "forward" or which sign
tilts her arm up. Every value here was confirmed empirically against the
actual VRM model — these are not the defaults from a humanoid spec doc.

## 1. Coordinate system & rig conventions

Three.js right-handed, +Y up. The character is parented to a root
`vrm.scene` whose `rotation.y` is the body turn.

### Body-turn convention

| `kohai_turn` value (rad) | Effective facing direction |
|---|---|
| `0` | Faces the camera (default) |
| `Math.PI / 2` | Faces **canvas-LEFT** (her chest points to the left of the screen) |
| `-Math.PI / 2` | Faces **canvas-RIGHT** |
| `Math.PI` | Back to camera |

⚠ The VRM-0.x correction (`vrm.scene.rotation.y = Math.PI` on load) is
*overwritten* by `bodyTargetY` every frame, so the above table is what
actually happens regardless of metaVersion.

### Rig coverage — which bones actually deform the mesh

The rig dump shows 52 humanoid bones present, but most of them are
**stub bones** — they exist in the VRM humanoid map but the mesh isn't
skinned to them, so rotating them does nothing. Empirically confirmed
by isolated `kohai_pose` tests:

| Bone | Status | Use it? |
|---|---|---|
| `hips`, `spine`, `neck`, `head` | ✅ deforming | yes |
| `leftEye`, `rightEye` | driven by `vrm.lookAt` | don't pose manually |
| `chest`, `upperChest` | ❌ stub (no mesh weights) | **never** — pose `spine` instead |
| `leftShoulder`, `rightShoulder` | ❌ stub | **never** — pose `upperArm` instead |
| `leftUpperArm`/`rightUpperArm` … `leftHand`/`rightHand` | ✅ deforming | yes |
| All finger bones (30 of them) | ❌ stub | **never** — fingers don't curl |
| `leftUpperLeg`/`rightUpperLeg`, `leftLowerLeg`/`rightLowerLeg` | ✅ deforming | yes |
| `leftFoot`/`rightFoot` | ✅ deforming | yes |
| `leftToes`/`rightToes` | likely stub | avoid |
| `jaw`, `leftThumbIntermediate`, `rightThumbIntermediate` | missing from rig | n/a |

**Rule of thumb:** if a pose target has no visible effect after a 1.5 s
settle, you're hitting a stub bone. Stick to the deforming list above.

### Bone-local axis convention (the part I kept getting wrong)

Bone rotations passed to `kohai_pose` are **local to the bone's parent**.
After the body root rotates, world position changes but local rotation
values stay the same. So bone rotations are reliable across `kohai_turn`.

| Bone | Rest rotation | Positive rx does | Positive rz does |
|---|---|---|---|
| `head`, `neck` | `(0, 0, 0)` | chin DOWN (look at floor) | tilt ear toward shoulder |
| `spine` | `(0, 0, 0)` | leans BACKWARD | side-bend |
| `hips` | `(0, 0, 0)` | (don't rotate hips — use `hipsTargetY` for vertical translation only) | — |
| `leftUpperArm` | `(0, 0, -1.30)` (A-pose, arm hangs at side) | swings arm UP-and-back | raises arm sideways (toward T-pose) |
| `rightUpperArm` | `(0, 0, +1.30)` (mirror) | swings arm UP-and-back | raises arm sideways (mirror) |
| `leftLowerArm` | `(0, -0.10, 0)` | (this axis isn't the elbow bend — see `ry` column) | — |
| `rightLowerArm` | `(0, +0.10, 0)` (mirror) | (same) | — |
| `leftHand` / `rightHand` | `(0, 0, 0)` | wrist down (palm rolls forward) | — |
| `leftUpperLeg`, `rightUpperLeg` | `(0, 0, 0)` (leg straight down) | **POSITIVE rx kicks the thigh FORWARD** (seated position, ~1.40 = horizontal); negative rx tucks the knee UP toward the chest | knee abduction (legs apart) |
| `leftLowerLeg`, `rightLowerLeg` | `(0, 0, 0)` | **NEGATIVE rx bends the calf back at the knee** (so calf points down when thigh is forward — the only anatomically valid direction); positive rx kicks the calf forward (not anatomically valid) | — |

Worth re-reading: **POSITIVE `rx` on upper leg = thigh forward** (seated).
Confirmed empirically against the walking cycle: knee bend during walk
also uses POSITIVE rx on lowerLeg.

### Elbow bend (empirically confirmed)

The forearm bends at the elbow via **`lowerArm.ry`**, not `.rx`:
- **Right forearm UP** (e.g. hand to face for thinking-chin):
  `rightLowerArm: { ry: +1.95 }`
- **Left forearm UP** (mirror):
  `leftLowerArm: { ry: -1.95 }`

Combined with upper-arm raise, this is the **proven** chin-touch combo:
```js
rightUpperArm: { rx: -1.0, rz: 1.0 }   // raise + slight forward
rightLowerArm: { ry: 1.95 }            // bend elbow, forearm up
rightHand:     { rx: -0.3 }            // wrist toward face
head:          { rx: 0.15, ry: -0.1, rz: -0.18 }  // tilt cute
```

For a clean **floor-sit** pose:
- `leftUpperLeg / rightUpperLeg: { rx: 1.40, rz: ±0.08 }` (thighs out)
- `leftLowerLeg / rightLowerLeg: { rx: -1.30 }` (calves dangle back-down)

For a **chair-sit** pose (thighs horizontal, calves vertical from knee):
- Upper leg: `rx: 1.55` (full 90° forward)
- Lower leg: `rx: -1.55` (calves return to vertical)

### Hip-anchored prop offset convention

When you parent a 3D mesh to the `hips` bone (via `hips.add(mesh)`) and
set `mesh.position`, that position is in **hips' local frame**:

| Mesh-local axis | Direction in hips frame |
|---|---|
| `+X` | her right shoulder side |
| `-X` | her left shoulder side |
| `+Y` | upward (toward head) |
| `-Y` | downward (toward feet) |
| `+Z` | **her body FRONT** (chest direction) — confirmed empirically |
| `-Z` | her body BACK (spine direction) |

So a laptop on her lap = `mesh.position.set(0, -0.06, +0.16)` (slightly
below the hip bone, 16cm forward).

## 2. Rest pose (A-pose) constants

These are exposed in `vrm-character.js` and named constants — use them.

```js
const REST_LEFT_UPPER_Z  = -1.30; // left upper arm rest rz
const REST_RIGHT_UPPER_Z =  1.30; // right upper arm rest rz
const REST_LOWER_BEND    = -0.10; // tiny natural elbow bend
```

To **raise** an arm out of rest, you drive `rz` *toward zero* (or past
zero for an over-the-shoulder reach):
- Right arm straight forward (90° forward): `rightUpperArm: {rx: -1.6, rz: 0.6}`
- Left arm half-raised (cup hold): `leftUpperArm: {rx: -0.6, rz: -0.9}`

To **bring an arm onto a keyboard at lap level** (proven combination):
- Upper arm: `rx: -0.90, rz: REST + 0.25` (toward body centerline)
- Lower arm: `rx: -0.95, ry: ±0.10` (slight inward curl)
- Hand: `rx: -0.30` (wrist tilted for typing)

## 3. Body landmarks (Y position relative to hip bone)

The model is auto-normalized to **1.3 m** total height (via `targetH` in
`onVRMLoaded`). Hip bone sits at the pelvis. All landmarks measured at
A-pose, model height 1.3 m.

| Landmark | Y relative to hip bone | Notes |
|---|---|---|
| Top of head | `+0.55 m` | Use for accessory anchoring (bows, headphones) |
| Eye line | `+0.50 m` | Camera default lookAt anchors here |
| Chin / mouth | `+0.43 m` | Speech bubble anchor |
| Neck / collar | `+0.39 m` | — |
| Top of chest | `+0.30 m` | — |
| Sternum | `+0.20 m` | — |
| Stomach center | `+0.10 m` | (used by `kohai_motion thinking` finger-on-chin) |
| Hip bone | `0 m` | Origin of the hips frame |
| Top of thighs | `-0.05 m` | **Lap surface** — anchor for laptop / books |
| Knee | `-0.30 m` (standing) | Bends with leg rotation |
| Ankle / foot | `-0.65 m` (standing) | Ground anchor when standing |

When she **sits**, her hip bone drops by `hipsTargetY` (typically `-0.30`)
and her feet end up at roughly `-0.95 m` from the original hip origin —
which is just below the chair seat surface.

## 4. Hair, outfit, skin (default "kohai" skin)

| Element | Value / description |
|---|---|
| Hair color | Warm chestnut brown `#7a4a2a` (mid-strand), darker root |
| Hair length | Reaches mid-back (~50 cm) — flows behind her when she walks |
| Hair partition | Side-swept, fringe over right eye when facing camera |
| Skin tone | Warm fair `#f6dccb` |
| Default outfit | White t-shirt + black pleated mini-skirt |
| Eye color | Soft amber `#9c6634` |
| Default shoes | White low-cut sneakers |

Alternative skins live in `assets/vrm-skins/<name>.vrm` and load via
`kohai_skin <name>`. Built-in names: `default`, `school`, `casual`,
`formal`, `sleep`, `summer`, `hacker`.

## 5. Body bounding box (for asset placement)

When designing asset placement, the character's silhouette in A-pose
spans roughly:

| Axis | Min | Max | Span |
|---|---|---|---|
| X (left/right) | `-0.22 m` | `+0.22 m` | 0.44 m shoulder-to-shoulder |
| Y (down/up) | `-0.65 m` | `+0.55 m` | 1.30 m total |
| Z (back/front) | `-0.12 m` | `+0.18 m` | ~30 cm including hair |

Seated (hips drop -0.30): subtract 0.30 from min Y.

## 6. Camera framing & canvas sizes

The camera is at `(0, midY + charHeight*0.05, dist)` looking at the
character mid-body. `dist` is computed from the character height to fit
~95% of the canvas vertically.

| `kohai_size` name | Window dimensions | Use case |
|---|---|---|
| `small` | 240×320 | Talking-head reactions |
| `medium` | 320×400 | Default seated framing |
| `large` | 480×600 | Full-torso |
| `xl` | 640×800 | Wide composition |
| `fullbody` | 420×960 | Standing, arms raised, full leg/foot |

⚠ `fullbody` is **portrait** (narrow). When she's in side profile, the
laptop or extended arms can fall off the side edge — verify with
`kohai_screenshot` and reduce the asset offset if needed.

## 7. Rotation gotchas — the things that wasted hours

These are the actual lessons learned the hard way:

1. **Upper leg rx**: `-1.30` kicks the thigh forward (seated). Positive rx
   kicks it backward. This was the single most confusing axis.
2. **Hips local +Z is her FRONT** — confirmed by parenting a 3D mesh to
   hips. Don't trust your reasoning about "after body rotation +π/2,
   local +Z maps to world ±X." Just trust the empirical: +Z forward.
3. **Spine rx negative = forward hunch.** Don't go past `-0.30` for a
   "sitting reading" pose — she peels off the chair backrest.
4. **VRM 0.x detection is unreliable** — assume the model could be either
   format and rely on the empirical bone-axis table above, not metaVersion.
5. **`hipsTargetY` is a position offset, not a rotation.** Drops her hip
   bone vertically. Use `-0.30` for chair-sit, `-0.65` for floor-sit,
   `-0.60` for sleep (slumped).
6. **When you parent a mesh to hips and tilt with `mesh.rotation.x`**,
   positive rx tilts the FRONT of the mesh DOWNWARD (handy for matching
   thigh slope).

## 8. The two reliable invariants

If everything else fails, fall back to these:

1. `kohai_play_animation stand` always resets her to A-pose, neutral.
2. `setPoseTarget('boneName', null)` (or `clearPoseTargets(['boneName'])`)
   releases a bone back to idle drift.

Compose new poses on top of `stand`. When the composition fails,
`stand` then start fresh.
