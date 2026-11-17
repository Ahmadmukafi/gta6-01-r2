// missions.js — story missions, taxi fares, golden-palm collectibles.
// A mission is a list of stages; each stage is a place to reach (or a hold / a drive).
// Dialogue lines queue up and the HUD shows them one at a time.
import { mulberry32, randRange, matCompose } from './math3.js';
import { CITY } from './city.js';

export const MISSIONS = [
  {
    name: 'First Job', giver: 'Mara Voss',
    intro: [
      ['Mara Voss', 'Jax! You finally showed up. Neon Shore eats slow drivers alive.'],
      ['Mara Voss', 'I need a package from the pier. Take my car, bring it back to the garage. No cops, no drama.'],
    ],
    stages: [
      { text: 'Meet Mara at the garage', pos: [-78, 78], r: 5 },
      { text: 'Drive to the pier pickup', pos: [210, 0], r: 6 },
      { text: 'Bring the package back to the garage', pos: [-78, 78], r: 5 },
    ],
    reward: 150,
  },
  {
    name: 'Hot Wheels', giver: 'Mara Voss',
    intro: [
      ['Mara Voss', 'A Comet GT is parked on the beach boulevard. Pink. Loud. Stolen by lunchtime, ideally.'],
      ['Mara Voss', 'Take it, lose the cops if they spot you, and bring it to the garage.'],
    ],
    stages: [
      { text: 'Steal the pink Comet GT on the beach', pos: [150, -26], r: 6, needCar: 'sport' },
      { text: 'Deliver the Comet GT to the garage', pos: [-78, 78], r: 6, needCar: 'sport' },
    ],
    reward: 300,
  },
  {
    name: 'The Drop', giver: 'Ines Duarte',
    intro: [
      ['Ines Duarte', 'A crate is waiting at the marina. Cops are sniffing around, so keep your head down.'],
      ['Ines Duarte', 'Pick it up, walk it to the park bench. Quiet.'],
    ],
    stages: [
      { text: 'Pick up the crate at the marina', pos: [0, 208], r: 5 },
      { text: 'Deliver the crate to the park bench', pos: [-182, 182], r: 5 },
    ],
    reward: 400,
  },
  {
    name: 'Neon Run', giver: 'Dario Kane',
    intro: [
      ['Dario Kane', 'You call yourself a driver? Prove it. Four checkpoints, two and a half minutes.'],
      ['Dario Kane', 'Beat the clock and the night is yours. Miss it and you walk home.'],
    ],
    stages: [
      { text: 'Checkpoint 1: the pier', pos: [210, 0], r: 6, time: 150 },
      { text: 'Checkpoint 2: the park', pos: [-182, 182], r: 6 },
      { text: 'Checkpoint 3: downtown bank', pos: [26, 26], r: 6 },
      { text: 'Checkpoint 4: the marina', pos: [0, 208], r: 6 },
    ],
    reward: 500,
  },
  {
    name: 'The Heist', giver: 'Mara Voss',
    intro: [
      ['Mara Voss', 'Last job, Jax. The downtown bank. In and out, then we vanish.'],
      ['Mara Voss', 'Five stars will be on you the second the alarm trips. Lose them at the garage.'],
    ],
    stages: [
      { text: 'Reach the downtown bank', pos: [26, 26], r: 6 },
      { text: 'Hold position — crack the vault (stay in the circle)', pos: [26, 26], r: 6, hold: 4 },
      { text: 'Lose the cops — reach the garage', pos: [-78, 78], r: 6 },
    ],
    reward: 1000,
  },
];

