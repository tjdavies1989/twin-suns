// ============================================================================
//  main.js — the engine. Reads every name, colour and number from THEME.
//
//    boot -> title -> playing <-> levelup / paused -> gameover | victory -> restart
//
//  Layout of this file:
//    1. constants + state            6. weapons (bolt / orbit / lob / nova / chain)
//    2. boot + renderer + camera     7. bolts, crystals, pickups
//    3. spawn table + spawning       8. XP, level-up cards, passives
//    4. enemies (AI, grid, death)    9. player, phases
//    5. damage + feedback           10. sim step, visual sync, loop, debug hooks
// ============================================================================
import * as THREE from 'three';
import THEME from './theme.js';
import { loadModels, makeModel } from './models.js';
import { initAudio, play, setMuted, isMuted, startMusic, stopMusic } from './audio.js';
import { createInput } from './input.js';
import { createUI } from './ui.js';
import { createWorld } from './world.js';
import { createParticles, createBoltViz, createLightningViz, createRings } from './fx.js';
import { TAU, DEG, clamp, angDelta, makeInstanced, setYawMatrix, flushInstanced, mixHex } from './util.js';

// ---------------------------------------------------------------------------
//  1. Engine-only constants (camera, pool sizes, feel). Content lives in theme.js.
// ---------------------------------------------------------------------------
const STEP = 1 / 60;
const MAX_FRAME_DT = 1 / 20;
const PITCH = 55 * DEG;
const VFOV = 45;
const VIEW_HALF_W = 7.5;          // metres visible to each side of the hero in portrait
const CELL = 2.5;                 // spatial hash cell size (m)
const GRID_BITS = 7, GRID_N = 1 << GRID_BITS, GRID_MASK = GRID_N - 1;
const SPAWN_N = 72;               // angles in the spawn-distance table
const KB_DAMP = 7;                // knockback friction (1/s); impulse = metres * KB_DAMP
const DEATH_DUR = 0.55;
const FLASH_TIME = 0.07;
const BOLT_CAP = 220;
const CRYSTAL_SCALE = 1.25;
const BLAST_KB = 3.2;             // metres, explosion knockback at the centre
const HAND_Y = 1.05;              // bolt / lightning origin height on the hero
const NOVA_DUR = 0.4;
const TITLE_SHIFT = 14;            // metres the camera looks ahead of the hero on the title screen
const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

const ENEMY_KEYS = Object.keys(THEME.enemies);
const MAXR = Math.max(...ENEMY_KEYS.map((k) => THEME.enemies[k].radius)) * Math.max(1, THEME.elites.scaleMult) + 0.2;
const MAX_ENEMIES = THEME.maxEnemies;
const PICK = THEME.pickups;
// Heal colour: theme `pickups.heal.color`, else the first colour of the heal model entry (absent when the model is a .glb), else a neutral teal.
function healHex() {
  if (PICK.heal.color) return PICK.heal.color;
  const m = THEME.models[PICK.heal.model];
  return (m && m.colors && Object.values(m.colors)[0]) || '#5dd6c0';
}
const STR = THEME.strings;

// ---------------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------------
const G = {
  phase: 'loading', time: 0, level: 1, xp: 0, xpNext: 1, kills: 0, hp: 1, maxHp: 1,
  god: false, pendingLevels: 0, choices: [], cards: [], timeScale: 1,
  nextEliteAt: 0, bossDone: [], spawnAcc: 0, endDelay: 0, hurtFlash: 0, shake: 0, boss: null,
  fps: 60, drawCalls: 0, uid: 0, castId: 0, novaId: 0,
};
const stats = { damageMult: 1, cooldownMult: 1, speedMult: 1, pickupMult: 1, maxHp: 1, regen: 0, armor: 0 };
const P = { x: 0, z: 0, vx: 0, vz: 0, face: 0, flashT: 0, flashCd: 0, moving: false, speed: 0, flashing: false, radius: THEME.player.radius, hurtSnd: 0, deathT: 0, model: null, holder: null, h: 1.8 };
const weapons = [];          // runtime weapon objects
const passives = {};         // id -> level
let loadoutSig = '';
let loadoutList = [];

// Rendering objects (assigned in boot)
let renderer, scene, camera, stage, canvas, world, ui, input, particles, boltViz, lightningViz, rings;
let camDist = 20, camH = 16, camBack = 11, viewW = 1, viewH = 1;
const camT = { x: 0, z: 0 };
const spawnTable = new Float32Array(SPAWN_N);
let viewRadius = 20;
let stopped = false, rafId = 0, lastTs = 0, accum = 0;
const fxMeshes = [];         // everything that toggles visibility on its own (for shader warm-up)

// Reused scratch objects
const _mv = { x: 0, z: 0 };
const _sp = { x: 0, z: 0 };
const _v3 = new THREE.Vector3();
const rgbCache = new Map();
function rgbOf(hex) {
  let c = rgbCache.get(hex);
  if (!c) { const t = new THREE.Color(hex); c = { r: t.r, g: t.g, b: t.b }; rgbCache.set(hex, c); }
  return c;
}

// ---------------------------------------------------------------------------
//  Fatal error handling: never a silent blank screen
// ---------------------------------------------------------------------------
function fatal(err) {
  stopped = true;
  if (rafId) cancelAnimationFrame(rafId);
  const msg = (err && (err.stack || err.message)) ? String(err.stack || err.message) : String(err);
  console.error('[twin-suns] fatal:', err);
  if (window.__showFatal) window.__showFatal(msg.split('\n').slice(0, 6).join('\n'));
}

// ===========================================================================
//  2. Boot
// ===========================================================================
async function boot() {
  stage = document.getElementById('stage');
  canvas = document.getElementById('c');
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    throw new Error('WebGL is not available in this browser, so the 3D view cannot start.\n' + (e && e.message));
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    fatal(new Error('The graphics context was lost (the browser took the GPU back). Reload the page to continue.'));
  });
  renderer.toneMapping = THREE.NoToneMapping;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(VFOV, 1, 1, 400);
  camera.rotation.set(-PITCH, 0, 0);

  try { await loadModels(THEME); } catch (e) { console.warn('[twin-suns] loadModels failed, continuing with fallbacks', e); }

  world = createWorld({ scene, THEME, makeModel });
  particles = createParticles(scene);
  boltViz = createBoltViz(scene, BOLT_CAP);
  lightningViz = createLightningViz(scene);
  rings = createRings(scene, 8);
  fxMeshes.push(world.shadowMesh, ...particles.meshes, ...boltViz.meshes, ...lightningViz.meshes, ...rings.meshes);

  ui = createUI(THEME, {
    onStart: () => startRun(),
    onPause: () => togglePause(),
    onRestart: () => restartRun(),
    onMute: () => toggleMute(),
    onChoose: (i) => chooseCard(i),
  });
  input = createInput({
    stage,
    joy: document.getElementById('joy'),
    ring: document.getElementById('joyRing'),
    knob: document.getElementById('joyKnob'),
    onPause: () => togglePause(),
    onChoose: (i) => { if (G.phase === 'levelup' && ui.cardsArmed()) chooseCard(i); },
  });

  buildPlayer();
  buildPools();
  buildCrystalViz();
  buildHealPickups();
  buildWeaponFx();

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(stage);
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.phase === 'playing') togglePause(); });
  resize();

  resetRun();
  setPhase('title');
  warmup();
  installDebug();
  ui.hideLoading();
  lastTs = performance.now();
  rafId = requestAnimationFrame(frame);
}

function resize() {
  if (!renderer) return;
  const w = Math.max(1, stage.clientWidth || window.innerWidth);
  const h = Math.max(1, stage.clientHeight || window.innerHeight);
  if (w === viewW && h === viewH) return;
  viewW = w; viewH = h;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Keep ~VIEW_HALF_W metres visible to each side in portrait; in landscape show a little more.
  const ar = clamp(w / h, 0.4, 1.0);
  camDist = clamp(VIEW_HALF_W / (ar * Math.tan(VFOV * 0.5 * DEG)), 13, 64);
  camH = camDist * Math.sin(PITCH);
  camBack = camDist * Math.cos(PITCH);
  camera.updateProjectionMatrix();
  world.setFogRange(camDist + THEME.world.fogNear * 0.6, camDist + THEME.world.fogFar * 0.6);
  computeSpawnTable();
}

