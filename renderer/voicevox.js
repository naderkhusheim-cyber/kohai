// VOICEVOX TTS adapter — local HTTP server at 127.0.0.1:50021.
// Two-call API: /audio_query → /synthesis (WAV bytes).
// If the server isn't running, fail silently (Kohai falls back to the canned
// per-emotion MP3s already in assets/audio/).

const VOICEVOX_URL = 'http://127.0.0.1:50021';
const DEFAULT_SPEAKER = 8; // Tsumugi (normal) — cheerful young female
const TIMEOUT_MS = 4000;

let currentAudio = null;

async function fetchWithTimeout(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function synthesize(text, speaker) {
  const queryRes = await fetchWithTimeout(
    `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
    { method: 'POST' }
  );
  if (!queryRes.ok) throw new Error(`audio_query ${queryRes.status}`);
  const query = await queryRes.json();
  // Slight prosody nudge — make her more lively.
  query.speedScale = 1.05;
  query.pitchScale = 0.03;
  query.intonationScale = 1.25;

  const synthRes = await fetchWithTimeout(
    `${VOICEVOX_URL}/synthesis?speaker=${speaker}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'audio/wav' },
      body: JSON.stringify(query),
    }
  );
  if (!synthRes.ok) throw new Error(`synthesis ${synthRes.status}`);
  return synthRes.arrayBuffer();
}

function stopCurrent() {
  if (!currentAudio) return;
  try {
    currentAudio.pause();
    URL.revokeObjectURL(currentAudio.src);
  } catch (_) {}
  currentAudio = null;
}

async function speakLine(text, { speaker = DEFAULT_SPEAKER, volume = 0.8 } = {}) {
  if (!text) return;
  try {
    const buf = await synthesize(text, speaker);
    stopCurrent();
    const blob = new Blob([buf], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = volume;
    audio.addEventListener('ended', () => URL.revokeObjectURL(url));
    currentAudio = audio;
    audio.play().catch(() => {});
  } catch (_) {
    // server offline / mid-flight error — silent fallback to canned MP3 cues
  }
}

let availability = null; // null = unknown, true/false once probed
async function isAvailable() {
  if (availability !== null) return availability;
  try {
    const res = await fetchWithTimeout(`${VOICEVOX_URL}/version`, { method: 'GET' });
    availability = res.ok;
  } catch (_) {
    availability = false;
  }
  // Re-probe periodically so launching VOICEVOX after Kohai works.
  setTimeout(() => { availability = null; }, 30000);
  return availability;
}

window.kohaiVoicevox = { speakLine, stopCurrent, isAvailable };
