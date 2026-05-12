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

ANATOMY (14 bones, all rotations in radians):
  head, neck, spine, hips
  leftUpperArm, rightUpperArm   — shoulder
  leftLowerArm, rightLowerArm   — forearm (elbow)
  leftHand, rightHand           — wrist
  leftUpperLeg, rightUpperLeg   — hip-to-knee
  leftLowerLeg, rightLowerLeg   — shin

ROTATION CONVENTIONS (this rig's bone bind is non-standard — these are EMPIRICAL, not VRM spec):
  head.rx >0 = looks down, <0 = looks up
  head.ry >0 = looks right, <0 = looks left
  head.rz >0 = tilts head right, <0 = tilts left
  spine.rx <0 = leans forward (chest forward)
  upperArm.rz: arm at her side requires LEFT≈-1.3, RIGHT≈+1.3
  upperArm.rx <0 = arm swings forward; >0 = backward
  lowerArm.ry: positive on left, negative on right = elbow bends in
  hand.rx >0 = palm down
  upperLeg.rx >0 = thigh kicks FORWARD (seated); <0 = knee tucks up to chest
  lowerLeg.rx <0 = calf bends back-down (anatomical knee bend after thigh-forward)
  Each bone target accepts an optional 'lerp' (default 6, range 1-15) — higher = snaps faster.

CRITICAL — hipsY for seated/lying poses:
  Bending the legs alone leaves her at standing hip height (bent-knee-float).
  To put her butt on the floor, pass hipsY at the TOP level of the call:
    { hipsY: -0.55, bones: { leftUpperLeg: { rx: 1.40 }, ... } }
  Range: 0 (standing) → -0.30 (chair-sit) → -0.65 (deep floor-sit).

POSE COOKBOOK — copy and adapt:
  WAVE:           { rightUpperArm: {rx:-1.6, rz:0.6}, rightLowerArm: {ry:-1.0}, rightHand: {rx:-0.5} }
  POINT_FORWARD:  { rightUpperArm: {rx:-1.5, rz:0.4}, rightLowerArm: {ry:-0.2} }
  HANDS_UP:       { leftUpperArm: {rx:0, rz:-2.5}, rightUpperArm: {rx:0, rz:2.5} }
  ARMS_AT_SIDES:  { leftUpperArm: {rz:-1.3}, rightUpperArm: {rz:1.3} }
  THINKING_CHIN:  { rightUpperArm: {rx:-1.4, rz:0.55}, rightLowerArm: {ry:-1.3}, rightHand: {rx:-0.5}, head: {rx:0.2, rz:-0.15} }
  SHRUG:          { leftUpperArm: {rx:-0.5, rz:-1.0}, rightUpperArm: {rx:-0.5, rz:1.0}, leftLowerArm: {ry:-0.9}, rightLowerArm: {ry:0.9} }
  PEEK_FORWARD:   { spine: {rx:-0.25, ry:0.15}, head: {rx:0.3} }
  BOW:            { spine: {rx:-0.5}, head: {rx:0.45} }
  HEAD_TILT_CUTE: { head: {rx:0.1, rz:0.4} }
  CROSS_ARMS:     { leftUpperArm: {rx:-0.6, rz:-0.5}, rightUpperArm: {rx:-0.6, rz:0.5}, leftLowerArm: {ry:-1.5}, rightLowerArm: {ry:1.5} }
  FLOOR_SIT (use with hipsY: -0.55):  { leftUpperLeg: {rx:1.40, rz:0.08}, rightUpperLeg: {rx:1.40, rz:-0.08}, leftLowerLeg: {rx:-1.30}, rightLowerLeg: {rx:-1.30}, spine: {rx:0.05}, leftUpperArm: {rx:-0.2, rz:-1.15}, rightUpperArm: {rx:-0.2, rz:1.15}, leftLowerArm: {ry:-0.5}, rightLowerArm: {ry:0.5} }
  CHAIR_SIT (use with hipsY: -0.30, after dropping chair via kohai_asset): { leftUpperLeg: {rx:1.55}, rightUpperLeg: {rx:1.55}, leftLowerLeg: {rx:-1.55}, rightLowerLeg: {rx:-1.55}, spine: {rx:-0.15} }

To release a pose so the bone returns to natural animation, call kohai_clear_pose with the bone names. To clear everything, pass an empty object {}.

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
