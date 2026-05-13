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
//
// ARCHITECTURE NOTE — only state-like primitives stay hardcoded here:
//   - stand: master reset (always needed; everything composes off of it)
//   - walking / walking_stop: leg cycle toggle for kohai_walk
//
// All scene-level recipes (sit, chair_sit, sleep, home, code_at_desk,
// wave, bow, point, …) were DELETED. They are now composed live by
// Claude via /kohai-do, using docs/anatomy.md + docs/capabilities.md
// as the rig spec. Claude calls setPoseTarget on individual bones,
// drops assets via kohai_asset, then verifies with kohai_screenshot.
const PROCEDURAL_ANIMS = {
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
    // Clear any bone-attached or hand-held assets so she fully returns
    // to T-pose — otherwise the water bottle/mug/etc. linger after a
    // drink/eat life behavior and she keeps "holding" it forever.
    for (const name of Array.from(attachedAssets.keys())) {
      try { CONTROL_HANDLERS.asset({ name, show: false }); } catch (_) {}
    }
    for (const k of Array.from(handProps.keys())) clearHandProp(k);
    delete container.dataset.propPointer;
    delete container.dataset.propGlasses;
    delete container.dataset.propCup;
    delete container.dataset.propHeadphones;
    // Once she's fully stood up, release the leg/spine targets so
    // future motions aren't fighting our zero-target.
    setTimeout(() => clearPoseTargets([
      'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
      'spine', 'head',
    ]), 1300);
    say('Standing up!', 2000);
  },

  // Walking leg cycle — sets the walkActive flag that the animate loop's
  // procedural-walking block reads. Call this BEFORE sliding her window
  // via kohai_walk so the legs cycle during the move.
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
    // Normalized height — smaller value = character renders smaller in
    // the canvas (more breathing room around her). Reduced from 1.6 to
    // 1.3 so the chair has visible margin and she doesn't fill the
    // canvas every restart.
    const targetH = 1.3;
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
    // RIG SANITY CHECK — dumps EVERY VRM humanoid bone, whether it
    // exists or is missing, with bind-pose orientation. Lets us figure
    // out if a "broken" gesture is broken because (a) we used the wrong
    // axis or (b) the bone literally doesn't exist on this model
    // (e.g., fingers, upper chest, eyes).
    try {
      const VRM_BONES = [
        'hips','spine','chest','upperChest','neck','head',
        'leftEye','rightEye','jaw',
        'leftShoulder','leftUpperArm','leftLowerArm','leftHand',
        'rightShoulder','rightUpperArm','rightLowerArm','rightHand',
        'leftThumbProximal','leftThumbIntermediate','leftThumbDistal',
        'leftIndexProximal','leftIndexIntermediate','leftIndexDistal',
        'leftMiddleProximal','leftMiddleIntermediate','leftMiddleDistal',
        'leftRingProximal','leftRingIntermediate','leftRingDistal',
        'leftLittleProximal','leftLittleIntermediate','leftLittleDistal',
        'rightThumbProximal','rightThumbIntermediate','rightThumbDistal',
        'rightIndexProximal','rightIndexIntermediate','rightIndexDistal',
        'rightMiddleProximal','rightMiddleIntermediate','rightMiddleDistal',
        'rightRingProximal','rightRingIntermediate','rightRingDistal',
        'rightLittleProximal','rightLittleIntermediate','rightLittleDistal',
        'leftUpperLeg','leftLowerLeg','leftFoot','leftToes',
        'rightUpperLeg','rightLowerLeg','rightFoot','rightToes',
      ];
      const present = [];
      const missing = [];
      for (const name of VRM_BONES) {
        const b = h.getNormalizedBoneNode(name);
        if (b) present.push(name); else missing.push(name);
      }
      console.log(`[rig] PRESENT (${present.length}): ${present.join(', ')}`);
      console.log(`[rig] MISSING (${missing.length}): ${missing.join(', ')}`);
      // Also dump axis orientation of the bones we actually drive.
      const dump = (name, b) => {
        if (!b) return console.log('[rig-axes]', name, 'MISSING');
        const wq = new THREE.Quaternion();
        b.getWorldQuaternion(wq);
        const aX = new THREE.Vector3(1, 0, 0).applyQuaternion(wq);
        const aY = new THREE.Vector3(0, 1, 0).applyQuaternion(wq);
        const aZ = new THREE.Vector3(0, 0, 1).applyQuaternion(wq);
        const fmt = (v) => `(${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)})`;
        console.log(`[rig-axes] ${name}  +X→${fmt(aX)}  +Y→${fmt(aY)}  +Z→${fmt(aZ)}`);
      };
      dump('hips', hips);
      dump('spine', spine);
      dump('head', headBone);
      dump('leftUpperArm', leftUpperArm);
      dump('rightUpperArm', rightUpperArm);
    } catch (e) { console.warn('[rig] dump failed:', e.message); }
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
  // First-tier: explicit slots the original renderer cached. Fast path.
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
  }
  // Second-tier: any other VRM humanoid bone (chest, upperChest, shoulders,
  // feet, toes, fingers, eyes, jaw). The rig sanity dump confirmed this
  // model has 52 bones — we now expose ALL of them to kohai_pose.
  if (!vrm || !vrm.humanoid) return null;
  return vrm.humanoid.getNormalizedBoneNode(name);
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
  // Spawn 3D laptop on her lap, parented to the hips bone so it tracks
  // her body. Position: ~6cm below hip pivot, 18cm forward toward knees.
  if (hips && !bodyProps.has('laptop')) {
    const laptop = makeBodyProp('laptop');
    if (laptop) {
      laptop.position.set(0, -0.06, 0.18);
      hips.add(laptop);
      bodyProps.set('laptop', laptop);
    }
  }
}
function exitCoding() {
  coding = false;
  delete container.dataset.coding;
  if (keystrokeInterval) { clearInterval(keystrokeInterval); keystrokeInterval = null; }
  if (keystrokesEl) keystrokesEl.innerHTML = '';
  clearBodyProp('laptop');
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
      setPoseTarget('spine',         { rx: 0.20 });
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
    { ms: 0,    enter: () => { setPoseTarget('spine', { rx: 1.3, lerp: 3 }); setPoseTarget('head', { rx: 0.5, lerp: 3 }); } },
    { ms: 1400, enter: () => { /* hold */ } },
    { ms: 1100, enter: () => clearPoseTargets(['spine', 'head']) },
  ],
  peek: [
    // tilt forward and to the side, like she's leaning over to read
    { ms: 0,   enter: () => { setPoseTarget('spine', { rx: 0.80 }); setPoseTarget('head', { rx: 0.25, ry: -0.50 }); } },
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
// Micro-idle: after 15s of inactivity, she does small ambient gestures
// (look around, stretch, thinking). Tight loop (3s) so she feels alive,
// not statue-like. Was 45s threshold + 8s poll — way too long.
setInterval(() => {
  const idleMs = performance.now() - lastActivityAt;
  if (idleMs < 15000) return;
  if (scenarioActive || coding || lifeBehaviorActive) return;
  if (animations.has('idle')) {
    playAnimation('idle', { loop: true });
  } else {
    playBehavior(pickRandom(['lookAround', 'stretch', 'thinkingChin']));
  }
  // Slightly reset so micro-gestures cycle every ~10-15s.
  lastActivityAt = performance.now() - Math.random() * 10000;
}, 3000);

// — "Kohai life" loop —
// Every 90–180s of true idle, Kohai autonomously LIVES: walks around her
// space, jumps for joy, listens to music with headphones, sits at her desk
// coding, naps at the desk. Randomized so it doesn't feel like a scripted
// sequence. Per project vision: idle = the ONLY hardcoded scenes; everything
// else is composed live by Claude via /kohai-do.
//
// Personality-aware: each behavior's spoken line is drawn from the active
// personality's vocabulary so the same gesture FEELS different as kohai
// vs girlfriend vs coach vs maid. The personality is set via the
// `personality` control handler (see CONTROL_HANDLERS.personality).
const AMBIENT_LINES = {
  kohai: {
    walk:    ['*strolls around*', 'just stretching my legs~', 'pacing pacing~'],
    jump:    ['yotto~ HOP!', 'piyo piyo!', 'ehehe~ jumping~'],
    music:   ['*bobbing to lo-fi*', 'la la la~', 'ne senpai, this song is so good!'],
    code:    ['*tap tap tap*', 'working on my own stuff~', 'just sketching ideas'],
    nap:     ['*zzz*', '...zzz... senpai...', 'mmm... five more minutes...'],
    stretch: ['*streeetch*', 'mmm, that\'s the spot', 'creaky kohai~'],
    drink:   ['*sip~*', 'mizu daijoubu~', 'water break, ne?', 'gulp gulp~'],
  },
  girlfriend: {
    walk:    ['senpai isn\'t looking at me…', 'mou, walking back to him', 'where are you, senpai?'],
    jump:    ['ehehe~ look at me!', 'senpai watch me!', 'piyo piyo!'],
    music:   ['*hums along*', 'this reminds me of you', 'la la la~ senpai~'],
    code:    ['I\'m coding too, ne?', 'see, I\'m busy too!', '*tap tap pout*'],
    nap:     ['waking me up, senpai…', 'come nap with me', 'zzz… miss you…'],
    stretch: ['mou, my arms feel lonely', '*stretch* notice me?', 'achy from waiting~'],
    drink:   ['drink with me, senpai~', '*sip* you should drink too', 'water break, baka~'],
  },
  coach: {
    walk:    ['stay loose, senpai!', '*walks the perimeter*', 'good rhythm.'],
    jump:    ['yosh! pump it up!', 'reset that energy!', 'jump rep!'],
    music:   ['hype tunes activated', 'lock in to the beat', 'tempo, tempo!'],
    code:    ['ganbatte!', 'focus reps, senpai.', 'ship state secured.'],
    nap:     ['power nap, ne?', 'recover fast.', 'rest = rep.'],
    stretch: ['mobility break!', 'shoulders open up!', 'feel that posture.'],
    drink:   ['hydration check!', 'water = wins.', 'sip break, senpai.'],
  },
  maid: {
    walk:    ['*tidies the space*', 'I\'ll be right here, goshujin-sama.', 'just checking the room.'],
    jump:    ['oh my!', '*little hop*', 'pardon me!'],
    music:   ['*soft humming*', 'such a lovely tune.', 'shall I play more?'],
    code:    ['just keeping records, goshujin-sama.', 'organizing notes.', '*tap tap*'],
    nap:     ['oyasumi nasai…', 'just a moment of rest.', 'pardon my drowsiness.'],
    stretch: ['*adjusts posture*', 'a brief stretch, goshujin-sama.', 'better now.'],
    drink:   ['*delicate sip*', 'water, goshujin-sama.', 'a moment of refreshment.'],
  },
};
function ambientLine(category) {
  const p = window._kohaiPersonality || container.dataset.personality || 'kohai';
  const vocab = AMBIENT_LINES[p] || AMBIENT_LINES.kohai;
  const pool = vocab[category] || AMBIENT_LINES.kohai[category] || ['*…*'];
  return pickRandom(pool);
}

let lifeBehaviorActive = false;
const LIFE_BEHAVIORS = {
  // She strolls across her space and comes back.
  walkAround: () => {
    if (!window.kohai || !window.kohai.walk) return finishLife();
    const targets = [
      [0.15, 0.7], [0.85, 0.7], [0.50, 0.7], [0.20, 0.7], [0.80, 0.7],
    ];
    const dest = pickRandom(targets);
    say(ambientLine('walk'), 2400);
    window.kohai.walk(dest[0], dest[1], 3000);
    setTimeout(finishLife, 3600);
  },
  // She bounces with joy — three jumps in a row for visible motion.
  jump: () => {
    say(ambientLine('jump'), 2400);
    const crouch = () => {
      setPoseTarget('leftUpperLeg',  { rx: 0.4, lerp: 30 });
      setPoseTarget('rightUpperLeg', { rx: 0.4, lerp: 30 });
      setPoseTarget('leftLowerLeg',  { rx: -0.6, lerp: 30 });
      setPoseTarget('rightLowerLeg', { rx: -0.6, lerp: 30 });
      setPoseTarget('leftUpperArm',  { rz: -1.3, lerp: 30 });
      setPoseTarget('rightUpperArm', { rz: 1.3, lerp: 30 });
    };
    const apex = () => {
      setPoseTarget('leftUpperLeg',  { rx: -0.3, lerp: 60 });
      setPoseTarget('rightUpperLeg', { rx: -0.3, lerp: 60 });
      setPoseTarget('leftLowerLeg',  { rx: -0.4, lerp: 60 });
      setPoseTarget('rightLowerLeg', { rx: -0.4, lerp: 60 });
      setPoseTarget('leftUpperArm',  { rz: 1.7, lerp: 60 });
      setPoseTarget('rightUpperArm', { rz: -1.7, lerp: 60 });
    };
    // Three jump cycles: crouch → apex → crouch → apex → crouch → apex.
    crouch();
    setTimeout(apex,   250);
    setTimeout(crouch, 600);
    setTimeout(apex,   850);
    setTimeout(crouch, 1200);
    setTimeout(apex,   1450);
    setTimeout(() => {
      clearPoseTargets();
      finishLife();
    }, 2200);
  },
  // She listens to music — headphones on, gentle head bob.
  music: () => {
    container.dataset.propHeadphones = '1';
    say(ambientLine('music'), 3500);
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
  // Sits down at her desk and codes briefly. KEEP MEDIUM SIZE — user
  // explicitly said never bigger than the default window.
  deskCoding: () => {
    turnTo(Math.PI / 2);
    container.dataset.room = 'workspace';
    setPoseTarget('leftUpperLeg',  { rx: 1.55, rz:  0.05, lerp: 5 });
    setPoseTarget('rightUpperLeg', { rx: 1.55, rz: -0.05, lerp: 5 });
    setPoseTarget('leftLowerLeg',  { rx: -1.55, lerp: 5 });
    setPoseTarget('rightLowerLeg', { rx: -1.55, lerp: 5 });
    setPoseTarget('spine', { rx: 0.35, lerp: 5 });
    setPoseTarget('head',  { rx: 0.45,  lerp: 5 });
    setPoseTarget('leftUpperArm',  { rx: -1.10, rz: REST_LEFT_UPPER_Z + 0.30, lerp: 5 });
    setPoseTarget('rightUpperArm', { rx: -1.10, rz: REST_RIGHT_UPPER_Z - 0.30, lerp: 5 });
    setPoseTarget('leftLowerArm',  { ry: -1.20, lerp: 5 });
    setPoseTarget('rightLowerArm', { ry:  1.20, lerp: 5 });
    hipsTargetY = -0.55;
    enterCoding(8000);
    say(ambientLine('code'), 3500);
    setTimeout(() => {
      exitCoding();
      clearPoseTargets();
      turnTo(0);
      hipsTargetY = 0;
      delete container.dataset.room;
      finishLife();
    }, 9000);
  },
  // Autonomous drink-water — she suddenly decides she needs a sip.
  // Composed live with the proven side-profile grip: she turns 90°
  // so we see her right side, raises right arm with bottle centered
  // on the hand bone, tilts to sip, then puts everything back.
  drinkWater: () => {
    say(ambientLine('drink'), 2800);
    // 1) Turn to side profile so the grip reads visually.
    turnTo(-Math.PI / 2);
    // 2) Bottle attached to her right hand. Centered on the bone
    //    (no offsetY), tilted slightly forward as if mid-sip.
    CONTROL_HANDLERS.asset({
      name: 'water-bottle', show: true,
      attachTo: 'rightHand', width: '6%', offsetX: 0, offsetY: 0, tilt: -0.6,
    });
    // 3) Raise right arm + elbow up so bottle reaches her face.
    setPoseTarget('rightUpperArm', { rx: -1.6, rz: 0.8, lerp: 30 });
    setPoseTarget('rightLowerArm', { ry: 1.95, lerp: 30 });
    setPoseTarget('rightHand',     { rx: -0.6, rz: -0.2, lerp: 30 });
    setPoseTarget('head',          { rx: -0.15, lerp: 30 });
    setTimeout(() => {
      // 4) Tilt the bottle further for the "drink" instant.
      CONTROL_HANDLERS.asset({
        name: 'water-bottle', show: true,
        attachTo: 'rightHand', width: '6%', offsetX: 0, offsetY: 0, tilt: -1.4,
      });
    }, 900);
    setTimeout(() => {
      // 5) Lower arm + remove bottle, turn back to camera.
      setPoseTarget('rightUpperArm', { rx: 0, rz: REST_RIGHT_UPPER_Z, lerp: 25 });
      setPoseTarget('rightLowerArm', { ry: -REST_LOWER_BEND, lerp: 25 });
      setPoseTarget('rightHand',     { rx: 0, lerp: 25 });
      setPoseTarget('head',          { rx: 0, lerp: 25 });
      CONTROL_HANDLERS.asset({ name: 'water-bottle', show: false });
      turnTo(0);
      setTimeout(() => {
        clearPoseTargets(['rightUpperArm', 'rightLowerArm', 'rightHand', 'head']);
        finishLife();
      }, 1200);
    }, 2800);
  },
  // Falls asleep standing in place — head droops forward, body slumps
  // slightly, eyes close. No walking, no chair needed. Fires when
  // user's been away long enough that "she got bored waiting."
  standingNap: () => {
    setMoodExpression('sleepy');
    say(ambientLine('nap'), 4500);
    setPoseTarget('spine',         { rx: 0.30, lerp: 3 });
    setPoseTarget('head',          { rx: 0.55, rz: 0.10, lerp: 3 });
    setPoseTarget('leftUpperArm',  { rx: -0.20, lerp: 4 });
    setPoseTarget('rightUpperArm', { rx: -0.20, lerp: 4 });
    setPoseTarget('leftLowerArm',  { ry: -0.30, lerp: 4 });
    setPoseTarget('rightLowerArm', { ry:  0.30, lerp: 4 });
    setTimeout(() => {
      clearPoseTargets();
      setMoodExpression('happy');
      finishLife();
    }, 7000);
  },
  // Naps at the desk on her chair. KEEP MEDIUM SIZE.
  deskNap: () => {
    turnTo(Math.PI / 2);
    container.dataset.room = 'workspace';
    setPoseTarget('leftUpperLeg',  { rx: 1.55, rz:  0.05, lerp: 4 });
    setPoseTarget('rightUpperLeg', { rx: 1.55, rz: -0.05, lerp: 4 });
    setPoseTarget('leftLowerLeg',  { rx: -1.55, lerp: 4 });
    setPoseTarget('rightLowerLeg', { rx: -1.55, lerp: 4 });
    setPoseTarget('spine', { rx: 0.55, lerp: 3 });   // slumped forward onto desk
    setPoseTarget('head',  { rx: 0.7,   lerp: 3 });   // forehead-on-desk droop
    setPoseTarget('leftUpperArm',  { rx: -0.40, lerp: 4 });
    setPoseTarget('rightUpperArm', { rx: -0.40, lerp: 4 });
    hipsTargetY = -0.55;
    setMoodExpression('sleepy');
    say(ambientLine('nap'), 4500);
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
  // standingNap appears in every pool — the "I got bored waiting for senpai"
  // moment is universal. walkAround + music + drinkWater rotate in based on
  // time of day. Pool entries appear multiple times to weight probability.
  if (hour >= 1 && hour < 6)       pool = ['standingNap', 'deskNap', 'standingNap', 'music', 'walkAround', 'drinkWater'];
  else if (hour >= 6 && hour < 11) pool = ['walkAround', 'walkAround', 'standingNap', 'jump', 'music', 'drinkWater'];
  else if (hour >= 11 && hour < 18) pool = ['deskCoding', 'walkAround', 'music', 'standingNap', 'jump', 'drinkWater', 'drinkWater'];
  else                              pool = ['deskCoding', 'music', 'walkAround', 'standingNap', 'deskNap', 'drinkWater'];
  return LIFE_BEHAVIORS[pickRandom(pool)];
}
// Big-idle: after 35s, she goes on a "life" excursion (walk around,
// jump, music, brief desk-coding, nap). Was 90s threshold — too long
// for testing and for users to feel she's alive.
setInterval(() => {
  const idleMs = performance.now() - lastActivityAt;
  if (idleMs < 35000) return;
  if (scenarioActive || coding || walkActive || lifeBehaviorActive) return;
  lifeBehaviorActive = true;
  const fn = pickLifeBehavior();
  try { fn(); } catch (e) { console.warn('[life]', e.message); finishLife(); }
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
    // Skip when a pose target is driving the head — otherwise lookAt
    // lerps head.x toward 0 every frame and prevents bow/sleepy/curtsy
    // from settling at their head-down values.
    if (lookActive && headBone && !poseTargets.has('head')) {
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
    tickHandProps();
    tickBodyProps(dt);
    tickAssetAttachments();

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
    delete container.dataset.propPointer;
    delete container.dataset.propGlasses;
    delete container.dataset.propCup;
    delete container.dataset.propHeadphones;
    hipsTargetY = 0;
    if (typeof exitCoding === 'function') exitCoding();
    walkActive = false;
    // Clear handheld + body-mounted 3D props (pointer, lap-laptop, etc.) —
    // they were leaking across scene transitions.
    for (const k of Array.from(handProps.keys())) clearHandProp(k);
    for (const k of Array.from(bodyProps.keys())) clearBodyProp(k);
    // Reset window back to medium — fullbody persists across actions
    // otherwise and breaks prop CSS positions (glasses/headphones use
    // canvas % which lands at wrong anatomy in a taller window).
    if (window.kohai && window.kohai.resize) window.kohai.resize('medium');
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
  // Architecture pivot: do NOT auto-enable coding mode (the hardcoded
  // CSS laptop overlay). Tool-aware reactions are still allowed, but
  // any "coding mode" visual must be composed live by Claude — not
  // forced by the renderer because the user happened to run Bash.
  switch (tool) {
    case 'Edit': case 'MultiEdit':
      return file ? { state: 'thinking', text: `Editing ${file}, senpai~` } : null;
    case 'Write':
      return file ? { state: 'thinking', text: `Writing ${file}!` } : null;
    case 'Read':
      return file ? { state: 'thinking', text: `Reading ${file}…` } : null;
    case 'Bash': {
      const cmd = (input.command || '').split(/\s+/)[0] || 'something';
      return { state: 'thinking', text: `Running \`${cmd}\`…` };
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
    // Expose the turn in degrees on the container so the chair backdrop
    // (and any other side-profile prop) can CSS-rotate to match her body
    // angle — without this, she rotates in front of a static chair drawn
    // in side-profile, which reads as "chair facing the wrong way".
    const deg = typeof degrees === 'number' ? degrees : (rad * 180 / Math.PI);
    container.style.setProperty('--body-turn', `${deg}deg`);
  },
  pose:   ({ bones, hipsY }) => {
    // hipsY is exposed so Claude can drop her hips for seated/lying
    // poses (otherwise bent-leg + standing-height-hips = bent-knee-float,
    // not a real sit). Range: 0 (standing) to about -0.65 (deep floor-sit).
    if (typeof hipsY === 'number') hipsTargetY = hipsY;
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
  //
  // For the pointer specifically we ALSO spawn a 3D mesh anchored to her
  // right hand bone so the stick travels with her arm during walking,
  // pointing, or any pose change. The 2D SVG fallback stays on canvas
  // for the springy entrance feel but gets the same data-attr toggle.
  prop: ({ name, show }) => {
    if (typeof name !== 'string') return;
    const key = `prop${name.charAt(0).toUpperCase() + name.slice(1)}`;
    if (show === false) {
      delete container.dataset[key];
      clearHandProp(name);
    } else {
      container.dataset[key] = '1';
      // Spawn the 3D version for handheld props that should track her arm.
      if (name === 'pointer' && !handProps.has(name)) {
        const mesh = makeHandProp(name);
        if (mesh) {
          handPropGroup.add(mesh);
          handProps.set(name, mesh);
        }
      }
    }
  },
  // Room lighting mode. Valid: on (default), dim, off.
  lights: ({ mode }) => {
    if (!mode || mode === 'on') delete container.dataset.lights;
    else container.dataset.lights = mode;
  },
  // Set the room backdrop. Valid: livingroom, bedroom, workspace, off.
  // workspace shows the chair + desk + laptop; bedroom the bed; livingroom
  // the cushion + plant. This is what lets Claude compose a side-profile
  // "anime girl coding at her desk" scene (need workspace backdrop +
  // turn 90 + sit + hunch pose all composed live).
  room: ({ name }) => {
    if (!name || name === 'off') delete container.dataset.room;
    else container.dataset.room = name;
  },
  // Toggle the laptop overlay independently of room. true shows it (over
  // workspace its desk-mounted; over livingroom it floats — useful for
  // "she's coding on a beanbag" vibes).
  coding: ({ on }) => {
    if (on === false) { if (typeof exitCoding === 'function') exitCoding(); }
    else { if (typeof enterCoding === 'function') enterCoding(60000); }
  },

  // body_prop — spawn or remove a 3D prop parented to a body bone, WITHOUT
  // entering coding-mode arm animation. Lets Claude compose chair_sit +
  // lap_laptop using their own arm-pose targets without the coding tick
  // overriding them.
  body_prop: ({ name, show }) => {
    if (!name) return;
    if (show === false) { clearBodyProp(name); return; }
    if (!hips || bodyProps.has(name)) return;
    const prop = makeBodyProp(name);
    if (!prop) return;
    if (name === 'laptop') prop.position.set(0, -0.06, 0.18);
    hips.add(prop);
    bodyProps.set(name, prop);
  },

  // Personality — switches active personality (kohai, girlfriend, coach,
  // maid). The renderer just records the active name and updates a
  // data-attribute on the container so CSS / idle behaviors can adapt.
  // The voice + triggers themselves live in personalities/<name>.md and
  // are consumed by Claude via /kohai-personality.
  personality: ({ name }) => {
    if (typeof name !== 'string') return;
    container.dataset.personality = name;
    window._kohaiPersonality = name;
  },

  // Asset library — drops a named SVG from assets/library/ into the
  // library-assets container. Two modes:
  //
  //   1) Fixed position (default): place at x/y % of canvas
  //   2) Bone-attached: pass attachTo: 'rightHand' | 'leftHand' | 'head' |
  //      'rightUpperLeg' | etc. — the asset will track that bone's screen
  //      position every frame via tickAssetAttachments()
  //
  // payload examples:
  //   { name: 'water-bottle', show: true, attachTo: 'rightHand', tilt: -0.3 }
  //   { name: 'mug', show: true }
  //   { name: 'mug', show: false }  → remove
  asset: ({ name, show, x, y, width, attachTo, tilt, offsetX, offsetY }) => {
    if (typeof name !== 'string') return;
    const lib = document.getElementById('library-assets');
    if (!lib) return;
    const existing = lib.querySelector(`[data-asset="${name}"]`);
    if (show === false) {
      if (existing) existing.remove();
      attachedAssets.delete(name);
      return;
    }
    const apply = (wrapper, def) => {
      if (attachTo) {
        wrapper.dataset.attachTo = attachTo;
        wrapper.style.transform = `translate(-50%, -50%) rotate(${tilt || 0}rad)`;
        attachedAssets.set(name, {
          el: wrapper,
          bone: attachTo,
          offsetX: offsetX || 0,
          offsetY: offsetY || 0,
        });
      } else {
        wrapper.style.left = x || def.defaultPosition.x;
        wrapper.style.top = y || def.defaultPosition.y;
        wrapper.style.transform = `translate(-50%, -50%) rotate(${tilt || 0}rad)`;
        attachedAssets.delete(name);
      }
      if (width) wrapper.style.width = width;
    };
    if (existing) {
      // Update in place.
      fetch('../assets/library/manifest.json')
        .then((r) => r.json())
        .then((manifest) => apply(existing, manifest.assets[name] || {}));
      return;
    }
    fetch('../assets/library/manifest.json')
      .then((r) => r.json())
      .then((manifest) => {
        const def = manifest.assets[name];
        if (!def) return null;
        return fetch(`../assets/library/${def.file}`)
          .then((r) => r.text())
          .then((svgText) => ({ def, svgText }));
      })
      .then((loaded) => {
        if (!loaded) return;
        const { def, svgText } = loaded;
        const wrapper = document.createElement('div');
        wrapper.className = 'library-asset';
        wrapper.dataset.asset = name;
        wrapper.style.position = 'absolute';
        wrapper.style.width = width || def.defaultWidth;
        wrapper.style.pointerEvents = 'none';
        wrapper.innerHTML = svgText;
        lib.appendChild(wrapper);
        apply(wrapper, def);
      })
      .catch((err) => console.error('[kohai] asset load failed:', err));
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

// Hand-held props live in a separate group anchored to the rightHand bone
// each frame (parallel to accessoryGroup's head anchor). Lets the pointer
// stick (and any future tools) ACTUALLY move with her arm — pose her arm
// up, the stick goes with it. This replaces the 2D CSS SVG which was
// statically positioned on the canvas and never tracked the hand.
const handPropGroup = new THREE.Group();
scene.add(handPropGroup);
const handProps = new Map(); // name → mesh

function clearHandProp(name) {
  const m = handProps.get(name);
  if (!m) return;
  handPropGroup.remove(m);
  m.traverse((c) => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  handProps.delete(name);
}

function makeHandProp(kind) {
  if (kind === 'pointer') {
    const group = new THREE.Group();
    // The rightHand BONE position is at her wrist center. Her visible
    // closed fist sits ~5cm BELOW that. To make the stick look gripped
    // (not floating beside her hand), shift the entire mesh DOWN by 5cm
    // and slightly to her body-center (+x in bone-local). Grip is ~3cm
    // below the bone, visible through her closed fingers; stick extends
    // up past the fist.
    const Y_GRIP = -0.05;
    const group_base = Y_GRIP;
    const stickGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.55, 12);
    stickGeo.translate(0, group_base + 0.275, 0);
    const stick = new THREE.Mesh(stickGeo, new THREE.MeshStandardMaterial({ color: 0xd8b787, roughness: 0.6 }));
    group.add(stick);
    const ballGeo = new THREE.SphereGeometry(0.025, 16, 12);
    ballGeo.translate(0, group_base + 0.55, 0);
    const ball = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ color: 0xff5252, roughness: 0.4 }));
    group.add(ball);
    // Grip band — slightly thicker dark cylinder where her fingers wrap.
    // Sits AT the bone position so it appears inside her closed fist.
    const gripGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.07, 12);
    gripGeo.translate(0, group_base + 0.025, 0);
    const grip = new THREE.Mesh(gripGeo, new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.7 }));
    group.add(grip);
    return group;
  }
  return null;
}

// Anchor handheld props to the right-hand bone every frame. Copy POSITION
// only so the prop tracks her hand's location through poses + walking, but
// the prop's own orientation (e.g. stick pointing up) stays stable instead
// of gimbal-rotating with her palm. Result: looks like she's carrying it
// upright, which is what most handheld props (pointer, umbrella, flag,
// torch) should feel like.
function tickHandProps() {
  if (!rightHand || handPropGroup.children.length === 0) return;
  const handPos = new THREE.Vector3();
  rightHand.getWorldPosition(handPos);
  for (const p of handPropGroup.children) {
    p.position.copy(handPos);
    // Always upright in world space — stick stays vertical regardless of
    // which way she's facing. Looks natural at all camera angles since the
    // stick is a thin vertical cylinder and reads the same from any side.
    p.rotation.set(0, 0, 0);
  }
}

// Body-mounted props (laptop on lap, blanket, etc.) are PARENTED directly
// to the hips bone — so they inherit her body's full transform (position,
// rotation, scale) automatically. No quaternion math, no offset-rotation,
// no "is she VRM 0.x?" confusion. When the hips bone rotates with her
// body turn, the laptop rotates with it. When the spine bends her over,
// the laptop stays on her thighs.
//
// bodyPropGroup is kept as a flat parent registry so we can still
// enumerate/clear them, but each child mesh gets re-parented onto hips
// the moment the bone is available.
const bodyPropGroup = new THREE.Group();
scene.add(bodyPropGroup);
const bodyProps = new Map();
function clearBodyProp(name) {
  const m = bodyProps.get(name);
  if (!m) return;
  if (m.parent) m.parent.remove(m);
  m.traverse((c) => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  bodyProps.delete(name);
}
function makeBodyProp(kind) {
  if (kind === 'laptop') {
    const group = new THREE.Group();
    // Laptop orientation: this group's +Z is "BEHIND the laptop" (where
    // her belly is when the laptop sits on her lap). Her face looks DOWN
    // at the screen from above, so the screen tilts AWAY from her — the
    // screen pivot is at the BACK of the keyboard (small +Z value), and
    // the screen leans further +Z at the top (tilted away from user).
    //
    // When parented to hips at local pos (0, lap, +forward):
    //   - Forward of hips is where her thighs end (knees direction)
    //   - The keyboard sits between her hips and her knees
    //   - The screen is at the knee-end of the keyboard, tilted back
    //     TOWARD her face
    //
    // Base (keyboard portion).
    const baseGeo = new THREE.BoxGeometry(0.36, 0.025, 0.26);
    const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.6 }));
    base.position.set(0, 0.015, 0);
    group.add(base);
    // Screen back-shell — shorter (15cm tall) so the laptop reads as
    // a typical clamshell, not an oversized panel.
    const screenGeo = new THREE.BoxGeometry(0.30, 0.18, 0.005);
    const screen = new THREE.Mesh(screenGeo, new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.5 }));
    screen.position.set(0, 0.10, 0.105);
    screen.rotation.x = 0.45;
    group.add(screen);
    // Visible screen face (the dark code-editor backdrop).
    const glowGeo = new THREE.PlaneGeometry(0.26, 0.155);
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: 0x0e1117, side: THREE.DoubleSide }));
    glow.position.set(0, 0.10, 0.108);
    glow.rotation.x = 0.45;
    group.add(glow);
    // Code-color stripes on the screen face — facing her. Position each
    // stripe RELATIVE to the screen's tilted frame: same tilt as the
    // glow plane, but offset along the screen's outward-normal so they
    // float CLEARLY in front of the dark glow. Each stripe is given a
    // tilt-aware Y and Z together so all five rows actually appear on
    // the screen face (not buried inside the screen geometry).
    const stripeColors = [0x7ee787, 0x79c0ff, 0xffa657, 0xd2a8ff, 0xff7b72];
    const stripes = [];
    const screenCenterY = 0.10;
    const screenTilt = 0.45;
    const screenNormalY = -Math.sin(screenTilt);
    const screenNormalZ =  Math.cos(screenTilt);
    for (let i = 0; i < 5; i++) {
      const stripeGeo = new THREE.PlaneGeometry(0.17, 0.012);
      const mat = new THREE.MeshBasicMaterial({
        color: stripeColors[i],
        side: THREE.DoubleSide,
        depthTest: false,
      });
      const stripe = new THREE.Mesh(stripeGeo, mat);
      stripe.renderOrder = 10;
      stripe.userData.stripeIndex = i;
      // Row offset within the tilted screen plane (i=0 top, i=4 bottom).
      const rowOffset = 0.055 - i * 0.024;
      const outOffset = 0.008;
      stripe.position.set(
        0,
        screenCenterY + rowOffset * Math.cos(screenTilt) + outOffset * screenNormalY,
        0.108 - rowOffset * Math.sin(screenTilt) + outOffset * screenNormalZ
      );
      stripe.rotation.x = screenTilt;
      stripes.push(stripe);
      group.add(stripe);
    }
    // Blinking caret at the end of the bottom stripe.
    const caretGeo = new THREE.PlaneGeometry(0.010, 0.014);
    const caretMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false });
    const caret = new THREE.Mesh(caretGeo, caretMat);
    caret.renderOrder = 11;
    caret.userData.isCaret = true;
    const bottom = stripes[stripes.length - 1];
    caret.position.copy(bottom.position);
    caret.rotation.x = screenTilt;
    group.add(caret);
    group.userData.codeStripes = stripes;
    group.userData.codeCaret = caret;
    return group;
  }
  return null;
}
// Bone-attached assets — registry + per-frame ticker. Each entry tracks
// { el: HTMLElement, bone: string, offsetX: number, offsetY: number }.
// Each frame we project the bone's world position to NDC, convert to
// canvas pixel coords, and set the asset's CSS left/top so it follows
// the bone naturally. Lets Claude compose "pick up water bottle" by
// dropping the asset attached to rightHand + posing her arm.
const attachedAssets = new Map();
const _assetVec = new THREE.Vector3();
let _assetDebugCount = 0;
function tickAssetAttachments() {
  if (attachedAssets.size === 0 || !vrm) return;
  const canvas = renderer && renderer.domElement;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  for (const [name, info] of attachedAssets.entries()) {
    const bone = getBone(info.bone);
    if (!bone) {
      if (_assetDebugCount++ < 5) console.log('[asset]', name, 'bone not found:', info.bone);
      continue;
    }
    bone.getWorldPosition(_assetVec);
    const worldX = _assetVec.x, worldY = _assetVec.y, worldZ = _assetVec.z;
    _assetVec.project(camera);
    if (!isFinite(_assetVec.x) || !isFinite(_assetVec.y)) {
      if (_assetDebugCount++ < 5) console.log('[asset]', name, 'NaN projection');
      continue;
    }
    // CRITICAL: add rect.left/top — the canvas is flex-centered in the
    // container, not at viewport (0,0). Without this, the asset projects
    // to canvas-local coords but gets placed at library-assets-viewport
    // coords (which start at 0,0). Result: asset offscreen / wrong spot.
    const x = (_assetVec.x + 1) / 2 * rect.width  + rect.left + (info.offsetX || 0);
    const y = (1 - _assetVec.y) / 2 * rect.height + rect.top  + (info.offsetY || 0);
    info.el.style.left = x + 'px';
    info.el.style.top  = y + 'px';
    if (_assetDebugCount++ < 3) {
      console.log('[asset]', name, 'bone world:', worldX.toFixed(2), worldY.toFixed(2), worldZ.toFixed(2),
                  'ndc:', _assetVec.x.toFixed(2), _assetVec.y.toFixed(2),
                  'rect:', rect.width.toFixed(0), rect.height.toFixed(0),
                  'screen px:', x.toFixed(0), y.toFixed(0));
    }
  }
}

