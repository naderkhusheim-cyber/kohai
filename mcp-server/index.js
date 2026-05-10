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
