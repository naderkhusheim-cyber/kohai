const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const KOHAI_DIR = path.join(os.homedir(), '.kohai');
const TOKEN_PATH = path.join(KOHAI_DIR, 'token');
const PORT = 17455;

const VALID_CONTROLS = ['say', 'motion', 'size', 'position', 'hide', 'show', 'walk', 'turn', 'pose', 'clear_pose', 'play_animation', 'skin', 'roommate'];

function getOrCreateToken() {
  fs.mkdirSync(KOHAI_DIR, { recursive: true });
  if (fs.existsSync(TOKEN_PATH)) {
    return fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  }
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  return token;
}

module.exports = function startServer({ onEvent, onControl }) {
  const token = getOrCreateToken();
  const server = express();
  server.use(express.json({ limit: '256kb' }));

  server.post('/event/:type', (req, res) => {
    if (req.headers['x-kohai-token'] !== token) return res.status(401).end();
    onEvent(req.params.type, req.body);
    res.status(204).end();
  });

  server.post('/control/:cmd', (req, res) => {
    if (req.headers['x-kohai-token'] !== token) return res.status(401).end();
    const cmd = req.params.cmd;
    if (!VALID_CONTROLS.includes(cmd)) return res.status(400).json({ error: 'unknown control', valid: VALID_CONTROLS });
    onControl(cmd, req.body || {});
    res.status(204).end();
  });

  server.get('/health', (_req, res) => res.json({ ok: true, token_path: TOKEN_PATH }));

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Kohai server listening on 127.0.0.1:${PORT}`);
  });
};
