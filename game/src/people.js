// people.js — pedestrians on the sidewalks, fleeing crowds, and foot police.
// Peds walk road-adjacent sidewalks, turn at intersections, and run from danger.
// Foot cops chase the player on foot when wanted; they punch at close range.
import { clamp, angleTo, mulberry32, randRange, pick, matCompose } from './math3.js';
import { collideCircle, nearestRoadPoint, CITY } from './city.js';

const SKINS = [
  [0.85, 0.65, 0.5], [0.65, 0.45, 0.32], [0.9, 0.75, 0.6], [0.5, 0.35, 0.25],
];
const SHIRTS = [
  [0.85, 0.2, 0.25], [0.2, 0.45, 0.85], [0.95, 0.85, 0.3], [0.3, 0.75, 0.35],
  [0.9, 0.9, 0.9], [0.6, 0.3, 0.7], [0.95, 0.5, 0.15], [0.25, 0.7, 0.7],
];

function makePed(rng, x, z) {
  return {
    x, z, heading: randRange(rng, 0, Math.PI * 2),
    speed: randRange(rng, 1.2, 2.0),
    skin: pick(rng, SKINS), shirt: pick(rng, SHIRTS),
    pants: pick(rng, [[0.15, 0.18, 0.3], [0.3, 0.3, 0.32], [0.5, 0.42, 0.3]]),
    state: 'walk',       // walk | flee | down | taxi (hailing)
    target: null,        // [x,z] walk target
    fleeT: 0, downT: 0, bob: randRange(rng, 0, 6),
    taxi: false,         // hailing a cab
  };
}

