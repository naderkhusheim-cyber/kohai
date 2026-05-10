// 3D VRM renderer for Kohai. Replaces the Live2D character.js with a
// Three.js scene that loads a VRM model. The same DOM elements (#bubble,
// #laptop, #aura, #canvas, #loading) are reused, and we listen to the
// same kohai:event / kohai:control IPC.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

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

// Separate loader for .vrma animation files. They're glTF too, but with
// the animation plugin instead of the avatar plugin.
const animLoader = new GLTFLoader();
animLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));

// Library of loaded animation clips, keyed by filename (sans extension).
// Drop new .vrma files into assets/vrm-animations/ and they auto-load on
// startup — no code changes needed.
const animations = new Map();
let currentAction = null;

function playAnimation(name, { fadeMs = 350, loop = false } = {}) {
  const clip = animations.get(name);
  if (!clip || !mixer) return false;
  const action = mixer.clipAction(clip);
  action.reset();
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  action.clampWhenFinished = !loop;
  if (currentAction && currentAction !== action) {
    currentAction.fadeOut(fadeMs / 1000);
  }
  action.fadeIn(fadeMs / 1000).play();
  currentAction = action;
  return true;
}

function loadAnimationFiles(vrm, names) {
  return Promise.all(names.map((name) => new Promise((resolve) => {
    const url = `../assets/vrm-animations/${name}.vrma`;
    animLoader.load(url, (gltf) => {
      const vrmAnims = gltf.userData.vrmAnimations;
      if (!vrmAnims || !vrmAnims.length) return resolve(null);
      const clip = createVRMAnimationClip(vrmAnims[0], vrm);
      animations.set(name, clip);
      resolve(name);
    }, undefined, () => resolve(null)); // missing file = silently skip
  })));
}

// Resolve which skin VRM to load from ~/.kohai/config.json (renderer can't
// read fs directly, so we default and let the IPC 'skin' message swap it).
let currentSkinUrl = '../assets/vrm/character.vrm';

function loadVRM(url) {
  if (vrm) {
    try { scene.remove(vrm.scene); VRMUtils.deepDispose(vrm.scene); } catch (_) {}
    vrm = null;
  }
  if (currentAction) { try { currentAction.stop(); } catch (_) {} currentAction = null; }
  animations.clear();
  if (loading) { loading.textContent = 'loading skin…'; loading.classList.remove('hide'); }

  loader.load(url, (gltf) => {
    onVRMLoaded(gltf);
  }, undefined, (err) => {
    console.error('VRM load failed:', err);
    if (loading) loading.textContent = 'failed to load skin';
  });
}

function onVRMLoaded(gltf) {
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
  mixer = new THREE.AnimationMixer(vrm.scene);

  // Eye tracking — she keeps eye contact with the camera by default.
  // Pointing the lookAt target at the camera makes her feel "present"
  // exactly like a VTuber on stream.
  if (vrm.lookAt) {
    vrm.lookAt.target = camera;
    vrm.lookAt.autoUpdate = true;
  }

  // Auto-blink — subtle natural blinks every 3–6 s. Critical for
  // not feeling like a corpse.
  scheduleNextBlink();

  // Subtle breathing — chest scale on a slow sine wave.
  // (Driven inside the animate loop below.)

  // Try to load any .vrma animations the user has dropped in.
  // Add more names here (or edit this list at runtime) to extend.
  const animationLibrary = ['idle', 'wave', 'celebrate', 'thinking', 'walking', 'bow', 'sit', 'type'];
  loadAnimationFiles(vrm, animationLibrary).then((loaded) => {
    const ok = loaded.filter(Boolean);
    if (ok.length) {
      console.log('[kohai] loaded animations:', ok.join(', '));
      // Auto-play idle if available so she's not standing in T-pose.
      if (animations.has('idle')) playAnimation('idle', { loop: true });
    } else {
      console.log('[kohai] no .vrma files found — drop them in assets/vrm-animations/');
    }
  });

  if (loading) loading.classList.add('hide');
}

// Initial load.
loadVRM(currentSkinUrl);

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

