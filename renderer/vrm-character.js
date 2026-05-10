// 3D VRM renderer for Kohai. Replaces the Live2D character.js with a
// Three.js scene that loads a VRM model. The same DOM elements (#bubble,
// #laptop, #aura, #canvas, #loading) are reused, and we listen to the
// same kohai:event / kohai:control IPC.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const container = document.querySelector('.kohai-container');
const canvas    = document.getElementById('canvas');
const bubble    = document.getElementById('bubble');
const loading   = document.getElementById('loading');
const keystrokesEl = document.getElementById('keystrokes');

// — Three.js scene setup —
const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
// Frame the upper body (chest + head + arms) — that's the action zone
// when she's "coding". Pulled back enough to not clip in landscape too.
camera.position.set(0, 1.25, 1.6);
camera.lookAt(0, 1.15, 0);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  premultipliedAlpha: false,
});
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
renderer.setSize(canvas.clientWidth || 320, canvas.clientHeight || 380, false);

// Soft anime-style lighting.
const hemi = new THREE.HemisphereLight(0xffffff, 0xddddff, 0.85);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 1.0);
key.position.set(1.0, 2.5, 1.5);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffd9e6, 0.4);
fill.position.set(-1.5, 1.5, 1.0);
scene.add(fill);

// Resize handling — DOM observes window size, we resize the renderer.
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight - 20; // leave room for bubble like Live2D version
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.kohai.onResize(({ w, h }) => {
  // window already resized; force renderer to match new viewport
  setTimeout(resize, 50);
});
resize();

// — VRM model load —
let vrm = null;
let mixer = null;
let neckBone = null, headBone = null, leftUpperArm = null, rightUpperArm = null,
    leftLowerArm = null, rightLowerArm = null, leftHand = null, rightHand = null,
    spine = null, hips = null;

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

loader.load('../assets/vrm/character.vrm', (gltf) => {
  const model = gltf.userData.vrm;
  if (!model) {
    if (loading) loading.textContent = 'failed to parse VRM';
    return;
  }
  vrm = model;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  vrm.scene.position.set(0, 0, 0);
  // VRM 1.0 already faces +Z (toward the camera) by default — only flip
  // for legacy VRM 0.x models, which face -Z natively.
  const isVRM0 = !!(model.meta && model.meta.metaVersion === '0' || (vrm.scene.userData && vrm.scene.userData.vrmFormat === '0.x'));
  if (isVRM0) vrm.scene.rotation.y = Math.PI;
  scene.add(vrm.scene);

  // Auto-normalize model height to 1.6 m so any VRM (regardless of how it
  // was scaled at export time) frames consistently.
  vrm.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(vrm.scene);
  const size = new THREE.Vector3();
  bounds.getSize(size);
  if (size.y > 0) {
    const targetH = 1.6;
    const s = targetH / size.y;
    vrm.scene.scale.setScalar(s);
    vrm.scene.updateMatrixWorld(true);
    // Re-anchor feet to y=0 after scaling.
    const b2 = new THREE.Box3().setFromObject(vrm.scene);
    vrm.scene.position.y -= b2.min.y;
    vrm.scene.updateMatrixWorld(true);
  }
  // Frame the FULL body — lookAt mid-body, pull camera back enough that
  // the whole character (plus a little margin) fits vertically.
  const finalBox = new THREE.Box3().setFromObject(vrm.scene);
  const charHeight = finalBox.max.y - finalBox.min.y;
  const midY = finalBox.min.y + charHeight * 0.5;
  const halfFit = charHeight * 0.95; // character fills ~half the canvas
  const fovRad = (camera.fov * Math.PI) / 180;
  const dist = halfFit / Math.tan(fovRad / 2);
  camera.position.set(0, midY + charHeight * 0.05, dist);
  camera.lookAt(0, midY, 0);
  camera.updateProjectionMatrix();

  // Sanity check: if the VRM has no humanoid (e.g. a developer constraint
  // demo) the bones are missing and there's nothing to animate. Show a
  // hint so the user knows to swap in a real character VRM.
  if (!vrm.humanoid || !vrm.humanoid.getNormalizedBoneNode('head')) {
    if (loading) {
      loading.textContent = 'this VRM has no humanoid rig — drop a real anime VRM at assets/vrm/character.vrm';
      loading.classList.remove('hide');
    }
    return;
  }

  // Cache bone references for IK / pose-driving.
  const h = vrm.humanoid;
  if (h) {
    neckBone       = h.getNormalizedBoneNode('neck');
    headBone       = h.getNormalizedBoneNode('head');
    leftUpperArm   = h.getNormalizedBoneNode('leftUpperArm');
    rightUpperArm  = h.getNormalizedBoneNode('rightUpperArm');
    leftLowerArm   = h.getNormalizedBoneNode('leftLowerArm');
    rightLowerArm  = h.getNormalizedBoneNode('rightLowerArm');
    leftHand       = h.getNormalizedBoneNode('leftHand');
    rightHand      = h.getNormalizedBoneNode('rightHand');
    spine          = h.getNormalizedBoneNode('spine');
    hips           = h.getNormalizedBoneNode('hips');
    leftUpperLeg   = h.getNormalizedBoneNode('leftUpperLeg');
    rightUpperLeg  = h.getNormalizedBoneNode('rightUpperLeg');
    leftLowerLeg   = h.getNormalizedBoneNode('leftLowerLeg');
    rightLowerLeg  = h.getNormalizedBoneNode('rightLowerLeg');
  }
  applyIdlePose();

  if (loading) loading.classList.add('hide');
}, undefined, (err) => {
  console.error('VRM load failed:', err);
  if (loading) loading.textContent = 'failed to load VRM model — drop a .vrm file at assets/vrm/character.vrm';
});

