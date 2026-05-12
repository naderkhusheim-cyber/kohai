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

// Procedural fallbacks — when no .vrma file exists for a name, run a
// hand-coded pose sequence using kohai_pose. Each entry is a function
// that calls setPoseTarget / clearPoseTargets on its own schedule.
const PROCEDURAL_ANIMS = {
  sit: () => {
    // Chair-style seated pose. Upper legs swing forward 90°, knees
    // bend 90° so calves point straight down (no over-rotation, no
    // splay-twist that flips the feet). Hips drop to cushion height.
    container.dataset.room = 'livingroom';
    setPoseTarget('leftUpperLeg',  { rx: 1.55, rz:  0.05, lerp: 4 });
    setPoseTarget('rightUpperLeg', { rx: 1.55, rz: -0.05, lerp: 4 });
    setPoseTarget('leftLowerLeg',  { rx: -1.55, lerp: 4 });
    setPoseTarget('rightLowerLeg', { rx: -1.55, lerp: 4 });
    setPoseTarget('spine',         { rx: 0.05, lerp: 4 });
    setPoseTarget('leftUpperArm',  { rx: -0.3, rz: REST_LEFT_UPPER_Z + 0.1, lerp: 4 });
    setPoseTarget('rightUpperArm', { rx: -0.3, rz: REST_RIGHT_UPPER_Z - 0.1, lerp: 4 });
    setPoseTarget('leftLowerArm',  { ry: -0.6, lerp: 4 });
    setPoseTarget('rightLowerArm', { ry:  0.6, lerp: 4 });
    hipsTargetY = -0.65; // sink to cushion height (more conservative)
    say('Hai, sitting down senpai~', 2500);
  },
  stand: () => {
    walkActive = false;          // stop any leg-cycle in progress
    // Actively animate legs back to straight + spine to neutral.
    // clearPoseTargets alone leaves bones in their last-driven rotation
    // (sit pose retained legs bent). Targeting 0 explicitly is what
    // makes her actually stand up.
    setPoseTarget('leftUpperLeg',  { rx: 0, rz: 0, lerp: 5 });
    setPoseTarget('rightUpperLeg', { rx: 0, rz: 0, lerp: 5 });
    setPoseTarget('leftLowerLeg',  { rx: 0, lerp: 5 });
    setPoseTarget('rightLowerLeg', { rx: 0, lerp: 5 });
    setPoseTarget('spine',         { rx: 0, rz: 0, lerp: 5 });
    setPoseTarget('head',          { rx: 0, rz: 0, ry: 0, lerp: 5 });
    clearPoseTargets([
      'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
      'leftHand', 'rightHand',
    ]);
    hipsTargetY = 0;
    delete container.dataset.room;
    // Once she's fully stood up, release the leg/spine targets so
    // future motions aren't fighting our zero-target.
    setTimeout(() => clearPoseTargets([
      'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
      'spine', 'head',
    ]), 1300);
    say('Standing up!', 2000);
  },
  sleep: () => {
    // Bedroom appears: bed fades in, lamp dimmed-warm. She sits on the
    // bed cross-legged with head drooped — reads as drowsy / about-to-sleep.
    // Earlier "lying flat" attempts (hipsTargetY=-1.10) dropped her below
    // the canvas entirely; this seated-on-bed pose stays in frame.
    container.dataset.room = 'bedroom';
    setPoseTarget('leftUpperLeg',  { rx: 1.30, rz:  0.20, lerp: 3 });
    setPoseTarget('rightUpperLeg', { rx: 1.30, rz: -0.20, lerp: 3 });
    setPoseTarget('leftLowerLeg',  { rx: -1.30, lerp: 3 });
    setPoseTarget('rightLowerLeg', { rx: -1.30, lerp: 3 });
    setPoseTarget('spine', { rx: -0.15, lerp: 3 });    // slight slump
    setPoseTarget('head',  { rx: 0.35, rz: 0.10, lerp: 3 }); // head droopy
    setPoseTarget('leftUpperArm',  { rx: -0.20, lerp: 3 });
    setPoseTarget('rightUpperArm', { rx: -0.20, lerp: 3 });
    hipsTargetY = -0.55;  // seated on bed, in frame
    setMoodExpression('sleepy');
    say('Oyasumi, senpai…', 3000);
  },
  home: () => {
    // Show the living room without changing pose — she's just "at home."
    container.dataset.room = 'livingroom';
    say('Welcome to my house, senpai!', 2500);
  },
  // NOTE: One-shot scenes (wave, bow, thinking, celebrate, touch,
  // code_at_desk, peek_code) used to be hardcoded here. They were deleted
  // intentionally — per the project vision, those should be composed LIVE
  // by Claude via /kohai-do (with screenshot feedback), not from canned JS
  // recipes that feel like a sequenced jukebox. The only scenes that stay
  // hardcoded are the state-like ones below: sit, stand, sleep, home,
  // walking. Everything else routes through Claude composition.

  // Walking leg cycle — sets the walkActive flag that the animate loop's
  // procedural-walking block reads (vrm-character.js:854). Call this BEFORE
  // sliding her window via kohai_walk so the legs cycle during the move.
  walking: () => { walkActive = true; walkPhase = 0; },
  // Stop walking — reset every bone the walking cycle wrote directly so she
  // settles back into A-pose instead of freezing on the last step frame.
  walking_stop: () => {
    walkActive = false;
    walkPhase = 0;
    if (leftUpperLeg)  leftUpperLeg.rotation.x  = 0;
    if (rightUpperLeg) rightUpperLeg.rotation.x = 0;
    if (leftLowerLeg)  leftLowerLeg.rotation.x  = 0;
    if (rightLowerLeg) rightLowerLeg.rotation.x = 0;
    if (leftUpperArm)  leftUpperArm.rotation.x  = 0;
    if (rightUpperArm) rightUpperArm.rotation.x = 0;
    if (spine) spine.rotation.x = 0;
    if (hips)  hips.position.y = 0;
  },
};

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
// Persistent hip Y target (procedural anims set this; animate loop lerps
// toward it instead of always returning to 0).
let hipsTargetY = 0;
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
  if (scenarioActive || coding || lifeBehaviorActive) return;
  if (animations.has('idle')) {
    playAnimation('idle', { loop: true });
  } else {
    playBehavior(pickRandom(['lookAround', 'stretch', 'thinkingChin']));
  }
  lastActivityAt = performance.now() - Math.random() * 30000;
}, 8000);