// — VTuber face layer: blink, expressions, lip-sync —
//
// VRM 1.0 exposes an ExpressionManager with named expressions like
// 'happy', 'sad', 'relaxed', 'surprised', 'angry', 'blink', and the
// visemes 'aa', 'ih', 'ou', 'ee', 'oh'. We blend between them based on
// state (mood-driven), schedule random blinks, and drive 'aa' from the
// VOICEVOX audio amplitude in real time.

let blinkValue = 0;
let blinkPhase = 'idle'; // 'idle' | 'closing' | 'opening'
let blinkStartedAt = 0;
let nextBlinkAt = 0;

function scheduleNextBlink() {
  nextBlinkAt = performance.now() + 2500 + Math.random() * 3500; // 2.5–6 s
}

function tickBlink(now) {
  if (!vrm?.expressionManager) return;
  if (blinkPhase === 'idle' && now >= nextBlinkAt) {
    blinkPhase = 'closing';
    blinkStartedAt = now;
  }
  if (blinkPhase === 'closing') {
    const t = Math.min(1, (now - blinkStartedAt) / 80); // 80 ms close
    blinkValue = t;
    if (t >= 1) { blinkPhase = 'opening'; blinkStartedAt = now; }
  } else if (blinkPhase === 'opening') {
    const t = Math.min(1, (now - blinkStartedAt) / 120); // 120 ms open
    blinkValue = 1 - t;
    if (t >= 1) { blinkPhase = 'idle'; scheduleNextBlink(); }
  }
  vrm.expressionManager.setValue('blink', blinkValue);
}

// Mood → blendshape weight. setState() fades the active expression.
const MOOD_EXPRESSION = {
  idle:     { neutral: 0.7 },
  thinking: { relaxed: 0.5 },
  happy:    { happy:   0.85 },
  error:    { sad:     0.7 },
  sleepy:   { relaxed: 0.9 },
  panic:    { surprised: 0.9 },
};

const expressionTargets = { happy: 0, angry: 0, sad: 0, relaxed: 0, surprised: 0, neutral: 0 };
function setMoodExpression(state) {
  const target = MOOD_EXPRESSION[state] || MOOD_EXPRESSION.idle;
  for (const k of Object.keys(expressionTargets)) {
    expressionTargets[k] = target[k] || 0;
  }
}

function tickExpressions(dt) {
  if (!vrm?.expressionManager) return;
  for (const [name, target] of Object.entries(expressionTargets)) {
    const cur = vrm.expressionManager.getValue(name) || 0;
    const next = cur + (target - cur) * Math.min(1, dt * 3);
    if (Math.abs(next - cur) > 0.001) vrm.expressionManager.setValue(name, next);
  }
}

// Lip-sync — reads instantaneous VOICEVOX audio amplitude (exposed by
// voicevox.js as window.kohaiVoicevox.lipsyncLevel) and drives the 'aa'
// viseme accordingly.
function tickLipsync() {
  if (!vrm?.expressionManager) return;
  const level = (window.kohaiVoicevox && typeof window.kohaiVoicevox.lipsyncLevel === 'function')
    ? window.kohaiVoicevox.lipsyncLevel()
    : 0;
  vrm.expressionManager.setValue('aa', level);
}

// — Pose target system: map any bone name to a rotation, and the animate
// loop will lerp the current rotation toward the target each frame.
// Anyone can drive Kohai's body just by POSTing bone rotations.
const poseTargets = new Map(); // boneId → { rx?, ry?, rz?, lerp? }
function getBone(name) {
  switch (name) {
    case 'head':           return headBone;
    case 'neck':           return neckBone;
    case 'spine':          return spine;
    case 'hips':           return hips;
    case 'leftUpperArm':   return leftUpperArm;
    case 'rightUpperArm':  return rightUpperArm;
    case 'leftLowerArm':   return leftLowerArm;
    case 'rightLowerArm':  return rightLowerArm;
    case 'leftHand':       return leftHand;
    case 'rightHand':      return rightHand;
    case 'leftUpperLeg':   return leftUpperLeg;
    case 'rightUpperLeg':  return rightUpperLeg;
    case 'leftLowerLeg':   return leftLowerLeg;
    case 'rightLowerLeg':  return rightLowerLeg;
    default: return null;
  }
}
function setPoseTarget(boneId, target) {
  if (!getBone(boneId)) return;
  if (target == null) { poseTargets.delete(boneId); return; }
  poseTargets.set(boneId, target);
}
function clearPoseTargets(boneIds) {
  if (!boneIds || !boneIds.length) { poseTargets.clear(); return; }
  for (const id of boneIds) poseTargets.delete(id);
}

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

