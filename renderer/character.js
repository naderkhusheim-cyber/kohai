const container = document.querySelector('.kohai-container');
const canvas = document.getElementById('canvas');
const bubble = document.getElementById('bubble');
const loading = document.getElementById('loading');

const LINES = {
  idle: ['Hi senpai! Ready to code?', 'Ehehe~ welcome back!'],
  thinking: ['Hmm, let me see…', 'Working on it, senpai!', 'Ooh, what\'s this?', 'Leave it to me!'],
  happy: ['Yatta!', 'Done~!', 'Ehehe, easy!', 'Sugoi, it worked!', 'All good, senpai!'],
  error: ['Eh?? Something went wrong…', 'Gomen, senpai…', 'Mou, that\'s not right…', 'Uwaa, error!'],
  sleepy: ['Mou, where did senpai go?', 'Senpai? Are you there?', '*yawn*'],
  panic: ['Senpai, I\'m running out of memory!', 'My head is getting full…'],
};

const AUDIO = {
  thinking: 'thinking.mp3',
  happy: 'happy.mp3',
  error: 'error.mp3',
  sleepy: 'sleepy.mp3',
  panic: 'panic.mp3',
};

const STATE_MOTIONS = {
  idle:     ['Idle', 0],
  thinking: ['Idle', 4],
  happy:    ['TapBody', 0],
  error:    ['Idle', 1],
  sleepy:   ['Idle', 7],
  panic:    ['TapBody', 0],
};

let app, model;
let viewW = 320, viewH = 380;
let currentState = 'idle';
let bubbleTimer = null;
let idleTimer = null;

function pickLine(state) {
  const lines = LINES[state];
  if (!lines || !lines.length) return '';
  return lines[Math.floor(Math.random() * lines.length)];
}

function say(text, ms = 3500) {
  if (!text) return;
  bubble.textContent = text;
  bubble.classList.add('show');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
  if (window.kohaiVoicevox) window.kohaiVoicevox.speakLine(text);
}

function playAudio(state) {
  const file = AUDIO[state];
  if (!file) return;
  const audio = new Audio(`../assets/audio/${file}`);
  audio.volume = 0.7;
  audio.play().catch(() => {});
}

async function maybePlayEmotionBark(state) {
  // VOICEVOX speaks the bubble line — don't double up with a canned bark.
  // Only play the canned emotion MP3 when VOICEVOX is offline.
  if (window.kohaiVoicevox && (await window.kohaiVoicevox.isAvailable())) return;
  playAudio(state);
}

function fitModel() {
  if (!model || !app) return;
  const origW = model.internalModel?.originalWidth || model.width || 1;
  const origH = model.internalModel?.originalHeight || model.height || 1;
  const scaleH = (viewH * 0.95) / origH;
  const scaleW = (viewW * 0.95) / origW;
  const scale = Math.min(scaleH, scaleW);
  model.scale.set(scale);
  model.x = (viewW - model.width) / 2;
  model.y = viewH - model.height;
}

function resizeStage(w, h) {
  viewW = w;
  viewH = h - 20; // leave room for bubble
  if (!app) return;
  app.renderer.resize(viewW, viewH);
  canvas.width = viewW;
  canvas.height = viewH;
  fitModel();
}

function setState(state, opts = {}) {
  currentState = state;
  container.dataset.state = state;
  canvas.classList.toggle('panic-shake', state === 'panic');

  if (model) {
    const [group, idx] = STATE_MOTIONS[state] || STATE_MOTIONS.idle;
    try { model.motion(group, idx); } catch (_) {}
  }

  if (!opts.silent) {
    if (opts.text) say(opts.text);
    else say(pickLine(state));
    maybePlayEmotionBark(state);
  }
  resetIdleTimer();
}

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (currentState !== 'sleepy') setState('sleepy');
  }, 5 * 60 * 1000);
}

function basenameOf(p) {
  if (!p || typeof p !== 'string') return '';
  return p.split('/').filter(Boolean).pop() || '';
}

const keystrokesEl = document.getElementById('keystrokes');
let codingTimer = null;
let keystrokeInterval = null;

const KEY_GLYPHS = ['{', '}', '()', ';', '=>', 'fn', 'let', 'const', 'if', 'tap', '++', '✓', '~~', 'def', 'fix'];

function spawnKeystroke() {
  if (!keystrokesEl) return;
  const k = document.createElement('span');
  k.className = 'key';
  k.textContent = KEY_GLYPHS[Math.floor(Math.random() * KEY_GLYPHS.length)];
  k.style.left = (10 + Math.random() * 70) + '%';
  keystrokesEl.appendChild(k);
  setTimeout(() => k.remove(), 1500);
}

function enterCoding(durationMs = 4000) {
  container.dataset.coding = '1';
  if (!keystrokeInterval) {
    keystrokeInterval = setInterval(spawnKeystroke, 220);
  }
  clearTimeout(codingTimer);
  codingTimer = setTimeout(exitCoding, durationMs);
}

