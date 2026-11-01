// ============================================================================
//  util.js — small shared helpers: math, hashing, instanced-mesh writers.
//  No game content in here.
// ============================================================================
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Shortest signed angle from `a` to `b`. */
export function angDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

/** Deterministic 32-bit hash of an integer cell + seed. */
export function hash2(x, z, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Small seeded PRNG (mulberry32). Returns a function giving [0,1). */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * InstancedMesh with a dynamic matrix buffer (and optional per-instance colour).
 * Starts hidden with count 0; call flush() after writing instances each frame.
 */
export function makeInstanced(geometry, material, cap, withColor) {
  const m = new THREE.InstancedMesh(geometry, material, cap);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (withColor) {
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  m.frustumCulled = false;
  m.count = 0;
  m.visible = false;
  return m;
}

/** Write instance `i`: translation + yaw (rotation about Y) + non-uniform scale. No allocation. */
export function setYawMatrix(mesh, i, x, y, z, yaw, sx, sy, sz) {
  const a = mesh.instanceMatrix.array;
  const o = i * 16;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  a[o] = c * sx; a[o + 1] = 0; a[o + 2] = -s * sx; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = s * sz; a[o + 9] = 0; a[o + 10] = c * sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}

/** Write instance `i` as a segment box from (ax,ay,az) to (bx,by,bz): z-axis along the segment. */
export function setSegmentMatrix(mesh, i, ax, ay, az, bx, by, bz, thick) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
  const zx = dx / len, zy = dy / len, zz = dz / len;
  let h = Math.sqrt(zx * zx + zz * zz);
  if (h < 1e-4) h = 1e-4;
  const xx = zz / h, xz = -zx / h;
  const yx = (-zx * zy) / h, yy = h, yz = (-zy * zz) / h;
  const a = mesh.instanceMatrix.array;
  const o = i * 16;
  a[o] = xx * thick; a[o + 1] = 0; a[o + 2] = xz * thick; a[o + 3] = 0;
  a[o + 4] = yx * thick; a[o + 5] = yy * thick; a[o + 6] = yz * thick; a[o + 7] = 0;
  a[o + 8] = zx * len; a[o + 9] = zy * len; a[o + 10] = zz * len; a[o + 11] = 0;
  a[o + 12] = (ax + bx) * 0.5; a[o + 13] = (ay + by) * 0.5; a[o + 14] = (az + bz) * 0.5; a[o + 15] = 1;
}

export function setInstColor(mesh, i, r, g, b) {
  const a = mesh.instanceColor.array;
  a[i * 3] = r; a[i * 3 + 1] = g; a[i * 3 + 2] = b;
}

/** Finish a frame of instance writes: set the visible count and mark buffers dirty. */
export function flushInstanced(mesh, n) {
  mesh.count = n;
  mesh.visible = n > 0;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** 'rgba(r,g,b,a)' CSS string from a hex colour (sRGB). */
export function rgba(hex, a) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

/** Mix two hex colours (sRGB) -> '#rrggbb'. t=0 gives a, t=1 gives b. */
export function mixHex(a, b, t) {
  const pa = parseInt(String(a).replace('#', ''), 16), pb = parseInt(String(b).replace('#', ''), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}