/** For each direction, how far from the hero the ground leaves the screen. Spawns happen just past that. */
function computeSpawnTable() {
  const cam = new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
  cam.position.set(0, camH, camBack);
  cam.rotation.set(-PITCH, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  let maxD = 0;
  for (let k = 0; k < SPAWN_N; k++) {
    const a = (k / SPAWN_N) * TAU, dx = Math.sin(a), dz = Math.cos(a);
    let d = 4;
    for (; d < 90; d += 1) {
      _v3.set(dx * d, 0, dz * d).project(cam);
      if (_v3.z > 1 || Math.abs(_v3.x) > 1.14 || Math.abs(_v3.y) > 1.14) break;
    }
    spawnTable[k] = d;
    if (d > maxD) maxD = d;
  }
  viewRadius = maxD;
}

function warmup() {
  // Make every pooled thing visible for one compile so first use never hitches on shader builds.
  const shown = [];
  for (const key of ENEMY_KEYS) { const e = takeShell(key); e.holder.visible = true; shown.push(e); }
  const saved = fxMeshes.map((m) => [m.visible, m.count]);
  for (const m of fxMeshes) { m.visible = true; if (m.isInstancedMesh) m.count = Math.max(1, m.count); }
  charges[0].group.visible = true;
  try { renderer.compile(scene, camera); } catch (e) { /* non-fatal */ }
  charges[0].group.visible = false;
  fxMeshes.forEach((m, i) => { m.visible = saved[i][0]; if (m.isInstancedMesh) m.count = saved[i][1]; });
  for (const e of shown) releaseShell(e);
}

// ===========================================================================
//  3. Spawn points + spawning
// ===========================================================================
function spawnPointOut(out, heading) {
  // Prefer directions where the screen edge is close (portrait: left/right), so enemies do not take ten seconds to arrive from the far top/bottom.
  // `heading` (optional, radians, same convention as the table: x = sin, z = cos) restricts the pick to +-60 degrees around it (used when relocating stragglers ahead of a moving hero).
  let k, a;
  if (heading !== undefined) {
    a = heading + (Math.random() - 0.5) * (2 * Math.PI / 3);
    k = ((Math.floor(((a % TAU) + TAU) % TAU / TAU * SPAWN_N)) % SPAWN_N + SPAWN_N) % SPAWN_N;
  } else {
    k = (Math.random() * SPAWN_N) | 0;
    for (let tries = 0; tries < 4 && Math.random() > Math.min(1, 15 / spawnTable[k]); tries++) k = (Math.random() * SPAWN_N) | 0;
    a = ((k + Math.random()) / SPAWN_N) * TAU;
  }
  const d = Math.max(10, spawnTable[k]) + 1.5 + Math.random() * 2.5;
  out.x = P.x + Math.sin(a) * d; out.z = P.z + Math.cos(a) * d;
}

function currentWave() {
  let w = THEME.waves[0];
  for (let i = 0; i < THEME.waves.length; i++) if (THEME.waves[i].at <= G.time) w = THEME.waves[i];
  return w;
}

function pickType(wave) {
  let total = 0;
  for (const k in wave.types) total += wave.types[k];
  let r = Math.random() * total;
  for (const k in wave.types) { r -= wave.types[k]; if (r <= 0) return k; }
  return ENEMY_KEYS[0];
}

function updateSpawns(dt) {
  const wave = currentWave();
  G.spawnAcc = Math.min(G.spawnAcc + wave.rate * dt, 12);
  while (G.spawnAcc >= 1) {
    G.spawnAcc -= 1;
    if (active.length >= MAX_ENEMIES) { G.spawnAcc = 0; break; }
    spawnPointOut(_sp);
    spawnEnemy(pickType(wave), _sp.x, _sp.z, null);
  }
  // Elites
  if (G.time >= G.nextEliteAt && THEME.elites.every > 0) {
    G.nextEliteAt = (Math.floor(G.time / THEME.elites.every) + 1) * THEME.elites.every;
    if (active.length < MAX_ENEMIES + 4) {
      let key = pickType(wave);
      if (THEME.enemies[key].boss) key = ENEMY_KEYS.find((k) => !THEME.enemies[k].boss) || key;
      spawnPointOut(_sp);
      spawnEnemy(key, _sp.x, _sp.z, { elite: true, announce: true });
    }
  }
  // Bosses
  for (let i = 0; i < THEME.bosses.length; i++) {
    const b = THEME.bosses[i];
    if (!G.bossDone[i] && G.time >= b.at) {
      G.bossDone[i] = true;
      spawnPointOut(_sp);
      spawnEnemy(b.type, _sp.x, _sp.z, { hpMult: b.hpMult || 1, announce: true });
    }
  }
}

// ===========================================================================
//  4. Enemies
// ===========================================================================
const active = [];           // live enemies (including ones flagged dead until flushKills)
const dying = [];            // playing their death animation
const killQueue = [];
const pools = {};            // type key -> free shells
const heads = new Int32Array(GRID_N * GRID_N);
const nextI = new Int32Array(MAX_ENEMIES + 64);
const qBuf = new Array(MAX_ENEMIES + 64);
let qn = 0;

function buildPools() { for (const k of ENEMY_KEYS) pools[k] = []; }

function makeShell(key) {
  const def = THEME.enemies[key];
  const model = makeModel(def.model);
  const holder = new THREE.Group();
  holder.rotation.order = 'YXZ';
  holder.add(model.object);
  holder.visible = false;
  scene.add(holder);
  return {
    key, def, model, holder, name: def.name, uid: 0, idx: -1, dead: false, boss: !!def.boss, elite: false, tinted: false,
    x: 0, z: 0, kvx: 0, kvz: 0, face: 0, hp: 0, maxHp: 0, speed: 0, dmg: 0, radius: 0, scale: 1, h: 1.8, xp: 0,
    atk: def.attack || null, atkCd: 0, keep: def.keepDistance || 0, strafe: 1, moving: true,
    flashT: 0, flashing: false, orbitCd: 0, novaId: 0, chainStamp: 0, deathT: 0, tz: 0, color: '#ffffff',
  };
}

function takeShell(key) { return pools[key].pop() || makeShell(key); }

function releaseShell(e) {
  e.holder.visible = false;
  if (e.flashing) { e.model.setFlash(false); e.flashing = false; }
  if (e.tinted) { e.model.setTint(null); e.tinted = false; }
  e.model.setOpacity(1);
  e.holder.rotation.set(0, 0, 0);
  e.holder.position.set(0, 0, 0);
  pools[e.key].push(e);
}

function spawnEnemy(key, x, z, opts) {
  const def = THEME.enemies[key];
  if (!def) return null;
  const e = takeShell(key);
  const mins = G.time / 60;
  const elite = !!(opts && opts.elite) && !def.boss;
  const sc = elite ? THEME.elites.scaleMult : 1;
  e.uid = ++G.uid; e.dead = false; e.elite = elite; e.boss = !!def.boss;
  e.x = x; e.z = z; e.kvx = 0; e.kvz = 0;
  e.scale = sc;
  e.radius = def.radius * sc;
  e.h = e.model.height * sc;
  e.maxHp = e.hp = def.hp * (1 + THEME.scaling.hpPerMinute * mins) * (elite ? THEME.elites.hpMult : 1) * ((opts && opts.hpMult) || 1);
  e.speed = def.speed * (0.92 + Math.random() * 0.16);
  e.dmg = def.damage * (1 + THEME.scaling.damagePerMinute * mins);
  e.xp = def.xp * (elite ? THEME.elites.xpMult : 1);
  e.atk = def.attack || null;
  e.atkCd = e.atk ? e.atk.cooldown * (0.3 + Math.random() * 0.8) : 0;
  e.keep = def.keepDistance || 0;
  e.strafe = Math.random() < 0.5 ? 1 : -1;
  e.flashT = 0; e.orbitCd = 0; e.novaId = 0; e.chainStamp = 0; e.moving = true;
  e.face = Math.atan2(P.x - x, P.z - z);
  e.holder.scale.setScalar(sc);
  e.holder.rotation.set(0, e.face, 0);
  e.holder.position.set(x, 0, z);
  e.holder.visible = true;
  if (elite) { e.model.setTint(THEME.elites.tint); e.tinted = true; }
  e.idx = active.length;
  active.push(e);
  if (opts && opts.announce) {
    if (e.boss) {
      G.boss = e;
      ui.banner(STR.bossIncoming, 'boss'); play('bossAlert'); G.shake = Math.max(G.shake, 0.3);
    } else if (elite) {
      ui.banner(STR.eliteIncoming + ' · ' + def.name, 'elite');
    }
  }
  return e;
}

// ---- spatial hash: rebuilt once per step ----
function rebuildGrid() {
  heads.fill(-1);
  for (let i = 0; i < active.length; i++) {
    const e = active[i];
    const c = (Math.floor(e.x / CELL) & GRID_MASK) | ((Math.floor(e.z / CELL) & GRID_MASK) << GRID_BITS);
    nextI[i] = heads[c];
    heads[c] = i;
  }
}

/** Fills qBuf with enemies in cells touching the circle; returns the count. Includes dead ones — callers skip. */
function gridQuery(x, z, r) {
  qn = 0;
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
  const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      let idx = heads[(cx & GRID_MASK) | ((cz & GRID_MASK) << GRID_BITS)];
      while (idx !== -1 && qn < qBuf.length) { qBuf[qn++] = active[idx]; idx = nextI[idx]; }
    }
  }
  return qn;
}

function nearestEnemy(x, z, range) {
  let best = null, bd = range * range;
  for (let i = 0; i < active.length; i++) {
    const e = active[i];
    if (e.dead) continue;
    const dx = e.x - x, dz = e.z - z, d2 = dx * dx + dz * dz;
    if (d2 < bd) { bd = d2; best = e; }
  }
  return best;
}

