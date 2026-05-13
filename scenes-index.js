// Registry of canonical scenes that can be fired DIRECTLY without
// asking Claude to compose them. Both main.js (for matching) and the
// renderer (for execution) load this so we have a single source of
// truth for the scene names + their keyword triggers.
//
// The renderer's SCENES map defines the actual run() function for
// each scene; this file is just the matching index.

const SCENES_INDEX = {
  code_at_desk: ['code', 'coding', 'sit', 'chair', 'desk', 'laptop', 'work', 'typing'],
  sleep:        ['sleep', 'nap', 'tired', 'rest'],
  wave:         ['wave', 'hi', 'hello', 'hey'],
  drink_water:  ['drink', 'water', 'thirsty', 'hydrate'],
};

function matchScene(text) {
  if (!text) return null;
  const lower = String(text).toLowerCase().trim();
  if (SCENES_INDEX[lower]) return lower;
  let best = null, bestScore = 0;
  for (const [name, kws] of Object.entries(SCENES_INDEX)) {
    const score = kws.filter((k) => lower.includes(k)).length;
    if (score > bestScore) { best = name; bestScore = score; }
  }
  return best;
}

module.exports = { SCENES_INDEX, matchScene };
