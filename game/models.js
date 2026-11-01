// ============================================================================
//  MODELS — placeholder figures (procedural) + GLB loading.
//
//  Public API (see CONTRACT.md):
//    await loadModels(THEME)   once, before the game starts. Never rejects.
//    makeModel(key)            → ModelInstance (see class below)
//
//  Every procedural figure is built from primitives, tinted with vertex
//  colours and merged into ONE BufferGeometry, so each instance is one draw
//  call. Geometry + material are cached per theme key and shared.
//
//  To swap in a real model, edit the entry in theme.js (see its header). The
//  .glb is normalised here: rotationY / scale / yOffset applied, humanoids
//  with no explicit scale are auto-fitted to ~1.8 m with feet on y = 0.
// ============================================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const PI = Math.PI;
const GLB_TIMEOUT_MS = 20000;
const HUMANOID_TARGET_HEIGHT = 1.8;

// ---------------------------------------------------------------------------
//  colour + geometry helpers
// ---------------------------------------------------------------------------
const WHITE = new THREE.Color(1, 1, 1);
const c = (hex) => new THREE.Color(hex);
const dark = (hex, f) => new THREE.Color(hex).multiplyScalar(f);
const light = (hex, t) => new THREE.Color(hex).lerp(WHITE, t);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Collects primitives, bakes each one's colour into vertex colours, merges. */
class Parts {
  constructor() { this.list = []; }

