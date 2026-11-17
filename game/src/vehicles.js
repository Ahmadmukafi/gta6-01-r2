// vehicles.js — cars: arcade physics, traffic loops, police pursuit.
// Heading 0 faces +Z; x += sin(h)*speed, z += cos(h)*speed.
import { clamp, lerp, angleLerp, angleTo, mulberry32, randRange, pick, matCompose, v3dist } from './math3.js';
import { collideCircle, nearestRoadPoint, CITY } from './city.js';

export const CAR_KINDS = {
  sedan:  { max: 26, accel: 14, color: [0.55, 0.58, 0.62], len: 4.4, wid: 2.0 },
  taxi:   { max: 24, accel: 13, color: [1.0, 0.8, 0.1], len: 4.4, wid: 2.0 },
  sport:  { max: 34, accel: 20, color: [0.95, 0.2, 0.55], len: 4.2, wid: 1.9 },
  truck:  { max: 19, accel: 9,  color: [0.35, 0.45, 0.55], len: 5.6, wid: 2.2 },
  police: { max: 30, accel: 18, color: [0.08, 0.08, 0.10], len: 4.6, wid: 2.0 },
  van:    { max: 21, accel: 11, color: [0.75, 0.72, 0.65], len: 5.0, wid: 2.1 },
};

export function makeCar(kind, x, z, heading = 0) {
  const k = CAR_KINDS[kind];
  return {
    kind, x, z, heading, speed: 0,
    max: k.max, accel: k.accel, color: k.color.slice(),
    len: k.len, wid: k.wid,
    driver: 'traffic', // 'traffic' | 'police' | 'player' | 'parked'
    route: null, routeIdx: 0, stuck: 0,
    siren: 0, drift: 0, smokeT: 0,
    dead: false,
  };
}

// One arcade physics step. input: {throttle:-1..1, steer:-1..1, brake:bool}
export function stepCarPhysics(car, input, dt, city) {
  const grip = input.brake ? 2.2 : 1;
  if (input.throttle > 0) car.speed += car.accel * input.throttle * dt;
  else if (input.throttle < 0) car.speed += car.accel * input.throttle * dt * 0.8;
  // Drag + rolling resistance.
  car.speed -= car.speed * (input.brake ? 1.6 : 0.25) * dt;
  if (Math.abs(car.speed) < 0.05 && !input.throttle) car.speed = 0;
  car.speed = clamp(car.speed, -car.max * 0.45, car.max);
  const steerAuthority = clamp(Math.abs(car.speed) / 8, 0, 1) * (car.speed >= 0 ? 1 : -1);
  car.heading += input.steer * 1.9 * steerAuthority * grip * dt;
  car.drift = input.brake && Math.abs(car.speed) > 8 ? 1 : 0;
  const nx = car.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.z + Math.cos(car.heading) * car.speed * dt;
  const [cx, cz] = collideCircle(city, nx, nz, 1.6);
  if (cx !== nx || cz !== nz) car.speed *= 0.55; // bumped a wall
  car.x = cx; car.z = cz;
}

