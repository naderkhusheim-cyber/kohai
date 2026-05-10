#!/usr/bin/env node
// Self-installer — wires Kohai into Claude Code with no marketplace dance.
// Runs idempotently. Safe to call on every Kohai launch.
//
// Installs:
//   1. Slash commands → ~/.claude/commands/
//   2. Lifecycle hooks → ~/.claude/settings.json
//   3. MCP server     → ~/.claude/settings.json (mcpServers field)
//
// Backs up the existing settings.json once, the first time it touches it.

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');

// Resolve plugin source whether we're running from repo (scripts/setup-claude.js)
// or bundled inside Kohai.app's resources.
function pluginRoot() {
  const candidates = [
    path.resolve(__dirname, '..', 'plugins', 'kohai'),                  // dev: scripts/../plugins/kohai
    path.resolve(__dirname, '..', '..', 'plugins', 'kohai'),            // packaged
    path.resolve(process.resourcesPath || '', 'app.asar.unpacked', 'plugins', 'kohai'),
    path.resolve(process.resourcesPath || '', 'plugins', 'kohai'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, '.claude-plugin', 'plugin.json'))) return c;
  }
  return candidates[0]; // fall through; will fail visibly
}
const PLUGIN_ROOT = pluginRoot();
const COMMANDS_SRC = path.join(PLUGIN_ROOT, 'commands');
const HOOKS_DISPATCH = path.join(PLUGIN_ROOT, 'hooks', 'dispatch.sh');
const MCP_SERVER = path.join(PLUGIN_ROOT, 'mcp-server', 'index.js');

const HOOK_EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'SubagentStop', 'Stop', 'Notification',
];

function loadSettings() {
  if (!fs.existsSync(SETTINGS)) return {};
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); }
  catch (_) { return {}; }
}

function saveSettings(s) {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  if (fs.existsSync(SETTINGS) && !fs.existsSync(SETTINGS + '.kohai-backup')) {
    fs.copyFileSync(SETTINGS, SETTINGS + '.kohai-backup');
  }
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2));
}

function installCommands() {
  if (!fs.existsSync(COMMANDS_SRC)) return [];
  fs.mkdirSync(COMMANDS_DIR, { recursive: true });
  const installed = [];
  for (const file of fs.readdirSync(COMMANDS_SRC)) {
    if (!file.endsWith('.md')) continue;
    fs.copyFileSync(path.join(COMMANDS_SRC, file), path.join(COMMANDS_DIR, file));
    installed.push(file);
  }
  return installed;
}

function installHooks(s) {
  if (!fs.existsSync(HOOKS_DISPATCH)) return false;
  try { fs.chmodSync(HOOKS_DISPATCH, 0o755); } catch (_) {}
  s.hooks = s.hooks || {};
  for (const evt of HOOK_EVENTS) {
    s.hooks[evt] = s.hooks[evt] || [];
    const cmd = `${HOOKS_DISPATCH} ${evt}`;
    // Strip any prior Kohai hooks that pointed at the OLD path so we
    // don't accumulate duplicates after restructuring or reinstalling.
    s.hooks[evt] = s.hooks[evt].filter((entry) => {
      const cmds = (entry.hooks || []).map((h) => h.command || '');
      return !cmds.some((c) => /\bkohai\b.*\/dispatch\.sh/.test(c) || /Kohai\.app.*dispatch\.sh/.test(c));
    });
    s.hooks[evt].push({ hooks: [{ type: 'command', command: cmd, timeout: evt === 'SessionStart' ? 6 : 3 }] });
  }
  return true;
}

function installMcp(s) {
  if (!fs.existsSync(MCP_SERVER)) return false;
  s.mcpServers = s.mcpServers || {};
  s.mcpServers.kohai = {
    command: 'node',
    args: [MCP_SERVER],
  };
  return true;
}

function main() {
  if (!fs.existsSync(CLAUDE_DIR)) {
    console.log('[kohai-setup] Claude Code not detected at', CLAUDE_DIR, '— skipping setup.');
    return;
  }
  const cmds = installCommands();
  const s = loadSettings();
  const hooksOk = installHooks(s);
  const mcpOk = installMcp(s);
  saveSettings(s);
  console.log(`[kohai-setup] Installed ${cmds.length} slash commands, ${hooksOk ? '9 hooks' : '0 hooks'}, ${mcpOk ? '1 MCP server' : '0 MCP server'}.`);
  console.log(`[kohai-setup] Plugin root: ${PLUGIN_ROOT}`);
}

if (require.main === module) main();

module.exports = { main };
