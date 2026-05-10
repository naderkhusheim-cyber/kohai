#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const MARKER = 'dispatch.sh';

if (!fs.existsSync(SETTINGS)) {
  console.log('No Claude settings.json found — nothing to remove.');
  process.exit(0);
}

const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
if (!s.hooks) {
  console.log('No hooks block — nothing to remove.');
  process.exit(0);
}

let removed = 0;
for (const evt of Object.keys(s.hooks)) {
  const cleaned = (s.hooks[evt] || []).map(item => ({
    ...item,
    hooks: (item.hooks || []).filter(h => {
      const isKohai = (h.command || '').includes(MARKER);
      if (isKohai) removed++;
      return !isKohai;
    }),
  })).filter(item => (item.hooks || []).length > 0);

  if (cleaned.length === 0) delete s.hooks[evt];
  else s.hooks[evt] = cleaned;
}

fs.copyFileSync(SETTINGS, SETTINGS + '.kohai-backup');
fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2));
console.log(`✅ Removed ${removed} Kohai hook entr${removed === 1 ? 'y' : 'ies'} from`, SETTINGS);
