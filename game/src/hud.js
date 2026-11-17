// hud.js — DOM HUD (stars, cash, bars, clock, speed, RUSH meter, objective)
// plus a live 2D minimap canvas with blips for player, police, mission and fares.
import { CITY } from './city.js';

export class HUD {
  constructor(doc) {
    this.doc = doc;
    const $ = (id) => doc.getElementById(id);
    this.el = {
      hud: $('hud'), stars: $('stars'), cash: $('cash'),
      healthFill: $('health-fill'), armorFill: $('armor-fill'),
      ammo: $('ammo'), clock: $('clock'), radio: $('radio'),
      speed: $('speed'), rushFill: $('rush-fill'), rushWrap: $('rush-wrap'),
      objective: $('objective'), objDist: $('obj-dist'),
      dialogue: $('dialogue'), dlgName: $('dlg-name'), dlgText: $('dlg-text'),
      center: $('center-msg'), toast: $('toast'),
      menu: $('menu'), pause: $('pause-menu'), end: $('end-screen'),
      endTitle: $('end-title'), endText: $('end-text'),
      minimap: $('minimap'),
    };
    this.mm = this.el.minimap ? this.el.minimap.getContext('2d') : null;
    this.toastT = 0;
  }
  showHud(on) { if (this.el.hud) this.el.hud.style.display = on ? 'block' : 'none'; }
  setStars(n) {
    if (!this.el.stars) return;
    let s = '';
    for (let i = 0; i < 5; i++) s += `<span class="${i < n ? 'on' : ''}">★</span>`;
    this.el.stars.innerHTML = s;
    this.el.stars.classList.toggle('hot', n >= 3);
  }
  setCash(v) { if (this.el.cash) this.el.cash.textContent = '$' + Math.round(v).toLocaleString('en-US'); }
  setBars(health, armor) {
    if (this.el.healthFill) this.el.healthFill.style.width = Math.max(0, health) + '%';
    if (this.el.armorFill) this.el.armorFill.style.width = Math.max(0, armor) + '%';
  }
  setAmmo(a) { if (this.el.ammo) this.el.ammo.textContent = a + ' / ∞'; }
  setClock(hours) {
    if (!this.el.clock) return;
    const h = Math.floor(hours) % 24;
    const m = Math.floor((hours % 1) * 60);
    this.el.clock.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  setRadio(name) { if (this.el.radio) this.el.radio.textContent = name; }
  setSpeed(kmh, inCar) {
    if (!this.el.speed) return;
    this.el.speed.textContent = inCar ? Math.round(kmh) + ' km/h' : '';
  }
  setRush(f, inCar) {
    if (!this.el.rushWrap) return;
    this.el.rushWrap.style.display = inCar ? 'block' : 'none';
    if (this.el.rushFill) this.el.rushFill.style.width = Math.round(f * 100) + '%';
  }
  setObjective(text, dist) {
    if (this.el.objective) this.el.objective.textContent = text;
    if (this.el.objDist) this.el.objDist.textContent = dist != null ? Math.round(dist) + ' m' : '';
  }
  showDialogue(name, text) {
    if (!this.el.dialogue) return;
    this.el.dialogue.style.display = 'block';
    this.el.dlgName.textContent = name;
    this.el.dlgText.textContent = text;
  }
  hideDialogue() { if (this.el.dialogue) this.el.dialogue.style.display = 'none'; }
  centerMsg(text, ms = 2200) {
    if (!this.el.center) return;
    this.el.center.textContent = text;
    this.el.center.style.display = 'block';
    this.el.center.dataset.until = String(performance.now() + ms);
  }
  toast(text) {
    if (!this.el.toast) return;
    this.el.toast.textContent = text;
    this.el.toast.style.display = 'block';
    this.toastT = 2.6;
  }
  tick(dt) {
    if (this.el.center && this.el.center.style.display === 'block') {
      if (performance.now() > Number(this.el.center.dataset.until || 0)) this.el.center.style.display = 'none';
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0 && this.el.toast) this.el.toast.style.display = 'none';
    }
  }
  // world: {city, playerX, playerZ, heading, cars, police, missionPos, palms, taxiPed, inCar}
  drawMinimap(world) {
    const c = this.mm;
    if (!c) return;
    const S = 190, HALF = 250;
    const toMap = (x, z) => [(x / HALF) * (S / 2) + S / 2, (z / HALF) * (S / 2) + S / 2];
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(10, 14, 22, 0.85)';
    c.fillRect(0, 0, S, S);
    // Water (east + south).
    c.fillStyle = '#0b3a66';
    c.fillRect(toMap(212, -250)[0], 0, S, S);
    c.fillRect(0, toMap(-250, 212)[1], S, S);
    // Park.
    c.fillStyle = '#123f1c';
    const [px, py] = toMap(-208, 156);
    c.fillRect(px, py, 52 / HALF * S, 52 / HALF * S);
    // Roads.
    c.strokeStyle = '#4a4f58';
    c.lineWidth = 3;
    for (let i = -4; i <= 4; i++) {
      const [ax] = toMap(i * CITY.PITCH, 0);
      c.beginPath(); c.moveTo(ax, 0); c.lineTo(ax, S); c.stroke();
      const [, ay] = toMap(0, i * CITY.PITCH);
      c.beginPath(); c.moveTo(0, ay); c.lineTo(S, ay); c.stroke();
    }
    const dot = (x, z, color, r = 3) => {
      const [mx, my] = toMap(x, z);
      c.fillStyle = color;
      c.beginPath(); c.arc(mx, my, r, 0, Math.PI * 2); c.fill();
    };
    // Golden palms left.
    for (const p of world.palms || []) if (!p.taken) dot(p.x, p.z, '#ffd94a', 2);
    // Taxi hail.
    if (world.taxiPed) dot(world.taxiPed.x, world.taxiPed.z, '#2aff7a', 3);
    // Mission marker (gold diamond).
    if (world.missionPos) {
      const [mx, my] = toMap(world.missionPos[0], world.missionPos[1]);
      c.fillStyle = '#ffd94a';
      c.beginPath();
      c.moveTo(mx, my - 6); c.lineTo(mx + 5, my); c.lineTo(mx, my + 6); c.lineTo(mx - 5, my);
      c.closePath(); c.fill();
    }
    // Traffic (grey), police (red).
    for (const car of world.cars || []) dot(car.x, car.z, '#9aa0a8', 2);
    for (const car of world.police || []) dot(car.x, car.z, '#ff2a2a', 3);
    // Player arrow.
    const [ux, uy] = toMap(world.playerX, world.playerZ);
    c.save();
    c.translate(ux, uy);
    c.rotate(Math.atan2(Math.sin(world.heading), -Math.cos(world.heading)));
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(0, -7); c.lineTo(5, 6); c.lineTo(-5, 6);
    c.closePath(); c.fill();
    c.restore();
    // Border.
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, S - 1, S - 1);
  }
}
