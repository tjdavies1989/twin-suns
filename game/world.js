// ============================================================================
//  world.js — sky/fog/lights, endless sand ground, chunked scenery props,
//  instanced blob shadows. Everything is driven by THEME.world.
// ============================================================================
import * as THREE from 'three';
import { makeInstanced, flushInstanced, hash2, rng, rgba, mixHex, TAU } from './util.js';

const TILE = 32;          // metres per ground-texture tile
const PLANE = 256;        // ground plane size (m)
const TEX = 1024;         // ground texture resolution
const CHUNK = 16;         // prop chunk size (m)
const LOAD_R = 3;         // chunks loaded around the player (7x7)
const WORLD_SEED = 1337;
const SHADOW_CAP = 400;

export function createWorld({ scene, THEME, makeModel }) {
  const W = THEME.world;

  // ---------------------------------------------------------------- sky, fog, lights
  scene.background = new THREE.Color(W.skyColor);
  scene.fog = new THREE.Fog(W.fogColor, W.fogNear, W.fogFar);

  scene.add(new THREE.AmbientLight(W.ambient.color, W.ambient.intensity));
  for (const s of [W.sun1, W.sun2]) {
    const l = new THREE.DirectionalLight(s.color, s.intensity);
    l.position.set(s.direction[0], s.direction[1], s.direction[2]).normalize().multiplyScalar(60);
    scene.add(l);
  }

  // ---------------------------------------------------------------- ground
  const groundTex = buildGroundTexture(W.groundColor, W.groundColor2);
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(PLANE / TILE, PLANE / TILE);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(PLANE, PLANE).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: groundTex }));
  ground.matrixAutoUpdate = true;
  scene.add(ground);

  // ---------------------------------------------------------------- blob shadows
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: radialTexture(), color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false, fog: false,
  });
  const shadowMesh = makeInstanced(shadowGeo, shadowMat, SHADOW_CAP, false);
  shadowMesh.renderOrder = 1;
  scene.add(shadowMesh);
  let shN = 0;

  // ---------------------------------------------------------------- props
  const propDefs = (W.props || []).map((p) => ({ ...p }));
  const free = {};                 // model key -> ModelInstance[] free list
  const chunks = new Map();        // 'cx,cz' -> [{ holder, mi, key }]
  let lastCx = 1e9, lastCz = 1e9;

  function acquire(key) {
    const list = free[key] || (free[key] = []);
    let rec = list.pop();
    if (!rec) {
      const mi = makeModel(key);
      const holder = new THREE.Group();
      holder.add(mi.object);
      holder.matrixAutoUpdate = false;
      scene.add(holder);
      rec = { holder, mi, key };
    }
    rec.holder.visible = true;
    return rec;
  }

  function buildChunk(cx, cz) {
    const rand = rng(hash2(cx, cz, WORLD_SEED));
    const out = [];
    for (const def of propDefs) {
      const expected = (def.density * CHUNK * CHUNK) / 100;
      let n = Math.floor(expected);
      if (rand() < expected - n) n++;
      for (let i = 0; i < n; i++) {
        const x = (cx + rand()) * CHUNK, z = (cz + rand()) * CHUNK;
        const yaw = rand() * TAU;
        const sc = def.scaleMin + rand() * (def.scaleMax - def.scaleMin);
        if (x * x + z * z < 9) continue;   // keep the spawn spot clear
        const rec = acquire(def.model);
        rec.holder.position.set(x, 0, z);
        rec.holder.rotation.set(0, yaw, 0);
        rec.holder.scale.setScalar(sc);
        rec.holder.updateMatrix();
        out.push(rec);
      }
    }
    return out;
  }

  function releaseChunk(list) {
    for (const rec of list) {
      rec.holder.visible = false;
      (free[rec.key] || (free[rec.key] = [])).push(rec);
    }
  }

  function updateProps(px, pz) {
    const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
    if (cx === lastCx && cz === lastCz) return;
    lastCx = cx; lastCz = cz;
    for (const [key, list] of chunks) {
      const [kx, kz] = key.split(',');
      if (Math.abs(+kx - cx) > LOAD_R + 1 || Math.abs(+kz - cz) > LOAD_R + 1) { releaseChunk(list); chunks.delete(key); }
    }
    for (let dx = -LOAD_R; dx <= LOAD_R; dx++) {
      for (let dz = -LOAD_R; dz <= LOAD_R; dz++) {
        const key = (cx + dx) + ',' + (cz + dz);
        if (!chunks.has(key)) chunks.set(key, buildChunk(cx + dx, cz + dz));
      }
    }
  }

  return {
    /** Follow the player: snap the ground to whole tiles so the texture never swims. */
    update(px, pz) {
      ground.position.set(Math.round(px / TILE) * TILE, 0, Math.round(pz / TILE) * TILE);
      updateProps(px, pz);
    },
    setFogRange(near, far) { scene.fog.near = near; scene.fog.far = far; },
    shadowBegin() { shN = 0; },
    shadowAdd(x, z, r) {
      if (shN >= SHADOW_CAP) return;
      const a = shadowMesh.instanceMatrix.array, o = shN * 16;
      a[o] = r; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = r; a[o + 11] = 0;
      a[o + 12] = x; a[o + 13] = 0.04; a[o + 14] = z; a[o + 15] = 1;
      shN++;
    },
    shadowEnd() { flushInstanced(shadowMesh, shN); },
    shadowMesh,
  };
}