export class PedSystem {
  constructor(city, seed = 23) {
    this.city = city;
    this.rng = mulberry32(seed);
    this.peds = [];
    this.cops = [];      // foot police {x,z,heading,speed}
    this.spawnT = 0;
  }
  spawnPeds(n) {
    // Peds walk on sidewalks: pick a road, walk along it offset to one side.
    for (let k = 0; k < n; k++) {
      const road = Math.floor(randRange(this.rng, -4, 5)) * CITY.PITCH;
      const along = randRange(this.rng, -200, 200);
      const off = (this.rng() < 0.5 ? 1 : -1) * 9;
      const vertical = this.rng() < 0.5;
      const x = vertical ? road + off : along;
      const z = vertical ? along : road + off;
      this.peds.push(makePed(this.rng, x, z));
    }
    // One taxi-hailing ped on the beach boulevard.
    const t = makePed(this.rng, 150, 26);
    t.taxi = true; t.state = 'taxi';
    this.peds.push(t);
  }
  spawnFootCops(n, nearX, nearZ) {
    for (let k = 0; k < n; k++) {
      const a = randRange(this.rng, 0, Math.PI * 2);
      const d = randRange(this.rng, 12, 25);
      const [x, z] = nearestRoadPoint(nearX + Math.sin(a) * d, nearZ + Math.cos(a) * d);
      this.cops.push({ x, z, heading: 0, speed: 3.4, punchT: 0 });
    }
  }
  clearCops() { this.cops = []; }
  // A crime at (x,z): nearby peds flee, return count that saw it.
  scare(x, z, radius = 30) {
    let saw = 0;
    for (const p of this.peds) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < radius && p.state !== 'down') {
        p.state = 'flee'; p.fleeT = 6; saw++;
      }
    }
    return saw;
  }
  nearestPed(x, z, maxD = 3) {
    let best = null, bd = maxD;
    for (const p of this.peds) {
      if (p.state === 'down') continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  update(dt, ctx) {
    // ctx: {playerX, playerZ, playerCar, inCar, wanted, onPedHit}
    for (const p of this.peds) {
      p.bob += dt * 6;
      if (p.state === 'down') {
        p.downT -= dt;
        if (p.downT <= 0) { p.state = 'walk'; p.target = null; }
        continue;
      }
      if (p.state === 'taxi') continue; // stands and waves
      if (p.state === 'flee') {
        p.fleeT -= dt;
        if (p.fleeT <= 0) { p.state = 'walk'; p.target = null; continue; }
        const a = angleTo(ctx.playerX, ctx.playerZ, p.x, p.z);
        p.heading = a;
        const nx = p.x + Math.sin(a) * 4.2 * dt;
        const nz = p.z + Math.cos(a) * 4.2 * dt;
        const [cx, cz] = collideCircle(this.city, nx, nz, 0.5);
        p.x = cx; p.z = cz;
        continue;
      }
      // Walk: pick a sidewalk target, stroll to it.
      if (!p.target || Math.hypot(p.target[0] - p.x, p.target[1] - p.z) < 2) {
        const [rx, rz] = nearestRoadPoint(p.x, p.z);
        const along = this.rng() < 0.5;
        const dir = this.rng() < 0.5 ? 1 : -1;
        const off = (this.rng() < 0.5 ? 1 : -1) * 9;
        p.target = along
          ? [rx + off, rz + dir * randRange(this.rng, 20, 48)]
          : [rx + dir * randRange(this.rng, 20, 48), rz + off];
      }
      const a = angleTo(p.x, p.z, p.target[0], p.target[1]);
      p.heading = a;
      const nx = p.x + Math.sin(a) * p.speed * dt;
      const nz = p.z + Math.cos(a) * p.speed * dt;
      const [cx, cz] = collideCircle(this.city, nx, nz, 0.5);
      p.x = cx; p.z = cz;
      // Player car running over a ped knocks them down (a crime).
      if (ctx.playerCar && Math.abs(ctx.playerCar.speed) > 3) {
        const d = Math.hypot(p.x - ctx.playerCar.x, p.z - ctx.playerCar.z);
        if (d < 2.2) {
          p.state = 'down'; p.downT = 8;
          if (ctx.onPedHit) ctx.onPedHit(p);
        }
      }
    }
    // Foot cops chase the player on foot.
    for (const c of this.cops) {
      const d = Math.hypot(ctx.playerX - c.x, ctx.playerZ - c.z);
      if (ctx.inCar) {
        // Cops give up when the player drives away.
        if (d > 60) { c.gone = true; continue; }
      }
      const a = angleTo(c.x, c.z, ctx.playerX, ctx.playerZ);
      c.heading = a;
      if (d > 1.6) {
        const nx = c.x + Math.sin(a) * c.speed * dt;
        const nz = c.z + Math.cos(a) * c.speed * dt;
        const [cx, cz] = collideCircle(this.city, nx, nz, 0.5);
        c.x = cx; c.z = cz;
      }
      c.punchT -= dt;
      if (d < 2.0 && c.punchT <= 0) {
        c.punchT = 1.1;
        if (ctx.onCopPunch) ctx.onCopPunch(c);
      }
    }
    this.cops = this.cops.filter((c) => !c.gone);
  }
  draw(r, t) {
    const drawPerson = (x, z, heading, skin, shirt, pants, down, bob, isCop) => {
      const lean = down ? Math.PI / 2 - 0.1 : 0;
      const bobY = down ? 0.3 : Math.abs(Math.sin(bob)) * 0.06;
      // Legs.
      r.box(matCompose(x, 0.45 + bobY, z, heading, lean, 0, 0.16, 0.45, 0.16), pants);
      // Torso.
      r.box(matCompose(x, 1.15 + bobY, z, heading, lean, 0, 0.26, 0.4, 0.2), isCop ? [0.08, 0.12, 0.25] : shirt);
      // Head.
      r.box(matCompose(x, 1.72 + bobY, z, heading, lean, 0, 0.17, 0.17, 0.17), skin);
      if (isCop) {
        r.box(matCompose(x, 1.9 + bobY, z, heading, lean, 0, 0.19, 0.08, 0.19), [0.05, 0.08, 0.18]);
      }
    };
    for (const p of this.peds) {
      drawPerson(p.x, p.z, p.heading, p.skin, p.shirt, p.pants, p.state === 'down', p.bob, false);
      if (p.taxi) {
        // Waving arm: small raised box.
        r.box(matCompose(p.x + Math.sin(p.heading) * 0.3, 1.9 + Math.sin(t * 6) * 0.15, p.z + Math.cos(p.heading) * 0.3, p.heading, 0, 0, 0.09, 0.35, 0.09), p.skin);
      }
    }
    for (const c of this.cops) drawPerson(c.x, c.z, c.heading, [0.85, 0.65, 0.5], [0.1, 0.15, 0.3], [0.1, 0.12, 0.25], false, t * 6, true);
  }
}
