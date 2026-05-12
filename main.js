const { app, BrowserWindow, screen, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const startServer = require('./server');
const { reactToPrompt } = require('./prompt-reactor');

let win;
let engineProcess = null;
let lastCustomSayAt = 0;
const CUSTOM_SAY_PROTECT_MS = 6000;
const VOICEVOX_PORT = 50021;

function getEnginePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'voicevox-engine', 'run');
  }
  // Dev fallback: use the locally installed VOICEVOX.app engine.
  return '/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run';
}

async function isEngineUp() {
  try {
    const res = await fetch(`http://127.0.0.1:${VOICEVOX_PORT}/version`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function startEngine() {
  if (await isEngineUp()) return; // user already has VOICEVOX.app running
  const enginePath = getEnginePath();
  if (!fs.existsSync(enginePath)) {
    console.warn('[kohai] voicevox engine not found at', enginePath);
    return;
  }
  engineProcess = spawn(enginePath, ['--host', '127.0.0.1', '--port', String(VOICEVOX_PORT)], {
    cwd: path.dirname(enginePath),
    stdio: 'ignore',
    detached: false,
  });
  engineProcess.on('error', (err) => console.warn('[kohai] engine spawn error:', err.message));
  engineProcess.on('exit', () => { engineProcess = null; });
}

function stopEngine() {
  if (engineProcess && !engineProcess.killed) {
    try { engineProcess.kill('SIGTERM'); } catch (_) {}
    engineProcess = null;
  }
}

const SIZES = {
  small:    { w: 240, h: 320 },
  medium:   { w: 320, h: 400 },
  large:    { w: 480, h: 600 },
  xl:       { w: 640, h: 800 },
  // Full-body — narrow + tall so her whole standing figure fits with
  // room for an extended arm reaching toward the terminal behind her.
  fullbody: { w: 420, h: 960 },
};

function getDisplayWorkArea() {
  const display = win
    ? screen.getDisplayMatching(win.getBounds())
    : screen.getPrimaryDisplay();
  return display.workArea;
}

function computePosition(name, w, h) {
  const { x: dx, y: dy, width: dw, height: dh } = getDisplayWorkArea();
  const m = 20;
  switch (name) {
    case 'top-left':     return { x: dx + m,            y: dy + m };
    case 'top-right':    return { x: dx + dw - w - m,   y: dy + m };
    case 'bottom-left':  return { x: dx + m,            y: dy + dh - h - m };
    case 'center':       return { x: dx + Math.round((dw - w) / 2), y: dy + Math.round((dh - h) / 2) };
    case 'bottom-right':
    default:             return { x: dx + dw - w - m,   y: dy + dh - h - m };
  }
}

function clampToDisplay(x, y, w, h) {
  const { x: dx, y: dy, width: dw, height: dh } = getDisplayWorkArea();
  const m = 8;
  return {
    x: Math.min(Math.max(dx + m, x), dx + dw - w - m),
    y: Math.min(Math.max(dy + m, y), dy + dh - h - m),
  };
}

let restingPosition = null; // remembers where to drift back to
let walkInProgress = false; // true while a kohai_walk slide is animating

// Manual per-frame tween — macOS's native setBounds animate flag misbehaves
// on transparent always-on-top windows (teleports), so we drive position
// updates ourselves at ~30fps with ease-out cubic.
let _moveAnim = null;
function smoothMoveTo(targetX, targetY, durationMs = 700) {
  if (!win || win.isDestroyed()) return;
  if (_moveAnim) { clearInterval(_moveAnim); _moveAnim = null; }
  const [startX, startY] = win.getPosition();
  const [w, h] = win.getSize();
  const { x: tx, y: ty } = clampToDisplay(targetX, targetY, w, h);
  const start = Date.now();
  _moveAnim = setInterval(() => {
    if (!win || win.isDestroyed()) { clearInterval(_moveAnim); _moveAnim = null; return; }
    const t = Math.min(1, (Date.now() - start) / durationMs);
    const e = 1 - Math.pow(1 - t, 3);
    const cx = Math.round(startX + (tx - startX) * e);
    const cy = Math.round(startY + (ty - startY) * e);
    try { win.setPosition(cx, cy); } catch (_) {}
    if (t >= 1) { clearInterval(_moveAnim); _moveAnim = null; }
  }, 33);
}

function moveToWorkPosition() {
  if (!win || win.isDestroyed()) return;
  const [curX, curY] = win.getPosition();
  if (!restingPosition) restingPosition = { x: curX, y: curY };
  const { x: dx, y: dy, width: dw, height: dh } = getDisplayWorkArea();
  const [w, h] = win.getSize();
  // Slide toward bottom-center — like she walked over to peek at the work.
  const targetX = dx + Math.round((dw - w) / 2);
  const targetY = dy + dh - h - 24;
  smoothMoveTo(targetX, targetY, 1200);
}

function moveToRest() {
  if (!restingPosition) return;
  smoothMoveTo(restingPosition.x, restingPosition.y, 1200);
  restingPosition = null;
}

// Scenario-driven window walk: the renderer asks us to slide the window
// to (x_offset_pct, y_offset_pct) of the current display work area over
// `ms` milliseconds. Used by the userPromptScenario walk-out / walk-back.
function walkWindowTo(xPct, yPct, ms) {
  if (!win || win.isDestroyed()) return;
  const { x: dx, y: dy, width: dw, height: dh } = getDisplayWorkArea();
  const [w, h] = win.getSize();
  const targetX = dx + Math.round((dw - w) * xPct);
  const targetY = dy + Math.round((dh - h) * yPct);
  const [curX] = win.getPosition();
  const duration = ms || 1500;

  // Face the direction of travel. Mostly-horizontal moves get a 90° side
  // profile; ignore the turn if she's barely moving horizontally (purely
  // vertical slide).
  const dxPixels = targetX - curX;
  if (Math.abs(dxPixels) > 30) {
    const faceRadians = dxPixels < 0 ? -Math.PI / 2 : Math.PI / 2;
    win.webContents.send('kohai:control', { cmd: 'turn', payload: { radians: faceRadians } });
  }

  // Auto-cycle her legs for the duration of the slide.
  walkInProgress = true;
  win.webContents.send('kohai:control', { cmd: 'play_animation', payload: { name: 'walking', loop: true } });
  smoothMoveTo(targetX, targetY, duration);
  setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('kohai:control', { cmd: 'play_animation', payload: { name: 'walking_stop' } });
    win.webContents.send('kohai:control', { cmd: 'turn', payload: { radians: 0 } });
    walkInProgress = false;
  }, duration + 100);
}

function createWindow() {
  const size = SIZES.medium;
  const pos = computePosition('bottom-right', size.w, size.h);

  win = new BrowserWindow({
    width: size.w,
    height: size.h,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  // Surface renderer console to main-process stdout for debugging.
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Pick renderer based on ~/.kohai/config.json: { "renderer": "vrm" | "live2d" }
  const cfg = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(require('os').homedir(), '.kohai', 'config.json'), 'utf8'));
    } catch (_) { return {}; }
  })();
  const useVRM = cfg.renderer === 'vrm';
  win.loadFile(useVRM ? 'renderer/vrm.html' : 'renderer/index.html');
}