  _push(geo, matrix, colour) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    g.applyMatrix4(matrix);
    g.deleteAttribute('uv');
    const pos = g.attributes.position;
    const n = pos.count;
    const arr = new Float32Array(n * 3);
    if (typeof colour === 'function') {
      // per-face colouring: callback(nx,ny,nz, cx,cy,cz, faceIndex) → Color
      g.computeVertexNormals(); // non-indexed → flat face normals
      const nor = g.attributes.normal;
      for (let f = 0; f < n; f += 3) {
        const col = colour(
          nor.getX(f), nor.getY(f), nor.getZ(f),
          (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3,
          (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3,
          (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3,
          f / 3,
        );
        for (let k = 0; k < 3; k++) {
          const o = (f + k) * 3;
          arr[o] = col.r; arr[o + 1] = col.g; arr[o + 2] = col.b;
        }
      }
    } else {
      const col = colour.isColor ? colour : new THREE.Color(colour);
      for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.list.push(g);
  }

  _mat(o) {
    const p = o.p || [0, 0, 0], r = o.r || [0, 0, 0], s = o.s || [1, 1, 1];
    _e.set(r[0], r[1], r[2]);
    _q.setFromEuler(_e);
    _p.set(p[0], p[1], p[2]);
    _s.set(s[0], s[1], s[2]);
    return _m.compose(_p, _q, _s);
  }

  geo(g, colour, o = {}) { this._push(g, this._mat(o), colour); return this; }
  faces(g, fn, o = {}) { this._push(g, this._mat(o), fn); return this; }
  box(size, colour, o) { return this.geo(new THREE.BoxGeometry(size[0], size[1], size[2]), colour, o); }
  cyl(rt, rb, h, seg, colour, o) { return this.geo(new THREE.CylinderGeometry(rt, rb, h, seg, 1), colour, o); }
  cone(r, h, seg, colour, o) { return this.geo(new THREE.ConeGeometry(r, h, seg, 1), colour, o); }
  sph(r, colour, o) { return this.geo(new THREE.SphereGeometry(r, 8, 6), colour, o); }

  /** Tapered cylinder from point a (radius rA) to point b (radius rB). */
  limb(a, b, rA, rB, colour, seg = 6) {
    _a.set(a[0], a[1], a[2]);
    _b.set(b[0], b[1], b[2]);
    _d.subVectors(_b, _a);
    const len = _d.length();
    _q.setFromUnitVectors(UP, _d.normalize());
    _p.addVectors(_a, _b).multiplyScalar(0.5);
    _m.compose(_p, _q, ONE);
    this._push(new THREE.CylinderGeometry(rB, rA, len, seg, 1), _m, colour);
    return this;
  }

  /** Merge → one BufferGeometry. `ao` darkens toward the ground (baked depth cue). */
  build(ao = 0.25) {
    const geo = mergeGeometries(this.list, false);
    for (const g of this.list) g.dispose();
    this.list.length = 0;
    if (!geo) throw new Error('mergeGeometries failed (attribute mismatch)');
    geo.computeBoundingBox();
    if (ao > 0) {
      const H = Math.max(0.01, geo.boundingBox.max.y);
      const pos = geo.attributes.position, col = geo.attributes.color;
      for (let i = 0; i < pos.count; i++) {
        const f = 1 - ao + ao * clamp01(pos.getY(i) / H);
        col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f);
      }
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }
}

function finish(P, ao, radius, extra) {
  const geo = P.build(ao);
  const bb = geo.boundingBox;
  const r = radius ?? Math.max(bb.max.x, -bb.min.x, bb.max.z, -bb.min.z);
  return { variants: [{ geo, height: bb.max.y, radius: r }], ...extra };
}

// ---------------------------------------------------------------------------
//  BUILDERS — each takes a colour map and returns { variants:[{geo,height,radius}], emissive? }
// ---------------------------------------------------------------------------

function buildHero(k) {
  const P = new Parts();
  const robe = c(k.robe), robeD = dark(k.robe, 0.78), belt = dark(k.robe, 0.5);
  const skin = c(k.skin);

  // robe: skirt, torso, hem
  P.cyl(0.28, 0.41, 1.0, 8, robe, { p: [0, 0.5, 0] });
  P.cyl(0.415, 0.43, 0.07, 8, robeD, { p: [0, 0.04, 0] });
  P.cyl(0.26, 0.30, 0.55, 8, robe, { p: [0, 1.22, 0] });
  // pale tunic showing through the open robe
  P.box([0.22, 0.8, 0.06], k.tunic, { p: [0, 0.55, 0.335], r: [-0.1, 0, 0] });
  P.box([0.2, 0.5, 0.06], k.tunic, { p: [0, 1.2, 0.285] });
  // belt + buckle
  P.cyl(0.3, 0.31, 0.09, 8, belt, { p: [0, 0.97, 0] });
  P.box([0.08, 0.08, 0.04], k.hilt, { p: [0, 0.97, 0.31] });
  // broad shoulders (reads well from above)
  P.sph(0.4, robeD, { p: [0, 1.43, -0.01], s: [1, 0.38, 0.68] });
  // arms + big hands
  for (const sx of [-1, 1]) {
    P.limb([sx * 0.38, 1.4, 0], [sx * 0.42, 0.88, 0.2], 0.10, 0.08, robe);
    P.sph(0.1, skin, { p: [sx * 0.42, 0.85, 0.21] });
  }
  // head: hood up, face forward, hair peeking out
  P.sph(0.22, robeD, { p: [0, 1.56, -0.12], s: [1, 1.05, 1] });
  P.sph(0.26, robe, { p: [0, 1.57, -0.02], s: [1, 1, 1.02] });
  P.sph(0.15, skin, { p: [0, 1.54, 0.15], s: [1, 1.05, 0.9] });
  P.sph(0.12, k.hair, { p: [0, 1.67, 0.13], s: [1.1, 0.55, 0.9] });
  for (const sx of [-1, 1]) P.box([0.04, 0.04, 0.03], '#2a1f18', { p: [sx * 0.06, 1.56, 0.275] });
  // hilt on the right hip (the blade is the engine's orbit weapon)
  P.limb([0.33, 0.97, 0.1], [0.33, 0.95, 0.40], 0.032, 0.032, k.hilt);
  P.limb([0.33, 0.96, 0.2], [0.33, 0.955, 0.32], 0.04, 0.04, belt);
  P.cyl(0.048, 0.048, 0.05, 6, belt, { p: [0.33, 0.95, 0.42], r: [PI / 2, 0, 0] });
  return finish(P, 0.25, 0.45);
}

function buildRaider(k) {
  const P = new Parts();
  const robe = c(k.robe), wraps = c(k.wraps), mask = c(k.mask), gog = c(k.goggles);

  // layered robes
  P.cyl(0.30, 0.43, 1.0, 8, robe, { p: [0, 0.5, 0] });
  P.cyl(0.44, 0.50, 0.30, 8, wraps, { p: [0, 0.17, 0] });
  P.cyl(0.27, 0.33, 0.55, 8, robe, { p: [0, 1.2, 0] });
  P.cyl(0.335, 0.345, 0.07, 8, mask, { p: [0, 0.97, 0] });         // rope belt
  P.sph(0.06, mask, { p: [0.2, 0.94, 0.27] });
  P.limb([0.2, 0.94, 0.27], [0.24, 0.55, 0.33], 0.035, 0.02, mask, 5);
  P.box([0.62, 0.1, 0.06], wraps, { p: [0, 1.25, 0.27], r: [0, 0, 0.75] }); // chest sash
  P.sph(0.42, robe, { p: [0, 1.43, -0.03], s: [1, 0.4, 0.7] });     // shoulders
  P.sph(0.2, wraps, { p: [0, 1.38, -0.2], s: [1.2, 1, 0.9] });      // bundle on the back

  // arms: left hangs, right grips the staff
  P.limb([-0.38, 1.42, 0], [-0.42, 0.9, 0.12], 0.10, 0.085, robe);
  P.sph(0.1, wraps, { p: [-0.43, 0.86, 0.13] });
  P.limb([0.38, 1.42, 0], [0.5, 1.02, 0.28], 0.10, 0.085, robe);
  P.sph(0.115, wraps, { p: [0.5, 1.0, 0.28] });

  // gaffi-style staff: long haft, heavy head, spike, side prong
  P.limb([0.5, 0, 0.26], [0.47, 2.05, 0.28], 0.052, 0.045, k.stick);
  P.cyl(0.07, 0.07, 0.14, 6, wraps, { p: [0.495, 1.0, 0.27] });
  P.cyl(0.065, 0.065, 0.1, 6, wraps, { p: [0.475, 1.8, 0.28] });
  P.box([0.15, 0.15, 0.15], k.metal, { p: [0.47, 2.0, 0.28] });
  P.cone(0.065, 0.32, 6, k.metal, { p: [0.47, 2.23, 0.28] });
  P.cone(0.045, 0.28, 5, k.metal, { p: [0.62, 1.93, 0.28], r: [0, 0, -PI / 2] });

  // head: fully wrapped, hunched slightly forward
  const hy = 1.55, hz = 0.09, ra = 0.275, rb = 0.289;
  P.sph(ra, wraps, { p: [0, hy, hz], s: [1, 1.05, 1.05] });
  for (const [dy, col, tx] of [[-0.13, mask, 0.15], [0.03, dark(k.mask, 0.55), 0], [0.13, mask, -0.1], [0.21, mask, 0.12]]) {
    const rr = ra * Math.sqrt(1 - (dy / rb) ** 2) * 1.05 + 0.02;
    P.cyl(rr, rr, 0.05, 10, col, { p: [0, hy + dy, hz], r: [tx, 0, tx * 0.6] });
  }
  P.sph(0.09, wraps, { p: [0, 1.6, -0.22] });                         // knot at the back
  // goggles
  for (const sx of [-1, 1]) {
    P.cyl(0.12, 0.12, 0.05, 10, k.metal, { p: [sx * 0.12, 1.58, 0.335], r: [PI / 2, 0, 0] });
    P.cyl(0.1, 0.1, 0.08, 10, gog, { p: [sx * 0.12, 1.58, 0.36], r: [PI / 2, 0, 0] });
    P.sph(0.026, light(k.goggles, 0.6), { p: [sx * 0.15, 1.615, 0.405] });
  }
  // breathing grille
  P.box([0.18, 0.14, 0.09], k.metal, { p: [0, 1.43, 0.36] });
  for (const x of [-0.05, 0, 0.05]) P.box([0.018, 0.1, 0.02], gog, { p: [x, 1.43, 0.408] });
  return finish(P, 0.22, 0.5, { _h: 1.85 });
}

function buildRodian(k) {
  const P = new Parts();
  const skin = c(k.skin), skinD = dark(k.skin, 0.8), pants = c(k.pants), vest = c(k.vest), bl = c(k.blaster);

  // slim legs + boots
  for (const sx of [-1, 1]) {
    P.limb([sx * 0.11, 0.98, 0], [sx * 0.12, 0.1, 0.04], 0.1, 0.07, pants);
    P.box([0.13, 0.1, 0.24], dark(k.pants, 0.6), { p: [sx * 0.12, 0.05, 0.1] });
  }
  P.box([0.34, 0.22, 0.22], pants, { p: [0, 0.98, 0] });
  // vest over skin
  P.cyl(0.2, 0.15, 0.55, 7, vest, { p: [0, 1.25, 0] });
  P.box([0.13, 0.38, 0.05], skin, { p: [0, 1.28, 0.165] });
  P.cyl(0.155, 0.155, 0.06, 7, bl, { p: [0, 0.99, 0] });
  P.box([0.06, 0.14, 0.1], bl, { p: [-0.17, 0.92, 0.04] });          // holster
  P.cyl(0.055, 0.065, 0.16, 6, skin, { p: [0, 1.54, 0.02] });         // neck
  // arms: left relaxed, right out front with a pistol
  for (const sx of [-1, 1]) P.sph(0.08, vest, { p: [sx * 0.24, 1.46, 0] });
  P.limb([-0.24, 1.46, 0], [-0.3, 0.98, 0.1], 0.06, 0.05, skin);
  P.sph(0.085, skin, { p: [-0.3, 0.95, 0.11] });
  P.limb([0.24, 1.46, 0], [0.3, 1.25, 0.38], 0.06, 0.05, skin);
  P.sph(0.09, skin, { p: [0.3, 1.24, 0.4] });
  P.box([0.07, 0.11, 0.26], bl, { p: [0.3, 1.27, 0.52] });
  P.box([0.06, 0.13, 0.07], bl, { p: [0.3, 1.17, 0.45], r: [0.3, 0, 0] });
  P.limb([0.3, 1.29, 0.62], [0.3, 1.29, 0.8], 0.03, 0.025, light(k.blaster, 0.3));
  // head: big black eyes on the sides, tubular snout, two small spines (oversized so it reads from the 55-degree camera)
  P.sph(0.25, skin, { p: [0, 1.66, 0.05], s: [1, 1, 1.15] });
  for (const sx of [-1, 1]) {
    P.sph(0.17, k.eyes, { p: [sx * 0.22, 1.7, 0.12], s: [0.75, 1, 1.15] });
    P.sph(0.04, light(k.eyes, 0.6), { p: [sx * 0.27, 1.76, 0.25] });
    P.cone(0.05, 0.26, 5, skinD, { p: [sx * 0.09, 1.96, -0.02], r: [0, 0, -sx * 0.25] });
  }
  P.cyl(0.065, 0.08, 0.36, 6, skinD, { p: [0, 1.57, 0.38], r: [PI / 2, 0, 0] });
  P.cyl(0.05, 0.05, 0.04, 6, dark(k.skin, 0.4), { p: [0, 1.57, 0.58], r: [PI / 2, 0, 0] });
  return finish(P, 0.26, 0.55, { _h: 2.0 });
}

function buildOfficer(k) {
  const P = new Parts();
  const uni = c(k.uniform), trou = dark(k.uniform, 0.78), belt = c(k.belt), skin = c(k.skin), boots = c(k.boots);
  const red = c(k.insignia), blue = c(k.insignia2 || '#2f5fd0');

  // legs, boots
  for (const sx of [-1, 1]) {
    P.limb([sx * 0.12, 0.98, 0], [sx * 0.12, 0.3, 0], 0.11, 0.09, trou);
    P.cyl(0.11, 0.12, 0.3, 7, boots, { p: [sx * 0.12, 0.15, 0.0] });
    P.box([0.17, 0.1, 0.3], boots, { p: [sx * 0.12, 0.06, 0.07] });
  }
  P.box([0.36, 0.2, 0.26], trou, { p: [0, 0.96, 0] });
  // tunic
  P.box([0.52, 0.55, 0.3], uni, { p: [0, 1.22, 0] });
  P.box([0.54, 0.2, 0.32], dark(k.uniform, 0.92), { p: [0, 0.98, 0] });
  P.box([0.56, 0.07, 0.34], belt, { p: [0, 1.0, 0] });
  P.box([0.09, 0.08, 0.04], light(k.uniform, 0.5), { p: [0, 1.0, 0.18] });
  // insignia plate: red + blue squares on a dark backing
  P.box([0.25, 0.16, 0.03], belt, { p: [0.1, 1.38, 0.16] });
  P.box([0.09, 0.11, 0.035], red, { p: [0.055, 1.38, 0.175] });
  P.box([0.09, 0.11, 0.035], blue, { p: [0.145, 1.38, 0.175] });
  // red epaulettes read from above
  for (const sx of [-1, 1]) P.box([0.17, 0.05, 0.22], red, { p: [sx * 0.31, 1.5, 0] });
  // arms: left relaxed, right out front with a pistol
  P.limb([-0.32, 1.46, 0], [-0.35, 0.98, 0.1], 0.1, 0.085, uni);
  P.sph(0.09, skin, { p: [-0.35, 0.94, 0.11] });
  P.limb([0.32, 1.46, 0], [0.3, 1.28, 0.4], 0.1, 0.085, uni);
  P.sph(0.095, skin, { p: [0.3, 1.27, 0.42] });
  P.box([0.07, 0.11, 0.24], boots, { p: [0.3, 1.31, 0.54] });
  P.box([0.06, 0.13, 0.07], boots, { p: [0.3, 1.21, 0.47], r: [0.3, 0, 0] });
  P.limb([0.3, 1.33, 0.63], [0.3, 1.33, 0.8], 0.03, 0.025, '#4a4f55');
  // head + flat-topped peaked cap
  P.sph(0.18, skin, { p: [0, 1.64, 0], s: [1, 1.0, 1] });
  for (const sx of [-1, 1]) P.box([0.035, 0.035, 0.03], '#2a1f18', { p: [sx * 0.06, 1.63, 0.17] });
  P.cyl(0.2, 0.2, 0.09, 10, k.cap, { p: [0, 1.76, 0] });
  P.cyl(0.235, 0.235, 0.04, 10, light(k.cap, 0.15), { p: [0, 1.82, 0] });
  P.cyl(0.205, 0.205, 0.03, 10, belt, { p: [0, 1.725, 0] });
  P.box([0.28, 0.03, 0.15], dark(k.cap, 0.55), { p: [0, 1.71, 0.24], r: [0.15, 0, 0] });
  P.box([0.06, 0.06, 0.02], red, { p: [0, 1.77, 0.205] });
  return finish(P, 0.22, 0.45);
}

function buildRock(k) {
  const base = c(k.base), dk = c(k.dark);
  const variants = [];
  const defs = [
    { seed: 11, lumps: [{ r: 0.85, p: [0, 0, 0], s: [1.1, 0.72, 0.95] }, { r: 0.3, p: [0.95, -0.05, 0.3], s: [1, 0.8, 1] }] },
    { seed: 27, lumps: [{ r: 0.8, p: [0, 0, 0], s: [1, 0.95, 1.2] }, { r: 0.5, p: [-0.75, -0.1, -0.4], s: [1, 0.8, 1] }, { r: 0.25, p: [0.6, -0.1, 0.8], s: [1, 0.8, 1] }] },
    { seed: 53, lumps: [{ r: 1.0, p: [0, 0, 0], s: [1.3, 0.45, 0.9] }, { r: 0.45, p: [0.25, 0.3, -0.2], s: [1, 0.9, 1] }] },
  ];
  const tmp = new THREE.Color();
  for (const d of defs) {
    const rnd = mulberry32(d.seed);
    const P = new Parts();
    for (const l of d.lumps) {
      const g = new THREE.IcosahedronGeometry(1, 1);
      // jitter vertices consistently (duplicated verts share a key) for a chunky, irregular boulder
      const pos = g.attributes.position, seen = new Map();
      for (let i = 0; i < pos.count; i++) {
        const key = pos.getX(i).toFixed(3) + '|' + pos.getY(i).toFixed(3) + '|' + pos.getZ(i).toFixed(3);
        let f = seen.get(key);
        if (f === undefined) { f = 0.78 + rnd() * 0.42; seen.set(key, f); }
        pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
      }
      const yaw = rnd() * PI * 2;
      P.faces(g, (nx, ny) => {
        const t = clamp01(0.4 + 0.55 * ny + (rnd() - 0.5) * 0.22);
        return tmp.copy(dk).lerp(base, t);
      }, { p: l.p, s: [l.s[0] * l.r, l.s[1] * l.r, l.s[2] * l.r], r: [0, yaw, 0] });
    }
    const geo = P.build(0);
    geo.computeBoundingBox();
    geo.translate(0, -geo.boundingBox.min.y - 0.08, 0); // sit slightly sunk in the sand
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const bb = geo.boundingBox;
    variants.push({ geo, height: bb.max.y, radius: Math.max(bb.max.x, -bb.min.x, bb.max.z, -bb.min.z) * 0.9 });
  }
  return { variants };
}

function buildVaporator(k) {
  const P = new Parts();
  const body = c(k.body), dk = c(k.dark), band = c(k.band);
  P.cyl(0.42, 0.5, 0.22, 8, dk, { p: [0, 0.11, 0] });
  P.cyl(0.13, 0.17, 1.75, 8, body, { p: [0, 1.09, 0] });
  for (const y of [0.5, 0.95, 1.4]) P.cyl(0.2, 0.2, 0.07, 8, band, { p: [0, y, 0] });
  P.cyl(0.21, 0.21, 0.5, 8, body, { p: [0, 2.12, 0] });
  P.cyl(0.23, 0.23, 0.06, 8, band, { p: [0, 1.9, 0] });
  P.cyl(0.23, 0.23, 0.06, 8, band, { p: [0, 2.33, 0] });
  P.cone(0.2, 0.22, 8, dk, { p: [0, 2.49, 0] });
  P.limb([0, 2.55, 0], [0, 3.0, 0], 0.02, 0.012, dk, 4);
  // collector vanes
  for (let i = 0; i < 4; i++) {
    const th = i * PI / 2 + PI / 4;
    P.box([0.42, 0.035, 0.16], dk, { p: [Math.cos(th) * 0.36, 1.62, -Math.sin(th) * 0.36], r: [0, th, 0.45] });
  }
  P.sph(0.1, dk, { p: [0.12, 0.9, 0.17] }); // little valve
  return finish(P, 0.18, 0.5);
}

function buildBones(k) {
  const P = new Parts();
  const bone = c(k.bone), boneD = dark(k.bone, 0.84), socket = dark(k.bone, 0.28);
  // rib cage lying along x, half buried
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x = -1.2 + i * 0.4;
    const R = 0.55 + 0.35 * Math.sin(PI * (i + 0.5) / n);
    const arc = (i === 2 ? 0.6 : i === 4 ? 0.76 : 0.94) * PI;
    P.geo(new THREE.TorusGeometry(R, 0.085, 5, 10, arc), i % 2 ? bone : boneD,
      { p: [x, -0.05, 0], r: [0, PI / 2, (PI - arc) / 2], s: [1, 0.85, 1] });
    P.box([0.26, 0.18, 0.24], bone, { p: [x, R * 0.85 - 0.06, 0] });
    if (i < n - 1) {
      const R2 = 0.55 + 0.35 * Math.sin(PI * (i + 1.5) / n);
      P.limb([x, R * 0.85 - 0.06, 0], [x + 0.4, R2 * 0.85 - 0.06, 0], 0.07, 0.07, boneD);
    }
  }
  // tail vertebrae trailing off
  for (let i = 0; i < 4; i++) {
    const s = 1 - i * 0.18;
    P.box([0.2 * s, 0.13 * s, 0.17 * s], boneD, { p: [-1.55 - i * 0.28, 0.45 - i * 0.12, 0.03 * i] });
  }
  // skull: braincase, long snout, sockets, horns, teeth
  P.box([0.7, 0.42, 0.55], bone, { p: [1.75, 0.3, 0] });
  P.box([0.08, 0.7, 0.95], boneD, { p: [1.36, 0.45, 0], r: [0, 0, 0.35] });          // frill behind the skull
  P.limb([1.3, 0.2, 0], [1.1, 0.12, 0], 0.15, 0.1, bone);                             // neck stub
  P.box([0.66, 0.26, 0.34], bone, { p: [2.3, 0.22, 0] });
  P.box([0.62, 0.06, 0.4], boneD, { p: [2.28, 0.07, 0] });
  for (const sz of [-1, 1]) {
    P.box([0.15, 0.12, 0.06], socket, { p: [1.97, 0.5, sz * 0.28] });
    P.box([0.05, 0.07, 0.08], socket, { p: [2.58, 0.28, sz * 0.1] });
    P.cone(0.09, 0.6, 5, boneD, { p: [1.95, 0.72, sz * 0.3], r: [sz * 0.35, 0, -0.5] });
    for (let t = 0; t < 3; t++) P.cone(0.035, 0.12, 4, light(k.bone, 0.2), { p: [2.1 + t * 0.15, 0.1, sz * 0.19], r: [0, 0, PI] });
  }
  // a stray long bone
  P.limb([-0.4, 0.05, 1.3], [0.7, 0.1, 1.55], 0.065, 0.065, bone);
  P.sph(0.1, bone, { p: [-0.42, 0.06, 1.3] });
  P.sph(0.1, bone, { p: [0.72, 0.11, 1.56] });
  return finish(P, 0.1, 1.6);
}

function buildCrystal(k) {
  const P = new Parts();
  const core = c(k.core), hi = light(k.core, 0.6), lo = dark(k.core, 0.55), tmp = new THREE.Color();
  P.faces(new THREE.OctahedronGeometry(0.2, 0), (nx, ny, nz) => {
    const t = clamp01(0.5 + ny * 0.38 + nx * 0.2 - nz * 0.12);
    return t > 0.5 ? tmp.copy(core).lerp(hi, (t - 0.5) * 2) : tmp.copy(lo).lerp(core, t * 2);
  }, { p: [0, 0.42, 0], s: [1, 1.7, 1], r: [0, 0.5, 0] });
  return finish(P, 0, 0.2, { emissive: { color: k.core, k: 0.55 } });
}

function buildBacta(k) {
  const P = new Parts();
  const glass = c(k.glass), cap = c(k.cap), cross = light('#ffffff', 0);
  P.cyl(0.15, 0.15, 0.36, 8, glass, { p: [0, 0.28, 0] });
  P.cyl(0.165, 0.165, 0.06, 8, cap, { p: [0, 0.1, 0] });
  P.cyl(0.165, 0.165, 0.06, 8, cap, { p: [0, 0.46, 0] });
  P.cyl(0.05, 0.06, 0.08, 6, dark(k.cap, 0.7), { p: [0, 0.53, 0] });
  for (const sz of [-1, 1]) {
    P.box([0.17, 0.05, 0.03], cross, { p: [0, 0.28, sz * 0.15] });
    P.box([0.05, 0.17, 0.03], cross, { p: [0, 0.28, sz * 0.15] });
  }
  return finish(P, 0, 0.2, { emissive: { color: k.glass, k: 0.45 } });
}

// motion: 'walk' (bob + waddle) | 'spin' (pickup float + spin) | 'none' (static prop)
const BUILDERS = {
  hero:      { fn: buildHero,      motion: 'walk', humanoid: true, defaults: { robe: '#5b4636', tunic: '#e8dcc4', skin: '#e0b48f', hair: '#c9a15b', hilt: '#9aa0a6' } },
  raider:    { fn: buildRaider,    motion: 'walk', humanoid: true, defaults: { robe: '#bfa27a', wraps: '#8f7a5c', mask: '#6b5a45', goggles: '#2b2622', metal: '#8a8f94', stick: '#5a4632' } },
  rodian:    { fn: buildRodian,    motion: 'walk', humanoid: true, defaults: { skin: '#5fae4a', eyes: '#0d0f12', vest: '#7a4b2a', pants: '#3a3f4a', blaster: '#2d2d2d' } },
  officer:   { fn: buildOfficer,   motion: 'walk', humanoid: true, defaults: { uniform: '#7c8590', cap: '#6c747e', belt: '#1c1c1c', skin: '#e2b896', boots: '#141414', insignia: '#d33b2f' } },
  rock:      { fn: buildRock,      motion: 'none', defaults: { base: '#a8794b', dark: '#7f5a37' } },
  vaporator: { fn: buildVaporator, motion: 'none', defaults: { body: '#cfd2d4', dark: '#6d7378', band: '#9aa0a6' } },
  bones:     { fn: buildBones,     motion: 'none', defaults: { bone: '#efe6d2' } },
  crystal:   { fn: buildCrystal,   motion: 'spin', defaults: { core: '#5ff2ff' } },
  bacta:     { fn: buildBacta,     motion: 'spin', defaults: { glass: '#5dd6c0', cap: '#e8e8e8' } },
};
BUILDERS.warlord = BUILDERS.raider;
BUILDERS.crystalBig = BUILDERS.crystal;

// ---------------------------------------------------------------------------
//  shared materials + registry
// ---------------------------------------------------------------------------
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
flashMat.name = 'models.flash';

/** key → template. Procedural: {kind:'proc', mat, variants, scale, motion}. GLB: {kind:'glb', scene, clips, ...}. */
const registry = new Map();
const warnedUnknown = new Set();
let unknownTemplate = null;

function buildProcedural(key, entry, builderName, scale) {
  const b = BUILDERS[builderName];
  if (!b) throw new Error(`no procedural builder named "${builderName}"`);
  const colors = { ...b.defaults, ...(entry.colors || {}) };
  const res = b.fn(colors);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.name = 'models.' + key;
  if (res.emissive) {
    mat.emissive.set(res.emissive.color);
    mat.emissiveIntensity = res.emissive.k;
  }
  const variants = res.variants.map((v) => ({
    geo: v.geo,
    height: (res._h ?? v.height) * scale,
    radius: v.radius * scale,
  }));
  // characters report the body height, not the staff / spikes
  if (res._h) variants[0].height = res._h * scale;
  registry.set(key, { kind: 'proc', mat, variants, scale, motion: b.motion });
}

function getUnknownTemplate() {
  if (!unknownTemplate) {
    const geo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    geo.translate(0, 0.3, 0);
    unknownTemplate = {
      kind: 'proc', mat: new THREE.MeshBasicMaterial({ color: 0xff00ff }),
      variants: [{ geo, height: 0.6, radius: 0.4 }], scale: 1, motion: 'none',
    };
  }
  return unknownTemplate;
}

function withTimeout(promise, ms, what) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timed out after ${ms} ms loading ${what}`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// ---------------------------------------------------------------------------
//  GLB loading + normalising
// ---------------------------------------------------------------------------
async function loadGlbTemplate(key, entry, loader, maxEnemies) {
  const gltf = await withTimeout(loader.loadAsync(entry.url), GLB_TIMEOUT_MS, entry.url);
  const src = gltf.scene || (gltf.scenes && gltf.scenes[0]);
  if (!src) throw new Error('glTF has no scene');

  const rotY = entry.rotationY || 0;
  const yOff = entry.yOffset || 0;
  const inner = new THREE.Group();
  inner.add(src);
  inner.rotation.y = rotY;
  const root = new THREE.Group();
  root.add(inner);

  const humanoid = entry.humanoid ?? !!(BUILDERS[entry.fallback || entry.builder || key] || {}).humanoid;
  const box = new THREE.Box3();
  if (entry.scale == null) {
    // auto-fit: humanoids to ~1.8 m; others keep their authored size. Always ground + centre.
    root.updateMatrixWorld(true);
    box.setFromObject(root);
    const h = box.max.y - box.min.y;
    let s = 1;
    if (humanoid && h > 1e-6) s = (entry.height || HUMANOID_TARGET_HEIGHT) / h;
    inner.scale.setScalar(s);
    root.updateMatrixWorld(true);
    box.setFromObject(root);
    inner.position.set(-(box.min.x + box.max.x) / 2, -box.min.y + yOff, -(box.min.z + box.max.z) / 2);
  } else {
    inner.scale.setScalar(entry.scale);
    inner.position.y = yOff;
  }
  root.updateMatrixWorld(true);
  box.setFromObject(root);
  const size = box.getSize(new THREE.Vector3());

  let meshCount = 0;
  src.traverse((o) => { if (o.isMesh) meshCount++; if (o.isSkinnedMesh) o.frustumCulled = false; });
  if (meshCount > 2 && !/^(rock|vaporator|bones)$/.test(key)) {
    const maxN = maxEnemies;
    console.warn(`[models] "${key}": ${entry.url} has ${meshCount} meshes. Every instance costs one draw call per mesh (up to ~${meshCount * maxN} at ${maxN} enemies; budget is ~350). Merge it into one mesh with one material.`);
  }

  const clips = gltf.animations || [];
  let walk = null, idle = null;
  if (clips.length) {
    walk = (entry.anim && clips.find((a) => a.name === entry.anim)) || clips[0];
    if (entry.anim && walk.name !== entry.anim) console.warn(`[models] "${key}": animation "${entry.anim}" not found in ${entry.url}; using "${walk.name}"`);
    idle = (entry.idleAnim && clips.find((a) => a.name === entry.idleAnim)) || clips.find((a) => a !== walk && /idle/i.test(a.name)) || null;
  }
  return {
    kind: 'glb', scene: root, walk, idle,
    locomotion: !!walk && /walk|run|move/i.test(walk.name),
    motion: walk ? 'mixer' : (humanoid || entry.bob ? 'walk' : 'none'),
    height: Math.max(0.05, box.max.y), radius: Math.max(0.05, (size.x + size.z) / 4),
  };
}

// ---------------------------------------------------------------------------
//  public: loadModels
// ---------------------------------------------------------------------------
export async function loadModels(theme) {
  const entries = Object.entries((theme && theme.models) || {});
  const loader = new GLTFLoader();
  await Promise.all(entries.map(async ([key, entry]) => {
    try {
      if (entry.url) {
        try {
          registry.set(key, await loadGlbTemplate(key, entry, loader, (theme && theme.maxEnemies) || 220));
          return;
        } catch (err) {
          const fb = entry.fallback || entry.builder || key;
          console.warn(`[models] "${key}": could not load "${entry.url}" (${err && err.message ? err.message : err}); using built-in "${fb}" instead.`);
          buildProcedural(key, entry, fb, entry.fallbackScale ?? 1);
          return;
        }
      }
      buildProcedural(key, entry, entry.builder || key, entry.scale ?? 1);
    } catch (err) {
      console.warn(`[models] "${key}": ${err && err.message ? err.message : err}. A magenta box will be used.`);
    }
  }));
}

// ---------------------------------------------------------------------------
//  ModelInstance
// ---------------------------------------------------------------------------
const _tintC = new THREE.Color();

function cloneMat(m) { return Array.isArray(m) ? m.map((x) => x.clone()) : m.clone(); }

function configureOwn(own, base, tint, op) {
  if (Array.isArray(own)) { for (let i = 0; i < own.length; i++) configureOwn(own[i], base[i], tint, op); return; }
  own.color.copy(base.color);
  if (own.emissive) own.emissive.copy(base.emissive);
  if (tint) {
    own.color.multiply(tint.mul);
    if (own.emissive) own.emissive.add(tint.glow);
  }
  own.transparent = base.transparent || op < 1;
  own.opacity = base.opacity * op;
  own.depthWrite = op >= 1 ? base.depthWrite : false;
}

class ModelInstance {
  constructor(tmpl) {
    this.object = new THREE.Group();
    this.rig = new THREE.Group();   // animated child: bob / waddle / spin happen here, never on `object`
    this.object.add(this.rig);
    this.slots = [];                // {mesh, base, own}
    this.flash = false;
    this.tint = null;               // {mul: Color, glow: Color}
    this.opacity = 1;
    this.mixer = null;
    this.motion = tmpl.motion;
    this.phase = Math.random() * PI * 2;
    this.t = Math.random() * 10;
    this.amp = 0;
    this.stepScale = 1;
    this.moving = false;

    if (tmpl.kind === 'proc') {
      const v = tmpl.variants[(Math.random() * tmpl.variants.length) | 0];
      const mesh = new THREE.Mesh(v.geo, tmpl.mat);
      mesh.scale.setScalar(tmpl.scale);
      this.rig.add(mesh);
      this.slots.push({ mesh, base: tmpl.mat, own: null });
      this.height = v.height;
      this.radius = v.radius;
      this.stepScale = tmpl.scale;
      this.hover = tmpl.motion === 'spin' ? 0.05 * tmpl.scale : 0;
      if (tmpl.motion === 'none') {
        mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
        this.rig.updateMatrix(); this.rig.matrixAutoUpdate = false;
      }
    } else {
      const clone = SkeletonUtils.clone(tmpl.scene);
      this.rig.add(clone);
      clone.traverse((o) => {
        if (o.isMesh) this.slots.push({ mesh: o, base: o.material, own: null });
      });
      this.height = tmpl.height;
      this.radius = tmpl.radius;
      this.stepScale = Math.max(0.3, tmpl.height / HUMANOID_TARGET_HEIGHT);
      this.hover = 0;
      if (tmpl.motion === 'mixer') {
        this.mixer = new THREE.AnimationMixer(clone);
        this.walkAction = this.mixer.clipAction(tmpl.walk).play();
        this.walkAction.time = Math.random() * tmpl.walk.duration;
        this.locomotion = tmpl.locomotion;
        if (tmpl.idle) {
          this.idleAction = this.mixer.clipAction(tmpl.idle).play();
          this.idleAction.time = Math.random() * tmpl.idle.duration;
          this.walkAction.setEffectiveWeight(0);
        }
      }
    }
  }

  _refresh() {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      let m;
      if (this.flash) m = flashMat;
      else if (this.tint !== null || this.opacity < 1) {
        if (!s.own) s.own = cloneMat(s.base);
        configureOwn(s.own, s.base, this.tint, this.opacity);
        m = s.own;
      } else m = s.base;
      if (s.mesh.material !== m) s.mesh.material = m;
    }
  }

  setFlash(on) {
    on = !!on;
    if (on === this.flash) return;
    this.flash = on;
    this._refresh();
  }

  setTint(hex) {
    if (hex === null || hex === undefined) {
      if (this.tint === null) return;
      this.tint = null;
    } else {
      _tintC.set(hex);
      if (this.tint === null) this.tint = { mul: new THREE.Color(), glow: new THREE.Color() };
      this.tint.mul.copy(WHITE).lerp(_tintC, 0.65);
      this.tint.glow.copy(_tintC).multiplyScalar(0.2);
    }
    // own materials are re-configured on refresh
    this._refresh();
    if (this.tint !== null || this.opacity < 1) {
      for (let i = 0; i < this.slots.length; i++) {
        const s = this.slots[i];
        if (s.own) configureOwn(s.own, s.base, this.tint, this.opacity);
      }
    }
  }

  setOpacity(a) {
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    if (a === this.opacity) return;
    this.opacity = a;
    this._refresh();
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.own) configureOwn(s.own, s.base, this.tint, this.opacity);
    }
  }

  update(dt, moving, speed) {
    const rig = this.rig;
    switch (this.motion) {
      case 'walk': {
        this.t += dt;
        this.amp += ((moving ? 1 : 0) - this.amp) * Math.min(1, dt * 10);
        if (moving) this.phase += dt * (5 + (speed || 0) * 1.7);
        const a = this.amp, ss = this.stepScale;
        rig.position.y = Math.abs(Math.sin(this.phase)) * 0.09 * ss * a;
        rig.rotation.z = Math.sin(this.phase) * 0.09 * a;
        rig.rotation.x = 0.07 * a;
        rig.scale.y = 1 + Math.sin(this.t * 2.3) * 0.012 * (1 - a);
        break;
      }
      case 'spin': {
        this.t += dt;
        rig.rotation.y += dt * 1.8;
        rig.position.y = 0.06 + Math.sin(this.t * 2.6 + this.phase) * this.hover;
        break;
      }
      case 'mixer': {
        if (moving !== this.moving) {
          this.moving = moving;
          if (this.idleAction) {
            this.walkAction.setEffectiveWeight(moving ? 1 : 0);
            this.idleAction.setEffectiveWeight(moving ? 0 : 1);
          }
        }
        if (this.walkAction) this.walkAction.timeScale = moving ? 1 : (this.idleAction || !this.locomotion ? 1 : 0);
        this.mixer.update(dt);
        break;
      }
      default: break;
    }
  }

  dispose() {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.own) {
        if (Array.isArray(s.own)) s.own.forEach((m) => m.dispose()); else s.own.dispose();
        s.own = null;
      }
      s.mesh.material = s.base;
    }
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
      this.mixer = null;
    }
  }
}

// ---------------------------------------------------------------------------
//  public: makeModel
// ---------------------------------------------------------------------------
export function makeModel(key) {
  let tmpl = registry.get(key);
  if (!tmpl && BUILDERS[key]) {
    // loadModels() was not told about this key but we have a builder for it: build with defaults.
    try { buildProcedural(key, {}, key, 1); tmpl = registry.get(key); } catch (e) { /* fall through */ }
  }
  if (!tmpl) {
    if (!warnedUnknown.has(key)) {
      warnedUnknown.add(key);
      console.warn(`[models] unknown model key "${key}" - using a magenta box.`);
    }
    tmpl = getUnknownTemplate();
  }
  return new ModelInstance(tmpl);
}
