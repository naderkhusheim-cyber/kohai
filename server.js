const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { matchScene, SCENES_INDEX } = require('./scenes-index');

const KOHAI_DIR = path.join(os.homedir(), '.kohai');
const TOKEN_PATH = path.join(KOHAI_DIR, 'token');
const PORT = 17455;

const VALID_CONTROLS = ['say', 'motion', 'size', 'position', 'hide', 'show', 'walk', 'turn', 'pose', 'clear_pose', 'play_animation', 'skin', 'roommate', 'prop', 'lights', 'room', 'coding', 'asset', 'personality', 'body_prop', 'scene'];

function getOrCreateToken() {
  fs.mkdirSync(KOHAI_DIR, { recursive: true });
  if (fs.existsSync(TOKEN_PATH)) {
    return fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  }
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
  return token;
}

module.exports = function startServer({ onEvent, onControl, onCapture }) {
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

  // Capture the Kohai window as a PNG. Used by the kohai_screenshot MCP
  // tool so Claude can SEE the current pose and iterate against a target.
  server.get('/control/screenshot', async (req, res) => {
    if (req.headers['x-kohai-token'] !== token) return res.status(401).end();
    if (!onCapture) return res.status(501).json({ error: 'capture not supported' });
    try {
      const png = await onCapture();
      res.set('Content-Type', 'image/png');
      res.send(png);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  server.get('/health', (_req, res) => res.json({ ok: true, token_path: TOKEN_PATH }));

  // Scene lookup — server-side keyword match against the canonical
  // scene registry. Returns { matched: <name> | null }. Used by bin/k
  // and the /kohai-do skill to decide whether a request can be
  // served by a hand-tuned scene (instant, always correct) or has to
  // fall back to live composition by Claude.
  server.get('/scene/match', (req, res) => {
    if (req.headers['x-kohai-token'] !== token) return res.status(401).end();
    const text = String(req.query.text || '');
    const matched = matchScene(text);
    res.json({ matched, scenes: Object.keys(SCENES_INDEX) });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Kohai server listening on 127.0.0.1:${PORT}`);
  });
};