function applyControl(cmd, payload) {
  if (!win || win.isDestroyed()) return;

  if (cmd === 'hide') return win.hide();
  if (cmd === 'show') { win.show(); return; }

  if (cmd === 'size') {
    const name = payload.name || 'medium';
    const s = SIZES[name];
    if (!s) return;
    const [curX, curY] = win.getPosition();
    const [curW, curH] = win.getSize();
    // Anchor by center so scaling up doesn't drift the window off-screen.
    const cx = curX + curW / 2;
    const cy = curY + curH / 2;
    const targetX = Math.round(cx - s.w / 2);
    const targetY = Math.round(cy - s.h / 2);
    const { x, y } = clampToDisplay(targetX, targetY, s.w, s.h);
    win.setSize(s.w, s.h);
    win.setPosition(x, y);
    win.webContents.send('kohai:resize', s);
    return;
  }

  if (cmd === 'position') {
    const name = payload.name || 'bottom-right';
    const [w, h] = win.getSize();
    const pos = computePosition(name, w, h);
    win.setPosition(pos.x, pos.y);
    return;
  }

  if (cmd === 'walk') {
    walkWindowTo(payload.x, payload.y, payload.ms || 1500);
    return;
  }

  if (cmd === 'say' || cmd === 'motion') {
    lastCustomSayAt = Date.now();
  }
  // say / motion → forward to renderer
  win.webContents.send('kohai:control', { cmd, payload });
}