function updateEnemies(dt) {
  const damp = Math.exp(-KB_DAMP * dt);
  const reloc = Math.max(42, viewRadius * 1.9);
  const reloc2 = reloc * reloc;
  const turn = Math.min(1, dt * 12);
  for (let i = 0; i < active.length; i++) {
    const e = active[i];
    if (e.dead) continue;
    if (e.flashT > 0) { e.flashT -= dt; if (e.flashT <= 0 && e.flashing) { e.flashing = false; e.model.setFlash(false); } }
    if (e.orbitCd > 0) e.orbitCd -= dt;

    let dx = P.x - e.x, dz = P.z - e.z;
    let d2 = dx * dx + dz * dz;
    if (d2 > reloc2) {
      spawnPointOut(_sp, P.vx * P.vx + P.vz * P.vz > 0.25 ? Math.atan2(P.vx, P.vz) : undefined);
      e.x = _sp.x; e.z = _sp.z; e.kvx = 0; e.kvz = 0;
      dx = P.x - e.x; dz = P.z - e.z; d2 = dx * dx + dz * dz;
    }
    const dist = Math.sqrt(d2) || 1e-4;
    const nx = dx / dist, nz = dz / dist;
    let mx = nx, mz = nz, sp = e.speed;
    if (e.keep > 0) {
      if (dist < e.keep * 0.72) { mx = -nx; mz = -nz; sp *= 0.7; }
      else if (dist < e.keep) { mx = -nz * e.strafe; mz = nx * e.strafe; sp *= 0.45; }
    }
    e.moving = sp > 0.2;
    e.x += (mx * sp + e.kvx) * dt;
    e.z += (mz * sp + e.kvz) * dt;
    e.kvx *= damp; e.kvz *= damp;

    // Never overlap the hero: slide back to the contact ring.
    const touch = e.radius + P.radius;
    dx = P.x - e.x; dz = P.z - e.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1e-4;
    if (d < touch) {
      e.x = P.x - (dx / d) * touch; e.z = P.z - (dz / d) * touch;
      hurtPlayer(e.dmg * dt, false);
    }
    e.face += angDelta(e.face, Math.atan2(nx, nz)) * turn;

    if (e.atk) {
      e.atkCd -= dt;
      // Only shoot from inside the visible frame, so the player never takes a bolt from an unseen shooter.
      // The cooldown stays ready while off-screen, so the shot comes as soon as the enemy steps into view.
      if (e.atkCd <= 0 && d < e.atk.range && d > 1.5 && onScreen(e.x, e.z)) {
        e.atkCd = e.atk.cooldown * (0.85 + Math.random() * 0.3);
        enemyFire(e, nx, nz);
      }
    }
  }
}

/** True if a ground point is inside the visible frame (with a small margin). Uses last frame's camera. */
function onScreen(x, z) {
  _v3.set(x, 0.8, z).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  return _v3.z < 1 && Math.abs(_v3.x) < 0.9 && Math.abs(_v3.y) < 0.95;
}

function separateEnemies() {
  for (let i = 0; i < active.length; i++) {
    const e = active[i];
    if (e.dead) continue;
    const n = gridQuery(e.x, e.z, e.radius + MAXR);
    for (let k = 0; k < n; k++) {
      const o = qBuf[k];
      if (o === e || o.dead) continue;
      let dx = e.x - o.x, dz = e.z - o.z;
      const rr = e.radius + o.radius;
      let d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      if (d2 < 1e-6) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; d2 = dx * dx + dz * dz; }
      const d = Math.sqrt(d2);
      const push = (rr - d) * (o.radius / rr) * 0.6;
      e.x += (dx / d) * push; e.z += (dz / d) * push;
    }
  }
}

function killEnemy(e, nx, nz) {
  if (e.dead) return;
  e.dead = true;
  e.kvx += nx * 2.5; e.kvz += nz * 2.5;
  killQueue.push(e);
}

function flushKills() {
  for (let q = 0; q < killQueue.length; q++) {
    const e = killQueue[q];
    // remove from active (swap-remove)
    const last = active.pop();
    if (last !== e) { active[e.idx] = last; last.idx = e.idx; }
    e.idx = -1;
    G.kills++;
    if (e === G.boss) G.boss = active.find((o) => o.boss && !o.dead && o !== e) || null;
    dropCrystal(e.x, e.z, e.xp);
    if (Math.random() < PICK.heal.dropChance) dropHeal(e.x, e.z);
    const big = e.boss || e.elite;
    particles.puff(e.x, 0.35, e.z, big ? 14 : 6, big ? 4.2 : 2.6, big ? 0.9 : 0.55, 0.6, THEME.world.groundColor);
    particles.sparks(e.x, e.h * 0.5, e.z, big ? 14 : 5, big ? 8 : 5, 0.16, 0.4, e.color);
    if (e.boss) {
      rings.spawn('ring', e.x, 0.1, e.z, 0.5, 7, 0.6, e.color, 0.8);
      G.shake = Math.max(G.shake, 0.4);
    }
    e.deathT = 0;
    e.tz = (Math.random() - 0.5) * 0.5;
    e.moving = false;
    dying.push(e);
    play('death');
  }
  killQueue.length = 0;
}

// ===========================================================================
//  5. Damage + feedback
// ===========================================================================
function hitEnemy(e, dmg, nx, nz, kb, hex, quiet) {
  if (e.dead) return;
  e.hp -= dmg;
  e.color = hex;
  e.flashT = FLASH_TIME;
  if (!e.flashing) { e.flashing = true; e.model.setFlash(true); }
  if (kb > 0) {
    const m = e.boss ? 0.12 : e.elite ? 0.5 : 1;
    e.kvx += nx * kb * KB_DAMP * m; e.kvz += nz * kb * KB_DAMP * m;
  }
  if (!quiet) ui.spawnDamage(e.x, e.h * 0.95, e.z, dmg, hex, dmg >= 40);
  particles.sparks(e.x, e.h * 0.55, e.z, 2, 4, 0.12, 0.25, hex);
  play('hit');
  if (e.hp <= 0) killEnemy(e, nx, nz);
}

function hurtPlayer(amount, strong) {
  if (G.god || G.phase !== 'playing') return;
  G.hp -= amount * (1 - stats.armor);
  G.hurtFlash = Math.max(G.hurtFlash, strong ? 0.9 : 0.5);
  // Contact damage ticks every step; only blink the hero every so often so he stays readable in melee.
  if (strong || P.flashCd <= 0) {
    P.flashCd = 0.35;
    P.flashT = FLASH_TIME;
    if (!P.flashing) { P.flashing = true; P.model.setFlash(true); }
  }
  if (P.hurtSnd <= 0) { play('hurt'); P.hurtSnd = 0.35; }
  if (strong) G.shake = Math.max(G.shake, 0.22);
  if (G.hp <= 0) { G.hp = 0; endRun('gameover'); }
}

// ===========================================================================
//  6. Weapons
// ===========================================================================
const bladeCache = {};       // weapon id -> THREE.Group[]
const novas = [];
const charges = [];
let bladeGeo, bladeMats;

function buildWeaponFx() {
  const cyl = (r) => new THREE.CylinderGeometry(r, r, 1, 10, 1, false).rotateX(Math.PI / 2);
  bladeGeo = { core: cyl(0.055), halo: cyl(0.15), halo2: cyl(0.3), hilt: new THREE.CylinderGeometry(0.07, 0.07, 0.34, 8).rotateX(Math.PI / 2) };
  bladeMats = { core: new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), hilt: new THREE.MeshLambertMaterial({ color: 0x555a60 }) };
  // Thrown-charge pool
  const body = new THREE.SphereGeometry(0.22, 12, 8);
  const halo = new THREE.SphereGeometry(0.42, 12, 8);
  const markerGeo = new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2);
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    const bm = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const hm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const b = new THREE.Mesh(body, bm), h = new THREE.Mesh(halo, hm);
    g.add(b, h); g.visible = false; scene.add(g);
    // Landing marker: a flat ring on the ground showing where and how big the blast will be.
    const mm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const marker = new THREE.Mesh(markerGeo, mm);
    marker.visible = false; marker.renderOrder = 2; marker.position.y = 0.07; scene.add(marker);
    charges.push({ active: false, group: g, bodyMat: bm, haloMat: hm, halo: h, marker, markerMat: mm, sx: 0, sz: 0, tx: 0, tz: 0, t: 0, T: 1, peak: 2, dmg: 0, radius: 3, hex: '#fff' });
  }
  for (let i = 0; i < 4; i++) novas.push({ active: false, x: 0, z: 0, t: 0, radius: 5, dmg: 1, kb: 5, id: 0, hex: '#fff' });
}