function exitCoding() {
  delete container.dataset.coding;
  if (keystrokeInterval) {
    clearInterval(keystrokeInterval);
    keystrokeInterval = null;
  }
  if (keystrokesEl) keystrokesEl.innerHTML = '';
}

function fileChip(name) {
  if (!name) return '';
  return `<span class="file-chip">${name}</span>`;
}

// Tools that should trigger Kohai's "coding mode" laptop overlay.
const CODING_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'Bash']);

function describeTool(data) {
  const tool = data?.tool_name || '';
  const input = data?.tool_input || {};
  const file = basenameOf(input.file_path);
  switch (tool) {
    case 'Edit':
    case 'MultiEdit':
      return file ? { state: 'thinking', text: `Editing ${file}, senpai~`, coding: true } : null;
    case 'Write':
      return file ? { state: 'thinking', text: `Writing ${file}!`, coding: true } : null;
    case 'Read':
      return file ? { state: 'thinking', text: `Reading ${file}…` } : null;
    case 'Bash': {
      const cmd = (input.command || '').split(/\s+/)[0] || 'something';
      return { state: 'thinking', text: `Running \`${cmd}\`…`, coding: true };
    }
    case 'Grep':
    case 'Glob':
      return { state: 'thinking', text: 'Searching the code…' };
    case 'WebFetch':
    case 'WebSearch':
      return { state: 'thinking', text: 'Looking it up online~' };
    case 'TodoWrite':
      return { state: 'thinking', text: 'Updating my todo list!' };
    case 'Task':
      return { state: 'thinking', text: `Sending a subagent…` };
    default:
      return tool ? { state: 'thinking', text: `Hmm, ${tool}…` } : null;
  }
}

function describeToolResult(data) {
  const tool = data?.tool_name || '';
  const file = basenameOf(data?.tool_input?.file_path);
  const failed = data?.tool_response?.is_error || data?.is_error;
  if (failed) return { state: 'error', text: file ? `Eh?! ${file} broke…` : 'Something went wrong…' };
  switch (tool) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return { state: 'happy', text: file ? `Saved ${file}! Yatta~` : 'Saved! Yatta~' };
    case 'Read':
      return null; // silent — reading is too frequent to bubble
    case 'Bash':
      return { state: 'happy', text: 'Done!' };
    default:
      return { state: 'happy', text: pickLine('happy') };
  }
}

const HOOK_HANDLERS = {
  SessionStart: () => setState('happy', { text: 'Konnichiwa, senpai!' }),
  SessionEnd: () => setState('sleepy'),
  UserPromptSubmit: () => setState('thinking', { silent: true }),
  PreToolUse: (data) => {
    const reaction = describeTool(data);
    if (!reaction) return;
    setState(reaction.state, { text: reaction.text });
    if (reaction.coding) enterCoding(20000); // long window; PostToolUse will close it
  },
  PostToolUse: (data) => {
    if (CODING_TOOLS.has(data?.tool_name)) {
      // Linger for a beat so the "saved!" celebration overlaps the laptop fade.
      setTimeout(exitCoding, 700);
    }
    const reaction = describeToolResult(data);
    if (!reaction) return;
    setState(reaction.state, { text: reaction.text });
    setTimeout(() => { if (currentState === reaction.state) setState('idle', { silent: true }); }, 4000);
  },
  PostToolUseFailure: () => setState('error'),
  SubagentStop: () => setState('happy', { text: 'Subagent finished!' }),
  Stop: () => {
    setState('happy');
    setTimeout(() => { if (currentState === 'happy') setState('idle', { silent: true }); }, 5000);
  },
  Notification: () => setState('thinking'),
  ContextLow: () => setState('panic'),
};

const CONTROL_HANDLERS = {
  say: ({ text, duration }) => say(text || '...', duration || 4000),
  motion: ({ state, text }) => {
    if (!STATE_MOTIONS[state]) return;
    setState(state, { silent: !text, text });
  },
};

async function initLive2D() {
  if (!window.PIXI || !window.PIXI.live2d) {
    loading.textContent = 'failed to load Live2D libs';
    return;
  }

  app = new PIXI.Application({
    view: canvas,
    width: viewW,
    height: viewH,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  try {
    model = await PIXI.live2d.Live2DModel.from('../assets/live2d/Hiyori/Hiyori.model3.json', { autoInteract: false });
  } catch (err) {
    console.error('Failed to load Hiyori:', err);
    loading.textContent = 'failed to load model';
    return;
  }

  fitModel();
  app.stage.addChild(model);
  loading.classList.add('hide');

  window.kohai.onEvent(({ type, data }) => {
    const h = HOOK_HANDLERS[type];
    if (h) h(data);
  });
  window.kohai.onControl(({ cmd, payload }) => {
    const h = CONTROL_HANDLERS[cmd];
    if (h) h(payload || {});
  });
  window.kohai.onResize(({ w, h }) => resizeStage(w, h));

  setState('idle', { silent: true });
}

initLive2D();