// — "Kohai life" loop —
// Every 90–180s of true idle, Kohai autonomously LIVES: walks around her
// space, jumps for joy, listens to music with headphones, sits at her desk
// coding, naps at the desk. Randomized so it doesn't feel like a scripted
// sequence. Per project vision: idle = the ONLY hardcoded scenes; everything
// else is composed live by Claude via /kohai-do.
let lifeBehaviorActive = false;
const LIFE_BEHAVIORS = {
  // She strolls across her space and comes back.
  walkAround: () => {
    if (!window.kohai || !window.kohai.walk) return finishLife();
    const targets = [
      [0.15, 0.7], [0.85, 0.7], [0.50, 0.7], [0.20, 0.7], [0.80, 0.7],
    ];
    const dest = pickRandom(targets);
    say(pickRandom(['*strolls around*', 'just stretching my legs~', 'pacing pacing~']), 2400);
    window.kohai.walk(dest[0], dest[1], 3000);
    setTimeout(finishLife, 3600);
  },
  // She bounces with joy — celebrate-style arms-up snap.
  jump: () => {
    say(pickRandom(['yotto~ HOP!', 'piyo piyo!', 'ehehe~ jumping~']), 1800);
    // Crouch...
    setPoseTarget('leftUpperLeg',  { rx: 0.4, lerp: 30 });
    setPoseTarget('rightUpperLeg', { rx: 0.4, lerp: 30 });
    setPoseTarget('leftLowerLeg',  { rx: -0.6, lerp: 30 });
    setPoseTarget('rightLowerLeg', { rx: -0.6, lerp: 30 });
    setTimeout(() => {
      // Apex — arms overhead celebrate snap
      setPoseTarget('leftUpperLeg',  { rx: 0,    lerp: 50 });
      setPoseTarget('rightUpperLeg', { rx: 0,    lerp: 50 });
      setPoseTarget('leftLowerLeg',  { rx: 0,    lerp: 50 });
      setPoseTarget('rightLowerLeg', { rx: 0,    lerp: 50 });
      setPoseTarget('leftUpperArm',  { rx: -2.4, rz: -0.4, lerp: 50 });
      setPoseTarget('rightUpperArm', { rx: -2.4, rz:  0.4, lerp: 50 });
    }, 250);
    setTimeout(() => {
      clearPoseTargets();
      finishLife();
    }, 1100);
  },
  // She listens to music — headphones on, gentle head bob.
  music: () => {
    container.dataset.propHeadphones = '1';
    say(pickRandom(['*bobbing to lo-fi*', 'la la la~', 'ne, senpai, this song is so good!']), 3500);
    let bobs = 0;
    const bobInterval = setInterval(() => {
      setPoseTarget('head', { rz: bobs % 2 === 0 ? 0.18 : -0.18, lerp: 6 });
      bobs++;
      if (bobs >= 8) {
        clearInterval(bobInterval);
        clearPoseTargets(['head']);
        delete container.dataset.propHeadphones;
        finishLife();
      }
    }, 500);
  },
  // Sits down at her desk and codes briefly.
  deskCoding: () => {
    if (window.kohai && window.kohai.resize) window.kohai.resize('fullbody');
    turnTo(Math.PI / 2);
    container.dataset.room = 'workspace';
    setPoseTarget('leftUpperLeg',  { rx: 1.55, rz:  0.05, lerp: 5 });
    setPoseTarget('rightUpperLeg', { rx: 1.55, rz: -0.05, lerp: 5 });
    setPoseTarget('leftLowerLeg',  { rx: -1.55, lerp: 5 });
    setPoseTarget('rightLowerLeg', { rx: -1.55, lerp: 5 });
    setPoseTarget('spine', { rx: -0.35, lerp: 5 });
    setPoseTarget('head',  { rx: 0.45,  lerp: 5 });
    setPoseTarget('leftUpperArm',  { rx: -1.10, rz: REST_LEFT_UPPER_Z + 0.30, lerp: 5 });
    setPoseTarget('rightUpperArm', { rx: -1.10, rz: REST_RIGHT_UPPER_Z - 0.30, lerp: 5 });
    setPoseTarget('leftLowerArm',  { ry: -1.20, lerp: 5 });
    setPoseTarget('rightLowerArm', { ry:  1.20, lerp: 5 });
    hipsTargetY = -0.55;
    enterCoding(8000);
    say(pickRandom(['*tap tap tap*', 'working on my own stuff~', 'just sketching ideas']), 3500);
    setTimeout(() => {
      exitCoding();
      clearPoseTargets();
      turnTo(0);
      hipsTargetY = 0;
      delete container.dataset.room;
      finishLife();
    }, 9000);
  },
  // Naps at the desk on her chair.
  deskNap: () => {
    if (window.kohai && window.kohai.resize) window.kohai.resize('fullbody');
    turnTo(Math.PI / 2);
    container.dataset.room = 'workspace';
    setPoseTarget('leftUpperLeg',  { rx: 1.55, rz:  0.05, lerp: 4 });
    setPoseTarget('rightUpperLeg', { rx: 1.55, rz: -0.05, lerp: 4 });
    setPoseTarget('leftLowerLeg',  { rx: -1.55, lerp: 4 });
    setPoseTarget('rightLowerLeg', { rx: -1.55, lerp: 4 });
    setPoseTarget('spine', { rx: -0.55, lerp: 3 });   // slumped forward onto desk
    setPoseTarget('head',  { rx: 0.7,   lerp: 3 });   // forehead-on-desk droop
    setPoseTarget('leftUpperArm',  { rx: -0.40, lerp: 4 });
    setPoseTarget('rightUpperArm', { rx: -0.40, lerp: 4 });
    hipsTargetY = -0.55;
    setMoodExpression('sleepy');
    say(pickRandom(['*zzz*', '...zzz... senpai...', 'mmm... five more minutes...']), 4500);
    setTimeout(() => {
      clearPoseTargets();
      turnTo(0);
      hipsTargetY = 0;
      delete container.dataset.room;
      setMoodExpression('happy');
      finishLife();
    }, 7000);
  },
};
function finishLife() { lifeBehaviorActive = false; lastActivityAt = performance.now() - 30000; }
function pickLifeBehavior() {
  const hour = new Date().getHours();
  // Bias by time-of-day for realism.
  // Late night → naps + music. Morning → walking. Day → desk-coding mix.
  let pool;
  if (hour >= 1 && hour < 6) pool = ['deskNap', 'deskNap', 'music', 'walkAround'];
  else if (hour >= 6 && hour < 11) pool = ['walkAround', 'walkAround', 'jump', 'music'];
  else if (hour >= 11 && hour < 18) pool = ['deskCoding', 'walkAround', 'music', 'jump'];
  else pool = ['deskCoding', 'music', 'walkAround', 'deskNap'];
  return LIFE_BEHAVIORS[pickRandom(pool)];
}
setInterval(() => {
  const idleMs = performance.now() - lastActivityAt;
  if (idleMs < 90000) return;       // user must be idle 90s+
  if (scenarioActive || coding || walkActive || lifeBehaviorActive) return;
  lifeBehaviorActive = true;
  const fn = pickLifeBehavior();
  try { fn(); } catch (e) { console.warn('[life]', e.message); finishLife(); }
}, 15000);

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

    // Publish a discrete "turn bucket" to CSS so prop overlays (glasses,
    // cup, …) can re-position themselves per-angle. Normalise to [-PI, PI]
    // and snap to the closest of front / side-right / side-left / back.
    let norm = ((next + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    let bucket;
    if (Math.abs(norm) < Math.PI / 4)              bucket = 'front';
    else if (Math.abs(Math.abs(norm) - Math.PI) < Math.PI / 4) bucket = 'back';
    else if (norm > 0)                              bucket = 'side-right';
    else                                            bucket = 'side-left';
    if (container.dataset.turn !== bucket) container.dataset.turn = bucket;

    // Idle breathing — subtle spine motion. Only when no pose target is
    // driving the spine; otherwise this overwrites the target every frame
    // and the user's hunch/lean never registers.
    if (spine && !poseTargets.has('spine')) spine.rotation.x = Math.sin(t * 1.3) * 0.012;

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
      walkPhase += dt * 3; // ~0.5 cycles/sec = 1 step/sec — matches a slow walk pace
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
      // Lerp toward the persistent hip target instead of always 0,
      // so /kohai-play sit can lower the hips and keep them lowered.
      hips.position.y += (hipsTargetY - hips.position.y) * Math.min(1, dt * 5);
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

    // Mixer first — it writes keyframe data into the bones.
    if (mixer) mixer.update(dt);

    // THEN apply pose targets — these are explicit overrides from the
    // user (via /control/pose, MCP, scenario steps, procedural anim
    // fallbacks). Running after mixer.update ensures they win even when
    // a cached .vrma clip is still playing.
    for (const [id, target] of poseTargets) {
      const bone = getBone(id);
      if (!bone) continue;
      const lerp = Math.min(1, dt * (target.lerp || 6));
      if (typeof target.rx === 'number') bone.rotation.x += (target.rx - bone.rotation.x) * lerp;
      if (typeof target.ry === 'number') bone.rotation.y += (target.ry - bone.rotation.y) * lerp;
      if (typeof target.rz === 'number') bone.rotation.z += (target.rz - bone.rotation.z) * lerp;
    }
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

let currentState = 'idle';
function setState(state, opts = {}) {
  // Master reset: every transition INTO idle is a hard reset — clears
  // every scene leftover so the next action starts from a clean slate
  // (no lingering laptop overlay, sunken hips from sleep, leftover pose
  // targets from sit). clearPoseTargets() only removes the *targets* —
  // bones keep their last-driven rotation. So we ALSO push every commonly
  // posed bone back toward neutral via a fresh zero target.
  if (state === 'idle') {
    delete container.dataset.room;
    delete container.dataset.coding;
    hipsTargetY = 0;
    if (typeof exitCoding === 'function') exitCoding();
    walkActive = false;
    // Drive bones home to their rest values. setPoseTarget with lerp 8
    // gets them there in ~0.5 s. After 1.5 s, release the targets so the
    // breathing idle animation can take back over.
    setPoseTarget('leftUpperLeg',  { rx: 0, rz: 0, lerp: 8 });
    setPoseTarget('rightUpperLeg', { rx: 0, rz: 0, lerp: 8 });
    setPoseTarget('leftLowerLeg',  { rx: 0, lerp: 8 });
    setPoseTarget('rightLowerLeg', { rx: 0, lerp: 8 });
    setPoseTarget('spine',         { rx: 0, ry: 0, rz: 0, lerp: 8 });
    setPoseTarget('head',          { rx: 0, ry: 0, rz: 0, lerp: 8 });
    setPoseTarget('leftUpperArm',  { rx: 0, rz: REST_LEFT_UPPER_Z,  lerp: 8 });
    setPoseTarget('rightUpperArm', { rx: 0, rz: REST_RIGHT_UPPER_Z, lerp: 8 });
    setPoseTarget('leftLowerArm',  { ry: 0, lerp: 8 });
    setPoseTarget('rightLowerArm', { ry: 0, lerp: 8 });
    setTimeout(() => clearPoseTargets(), 1500);
  }
  currentState = state;
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
    // If a procedural fallback exists for this name, prefer it. Mixer
    // animations override per-frame bone rotations, so a stale cached
    // .vrma can drown out the fallback. Cleanest UX: when both exist,
    // run the procedural pose (predictable behavior).
    const fallback = PROCEDURAL_ANIMS[name];
    if (fallback) {
      // Stop any running mixer clip so it doesn't fight the pose targets.
      if (currentAction) { try { currentAction.stop(); } catch (_) {} currentAction = null; }
      if (mixer) { try { mixer.stopAllAction(); } catch (_) {} }
      fallback();
      return;
    }
    playAnimation(name, { loop: !!loop, fadeMs: fadeMs || 350 });
  },
  skin: ({ name }) => {
    if (typeof name !== 'string') return;
    applySkin(name);
  },
  roommate: ({ key }) => { fireRoommate(key); },
  // Toggle a hand-held / wearable prop. Valid names: pointer, glasses,
  // cup, headphones. `show` is a boolean (default true).
  prop: ({ name, show }) => {
    if (typeof name !== 'string') return;
    const key = `prop${name.charAt(0).toUpperCase() + name.slice(1)}`;
    if (show === false) delete container.dataset[key];
    else container.dataset[key] = '1';
  },
  // Room lighting mode. Valid: on (default), dim, off.
  lights: ({ mode }) => {
    if (!mode || mode === 'on') delete container.dataset.lights;
    else container.dataset.lights = mode;
  },
};

// — Programmatic skins: pixel-level recoloring of the body texture so the
// shirt and shorts visibly change per skin while skin tones, hair, and
// face details stay untouched. HSV-based filter described in the
// research-agent recipe.
const SKIN_RECIPES = {
  default: { shirt: null,             shorts: null,            overlay: null },
  school:  { shirt: [38, 64, 128],    shorts: [38, 64, 128],   overlay: null },          // navy uniform
  casual:  { shirt: [137, 196, 244],  shorts: [180, 150, 100], overlay: null },          // light blue + khaki
  formal:  { shirt: [60, 60, 70],     shorts: [40, 40, 50],    overlay: 'desaturate' },  // charcoal suit
  sleep:   { shirt: [255, 192, 220],  shorts: [255, 170, 200], overlay: 'stripes' },     // pink pajamas
  summer:  { shirt: [255, 230, 120],  shorts: [200, 180, 240], overlay: null },          // yellow + lavender
  hacker:  { shirt: [40, 40, 40],     shorts: [40, 40, 40],    overlay: 'code' },        // black hoodie + code
};

// HSV-based pixel classifier. Anime VRMs have very pale, low-saturation
// skin that overlaps with "white shirt" if you're not careful. So skin
// detection is generous (hue 5-55, sat 0.04+, val 0.55+) and the shirt
// classifier requires near-zero saturation AND brightness AND a warmth
// check to make sure it isn't pale skin.
function classifyPixel(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max / 255;
  const s = max === 0 ? 0 : (max - min) / max;
  let h = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * (((b - r) / d) + 2);
    else h = 60 * (((r - g) / d) + 4);
    if (h < 0) h += 360;
  }
  // Skin (broad — covers pale anime skin too): warm hue, ANY non-zero
  // saturation, mid-bright. Test FIRST so it short-circuits.
  if (h >= 5 && h <= 55 && s >= 0.04 && s <= 0.6 && v >= 0.55) return 'skin';
  // Lip / blush — bright warm reds, very saturated.
  if (h >= 350 || h <= 20) {
    if (s > 0.4 && v > 0.5) return 'face';
  }
  // Eye iris: medium-to-strong saturation in cool hues.
  if (s > 0.35 && h >= 60 && h <= 320 && v > 0.3) return 'face';
  // Hair: warm hue, darker, decent saturation.
  if (h >= 10 && h <= 50 && v < 0.6 && s > 0.18) return 'hair';
  // Shirt (white) — VERY desaturated AND very bright. The s<0.06 check
  // is the key: pale anime skin has s>=0.05 so it won't match here.
  if (s < 0.06 && v > 0.82) return 'shirt';
  // Shorts: very dark AND nearly desaturated. Tightened from v<0.20 to
  // v<0.16 so shaded arm skin (which can be quite dark on anime VRMs)
  // doesn't get picked up.
  if (v < 0.16 && s < 0.4) return 'shorts';
  return 'other';
}