// — Pose primitives —
function setRotation(bone, x = 0, y = 0, z = 0) {
  if (!bone) return;
  bone.rotation.set(x, y, z);
}

// VRM humanoid bones use local axes where the upper-arm bone's +Y points
// down its length. Rotating around local Z swings the arm forward/back;
// rotating around local X swings up/down (mirrored for left vs. right).
// To bring arms from T-pose down to her sides we rotate ~75° around Z.
const REST_LEFT_UPPER_Z  = -1.30;
const REST_RIGHT_UPPER_Z =  1.30;
const REST_LOWER_BEND    = -0.10; // tiny natural elbow bend

function applyIdlePose() {
  setRotation(leftUpperArm,  0, 0, REST_LEFT_UPPER_Z);
  setRotation(rightUpperArm, 0, 0, REST_RIGHT_UPPER_Z);
  setRotation(leftLowerArm,  0, REST_LOWER_BEND, 0);
  setRotation(rightLowerArm, 0, -REST_LOWER_BEND, 0);
  setRotation(spine, 0, 0, 0);
  setRotation(headBone, 0, 0, 0);
  if (hips) hips.position.set(0, 0, 0);
}

// — Look-at-target system: head and eyes track a point in space.
const lookTarget = new THREE.Vector3(0, 1.3, 1.5);
let lookActive = true;

// — Body rotation: smoothly turn the character toward a y-rotation target.
let bodyTargetY = 0; // facing camera by default for VRM 1.0
function turnTo(yRadians) { bodyTargetY = yRadians; }

// — Coding mode: arms held forward over a virtual keyboard, fingers tap.
let coding = false;
function enterCoding() {
  coding = true;
  container.dataset.coding = '1';
  if (!keystrokeInterval) keystrokeInterval = setInterval(spawnKeystroke, 220);
}
function exitCoding() {
  coding = false;
  delete container.dataset.coding;
  if (keystrokeInterval) { clearInterval(keystrokeInterval); keystrokeInterval = null; }
  if (keystrokesEl) keystrokesEl.innerHTML = '';
}

// — Walking: procedural step cycle on the legs while hips bob up & down.
let walkPhase = 0;
let walkActive = false;
let leftUpperLeg = null, rightUpperLeg = null, leftLowerLeg = null, rightLowerLeg = null;

// — Scenario engine: chain timed steps to play out a "walk over to read,
// turn around, walk back, sit and code, stand up and report" sequence.
let scenarioActive = false;
const scenarioState = { read: false, glasses: false, lookOver: false };
let scenarioQueue = [];
let scenarioStepEnd = 0;
let scenarioCurrentTick = null;

function clearScenario() {
  scenarioQueue = [];
  scenarioActive = false;
  scenarioStepEnd = 0;
  scenarioCurrentTick = null;
  scenarioState.read = false;
  scenarioState.glasses = false;
  scenarioState.lookOver = false;
  walkActive = false;
  walkPhase = 0;
}

function runScenario(steps) {
  clearScenario();
  scenarioQueue = steps.slice();
  scenarioActive = true;
  advanceScenario();
}

function advanceScenario() {
  scenarioCurrentTick = null;
  const step = scenarioQueue.shift();
  if (!step) {
    scenarioActive = false;
    return;
  }
  if (typeof step.enter === 'function') step.enter();
  scenarioStepEnd = performance.now() + (step.ms || 0);
  scenarioCurrentTick = step.tick || null;
}

