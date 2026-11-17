// gl3.js — raw WebGL1 renderer: one shader, one unit cube, one ground quad.
// Per-draw color + emissive + procedural windows (lit windows glow at night).
// Everything in the city is a box, so the whole game renders through drawBox().
import { matIdentity, matMultiply, matPerspective, matLookAt } from './math3.js';

const VS = `
attribute vec3 aPos;
attribute vec3 aNor;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
varying vec3 vNor;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vLocal = aPos;
  vNor = mat3(uModel) * aNor;
  gl_Position = uProj * uView * w;
}`;

const FS = `
precision mediump float;
varying vec3 vNor;
varying vec3 vWorld;
varying vec3 vLocal;
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uNight;      // 0 = day, 1 = night
uniform float uWindows;    // 0 = none, 1 = lit-window grid on this box
uniform vec3 uCamPos;
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main() {
  vec3 n = normalize(vNor);
  float diff = max(dot(n, normalize(uSunDir)), 0.0);
  vec3 col = uColor * (uAmbient + uSunColor * diff) + uEmissive;
  // Procedural windows: only on vertical faces, grid from world coords.
  if (uWindows > 0.5 && abs(n.y) < 0.5) {
    vec2 g = abs(n.x) > 0.5 ? vWorld.zy : vWorld.xy;
    vec2 cell = vec2(floor(g.x / 3.0), floor(g.y / 3.0));
    vec2 f = fract(g / 3.0);
    float lit = step(hash21(cell + floor(vWorld.y * 0.0)), 0.55);
    float win = step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.8);
    float glow = win * lit * (0.35 + 0.65 * uNight);
    col += vec3(1.0, 0.75, 0.35) * glow * 0.9;
    col *= 1.0 - win * 0.25;
  }
  float d = distance(vWorld, uCamPos);
  float f = clamp((d - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  col = mix(col, uFogColor, f);
  gl_FragColor = vec4(col, 1.0);
}`;

// Unit cube: 24 verts (per-face normals), 36 indices.
const CUBE_POS = new Float32Array([
  // +x
  1, -1, -1, 1, -1, 1, 1, 1, 1, 1, 1, -1,
  // -x
  -1, -1, 1, -1, -1, -1, -1, 1, -1, -1, 1, 1,
  // +y
  -1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1,
  // -y
  -1, -1, 1, 1, -1, 1, 1, -1, -1, -1, -1, -1,
  // +z
  -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
  // -z
  1, -1, -1, -1, -1, -1, -1, 1, -1, 1, 1, -1,
]);
const CUBE_NOR = new Float32Array([
  1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
  -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
  0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
  0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
]);
const CUBE_IDX = new Uint16Array([
  0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11,
  12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
]);

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    this.prog = this.compile(VS, FS);
    gl.useProgram(this.prog);
    this.u = {};
    for (const name of ['uModel', 'uView', 'uProj', 'uColor', 'uEmissive', 'uSunDir', 'uSunColor',
      'uAmbient', 'uFogColor', 'uFogNear', 'uFogFar', 'uNight', 'uWindows', 'uCamPos']) {
      this.u[name] = gl.getUniformLocation(this.prog, name);
    }
    // Cube buffers.
    this.posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, CUBE_POS, gl.STATIC_DRAW);
    this.norBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.norBuf);
    gl.bufferData(gl.ARRAY_BUFFER, CUBE_NOR, gl.STATIC_DRAW);
    this.idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, CUBE_IDX, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.prog, 'aPos');
    const aNor = gl.getAttribLocation(this.prog, 'aNor');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.norBuf);
    gl.enableVertexAttribArray(aNor);
    gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, 0, 0);
    this.view = matIdentity();
    this.proj = matIdentity();
    this.camPos = [0, 0, 0];
    this.draws = 0;
  }
  compile(vsSrc, fsSrc) {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error('VS: ' + gl.getShaderInfoLog(vs));
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) throw new Error('FS: ' + gl.getShaderInfoLog(fs));
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    return p;
  }
  resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.aspect = this.canvas.width / this.canvas.height;
  }
  setCamera(eye, center, up, fovyDeg = 62) {
    this.view = matLookAt(eye, center, up);
    this.proj = matPerspective((fovyDeg * Math.PI) / 180, this.aspect, 0.5, 900);
    this.camPos = eye;
  }
  // sun: {dir:[x,y,z] (towards the sun), color:[r,g,b], ambient:[r,g,b], fog:[r,g,b], night:0..1}
  setLight(sun) {
    const gl = this.gl;
    gl.uniform3fv(this.u.uSunDir, sun.dir);
    gl.uniform3fv(this.u.uSunColor, sun.color);
    gl.uniform3fv(this.u.uAmbient, sun.ambient);
    gl.uniform3fv(this.u.uFogColor, sun.fog);
    gl.uniform1f(this.u.uFogNear, 90);
    gl.uniform1f(this.u.uFogFar, 520);
    gl.uniform1f(this.u.uNight, sun.night);
    gl.uniform3fv(this.u.uCamPos, this.camPos);
    gl.clearColor(sun.fog[0], sun.fog[1], sun.fog[2], 1);
  }
  beginFrame() {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(this.u.uView, false, this.view);
    gl.uniformMatrix4fv(this.u.uProj, false, this.proj);
    this.draws = 0;
  }
  // Draw the unit cube (from -1..1) transformed by model matrix.
  // color: [r,g,b] 0..1; opts: {emissive:[r,g,b], windows:0|1}
  box(model, color, opts = {}) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.u.uModel, false, model);
    gl.uniform3fv(this.u.uColor, color);
    gl.uniform3fv(this.u.uEmissive, opts.emissive || [0, 0, 0]);
    gl.uniform1f(this.u.uWindows, opts.windows ? 1 : 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
    this.draws++;
  }
}
