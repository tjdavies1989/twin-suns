// ============================================================================
//  fx.js — effect renderers. Everything here is pooled / instanced and does no
//  per-frame allocation. Colours are passed in by the caller (they come from THEME).
//
//    createParticles   dust puffs (normal blend) + sparks (additive), InstancedMesh
//    createBoltViz     blaster bolts: white core + coloured additive halo, 2 draw calls
//    createLightningViz jagged force-lightning, rebuilt a few times a second
//    createRings       expanding ground rings / discs / flash spheres, small mesh pool
// ============================================================================
import * as THREE from 'three';
import { makeInstanced, setYawMatrix, setSegmentMatrix, setInstColor, flushInstanced, TAU, clamp } from './util.js';

const _col = new THREE.Color();

// ============================================================================
//  Particles
// ============================================================================
export function createParticles(scene) {
  const CAP = 700;
  const dustMesh = makeInstanced(
    new THREE.IcosahedronGeometry(0.5, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, depthWrite: false }),
    CAP, true);
  const sparkMesh = makeInstanced(
    new THREE.OctahedronGeometry(0.5, 0),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: false }),
    CAP, true);
  dustMesh.renderOrder = 3; sparkMesh.renderOrder = 4;
  scene.add(dustMesh, sparkMesh);

  function pool(mesh, isDust) {
    const f = () => new Float32Array(CAP);
    return { mesh, isDust, next: 0, x: f(), y: f(), z: f(), vx: f(), vy: f(), vz: f(), life: f(), max: f(), size: f(), grav: f(), drag: f(), r: f(), g: f(), b: f() };
  }
  const dust = pool(dustMesh, true);
  const spark = pool(sparkMesh, false);

  function emit(p, x, y, z, vx, vy, vz, life, size, r, g, b, grav, drag) {
    const i = p.next; p.next = (i + 1) % CAP;
    p.x[i] = x; p.y[i] = y; p.z[i] = z; p.vx[i] = vx; p.vy[i] = vy; p.vz[i] = vz;
    p.life[i] = life; p.max[i] = life; p.size[i] = size; p.grav[i] = grav; p.drag[i] = drag;
    p.r[i] = r; p.g[i] = g; p.b[i] = b;
  }

  function step(p, dt) {
    for (let i = 0; i < CAP; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) continue;
      const k = Math.max(0, 1 - p.drag[i] * dt);
      p.vx[i] *= k; p.vz[i] *= k; p.vy[i] = p.vy[i] * k - p.grav[i] * dt;
      p.x[i] += p.vx[i] * dt; p.y[i] += p.vy[i] * dt; p.z[i] += p.vz[i] * dt;
      if (p.y[i] < 0.05 && p.vy[i] < 0) { p.y[i] = 0.05; p.vy[i] *= -0.25; p.vx[i] *= 0.7; p.vz[i] *= 0.7; }
    }
  }

  function write(p) {
    const m = p.mesh, a = m.instanceMatrix.array, c = m.instanceColor.array;
    let n = 0;
    for (let i = 0; i < CAP; i++) {
      const l = p.life[i];
      if (l <= 0) continue;
      const t = l / p.max[i];
      const s = p.isDust ? p.size[i] * (1 + 0.8 * (1 - t)) * Math.sqrt(t) : p.size[i] * t;
      const o = n * 16;
      a[o] = s; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = s; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = s; a[o + 11] = 0;
      a[o + 12] = p.x[i]; a[o + 13] = p.y[i]; a[o + 14] = p.z[i]; a[o + 15] = 1;
      c[n * 3] = p.r[i]; c[n * 3 + 1] = p.g[i]; c[n * 3 + 2] = p.b[i];
      n++;
    }
    flushInstanced(m, n);
  }

  const api = {
    meshes: [dustMesh, sparkMesh],
    update(dt) { step(dust, dt); step(spark, dt); },
    sync() { write(dust); write(spark); },
    clear() { dust.life.fill(0); spark.life.fill(0); },
    /** Dust puff: n soft lumps drifting out and shrinking. `hex` is the base tint. */
    puff(x, y, z, n, speed, size, life, hex) {
      _col.set(hex);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, s = speed * (0.35 + Math.random() * 0.65);
        const v = 0.78 + Math.random() * 0.34;
        emit(dust, x + Math.cos(a) * 0.15, y, z + Math.sin(a) * 0.15, Math.cos(a) * s, 0.8 + Math.random() * speed * 0.35, Math.sin(a) * s,
          life * (0.7 + Math.random() * 0.5), size * (0.6 + Math.random() * 0.7), _col.r * v, _col.g * v, _col.b * v, 2.2, 3.2);
      }
    },
    /** Spark burst (additive). */
    sparks(x, y, z, n, speed, size, life, hex) {
      _col.set(hex);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, up = 0.25 + Math.random() * 0.9, s = speed * (0.3 + Math.random() * 0.7);
        emit(spark, x, y, z, Math.cos(a) * s, up * speed * 0.55, Math.sin(a) * s,
          life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), _col.r, _col.g, _col.b, 14, 1.2);
      }
    },
    /** Ring of dust thrown outward on the ground (force push). */
    dustRing(x, z, radius, n, hex) {
      _col.set(hex);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + Math.random() * 0.2;
        const sp = radius / 0.4 * (0.6 + Math.random() * 0.4);
        emit(dust, x + Math.cos(a) * 0.6, 0.15, z + Math.sin(a) * 0.6, Math.cos(a) * sp, 0.6 + Math.random() * 1.2, Math.sin(a) * sp,
          0.5 + Math.random() * 0.3, 0.55 + Math.random() * 0.4, _col.r, _col.g, _col.b, 3, 5);
      }
    },
  };
  return api;
}