function recolorPreservingShade(d, i, target, refV) {
  // Multiply target color by (V / refV) so folds and shading survive.
  const r = d[i], g = d[i+1], b = d[i+2];
  const v = Math.max(r, g, b) / 255;
  const k = Math.max(0.35, Math.min(1.15, v / refV));
  d[i]   = Math.min(255, Math.round(target[0] * k));
  d[i+1] = Math.min(255, Math.round(target[1] * k));
  d[i+2] = Math.min(255, Math.round(target[2] * k));
}

// Cache original ImageData per material so each skin switch starts fresh.
const ORIGINAL_PIXELS = new WeakMap();

function getOriginalPixels(material) {
  if (ORIGINAL_PIXELS.has(material)) return ORIGINAL_PIXELS.get(material);
  const src = material.map;
  if (!src || !src.image) return null;
  const img = src.image;
  const w = img.width || img.naturalWidth || 512;
  const h = img.height || img.naturalHeight || 512;
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  try { ctx.drawImage(img, 0, 0, w, h); }
  catch (e) { return null; } // tainted/cross-origin
  const data = ctx.getImageData(0, 0, w, h);
  const stash = { width: w, height: h, srcRef: src, data };
  ORIGINAL_PIXELS.set(material, stash);
  return stash;
}

function applyRecipeToMaterial(material, recipe) {
  const stash = getOriginalPixels(material);
  if (!stash) return false;
  const { width: w, height: h, srcRef, data: orig } = stash;

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(w, h);
  // Copy the original pixels untouched first.
  out.data.set(orig.data);

  if (recipe.shirt || recipe.shorts) {
    const d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      const cls = classifyPixel(d[i], d[i+1], d[i+2]);
      if (cls === 'shirt' && recipe.shirt) {
        recolorPreservingShade(d, i, recipe.shirt, 0.92);
      } else if (cls === 'shorts' && recipe.shorts) {
        recolorPreservingShade(d, i, recipe.shorts, 0.18);
      }
    }
  }
  ctx.putImageData(out, 0, 0);

  // Build a binary mask of clothing pixels (shirt + shorts) from the
  // ORIGINAL pixels — used to clip overlays so they don't bleed onto
  // skin / face / hair.
  const mask = new Uint8Array(w * h);
  {
    const od = orig.data;
    for (let i = 0, p = 0; i < od.length; i += 4, p++) {
      const cls = classifyPixel(od[i], od[i+1], od[i+2]);
      if (cls === 'shirt' || cls === 'shorts') mask[p] = 1;
    }
  }

  // Overlay decorations — drawn into a separate offscreen canvas, then
  // composited onto the body canvas using the clothing mask so they
  // never touch skin/hair/face pixels.
  if (recipe.overlay === 'stripes' || recipe.overlay === 'code' || recipe.overlay === 'desaturate') {
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const offctx = off.getContext('2d');

    if (recipe.overlay === 'stripes') {
      offctx.fillStyle = 'rgba(255,150,200,0.55)';
      for (let y = 0; y < h; y += 24) {
        if (Math.floor(y / 24) % 2 === 0) offctx.fillRect(0, y, w, 12);
      }
    } else if (recipe.overlay === 'code') {
      offctx.font = `${Math.max(10, Math.round(w / 60))}px monospace`;
      offctx.fillStyle = 'rgba(0,255,128,0.85)';
      const chars = '01;{}<>=>fnletconst';
      for (let y = 18; y < h; y += 22) {
        for (let x = 0; x < w; x += 16) {
          offctx.fillText(chars[Math.floor(Math.random() * chars.length)], x, y);
        }
      }
    } else if (recipe.overlay === 'desaturate') {
      // For desaturate, fill with grayscale version of the canvas.
      offctx.drawImage(canvas, 0, 0);
      const od = offctx.getImageData(0, 0, w, h);
      const dd = od.data;
      for (let i = 0; i < dd.length; i += 4) {
        const grey = (dd[i] + dd[i+1] + dd[i+2]) / 3;
        dd[i]   = grey + (dd[i] - grey) * 0.55;
        dd[i+1] = grey + (dd[i+1] - grey) * 0.55;
        dd[i+2] = grey + (dd[i+2] - grey) * 0.55;
      }
      offctx.putImageData(od, 0, 0);
    }

    // Now blend the overlay onto the main canvas only where mask=1.
    const baseImg = ctx.getImageData(0, 0, w, h);
    const overImg = offctx.getImageData(0, 0, w, h);
    const bd = baseImg.data, ovd = overImg.data;
    for (let i = 0, p = 0; i < bd.length; i += 4, p++) {
      if (!mask[p]) continue;
      // Alpha-composite over (only on clothing pixels).
      const oa = ovd[i+3] / 255;
      if (oa <= 0) continue;
      bd[i]   = Math.round(bd[i]   * (1 - oa) + ovd[i]   * oa);
      bd[i+1] = Math.round(bd[i+1] * (1 - oa) + ovd[i+1] * oa);
      bd[i+2] = Math.round(bd[i+2] * (1 - oa) + ovd[i+2] * oa);
    }
    ctx.putImageData(baseImg, 0, 0);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY      = srcRef.flipY;
  tex.colorSpace = srcRef.colorSpace;
  tex.wrapS      = srcRef.wrapS;
  tex.wrapT      = srcRef.wrapT;
  tex.minFilter  = srcRef.minFilter;
  tex.magFilter  = srcRef.magFilter;
  tex.anisotropy = srcRef.anisotropy;
  tex.generateMipmaps = srcRef.generateMipmaps;
  tex.needsUpdate = true;

  if (material.userData._kohaiOwnedMap && material.map && material.map !== srcRef) {
    try { material.map.dispose(); } catch (_) {}
  }
  material.map = tex;
  material.userData._kohaiOwnedMap = true;
  // MToon uses shadeMultiplyTexture for the shade-side color — swap it too
  // so the shaded side of the shirt doesn't read as the original white.
  if (material.shadeMultiplyTexture !== undefined) {
    material.shadeMultiplyTexture = tex;
  }
  if ('uniformsNeedUpdate' in material) material.uniformsNeedUpdate = true;
  material.needsUpdate = true;
  return true;
}

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
      // Two pinched triangles = a proper bow shape, anchored at the throat.
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(0.06, 0.025);
      shape.lineTo(0.06, -0.025);
      shape.lineTo(0, 0);
      shape.lineTo(-0.06, 0.025);
      shape.lineTo(-0.06, -0.025);
      shape.lineTo(0, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false });
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x111111 }));
      mesh.userData.offset = new THREE.Vector3(0, -0.13, 0.075); // throat, in front of body
      break;
    }
    case 'sleepCap': {
      // Drooping nightcap = a half-sphere base hugging the head + a soft
      // cone drooping to the side + a fluffy pom-pom at the tip.
      const group = new THREE.Group();
      const fabric = new THREE.MeshStandardMaterial({ color: 0xd99cc8, roughness: 0.85 });
      // Base — half sphere on top of the head.
      const base = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        fabric,
      );
      base.position.set(0, 0, 0);
      group.add(base);
      // Drooping tail — a small cone tilted gently to the side.
      const tail = new THREE.Mesh(
        new THREE.ConeGeometry(0.07, 0.14, 14),
        fabric,
      );
      tail.position.set(0.08, 0.06, -0.02);
      tail.rotation.z = -1.0; // drooping sideways, not pointing up
      group.add(tail);
      // Pom-pom on the tip.
      const pom = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xfff0f5, roughness: 1.0 }),
      );
      pom.position.set(0.14, 0.04, -0.02);
      group.add(pom);
      mesh = group;
      mesh.userData.offset = new THREE.Vector3(0, 0.13, 0);
      break;
    }
    case 'sunHat': {
      const g = new THREE.CylinderGeometry(0.18, 0.18, 0.02, 24);
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xfffae0 }));
      mesh.userData.offset = new THREE.Vector3(0, 0.14, 0);
      break;
    }
    case 'glasses': {
      // Two thin lens rings + a bridge piece, anchored at eye height in
      // front of the face. Proper proportions for an anime character.
      const group = new THREE.Group();
      const ringGeo = new THREE.TorusGeometry(0.038, 0.005, 6, 24);
      const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
      const lensL = new THREE.Mesh(ringGeo, black);
      const lensR = new THREE.Mesh(ringGeo, black);
      lensL.position.set(-0.045, 0, 0);
      lensR.position.set( 0.045, 0, 0);
      group.add(lensL); group.add(lensR);
      // Tinted lens fill (subtle greenish for "hacker" vibe).
      const fillGeo = new THREE.CircleGeometry(0.034, 24);
      const fill = new THREE.MeshBasicMaterial({ color: 0x8aff8a, transparent: true, opacity: 0.18 });
      const fillL = new THREE.Mesh(fillGeo, fill);
      const fillR = new THREE.Mesh(fillGeo, fill);
      fillL.position.set(-0.045, 0, 0.001);
      fillR.position.set( 0.045, 0, 0.001);
      group.add(fillL); group.add(fillR);
      // Bridge.
      const bridge = new THREE.Mesh(
        new THREE.BoxGeometry(0.018, 0.005, 0.005),
        black
      );
      bridge.position.set(0, 0.005, 0);
      group.add(bridge);
      mesh = group;
      mesh.userData.offset = new THREE.Vector3(0, 0.025, 0.10); // at eye level, in front
      break;
    }
  }
  return mesh;
}

