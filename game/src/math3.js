// math3.js — tiny 3D math helpers: vectors, 4x4 matrices, seeded RNG.
// No dependencies. All matrices are column-major Float32Array(16), like WebGL wants.
export const TAU = Math.PI * 2;

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function deg(d) { return (d * Math.PI) / 180; }

// mulberry32: small deterministic RNG so city layout and traffic spawns are stable.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function randRange(rng, a, b) { return a + rng() * (b - a); }
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

// --- vec3 (plain [x, y, z] arrays) ---
export function v3(x = 0, y = 0, z = 0) { return [x, y, z]; }
export function v3add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function v3scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function v3len(a) { return Math.hypot(a[0], a[1], a[2]); }
export function v3norm(a) { const l = v3len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
export function v3dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
export function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

// --- mat4 (column-major) ---
export function matIdentity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
export function matMultiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
export function matTranslate(x, y, z) {
  const m = matIdentity(); m[12] = x; m[13] = y; m[14] = z; return m;
}
export function matScale(x, y, z) {
  const m = matIdentity(); m[0] = x; m[5] = y; m[10] = z; return m;
}
export function matRotateY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}
export function matRotateX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}
export function matRotateZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
// Compose translation * rotY * rotX * rotZ * scale in one call.
export function matCompose(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  let m = matScale(sx, sy, sz);
  if (rz) m = matMultiply(matRotateZ(rz), m);
  if (rx) m = matMultiply(matRotateX(rx), m);
  if (ry) m = matMultiply(matRotateY(ry), m);
  m = matMultiply(matTranslate(x, y, z), m);
  return m;
}
export function matPerspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far);
  m[11] = -1; m[14] = (2 * far * near) / (near - far);
  return m;
}
export function matLookAt(eye, center, up) {
  const z = v3norm(v3sub(eye, center));
  const x = v3norm([up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const m = new Float32Array(16);
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0]; m[3] = 0;
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1]; m[7] = 0;
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2]; m[11] = 0;
  m[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  m[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  m[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  m[15] = 1;
  return m;
}
export function matTransformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}
// Angle from a to b in the XZ plane, for facing math.
export function angleTo(ax, az, bx, bz) { return Math.atan2(bx - ax, bz - az); }
export function angleLerp(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}