function tickScenario(now, dt) {
  if (!scenarioActive) return;
  if (scenarioCurrentTick) scenarioCurrentTick(now, dt);
  if (now >= scenarioStepEnd) advanceScenario();
}

// — Animation loop —
const clock = new THREE.Clock();
function animate() {
  const dt = clock.getDelta();
  const t  = clock.elapsedTime;

  if (vrm) {
    // Smooth body Y rotation (turn).
    const cur = vrm.scene.rotation.y;
    const next = cur + (bodyTargetY - cur) * Math.min(1, dt * 4);
    vrm.scene.rotation.y = next;

    // Idle breathing — subtle spine + chest scale.
    if (spine) spine.rotation.x = Math.sin(t * 1.3) * 0.012;

    // Look-at target: tilt head/neck toward target relative to body.
    if (lookActive && headBone) {
      const local = headBone.parent.worldToLocal(lookTarget.clone());
      const dx = THREE.MathUtils.clamp(local.x * 0.3, -0.6, 0.6);
      const dy = THREE.MathUtils.clamp(-local.y * 0.2, -0.4, 0.4);
      headBone.rotation.x += (dy - headBone.rotation.x) * Math.min(1, dt * 5);
      headBone.rotation.y += (dx - headBone.rotation.y) * Math.min(1, dt * 5);
    }

    // Procedural walking — leg cycle + hip bob.
    if (walkActive) {
      walkPhase += dt * 7;
      const swing = Math.sin(walkPhase) * 0.45;
      if (leftUpperLeg)  leftUpperLeg.rotation.x  =  swing;
      if (rightUpperLeg) rightUpperLeg.rotation.x = -swing;
      // Knees bend on the back-swing only.
      if (leftLowerLeg)  leftLowerLeg.rotation.x  = Math.max(0, -swing) * 0.9;
      if (rightLowerLeg) rightLowerLeg.rotation.x = Math.max(0,  swing) * 0.9;
      // Arms swing opposite to the legs.
      if (leftUpperArm)  leftUpperArm.rotation.x  = -swing * 0.5;
      if (rightUpperArm) rightUpperArm.rotation.x =  swing * 0.5;
      // Hips bob up & down as feet plant.
      if (hips) hips.position.y = Math.abs(Math.sin(walkPhase)) * 0.04;
    } else if (hips) {
      hips.position.y += (0 - hips.position.y) * Math.min(1, dt * 5);
    }

    // "Reading the message" pose — head and chest lean forward, eyes down.
    if (scenarioState.read) {
      if (headBone) headBone.rotation.x += (0.45 - headBone.rotation.x) * Math.min(1, dt * 5);
      if (spine)    spine.rotation.x    += (-0.1 - spine.rotation.x)    * Math.min(1, dt * 5);
      lookActive = false;
    }

    // "Glasses off" gesture — right hand rises toward the face, head tilts.
    if (scenarioState.glasses) {
      if (rightUpperArm) rightUpperArm.rotation.x += (-1.4 - rightUpperArm.rotation.x) * Math.min(1, dt * 6);
      if (rightUpperArm) rightUpperArm.rotation.z += (0.3 - rightUpperArm.rotation.z)  * Math.min(1, dt * 6);
      if (rightLowerArm) rightLowerArm.rotation.y += (1.2 - rightLowerArm.rotation.y)  * Math.min(1, dt * 6);
      if (headBone) headBone.rotation.z += (0.15 - headBone.rotation.z) * Math.min(1, dt * 5);
    }

    // "Glance over the shoulder" — head turn during turn-around step.
    if (scenarioState.lookOver) {
      if (headBone) headBone.rotation.y += (0.7 - headBone.rotation.y) * Math.min(1, dt * 5);
    }

    if (coding) {
      // Typing pose: keep arms close to rest (down at sides) so we don't
      // get the "hands-up" mistake — VRM bone axes vary, but the rest
      // pose Z values are known good. Add a slight forward lift at the
      // shoulder, gentle elbow bend, hand tap, and forward lean.
      const tap  = Math.sin(t * 10);
      const tapR = Math.sin(t * 10 + Math.PI);
      setRotation(leftUpperArm,  -0.35 + tap  * 0.05, 0, REST_LEFT_UPPER_Z  + 0.15);
      setRotation(rightUpperArm, -0.35 + tapR * 0.05, 0, REST_RIGHT_UPPER_Z - 0.15);
      // Elbow bend (use the same axis that moves the rest pose — small Y).
      setRotation(leftLowerArm,  0, -0.6, 0);
      setRotation(rightLowerArm, 0,  0.6, 0);
      // Hands tap up/down like fingers hitting keys.
      if (leftHand)  leftHand.rotation.x  = tap  * 0.4;
      if (rightHand) rightHand.rotation.x = tapR * 0.4;
      // Forward lean + look down at the keyboard.
      if (spine) spine.rotation.x = -0.20 + Math.sin(t * 1.3) * 0.012;
      if (headBone) headBone.rotation.x = 0.40;
    } else {
      // Smoothly relax back to the resting "arms by sides" pose.
      const lerp = Math.min(1, dt * 4);
      const lerpTo = (b, axis, target) => { if (b) b.rotation[axis] += (target - b.rotation[axis]) * lerp; };
      lerpTo(leftUpperArm,  'x', 0); lerpTo(leftUpperArm,  'z', REST_LEFT_UPPER_Z);
      lerpTo(rightUpperArm, 'x', 0); lerpTo(rightUpperArm, 'z', REST_RIGHT_UPPER_Z);
      lerpTo(leftLowerArm,  'x', 0); lerpTo(leftLowerArm,  'y', REST_LOWER_BEND);
      lerpTo(rightLowerArm, 'x', 0); lerpTo(rightLowerArm, 'y', -REST_LOWER_BEND);
      lerpTo(leftHand,  'x', 0);
      lerpTo(rightHand, 'x', 0);
    }

    // Drive scenario state machine.
    tickScenario(performance.now(), dt);

    if (mixer) mixer.update(dt);
    vrm.update(dt);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// — Bubble / keystrokes (shared with Live2D version) —
let bubbleTimer = null;
function say(text, ms = 3500) {
  if (!text) return;
  bubble.textContent = text;
  bubble.classList.add('show');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
  if (window.kohaiVoicevox) window.kohaiVoicevox.speakLine(text);
}

const KEY_GLYPHS = ['{', '}', '()', ';', '=>', 'fn', 'let', 'const', 'if', '++', '✓', 'def'];
let keystrokeInterval = null;
function spawnKeystroke() {
  if (!keystrokesEl) return;
  const k = document.createElement('span');
  k.className = 'key';
  k.textContent = KEY_GLYPHS[Math.floor(Math.random() * KEY_GLYPHS.length)];
  k.style.left = (10 + Math.random() * 70) + '%';
  keystrokesEl.appendChild(k);
  setTimeout(() => k.remove(), 1500);
}

// — State / event mapping (mirrors Live2D version) —
function basenameOf(p) {
  if (!p || typeof p !== 'string') return '';
  return p.split('/').filter(Boolean).pop() || '';
}

const LINES = {
  idle: ['Hi senpai! Ready to code?', 'Ehehe~ welcome back!'],
  thinking: ['Hmm, let me see…', 'Working on it, senpai!'],
  happy: ['Yatta!', 'Done~!', 'Ehehe, easy!'],
  error: ['Eh?? Something went wrong…', 'Gomen, senpai…'],
  sleepy: ['Mou, where did senpai go?', '*yawn*'],
  panic: ['Senpai, I\'m running out of memory!'],
};

function pickLine(state) {
  const lines = LINES[state];
  return lines ? lines[Math.floor(Math.random() * lines.length)] : '';
}

function setState(state, opts = {}) {
  // VRM state mapping is mostly cosmetic — head/body angle hints.
  if (state === 'sleepy' && headBone) headBone.rotation.x = 0.5;
  if (state === 'panic') turnTo(Math.sin(performance.now() / 100) * 0.3);
  if (!opts.silent) {
    if (opts.text) say(opts.text);
    else say(pickLine(state));
  }
}

const CODING_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'Bash']);
function describeTool(data) {
  const tool = data?.tool_name || '';
  const input = data?.tool_input || {};
  const file = basenameOf(input.file_path);
  switch (tool) {
    case 'Edit': case 'MultiEdit':
      return file ? { state: 'thinking', text: `Editing ${file}, senpai~`, coding: true } : null;
    case 'Write':
      return file ? { state: 'thinking', text: `Writing ${file}!`, coding: true } : null;
    case 'Read':
      return file ? { state: 'thinking', text: `Reading ${file}…` } : null;
    case 'Bash': {
      const cmd = (input.command || '').split(/\s+/)[0] || 'something';
      return { state: 'thinking', text: `Running \`${cmd}\`…`, coding: true };
    }
    default:
      return tool ? { state: 'thinking', text: `Hmm, ${tool}…` } : null;
  }
}