function ensureBlades(w) {
  if (bladeCache[w.id]) { w.blades = bladeCache[w.id]; return; }
  let maxCount = 1;
  for (const l of w.def.levels) maxCount = Math.max(maxCount, l.count || 1);
  // Normal (not additive) blending: additive colour washes out to white on bright sand.
  const haloMat = new THREE.MeshBasicMaterial({ color: w.def.color, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
  const halo2Mat = new THREE.MeshBasicMaterial({ color: w.def.color, transparent: true, opacity: 0.28, depthWrite: false, fog: false });
  const list = [];
  for (let i = 0; i < maxCount; i++) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(bladeGeo.core, bladeMats.core);
    const halo = new THREE.Mesh(bladeGeo.halo, haloMat);
    const halo2 = new THREE.Mesh(bladeGeo.halo2, halo2Mat);
    const hilt = new THREE.Mesh(bladeGeo.hilt, bladeMats.hilt);
    core.name = 'core'; halo.name = 'halo'; halo2.name = 'halo2'; hilt.name = 'hilt';
    halo.renderOrder = 5; halo2.renderOrder = 5; core.renderOrder = 6;
    g.add(core, halo, halo2, hilt);
    g.visible = false; g.rotation.order = 'YXZ';
    scene.add(g);
    list.push(g);
  }
  bladeCache[w.id] = list;
  w.blades = list;
}

function findWeapon(id) { for (let i = 0; i < weapons.length; i++) if (weapons[i].id === id) return weapons[i]; return null; }

function addWeapon(id, level) {
  const def = THEME.weapons[id];
  if (!def) return null;
  let w = findWeapon(id);
  if (!w) {
    w = { id, def, kind: def.kind, level: 1, st: def.levels[0], cd: 0.15, angle: Math.random() * TAU, blades: null, trailT: 0, rgb: rgbOf(def.color) };
    weapons.push(w);
    if (w.kind === 'orbit') ensureBlades(w);
  }
  w.level = clamp(level | 0, 1, def.levels.length);
  w.st = def.levels[w.level - 1];
  refreshLoadout();
  return w;
}

function clearWeapons() {
  for (const w of weapons) if (w.blades) for (const b of w.blades) b.visible = false;
  weapons.length = 0;
  for (const k in passives) delete passives[k];
  recomputeStats(false);
  refreshLoadout();
}

function updateWeapons(dt) {
  for (let i = 0; i < weapons.length; i++) {
    const w = weapons[i];
    switch (w.kind) {
      case 'bolt': weaponBolt(w, dt); break;
      case 'orbit': weaponOrbit(w, dt); break;
      case 'lob': weaponLob(w, dt); break;
      case 'nova': weaponNova(w, dt); break;
      case 'chain': weaponChain(w, dt); break;
      default: break;
    }
  }
  updateCharges(dt);
  updateNovas(dt);
}

const cooldownOf = (w) => w.st.cooldown * stats.cooldownMult;

// ---- bolt: auto-aimed blaster fan ----
function weaponBolt(w, dt) {
  w.cd -= dt;
  if (w.cd > 0) return;
  const st = w.st;
  const t = nearestEnemy(P.x, P.z, st.range);
  if (!t) { w.cd = 0; return; }
  const base = Math.atan2(t.x - P.x, t.z - P.z);
  const n = st.count, spread = 0.13;
  const dmg = st.damage * stats.damageMult;
  const life = st.range / st.speed + 0.12;
  for (let i = 0; i < n; i++) {
    const a = base + (i - (n - 1) / 2) * spread + (Math.random() - 0.5) * 0.03;
    const sx = Math.sin(a), sz = Math.cos(a);
    spawnBolt(true, P.x + sx * 0.6, P.z + sz * 0.6, HAND_Y, sx * st.speed, sz * st.speed, dmg, st.pierce, life, w.rgb, w.def.color);
  }
  particles.sparks(P.x + Math.sin(base) * 0.7, HAND_Y, P.z + Math.cos(base) * 0.7, 2, 3, 0.1, 0.18, w.def.color);
  play('blaster');
  w.cd = cooldownOf(w);
}

// ---- orbit: spinning laser swords ----
function bladeSegment(w, i, count, out) {
  const st = w.st;
  const a = w.angle + (i * TAU) / count;
  const s = Math.sin(a), c = Math.cos(a);
  const half = st.length * 0.5;
  out.cx = P.x + s * st.radius; out.cz = P.z + c * st.radius;
  out.dx = s; out.dz = c; out.a = a; out.half = half;
}
const _bs = { cx: 0, cz: 0, dx: 0, dz: 0, a: 0, half: 0 };

function weaponOrbit(w, dt) {
  const st = w.st;
  w.angle += st.spin * dt;
  const dmg = st.damage * stats.damageMult;
  const hitR = 0.3;
  let hitSound = false;
  for (let i = 0; i < st.count; i++) {
    bladeSegment(w, i, st.count, _bs);
    const ax = _bs.cx - _bs.dx * _bs.half, az = _bs.cz - _bs.dz * _bs.half;
    const sx = _bs.dx * _bs.half * 2, sz = _bs.dz * _bs.half * 2;
    const l2 = sx * sx + sz * sz;
    const n = gridQuery(_bs.cx, _bs.cz, _bs.half + MAXR + hitR);
    for (let k = 0; k < n; k++) {
      const e = qBuf[k];
      if (e.dead || e.orbitCd > 0) continue;
      const t = clamp(((e.x - ax) * sx + (e.z - az) * sz) / l2, 0, 1);
      const px = ax + sx * t - e.x, pz = az + sz * t - e.z;
      const rr = e.radius + hitR;
      if (px * px + pz * pz > rr * rr) continue;
      e.orbitCd = st.hitCooldown;
      const ox = e.x - P.x, oz = e.z - P.z, ol = Math.sqrt(ox * ox + oz * oz) || 1;
      hitEnemy(e, dmg, ox / ol, oz / ol, 0.9, w.def.color);
      hitSound = true;
    }
  }
  if (hitSound) play('saber');
  // trailing sparks off the blade tips
  w.trailT -= dt;
  if (w.trailT <= 0) {
    w.trailT = 0.05;
    for (let i = 0; i < st.count; i++) {
      bladeSegment(w, i, st.count, _bs);
      particles.sparks(_bs.cx + _bs.dx * _bs.half, 0.95, _bs.cz + _bs.dz * _bs.half, 1, 1.2, 0.1, 0.28, w.def.color);
    }
  }
}

// ---- lob: thrown thermal charges ----
const candBuf = new Array(MAX_ENEMIES + 64);
function weaponLob(w, dt) {
  w.cd -= dt;
  if (w.cd > 0) return;
  const st = w.st;
  let nc = 0;
  const r2 = st.range * st.range;
  for (let i = 0; i < active.length; i++) {
    const e = active[i];
    if (e.dead) continue;
    const dx = e.x - P.x, dz = e.z - P.z;
    if (dx * dx + dz * dz <= r2) candBuf[nc++] = e;
  }
  if (nc === 0) { w.cd = 0; return; }
  const dmg = st.damage * stats.damageMult;
  for (let k = 0; k < st.count; k++) {
    const pick = (Math.random() * nc) | 0;
    const e = candBuf[pick];
    // swap-remove so one throw does not land on the same enemy twice when avoidable
    if (nc > 1) { candBuf[pick] = candBuf[nc - 1]; nc--; }
    throwCharge(e.x + (Math.random() - 0.5) * 0.8, e.z + (Math.random() - 0.5) * 0.8, st, dmg, w.def.color);
  }
  play('enemyShot', { volume: 0.6, pitch: 0.55 });
  w.cd = cooldownOf(w);
}

function throwCharge(tx, tz, st, dmg, hex) {
  let c = null;
  for (const q of charges) if (!q.active) { c = q; break; }
  if (!c) return;
  c.active = true; c.t = 0; c.T = Math.max(0.2, st.fuse);
  c.sx = P.x; c.sz = P.z; c.tx = tx; c.tz = tz;
  const d = Math.hypot(tx - P.x, tz - P.z);
  c.peak = 1.8 + d * 0.16;
  c.dmg = dmg; c.radius = st.blastRadius; c.hex = hex;
  c.bodyMat.color.set(mixHex(hex, '#2a2a2a', 0.65));
  c.haloMat.color.set(hex);
  c.markerMat.color.set(hex);
  c.marker.position.set(tx, 0.07, tz);
  c.marker.scale.set(c.radius, 1, c.radius);
  c.marker.visible = true;
  c.group.visible = true;
  c.group.position.set(P.x, HAND_Y, P.z);
}

function updateCharges(dt) {
  for (const c of charges) {
    if (!c.active) continue;
    c.t += dt;
    if (c.t >= c.T) {
      c.active = false; c.group.visible = false; c.marker.visible = false;
      explode(c.tx, c.tz, c.dmg, c.radius, c.hex);
    }
  }
}

function explode(x, z, dmg, radius, hex) {
  const n = gridQuery(x, z, radius + MAXR);
  for (let k = 0; k < n; k++) {
    const e = qBuf[k];
    if (e.dead) continue;
    const dx = e.x - x, dz = e.z - z, d = Math.sqrt(dx * dx + dz * dz);
    if (d > radius + e.radius * 0.5) continue;
    const inv = 1 / (d || 1);
    hitEnemy(e, dmg, dx * inv, dz * inv, BLAST_KB * (1 - 0.6 * Math.min(1, d / radius)), hex);
  }
  rings.spawn('sphere', x, 0.9, z, 0.4, radius * 0.8, 0.26, hex, 0.9);
  rings.spawn('sphere', x, 0.7, z, 0.2, radius * 0.5, 0.18, '#ffffff', 0.85);
  rings.spawn('ring', x, 0.08, z, radius * 0.3, radius * 1.05, 0.38, hex, 0.9);
  rings.spawn('disc', x, 0.06, z, radius * 0.4, radius, 0.5, hex, 0.35);
  particles.sparks(x, 0.8, z, 26, 10, 0.2, 0.55, hex);
  particles.puff(x, 0.4, z, 14, 4.5, 0.95, 0.8, THEME.world.groundColor);
  G.shake = Math.max(G.shake, 0.28);
  play('explosion');
}

// ---- nova: expanding force ring ----
function weaponNova(w, dt) {
  w.cd -= dt;
  if (w.cd > 0) return;
  const st = w.st;
  if (!nearestEnemy(P.x, P.z, st.radius * 1.1)) { w.cd = 0; return; }
  let nv = null;
  for (const q of novas) if (!q.active) { nv = q; break; }
  if (!nv) { w.cd = 0.2; return; }
  nv.active = true; nv.x = P.x; nv.z = P.z; nv.t = 0; nv.radius = st.radius;
  nv.dmg = st.damage * stats.damageMult; nv.kb = st.knockback; nv.id = ++G.novaId; nv.hex = w.def.color;
  rings.spawn('ring', P.x, 0.1, P.z, 0.6, st.radius, NOVA_DUR + 0.12, w.def.color, 0.95);
  rings.spawn('ring', P.x, 0.12, P.z, 0.3, st.radius * 0.75, NOVA_DUR, '#ffffff', 0.7);
  rings.spawn('disc', P.x, 0.05, P.z, 0.6, st.radius, NOVA_DUR + 0.2, w.def.color, 0.28);
  particles.dustRing(P.x, P.z, st.radius, 16, THEME.world.groundColor);
  G.shake = Math.max(G.shake, 0.14);
  play('push');
  w.cd = cooldownOf(w);
}

function updateNovas(dt) {
  for (const nv of novas) {
    if (!nv.active) continue;
    nv.t += dt;
    const u = Math.min(1, nv.t / NOVA_DUR);
    const front = nv.radius * (1 - (1 - u) * (1 - u));
    const n = gridQuery(nv.x, nv.z, front + MAXR);
    for (let k = 0; k < n; k++) {
      const e = qBuf[k];
      if (e.dead || e.novaId === nv.id) continue;
      const dx = e.x - nv.x, dz = e.z - nv.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d - e.radius * 0.5 > front) continue;
      e.novaId = nv.id;
      const inv = 1 / (d || 1);
      hitEnemy(e, nv.dmg, dx * inv, dz * inv, nv.kb, nv.hex, true);   // no floating numbers for crowd pushes: dozens of identical labels hide the crowd
    }
    if (nv.t >= NOVA_DUR + 0.05) nv.active = false;
  }
}

