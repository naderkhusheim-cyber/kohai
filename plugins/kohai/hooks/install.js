#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const DISPATCH = path.resolve(__dirname, 'dispatch.sh');
const EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStop',
  'Stop',
  'Notification',
];

function loadSettings() {
  if (!fs.existsSync(SETTINGS)) return {};
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); }
  catch (e) {
    console.error('Could not parse', SETTINGS, '- aborting to avoid corrupting it.');
    process.exit(1);
  }
}

function saveSettings(s) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  if (fs.existsSync(SETTINGS)) {
    fs.copyFileSync(SETTINGS, SETTINGS + '.kohai-backup');
  }
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2));
}

const s = loadSettings();
s.hooks = s.hooks || {};
fs.chmodSync(DISPATCH, 0o755);

for (const evt of EVENTS) {
  s.hooks[evt] = s.hooks[evt] || [];
  const cmd = `${DISPATCH} ${evt}`;
  const exists = (s.hooks[evt] || []).some(item =>
    (item.hooks || []).some(h => h.command === cmd)
  );
  if (!exists) {
    s.hooks[evt].push({ hooks: [{ type: 'command', command: cmd }] });
  }
}

saveSettings(s);
console.log('✅ Kohai hooks installed at', SETTINGS);
console.log('   Backup saved at', SETTINGS + '.kohai-backup');
console.log('   Run uninstall via: node', path.resolve(__dirname, 'uninstall.js'));
