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

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
camera.position.set(0, 1.35, 2.4);
camera.lookAt(0, 1.2, 0);

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
  vrm.scene.rotation.y = Math.PI; // face the camera
  scene.add(vrm.scene);

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

function applyIdlePose() {
  setRotation(leftUpperArm,  0, 0,  0.05);
  setRotation(rightUpperArm, 0, 0, -0.05);
  setRotation(leftLowerArm,  0, 0, 0);
  setRotation(rightLowerArm, 0, 0, 0);
  setRotation(spine, 0, 0, 0);
  setRotation(headBone, 0, 0, 0);
  if (hips) hips.position.set(0, 0, 0);
}

// — Look-at-target system: head and eyes track a point in space.
const lookTarget = new THREE.Vector3(0, 1.3, 1.5);
let lookActive = true;

// — Body rotation: smoothly turn the character toward a y-rotation target.
let bodyTargetY = Math.PI; // facing camera by default
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

// — Walking: simple left-right step animation by translating hips.
let walkPhase = 0;
let walkActive = false;

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

    if (coding) {
      // Arms forward, elbows bent, hands at keyboard height.
      // Upper arm: rotated forward (around X axis ≈ -1.2)
      const baseUpperX = -1.2;
      const baseLowerX = -1.4;
      const tap = Math.sin(t * 9);
      const tapR = Math.sin(t * 9 + Math.PI);
      setRotation(leftUpperArm,  baseUpperX + tap * 0.04, 0, 0.4);
      setRotation(rightUpperArm, baseUpperX + tapR * 0.04, 0, -0.4);
      setRotation(leftLowerArm,  baseLowerX, 0,  0.0);
      setRotation(rightLowerArm, baseLowerX, 0,  0.0);
      // Fingers tap (hand bend).
      if (leftHand)  leftHand.rotation.x  = -0.3 + tap  * 0.25;
      if (rightHand) rightHand.rotation.x = -0.3 + tapR * 0.25;
      // Lean forward + look down.
      if (spine) spine.rotation.x = -0.15 + Math.sin(t * 1.3) * 0.012;
      if (headBone) headBone.rotation.x = 0.3;
    } else {
      // Relax to idle pose.
      const lerpRate = Math.min(1, dt * 4);
      [leftUpperArm, rightUpperArm, leftLowerArm, rightLowerArm].forEach((b) => {
        if (!b) return;
        b.rotation.x += (0 - b.rotation.x) * lerpRate;
      });
      if (leftUpperArm)  leftUpperArm.rotation.z  += (0.05 - leftUpperArm.rotation.z)  * lerpRate;
      if (rightUpperArm) rightUpperArm.rotation.z += (-0.05 - rightUpperArm.rotation.z) * lerpRate;
      if (leftHand)  leftHand.rotation.x  += (0 - leftHand.rotation.x)  * lerpRate;
      if (rightHand) rightHand.rotation.x += (0 - rightHand.rotation.x) * lerpRate;
    }

    // Walking bob.
    if (walkActive && hips) {
      walkPhase += dt * 6;
      hips.position.y = Math.abs(Math.sin(walkPhase)) * 0.04;
    } else if (hips && hips.position.y !== 0) {
      hips.position.y += (0 - hips.position.y) * Math.min(1, dt * 5);
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
  // VRM state mapping is mostly cosmetic — head/body angle hints.
  if (state === 'sleepy' && headBone) headBone.rotation.x = 0.5;
  if (state === 'panic') turnTo(Math.PI + Math.sin(performance.now() / 100) * 0.3);
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

const HOOK_HANDLERS = {
  SessionStart: () => setState('happy', { text: 'Konnichiwa, senpai!' }),
  SessionEnd:   () => setState('sleepy'),
  UserPromptSubmit: () => setState('thinking', { silent: true }),
  PreToolUse: (data) => {
    const r = describeTool(data);
    if (!r) return;
    setState(r.state, { text: r.text });
    if (r.coding) enterCoding();
  },
  PostToolUse: (data) => {
    if (CODING_TOOLS.has(data?.tool_name)) setTimeout(exitCoding, 700);
    const file = basenameOf(data?.tool_input?.file_path);
    setState('happy', { text: file ? `Saved ${file}! Yatta~` : 'Done!' });
  },
  Stop: () => setState('happy'),
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
