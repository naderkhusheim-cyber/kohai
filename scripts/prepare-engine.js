#!/usr/bin/env node
// Copies the VOICEVOX engine into resources/voicevox-engine/ before electron-builder runs.
// Source: /Applications/VOICEVOX.app/Contents/Resources/vv-engine (~2 GB)
// Destination: resources/voicevox-engine/

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRC = '/Applications/VOICEVOX.app/Contents/Resources/vv-engine';
const DST = path.join(__dirname, '..', 'resources', 'voicevox-engine');

if (!fs.existsSync(SRC)) {
  console.error(`[prepare-engine] not found: ${SRC}`);
  console.error('Install VOICEVOX from https://voicevox.hiroshiba.jp/ first.');
  process.exit(1);
}

if (fs.existsSync(DST)) {
  console.log(`[prepare-engine] removing existing ${DST}`);
  fs.rmSync(DST, { recursive: true, force: true });
}

fs.mkdirSync(path.dirname(DST), { recursive: true });
console.log(`[prepare-engine] copying engine (~2 GB) — this takes a minute…`);
execSync(`cp -R "${SRC}" "${DST}"`, { stdio: 'inherit' });
console.log(`[prepare-engine] done → ${DST}`);