// — Scenario sequences —
//
// userPromptScenario: the choreography Nader described. Kohai gets up
// from her seat, walks left to "read" the user's message, looks over,
// turns back, walks back to her desk, and starts coding.
// Tell main.js to physically slide the window. The renderer can't move
// its own OS window directly, so we POST to the local control server.
async function requestWalk(xPct, yPct, ms) {
  try {
    const tokenRes = await fetch('http://127.0.0.1:17455/health');
    if (!tokenRes.ok) return;
  } catch (_) { return; }
  // Token is read by main.js side; here we just emit through window.kohai
  // if the IPC bridge supports it. Fallback to direct fetch with the token
  // we know lives at ~/.kohai/token via Electron's preload (see preload.js).
  if (window.kohai && window.kohai.walk) {
    window.kohai.walk(xPct, yPct, ms);
  }
}

function userPromptScenario(prompt) {
  exitCoding();
  runScenario([
    // 1. Notice the message
    { ms: 600, enter: () => { lookActive = true; say('Mm? Senpai said something…', 1500); } },
    // 2. Stand up + walk LEFT to "read the message". Window glides left.
    { ms: 1800, enter: () => {
      walkActive = true;
      turnTo(-0.4);
      requestWalk(0.05, 0.40, 1700); // far-left, mid-height
    } },
    // 3. Stop. Lean forward and "read" — show the actual prompt.
    { ms: 1800, enter: () => {
      walkActive = false;
      turnTo(0);
      scenarioState.read = true;
      const preview = (prompt || '').slice(0, 80);
      if (preview) say(`「${preview}${prompt && prompt.length > 80 ? '…' : ''}」`, 2000);
    } },
    // 4. Glance over the shoulder
    { ms: 700, enter: () => { scenarioState.lookOver = true; } },
    // 5. Turn fully around (back toward camera)
    { ms: 800, enter: () => {
      scenarioState.lookOver = false;
      scenarioState.read = false;
      turnTo(Math.PI);
    } },
    // 6. Turn back forward
    { ms: 700, enter: () => { turnTo(0); } },
    // 7. Walk back to the desk (right side). Window glides right.
    { ms: 1800, enter: () => {
      walkActive = true;
      requestWalk(0.75, 0.55, 1700);
    } },
    // 8. Sit down at her desk and start coding
    { ms: 600, enter: () => {
      walkActive = false;
      setState('thinking', { text: 'Time to code!' });
      enterCoding(60000);
    } },
  ]);
}

