import * as THREE from 'three';
import { AnaglyphEffect } from 'three/addons/effects/AnaglyphEffect.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { loadAssets, Factory, WIND } from './assets.js';
import { renderIcons } from './icons.js';
import { Tutorial } from './tutorial.js';
import { Game } from './game.js';
import { RTSCamera } from './camera.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { startDisplayXR } from './displayxr.js';
import { BASES } from './terrain.js';
import { PLAYER } from './config.js';
import { loadSave, clearSave } from './saga.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');

// ---- renderer / scene ------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
// Soft, mid-tone sky: low contrast behind the subject keeps crosstalk/ghosting down on a 3D panel.
const SKY = 0xbcd3e3;
renderer.setClearColor(SKY, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 400);

scene.add(new THREE.HemisphereLight(0xe4f0ff, 0x6b7a4a, 1.25));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const anaglyph = new AnaglyphEffect(renderer, window.innerWidth, window.innerHeight);
anaglyph.eyeSep = 0.6;
let anaglyphOn = false;

// Post-processing for the 2D view only (bloom on crystals/magic + SMAA). The DisplayXR stereo
// path renders the scene directly, so both eyes always match.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.5, 0.88);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const smaa = new SMAAPass(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio());
composer.addPass(smaa);
let fancy = !/low/.test(location.search);

// ---- boot ------------------------------------------------------------------------------------
let assets, factory, game, rtsCam, input, hud, dxr = null;
let paused = false;
const params = new URLSearchParams(location.search);

async function boot() {
  assets = await loadAssets((f) => {
    $('load-fill').style.width = `${Math.round(f * 100)}%`;
  });
  factory = new Factory(assets);
  try { factory.icons = renderIcons(renderer, factory); } catch (e) { console.warn('icons', e); }
  $('load-text').textContent = 'Ready';
  $('loading').classList.add('hidden');
  if (params.get('mode') === 'viking') document.querySelector('input[name="mode"][value="viking"]').checked = true;
  refreshSagaRow();
  if (params.has('tutorial')) start('easy', true);
  else if (params.get('diff')) start(params.get('diff'), false, params.get('mode') || 'classic');
  else $('start-screen').classList.remove('hidden');
}

let tutorial = null;
function start(difficulty, tut = false, mode = 'classic') {
  $('start-screen').classList.add('hidden');
  $('load-text').textContent = 'Building the realm…';
  game = new Game({
    scene, factory, assets, difficulty, mode, save: mode === 'viking' ? loadSave() : null,
    hooks: {
      onFloat: (p, text, cls) => hud?.floatText(p, text, cls),
      onNotify: (t, k) => hud?.toast(t, k),
      onAttackAlert: (p) => hud?.alertAt(p),
      onSelectionChange: () => hud?.renderCommands(),
      onGameOver: (r) => gameOver(r),
      onDeposit: (p, kind, n) => hud?.floatText(p, `+${n}`, kind),
    },
  });
  rtsCam = new RTSCamera(camera, game.terrain);
  const b = BASES[PLAYER];
  rtsCam.focus(b.x + 4, b.z - 4);
  rtsCam.update(0);
  game.camTarget = rtsCam.target;
  input = new Input({ canvas, camera, rtsCam, game, scene, factory });
  hud = new HUD(game, rtsCam, input);
  hud.icons = factory.icons;
  input.hud = hud;
  hud.renderCommands();
  if (tut) tutorial = window.__tut = new Tutorial({ game, hud, input, rtsCam, scene });
  else if (game.saga) {
    const sg = game.saga;
    const msgs = sg.save0 ? [`Welcome back! Great Hall Lv ${sg.hallLevel()}.`, ...sg.away] : [
      'Skål! Welcome to your Clan Saga. Your progress saves automatically.',
      'Upgrade the Great Hall (select it, press U) to unlock buildings and heroes.',
      'Select the Jarl with troops and press B to form a warband, then clear Barbarian camps.',
    ];
    msgs.slice(0, 4).forEach((m, i) => setTimeout(() => hud.toast(m, i === 0 ? 'good' : 'info'), i * 2800));
    window.addEventListener('beforeunload', () => game.saga.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) game.saga.save(); });
  } else hud.toast('Gather resources, build an army, destroy the enemy Castle!', 'good');
  window.__game = game; // handy for debugging in the console
  window.__cam = rtsCam;
  window.__camera = camera;
  monoLoop();
  tryDisplayXR();
}