// — Autonomous behavior engine —
// Small reaction pose-sequences (1–2 s each) that fire automatically on
// Claude events. Also runs an idle ticker so Kohai stretches, looks
// around, etc. when nothing else is happening — gives her presence even
// during silence.
const BEHAVIORS = {
  fistPump: [
    { ms: 0,   enter: () => {
      setPoseTarget('rightUpperArm', { rx: -2.4, rz: 0.4, lerp: 14 });
      setPoseTarget('rightLowerArm', { ry: -0.4, lerp: 14 });
    } },
    { ms: 450, enter: () => clearPoseTargets(['rightUpperArm', 'rightLowerArm']) },
  ],
  doublePump: [
    { ms: 0, enter: () => {
      setPoseTarget('leftUpperArm',  { rx: -2.4, rz: -0.4, lerp: 14 });
      setPoseTarget('rightUpperArm', { rx: -2.4, rz:  0.4, lerp: 14 });
    } },
    { ms: 600, enter: () => clearPoseTargets(['leftUpperArm', 'rightUpperArm']) },
  ],
  thinkingChin: [
    { ms: 0, enter: () => {
      setPoseTarget('rightUpperArm', { rx: -1.4, rz: 0.55 });
      setPoseTarget('rightLowerArm', { ry: -1.3 });
      setPoseTarget('rightHand',     { rx: -0.5 });
      setPoseTarget('head',          { rx: 0.18, rz: -0.12 });
    } },
    { ms: 2200, enter: () => clearPoseTargets(['rightUpperArm', 'rightLowerArm', 'rightHand', 'head']) },
  ],
  lookAround: [
    { ms: 0,    enter: () => setPoseTarget('head', { ry:  0.45, lerp: 2.5 }) },
    { ms: 2200, enter: () => setPoseTarget('head', { ry: -0.45, lerp: 2.5 }) },
    { ms: 2200, enter: () => setPoseTarget('head', { ry:     0, lerp: 2.5 }) },
    { ms: 1500, enter: () => clearPoseTargets(['head']) },
  ],
  stretch: [
    { ms: 0,   enter: () => {
      setPoseTarget('leftUpperArm',  { rx: -2.7, rz: -0.5, lerp: 4 });
      setPoseTarget('rightUpperArm', { rx: -2.7, rz:  0.5, lerp: 4 });
      setPoseTarget('spine',         { rx: -0.20 });
    } },
    { ms: 1100, enter: () => clearPoseTargets(['leftUpperArm', 'rightUpperArm', 'spine']) },
  ],
  facePalm: [
    { ms: 0, enter: () => {
      setPoseTarget('rightUpperArm', { rx: -1.7, rz: 0.45, lerp: 10 });
      setPoseTarget('rightLowerArm', { ry: -1.95 });
      setPoseTarget('head',          { rx: 0.45 });
    } },
    { ms: 1600, enter: () => clearPoseTargets(['rightUpperArm', 'rightLowerArm', 'head']) },
  ],
  bow: [
    { ms: 0,    enter: () => { setPoseTarget('spine', { rx: -0.55, lerp: 3 }); setPoseTarget('head', { rx: 0.5, lerp: 3 }); } },
    { ms: 1400, enter: () => { /* hold */ } },
    { ms: 1100, enter: () => clearPoseTargets(['spine', 'head']) },
  ],
  peek: [
    // tilt forward and to the side, like she's leaning over to read
    { ms: 0,   enter: () => { setPoseTarget('spine', { rx: -0.18, ry: 0.15 }); setPoseTarget('head', { rx: 0.25 }); } },
    { ms: 1200, enter: () => clearPoseTargets(['spine', 'head']) },
  ],
  shrug: [
    { ms: 0,   enter: () => {
      setPoseTarget('leftUpperArm',  { rx: -0.45, rz: -1.05, lerp: 12 });
      setPoseTarget('rightUpperArm', { rx: -0.45, rz:  1.05, lerp: 12 });
      setPoseTarget('leftLowerArm',  { ry: -0.95 });
      setPoseTarget('rightLowerArm', { ry:  0.95 });
    } },
    { ms: 800, enter: () => clearPoseTargets(['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm']) },
  ],
};

