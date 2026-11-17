// city.js — Neon Shore: a 9x9-block coastal city.
// Grid pitch 52, road width 14. Districts: downtown (tall, neon), midtown,
// beach + pier + ferris wheel (east), park (southwest), marina (south).
// Everything is boxes; buildings get procedural lit windows from the shader.
import { mulberry32, randRange, pick, clamp, matCompose } from './math3.js';

export const CITY = {
  PITCH: 52,
  ROAD_W: 14,
  GRID: 9,          // blocks per side, indices -4..4
  HALF: 234,        // city extent in x/z
  BEACH_X: 182,     // sand starts here
  WATER_X: 212,     // water starts here
  WATER_Z: 212,     // south water starts here
};

const PALETTE = {
  downtown: [[0.32, 0.34, 0.42], [0.42, 0.36, 0.34], [0.28, 0.32, 0.40], [0.45, 0.40, 0.36], [0.36, 0.42, 0.44]],
  midtown: [[0.55, 0.48, 0.42], [0.48, 0.52, 0.50], [0.60, 0.55, 0.45], [0.45, 0.45, 0.55], [0.52, 0.42, 0.38]],
  beach: [[0.85, 0.75, 0.60], [0.90, 0.82, 0.68], [0.75, 0.70, 0.62], [0.95, 0.85, 0.70]],
};
const NEON = [
  [1.0, 0.15, 0.55], // hot pink
  [0.1, 0.9, 1.0],   // cyan
  [1.0, 0.75, 0.1],  // gold
  [0.2, 1.0, 0.45],  // green
  [0.65, 0.3, 1.0],  // violet
];