// --- Traffic ---
export class TrafficSystem {
  constructor(city, seed = 11) {
    this.city = city;
    this.rng = mulberry32(seed);
    this.cars = [];       // traffic + parked
    this.police = [];     // pursuing police cars
    this.spawnT = 0;
  }
  randomLoopRoute() {
    // Rectangle around a random block, on road centerlines.
    // Block (i,j) spans roads i*52..(i+1)*52 and j*52..(j+1)*52.
    const i = Math.floor(randRange(this.rng, -4, 4));
    const j = Math.floor(randRange(this.rng, -4, 4));
    const x0 = i * CITY.PITCH, x1 = (i + 1) * CITY.PITCH;
    const z0 = j * CITY.PITCH, z1 = (j + 1) * CITY.PITCH;
    const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    if (this.rng() < 0.5) pts.reverse();
    return pts;
  }
  spawnTraffic(n) {
    const kinds = ['sedan', 'sedan', 'taxi', 'van', 'truck', 'sport'];
    for (let k = 0; k < n; k++) {
      const route = this.randomLoopRoute();
      const [x, z] = route[0];
      const car = makeCar(pick(this.rng, kinds), x, z, 0);
      car.route = route;
      car.routeIdx = 1;
      car.speed = randRange(this.rng, 8, 13);
      this.cars.push(car);
    }
    // Parked cars (stealable) on road shoulders: garage, beach (the pink Comet GT), taxi rank.
    const spots = [
      [-72, 70, 'sedan'], [150, -26, 'sport'], [100, -20, 'taxi'],
      [26, 100, 'sedan'], [-100, -100, 'van'],
    ];
    for (const [x, z, kind] of spots) {
      const car = makeCar(kind, x, z, randRange(this.rng, 0, 6.28));
      car.driver = 'parked';
      this.cars.push(car);
    }
  }
  spawnPolice(n, nearX, nearZ) {
    for (let k = 0; k < n; k++) {
      const a = randRange(this.rng, 0, Math.PI * 2);
      const d = randRange(this.rng, 40, 70);
      const [x, z] = nearestRoadPoint(nearX + Math.sin(a) * d, nearZ + Math.cos(a) * d);
      const car = makeCar('police', x, z, 0);
      car.driver = 'police';
      car.speed = 12;
      this.police.push(car);
    }
  }
  clearPolice() { this.police = []; }
  nearestStealable(x, z, maxD = 4) {
    let best = null, bd = maxD;
    for (const c of this.cars) {
      if (c.driver === 'player') continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  // Push two cars apart (cheap circle collision).
  separateCars(list) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const A = list[a], B = list[b];
        const dx = B.x - A.x, dz = B.z - A.z;
        const d = Math.hypot(dx, dz);
        const min = 3.2;
        if (d > 0.001 && d < min) {
          const push = (min - d) / 2;
          const nx = dx / d, nz = dz / d;
          A.x -= nx * push; A.z -= nz * push;
          B.x += nx * push; B.z += nz * push;
          A.speed *= 0.9; B.speed *= 0.9;
        }
      }
    }
  }
  update(dt, ctx) {
    // ctx: {playerX, playerZ, playerCar, wanted, inCar, effects, onRam}
    const all = this.cars.concat(this.police);
    // Traffic AI: follow loop routes.
    for (const c of this.cars) {
      if (c.driver === 'player' || c.driver === 'parked') continue;
      if (!c.route) continue;
      const [tx, tz] = c.route[c.routeIdx];
      const d = Math.hypot(tx - c.x, tz - c.z);
      if (d < 4) { c.routeIdx = (c.routeIdx + 1) % c.route.length; continue; }
      const want = angleTo(c.x, c.z, tx, tz);
      let steer = clamp((want - c.heading + Math.PI * 3) % (Math.PI * 2) - Math.PI, -1, 1);
      // Slow down if a car is right ahead.
      let ahead = false;
      for (const o of all) {
        if (o === c) continue;
        const dx = o.x - c.x, dz = o.z - c.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 9 && Math.abs(Math.atan2(dx, dz) - c.heading) < 0.5) { ahead = true; break; }
      }
      const target = ahead ? 0 : 11;
      stepCarPhysics(c, { throttle: c.speed < target ? 0.7 : 0, steer, brake: ahead }, dt, this.city);
    }
    // Police AI: chase the player (in car or on foot).
    for (const p of this.police) {
      const px = ctx.playerX, pz = ctx.playerZ;
      const d = Math.hypot(px - p.x, pz - p.z);
      const want = angleTo(p.x, p.z, px, pz);
      let steer = clamp((want - p.heading + Math.PI * 3) % (Math.PI * 2) - Math.PI, -1, 1);
      const ram = d < 6;
      stepCarPhysics(p, { throttle: d > 5 ? 1 : 0.3, steer, brake: false }, dt, this.city);
      p.siren = (p.siren + dt) % 1;
      if (ram && ctx.onRam) ctx.onRam(p, dt);
      // If the player is on foot and a cop car gets close, it stops and waits (foot cops handle it).
      if (!ctx.inCar && d < 10) p.speed *= 0.9;
    }
    this.separateCars(all);
    // Player car vs traffic/pedestrians handled by main; keep traffic out of the player car.
    if (ctx.playerCar) {
      for (const o of all) {
        if (o === ctx.playerCar) continue;
        const dx = o.x - ctx.playerCar.x, dz = o.z - ctx.playerCar.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001 && d < 3.4) {
          const push = (3.4 - d) / 2;
          const nx = dx / d, nz = dz / d;
          o.x += nx * push; o.z += nz * push;
          ctx.playerCar.x -= nx * push * 0.5; ctx.playerCar.z -= nz * push * 0.5;
          o.speed *= 0.85;
        }
      }
    }
    // Drift smoke.
    for (const c of all) {
      if (c.drift && ctx.effects) {
        c.smokeT -= dt;
        if (c.smokeT <= 0) {
          c.smokeT = 0.06;
          ctx.effects.smoke(c.x - Math.sin(c.heading) * 2, 0.4, c.z - Math.cos(c.heading) * 2);
        }
      }
    }
  }
  draw(r, t, night) {
    const all = this.cars.concat(this.police);
    for (const c of all) {
      if (c.dead) continue;
      const m = matCompose(c.x, 0, c.z, c.heading);
      // Body + cabin + wheels.
      r.box(matCompose(c.x, 0.55, c.z, c.heading, 0, 0, c.wid / 2, 0.55, c.len / 2), c.color);
      r.box(matCompose(c.x - Math.sin(c.heading) * 0.2, 1.25, c.z - Math.cos(c.heading) * 0.2, c.heading, 0, 0, (c.wid - 0.4) / 2, 0.45, (c.len - 1.6) / 2), [0.08, 0.10, 0.14]);
      const wx = Math.cos(c.heading) * (c.wid / 2), wz = -Math.sin(c.heading) * (c.wid / 2);
      const fx = Math.sin(c.heading) * (c.len / 2 - 0.7), fz = Math.cos(c.heading) * (c.len / 2 - 0.7);
      for (const [ox, oz] of [[fx + wx, fz + wz], [fx - wx, fz - wz], [-fx + wx, -fz + wz], [-fx - wx, -fz - wz]]) {
        r.box(matCompose(c.x + ox, 0.35, c.z + oz, c.heading, 0, 0, 0.18, 0.35, 0.4), [0.05, 0.05, 0.05]);
      }
      // Headlights (emissive at night) + taillights.
      const hx = Math.sin(c.heading) * (c.len / 2), hz = Math.cos(c.heading) * (c.len / 2);
      r.box(matCompose(c.x + hx + wx * 0.6, 0.6, c.z + hz + wz * 0.6, c.heading, 0, 0, 0.22, 0.14, 0.1),
        [1, 1, 0.85], { emissive: night > 0.4 ? [0.9, 0.9, 0.6] : [0.15, 0.15, 0.1] });
      r.box(matCompose(c.x + hx - wx * 0.6, 0.6, c.z + hz - wz * 0.6, c.heading, 0, 0, 0.22, 0.14, 0.1),
        [1, 1, 0.85], { emissive: night > 0.4 ? [0.9, 0.9, 0.6] : [0.15, 0.15, 0.1] });
      r.box(matCompose(c.x - hx, 0.65, c.z - hz, c.heading, 0, 0, 0.8, 0.14, 0.1),
        [0.9, 0.1, 0.1], { emissive: [0.5, 0.03, 0.03] });
      if (c.kind === 'taxi') {
        r.box(matCompose(c.x, 1.75, c.z, c.heading, 0, 0, 0.5, 0.18, 0.3), [1, 0.85, 0.1], { emissive: [0.7, 0.55, 0.05] });
      }
      if (c.kind === 'police') {
        const phase = c.siren < 0.5;
        r.box(matCompose(c.x, 1.78, c.z, c.heading, 0, 0, 0.7, 0.16, 0.35),
          phase ? [1, 0.1, 0.1] : [0.1, 0.2, 1], { emissive: phase ? [1, 0.05, 0.05] : [0.05, 0.1, 1] });
        r.box(matCompose(c.x, 0.9, c.z, c.heading, 0, 0, c.wid / 2 + 0.05, 0.3, 0.12), [0.9, 0.9, 0.9]);
      }
    }
  }
}