let lastBehaviorAt = 0;
const BEHAVIOR_COOLDOWN_MS = 1500;

function playBehavior(name) {
  if (scenarioActive) return false;
  if (performance.now() - lastBehaviorAt < BEHAVIOR_COOLDOWN_MS) return false;
  const seq = BEHAVIORS[name];
  if (!seq) return false;
  lastBehaviorAt = performance.now();
  runScenario(seq.map((s) => ({ ...s }))); // shallow copy
  return true;
}

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Idle ticker — every ~45–90 s of nothing happening, Kohai fidgets.
// Spaced out so she doesn't feel twitchy.
let lastActivityAt = performance.now();
let sessionStartedAt = performance.now();
function noteActivity() { lastActivityAt = performance.now(); }
setInterval(() => {
  const idleMs = performance.now() - lastActivityAt;
  if (idleMs < 45000) return;
  if (scenarioActive || coding) return;
  if (animations.has('idle')) {
    playAnimation('idle', { loop: true });
  } else {
    playBehavior(pickRandom(['lookAround', 'stretch', 'thinkingChin']));
  }
  lastActivityAt = performance.now() - Math.random() * 30000;
}, 8000);

// — Roommate vibes: time-aware unprompted reactions —
// She notices when it's late, when you've been idle a long time, when you've
// been coding for hours, and reacts in-character. This is the moment that
// makes people share screenshots — every dev has been at their desk at 3am.
const ROOMMATE_LINES = {
  ohayo:        ['Ohayo, senpai! Ready for today?', 'Good morning, senpai~ Ehehe!'],
  oyasumi:      ['Mou… senpai, please go to sleep ;_;', 'It\'s past midnight, senpai…', 'Senpai? You should rest, ne?'],
  threeAm:      ['*3am.* Senpai, are you okay?', 'It\'s 3 in the morning, senpai…', 'Daijoubu desu ka? It\'s late…'],
  lunchtime:    ['Did senpai eat lunch yet?', 'Lunchtime~ Don\'t forget to eat, senpai!'],
  dinnertime:   ['Dinner time, senpai! ご飯！'],
  longSession:  ['Senpai, you\'ve been coding forever… stretch?', 'Take a break, senpai! Mou.', 'Two hours straight! Sugoi… but rest soon, ne?'],
  longIdle:     ['Senpai? *peeks at the screen*', 'Did senpai fall asleep at the keyboard…?', 'Senpai? I\'ll wait here…'],
  comeback:     ['Okaeri, senpai! I waited!', 'Senpai is back! Yatta~'],
};

const roommateState = {
  flagged: new Set(),
  wasIdleLong: false,
};

function pickRoommateLine(key) {
  const lines = ROOMMATE_LINES[key];
  return lines ? lines[Math.floor(Math.random() * lines.length)] : '';
}

