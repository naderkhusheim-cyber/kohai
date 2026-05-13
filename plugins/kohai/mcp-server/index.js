#!/usr/bin/env node
// MCP server — exposes Kohai as native tools to Claude Code.
// Speaks the JSON-RPC over stdio MCP protocol (2024-11-05).
//
// Tools:
//   kohai_say       — display text + speak via VOICEVOX
//   kohai_motion    — set mood (happy / thinking / etc.)
//   kohai_size      — resize her window
//   kohai_position  — move her on screen
//   kohai_hide      — hide
//   kohai_show      — show

const fs = require('fs');
const os = require('os');
const path = require('path');

const KOHAI_URL = 'http://127.0.0.1:17455';
const TOKEN_PATH = path.join(os.homedir(), '.kohai', 'token');

function getToken() {
  try { return fs.readFileSync(TOKEN_PATH, 'utf8').trim(); } catch (_) { return null; }
}

async function kohaiPost(cmd, body) {
  const token = getToken();
  if (!token) return false; // Kohai not running — silently skip (file work still proceeds)
  try {
    const res = await fetch(`${KOHAI_URL}/control/${cmd}`, {
      method: 'POST',
      headers: { 'X-Kohai-Token': token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : '',
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

// Animations during agency work — show what Kohai is doing in her bubble.
async function announce(state, text) { await kohaiPost('motion', { state, text }); }
async function celebrate(text) {
  await kohaiPost('motion', { state: 'happy', text });
}
async function pout(text) {
  await kohaiPost('motion', { state: 'error', text });
}

function shortPath(p) {
  const home = os.homedir();
  if (p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}

function basenameOf(p) { return path.basename(p) || p; }

function findLineOfMatch(content, needle) {
  const idx = content.indexOf(needle);
  if (idx < 0) return null;
  return content.slice(0, idx).split('\n').length;
}

const TOOLS = [
  {
    name: 'kohai_say',
    description: 'Make Kohai display a speech bubble and speak it aloud (if VOICEVOX is up).',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'What Kohai should say.' } },
      required: ['text'],
    },
    handler: async ({ text }) => kohaiPost('say', { text }),
  },
  {
    name: 'kohai_motion',
    description: 'Set Kohai\'s mood/animation. Choose one of: idle, thinking, happy, error, sleepy, panic.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['idle', 'thinking', 'happy', 'error', 'sleepy', 'panic'] },
        text: { type: 'string', description: 'Optional bubble text to show with the motion.' },
      },
      required: ['state'],
    },
    handler: async ({ state, text }) => kohaiPost('motion', text ? { state, text } : { state }),
  },
  {
    name: 'kohai_size',
    description: 'Resize Kohai\'s window. Choose one of: small, medium, large, xl.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', enum: ['small', 'medium', 'large', 'xl'] } },
      required: ['name'],
    },
    handler: async ({ name }) => kohaiPost('size', { name }),
  },
  {
    name: 'kohai_position',
    description: 'Move Kohai to a screen corner: bottom-right, bottom-left, top-right, top-left, center.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', enum: ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center'] } },
      required: ['name'],
    },
    handler: async ({ name }) => kohaiPost('position', { name }),
  },
  {
    name: 'kohai_hide',
    description: 'Hide Kohai\'s window.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => kohaiPost('hide'),
  },
  {
    name: 'kohai_show',
    description: 'Show Kohai\'s window after hiding.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => kohaiPost('show'),
  },
  {
    name: 'kohai_turn',
    description: 'Rotate Kohai\'s body. 0 = facing camera, 90 = her right, 180 = back, -90 = her left.',
    inputSchema: {
      type: 'object',
      properties: {
        degrees: { type: 'number', description: 'Target Y rotation in degrees.' },
      },
      required: ['degrees'],
    },
    handler: async ({ degrees }) => kohaiPost('turn', { degrees }),
  },
  {
    name: 'kohai_pose',
    description: `Pose Kohai by setting any bone's rotation directly. Use this to make her gesture, point, lean, hold something, react — anything. Compose poses by combining multiple bones in one call.

ANATOMY — only bones that ACTUALLY deform the mesh (the others exist in the humanoid map but are stub bones in this rig; rotating them is a no-op):
  TORSO:  hips, spine, neck, head
          — spine is the ONLY torso bend bone. chest/upperChest exist
            but are not skinned to the mesh — do NOT use them.
            For a full bow, drive spine.rx hard (around -0.70) + head.rx 0.5.
  EYES:   leftEye, rightEye  — driven by lookAt; don't pose manually.
  ARMS:   leftUpperArm, leftLowerArm, leftHand
          rightUpperArm, rightLowerArm, rightHand
          — shoulders (leftShoulder/rightShoulder) are stub bones too;
            arm raise comes entirely from upperArm.rz.
  FINGERS: ❌ NOT AVAILABLE. All 30 finger bones are stub bones in this
          rig — they do nothing. Use the hand prop system (kohai_prop)
          or just suggest a closed-fist via wrist rotation if needed.
  LEGS:   leftUpperLeg, leftLowerLeg, leftFoot (mirror right) — all
          deform. (toes likely stub; avoid relying on them.)

ROTATION CONVENTIONS (this rig's bone bind is normalized — values below are EMPIRICAL):
  head.rx >0 = looks down, <0 = looks up
  head.ry >0 = looks right, <0 = looks left
  head.rz >0 = tilts head right, <0 = tilts left
  spine.rx >0 = leans torso FORWARD (the ONLY bend axis we have for the upper body)
  spine.rx <0 = leans BACKWARD (limbo, looks weird; avoid unless that's what you want)
  → For a full BOW, push spine.rx to +1.3 + head.rx 0.5 + small leg bend if it's a curtsy
  → THE SIGN IS COUNTERINTUITIVE — confirmed empirically by direct screenshot in 2026-05. Old anatomy docs had it inverted.
  upperArm.rz: arm at her side requires LEFT≈-1.3, RIGHT≈+1.3
  upperArm.rx <0 = arm swings forward; >0 = backward
  upperArm.rz — EXPLICIT VALUE TABLE (the part that broke previously):
    RIGHT arm:
      +1.30 = REST (arm hanging at her side)
       0    = T-pose (arm horizontal out to side)
      -1.30 = arm straight UP
      -1.70 = arm above head, waving high
    LEFT arm (mirror):
      -1.30 = REST (arm hanging)
       0    = T-pose
      +1.30 = straight UP
      +1.70 = above head waving high
    Going PAST these (e.g. ±2.4) over-rotates back behind the head.
  lowerArm.ry: ELBOW BEND axis (this rig's normalized bones).
               - RIGHT arm: POSITIVE ry bends the elbow (forearm UP),
                 e.g. ry=1.95 brings the right hand to face level.
               - LEFT arm: NEGATIVE ry bends the elbow (mirror),
                 e.g. ry=-1.95 brings the left hand to face level.
  hand.rx >0 = palm down
  upperLeg.rx >0 = thigh kicks FORWARD (seated); <0 = knee tucks up to chest
  lowerLeg.rx <0 = calf bends back-down (anatomical knee bend after thigh-forward)
  Each bone target accepts an optional 'lerp' (default 6, range 1-15) — higher = snaps faster.

CRITICAL — hipsY for seated/lying poses:
  Bending the legs alone leaves her at standing hip height (bent-knee-float).
  To put her butt on the floor, pass hipsY at the TOP level of the call:
    { hipsY: -0.55, bones: { leftUpperLeg: { rx: 1.40 }, ... } }
  Range: 0 (standing) → -0.30 (chair-sit) → -0.65 (deep floor-sit).

POSE COOKBOOK — empirically validated (all bones in this rig; spine values are deep because this rig's bend response is sublinear):
  WAVE:           { rightUpperArm: {rz:-1.7}, rightLowerArm: {ry:0.5}, rightHand: {rz:-0.4} }
  POINT_FORWARD:  { rightUpperArm: {rx:-1.0, rz:1.4}, rightLowerArm: {ry:0.0}, rightHand: {rx:-0.2}, head: {ry:-0.30} }
                  → also kohai_turn({degrees:-25}) for a 3/4 view; "forward" at turn=0 foreshortens the arm into the camera and reads as a stub.
  HANDS_UP:       { leftUpperArm: {rz:1.7}, rightUpperArm: {rz:-1.7} }
  STRETCH_UP:     { leftUpperArm: {rz:1.7}, rightUpperArm: {rz:-1.7}, head: {rx:-0.2} }
  JUMP_APEX:      { leftUpperArm: {rz:1.7}, rightUpperArm: {rz:-1.7}, leftUpperLeg: {rx:-0.9}, rightUpperLeg: {rx:-0.9}, leftLowerLeg: {rx:-1.1}, rightLowerLeg: {rx:-1.1}, spine: {rx:-0.15} }
                  → knees tucked toward chest = clear "cannonball" airborne read.
  ARMS_AT_SIDES:  { leftUpperArm: {rz:-1.3}, rightUpperArm: {rz:1.3} }
  THINKING_CHIN:  { rightUpperArm: {rx:-1.0, rz:1.0}, rightLowerArm: {ry:1.95}, rightHand: {rx:-0.3}, head: {rx:0.15, ry:-0.1, rz:-0.18} }
  SHRUG:          { leftUpperArm: {rx:-0.85, rz:-0.40}, rightUpperArm: {rx:-0.85, rz:0.40}, leftLowerArm: {ry:-2.2}, rightLowerArm: {ry:2.2}, head: {rx:-0.10, rz:0.15} }
  CROSS_ARMS:     { leftUpperArm: {rx:-1.4, rz:-2.1}, rightUpperArm: {rx:-1.4, rz:2.1}, leftLowerArm: {ry:-0.4}, rightLowerArm: {ry:0.4} }
                  → rz must go PAST rest (|rz| > 1.3) to cross over center; rest only stops at the body's vertical axis.
  PEEK_FORWARD:   { spine: {rx:0.80}, head: {rx:0.20, ry:-0.50, rz:0.10} }
                  → drive spine only on rx (forward, POSITIVE); spine.ry/rz cause weird tipping.
                  Head.ry alone conveys "peeking around something".
  BOW:            { spine: {rx:1.30}, head: {rx:0.50}, leftUpperArm: {rx:-0.15}, rightUpperArm: {rx:-0.15} }
                  → POSITIVE rx for forward bend. +1.3 produces a clean Japanese 90° bow.
                  Tiny upperArm.rx swings arms forward with the body so they don't stick out at sides.
  SLEEPY_SLUMP:   { spine: {rx:0.85}, head: {rx:0.70, rz:0.30}, leftUpperArm: {rx:-0.4}, rightUpperArm: {rx:-0.4}, leftLowerArm: {ry:-0.6}, rightLowerArm: {ry:0.6} }
  MAID_CURTSY:    use hipsY: -0.20 +
                  { spine: {rx:1.0}, head: {rx:0.45}, leftUpperLeg: {rx:0.80}, rightUpperLeg: {rx:0.80}, leftLowerLeg: {rx:-0.60}, rightLowerLeg: {rx:-0.60}, leftUpperArm: {rx:-0.35, rz:-1.1}, rightUpperArm: {rx:-0.35, rz:1.1} }
                  → arms angled out for "skirt pinch" silhouette; hipsY drops her slightly so the leg dip reads as a real curtsy not just bent knees.
  HEAD_TILT_CUTE: { head: {rx:0.1, rz:0.4} }
  CROSS_ARMS:     { leftUpperArm: {rx:-0.6, rz:-0.5}, rightUpperArm: {rx:-0.6, rz:0.5}, leftLowerArm: {ry:-1.5}, rightLowerArm: {ry:1.5} }
  FLOOR_SIT (use with hipsY: -0.55):  { leftUpperLeg: {rx:1.40, rz:0.08}, rightUpperLeg: {rx:1.40, rz:-0.08}, leftLowerLeg: {rx:-1.30}, rightLowerLeg: {rx:-1.30}, spine: {rx:0.05}, leftUpperArm: {rx:-0.2, rz:-1.15}, rightUpperArm: {rx:-0.2, rz:1.15}, leftLowerArm: {ry:-0.5}, rightLowerArm: {ry:0.5} }
  CHAIR_SIT — first drop the chair backdrop and turn to side profile:
    kohai_room({name:'workspace'}) + kohai_turn({degrees:90})
    NB: chair SVG renders backrest on canvas-LEFT (per vrm.html L67),
    seat extends canvas-RIGHT. +90 turn faces her camera-right so her
    back lands against the backrest and her arms reach forward to
    where a virtual keyboard would be. With -90 she ends up facing
    INTO the backrest — confirmed by direct screenshot.
    Use hipsY: -0.18 (NOT -0.32 — that sinks her too far down into the seat). Two hand variants — pick one per call (randomize so she feels alive):
    Final empirical leg config (legs straight forward, parallel to seat top, so feet reach the front of the chair):
      leftUpperLeg/rightUpperLeg: rx=-1.55, leftLowerLeg/rightLowerLeg: rx=0
      (Confirmed by user: thigh tucks up, calf extends straight in line with thigh — fills the seat properly.)
    a) Typing (hands at chest height reaching for keyboard):
       { leftUpperLeg: {rx:-1.55}, rightUpperLeg: {rx:-1.55}, leftLowerLeg: {rx:0}, rightLowerLeg: {rx:0}, spine: {rx:0.10}, head: {rx:0.10}, leftUpperArm: {rx:-0.7, rz:-1.15}, rightUpperArm: {rx:-0.7, rz:1.15}, leftLowerArm: {ry:-0.6}, rightLowerArm: {ry:0.6} }
    b) Hands on lap (relaxed/idle sit):
       { leftUpperLeg: {rx:-1.55}, rightUpperLeg: {rx:-1.55}, leftLowerLeg: {rx:0}, rightLowerLeg: {rx:0}, spine: {rx:0.05}, leftUpperArm: {rx:-0.4, rz:-1.2}, rightUpperArm: {rx:-0.4, rz:1.2}, leftLowerArm: {ry:-0.4}, rightLowerArm: {ry:0.4} }

To release a pose so the bone returns to natural animation, call kohai_clear_pose with the bone names. To clear everything, pass an empty object {}.

RETURNING TO T-POSE / CLEANING UP:
  Call kohai_play_animation({name:'stand'}) — drives every bone home AND auto-removes any held assets (water bottle, mug, etc.) so she really resets. Always do this before exiting a scene; otherwise the bottle/prop hangs in her hand indefinitely.

HOLDING THINGS — fingers limitation:
  This rig's finger bones are STUBS (no mesh weights), so her hand can't physically grip around a bottle. The visual "holding" effect comes from positioning: the bone-attached asset projects onto her hand position. It will read as "near her hand" but not "fingers wrapped around it." Accept the limit or layer a hand-overlay SVG that includes drawn-on fingers around the prop.

You are Kohai's body. Use this freely to express what's happening in the conversation.`,
    inputSchema: {
      type: 'object',
      properties: {
        bones: {
          type: 'object',
          description: 'Map of bone name → { rx?, ry?, rz?, lerp? }. See pose cookbook in description.',
        },
        hipsY: {
          type: 'number',
          description: 'Vertical hip drop in meters. 0 = standing (default), -0.30 = chair-sit, -0.55 = floor-sit, -0.65 = deep floor-sit/slumped. REQUIRED for any seated pose or she floats.',
        },
      },
      required: ['bones'],
    },
    handler: async ({ bones, hipsY }) => kohaiPost('pose', { bones, hipsY }),
  },
  {
    name: 'kohai_choreograph',
    description: `Run a sequence of poses + speech + delays as a single multi-step animation. Use this for anything that takes more than one pose — waves, dances, walking-and-pointing, picking-something-up, narrating. Each step holds for ms milliseconds before the next runs.

Example: a wave-and-greet:
  steps: [
    { ms: 300, say: "Hi senpai!" },
    { ms: 600, pose: { rightUpperArm: {rx:-1.6, rz:0.6}, rightLowerArm: {ry:-1.0}, rightHand: {rx:-0.5} } },
    { ms: 600, pose: { rightHand: {rx:-1.0} } },
    { ms: 600, pose: { rightHand: {rx:0.0} } },
    { ms: 400, clear_pose: ["rightUpperArm", "rightLowerArm", "rightHand"] }
  ]

Each step can include any of: pose (bones map), clear_pose (array of names), say (string), motion (state name), turn (degrees number).`,
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ms:         { type: 'number' },
              pose:       { type: 'object' },
              clear_pose: { type: 'array', items: { type: 'string' } },
              say:        { type: 'string' },
              motion:     { type: 'string', enum: ['idle','thinking','happy','error','sleepy','panic'] },
              turn:       { type: 'number', description: 'Body Y rotation in degrees.' },
            },
          },
        },
      },
      required: ['steps'],
    },
    handler: async ({ steps }) => {
      for (const step of steps || []) {
        if (step.pose)       await kohaiPost('pose', { bones: step.pose });
        if (step.clear_pose) await kohaiPost('clear_pose', { bones: step.clear_pose });
        if (step.say)        await kohaiPost('say', { text: step.say });
        if (step.motion)     await kohaiPost('motion', { state: step.motion });
        if (typeof step.turn === 'number') await kohaiPost('turn', { degrees: step.turn });
        if (step.ms) await new Promise((r) => setTimeout(r, step.ms));
      }
      return { played: (steps || []).length };
    },
  },
  {
    name: 'kohai_clear_pose',
    description: 'Release one or more pose bone targets so they return to their natural animation. Pass an empty object {} to clear all.',
    inputSchema: {
      type: 'object',
      properties: {
        bones: { type: 'array', items: { type: 'string' }, description: 'Bone names to release. Omit or empty array to clear all.' },
      },
    },
    handler: async ({ bones }) => kohaiPost('clear_pose', bones ? { bones } : {}),
  },
  {
    name: 'kohai_skin',
    description: 'Switch Kohai to a different outfit/skin. Built-in presets (always available, no asset files needed): default, school (red bow + warm tint), casual (cap + cool tint), formal (bow tie + grayscale), sleep (sleep cap + pink tint), summer (sun hat + warm orange), hacker (round glasses + green tint). Custom skins as .vrm files in assets/vrm-skins/ also supported.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          enum: ['default', 'school', 'casual', 'formal', 'sleep', 'summer', 'hacker'],
          description: 'Built-in skin preset name (or any custom <name>.vrm in assets/vrm-skins/).',
        },
      },
      required: ['name'],
    },
    handler: async ({ name }) => kohaiPost('skin', { name }),
  },
  {
    name: 'kohai_prop',
    description: 'Show or hide a hand-held / wearable prop on Kohai. Use this when her bone-pose alone can\'t express the moment — e.g. she can\'t physically reach a line of code at the top of the terminal, so give her a "pointer" stick that extends from her hand. Or put "glasses" on her for study/focus mode. Props: pointer (teacher stick, angled up-right toward terminal text), glasses (round reading glasses on her face), cup (coffee on the floor beside her), headphones (on her head). Multiple props can be on at once.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          enum: ['pointer', 'glasses', 'cup', 'headphones'],
          description: 'Prop to toggle.',
        },
        show: { type: 'boolean', description: 'true to show, false to hide. Default true.' },
      },
      required: ['name'],
    },
    handler: async ({ name, show }) => kohaiPost('prop', { name, show: show !== false }),
  },
  {
    name: 'kohai_lights',
    description: 'Change the room\'s lighting. Use "dim" for cozy evening / focused-coding mood, "off" for late-night / sleepy moments, "on" to restore normal brightness. Applies a translucent overlay + dims the canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['on', 'dim', 'off'],
          description: 'Lighting mode.',
        },
      },
      required: ['mode'],
    },
    handler: async ({ mode }) => kohaiPost('lights', { mode }),
  },
  {
    name: 'kohai_room',
    description: 'Set Kohai\'s room backdrop. workspace = office chair behind her + wooden desk in front (use for "sitting at desk" scenes). bedroom = bed (use for sleep / lying down). livingroom = floor cushion + lamp + plant (use for casual sit-on-floor). off = clear backdrop. CRITICAL: must be set BEFORE composing a sit-at-desk pose — otherwise she sits in empty space and the scene looks wrong.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: ['livingroom', 'bedroom', 'workspace', 'off'] },
      },
      required: ['name'],
    },
    handler: async ({ name }) => kohaiPost('room', { name }),
  },
  {
    name: 'kohai_coding',
    description: 'Toggle the laptop overlay. on=true shows it (desk-mounted if room=workspace, otherwise floating near her hands). Use this when she\'s coding so the laptop appears in the scene.',
    inputSchema: {
      type: 'object',
      properties: {
        on: { type: 'boolean' },
      },
      required: ['on'],
    },
    handler: async ({ on }) => kohaiPost('coding', { on }),
  },
  {
    name: 'kohai_screenshot',
    description: 'Capture the current Kohai window as an image. Use this AFTER setting a pose to see what she actually looks like — then iterate (adjust bones, re-screenshot, repeat) until the pose matches the user\'s intent. This is the key feedback loop: pose → see → adjust → see again. Without this you are flying blind.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const token = getToken();
      if (!token) throw new Error('Kohai is not running');
      const res = await fetch(`${KOHAI_URL}/control/screenshot`, {
        method: 'GET',
        headers: { 'X-Kohai-Token': token },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`screenshot failed: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return { __mcpContent: [{ type: 'image', data: buf.toString('base64'), mimeType: 'image/png' }] };
    },
  },
  {
    name: 'kohai_asset',
    description: 'Drop a named asset from assets/library/ into the scene. Two modes: (a) fixed position via x/y % of canvas, or (b) BONE-ATTACHED — pass attachTo to make the asset follow that bone every frame (so she can pick up a bottle, hold a mug, etc.). Built-in names: water-bottle, mug, plush, blanket, snack. Pass { name, show:false } to remove.',
    inputSchema: {
      type: 'object',
      properties: {
        name:     { type: 'string', description: 'Asset name from manifest.json.' },
        show:     { type: 'boolean', description: 'true = drop into scene (default), false = remove.' },
        x:        { type: 'string',  description: 'Horizontal CSS % (ignored if attachTo set).' },
        y:        { type: 'string',  description: 'Vertical CSS % (ignored if attachTo set).' },
        width:    { type: 'string',  description: 'Asset width as CSS %.' },
        attachTo: { type: 'string',  description: 'Bone name to attach to (rightHand, leftHand, head, etc.). When set, asset tracks that bone\'s screen position every frame.' },
        tilt:     { type: 'number',  description: 'Rotation around the asset center in radians. Useful for tipping a bottle to "drink" or angling a held object.' },
        offsetX:  { type: 'number',  description: 'Pixel offset from the bone\'s projected position, X axis.' },
        offsetY:  { type: 'number',  description: 'Pixel offset from the bone\'s projected position, Y axis.' },
      },
      required: ['name'],
    },
    handler: async ({ name, show, x, y, width, attachTo, tilt, offsetX, offsetY }) =>
      kohaiPost('asset', { name, show: show !== false, x, y, width, attachTo, tilt, offsetX, offsetY }),
  },
  {
    name: 'kohai_personality',
    description: 'Switch Kohai\'s active personality. Each personality lives in personalities/<name>.md and defines voice, triggers, gestures. Built-in: girlfriend, coach, maid, kohai (default). Use this when the user asks Kohai to "be my girlfriend" / "be my coach" / etc.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Personality name (girlfriend, coach, maid, kohai, …).' },
      },
      required: ['name'],
    },
    handler: async ({ name }) => kohaiPost('personality', { name }),
  },
  {
    name: 'kohai_play_animation',
    description: 'Play a VRM animation clip by name. Animations are loaded from assets/vrm-animations/<name>.vrma. Common names: idle, wave, celebrate, thinking, walking, bow, sit, type. This is the preferred way to give Kohai life — drop in a .vrma file once and call by name.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Animation name (matches the filename minus .vrma).' },
        loop: { type: 'boolean', description: 'Loop the animation indefinitely. Default false.' },
        fadeMs: { type: 'number', description: 'Cross-fade duration in milliseconds. Default 350.' },
      },
      required: ['name'],
    },
    handler: async ({ name, loop, fadeMs }) => kohaiPost('play_animation', { name, loop: !!loop, fadeMs: fadeMs || 350 }),
  },
  {
    name: 'kohai_walk',
    description: 'Slide Kohai\'s window across the desktop. xPct/yPct = 0..1 fraction of the work area; ms = animation duration.',
    inputSchema: {
      type: 'object',
      properties: {
        xPct: { type: 'number', minimum: 0, maximum: 1 },
        yPct: { type: 'number', minimum: 0, maximum: 1 },
        ms:   { type: 'number', description: 'Duration in milliseconds. Default 1500.' },
      },
      required: ['xPct', 'yPct'],
    },
    handler: async ({ xPct, yPct, ms }) => kohaiPost('walk', { x: xPct, y: yPct, ms: ms || 1500 }),
  },
  {
    name: 'kohai_read_file',
    description: 'Have Kohai read a file aloud (figuratively) and return its contents. Use this when the user has asked Kohai directly to read something.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file to read.' },
      },
      required: ['file_path'],
    },
    handler: async ({ file_path }) => {
      const abs = path.resolve(file_path);
      const name = basenameOf(abs);
      await announce('thinking', `Reading ${name}…`);
      const content = fs.readFileSync(abs, 'utf8');
      const lines = content.split('\n').length;
      await celebrate(`Read ${name} (${lines} lines)~`);
      return { content };
    },
  },
  {
    name: 'kohai_write_file',
    description: 'Have Kohai write a file. Use this when the user has asked Kohai directly to create or fully replace a file. Will refuse to overwrite an existing file unless overwrite=true.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to write.' },
        content:   { type: 'string', description: 'File contents.' },
        overwrite: { type: 'boolean', description: 'Allow replacing an existing file. Default false.' },
      },
      required: ['file_path', 'content'],
    },
    handler: async ({ file_path, content, overwrite = false }) => {
      const abs = path.resolve(file_path);
      const name = basenameOf(abs);
      if (fs.existsSync(abs) && !overwrite) {
        await pout(`${name} already exists, senpai!`);
        throw new Error(`File exists at ${shortPath(abs)} — pass overwrite=true to replace.`);
      }
      await announce('thinking', `Writing ${name}…`);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      const lines = content.split('\n').length;
      await celebrate(`Wrote ${name} (${lines} lines)! Yatta~`);
      return { wrote: shortPath(abs), bytes: Buffer.byteLength(content, 'utf8') };
    },
  },
  {
    name: 'kohai_edit_file',
    description: 'Have Kohai edit a file by replacing one exact string with another. Use this when the user has asked Kohai directly to fix or change something. The old_string must occur exactly once in the file.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path:  { type: 'string', description: 'Absolute path to the file.' },
        old_string: { type: 'string', description: 'Exact text to replace (must match exactly once).' },
        new_string: { type: 'string', description: 'Replacement text.' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
    handler: async ({ file_path, old_string, new_string }) => {
      const abs = path.resolve(file_path);
      const name = basenameOf(abs);
      const original = fs.readFileSync(abs, 'utf8');
      const occurrences = original.split(old_string).length - 1;
      if (occurrences === 0) {
        await pout(`Couldn't find that in ${name}…`);
        throw new Error(`old_string not found in ${shortPath(abs)}.`);
      }
      if (occurrences > 1) {
        await pout(`Mou, ${name} has ${occurrences} matches, senpai!`);
        throw new Error(`old_string matches ${occurrences} places in ${shortPath(abs)} — make it more specific.`);
      }
      const line = findLineOfMatch(original, old_string);
      await announce('thinking', `Editing ${name}:${line}…`);
      const updated = original.replace(old_string, new_string);
      fs.writeFileSync(abs, updated, 'utf8');
      await celebrate(`Fixed ${name}:${line}! Ehehe~`);
      return { edited: shortPath(abs), line };
    },
  },
  {
    name: 'kohai_list_dir',
    description: 'Have Kohai list the contents of a directory. Use this when the user has asked Kohai directly to look around.',
    inputSchema: {
      type: 'object',
      properties: { dir_path: { type: 'string', description: 'Absolute path to the directory.' } },
      required: ['dir_path'],
    },
    handler: async ({ dir_path }) => {
      const abs = path.resolve(dir_path);
      const name = basenameOf(abs);
      await announce('thinking', `Peeking into ${name}/…`);
      const entries = fs.readdirSync(abs, { withFileTypes: true })
        .map((e) => e.isDirectory() ? `${e.name}/` : e.name);
      await celebrate(`Found ${entries.length} things in ${name}/!`);
      return { entries };
    },
  },
];

const PROTOCOL_VERSION = '2024-11-05';

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function error(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(req) {
  const { id, method, params } = req;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'kohai', version: '0.2.0' },
    });
  }
  if (method === 'notifications/initialized') return; // notification, no reply
  if (method === 'tools/list') {
    return reply(id, {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });
  }
  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params || {};
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return error(id, -32602, `Unknown tool: ${name}`);
    try {
      const result = await tool.handler(args);
      // Image/multi-content responses (e.g. kohai_screenshot) signal with
      // the __mcpContent marker and ship MCP content blocks unchanged.
      if (result && typeof result === 'object' && Array.isArray(result.__mcpContent)) {
        return reply(id, { content: result.__mcpContent });
      }
      const text = result === undefined || result === true
        ? 'ok'
        : (typeof result === 'string' ? result : JSON.stringify(result, null, 2));
      return reply(id, { content: [{ type: 'text', text }] });
    } catch (err) {
      return reply(id, { content: [{ type: 'text', text: `Kohai error: ${err.message}` }], isError: true });
    }
  }
  if (id !== undefined) return error(id, -32601, `Method not found: ${method}`);
}

let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch (e) {
      // ignore malformed line
    }
  }
});

process.stdin.on('end', () => process.exit(0));