async function handleUserPrompt(data) {
  if (!win || win.isDestroyed()) return;
  const prompt = (data && (data.prompt || data.user_prompt || data.text)) || '';
  if (!prompt) return;
  try {
    const reaction = await reactToPrompt(prompt);
    if (!reaction) return;
    lastCustomSayAt = Date.now();
    win.webContents.send('kohai:control', { cmd: 'motion', payload: { state: reaction.state, text: reaction.text } });
  } catch (_) {
    // silent — fall back to whatever motion the renderer already set
  }
}

function shouldSkipPostToolReaction() {
  return Date.now() - lastCustomSayAt < CUSTOM_SAY_PROTECT_MS;
}

app.whenReady().then(() => {
  // Self-install: wire up Claude Code hooks, slash commands, and MCP
  // server every launch (idempotent). User just opens Kohai once and
  // every Claude Code session afterward picks up the integration.
  try { require('./scripts/setup-claude').main(); } catch (e) { console.warn('[kohai] setup-claude failed:', e.message); }

  ipcMain.on('kohai:walk', (_evt, { x, y, ms }) => walkWindowTo(x, y, ms));
  // Renderer-initiated resize (poses that need extra height like "touch"
  // or "code_at_desk" call this to switch to the fullbody window).
  ipcMain.on('kohai:resize-request', (_evt, { name }) => applyControl('size', { name }));
  startEngine();
  createWindow();
  startServer({
    // Capture the current Kohai window as a PNG buffer. Lets Claude SEE
    // what she actually looks like after a pose, so he can iterate.
    onCapture: async () => {
      if (!win || win.isDestroyed()) throw new Error('window not ready');
      const image = await win.webContents.capturePage();
      return image.toPNG();
    },
    onEvent: (eventType, data) => {
      if (!win || win.isDestroyed()) return;
      if (eventType === 'UserPromptSubmit') {
        handleUserPrompt(data);
        return;
      }
      // Move-to-action: slide toward center-bottom on coding tools.
      // Skip while a walk is in progress so the two animations don't fight.
      const codingTools = new Set(['Edit', 'MultiEdit', 'Write', 'Bash']);
      if (eventType === 'PreToolUse' && codingTools.has(data?.tool_name) && !walkInProgress) {
        moveToWorkPosition();
      } else if (eventType === 'Stop') {
        // Session settled — drift back home.
        setTimeout(moveToRest, 1500);
      }
      if (
        (eventType === 'PreToolUse' ||
         eventType === 'PostToolUse' ||
         eventType === 'Stop' ||
         eventType === 'SubagentStop' ||
         eventType === 'Notification') &&
        shouldSkipPostToolReaction()
      ) {
        return;
      }
      win.webContents.send('kohai:event', { type: eventType, data });
    },
    onControl: applyControl,
  });
});

app.on('before-quit', stopEngine);
app.on('will-quit', stopEngine);

app.on('window-all-closed', () => {
  stopEngine();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