function maybeFireRoommate() {
  if (scenarioActive) return;
  const now = new Date();
  const hour = now.getHours();
  const idleMs = performance.now() - lastActivityAt;
  const sessionMs = performance.now() - sessionStartedAt;

  // 3am wake-up call — fires once per session.
  if (hour === 3 && !roommateState.flagged.has('threeAm')) {
    roommateState.flagged.add('threeAm');
    setState('sleepy', { text: pickRoommateLine('threeAm') });
    playBehavior('facePalm');
    return;
  }
  // Past midnight (12–3am) — once per session.
  if ((hour >= 0 && hour < 3) && !roommateState.flagged.has('oyasumi')) {
    roommateState.flagged.add('oyasumi');
    setState('sleepy', { text: pickRoommateLine('oyasumi') });
    return;
  }
  // Morning greeting (7–10am) — once per session.
  if (hour >= 7 && hour < 10 && !roommateState.flagged.has('ohayo')) {
    roommateState.flagged.add('ohayo');
    setState('happy', { text: pickRoommateLine('ohayo') });
    playBehavior('bow');
    return;
  }
  // Lunch reminder (12:30–13:30) — once per day-period.
  if (hour === 12 && now.getMinutes() >= 30 && !roommateState.flagged.has('lunch')) {
    roommateState.flagged.add('lunch');
    setState('happy', { text: pickRoommateLine('lunchtime') });
    return;
  }
  // Dinner reminder (19:00–20:00).
  if (hour === 19 && !roommateState.flagged.has('dinner')) {
    roommateState.flagged.add('dinner');
    setState('happy', { text: pickRoommateLine('dinnertime') });
    return;
  }
  // Long coding session (>2 hours since session start) — once per hour.
  const longHour = Math.floor(sessionMs / 3_600_000);
  if (longHour >= 2 && !roommateState.flagged.has('long-' + longHour)) {
    roommateState.flagged.add('long-' + longHour);
    setState('error', { text: pickRoommateLine('longSession') });
    playBehavior('stretch');
    return;
  }
  // Long idle (>10 min) — fires once when crossing the threshold.
  if (idleMs > 10 * 60 * 1000 && !roommateState.wasIdleLong) {
    roommateState.wasIdleLong = true;
    setState('sleepy', { text: pickRoommateLine('longIdle') });
    return;
  }
  // Welcome-back: noteActivity() has been called recently after a long idle.
  if (idleMs < 5000 && roommateState.wasIdleLong) {
    roommateState.wasIdleLong = false;
    setState('happy', { text: pickRoommateLine('comeback') });
    playBehavior('fistPump');
  }
}

setInterval(maybeFireRoommate, 30 * 1000); // check every 30s