// one simulation + camera step, shared by the 2D loop and the DisplayXR loop
function frame(dt) {
  if (!paused) game.update(dt);
  if (!paused) tutorial?.update(dt);
  WIND.value += dt;
  for (const s of game.world.spinners) s.rotation.z += dt * 0.8;
  rtsCam.update(dt);
  // screen shake from heavy impacts (2D only: shaking a 3D display is uncomfortable)
  if (game.shakeAmt > 0 && !(dxr && dxr.active)) {
    const a = game.shakeAmt * game.shakeAmt * 0.35 * (rtsCam.height / 24);
    camera.position.x += (Math.random() - 0.5) * a;
    camera.position.y += (Math.random() - 0.5) * a;
    camera.position.z += (Math.random() - 0.5) * a;
    camera.updateMatrixWorld();
  }
  input.update();
  hud.update(dt);
  // shadows follow the view
  const t = rtsCam.target;
  const ext = Math.max(24, rtsCam.height * 1.3);
  sun.position.set(t.x - 25, t.y + 45, t.z + 18);
  sun.target.position.copy(t);
  const sc = sun.shadow.camera;
  if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.far = 140; sc.updateProjectionMatrix(); }
}

// ---- 2D (non-DisplayXR) render loop ----------------------------------------------------------
let last = performance.now();
let monoRunning = false;
function monoLoop() {
  if (monoRunning) return;
  monoRunning = true;
  last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    frame(dt);
    if (anaglyphOn) anaglyph.render(scene, camera);
    else if (fancy) composer.render(dt);
    else renderer.render(scene, camera);
  });
}
function stopMono() { renderer.setAnimationLoop(null); monoRunning = false; }

async function tryDisplayXR() {
  const badge = $('dxr-badge');
  badge.textContent = '2D';
  badge.title = 'Open in the DisplayXR Browser on a spatial display for glasses-free 3D';
  dxr = await startDisplayXR({
    THREE, renderer, scene, camera, rtsCam, canvas, frame,
    onLost: () => { badge.textContent = '2D'; badge.classList.remove('on'); onResize(); monoLoop(); },
  });
  if (dxr && dxr.active) {
    stopMono(); // only after the woven scene was added successfully
    badge.textContent = 'DisplayXR 3D';
    badge.classList.add('on');
  }
}

function onResize() {
  if (dxr && dxr.active) return; // the DisplayXR path sizes its own double-width buffer
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  anaglyph.setSize(window.innerWidth, window.innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

window.addEventListener('keydown', (e) => {
  if (!game) return;
  if (e.key === 'p' || e.key === 'P') togglePause();
  if (e.key === 'F2') { e.preventDefault(); fancy = !fancy; hud.toast(fancy ? 'Graphics: high' : 'Graphics: fast'); }
  if (e.key === 'F3') { e.preventDefault(); anaglyphOn = !anaglyphOn; if (!anaglyphOn) onResize(); hud.toast(anaglyphOn ? 'Stereo preview (red/cyan)' : 'Stereo preview off'); }
});
function togglePause() {
  if (game.over) return;
  paused = !paused;
  $('pause-screen').classList.toggle('hidden', !paused);
  input.enabled = !paused;
}
$('btn-menu').addEventListener('click', togglePause);
$('btn-resume').addEventListener('click', togglePause);

function gameOver(result) {
  const st = game.teams[PLAYER];
  setTimeout(() => {
    $('end-title').textContent = result === 'victory' ? 'Victory!' : 'Defeat';
    $('end-title').style.color = result === 'victory' ? '#e8c46a' : '#ef5a4f';
    const m = Math.floor(game.time / 60);
    $('end-text').innerHTML = result === 'victory'
      ? `The Bone Legion's castle has fallen after ${m} minutes.`
      : `Your castle has fallen after ${m} minutes.`;
    $('end-text').innerHTML += `<br>Resources gathered: <b>${st.gathered}</b> · Enemies defeated: <b>${st.killed}</b> · Losses: <b>${st.lost}</b>`;
    $('end-screen').classList.remove('hidden');
  }, 2200);
}

$('btn-start').addEventListener('click', () => {
  const d = document.querySelector('input[name="diff"]:checked')?.value || 'normal';
  const m = document.querySelector('input[name="mode"]:checked')?.value || 'classic';
  start(d, false, m);
});
$('btn-tutorial').addEventListener('click', () => start('easy', true));
function refreshSagaRow() {
  const viking = document.querySelector('input[name="mode"]:checked')?.value === 'viking';
  const s = loadSave();
  $('saga-row').classList.toggle('hidden', !viking || !s);
  if (s) {
    const hall = s.buildings?.find((b) => b.type === 'keep')?.level || 1;
    $('saga-info').innerHTML = `Saved saga: Great Hall <b>Lv ${hall}</b> · ${s.units?.length || 0} clansfolk · ${s.stats?.campsCleared || 0} camps cleared`;
  }
  $('btn-start').textContent = viking ? (s ? 'Continue saga' : 'Begin saga') : 'Start battle';
}
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', refreshSagaRow));
$('btn-newsaga').addEventListener('click', () => {
  if (!confirm('Erase your saved saga and start over?')) return;
  clearSave();
  refreshSagaRow();
});
$('btn-restart').addEventListener('click', () => {
  const d = game?.difficulty?.label?.toLowerCase() || 'normal';
  location.search = `?diff=${d}${game?.viking ? '&mode=viking' : ''}`;
});

boot().catch((err) => {
  console.error(err);
  $('load-text').textContent = `Failed to load: ${err.message}`;
});