export function buildCity(seed = 7) {
  const rng = mulberry32(seed);
  const city = {
    buildings: [],   // {x,z,w,d,h,c,windows}
    colliders: [],   // {minX,maxX,minZ,maxZ}
    lamps: [],       // {x,z}
    palms: [],       // {x,z,s}
    trees: [],       // {x,z,s}
    signs: [],       // {x,y,z,ry,w,h,c} neon bars on facades
    benches: [],
    boats: [],       // {x,z,ry,c}
    wheel: { x: 238, z: 0, r: 16, angle: 0 },
    pier: { x0: 196, x1: 244, z: -6, z2: 6 },
    garage: { x: -78, z: 78 },   // Mara's garage / safehouse block
    hospital: { x: -26, z: -78 },
    bank: { x: 26, z: 26 },
    gunshop: { x: 78, z: -26 },
    marina: { x: 0, z: 208 },
    park: { x: -182, z: 182 },
  };
  const addBuilding = (x, z, w, d, h, c, windows = true) => {
    city.buildings.push({ x, z, w, d, h, c, windows });
    city.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  };

  // Blocks sit BETWEEN roads: block centers at (k+0.5)*52, roads at k*52.
  for (let bi = -4; bi <= 3; bi++) {
    for (let bj = -4; bj <= 3; bj++) {
      const bx = (bi + 0.5) * CITY.PITCH, bz = (bj + 0.5) * CITY.PITCH;
      const isBeach = bi >= 3;
      const isPark = bi <= -3 && bj >= 2;
      const isMarina = bj === 3 && bi >= -2 && bi <= 0;
      const isDowntown = Math.abs(bx) <= 26 && Math.abs(bz) <= 26;
      if (isPark) {
        // Park: grass block, trees, pond, benches.
        for (let t = 0; t < 7; t++) {
          city.trees.push({ x: bx + randRange(rng, -16, 16), z: bz + randRange(rng, -16, 16), s: randRange(rng, 0.8, 1.4) });
        }
        city.benches.push({ x: bx - 8, z: bz + 6 }, { x: bx + 10, z: bz - 8 });
        continue;
      }
      if (isMarina) continue; // docks + water, no buildings
      if (isBeach) {
        // Low beachfront hotels / huts.
        const n = 1 + Math.floor(rng() * 2);
        for (let k = 0; k < n; k++) {
          addBuilding(bx + randRange(rng, -8, 8), bz + randRange(rng, -8, 8),
            randRange(rng, 12, 20), randRange(rng, 10, 16), randRange(rng, 8, 18),
            pick(rng, PALETTE.beach), true);
        }
        continue;
      }
      if (isDowntown) {
        // One tall tower per block, sometimes a twin.
        const h = randRange(rng, 42, 88);
        addBuilding(bx, bz, randRange(rng, 22, 28), randRange(rng, 22, 28), h, pick(rng, PALETTE.downtown), true);
        if (rng() < 0.5) {
          addBuilding(bx + randRange(rng, -14, 14), bz + randRange(rng, -14, 14),
            randRange(rng, 10, 14), randRange(rng, 10, 14), randRange(rng, 14, 30), pick(rng, PALETTE.downtown), true);
        }
        // Neon sign bar on a random facade.
        if (rng() < 0.8) {
          const c = pick(rng, NEON);
          const side = Math.floor(rng() * 4);
          const off = 15;
          let sx = bx, sz = bz, ry = 0;
          if (side === 0) { sz = bz - off; ry = 0; }
          if (side === 1) { sz = bz + off; ry = 0; }
          if (side === 2) { sx = bx - off; ry = Math.PI / 2; }
          if (side === 3) { sx = bx + off; ry = Math.PI / 2; }
          city.signs.push({ x: sx, y: randRange(rng, 10, 26), z: sz, ry, w: randRange(rng, 8, 16), h: 1.6, c });
        }
        continue;
      }
      // Midtown: 1-3 mid-rise buildings.
      const n = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        addBuilding(bx + randRange(rng, -9, 9), bz + randRange(rng, -9, 9),
          randRange(rng, 12, 20), randRange(rng, 12, 20), randRange(rng, 10, 34),
          pick(rng, PALETTE.midtown), rng() < 0.85);
      }
    }
  }
  // Landmark buildings (named, mission-relevant).
  addBuilding(city.garage.x, city.garage.z, 26, 18, 12, [0.55, 0.45, 0.25], false); // garage
  city.signs.push({ x: city.garage.x, y: 9, z: city.garage.z - 9.4, ry: 0, w: 18, h: 2.2, c: [1.0, 0.75, 0.1] }); // gold GARAGE sign
  addBuilding(city.hospital.x, city.hospital.z, 24, 16, 20, [0.85, 0.88, 0.90], true);
  addBuilding(city.bank.x, city.bank.z, 24, 20, 46, [0.38, 0.40, 0.48], true);
  city.signs.push({ x: city.bank.x, y: 30, z: city.bank.z - 10.4, ry: 0, w: 16, h: 2.4, c: [0.1, 0.9, 1.0] });
  addBuilding(city.gunshop.x, city.gunshop.z, 16, 12, 9, [0.40, 0.35, 0.30], false);
  // Street lamps along every road, palms along the beach boulevard.
  for (let i = -4; i <= 4; i++) {
    for (let j = -4; j <= 4; j++) {
      if ((i + j) % 2 === 0) city.lamps.push({ x: i * CITY.PITCH + 9, z: j * CITY.PITCH + 9 });
    }
  }
  for (let j = -4; j <= 4; j++) {
    city.palms.push({ x: 170, z: j * CITY.PITCH, s: 1 });
    city.palms.push({ x: 186, z: j * CITY.PITCH + 26, s: 0.9 });
  }
  for (let t = 0; t < 10; t++) city.trees.push({ x: randRange(rng, -200, 160), z: randRange(rng, 150, 200), s: randRange(rng, 0.8, 1.3) });
  // Marina boats.
  for (let b = 0; b < 6; b++) {
    city.boats.push({ x: -60 + b * 24, z: 218, ry: (rng() - 0.5) * 0.4, c: pick(rng, [[0.9, 0.9, 0.9], [0.2, 0.4, 0.8], [0.8, 0.3, 0.2]]) });
  }
  return city;
}