// ---- chain: force lightning ----
const chainPts = new Float32Array(48);
const forkStart = [null, null, null, null];
const forkDist = [0, 0, 0, 0];
function weaponChain(w, dt) {
  w.cd -= dt;
  if (w.cd > 0) return;
  const st = w.st;
  const forks = Math.min(st.forks || 1, forkStart.length);
  // pick the `forks` nearest distinct enemies in range as starting targets
  let nf = 0;
  const r2 = st.range * st.range;
  forkStart.fill(null);
  const fd = forkDist;
  fd.fill(Infinity);
  for (let i = 0; i < active.length; i++) {
    const e = active[i];
    if (e.dead) continue;
    const dx = e.x - P.x, dz = e.z - P.z, d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    for (let s = 0; s < forks; s++) {
      if (d2 < fd[s]) {
        for (let m = forks - 1; m > s; m--) { fd[m] = fd[m - 1]; forkStart[m] = forkStart[m - 1]; }
        fd[s] = d2; forkStart[s] = e;
        break;
      }
    }
  }
  for (let s = 0; s < forks; s++) if (forkStart[s]) nf++;
  if (nf === 0) { w.cd = 0; return; }

  const stamp = ++G.castId;
  const dmg = st.damage * stats.damageMult;
  // Reserve every fork's starting enemy first, so one fork's chain cannot hop onto (and so cancel) another fork.
  for (let s = 0; s < forks; s++) if (forkStart[s]) forkStart[s].chainStamp = stamp;
  for (let s = 0; s < forks; s++) {
    let cur = forkStart[s];
    if (!cur) continue;
    let np = 0;
    chainPts[np++] = P.x; chainPts[np++] = HAND_Y; chainPts[np++] = P.z;
    let px = P.x, pz = P.z;
    for (let hop = 0; hop < st.chains && cur; hop++) {
      cur.chainStamp = stamp;
      chainPts[np++] = cur.x; chainPts[np++] = cur.h * 0.6; chainPts[np++] = cur.z;
      const dx = cur.x - px, dz = cur.z - pz, l = Math.sqrt(dx * dx + dz * dz) || 1;
      hitEnemy(cur, dmg, dx / l, dz / l, 0.5, w.def.color);
      px = cur.x; pz = cur.z;
      if (np >= chainPts.length - 3) break;
      // next: nearest unmarked live enemy within chainRange
      const n = gridQuery(cur.x, cur.z, st.chainRange);
      let best = null, bd = st.chainRange * st.chainRange;
      for (let k = 0; k < n; k++) {
        const o = qBuf[k];
        if (o.dead || o.chainStamp === stamp) continue;
        const ox = o.x - px, oz = o.z - pz, od = ox * ox + oz * oz;
        if (od < bd) { bd = od; best = o; }
      }
      cur = best;
    }
    lightningViz.cast(w.def.color, 0.24, chainPts, np / 3);
  }
  play('lightning');
  w.cd = cooldownOf(w);
}

// ===========================================================================
//  7. Bolts, crystals, heal pickups
// ===========================================================================
const bolts = [];
for (let i = 0; i < BOLT_CAP; i++) {
  bolts.push({ active: false, friendly: true, x: 0, z: 0, y: 1, vx: 0, vz: 0, dmg: 0, pierce: 0, life: 0, rgb: null, hex: '#fff', h0: -1, h1: -1, h2: -1, h3: -1, yaw: 0 });
}

function spawnBolt(friendly, x, z, y, vx, vz, dmg, pierce, life, rgb, hex) {
  let b = null;
  for (let i = 0; i < BOLT_CAP; i++) if (!bolts[i].active) { b = bolts[i]; break; }
  if (!b) return;
  b.active = true; b.friendly = friendly; b.x = x; b.z = z; b.y = y; b.vx = vx; b.vz = vz;
  b.dmg = dmg; b.pierce = pierce; b.life = life; b.rgb = rgb; b.hex = hex;
  b.h0 = b.h1 = b.h2 = b.h3 = -1; b.yaw = Math.atan2(vx, vz);
}

function enemyFire(e, nx, nz) {
  const a = e.atk;
  const dmg = a.damage * (1 + THEME.scaling.damagePerMinute * (G.time / 60));
  spawnBolt(false, e.x + nx * 0.6, e.z + nz * 0.6, e.h * 0.62, nx * a.speed, nz * a.speed, dmg, 0, (a.range + 8) / a.speed, rgbOf(a.color), a.color);
  particles.sparks(e.x + nx * 0.7, e.h * 0.62, e.z + nz * 0.7, 2, 2.5, 0.1, 0.16, a.color);
  play('enemyShot');
}

function updateBolts(dt) {
  for (let i = 0; i < BOLT_CAP; i++) {
    const b = bolts[i];
    if (!b.active) continue;
    const ox = b.x, oz = b.z;
    b.x += b.vx * dt; b.z += b.vz * dt;
    b.life -= dt;
    if (b.life <= 0) { b.active = false; continue; }
    if (b.friendly) {
      const sx = b.x - ox, sz = b.z - oz, l2 = sx * sx + sz * sz || 1e-6;
      const n = gridQuery((ox + b.x) * 0.5, (oz + b.z) * 0.5, Math.sqrt(l2) * 0.5 + MAXR);
      for (let k = 0; k < n; k++) {
        const e = qBuf[k];
        if (e.dead || e.uid === b.h0 || e.uid === b.h1 || e.uid === b.h2 || e.uid === b.h3) continue;
        const t = clamp(((e.x - ox) * sx + (e.z - oz) * sz) / l2, 0, 1);
        const px = ox + sx * t - e.x, pz = oz + sz * t - e.z;
        const rr = e.radius * 0.9 + 0.2;
        if (px * px + pz * pz > rr * rr) continue;
        const sp = Math.sqrt(b.vx * b.vx + b.vz * b.vz) || 1;
        hitEnemy(e, b.dmg, b.vx / sp, b.vz / sp, 0.35, b.hex);
        if (b.pierce > 0) {
          b.pierce--;
          if (b.h0 < 0) b.h0 = e.uid; else if (b.h1 < 0) b.h1 = e.uid; else if (b.h2 < 0) b.h2 = e.uid; else b.h3 = e.uid;
        } else { b.active = false; break; }
      }
    } else {
      const sx = b.x - ox, sz = b.z - oz, l2 = sx * sx + sz * sz || 1e-6;
      const t = clamp(((P.x - ox) * sx + (P.z - oz) * sz) / l2, 0, 1);
      const px = ox + sx * t - P.x, pz = oz + sz * t - P.z;
      const rr = P.radius + 0.22;
      if (px * px + pz * pz < rr * rr) {
        b.active = false;
        particles.sparks(b.x, b.y, b.z, 5, 4, 0.12, 0.25, b.hex);
        hurtPlayer(b.dmg, true);
      }
    }
  }
}

// ---- XP crystals (instanced) ----
const crystals = [];
let crystalCount = 0;
let crystalSmall = null, crystalBig = null, crystalBase = { small: 0.3, big: 0.5 };

function extractMesh(key) {
  const mi = makeModel(key);
  mi.object.updateMatrixWorld(true);
  let found = null, meshCount = 0;
  mi.object.traverse((o) => { if (o.isMesh) { meshCount++; if (!found && !o.isSkinnedMesh) found = o; } });
  if (meshCount > 1) console.warn(`[pickups] "${key}" has ${meshCount} meshes; pickups are instanced, so only the first one is used. Merge the model into a single mesh.`);
  if (!found) { console.warn(`[pickups] "${key}" has no plain (non-skinned) mesh; using a plain gem instead.`); mi.dispose && mi.dispose(); return null; }
  const geo = found.geometry.clone();
  geo.applyMatrix4(found.matrixWorld);
  const mat = Array.isArray(found.material) ? found.material[0] : found.material;
  mi.dispose && mi.dispose();
  return { geo, mat };
}

function buildCrystalViz() {
  const cap = PICK.xp.mergeAbove + 60;
  const make = (key, fallbackHex) => {
    let r = null;
    try { r = extractMesh(key); } catch (e) { r = null; }
    if (!r) {
      const col = THEME.models[key] && THEME.models[key].colors && Object.values(THEME.models[key].colors)[0];
      r = { geo: new THREE.OctahedronGeometry(0.22, 0), mat: new THREE.MeshBasicMaterial({ color: col || fallbackHex }) };
    }
    const m = makeInstanced(r.geo, r.mat, cap, false);
    m.renderOrder = 2;
    scene.add(m);
    fxMeshes.push(m);
    return m;
  };
  crystalSmall = make(PICK.xp.model, '#ffffff');
  crystalBig = make(PICK.xp.bigModel, '#ffffff');
  for (let i = 0; i < cap; i++) crystals.push({ active: false, x: 0, z: 0, value: 1, big: false, mag: false, spd: 0, phase: 0, age: 0 });
}