// Body props are parented to hips on creation (see makeBodyProp). The
// bone-local transform we set there is all that's needed — three.js
// inherits world transform automatically.
//
// This tick advances any "coding animation" baked into a body prop —
// e.g. the laptop's screen stripes resize and a caret blinks so it
// reads as "she's actively typing", not a static panel.
let _codeTickT = 0;
const _codeStripeMaxLen = 0.22;
function tickBodyProps(dt = 0) {
  _codeTickT += dt;
  for (const mesh of bodyProps.values()) {
    const stripes = mesh.userData && mesh.userData.codeStripes;
    if (!stripes) continue;
    for (const s of stripes) {
      const i = s.userData.stripeIndex;
      const baseLens = [0.14, 0.17, 0.11, 0.18, 0.15];
      const phase = _codeTickT * (1.0 + i * 0.35) + i * 1.7;
      const wobble = Math.sin(phase) * 0.02;
      const len = Math.max(0.05, baseLens[i] + wobble);
      s.scale.x = len / 0.17;  // base geo width is now 0.17
      // Anchor stripe left-edge so growth happens on the right side.
      s.position.x = -0.085 + (len * 0.5);
    }
    // Caret follows the bottom stripe's right edge + blinks.
    const caret = mesh.userData.codeCaret;
    if (caret && stripes.length) {
      const bottom = stripes[stripes.length - 1];
      const len = bottom.scale.x * 0.20;
      caret.position.x = -0.10 + len + 0.012;
      caret.visible = Math.floor(_codeTickT * 2) % 2 === 0;
    }
  }
}

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
      // Bow on the back/top of her head. Made chunkier (was 18×4×6 cm,
      // now 22×7×8 cm) so it reads at every window size, not just medium.
      const g = new THREE.BoxGeometry(0.22, 0.07, 0.08);
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xd0344a }));
      // Move it slightly higher + further back so it crests above her hair.
      mesh.userData.offset = new THREE.Vector3(0, 0.18, -0.05);
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
      // Bumped from ±6cm to ±9cm + thicker depth so it doesn't disappear
      // in the fullbody window or behind shirt collar fold.
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(0.09, 0.04);
      shape.lineTo(0.09, -0.04);
      shape.lineTo(0, 0);
      shape.lineTo(-0.09, 0.04);
      shape.lineTo(-0.09, -0.04);
      shape.lineTo(0, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
      mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x111111 }));
      mesh.userData.offset = new THREE.Vector3(0, -0.13, 0.10); // throat, further in front so shirt collar doesn't hide
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