// Resolve a circle (x,z,r) against building colliders + world bounds. Returns corrected [x,z].
export function collideCircle(city, x, z, r) {
  for (const c of city.colliders) {
    const nx = clamp(x, c.minX - r, c.maxX + r);
    const nz = clamp(z, c.minZ - r, c.maxZ + r);
    const dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      x = nx + (dx / d) * r;
      z = nz + (dz / d) * r;
    } else if (d2 <= 0.0001) {
      // Inside the box: push out along the smallest penetration axis.
      const pl = x - (c.minX - r), pr = (c.maxX + r) - x;
      const pt = z - (c.minZ - r), pb = (c.maxZ + r) - z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) x = c.minX - r; else if (m === pr) x = c.maxX + r;
      else if (m === pt) z = c.minZ - r; else z = c.maxZ + r;
    }
  }
  // World bounds: water blocks except on the pier walkway.
  const onPier = x > 190 && Math.abs(z) < 7;
  if (!onPier) {
    x = clamp(x, -CITY.HALF, CITY.WATER_X - 4);
    z = clamp(z, -CITY.HALF, CITY.WATER_Z - 4);
  } else {
    x = clamp(x, -CITY.HALF, 246);
    z = clamp(z, -7, 7);
  }
  return [x, z];
}

export function nearestRoadPoint(x, z) {
  const rx = Math.round(x / CITY.PITCH) * CITY.PITCH;
  const rz = Math.round(z / CITY.PITCH) * CITY.PITCH;
  // Snap to the nearer of the two crossing roads.
  const dx = Math.abs(x - rx), dz = Math.abs(z - rz);
  if (dx < dz) return [rx, z];
  return [x, rz];
}
export function onRoad(x, z) {
  const rx = Math.round(x / CITY.PITCH) * CITY.PITCH;
  const rz = Math.round(z / CITY.PITCH) * CITY.PITCH;
  return Math.abs(x - rx) < CITY.ROAD_W / 2 + 1 || Math.abs(z - rz) < CITY.ROAD_W / 2 + 1;
}