export class MissionSystem {
  constructor(city, seed = 31) {
    this.city = city;
    this.rng = mulberry32(seed);
    this.current = -1;      // mission index, -1 = none active
    this.stage = 0;
    this.stageT = 0;        // countdown for timed stages / hold progress
    this.holdT = 0;
    this.dialogue = [];     // [{name, text}]
    this.completed = [];    // mission indices done
    this.failed = false;
    // Golden palms: 12 collectibles on roads and sidewalks.
    this.palms = [];
    const spots = [
      [156, -78], [156, 78], [104, 130], [-104, -104], [52, 104], [-52, 156],
      [0, -156], [-156, 52], [130, -130], [-26, -182], [78, 182], [156, 52],
    ];
    for (const [x, z] of spots) this.palms.push({ x, z, taken: false });
    this.palmsGot = 0;
    // Taxi fare state.
    this.fare = null; // {ped, dest:[x,z], pay}
  }
  say(name, text) { this.dialogue.push({ name, text }); }
  startMission(i, ctx) {
    const m = MISSIONS[i];
    this.current = i; this.stage = 0; this.stageT = 0; this.holdT = 0; this.failed = false;
    for (const [n, t] of m.intro) this.say(n, t);
    if (ctx && ctx.onMissionStart) ctx.onMissionStart(m);
  }
  active() { return this.current >= 0 && !this.failed; }
  currentMission() { return this.current >= 0 ? MISSIONS[this.current] : null; }
  objectiveText() {
    if (this.fare) return `Taxi fare: drop off your passenger (${Math.round(this.fare.dist)} m)`;
    if (!this.active()) {
      if (this.completed.length >= MISSIONS.length) return 'All jobs done — Neon Shore is yours.';
      return `Next job: ${MISSIONS[this.completed.length].name} — go to the garage`;
    }
    const m = MISSIONS[this.current];
    const s = m.stages[this.stage];
    let t = `${m.name}: ${s.text}`;
    if (s.time && this.stageT > 0) t += ` — ${Math.ceil(this.stageT)}s left`;
    if (s.hold) t += ` — hold ${Math.ceil(this.holdT)}/${s.hold}s`;
    return t;
  }
  objectivePos() {
    if (this.fare) return this.fare.dest;
    if (!this.active()) return [-78, 78]; // garage = next job giver
    return MISSIONS[this.current].stages[this.stage].pos;
  }
  completeMission(ctx) {
    const m = MISSIONS[this.current];
    this.completed.push(this.current);
    this.say(m.giver, `Job done. $${m.reward} is yours, Jax.`);
    if (ctx) {
      ctx.addCash(m.reward);
      if (ctx.onMissionComplete) ctx.onMissionComplete(this.current, m);
    }
    this.current = -1; this.stage = 0;
  }
  failMission(ctx) {
    const m = MISSIONS[this.current];
    this.failed = true;
    this.say(m.giver, 'That was a mess. Come back to the garage when you are ready to try again.');
    if (ctx && ctx.onMissionFail) ctx.onMissionFail(this.current, m);
    this.current = -1; this.stage = 0;
  }
  // Start a taxi fare with a hailing ped.
  startFare(ped, ctx) {
    const i = Math.floor(randRange(this.rng, -4, 5));
    const j = Math.floor(randRange(this.rng, -4, 5));
    const dest = [i * CITY.PITCH + randRange(this.rng, -10, 10), j * CITY.PITCH + randRange(this.rng, -10, 10)];
    const dist = Math.hypot(dest[0] - ped.x, dest[1] - ped.z);
    this.fare = { ped, dest, pay: Math.round(20 + dist * 0.35), dist };
    ped.state = 'riding';
    this.say('Passenger', 'Take me there, quick. The meter is running.');
    if (ctx && ctx.onFareStart) ctx.onFareStart(this.fare);
  }
  update(dt, ctx) {
    // ctx: {playerX, playerZ, inCar, carKind, car, setWanted, addCash, onMissionComplete, onMissionFail, onCollect, effects}
    // Collectibles.
    for (const p of this.palms) {
      if (p.taken) continue;
      if (Math.hypot(p.x - ctx.playerX, p.z - ctx.playerZ) < 3) {
        p.taken = true; this.palmsGot++;
        ctx.addCash(50);
        if (ctx.onCollect) ctx.onCollect(p, this.palmsGot);
      }
    }
    // Taxi fare progress.
    if (this.fare) {
      this.fare.dist = Math.hypot(this.fare.dest[0] - ctx.playerX, this.fare.dest[1] - ctx.playerZ);
      if (this.fare.dist < 6) {
        const pay = this.fare.pay;
        ctx.addCash(pay);
        this.say('Passenger', `Thanks! Here's $${pay}.`);
        if (ctx.onFareDone) ctx.onFareDone(pay);
        this.fare.ped.state = 'walk'; this.fare.ped.target = null;
        this.fare = null;
      }
      if (!ctx.inCar && this.fare) {
        // Passenger bails if you leave the car.
        this.say('Passenger', 'Hey! I am not walking. Fare cancelled.');
        this.fare.ped.state = 'walk'; this.fare.ped.target = null;
        this.fare = null;
      }
    }
    if (!this.active()) return;
    const m = MISSIONS[this.current];
    const s = m.stages[this.stage];
    const d = Math.hypot(s.pos[0] - ctx.playerX, s.pos[1] - ctx.playerZ);
    if (s.time) {
      if (this.stageT <= 0) this.stageT = s.time;
      this.stageT -= dt;
      if (this.stageT <= 0) { this.failMission(ctx); return; }
    }
    if (s.hold) {
      if (d < s.r) {
        this.holdT += dt;
        if (this.holdT >= s.hold) {
          this.holdT = 0;
          if (this.current === 4 && this.stage === 1) ctx.setWanted(5); // heist alarm
          this.advance(ctx);
        }
      } else this.holdT = 0;
      return;
    }
    if (d < s.r) {
      if (s.needCar && !(ctx.inCar && ctx.carKind === s.needCar)) return; // must be in the right car
      if (this.current === 1 && this.stage === 0) ctx.setWanted(2); // stealing spotted
      if (this.current === 2 && this.stage === 0) ctx.setWanted(3); // the drop is hot
      this.advance(ctx);
    }
  }
  advance(ctx) {
    const m = MISSIONS[this.current];
    this.stage++;
    if (this.stage >= m.stages.length) this.completeMission(ctx);
  }
  // Draw mission marker beacon + golden palms.
  draw(r, t) {
    const pos = this.objectivePos();
    if (pos && (this.active() || this.fare || this.completed.length < MISSIONS.length)) {
      const pulse = 1 + Math.sin(t * 4) * 0.15;
      r.box(matCompose(pos[0], 6, pos[1], 0, 0, 0, 0.5 * pulse, 6, 0.5 * pulse),
        [1.0, 0.8, 0.1], { emissive: [0.7, 0.5, 0.05] });
    }
    for (const p of this.palms) {
      if (p.taken) continue;
      const bob = Math.sin(t * 2 + p.x) * 0.2;
      r.box(matCompose(p.x, 1.2 + bob, p.z, t * 0.8, 0, 0, 0.35, 0.35, 0.35),
        [1.0, 0.8, 0.15], { emissive: [0.8, 0.6, 0.05] });
    }
  }
}
