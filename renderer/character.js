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

const HOOK_HANDLERS = {
  SessionStart: () => setState('happy'),
  SessionEnd: () => setState('sleepy'),
  UserPromptSubmit: () => setState('thinking'),
  PreToolUse: () => setState('thinking'),
  PostToolUse: () => {
    setState('happy');
    setTimeout(() => { if (currentState === 'happy') setState('idle', { silent: true }); }, 4000);
  },
  PostToolUseFailure: () => setState('error'),
  SubagentStop: () => setState('happy'),
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