function dropCrystal(x, z, value) {
  let c = null;
  if (crystalCount < PICK.xp.mergeAbove) {
    for (let i = 0; i < crystals.length; i++) if (!crystals[i].active) { c = crystals[i]; break; }
  }
  if (!c) {
    // Too many on the ground: fold the value into the nearest one instead.
    let bd = Infinity;
    for (let i = 0; i < crystals.length; i++) {
      const o = crystals[i];
      if (!o.active) continue;
      const dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; c = o; }
    }
    if (c) { c.value += value; c.big = c.value >= PICK.xp.bigThreshold; return; }
    return;
  }
  c.active = true; c.x = x + (Math.random() - 0.5) * 0.6; c.z = z + (Math.random() - 0.5) * 0.6;
  c.value = value; c.big = value >= PICK.xp.bigThreshold; c.mag = false; c.spd = 0;
  c.phase = Math.random() * TAU; c.age = 0;
  crystalCount++;
}

function updateCrystals(dt) {
  const R = THEME.player.pickupRadius * stats.pickupMult;
  const R2 = R * R;
  for (let i = 0; i < crystals.length; i++) {
    const c = crystals[i];
    if (!c.active) continue;
    c.age += dt;
    const dx = P.x - c.x, dz = P.z - c.z, d2 = dx * dx + dz * dz;
    if (!c.mag && d2 < R2) c.mag = true;
    if (c.mag) {
      c.spd = Math.min(c.spd + 70 * dt, 30);
      const d = Math.sqrt(d2) || 1e-4;
      const step = Math.min(d, (c.spd + 4) * dt);
      c.x += (dx / d) * step; c.z += (dz / d) * step;
      if (d < 0.6) {
        c.active = false; crystalCount--;
        addXP(c.value);
        play('pickup');
      }
    }
  }
}

// ---- heal pickups (few, individual models) ----
const heals = [];
function buildHealPickups() {
  for (let i = 0; i < 8; i++) {
    const model = makeModel(PICK.heal.model);
    const holder = new THREE.Group();
    holder.add(model.object);
    holder.visible = false;
    scene.add(holder);
    heals.push({ active: false, x: 0, z: 0, holder, model, age: 0 });
  }
}
function dropHeal(x, z) {
  for (const h of heals) {
    if (h.active) continue;
    h.active = true; h.x = x; h.z = z; h.age = 0; h.holder.visible = true;
    h.holder.position.set(x, 0, z);
    return;
  }
}
function updateHeals(dt) {
  const R = THEME.player.pickupRadius * stats.pickupMult;
  for (const h of heals) {
    if (!h.active) continue;
    h.age += dt;
    const dx = P.x - h.x, dz = P.z - h.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d < R * 0.7) {
      const step = Math.min(d, 12 * dt);
      h.x += (dx / (d || 1)) * step; h.z += (dz / (d || 1)) * step;
    }
    if (d < 0.8) {
      h.active = false; h.holder.visible = false;
      const gain = Math.min(PICK.heal.amount, G.maxHp - G.hp);
      G.hp = Math.min(G.maxHp, G.hp + PICK.heal.amount);
      ui.spawnDamage(P.x, P.h * 1.05, P.z, Math.max(1, gain), healHex(), false);
      play('pickup', { pitch: 0.8 });
    }
  }
}

// ===========================================================================
//  8. XP, level-up cards, passives
// ===========================================================================
function addXP(n) {
  G.xp += n;
  while (G.xp >= G.xpNext) {
    G.xp -= G.xpNext;
    G.level++;
    G.xpNext = THEME.xpToNext(G.level);
    G.pendingLevels++;
  }
  if (G.pendingLevels > 0 && G.phase === 'playing') enterLevelUp();
}

function recomputeStats(healDelta) {
  const prevMax = stats.maxHp;
  stats.damageMult = 1; stats.cooldownMult = 1; stats.speedMult = 1; stats.pickupMult = 1;
  stats.maxHp = THEME.player.maxHp; stats.regen = 0; stats.armor = 0;
  for (const id in passives) {
    const def = THEME.passives[id], lv = passives[id];
    if (!def || !lv) continue;
    for (const k in def.per) stats[k] = (stats[k] || 0) + def.per[k] * lv;
  }
  stats.cooldownMult = Math.max(0.25, stats.cooldownMult);
  stats.armor = clamp(stats.armor, 0, 0.85);
  G.maxHp = stats.maxHp;
  if (healDelta && G.maxHp > prevMax) G.hp += G.maxHp - prevMax;
  G.hp = Math.min(G.hp, G.maxHp);
}

function refreshLoadout() {
  const list = [];
  for (const w of weapons) list.push({ kind: 'weapon', id: w.id, name: w.def.name, glyph: w.def.glyph, icon: w.def.icon, color: w.def.color, level: w.level, max: w.def.levels.length });
  for (const id in passives) {
    const d = THEME.passives[id];
    if (d && passives[id] > 0) list.push({ kind: 'passive', id, name: d.name, glyph: d.glyph, icon: d.icon, color: d.color, level: passives[id], max: d.max });
  }
  loadoutList = list;
  loadoutSig = list.map((c) => c.id + ':' + c.level).join('|');
}

function buildChoices() {
  const cand = [];
  const ownedPassives = Object.keys(passives).filter((k) => passives[k] > 0).length;
  for (const id of Object.keys(THEME.weapons)) {
    const def = THEME.weapons[id], w = findWeapon(id);
    if (w) { if (w.level < def.levels.length) cand.push({ kind: 'weapon', id, isNew: false, wt: 1 }); }
    else if (weapons.length < THEME.player.maxWeapons) cand.push({ kind: 'weapon', id, isNew: true, wt: 1.7 });
  }
  for (const id of Object.keys(THEME.passives)) {
    const def = THEME.passives[id], lv = passives[id] || 0;
    if (lv > 0) { if (lv < def.max) cand.push({ kind: 'passive', id, isNew: false, wt: 1 }); }
    else if (ownedPassives < THEME.player.maxPassives) cand.push({ kind: 'passive', id, isNew: true, wt: 1.3 });
  }
  const picks = [];
  while (picks.length < 3 && cand.length) {
    let total = 0;
    for (const c of cand) total += c.wt;
    let r = Math.random() * total, idx = 0;
    for (let i = 0; i < cand.length; i++) { r -= cand[i].wt; if (r <= 0) { idx = i; break; } }
    picks.push(cand.splice(idx, 1)[0]);
  }
  if (picks.length < 3) picks.push({ kind: 'heal', id: 'heal', isNew: false });
  return picks;
}

function cardData(c) {
  if (c.kind === 'weapon') {
    const def = THEME.weapons[c.id], w = findWeapon(c.id), next = w ? w.level + 1 : 1;
    return { kind: c.kind, id: c.id, label: def.name, color: def.color, glyph: def.glyph, icon: def.icon, isNew: c.isNew,
      tag: c.isNew ? STR.statLevel + ' 1' : STR.statLevel + ' ' + (next - 1) + ' → ' + next, desc: def.levels[next - 1].desc };
  }
  if (c.kind === 'passive') {
    const def = THEME.passives[c.id], lv = passives[c.id] || 0;
    return { kind: c.kind, id: c.id, label: def.name, color: def.color, glyph: def.glyph, icon: def.icon, isNew: c.isNew,
      tag: c.isNew ? STR.statLevel + ' 1' : STR.statLevel + ' ' + lv + ' → ' + (lv + 1), desc: def.desc };
  }
  return { kind: 'heal', id: 'heal', label: STR.healOption, color: healHex(), glyph: PICK.heal.glyph || '+', icon: null, isNew: false, tag: '', desc: STR.healOptionDesc };
}

function enterLevelUp() {
  const picks = buildChoices();
  G.choices = picks.map((c) => ({ kind: c.kind, id: c.id, label: cardData(c).label }));
  G.cards = picks.map(cardData);
  G.pickList = picks;
  setPhase('levelup');
  ui.showLevelUp(G.cards);
  play('levelup');
}

function chooseCard(i) {
  if (G.phase !== 'levelup') return false;
  const c = G.pickList && G.pickList[i];
  if (!c) return false;
  if (c.kind === 'weapon') {
    const w = findWeapon(c.id);
    addWeapon(c.id, w ? w.level + 1 : 1);
  } else if (c.kind === 'passive') {
    passives[c.id] = Math.min(THEME.passives[c.id].max, (passives[c.id] || 0) + 1);
    recomputeStats(true);
    refreshLoadout();
  } else {
    G.hp = Math.min(G.maxHp, G.hp + PICK.heal.amount);
  }
  play('uiClick');
  G.pendingLevels = Math.max(0, G.pendingLevels - 1);
  if (G.pendingLevels > 0) {
    enterLevelUp();
  } else {
    ui.hideLevelUp();
    setPhase('playing');
  }
  return true;
}

// ===========================================================================
//  9. Player + phases
// ===========================================================================
function buildPlayer() {
  P.model = makeModel(THEME.player.model);
  P.holder = new THREE.Group();
  P.holder.rotation.order = 'YXZ';
  P.holder.add(P.model.object);
  scene.add(P.holder);
  P.h = P.model.height || 1.8;
}