// ---------------------------------------------------------------------------
//  Procedural textures
// ---------------------------------------------------------------------------

/** Seamless sand: soft blotches, wind ripples (periodic, so they tile) and grain. */
function buildGroundTexture(c1, c2) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX;
  const g = cv.getContext('2d');
  const r = rng(90210);
  g.fillStyle = c1;
  g.fillRect(0, 0, TEX, TEX);

  const dark = mixHex(c2, '#7a4a1e', 0.35);
  const light = mixHex(c1, '#fff3d6', 0.45);
  const wrap = (fn) => { for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) fn(ox * TEX, oy * TEX); };

  // Broad tonal blotches (large-scale dune variation)
  for (let i = 0; i < 46; i++) {
    const x = r() * TEX, y = r() * TEX, rad = 90 + r() * 200;
    const col = r() < 0.55 ? c2 : light;
    wrap((ox, oy) => {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, rgba(col, 0.2 + r() * 0.1));
      gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr;
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    });
  }

  // Dune streaks: long soft ellipses along one wind direction
  g.save();
  for (let i = 0; i < 160; i++) {
    const x = r() * TEX, y = r() * TEX, len = 120 + r() * 320, wid = 5 + r() * 14;
    const col = r() < 0.6 ? c2 : light;
    const a = 0.05 + r() * 0.09;
    wrap((ox, oy) => {
      g.save();
      g.translate(x + ox, y + oy);
      g.rotate(-0.38);
      g.scale(len, wid);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      gr.addColorStop(0, rgba(col, a));
      gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill();
      g.restore();
    });
  }
  g.restore();

  // Wind ripples: thin wavy lines, periodic in x so the texture tiles
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const y0 = r() * TEX, amp = 3 + r() * 9, k = 1 + Math.floor(r() * 4), ph = r() * TAU, w = 1 + r() * 1.6;
    const a = 0.06 + r() * 0.07;
    for (let oy = -1; oy <= 1; oy++) {
      for (const [col, off, al] of [[dark, 0, a], [light, 2.6, a * 0.85]]) {
        g.strokeStyle = rgba(col, al);
        g.lineWidth = w;
        g.beginPath();
        for (let x = 0; x <= TEX; x += 16) {
          const y = y0 + oy * TEX + off + Math.sin((x / TEX) * TAU * k + ph) * amp;
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
    }
  }

  // Grain
  for (let i = 0; i < 16000; i++) {
    g.fillStyle = rgba(r() < 0.5 ? dark : light, 0.05 + r() * 0.08);
    g.fillRect(r() * TEX, r() * TEX, 1 + r() * 1.5, 1 + r() * 1.5);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function radialTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(0,0,0,1)');
  gr.addColorStop(0.55, 'rgba(0,0,0,0.55)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
