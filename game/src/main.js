// main.js — NEON SHORE: game loop, player, camera, wanted system, combat,
// RUSH slow-mo, shot presets, and the menu/pause/busted/wasted states.
// Wires together city, vehicles, people, missions, HUD, audio and effects.
import { clamp, angleTo, angleLerp, matCompose } from './math3.js';
import { Renderer } from './gl3.js';
import { buildCity, drawCity, collideCircle } from './city.js';
import { TrafficSystem, makeCar, stepCarPhysics } from './vehicles.js';
import { PedSystem } from './people.js';
import { MissionSystem, MISSIONS } from './missions.js';
import { HUD } from './hud.js';
import { AudioSys } from './audio.js';
import { Particles, ScreenShake, sunFor } from './effects.js';
import { saveGame, loadGame, hasSave, clearSave } from './save.js';

window.__gameErrors = [];
window.addEventListener('error', (e) => {
  window.__gameErrors.push(String(e.message || e.error));
  const el = document.getElementById('err');
  if (el) el.textContent = 'ERR: ' + window.__gameErrors.join(' | ');
});

const $ = (id) => document.getElementById(id);

class Game {
  constructor() {
    this.canvas = $('game-canvas');
    this.renderer = new Renderer(this.canvas);
    this.city = buildCity(7);
    this.traffic = new TrafficSystem(this.city, 11);
    this.traffic.spawnTraffic(14);
    this.peds = new PedSystem(this.city, 23);
    this.peds.spawnPeds(22);
    this.missions = new MissionSystem(this.city, 31);
    this.hud = new HUD(document);
    this.audio = new AudioSys();
    this.fx = new Particles();
    this.shake = new ScreenShake();
    this.state = 'menu'; // menu | playing | paused | busted | wasted
    this.time = 0;       // total seconds played
    this.timeHours = 17.4; // golden hour at start
    this.timeScale = 1;
    this.player = {
      x: -78, z: 70, heading: 0, speed: 0,
      health: 100, armor: 0, ammo: 24, mag: 12, cash: 250,
      inCar: false, car: null, rush: 1, rushOn: false,
      reloadT: 0, punchT: 0, shootT: 0,
    };
    this.wanted = 0;
    this.lastCrimeT = -100;
    this.calmT = 0;
    this.bustT = 0;
    this.policeSpawnT = 0;
    this.cam = { yaw: 0, pitch: 0.32, dist: 9, orbitX: 0, orbitY: 0 };
    this.keys = {};
    this.mouse = { down: false, lx: 0, ly: 0 };
    this.dialogueOpen = false;
    this.saveT = 0;
    this.shotPreset = null;
    this.frames = 0;
    this.nearMissCd = 0;
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    this.renderer.resize(window.innerWidth, window.innerHeight);
  }
  bindInput() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Escape' && this.state === 'playing') this.pause();
      else if (e.code === 'Escape' && this.state === 'paused') this.resume();
      if (e.code === 'KeyE') this.onInteract();
      if (e.code === 'KeyF') this.onPunch();
      if (e.code === 'KeyR') this.onReload();
      if (e.code === 'KeyQ') this.hud.setRadio(this.audio.cycleStation());
      if (e.code === 'KeyM') this.audio.setMuted(!this.audio.muted);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    this.canvas.addEventListener('mousedown', (e) => {
      this.mouse.down = true; this.mouse.lx = e.clientX; this.mouse.ly = e.clientY;
      if (this.state === 'playing') this.onShoot();
    });
    window.addEventListener('mouseup', () => { this.mouse.down = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.mouse.down) return;
      this.cam.orbitX += (e.clientX - this.mouse.lx) * 0.005;
      this.cam.orbitY += (e.clientY - this.mouse.ly) * 0.005;
      this.cam.orbitY = clamp(this.cam.orbitY, -0.5, 0.6);
      this.mouse.lx = e.clientX; this.mouse.ly = e.clientY;
    });
    this.canvas.addEventListener('wheel', (e) => {
      this.cam.dist = clamp(this.cam.dist + Math.sign(e.deltaY) * 1.5, 5, 16);
      e.preventDefault();
    }, { passive: false });
    $('btn-new').addEventListener('click', () => { this.audio.ensure(); clearSave(); this.newGame(); });
    $('btn-continue').addEventListener('click', () => { this.audio.ensure(); this.continueGame(); });
    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-save').addEventListener('click', () => { this.doSave(); this.hud.toast('Game saved.'); });
    $('btn-quit').addEventListener('click', () => this.toMenu());
    $('btn-respawn').addEventListener('click', () => this.respawn());
    $('dlg-next').addEventListener('click', () => this.advanceDialogue());
    $('dialogue').addEventListener('click', () => this.advanceDialogue());
  }
  // ----- state transitions -----
  newGame() {
    this.resetPlayer(-78, 70, 0);
    this.missions = new MissionSystem(this.city, 31);
    this.startPlaying();
    this.hud.centerMsg('NEON SHORE — go to the garage to meet Mara Voss');
  }
  continueGame() {
    const s = loadGame();
    this.resetPlayer(s ? s.x : -78, s ? s.z : 70, 0);
    if (s) {
      this.player.cash = s.cash; this.player.health = s.health; this.player.armor = s.armor;
      this.player.ammo = s.ammo; this.timeHours = s.timeHours;
      this.missions.completed = s.missionsDone || [];
      this.missions.palmsGot = s.palmsGot || 0;
      (s.palmsTaken || []).forEach((t, i) => { if (t && this.missions.palms[i]) this.missions.palms[i].taken = true; });
    }
    this.startPlaying();
    this.hud.centerMsg('Welcome back, Jax.');
  }
  resetPlayer(x, z, heading) {
    const p = this.player;
    p.x = x; p.z = z; p.heading = heading; p.speed = 0;
    p.health = 100; p.armor = 0; p.ammo = 24; p.mag = 12;
    p.inCar = false; p.car = null; p.rush = 1; p.rushOn = false;
    this.wanted = 0; this.bustT = 0;
    this.traffic.clearPolice(); this.peds.clearCops();
  }
  startPlaying() {
    this.state = 'playing';
    $('menu').style.display = 'none';
    $('pause-menu').style.display = 'none';
    $('end-screen').style.display = 'none';
    this.hud.showHud(true);
  }
  toMenu() {
    this.state = 'menu';
    $('menu').style.display = 'flex';
    $('pause-menu').style.display = 'none';
    $('end-screen').style.display = 'none';
    $('btn-continue').style.display = hasSave() ? 'block' : 'none';
    this.hud.showHud(false);
    this.hud.hideDialogue();
  }
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    $('pause-menu').style.display = 'flex';
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    $('pause-menu').style.display = 'none';
  }
  respawn() {
    const wasWasted = this.state === 'wasted';
    const lost = Math.min(this.player.cash, 150);
    this.player.cash -= lost;
    this.resetPlayer(wasWasted ? -26 : -78, wasWasted ? -70 : 70, 0);
    this.player.health = 100;
    this.startPlaying();
    this.hud.centerMsg(wasWasted ? 'You woke up at the hospital. -$' + lost : 'Busted. The cops took $' + lost);
  }
  doSave() {
    saveGame({
      cash: this.player.cash, health: this.player.health, armor: this.player.armor,
      ammo: this.player.ammo, timeHours: this.timeHours,
      x: this.player.x, z: this.player.z,
      missionsDone: this.missions.completed, palmsGot: this.missions.palmsGot,
      palmsTaken: this.missions.palms.map((p) => p.taken),
    });
  }
  // ----- wanted / crime -----
  setWanted(n) {
    if (n > this.wanted) {
      this.wanted = n;
      this.lastCrimeT = this.time;
      this.hud.centerMsg(n >= 4 ? 'WANTED — ' + n + ' STARS' : 'Wanted level ' + n);
    }
  }
  addCrime(n) { this.setWanted(Math.min(5, this.wanted + n)); }
  damage(amount) {
    if (this.state !== 'playing') return;
    let rest = amount;
    if (this.player.armor > 0) {
      const absorbed = Math.min(this.player.armor, rest * 0.7);
      this.player.armor -= absorbed; rest -= absorbed;
    }
    this.player.health -= rest;
    this.shake.add(0.5);
    this.calmT = 0;
    if (this.player.health <= 0) {
      this.player.health = 0;
      this.state = 'wasted';
      this.audio.busted();
      $('end-title').textContent = 'WASTED';
      $('end-text').textContent = 'Neon Shore is unforgiving. You wake up at the hospital, lighter in the wallet.';
      $('end-screen').style.display = 'flex';
      this.hud.showHud(false);
    }
  }
  busted() {
    this.state = 'busted';
    this.audio.busted();
    $('end-title').textContent = 'BUSTED';
    $('end-text').textContent = 'The NSPD caught up with you. Bail costs money — but the night is still young.';
    $('end-screen').style.display = 'flex';
    this.hud.showHud(false);
  }
  // ----- interactions -----
  onInteract() {
    if (this.state !== 'playing') return;
    if (this.dialogueOpen) { this.advanceDialogue(); return; }
    const p = this.player;
    if (!p.inCar) {
      // Taxi fare pickup needs a taxi; without one, just explain.
      const ped = this.peds.nearestPed(p.x, p.z, 3.5);
      if (ped && ped.taxi && !this.missions.fare) {
        this.hud.toast('You need a taxi for this fare — steal one and come back.');
        return;
      }
      // Enter nearest car.
      const car = this.traffic.nearestStealable(p.x, p.z, 4.5);
      if (car) {
        const wasParked = car.driver === 'parked';
        car.driver = 'player';
        p.inCar = true; p.car = car;
        p.x = car.x; p.z = car.z; p.heading = car.heading;
        if (!wasParked) {
          this.peds.scare(car.x, car.z, 25);
          const copNear = this.traffic.police.some((c) => Math.hypot(c.x - car.x, c.z - car.z) < 45);
          if (copNear || this.wanted > 0) this.addCrime(1);
          this.hud.toast('Car jacked — drive!');
        }
        this.audio.setEngine(0, true);
        return;
      }
      // Start next mission at the garage.
      const d = Math.hypot(this.city.garage.x - p.x, this.city.garage.z - p.z);
      if (d < 6 && !this.missions.active() && this.missions.completed.length < MISSIONS.length) {
        this.missions.startMission(this.missions.completed.length, this.missionCtx());
        this.showNextDialogue();
      }
    } else {
      // Exit car.
      const car = p.car;
      const side = 2.6;
      const ex = car.x + Math.cos(car.heading) * side;
      const ez = car.z - Math.sin(car.heading) * side;
      const [cx, cz] = collideCircle(this.city, ex, ez, 0.6);
      p.x = cx; p.z = cz; p.heading = car.heading;
      p.inCar = false; p.car = null;
      car.driver = 'parked'; car.speed = 0;
      this.audio.setEngine(0, false);
      // Picking up a taxi fare: must be in a taxi next to a hailing ped.
      const farePed = this.peds.peds.find((q) => q.taxi && Math.hypot(q.x - car.x, q.z - car.z) < 6);
      if (farePed && car.kind === 'taxi' && !this.missions.fare) {
        this.missions.startFare(farePed, this.missionCtx());
      }
    }
  }
  onPunch() {
    const p = this.player;
    if (this.state !== 'playing' || p.inCar || p.punchT > 0) return;
    p.punchT = 0.45;
    this.audio.punch();
    const ped = this.peds.nearestPed(p.x + Math.sin(p.heading) * 1.5, p.z + Math.cos(p.heading) * 1.5, 2.4);
    if (ped) {
      ped.state = 'down'; ped.downT = 6;
      this.peds.scare(p.x, p.z, 25);
      this.addCrime(1);
      this.fx.sparks(p.x, 1.2, p.z, 6);
    }
    for (const c of this.peds.cops) {
      if (Math.hypot(c.x - p.x, c.z - p.z) < 2.2) { c.gone = true; this.fx.sparks(c.x, 1.2, c.z, 8); }
    }
  }
  onReload() {
    const p = this.player;
    if (this.state !== 'playing' || p.inCar || p.reloadT > 0) return;
    p.reloadT = 0.8;
    p.mag = Math.min(12, p.ammo);
    this.hud.toast('Reloaded.');
  }
  onShoot() {
    const p = this.player;
    if (this.state !== 'playing' || p.inCar || p.shootT > 0 || p.mag <= 0) return;
    p.shootT = 0.28; p.mag--;
    this.audio.shot();
    this.shake.add(0.25);
    const eye = this.camEye, fwd = this.camFwd;
    if (!eye || !fwd) return;
    const muzzle = [eye[0] + fwd[0] * 2, eye[1] - 0.3, eye[2] + fwd[2] * 2];
    this.fx.muzzle(muzzle[0], muzzle[1], muzzle[2]);
    let best = null, bd = 45;
    const consider = (x, y, z, kind, ref) => {
      const dx = x - eye[0], dy = y - eye[1], dz = z - eye[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > bd || d < 0.5) return;
      const dot = (dx * fwd[0] + dy * fwd[1] + dz * fwd[2]) / d;
      if (dot > 0.995) { bd = d; best = { kind, ref }; }
    };
    for (const ped of this.peds.peds) if (ped.state !== 'down') consider(ped.x, 1.3, ped.z, 'ped', ped);
    for (const c of this.peds.cops) consider(c.x, 1.3, c.z, 'cop', c);
    for (const car of this.traffic.cars.concat(this.traffic.police)) consider(car.x, 0.9, car.z, 'car', car);
    if (best) {
      if (best.kind === 'ped') {
        best.ref.state = 'down'; best.ref.downT = 8;
        this.peds.scare(best.ref.x, best.ref.z, 30);
        this.addCrime(1);
        this.fx.sparks(best.ref.x, 1.3, best.ref.z, 8);
      } else if (best.kind === 'cop') {
        best.ref.gone = true;
        this.addCrime(1);
        this.fx.sparks(best.ref.x, 1.3, best.ref.z, 8);
      } else {
        this.fx.sparks(best.ref.x, 0.9, best.ref.z, 10);
        this.addCrime(1);
      }
    }
  }
  advanceDialogue() {
    if (this.missions.dialogue.length > 0) {
      this.missions.dialogue.shift();
      this.showNextDialogue();
    } else {
      this.dialogueOpen = false;
      this.hud.hideDialogue();
    }
  }
  showNextDialogue() {
    if (this.missions.dialogue.length > 0) {
      const d = this.missions.dialogue[0];
      this.dialogueOpen = true;
      this.hud.showDialogue(d.name, d.text + '  [E]');
    } else {
      this.dialogueOpen = false;
      this.hud.hideDialogue();
    }
  }
  missionCtx() {
    return {
      addCash: (n) => { this.player.cash += n; this.audio.cash(); this.hud.toast('+$' + n); },
      setWanted: (n) => this.setWanted(n),
      onMissionComplete: (i, m) => {
        this.hud.centerMsg(`JOB COMPLETE — ${m.name}  +$${m.reward}`);
        this.doSave();
        this.showNextDialogue();
      },
      onMissionFail: (i, m) => { this.hud.centerMsg('JOB FAILED — ' + m.name); this.showNextDialogue(); },
      onCollect: (palm, n) => { this.audio.pickup(); this.hud.toast(`Golden palm ${n}/12 — +$50`); },
      onFareDone: (pay) => { this.hud.toast(`Fare paid: $${pay}`); },
      onMissionStart: (m) => { this.hud.centerMsg(m.name + ' — ' + m.giver); },
    };
  }
  // ----- shot presets (deterministic staged scenes for screenshots) -----
  applyShotPreset(name) {
    const p = this.player;
    const putInCar = (kind, x, z, heading, speed) => {
      const car = makeCar(kind, x, z, heading);
      car.driver = 'player'; car.speed = speed;
      this.traffic.cars.push(car);
      p.inCar = true; p.car = car; p.x = x; p.z = z; p.heading = heading;
    };
    this.startPlaying();
    if (name === 'cover') {
      this.timeHours = 17.6;
      putInCar('sport', 0, -120, 0, 22);
      this.cam.dist = 10;
    } else if (name === 'chase') {
      this.timeHours = 21.5;
      putInCar('sedan', 0, -52, 0, 26);
      this.setWanted(3);
      this.traffic.spawnPolice(2, 0, -30);
      p.rush = 1.0; p.rushOn = true;
      this.cam.dist = 10;
    } else if (name === 'mission') {
      this.timeHours = 18.2;
      p.x = 215; p.z = -12; p.heading = 1.09; // on the pier, facing the ferris wheel
      this.missions.startMission(0, this.missionCtx());
      this.missions.stage = 1; // pier pickup stage
      this.showNextDialogue();
      this.cam.dist = 12;
    } else if (name === 'night') {
      this.timeHours = 22.5;
      p.x = -52; p.z = 52; p.heading = -0.785; // at the intersection, facing the garage + pink Comet
      const car = makeCar('sport', -60, 60, 0.6, 0);
      car.driver = 'parked';
      this.traffic.cars.push(car);
      this.cam.dist = 11;
    }
    this.shotPreset = name;
  }
  // ----- per-frame update -----
  update(rawDt) {
    const dt = Math.min(rawDt, 0.05) * this.timeScale;
    this.time += dt;
    this.timeHours = (this.timeHours + dt / 120) % 24; // 1 game hour per 2 min
    const p = this.player;
    p.punchT = Math.max(0, p.punchT - dt);
    p.shootT = Math.max(0, p.shootT - dt);
    p.reloadT = Math.max(0, p.reloadT - dt);
    // RUSH: hold Shift while driving.
    const wantRush = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    p.rushOn = !!(wantRush && p.inCar && p.rush > 0.05 && Math.abs(p.car.speed) > 5);
    this.timeScale = p.rushOn ? 0.35 : 1;
    if (p.rushOn) p.rush = Math.max(0, p.rush - dt * 0.15);
    else p.rush = Math.min(1, p.rush + dt * 0.06);
    this.nearMissCd = Math.max(0, this.nearMissCd - dt);

    // --- player movement ---
    if (p.inCar && p.car) {
      const car = p.car;
      let throttle = (this.keys['KeyW'] || this.keys['ArrowUp'] ? 1 : 0) - (this.keys['KeyS'] || this.keys['ArrowDown'] ? 0.85 : 0);
      let steer = (this.keys['KeyA'] || this.keys['ArrowLeft'] ? 1 : 0) - (this.keys['KeyD'] || this.keys['ArrowRight'] ? 1 : 0);
      if (this.shotPreset) {
        // Staged shots: cruise straight down the boulevard (heading 0, +Z).
        throttle = 0.7;
        steer = clamp(((0 - car.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -1, 1);
      }
      stepCarPhysics(car, { throttle, steer, brake: !!this.keys['Space'] }, dt, this.city);
      p.x = car.x; p.z = car.z; p.heading = car.heading; p.speed = car.speed;
      if (car.drift) p.rush = Math.min(1, p.rush + dt * 0.12);
      if (this.nearMissCd <= 0) {
        for (const o of this.traffic.cars) {
          if (o === car) continue;
          const d = Math.hypot(o.x - car.x, o.z - car.z);
          if (d < 5.5 && Math.abs(car.speed) > 15) {
            p.rush = Math.min(1, p.rush + 0.15);
            this.nearMissCd = 1.5;
            this.hud.toast('Near miss! RUSH +');
            break;
          }
        }
      }
      this.audio.setEngine(Math.abs(car.speed) / car.max, true);
      if (Math.hypot(p.x - this.city.hospital.x, p.z - this.city.hospital.z) < 10) {
        p.health = Math.min(100, p.health + dt * 10);
      }
    } else {
      // On foot: WASD relative to camera yaw.
      const fwd = this.cam.yaw;
      let mx = 0, mz = 0;
      if (this.keys['KeyW'] || this.keys['ArrowUp']) { mx += Math.sin(fwd); mz += Math.cos(fwd); }
      if (this.keys['KeyS'] || this.keys['ArrowDown']) { mx -= Math.sin(fwd); mz -= Math.cos(fwd); }
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) { mx += Math.sin(fwd - Math.PI / 2); mz += Math.cos(fwd - Math.PI / 2); }
      if (this.keys['KeyD'] || this.keys['ArrowRight']) { mx += Math.sin(fwd + Math.PI / 2); mz += Math.cos(fwd + Math.PI / 2); }
      const sprint = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
      const sp = sprint ? 10 : 6;
      const len = Math.hypot(mx, mz);
      if (len > 0.01) {
        mx /= len; mz /= len;
        p.heading = angleLerp(p.heading, Math.atan2(mx, mz), Math.min(1, dt * 10));
        const nx = p.x + mx * sp * dt;
        const nz = p.z + mz * sp * dt;
        const [cx, cz] = collideCircle(this.city, nx, nz, 0.6);
        p.x = cx; p.z = cz;
        p.speed = sp;
      } else p.speed = 0;
      this.audio.setEngine(0, false);
      if (Math.hypot(p.x - this.city.hospital.x, p.z - this.city.hospital.z) < 10) {
        p.health = Math.min(100, p.health + dt * 10);
      }
    }
    // Health regen when calm.
    this.calmT += dt;
    if (this.calmT > 8 && p.health > 0 && p.health < 50) p.health = Math.min(50, p.health + dt * 2);

    // --- wanted / police ---
    const wantedCars = [0, 0, 1, 2, 3, 4, 4][this.wanted];
    this.policeSpawnT -= dt;
    if (this.traffic.police.length < wantedCars && this.policeSpawnT <= 0) {
      this.policeSpawnT = 1.5;
      this.traffic.spawnPolice(1, p.x, p.z);
    }
    if (this.wanted > 0) {
      const copDists = this.traffic.police.map((c) => Math.hypot(c.x - p.x, c.z - p.z));
      const nearestCop = copDists.length ? Math.min(...copDists) : 999;
      if (nearestCop > 55 && this.time - this.lastCrimeT > 12) {
        this.wanted--;
        this.lastCrimeT = this.time;
        if (this.wanted === 0) { this.traffic.clearPolice(); this.peds.clearCops(); }
      }
      if (!p.inCar && this.peds.cops.length < Math.min(this.wanted, 3) && this.policeSpawnT <= -1) {
        this.policeSpawnT = 1;
        this.peds.spawnFootCops(1, p.x, p.z);
      }
      if (!p.inCar) {
        const near = this.peds.cops.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 1.9);
        this.bustT = near ? this.bustT + dt : Math.max(0, this.bustT - dt * 2);
        if (this.bustT > 1.2) this.busted();
      } else if (this.wanted >= 3 && Math.abs(p.car.speed) < 4) {
        const near = this.traffic.police.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 3.5);
        this.bustT = near ? this.bustT + dt : Math.max(0, this.bustT - dt * 2);
        if (this.bustT > 2) this.busted();
      } else this.bustT = Math.max(0, this.bustT - dt);
    }
    // --- systems ---
    this.traffic.update(dt, {
      playerX: p.x, playerZ: p.z, playerCar: p.inCar ? p.car : null,
      wanted: this.wanted, inCar: p.inCar, effects: this.fx,
      onRam: (policeCar, rdt) => {
        if (p.inCar) {
          this.damage(6 * rdt * 10);
          this.audio.crash();
          this.fx.sparks(p.x, 1, p.z, 5);
        }
      },
    });
    this.peds.update(dt, {
      playerX: p.x, playerZ: p.z, playerCar: p.inCar ? p.car : null,
      inCar: p.inCar, wanted: this.wanted,
      onPedHit: () => { this.addCrime(1); this.audio.crash(); this.shake.add(0.4); },
      onCopPunch: () => { this.damage(8); this.audio.punch(); },
    });
    this.missions.update(dt, {
      playerX: p.x, playerZ: p.z, inCar: p.inCar,
      carKind: p.inCar && p.car ? p.car.kind : null, car: p.car,
      setWanted: (n) => this.setWanted(n),
      addCash: (n) => { p.cash += n; },
      onMissionComplete: (i, m) => {
        this.hud.centerMsg(`JOB COMPLETE — ${m.name}  +$${m.reward}`);
        this.audio.cash();
        this.doSave();
        this.showNextDialogue();
      },
      onMissionFail: (i, m) => { this.hud.centerMsg('JOB FAILED — ' + m.name); this.showNextDialogue(); },
      onCollect: (palm, n) => { this.audio.pickup(); this.hud.toast(`Golden palm ${n}/12 — +$50`); },
      onFareDone: (pay) => { this.hud.toast(`Fare paid: $${pay}`); this.audio.cash(); },
      onMissionStart: (m) => { this.hud.centerMsg(m.name + ' — ' + m.giver); },
      onFareStart: () => {},
      effects: this.fx,
    });
    this.fx.update(dt);
    const copNear = this.traffic.police.length > 0
      ? Math.min(...this.traffic.police.map((c) => Math.hypot(c.x - p.x, c.z - p.z))) : 999;
    this.audio.setSiren(this.wanted > 0 && copNear < 80, copNear < 80 ? 1 - copNear / 80 : 0);
    this.saveT += dt;
    if (this.saveT > 60) { this.saveT = 0; this.doSave(); }
    // HUD.
    const objPos = this.missions.objectivePos();
    this.hud.setStars(this.wanted);
    this.hud.setCash(p.cash);
    this.hud.setBars(p.health, p.armor);
    this.hud.setAmmo(p.mag);
    this.hud.setClock(this.timeHours);
    this.hud.setSpeed(Math.abs(p.speed) * 3.6, p.inCar);
    this.hud.setRush(p.rush, p.inCar);
    this.hud.setObjective(this.missions.objectiveText(), objPos ? Math.hypot(objPos[0] - p.x, objPos[1] - p.z) : null);
    this.hud.tick(dt);
    if (!p.inCar && !this.missions.fare) {
      const ped = this.peds.peds.find((q) => q.taxi && Math.hypot(q.x - p.x, q.z - p.z) < 4);
      if (ped) this.hud.setObjective('Taxi fare waiting — get in a taxi, then press E near the passenger', null);
    }
  }
  // ----- render -----
  render() {
    const r = this.renderer;
    const p = this.player;
    const sun = sunFor(this.timeHours);
    this.cam.orbitX *= 0.94; this.cam.orbitY *= 0.94;
    const targetYaw = p.heading + this.cam.orbitX;
    this.cam.yaw = angleLerp(this.cam.yaw, targetYaw, 0.12);
    const pitch = 0.32 + this.cam.orbitY;
    const dist = this.cam.dist + (p.inCar ? 2 : 0);
    const [shx, shy] = this.shake.offset(1 / 60);
    const eye = [
      p.x - Math.sin(this.cam.yaw) * Math.cos(pitch) * dist + shx,
      (p.inCar ? 5.0 : 3.4) + Math.sin(pitch) * dist + shy,
      p.z - Math.cos(this.cam.yaw) * Math.cos(pitch) * dist,
    ];
    const center = [p.x + Math.sin(this.cam.yaw) * 6, (p.inCar ? 1.2 : 1.4), p.z + Math.cos(this.cam.yaw) * 6];
    this.camEye = eye;
    const fwd = [center[0] - eye[0], center[1] - eye[1], center[2] - eye[2]];
    const fl = Math.hypot(fwd[0], fwd[1], fwd[2]) || 1;
    this.camFwd = [fwd[0] / fl, fwd[1] / fl, fwd[2] / fl];
    r.setCamera(eye, center, [0, 1, 0], 62);
    r.setLight(sun);
    r.beginFrame();
    drawCity(r, this.city, this.time);
    if (!p.inCar) {
      const bob = Math.abs(Math.sin(this.time * 8)) * 0.05 * (p.speed > 0.5 ? 1 : 0);
      r.box(matCompose(p.x, 0.45 + bob, p.z, p.heading, 0, 0, 0.16, 0.45, 0.16), [0.15, 0.18, 0.3]);
      r.box(matCompose(p.x, 1.15 + bob, p.z, p.heading, 0, 0, 0.26, 0.4, 0.2), [0.85, 0.25, 0.3]);
      r.box(matCompose(p.x, 1.72 + bob, p.z, p.heading, 0, 0, 0.17, 0.17, 0.17), [0.85, 0.65, 0.5]);
      if (p.shootT > 0) {
        r.box(matCompose(p.x + Math.sin(p.heading) * 0.4, 1.3, p.z + Math.cos(p.heading) * 0.4, p.heading, 0, 0, 0.08, 0.12, 0.35), [0.1, 0.1, 0.1]);
      }
    }
    this.traffic.draw(r, this.time, sun.night);
    this.peds.draw(r, this.time);
    this.missions.draw(r, this.time);
    this.fx.draw(r);
    const rushEl = $('rush-fx');
    if (rushEl) rushEl.style.opacity = p.rushOn ? '1' : '0';
    this.canvas.style.filter = p.rushOn ? 'saturate(0.55) hue-rotate(160deg) brightness(1.05)' : '';
    if (this.frames % 9 === 0) {
      const taxiPed = this.peds.peds.find((q) => q.taxi);
      this.hud.drawMinimap({
        city: this.city, playerX: p.x, playerZ: p.z, heading: p.heading,
        cars: this.traffic.cars.filter((c) => c.driver !== 'player'),
        police: this.traffic.police,
        missionPos: this.missions.objectivePos(),
        palms: this.missions.palms,
        taxiPed,
      });
    }
  }
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min((now - (this.lastT || now)) / 1000, 0.1);
    this.lastT = now;
    this.frames++;
    if (this.state === 'playing') this.update(dt);
    else if (this.state === 'menu') {
      this.time += dt * 0.5;
      this.timeHours = (this.timeHours + dt / 300) % 24;
    }
    if (this.state === 'menu') {
      const a = this.time * 0.03;
      const eye = [Math.sin(a) * 120, 55, Math.cos(a) * 120];
      const sun = sunFor(this.timeHours);
      this.renderer.setCamera(eye, [0, 10, 0], [0, 1, 0], 55);
      this.renderer.setLight(sun);
      this.renderer.beginFrame();
      drawCity(this.renderer, this.city, this.time);
      this.traffic.draw(this.renderer, this.time, sun.night);
    } else {
      this.render();
    }
    if (this.frames === 90) window.__ready = true; // screenshot harness hook
  }
  boot() {
    const params = new URLSearchParams(location.search);
    const shot = params.get('shot');
    if (shot) {
      this.applyShotPreset(shot);
    } else {
      this.toMenu();
    }
    this.lastT = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }
}

const game = new Game();
window.__game = game;
game.boot();
