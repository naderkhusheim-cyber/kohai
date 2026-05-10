#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', 'slash-commands');
const DST_DIR = path.join(os.homedir(), '.claude', 'commands');

fs.mkdirSync(DST_DIR, { recursive: true });

const installed = [];
for (const file of fs.readdirSync(SRC_DIR)) {
  if (!file.endsWith('.md')) continue;
  fs.copyFileSync(path.join(SRC_DIR, file), path.join(DST_DIR, file));
  installed.push('/' + file.replace(/\.md$/, ''));
}

console.log('Installed Kohai slash commands at', DST_DIR);
console.log('  ' + installed.join('  '));
console.log('In any Claude Code session, type / and pick from the list.');