// ---- Drawing (all boxes through the shared Renderer) ----
export function drawCity(r, city, t) {
  const B = (x, y, z, sx, sy, sz, c, o) => r.box(matCompose(x, y, z, 0, 0, 0, sx, sy, sz), c, o);
  // Ground: sidewalk grey slab, roads darker, park grass, sand, water.
  B(0, -0.55, 0, 480, 0.5, 480, [0.30, 0.30, 0.33]);
  for (let i = -4; i <= 4; i++) {
    B(i * CITY.PITCH, 0.02, 0, 7, 0.06, 480, [0.20, 0.20, 0.22]);
    B(0, 0.02, i * CITY.PITCH, 480, 0.06, 7, [0.20, 0.20, 0.22]);
  }
  // Park grass (southwest blocks).
  B(-182, 0.05, 182, 52, 0.08, 52, [0.15, 0.34, 0.15]);
  B(-130, 0.05, 182, 52, 0.08, 52, [0.15, 0.34, 0.15]);
  B(-182, 0.05, 130, 52, 0.08, 52, [0.17, 0.36, 0.17]);
  B(-130, 0.05, 130, 52, 0.08, 52, [0.17, 0.36, 0.17]);
  // Beach sand + water.
  B(206, 0.05, 0, 5.5, 0.08, 480, [0.85, 0.76, 0.55]);
  B(266, -0.3, 0, 54, 0.5, 480, [0.05, 0.25, 0.45], { emissive: [0.01, 0.05, 0.10] });
  B(0, -0.3, 266, 480, 0.5, 54, [0.05, 0.25, 0.45], { emissive: [0.01, 0.05, 0.10] });
  // Pier deck + posts.
  B(222, 0.6, 0, 22, 0.4, 6, [0.45, 0.32, 0.18]);
  for (let px = 202; px <= 242; px += 14) {
    B(px, -0.5, -5, 0.8, 2, 0.8, [0.35, 0.25, 0.14]);
    B(px, -0.5, 5, 0.8, 2, 0.8, [0.35, 0.25, 0.14]);
  }
  // Buildings.
  for (const b of city.buildings) {
    B(b.x, b.h / 2, b.z, b.w / 2, b.h / 2, b.d / 2, b.c, { windows: b.windows });
    // Rooftop rim for tall towers.
    if (b.h > 40) B(b.x, b.h + 0.4, b.z, b.w / 2 + 0.4, 0.4, b.d / 2 + 0.4, [0.18, 0.18, 0.22]);
  }
  // Neon signs (emissive bars on facades).
  for (const s of city.signs) {
    r.box(matCompose(s.x, s.y, s.z, s.ry, 0, 0, s.w / 2, s.h / 2, 0.25), s.c,
      { emissive: [s.c[0] * 0.9, s.c[1] * 0.9, s.c[2] * 0.9] });
  }
  // Lamps.
  for (const l of city.lamps) {
    B(l.x, 3, l.z, 0.15, 3, 0.15, [0.25, 0.25, 0.28]);
    B(l.x, 6.1, l.z, 0.7, 0.25, 0.25, [1.0, 0.9, 0.6], { emissive: [0.9, 0.8, 0.45] });
  }
  // Palms along the beach boulevard.
  for (const p of city.palms) {
    B(p.x, 3 * p.s, p.z, 0.25, 3 * p.s, 0.25, [0.45, 0.32, 0.18]);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      r.box(matCompose(p.x + Math.cos(a) * 1.4 * p.s, 6.2 * p.s, p.z + Math.sin(a) * 1.4 * p.s,
        0, a, 0.5, 1.6 * p.s, 0.12, 0.5 * p.s), [0.12, 0.45, 0.15]);
    }
  }
  // Park trees + benches.
  for (const tr of city.trees) {
    B(tr.x, 1.2 * tr.s, tr.z, 0.25, 1.2 * tr.s, 0.25, [0.4, 0.28, 0.15]);
    B(tr.x, 3.2 * tr.s, tr.z, 1.8 * tr.s, 1.6 * tr.s, 1.8 * tr.s, [0.12, 0.42, 0.14]);
  }
  for (const bn of city.benches) B(bn.x, 0.5, bn.z, 1.2, 0.5, 0.5, [0.5, 0.38, 0.22]);
  // Marina boats.
  for (const bo of city.boats) {
    r.box(matCompose(bo.x, 0.6, bo.z, bo.ry, 0, 0, 3.5, 0.7, 1.2), bo.c);
    r.box(matCompose(bo.x, 1.8, bo.z, bo.ry, 0, 0, 1.6, 0.6, 1.0), [0.9, 0.92, 0.95]);
  }
  // Ferris wheel at the pier end, slowly turning.
  const w = city.wheel;
  const wa = t * 0.12;
  B(w.x, 17, w.z, 1, 17, 1, [0.7, 0.7, 0.75]);
  r.box(matCompose(w.x - 6, 8.5, w.z, 0, 0, 0.6, 0.5, 9, 0.5), [0.7, 0.7, 0.75]);
  r.box(matCompose(w.x + 6, 8.5, w.z, 0, 0, -0.6, 0.5, 9, 0.5), [0.7, 0.7, 0.75]);
  for (let k = 0; k < 16; k++) {
    const a = wa + (k / 16) * Math.PI * 2;
    const px = w.x + Math.cos(a) * w.r, py = 17 + Math.sin(a) * w.r;
    r.box(matCompose(px, py, w.z, 0, 0, a + Math.PI / 2, 3.2, 0.3, 0.3),
      [0.95, 0.4, 0.6], { emissive: [0.5, 0.12, 0.2] });
    if (k % 2 === 0) {
      r.box(matCompose(px, py - 1.2, w.z, 0, 0, 0, 0.9, 0.9, 0.9), [0.95, 0.8, 0.3],
        { emissive: [0.5, 0.4, 0.05] });
    }
    if (k % 4 === 0) {
      r.box(matCompose(w.x + Math.cos(a) * w.r / 2, 17 + Math.sin(a) * w.r / 2, w.z, 0, 0, a + Math.PI / 2, w.r / 2, 0.18, 0.18), [0.8, 0.8, 0.85]);
    }
  }
}