// ============================================================================
//  Blaster bolts: capsule along Z, additive halo + hot core
// ============================================================================
export function createBoltViz(scene, cap = 220) {
  const geo = new THREE.CapsuleGeometry(0.5, 1, 2, 6);
  geo.rotateX(Math.PI / 2); // axis Y -> Z; total length 2, width 1
  const glow = makeInstanced(geo, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, fog: false,
  }), cap, true);
  const core = makeInstanced(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), cap, true);
  glow.renderOrder = 5; core.renderOrder = 6;
  scene.add(glow, core);
  let n = 0;
  return {
    meshes: [glow, core],
    begin() { n = 0; },
    /** One bolt. len = visual length in metres; r,g,b = linear colour of the halo. */
    add(x, y, z, yaw, len, r, g, b) {
      if (n >= cap) return;
      setYawMatrix(glow, n, x, y, z, yaw, 0.34, 0.34, len * 0.55);
      setInstColor(glow, n, r, g, b);
      setYawMatrix(core, n, x, y, z, yaw, 0.12, 0.12, len * 0.5);
      setInstColor(core, n, r + (1 - r) * 0.75, g + (1 - g) * 0.75, b + (1 - b) * 0.75);
      n++;
    },
    end() { flushInstanced(glow, n); flushInstanced(core, n); },
  };
}

// ============================================================================
//  Force lightning: jagged polylines re-rolled ~20x/s so they crackle
// ============================================================================
export function createLightningViz(scene) {
  const SEG_CAP = 600;
  const BOLTS = 8;
  const MAX_PTS = 14;     // chain points per bolt
  const MAX_SUB = 110;    // sub-polyline points per bolt
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0, 0);
  const glow = makeInstanced(box, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, fog: false,
  }), SEG_CAP, true);
  const core = makeInstanced(box, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), SEG_CAP, true);
  glow.renderOrder = 5; core.renderOrder = 6;
  scene.add(glow, core);

  const bolts = [];
  for (let i = 0; i < BOLTS; i++) {
    bolts.push({ active: false, life: 0, max: 1, n: 0, pts: new Float32Array(MAX_PTS * 3), sub: new Float32Array(MAX_SUB * 3), subN: 0, roll: 0, r: 1, g: 1, b: 1 });
  }
  let next = 0;

  function reroll(b) {
    const p = b.pts, s = b.sub;
    let k = 0;
    s[k++] = p[0]; s[k++] = p[1]; s[k++] = p[2];
    for (let i = 0; i < b.n - 1; i++) {
      const ax = p[i * 3], ay = p[i * 3 + 1], az = p[i * 3 + 2];
      const bx = p[i * 3 + 3], by = p[i * 3 + 4], bz = p[i * 3 + 5];
      const dx = bx - ax, dz = bz - az;
      const len = Math.sqrt(dx * dx + dz * dz + (by - ay) * (by - ay));
      const steps = clamp(Math.round(len / 1.0), 2, 7);
      const inv = 1 / (len || 1);
      const px = -dz * inv, pz = dx * inv; // horizontal perpendicular
      for (let j = 1; j < steps; j++) {
        if (k + 6 > MAX_SUB * 3) break;
        const t = j / steps;
        const amp = (Math.random() - 0.5) * 0.9;
        s[k++] = ax + dx * t + px * amp;
        s[k++] = ay + (by - ay) * t + (Math.random() - 0.5) * 0.5;
        s[k++] = az + dz * t + pz * amp;
      }
      if (k + 3 <= MAX_SUB * 3) { s[k++] = bx; s[k++] = by; s[k++] = bz; }
    }
    b.subN = (k / 3) | 0;
    b.roll = 0.045;
  }

  return {
    meshes: [glow, core],
    /** pts: flat [x,y,z,...]; n points. Returns nothing; oldest bolt is recycled when all are busy. */
    cast(hex, life, pts, n) {
      if (n < 2) return;
      let b = null;
      for (let i = 0; i < BOLTS; i++) { const c = bolts[(next + i) % BOLTS]; if (!c.active) { b = c; next = (next + i + 1) % BOLTS; break; } }
      if (!b) { b = bolts[next]; next = (next + 1) % BOLTS; }
      n = Math.min(n, MAX_PTS);
      b.active = true; b.life = life; b.max = life; b.n = n;
      for (let i = 0; i < n * 3; i++) b.pts[i] = pts[i];
      _col.set(hex); b.r = _col.r; b.g = _col.g; b.b = _col.b;
      reroll(b);
    },
    update(dt) {
      for (let i = 0; i < BOLTS; i++) {
        const b = bolts[i];
        if (!b.active) continue;
        b.life -= dt;
        if (b.life <= 0) { b.active = false; continue; }
        b.roll -= dt;
        if (b.roll <= 0) reroll(b);
      }
    },
    sync() {
      let n = 0;
      for (let i = 0; i < BOLTS; i++) {
        const b = bolts[i];
        if (!b.active) continue;
        const f = clamp(b.life / b.max, 0, 1);
        const wG = 0.75 * (0.35 + 0.65 * f), wC = 0.17 * (0.4 + 0.6 * f);
        const s = b.sub;
        for (let k = 0; k < b.subN - 1 && n < SEG_CAP; k++, n++) {
          const o = k * 3;
          setSegmentMatrix(glow, n, s[o], s[o + 1], s[o + 2], s[o + 3], s[o + 4], s[o + 5], wG);
          setInstColor(glow, n, b.r, b.g, b.b);
          setSegmentMatrix(core, n, s[o], s[o + 1], s[o + 2], s[o + 3], s[o + 4], s[o + 5], wC);
          setInstColor(core, n, b.r + (1 - b.r) * 0.8, b.g + (1 - b.g) * 0.8, b.b + (1 - b.b) * 0.8);
        }
      }
      flushInstanced(glow, n); flushInstanced(core, n);
    },
    clear() { for (const b of bolts) b.active = false; },
  };
}

