// effects.js — particles (smoke, sparks, muzzle flash), screen shake,
// and the day/night cycle that drives the sky, sun and neon glow.
import { matCompose } from './math3.js';

export class Particles {
  constructor() {
    this.list = [];
  }
  spawn(x, y, z, vx, vy, vz, life, color, size) {
    if (this.list.length > 220) this.list.shift();
    this.list.push({ x, y, z, vx, vy, vz, life, maxLife: life, color, size });
  }
  smoke(x, y, z) {
    this.spawn(x, y, z, (Math.random() - 0.5) * 1.5, 1.2 + Math.random(), (Math.random() - 0.5) * 1.5,
      0.9, [0.55, 0.55, 0.58], 0.5);
  }
  sparks(x, y, z, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn(x, y, z, Math.cos(a) * (4 + Math.random() * 6), 2 + Math.random() * 4, Math.sin(a) * (4 + Math.random() * 6),
        0.5, [1.0, 0.75, 0.2], 0.18);
    }
  }
  muzzle(x, y, z) {
    this.spawn(x, y, z, 0, 0, 0, 0.08, [1.0, 0.9, 0.4], 0.5);
  }
  update(dt) {
    for (const p of this.list) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vy -= 2.5 * dt; // sparks fall, smoke rises slowly (vy starts positive)
      if (p.color[0] > 0.6 && p.color[1] > 0.6) p.vy = Math.abs(p.vy) * 0.5 + 0.6; // smoke drifts up
    }
    this.list = this.list.filter((p) => p.life > 0 && p.y > 0);
  }
  draw(r) {
    for (const p of this.list) {
      const s = p.size * (0.5 + (p.life / p.maxLife));
      const fade = p.life / p.maxLife;
      r.box(matCompose(p.x, p.y, p.z, 0, 0, 0, s, s, s),
        p.color, { emissive: [p.color[0] * fade * 0.4, p.color[1] * fade * 0.4, p.color[2] * fade * 0.4] });
    }
  }
}

export class ScreenShake {
  constructor() { this.t = 0; this.mag = 0; }
  add(mag) { this.t = 0.4; this.mag = Math.max(this.mag, mag); }
  offset(dt) {
    if (this.t <= 0) return [0, 0];
    this.t -= dt;
    const m = this.mag * (this.t / 0.4);
    return [(Math.random() - 0.5) * m, (Math.random() - 0.5) * m];
  }
}

// Day/night: time in hours (0..24). Sun elevation drives sky color, sun color,
// ambient light and how much the city glows. Golden hour ~17.5-19, night 20-5.
export function sunFor(timeHours) {
  const t = ((timeHours % 24) + 24) % 24;
  // Sun elevation: 0 at 6h and 18h, 1 at noon.
  const elev = Math.sin(((t - 6) / 12) * Math.PI);
  const night = t >= 20 || t < 5 ? 1 : t >= 18.5 ? (t - 18.5) / 1.5 : t >= 5 && t < 6.5 ? 1 - (t - 5) / 1.5 : 0;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const n = clamp01(night);
  const golden = clamp01(1 - Math.abs(t - 18) / 1.5) * (elev > -0.1 ? 1 : 0);
  // Sky / fog color: day blue -> golden orange -> night deep blue.
  const day = [0.45, 0.68, 0.92];
  const dusk = [0.98, 0.55, 0.25];
  const dark = [0.03, 0.05, 0.12];
  const fog = [
    day[0] * (1 - n) * (1 - golden) + dusk[0] * golden + dark[0] * n,
    day[1] * (1 - n) * (1 - golden) + dusk[1] * golden + dark[1] * n,
    day[2] * (1 - n) * (1 - golden) + dusk[2] * golden + dark[2] * n,
  ];
  const sunColor = [
    1.0 * (1 - n) + 0.1 * n,
    (0.85 - golden * 0.25) * (1 - n) + 0.12 * n,
    (0.7 - golden * 0.4) * (1 - n) + 0.25 * n,
  ];
  const ambient = [
    0.62 * (1 - n) + 0.22 * n,
    0.62 * (1 - n) + 0.24 * n,
    0.68 * (1 - n) + 0.34 * n,
  ];
  // Sun direction: east at dawn, overhead at noon, west at dusk; moon at night.
  const ang = ((t - 6) / 12) * Math.PI;
  const dir = elev >= 0
    ? [Math.cos(ang), Math.max(0.15, Math.sin(ang)), 0.35]
    : [Math.cos(ang), 0.5, -0.3]; // moonlight
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  return {
    dir: [dir[0] / len, dir[1] / len, dir[2] / len],
    color: sunColor, ambient, fog, night: n, golden,
  };
}