// stopScenario: when Claude is done, Kohai stops coding, "removes her
// glasses" with a hand-to-face gesture, says "sugoi" + a short summary,
// and returns to idle.
function stopScenario(summary) {
  exitCoding();
  runScenario([
    { ms: 400, enter: () => { /* return to rest */ } },
    { ms: 800, enter: () => { scenarioState.glasses = true; say('Sugoi… *takes off glasses*', 1500); } },
    { ms: 1500, enter: () => {
      scenarioState.glasses = false;
      const text = summary || 'Done, senpai! Check it out~';
      setState('happy', { text });
    } },
    { ms: 800, enter: () => { /* settle */ } },
  ]);
}

const HOOK_HANDLERS = {
  SessionStart: () => setState('happy', { text: 'Konnichiwa, senpai!' }),
  SessionEnd:   () => setState('sleepy'),
  UserPromptSubmit: (data) => {
    const prompt = data?.prompt || data?.user_prompt || '';
    userPromptScenario(prompt);
  },
  PreToolUse: (data) => {
    if (scenarioActive) return; // let the scenario run; per-tool reactions resume after
    const r = describeTool(data);
    if (!r) return;
    setState(r.state, { text: r.text });
    if (r.coding) enterCoding();
  },
  PostToolUse: (data) => {
    if (CODING_TOOLS.has(data?.tool_name)) setTimeout(exitCoding, 700);
    if (scenarioActive) return;
    const file = basenameOf(data?.tool_input?.file_path);
    setState('happy', { text: file ? `Saved ${file}! Yatta~` : 'Done!' });
  },
  Stop: (data) => {
    const summary = data?.message || data?.text || '';
    stopScenario(summary);
  },
  Notification: () => setState('thinking'),
};

const CONTROL_HANDLERS = {
  say:    ({ text }) => say(text),
  motion: ({ state, text }) => setState(state, text ? { text } : {}),
};

window.kohai.onEvent(({ type, data }) => {
  const h = HOOK_HANDLERS[type];
  if (h) h(data);
});
window.kohai.onControl(({ cmd, payload }) => {
  const h = CONTROL_HANDLERS[cmd];
  if (h) h(payload || {});
});