// Manual trigger so we can demo any roommate beat regardless of wall clock.
const ROOMMATE_KEYS = ['ohayo', 'oyasumi', 'threeAm', 'lunchtime', 'dinnertime', 'longSession', 'longIdle', 'comeback'];
function fireRoommate(key) {
  const text = pickRoommateLine(key);
  if (!text) return false;
  const moodMap = { ohayo: 'happy', oyasumi: 'sleepy', threeAm: 'sleepy', lunchtime: 'happy', dinnertime: 'happy', longSession: 'error', longIdle: 'sleepy', comeback: 'happy' };
  setState(moodMap[key] || 'happy', { text });
  if (key === 'threeAm') playBehavior('facePalm');
  if (key === 'longSession') playBehavior('stretch');
  if (key === 'comeback') playBehavior('fistPump');
  if (key === 'ohayo') playBehavior('bow');
  return true;
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

    // Procedural walking — exaggerated step cycle so it's actually visible
    // in the small overlay window. Big leg & arm swing, visible hip bob.
    if (walkActive) {
      walkPhase += dt * 5; // slower cadence, easier to track visually
      const swing = Math.sin(walkPhase) * 0.7;        // ±40° leg swing
      if (leftUpperLeg)  leftUpperLeg.rotation.x  =  swing;
      if (rightUpperLeg) rightUpperLeg.rotation.x = -swing;
      // Knees bend visibly on the back-swing.
      if (leftLowerLeg)  leftLowerLeg.rotation.x  = Math.max(0, -swing) * 1.4;
      if (rightLowerLeg) rightLowerLeg.rotation.x = Math.max(0,  swing) * 1.4;
      // Arms swing opposite to the legs (clearly).
      if (leftUpperArm)  { leftUpperArm.rotation.x  = -swing * 0.9; leftUpperArm.rotation.z  = REST_LEFT_UPPER_Z;  }
      if (rightUpperArm) { rightUpperArm.rotation.x =  swing * 0.9; rightUpperArm.rotation.z = REST_RIGHT_UPPER_Z; }
      // Hips bob up & down + slight forward lean.
      if (hips)  hips.position.y = Math.abs(Math.sin(walkPhase)) * 0.06;
      if (spine) spine.rotation.x = -0.08;
    } else if (hips) {
      hips.position.y += (0 - hips.position.y) * Math.min(1, dt * 5);
    }

    // "Reading the message" pose — dramatic forward lean, head bowed.
    if (scenarioState.read) {
      if (headBone) headBone.rotation.x += (0.8 - headBone.rotation.x) * Math.min(1, dt * 5);
      if (spine)    spine.rotation.x    += (-0.35 - spine.rotation.x)  * Math.min(1, dt * 5);
      // Hands clasp at chest level — like she's holding the message.
      if (leftUpperArm)  leftUpperArm.rotation.x  += (-0.6 - leftUpperArm.rotation.x)  * Math.min(1, dt * 5);
      if (rightUpperArm) rightUpperArm.rotation.x += (-0.6 - rightUpperArm.rotation.x) * Math.min(1, dt * 5);
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

    // VTuber face layer.
    tickBlink(performance.now());
    tickExpressions(dt);
    tickLipsync();
    tickAccessories();

    // Apply pose targets last — these are explicit overrides from the
    // user (via /control/pose, MCP, or scenario steps) and always win.
    for (const [id, target] of poseTargets) {
      const bone = getBone(id);
      if (!bone) continue;
      const lerp = Math.min(1, dt * (target.lerp || 6));
      if (typeof target.rx === 'number') bone.rotation.x += (target.rx - bone.rotation.x) * lerp;
      if (typeof target.ry === 'number') bone.rotation.y += (target.ry - bone.rotation.y) * lerp;
      if (typeof target.rz === 'number') bone.rotation.z += (target.rz - bone.rotation.z) * lerp;
    }

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
  // Body angle hints + facial expression matching the mood.
  if (state === 'sleepy' && headBone) headBone.rotation.x = 0.5;
  if (state === 'panic') turnTo(Math.sin(performance.now() / 100) * 0.3);
  setMoodExpression(state);
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
    { ms: 1200, enter: () => { lookActive = true; say('Mm? Senpai said something…', 1500); } },
    // 2. Walk LEFT to "read" the message. Window glides far-left over 3s,
    //    long enough that the leg cycle is unambiguously visible.
    { ms: 3000, enter: () => {
      say('Going to read it…', 2500);
      walkActive = true;
      turnTo(-0.5);
      requestWalk(0.05, 0.40, 2900);
    } },
    // 3. Stop and lean forward dramatically — show the actual prompt text.
    { ms: 3000, enter: () => {
      walkActive = false;
      turnTo(0);
      scenarioState.read = true;
      const preview = (prompt || '').slice(0, 80);
      if (preview) say(`「${preview}${prompt && prompt.length > 80 ? '…' : ''}」`, 2800);
    } },
    // 4. Glance over the shoulder
    { ms: 1200, enter: () => { scenarioState.lookOver = true; } },
    // 5. Turn FULLY around (back to camera)
    { ms: 1500, enter: () => {
      scenarioState.lookOver = false;
      scenarioState.read = false;
      turnTo(Math.PI);
      say('Hmm, I see…', 1300);
    } },
    // 6. Turn back forward
    { ms: 1200, enter: () => { turnTo(0); } },
    // 7. Walk back to the desk (right side). Long enough to see the legs.
    { ms: 3000, enter: () => {
      say('Off to my desk!', 2500);
      walkActive = true;
      requestWalk(0.75, 0.55, 2900);
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
    { ms: 3500, enter: () => { /* hold the celebration */ } },
    { ms: 600,  enter: () => { setState('idle', { silent: true }); } }, // back to neutral
  ]);
}

const HOOK_HANDLERS = {
  SessionStart: () => { noteActivity(); setState('happy', { text: 'Konnichiwa, senpai!' }); playBehavior('bow'); },
  SessionEnd:   () => { setState('sleepy'); },
  UserPromptSubmit: (data) => {
    noteActivity();
    const prompt = data?.prompt || data?.user_prompt || '';
    userPromptScenario(prompt);
  },
  PreToolUse: (data) => {
    noteActivity();
    if (scenarioActive) return;
    const r = describeTool(data);
    if (!r) return;
    setState(r.state, { text: r.text });
    if (r.coding) enterCoding();
    // Behavior layer — small autonomous reaction depending on tool type.
    const tool = data?.tool_name;
    if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') playBehavior('peek');
    else if (tool === 'WebFetch' || tool === 'WebSearch') playBehavior('thinkingChin');
    else if (tool === 'Task') playBehavior('lookAround');
  },
  PostToolUse: (data) => {
    noteActivity();
    if (CODING_TOOLS.has(data?.tool_name)) setTimeout(exitCoding, 700);
    const failed = data?.tool_response?.is_error || data?.is_error;
    if (failed) {
      setState('error', { text: 'Eh?! something broke…' });
      playBehavior('facePalm');
      setTimeout(() => { if (currentState === 'error') setState('idle', { silent: true }); }, 4500);
      return;
    }
    if (scenarioActive) return;
    const file = basenameOf(data?.tool_input?.file_path);
    setState('happy', { text: file ? `Saved ${file}! Yatta~` : 'Done!' });
    playBehavior(pickRandom(['fistPump', 'doublePump', 'bow']));
    // Return to idle so her face / expression don't stay frozen on happy.
    setTimeout(() => { if (currentState === 'happy') setState('idle', { silent: true }); }, 3500);
  },
  PostToolUseFailure: () => { setState('error'); playBehavior('facePalm'); },
  SubagentStop: () => {
    setState('happy', { text: 'Subagent finished!' });
    playBehavior('fistPump');
    setTimeout(() => { if (currentState === 'happy') setState('idle', { silent: true }); }, 3500);
  },
  Stop: (data) => {
    noteActivity();
    const summary = data?.message || data?.text || '';
    stopScenario(summary);
  },
  Notification: () => { noteActivity(); setState('thinking'); playBehavior('thinkingChin'); },
};

const CONTROL_HANDLERS = {
  say:    ({ text }) => say(text),
  motion: ({ state, text }) => setState(state, text ? { text } : {}),
  turn:   ({ degrees, radians }) => {
    const rad = typeof radians === 'number' ? radians : (typeof degrees === 'number' ? degrees * Math.PI / 180 : 0);
    turnTo(rad);
  },
  pose:   ({ bones }) => {
    if (!bones || typeof bones !== 'object') return;
    for (const [name, rot] of Object.entries(bones)) setPoseTarget(name, rot);
  },
  clear_pose: ({ bones }) => clearPoseTargets(bones),
  play_animation: ({ name, loop, fadeMs }) => {
    if (typeof name !== 'string') return;
    playAnimation(name, { loop: !!loop, fadeMs: fadeMs || 350 });
  },
  skin: ({ name }) => {
    if (typeof name !== 'string') return;
    applySkin(name);
  },
  roommate: ({ key }) => { fireRoommate(key); },
};

// — Programmatic skins: apply material tints + add 3D accessory primitives
// to the existing VRM so we get visible outfit variations without needing
// new VRM files. Real outfit DLC will swap in dedicated VRM models later;
// this is the v1 stopgap.
const SKIN_PRESETS = {
  default: { tint: 0xffffff, saturation: 1.00, accessories: [] },
  school:  { tint: 0xfff2f2, saturation: 1.05, accessories: ['redBow'] },
  casual:  { tint: 0xe6f0ff, saturation: 0.95, accessories: ['cap'] },
  formal:  { tint: 0xe8e8ec, saturation: 0.55, accessories: ['bowTie'] },
  sleep:   { tint: 0xffd9ec, saturation: 0.85, accessories: ['sleepCap'] },
  summer:  { tint: 0xfff0c8, saturation: 1.15, accessories: ['sunHat'] },
  hacker:  { tint: 0xc8ffd0, saturation: 1.10, accessories: ['glasses'] },
};

const accessoryGroup = new THREE.Group();
scene.add(accessoryGroup);

function clearAccessories() {
  while (accessoryGroup.children.length) {
    const c = accessoryGroup.children.pop();
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  }
}

function makeAccessory(kind) {
  // All accessories are anchored to the head bone via the animate loop.
  let mesh;
  switch (kind) {
    case 'redBow': {
      const g = new THREE.BoxGeometry(0.18, 0.04, 0.06);
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xd0344a }));
      mesh.userData.offset = new THREE.Vector3(0, 0.16, -0.02);
      break;
    }
    case 'cap': {
      const g = new THREE.SphereGeometry(0.13, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3b6ea5 }));
      mesh.userData.offset = new THREE.Vector3(0, 0.13, 0);
      break;
    }
    case 'bowTie': {
      const g = new THREE.BoxGeometry(0.12, 0.04, 0.03);
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x222222 }));
      mesh.userData.offset = new THREE.Vector3(0, -0.18, 0.06);
      break;
    }
    case 'sleepCap': {
      const g = new THREE.ConeGeometry(0.13, 0.22, 16);
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xc983c6 }));
      mesh.userData.offset = new THREE.Vector3(0.04, 0.20, 0);
      mesh.rotation.z = -0.4;
      break;
    }
    case 'sunHat': {
      const g = new THREE.CylinderGeometry(0.18, 0.18, 0.02, 24);
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xfffae0 }));
      mesh.userData.offset = new THREE.Vector3(0, 0.14, 0);
      break;
    }
    case 'glasses': {
      const g = new THREE.TorusGeometry(0.04, 0.008, 8, 16);
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x111111 }));
      mesh.userData.offset = new THREE.Vector3(0, 0.0, 0.085);
      mesh.userData.dual = true; // mirror to right side
      break;
    }
  }
  return mesh;
}