function updatePlayer(dt) {
  input.getMove(_mv);
  const maxSp = THEME.player.speed * stats.speedMult;
  const tvx = _mv.x * maxSp, tvz = _mv.z * maxSp;
  // snappy acceleration: reach top speed in ~0.1 s, stop in ~0.07 s
  const acc = 90 * dt;
  let ax = tvx - P.vx, az = tvz - P.vz;
  const al = Math.sqrt(ax * ax + az * az);
  if (al > acc) { ax *= acc / al; az *= acc / al; }
  P.vx += ax; P.vz += az;
  P.x += P.vx * dt; P.z += P.vz * dt;
  const sp = Math.sqrt(P.vx * P.vx + P.vz * P.vz);
  let want = null;
  if (sp > 0.6) want = Math.atan2(P.vx, P.vz);
  else { const t = nearestEnemy(P.x, P.z, 14); if (t) want = Math.atan2(t.x - P.x, t.z - P.z); }
  if (want !== null) P.face += angDelta(P.face, want) * Math.min(1, dt * 14);
  P.moving = sp > 0.5; P.speed = sp;

  if (P.flashT > 0) { P.flashT -= dt; if (P.flashT <= 0 && P.flashing) { P.flashing = false; P.model.setFlash(false); } }
  if (P.hurtSnd > 0) P.hurtSnd -= dt;
  if (P.flashCd > 0) P.flashCd -= dt;
  if (stats.regen > 0 && G.hp < G.maxHp) G.hp = Math.min(G.maxHp, G.hp + stats.regen * dt);
}

function setPhase(p) {
  G.phase = p;
  if (input) input.reset();
  ui.setOverlay('title', p === 'title');
  ui.setOverlay('levelup', p === 'levelup');
  ui.setOverlay('pause', p === 'paused');
  if (p !== 'gameover' && p !== 'victory') ui.hideEnd();
  ui.showHUD(p !== 'title');
  if (p === 'title') ui.focusPrimary('title');
  if (p === 'paused') ui.focusPrimary('pause');
}

function resetRun() {
  // everything back to the pools
  for (const e of active) releaseShell(e);
  active.length = 0;
  for (const e of dying) releaseShell(e);
  dying.length = 0;
  killQueue.length = 0;
  for (const b of bolts) b.active = false;
  for (const c of crystals) c.active = false;
  crystalCount = 0;
  for (const h of heals) { h.active = false; h.holder.visible = false; }
  for (const c of charges) { c.active = false; c.group.visible = false; c.marker.visible = false; }
  for (const n of novas) n.active = false;
  particles.clear(); lightningViz.clear(); rings.clear(); ui.clearDamage(); ui.setBoss(null);

  clearWeapons();
  Object.assign(G, {
    time: 0, level: 1, xp: 0, xpNext: THEME.xpToNext(1), kills: 0, pendingLevels: 0, choices: [], cards: [], pickList: null,
    nextEliteAt: THEME.elites.every, bossDone: THEME.bosses.map(() => false), spawnAcc: 0, endDelay: 0, hurtFlash: 0, shake: 0, boss: null,
  });
  recomputeStats(false);
  G.hp = G.maxHp;
  P.x = 0; P.z = 0; P.vx = 0; P.vz = 0; P.face = 0; P.flashT = 0; P.flashCd = 0; P.deathT = 0; P.hurtSnd = 0;
  if (P.flashing) { P.flashing = false; P.model.setFlash(false); }
  P.holder.rotation.set(0, 0, 0);
  camT.x = 0; camT.z = 0;
  accum = 0;
  addWeapon(THEME.player.startWeapon, 1);
}

function startRun() {
  try {
    const r = initAudio(THEME);
    if (r && r.catch) r.catch(() => {});
    startMusic();
  } catch (e) { /* audio is optional */ }
  ui.setMuted(isMuted());
  resetRun();
  camT.z = -TITLE_SHIFT;           // glide in from the title framing
  setPhase('playing');
  play('uiClick');
}

function restartRun() {
  try { startMusic(); } catch (e) { /* ignore */ }
  resetRun();
  setPhase('playing');
}

function togglePause() {
  if (G.phase === 'playing') { setPhase('paused'); }
  else if (G.phase === 'paused') { setPhase('playing'); }
}

function toggleMute() {
  setMuted(!isMuted());
  ui.setMuted(isMuted());
}

function endRun(kind) {
  if (G.phase === 'gameover' || G.phase === 'victory') return;
  setPhase(kind);
  if (P.flashing) { P.flashing = false; P.model.setFlash(false); }   // updatePlayer no longer runs, so clear the hit flash here
  G.endDelay = kind === 'gameover' ? 1.0 : 0.6;
  try { stopMusic(); } catch (e) { /* ignore */ }
  play(kind === 'victory' ? 'victory' : 'gameover');
  if (kind === 'gameover') {
    particles.puff(P.x, 0.5, P.z, 12, 3.5, 0.8, 0.7, THEME.world.groundColor);
    particles.sparks(P.x, 1, P.z, 18, 7, 0.16, 0.5, THEME.weapons[THEME.player.startWeapon].color);
  }
}

// ===========================================================================
//  10. Sim step, visual sync, loop
// ===========================================================================
function simStep(dt) {
  G.time += dt;
  G.hurtFlash = Math.max(0, G.hurtFlash - dt * 1.9);
  G.shake *= Math.exp(-9 * dt);

  updatePlayer(dt);
  updateSpawns(dt);
  updateEnemies(dt);
  rebuildGrid();
  separateEnemies();
  updateWeapons(dt);
  updateBolts(dt);
  updateCrystals(dt);
  updateHeals(dt);
  flushKills();
  fxStep(dt);

  if (G.pendingLevels > 0 && G.phase === 'playing') enterLevelUp();
  if (G.boss) ui.setBoss(G.boss.name, G.boss.hp / G.boss.maxHp); else ui.setBoss(null);
  if (G.phase === 'playing' && G.time >= THEME.winTime) endRun('victory');
}

/** Purely visual simulation: death animations, particles, rings, lightning. Runs even after the run ends. */
function fxStep(dt) {
  const damp = Math.exp(-KB_DAMP * dt);
  for (let i = dying.length - 1; i >= 0; i--) {
    const e = dying[i];
    e.deathT += dt;
    if (e.flashing) { e.flashT -= dt; if (e.flashT <= 0) { e.flashing = false; e.model.setFlash(false); } }
    const u = e.deathT / DEATH_DUR;
    if (u >= 1) {
      releaseShell(e);
      dying[i] = dying[dying.length - 1]; dying.pop();
      continue;
    }
    const topple = 1 - (1 - Math.min(1, u / 0.5)) * (1 - Math.min(1, u / 0.5));
    e.x += e.kvx * dt; e.z += e.kvz * dt; e.kvx *= damp; e.kvz *= damp;
    e.holder.position.set(e.x, -0.16 * topple, e.z);
    e.holder.rotation.set(-topple * 1.48, e.face, e.tz);
    if (u > 0.5) e.model.setOpacity(1 - (u - 0.5) / 0.5);
  }
  particles.update(dt);
  rings.update(dt);
  lightningViz.update(dt);
}