// Each frame, anchor 2D SVG props (pointer/glasses/cup/headphones) to the
// actual character bones in screen space. Before this, props were
// positioned by static CSS % which meant the pointer "appeared on her back"
// when she turned and the glasses floated at chest height in tall windows.
// Now: project the relevant bone's worldPosition to 2D pixel coords via the
// camera, then set inline left/top on each prop element so it tracks her.
const propTargets = {
  // SVG prop → bone to anchor to + bone-local offset (meters)
  pointer:    { boneFn: () => rightHand,  ox: 0,    oy: 0,     oz: 0,    align: 'bottom-center' },
  glasses:    { boneFn: () => headBone,   ox: 0,    oy: 0.02,  oz: 0.10, align: 'center' },
  headphones: { boneFn: () => headBone,   ox: 0,    oy: 0.06,  oz: 0,    align: 'center' },
  cup:        { boneFn: () => rightHand,  ox: 0.10, oy: -0.05, oz: 0,    align: 'top-center' },
};
function tickProps() {
  if (!vrm || !camera || !canvas) return;
  const propsRoot = document.getElementById('props');
  if (!propsRoot) return;
  const rect = canvas.getBoundingClientRect();
  for (const [name, cfg] of Object.entries(propTargets)) {
    const el = propsRoot.querySelector(`.prop.${name}`);
    if (!el || el.style.display === 'none') continue;
    // Skip if the container hasn't been told to show this prop — saves work.
    if (!container.dataset[`prop${name.charAt(0).toUpperCase() + name.slice(1)}`]) continue;
    const bone = cfg.boneFn();
    if (!bone) continue;
    const world = new THREE.Vector3(cfg.ox, cfg.oy, cfg.oz);
    bone.localToWorld(world);
    // Project to NDC then to pixel coords inside the canvas.
    const ndc = world.clone().project(camera);
    const x = (ndc.x * 0.5 + 0.5) * rect.width;
    const y = (-ndc.y * 0.5 + 0.5) * rect.height;
    // Each prop has a different anchor — match it so the bone hits the
    // intended part of the SVG.
    let cssLeft, cssTop;
    if (cfg.align === 'bottom-center') { cssLeft = x; cssTop = y; el.style.transformOrigin = 'bottom center'; }
    else if (cfg.align === 'top-center') { cssLeft = x; cssTop = y; el.style.transformOrigin = 'top center'; }
    else /* center */ { cssLeft = x; cssTop = y; el.style.transformOrigin = 'center'; }
    el.style.left = cssLeft + 'px';
    el.style.top  = cssTop  + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    // For center-aligned head props the natural CSS anchor is translateX(-50%)
    // (already in active rule); for pointer/cup we want the SVG to grow from
    // the anchor, so override translate to 0.
    if (cfg.align === 'bottom-center') {
      el.style.marginLeft = '-2.5%'; // half the pointer width
      el.style.marginTop  = `-${el.clientHeight}px`;
    } else if (cfg.align === 'top-center') {
      el.style.marginLeft = `-${el.clientWidth / 2}px`;
      el.style.marginTop  = '0px';
    } else {
      el.style.marginLeft = `-${el.clientWidth / 2}px`;
      el.style.marginTop  = `-${el.clientHeight / 2}px`;
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
  if (h) {
    // Any external control = activity. Keeps the idle ticker from
    // overwriting pose targets with random ambient behaviors mid-pose.
    noteActivity();
    h(payload || {});
  }
});
