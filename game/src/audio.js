// audio.js — synthesized WebAudio: engine hum, sirens, gunshots, pickups,
// and two procedural radio stations. No audio files; everything is oscillators.
// The context only starts after a user gesture (start button), and every call
// is guarded so headless runs without audio still work.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.station = 0; // 0 off, 1 SOL FM, 2 NEON FM
    this.stationNames = ['RADIO OFF', 'SOL FM', 'NEON FM'];
    this.radioTimer = null;
    this.radioStep = 0;
    this.muted = false;
    this.noiseBuf = null;
  }
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // Shared noise buffer for shots / punches.
      const len = this.ctx.sampleRate * 0.3;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // Engine: two detuned saws through a lowpass.
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 400;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = 'square';
      this.engineOsc2.frequency.value = 28;
      this.engineOsc.connect(this.engineFilter);
      this.engineOsc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
      this.engineOsc2.start();
      // Siren: square wave alternating 700/950 Hz.
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'square';
      this.sirenOsc.frequency.value = 700;
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.master);
      this.sirenOsc.start();
      this.startRadioScheduler();
    } catch (e) { this.ctx = null; }
  }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }
  // speed01: 0..1, on: engine running.
  setEngine(speed01, on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(on ? 0.05 + speed01 * 0.06 : 0, t, 0.1);
    this.engineOsc.frequency.setTargetAtTime(50 + speed01 * 110, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(25 + speed01 * 55, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(300 + speed01 * 900, t, 0.1);
  }
  setSiren(on, near01) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sirenGain.gain.setTargetAtTime(on ? 0.03 + near01 * 0.04 : 0, t, 0.2);
    if (on) this.sirenOsc.frequency.setTargetAtTime(((Math.floor(t * 2) % 2) ? 950 : 700), t, 0.05);
  }
  blip(freq, dur, type = 'sine', vol = 0.2, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, vol, freq = 1200) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur);
  }
  shot() { this.noise(0.18, 0.5, 2500); this.blip(90, 0.12, 'square', 0.25); }
  punch() { this.noise(0.08, 0.3, 900); }
  pickup() { this.blip(880, 0.12, 'sine', 0.25); this.blip(1318, 0.18, 'sine', 0.25, 0.09); }
  cash() { this.blip(1046, 0.1, 'triangle', 0.25); this.blip(1568, 0.16, 'triangle', 0.25, 0.08); }
  crash() { this.noise(0.3, 0.4, 500); }
  busted() { this.blip(220, 0.5, 'sawtooth', 0.2); this.blip(165, 0.7, 'sawtooth', 0.2, 0.3); }
  cycleStation() {
    this.station = (this.station + 1) % 3;
    this.radioStep = 0;
    return this.stationNames[this.station];
  }
  startRadioScheduler() {
    // 8th-note scheduler, 100 ms ticks.
    this.radioTimer = setInterval(() => {
      if (!this.ctx || this.station === 0 || this.muted) return;
      const step = this.radioStep++;
      if (this.station === 1) this.solStep(step);
      else this.neonStep(step);
    }, 190);
  }
  // SOL FM: slow pad chords Am – F – C – G, one chord per bar (8 steps).
  solStep(step) {
    const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 196, 246.9]];
    const bar = Math.floor(step / 8) % 4;
    if (step % 8 === 0) {
      for (const f of chords[bar]) this.blip(f, 1.4, 'triangle', 0.07);
    }
    if (step % 4 === 2) this.blip(chords[bar][0] * 2, 0.3, 'sine', 0.05);
  }
  // NEON FM: driving bass arpeggio, 16 steps per bar, minor key.
  neonStep(step) {
    const bass = [55, 55, 65.4, 55, 82.4, 55, 65.4, 73.4, 55, 55, 65.4, 55, 98, 82.4, 73.4, 65.4];
    const f = bass[step % 16];
    this.blip(f, 0.16, 'square', 0.08);
    if (step % 4 === 0) this.blip(f * 4, 0.1, 'sine', 0.04);
    if (step % 8 === 4) this.noise(0.05, 0.05, 6000); // hat tick
  }
}