function syncVisuals(dt, animate) {
  // simStep decays these only while playing; keep them decaying (real dt) on pause / level-up / end screens.
  if (G.phase !== 'playing') {
    G.shake *= Math.exp(-9 * dt);
    G.hurtFlash = Math.max(0, G.hurtFlash - dt * 1.9);
  }
  // ---- camera
  const k = 1 - Math.exp(-9 * dt);
  const titleShift = G.phase === 'title' ? -TITLE_SHIFT : 0;   // hero sits below the title block
  camT.x += (P.x + P.vx * 0.12 - camT.x) * k;
  camT.z += (P.z + P.vz * 0.12 + titleShift - camT.z) * k;
  let sx = 0, sy = 0, sz = 0;
  if (G.shake > 0.004 && !reduceMotion) { sx = (Math.random() - 0.5) * G.shake; sy = (Math.random() - 0.5) * G.shake * 0.6; sz = (Math.random() - 0.5) * G.shake; }
  camera.position.set(camT.x + sx, camH + sy, camT.z + camBack + sz);
  camera.updateMatrixWorld(true);

  world.update(P.x, P.z);

  // ---- hero
  const hd = animate ? dt : 0;
  if (G.phase === 'gameover') {
    P.deathT += dt;
    const u = Math.min(1, P.deathT / 0.5);
    P.holder.rotation.set(-u * 1.45, P.face, 0);
    P.holder.position.set(P.x, -0.12 * u, P.z);
  } else {
    P.holder.position.set(P.x, 0, P.z);
    P.holder.rotation.y = P.face;
  }
  if (animate) P.model.update(hd, !!P.moving, P.speed || 0);

  // ---- shadows
  world.shadowBegin();
  world.shadowAdd(P.x, P.z, 0.85);
  for (let i = 0; i < active.length; i++) { const e = active[i]; world.shadowAdd(e.x, e.z, e.radius * 1.5); }
  for (let i = 0; i < dying.length; i++) { const e = dying[i]; world.shadowAdd(e.x, e.z, e.radius * 1.5 * (1 - e.deathT / DEATH_DUR)); }
  // (shadowEnd is called after the thrown charges add theirs, below)

  // ---- enemies
  for (let i = 0; i < active.length; i++) {
    const e = active[i], h = e.holder;
    h.position.set(e.x, 0, e.z);
    h.rotation.y = e.face;
    if (animate) e.model.update(dt, e.moving, e.speed);
  }

  // ---- bolts
  boltViz.begin();
  for (let i = 0; i < BOLT_CAP; i++) {
    const b = bolts[i];
    if (!b.active) continue;
    boltViz.add(b.x, b.y, b.z, b.yaw, b.friendly ? 1.45 : 1.15, b.rgb.r, b.rgb.g, b.rgb.b);
  }
  boltViz.end();

  // ---- crystals
  let ns = 0, nb = 0;
  const t = G.time;
  for (let i = 0; i < crystals.length; i++) {
    const c = crystals[i];
    if (!c.active) continue;
    const pop = Math.min(1, c.age * 5);
    const s = CRYSTAL_SCALE * (c.big ? 1.15 : 1) * (0.4 + 0.6 * pop) * (c.mag ? 0.85 : 1);
    const y = 0.45 + Math.sin(t * 3.2 + c.phase) * 0.08 + (1 - pop) * 0.5;
    if (c.big) setYawMatrix(crystalBig, nb++, c.x, y, c.z, t * 1.8 + c.phase, s, s, s);
    else setYawMatrix(crystalSmall, ns++, c.x, y, c.z, t * 1.8 + c.phase, s, s, s);
  }
  flushInstanced(crystalSmall, ns);
  flushInstanced(crystalBig, nb);

  // ---- heal pickups
  for (const h of heals) {
    if (!h.active) continue;
    h.holder.position.set(h.x, 0.25 + Math.sin(G.time * 3 + h.age) * 0.08, h.z);
    h.holder.rotation.y = G.time * 1.6;
  }

  // ---- orbit blades
  for (const w of weapons) {
    if (w.kind !== 'orbit' || !w.blades) continue;
    for (let i = 0; i < w.blades.length; i++) {
      const g = w.blades[i];
      if (i >= w.st.count) { g.visible = false; continue; }
      bladeSegment(w, i, w.st.count, _bs);
      g.visible = true;
      g.position.set(_bs.cx, 0.95, _bs.cz);
      g.rotation.y = _bs.a;
      const len = w.st.length;
      const flick = 0.92 + 0.08 * Math.sin(G.time * 40 + i * 2);
      for (const m of g.children) {
        if (m.name === 'hilt') { m.position.z = -len * 0.5 - 0.12; }
        else { m.scale.z = len; m.scale.x = m.scale.y = m.name === 'core' ? 1 : flick; }
      }
    }
  }

  // ---- thrown charges
  for (const c of charges) {
    if (!c.active) continue;
    const u = Math.min(1, c.t / c.T);
    const x = c.sx + (c.tx - c.sx) * u, z = c.sz + (c.tz - c.sz) * u;
    const y = HAND_Y + (0.25 - HAND_Y) * u + c.peak * 4 * u * (1 - u);
    c.group.position.set(x, y, z);
    c.group.rotation.y = c.t * 9;
    const pulse = 0.5 + 0.5 * Math.sin(c.t * (14 + 40 * u));
    c.halo.scale.setScalar(0.8 + 0.7 * pulse * (0.4 + u));
    c.haloMat.opacity = 0.35 + 0.5 * pulse;
    c.markerMat.opacity = 0.25 + 0.4 * pulse * u;
    world.shadowAdd(x, z, 0.45);
  }

  world.shadowEnd();
  particles.sync();
  lightningViz.sync();

  // ---- HUD
  hudSnap.time = G.time; hudSnap.level = G.level; hudSnap.xp = G.xp; hudSnap.xpNext = G.xpNext;
  hudSnap.hp = G.hp; hudSnap.maxHp = G.maxHp; hudSnap.kills = G.kills;
  hudSnap.loadout = loadoutList; hudSnap.loadoutSig = loadoutSig;
  if (G.phase !== 'title') ui.update(hudSnap);
  ui.setHurt(G.hurtFlash);
  ui.updateDamage(animate ? dt : 0, camera, viewW, viewH);
  // arrow toward an off-screen boss
  if (G.boss && G.phase !== 'title') {
    _v3.set(G.boss.x, G.boss.h * 0.5, G.boss.z).project(camera);
    let nx = _v3.x, ny = _v3.y;
    if (_v3.z > 1) { nx = -nx; ny = -ny; }          // behind the camera: flip
    if (Math.abs(nx) > 0.9 || Math.abs(ny) > 0.9) {
      const m = Math.max(Math.abs(nx), Math.abs(ny), 1e-4);
      const ex = nx / m, ey = ny / m;               // on the unit square
      const mx = 1 - 30 / (viewW * 0.5), my = 1 - 70 / (viewH * 0.5);
      ui.bossArrow(true, (ex * mx * 0.5 + 0.5) * viewW, (-ey * my * 0.5 + 0.5) * viewH, Math.atan2(ex, ey));
    } else ui.bossArrow(false);
  } else ui.bossArrow(false);
  if (G.phase !== 'title') {
    _v3.set(P.x, 0, P.z + 0.55).project(camera);
    ui.playerBar((_v3.x * 0.5 + 0.5) * viewW, (-_v3.y * 0.5 + 0.5) * viewH + 2, G.hp / G.maxHp, G.hp < G.maxHp - 0.5);
  }
}
const hudSnap = { time: 0, level: 1, xp: 0, xpNext: 1, hp: 1, maxHp: 1, kills: 0, loadout: [], loadoutSig: '' };

function frame(ts) {
  if (stopped) return;
  rafId = requestAnimationFrame(frame);
  try {
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0) G.fps += (Math.min(1 / dt, 240) - G.fps) * 0.08;   // from the raw frame time, before the sim clamp below
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;

    if (G.phase === 'playing') {
      accum += dt * G.timeScale;
      const maxSteps = Math.ceil(3 * G.timeScale);
      let n = 0;
      while (accum >= STEP && n < maxSteps) {
        simStep(STEP);
        accum -= STEP; n++;
        if (G.phase !== 'playing') break;
      }
      if (n >= maxSteps) accum = 0;
    } else if (G.phase === 'gameover' || G.phase === 'victory') {
      accum = 0;
      fxStep(dt);
      if (G.endDelay > 0) {
        G.endDelay -= dt;
        if (G.endDelay <= 0) ui.showEnd(G.phase, { time: G.time, kills: G.kills, level: G.level });
      }
    }
    syncVisuals(dt, G.phase === 'playing' || G.phase === 'title');
    renderer.render(scene, camera);
    G.drawCalls = renderer.info.render.calls;
  } catch (err) {
    fatal(err);
  }
}

// ===========================================================================
//  Debug hooks (the test harness drives the game through these)
// ===========================================================================
function installDebug() {
  const debug = {
    addXP(n) { addXP(+n || 0); },
    setTime(s) {
      G.time = Math.max(0, +s || 0);
      G.nextEliteAt = (Math.floor(G.time / THEME.elites.every) + 1) * THEME.elites.every;
    },
    spawn(type, n = 1, opts) {
      if (!THEME.enemies[type]) return 0;
      let made = 0;
      for (let i = 0; i < n; i++) {
        if (active.length >= MAX_ENEMIES + 4) break;
        const a = Math.random() * TAU, d = 6 + Math.random() * 5;
        const e = spawnEnemy(type, P.x + Math.sin(a) * d, P.z + Math.cos(a) * d, { elite: !!(opts && opts.elite), announce: i === 0 });
        if (e) made++;
      }
      return made;
    },
    god(on) { G.god = on === undefined ? true : !!on; return G.god; },
    killAll() {
      for (let i = 0; i < active.length; i++) { const e = active[i]; if (!e.dead) { e.hp = 0; killEnemy(e, 0, 0); } }
      flushKills();
    },
    damagePlayer(n) { hurtPlayer(+n || 0, true); },
    chooseUpgrade(i) { return chooseCard(i | 0); },
    giveWeapon(id, level = 1) {
      if (!THEME.weapons[id]) return false;
      addWeapon(id, level);
      return true;
    },
    giveAllWeapons() { for (const id of Object.keys(THEME.weapons)) addWeapon(id, THEME.weapons[id].levels.length); },
    setMove(x, z) { input.setDebugMove(x, z); },
    enemies() { return active.map((e) => [e.x, e.z, e.key]); },
    timeScale(k) { G.timeScale = clamp(Math.round(+k || 1), 1, 8); },
    /** Not in the contract: run n fixed sim steps synchronously (only while playing or paused). Handy for screenshots. */
    step(n = 1) {
      const was = G.phase;
      if (was !== 'playing' && was !== 'paused') return false;
      G.phase = 'playing';
      for (let i = 0; i < n && G.phase === 'playing'; i++) simStep(STEP);
      if (G.phase === 'playing') G.phase = was;
      return true;
    },
  };
  window.__game = {
    state() {
      const wl = {}, pl = {};
      for (const w of weapons) wl[w.id] = w.level;
      for (const id in passives) if (passives[id] > 0) pl[id] = passives[id];
      return {
        phase: G.phase, time: G.time, level: G.level, xp: G.xp, xpNext: G.xpNext, hp: G.hp, maxHp: G.maxHp, kills: G.kills,
        enemies: active.length, crystals: crystalCount, player: { x: P.x, z: P.z }, weapons: wl, passives: pl,
        choices: G.phase === 'levelup' ? G.choices.slice() : [], fps: Math.round(G.fps), drawCalls: G.drawCalls,
      };
    },
    start() { if (G.phase === 'title') startRun(); else if (G.phase === 'gameover' || G.phase === 'victory') restartRun(); },
    restart() { restartRun(); },
    debug,
  };
}

boot().catch(fatal);