function applySkin(name) {
  const preset = SKIN_PRESETS[name] || SKIN_PRESETS.default;
  // Material tint + saturation on every mesh in the VRM.
  if (vrm) {
    vrm.scene.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m.userData.kohaiOriginalColor && m.color) {
          m.userData.kohaiOriginalColor = m.color.clone();
        }
        if (m.color && m.userData.kohaiOriginalColor) {
          const orig = m.userData.kohaiOriginalColor;
          // Multiply original × tint, then desaturate toward gray.
          const tint = new THREE.Color(preset.tint);
          const out = new THREE.Color(orig.r * tint.r, orig.g * tint.g, orig.b * tint.b);
          if (preset.saturation !== 1.0) {
            const grey = (out.r + out.g + out.b) / 3;
            out.r = grey + (out.r - grey) * preset.saturation;
            out.g = grey + (out.g - grey) * preset.saturation;
            out.b = grey + (out.b - grey) * preset.saturation;
          }
          m.color.copy(out);
        }
        m.needsUpdate = true;
      }
    });
  }
  // Swap accessories.
  clearAccessories();
  for (const kind of preset.accessories) {
    const acc = makeAccessory(kind);
    if (!acc) continue;
    accessoryGroup.add(acc);
    if (acc.userData.dual) {
      const mirror = makeAccessory(kind);
      mirror.userData.offset = acc.userData.offset.clone();
      mirror.userData.mirror = true;
      accessoryGroup.add(mirror);
    }
  }
}

// Each frame, anchor accessories to the head bone's world position.
function tickAccessories() {
  if (!headBone || !accessoryGroup.children.length) return;
  const headPos = new THREE.Vector3();
  const headQuat = new THREE.Quaternion();
  headBone.getWorldPosition(headPos);
  headBone.getWorldQuaternion(headQuat);
  for (const a of accessoryGroup.children) {
    const off = a.userData.offset || new THREE.Vector3();
    const localOff = off.clone();
    if (a.userData.mirror) localOff.x = 0.04; // mirror glasses lens to the right
    else if (a.userData.dual === undefined && off.x === 0) { /* keep */ }
    if (off.x === 0 && a.userData.dual && !a.userData.mirror) localOff.x = -0.04;
    localOff.applyQuaternion(headQuat);
    a.position.copy(headPos).add(localOff);
    a.quaternion.copy(headQuat);
  }
}

window.kohai.onEvent(({ type, data }) => {
  const h = HOOK_HANDLERS[type];
  if (h) h(data);
});
window.kohai.onControl(({ cmd, payload }) => {
  const h = CONTROL_HANDLERS[cmd];
  if (h) h(payload || {});
});
