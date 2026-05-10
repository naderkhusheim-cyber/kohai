// Reacts to a user prompt with an in-character Kohai line.
// Returns { state, text } or null when no reaction is appropriate.
//
// Strategy:
//   1. If the prompt directly addresses Kohai (mentions her name), try a fast
//      keyword match (greeting, thanks, sleep, etc.).
//   2. If addressed but no keyword hit, shell out to `claude -p` (Haiku) which
//      uses the user's existing Claude Code auth — no API key needed.
//   3. If not addressed, no reaction — let the existing hook flow play.

const { spawn } = require('child_process');
const path = require('path');

const ADDRESSED = /\bkohai\b/i;

const KEYWORD_RULES = [
  {
    re: /\b(how are you|hru|how['’]?s it going|how['’]?ve you been|whats up|what['’]?s up|sup)\b/i,
    state: 'happy',
    lines: ['Genki desu, senpai! Ehehe~', 'I\'m doing great, senpai!', 'Hai! All good here~'],
  },
  {
    re: /\b(hi|hello|hey|yo|oi|ohayo|ohayou|konnichiwa|morning|good morning|gm)\b/i,
    state: 'happy',
    lines: ['Hi senpai! Ehehe~', 'Konnichiwa, senpai!', 'Yatta, senpai is back!'],
  },
  {
    re: /\b(thanks|thank you|ty|thx|arigatou|arigato|appreciate it)\b/i,
    state: 'happy',
    lines: ['Ehehe, douitashimashite!', 'Anything for senpai~', 'Yatta~ glad I helped!'],
  },
  {
    re: /\b(good (job|work)|nice|great|awesome|excellent|well done|sugoi|sweet|perfect|amazing|legend)\b/i,
    state: 'happy',
    lines: ['Yatta!', 'Ehehe~ senpai noticed!', 'Sugoi desu ne~'],
  },
  {
    re: /\b(bye|goodbye|cya|see ya|see you|gn|good night|oyasumi|sleep)\b/i,
    state: 'sleepy',
    lines: ['Oyasumi, senpai…', 'Bye bye senpai~', '*yawn*… mata ne…'],
  },
  {
    re: /\b(sorry|gomen|my bad|oops)\b/i,
    state: 'happy',
    lines: ['Daijoubu, senpai!', 'No worries~', 'Ehehe, it\'s ok!'],
  },
  {
    re: /\b(damn|shit|fuck|wtf|broken|ugh|hate|annoying|stupid)\b/i,
    state: 'error',
    lines: ['Daijoubu, senpai… we got this.', 'Mou, take a breath senpai…', 'Eh?? what happened…'],
  },
  {
    re: /\b(wake up|are you there|you there|hello\?)\b/i,
    state: 'happy',
    lines: ['Hai hai, I\'m here senpai!', '*pop* — present!', 'Ehehe, you got me!'],
  },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function tryKeyword(prompt) {
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(prompt)) return { state: rule.state, text: pick(rule.lines) };
  }
  return null;
}

const SYSTEM_PROMPT = [
  'You are Kohai, a cheerful anime girl companion that lives next to a developer\'s terminal.',
  'You speak to the developer (whom you call "senpai") in 1 short sentence.',
  'Mix in a tiny bit of Japanese (ehehe, yatta, hai, gomen, sugoi, daijoubu) — sparingly.',
  'Stay supportive and warm. No emojis. No quotes. Max ~12 words.',
  'Reply with ONE LINE of text only — your spoken line. Nothing else.',
].join(' ');

const MOOD_HINTS = [
  { state: 'sleepy', re: /(yawn|oyasumi|sleep|tired|bye)/i },
  { state: 'error',  re: /(gomen|daijoubu|sorry|eh\?|mou)/i },
  { state: 'happy',  re: /(yatta|sugoi|ehehe|hai|genki|ganbatte)/i },
];

function inferState(text) {
  for (const m of MOOD_HINTS) if (m.re.test(text)) return m.state;
  return 'happy';
}

// Locate the `claude` CLI. process.env.PATH may be sparse when Electron is
// launched from Finder, so check the common install paths first.
function resolveClaudeBin() {
  if (process.env.KOHAI_CLAUDE_BIN) return process.env.KOHAI_CLAUDE_BIN;
  const home = process.env.HOME || '';
  const candidates = [
    path.join(home, '.local/bin/claude'),
    path.join(home, '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    'claude',
  ];
  return candidates[0]; // first listed; spawn will resolve via PATH if missing
}

function callClaudeCLI(prompt) {
  return new Promise((resolve) => {
    const bin = resolveClaudeBin();
    const args = [
      '-p',
      '--model', 'claude-haiku-4-5-20251001',
      '--append-system-prompt', SYSTEM_PROMPT,
      '--exclude-dynamic-system-prompt-sections',
      `Senpai just said: "${prompt}"\nReact in character as Kohai (one short line, no quotes).`,
    ];

    const child = spawn(bin, args, {
      env: { ...process.env, KOHAI_INSIDE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch (_) {}
      resolve(null);
    }, 25000);

    child.stdout.on('data', (b) => { out += b.toString(); });
    child.stderr.on('data', (b) => { err += b.toString(); });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) return resolve(null);
      const text = out.trim().replace(/^["'`]+|["'`]+$/g, '').slice(0, 140);
      if (!text) return resolve(null);
      resolve({ state: inferState(text), text });
    });
  });
}

async function reactToPrompt(prompt) {
  if (!prompt) return null;
  if (!ADDRESSED.test(prompt)) return null;

  const kw = tryKeyword(prompt);
  if (kw) return kw;

  return callClaudeCLI(prompt);
}

module.exports = { reactToPrompt };
