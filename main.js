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
  small:  { w: 240, h: 320 },
  medium: { w: 320, h: 400 },
  large:  { w: 480, h: 600 },
  xl:     { w: 640, h: 800 },
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

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile('renderer/index.html');
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
  startEngine();
  createWindow();
  startServer({
    onEvent: (eventType, data) => {
      if (!win || win.isDestroyed()) return;
      if (eventType === 'UserPromptSubmit') {
        handleUserPrompt(data);
        return;
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