// ============================================================================
//  Rings / discs / flash spheres (short-lived, additive, one mesh each)
// ============================================================================
export function createRings(scene, perKind = 8) {
  const flat = (g) => { g.rotateX(-Math.PI / 2); return g; };
  const geoms = {
    ring: flat(new THREE.RingGeometry(0.84, 1, 64)),
    disc: flat(new THREE.CircleGeometry(1, 48)),
    sphere: new THREE.SphereGeometry(1, 16, 12),
  };
  const items = [];
  for (const kind of Object.keys(geoms)) {
    for (let i = 0; i < perKind; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide,
        blending: kind === 'sphere' ? THREE.AdditiveBlending : THREE.NormalBlending,   // only the flash is additive: it washes out on sand otherwise
      });
      const mesh = new THREE.Mesh(geoms[kind], mat);
      mesh.visible = false; mesh.renderOrder = 4; mesh.frustumCulled = false;
      scene.add(mesh);
      items.push({ kind, mesh, mat, active: false, t: 0, dur: 1, r0: 0, r1: 1, op: 1 });
    }
  }
  return {
    meshes: items.map((i) => i.mesh),
    /** kind: 'ring' | 'disc' | 'sphere'. Grows r0 -> r1 over dur seconds while fading out. */
    spawn(kind, x, y, z, r0, r1, dur, hex, opacity) {
      let it = null;
      for (const c of items) if (c.kind === kind && !c.active) { it = c; break; }
      if (!it) { for (const c of items) if (c.kind === kind) { if (!it || c.t > it.t) it = c; } }
      it.active = true; it.t = 0; it.dur = dur; it.r0 = r0; it.r1 = r1; it.op = opacity;
      it.mat.color.set(hex);
      it.mesh.position.set(x, y, z);
      it.mesh.visible = true;
      const s = r0; it.mesh.scale.set(s, kind === 'sphere' ? s : 1, s);
      it.mat.opacity = opacity;
    },
    update(dt) {
      for (const it of items) {
        if (!it.active) continue;
        it.t += dt;
        const u = it.t / it.dur;
        if (u >= 1) { it.active = false; it.mesh.visible = false; continue; }
        const e = 1 - (1 - u) * (1 - u);
        const s = it.r0 + (it.r1 - it.r0) * e;
        it.mesh.scale.set(s, it.kind === 'sphere' ? s : 1, s);
        it.mat.opacity = it.op * Math.pow(1 - u, 1.6);
      }
    },
    clear() { for (const it of items) { it.active = false; it.mesh.visible = false; } },
  };
}
