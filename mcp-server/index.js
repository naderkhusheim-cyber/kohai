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
  if (!token) throw new Error('Kohai not initialized — token missing. Launch Kohai first.');
  const res = await fetch(`${KOHAI_URL}/control/${cmd}`, {
    method: 'POST',
    headers: {
      'X-Kohai-Token': token,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : '',
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`Kohai returned ${res.status}`);
  return true;
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
      await tool.handler(args);
      return reply(id, { content: [{ type: 'text', text: 'ok' }] });
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