// Skin → accessory mapping (kept separate so we can iterate quickly).
const SKIN_ACCESSORIES = {
  default: [],
  school:  ['redBow'],
  casual:  ['cap'],
  formal:  ['bowTie'],
  sleep:   ['sleepCap'],
  summer:  ['sunHat'],
  hacker:  ['glasses'],
};

function applySkin(name) {
  const recipe = SKIN_RECIPES[name] || SKIN_RECIPES.default;
  const accessories = SKIN_ACCESSORIES[name] || [];

  // Pixel-recolor the body texture on every body/cloth-named material.
  // Defaults to ALL materials if naming convention is unclear (the bundled
  // VRM has unnamed atlases — we still get the right result because the
  // HSV classifier protects skin/hair/eye pixels).
  if (vrm) {
    vrm.scene.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        // Only target materials whose name suggests body/clothes if any are
        // named that way; otherwise fall back to applying everywhere (the
        // pixel classifier preserves skin/hair regions on its own).
        const named = m.name && /body|cloth|outfit|shirt|skirt|pants|short|jacket|uniform/i.test(m.name);
        const anyNamedBody = vrm.scene.children.some(/* placeholder */ () => false);
        // Apply if name matches OR no body-named materials exist on the model.
        if (named || !m.name || m.name === '') {
          applyRecipeToMaterial(m, recipe);
        }
      }
    });
  }

  // Swap accessories on the head bone.
  clearAccessories();
  for (const kind of accessories) {
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
