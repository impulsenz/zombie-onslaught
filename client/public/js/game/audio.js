// Procedural audio engine (no asset files):
//  - layered synthesis for every effect, stereo panning + distance falloff + convolution reverb
//  - separate master / music / effects / ambience volumes (saved in localStorage)
//  - a step-sequenced soundtrack: calm build music, driving battle music, heavier boss music
let ac = null, master = null, buses = null, reverbIn = null, noiseBuf = null, distCurve = null;
let listener = { x: 0, y: 0 };
let ambient = null;
const last = {};
const STORE = 'ot-audio';
const settings = Object.assign({ master: 0.8, music: 0.55, sfx: 0.85, ambience: 0.6, muted: false }, (() => {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
})());

function makeImpulse(seconds, decay) {
  const len = ac.sampleRate * seconds;
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function ensure() {
  if (ac) return true;
  try {
    ac = new AudioContext();
    master = ac.createGain();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ac.destination);
    buses = {};
    for (const k of ['sfx', 'music', 'ambience']) { buses[k] = ac.createGain(); buses[k].connect(master); }
    const verb = ac.createConvolver(); verb.buffer = makeImpulse(2.2, 3);
    reverbIn = ac.createGain(); reverbIn.gain.value = 0.25;
    reverbIn.connect(verb); verb.connect(buses.sfx);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    distCurve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; distCurve[i] = Math.tanh(x * 3); }
    applySettings();
    return true;
  } catch { return false; }
}

function applySettings() {
  if (!ac) return;
  const t = ac.currentTime;
  master.gain.setTargetAtTime(settings.muted ? 0 : settings.master * 0.7, t, 0.05);
  buses.sfx.gain.setTargetAtTime(settings.sfx, t, 0.05);
  buses.music.gain.setTargetAtTime(settings.music * 0.6, t, 0.05);
  buses.ambience.gain.setTargetAtTime(settings.ambience, t, 0.05);
}

export function getSettings() { return { ...settings }; }
export function setSetting(k, v) {
  settings[k] = v;
  try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* private mode */ }
  applySettings();
}
export function toggleMute() { setSetting('muted', !settings.muted); return settings.muted; }
export function unlockAudio() { if (ensure() && ac.state === 'suspended') ac.resume(); }
export function setListener(x, y) { listener = { x, y }; }

// ------------------------------------------------------------------ synthesis primitives
function voice(pos, vol = 1, verb = 1, bus = 'sfx') {
  const g = ac.createGain();
  let gain = vol, pan = 0;
  if (pos) {
    const dist = Math.hypot(pos.x - listener.x, pos.y - listener.y);
    gain *= Math.max(0, 1 - dist / 1300) ** 1.6;
    pan = Math.max(-1, Math.min(1, (pos.x - listener.x) / 520));
  }
  g.gain.value = gain;
  const p = ac.createStereoPanner(); p.pan.value = pan;
  g.connect(p); p.connect(buses[bus]);
  if (verb) { const send = ac.createGain(); send.gain.value = verb; p.connect(send); send.connect(reverbIn); }
  return { out: g, audible: gain > 0.008 };
}

function env(g, t, vol, attack, dur, curve = 'exp') {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
  if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  else g.gain.linearRampToValueAtTime(0.0001, t + dur);
}

function noise(out, { dur = 0.2, freq = 1000, q = 1, type = 'lowpass', vol = 0.5, attack = 0.002, sweep = 0, delay = 0, at = null }) {
  const t = (at ?? ac.currentTime) + delay;
  const src = ac.createBufferSource(); src.buffer = noiseBuf;
  const f = ac.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
  const g = ac.createGain(); env(g, t, vol, attack, dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
}

function tone(out, { freq = 440, dur = 0.2, vol = 0.3, type = 'sine', slide = 0, attack = 0.005, delay = 0, vibrato = 0, drive = false, detune = 0, at = null, filter = 0 }) {
  const t = (at ?? ac.currentTime) + delay;
  const o = ac.createOscillator(); o.type = type; o.detune.value = detune;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  if (vibrato) {
    const lfo = ac.createOscillator(); lfo.frequency.value = vibrato;
    const lg = ac.createGain(); lg.gain.value = freq * 0.04;
    lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + dur);
  }
  const g = ac.createGain(); env(g, t, vol, attack, dur);
  let node = o;
  if (drive) { const ws = ac.createWaveShaper(); ws.curve = distCurve; o.connect(ws); node = ws; }
  if (filter) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; node.connect(f); node = f; }
  node.connect(g); g.connect(out);
  o.start(t); o.stop(t + dur + 0.05);
}

const r = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ effects
// A heavy gun report: transient crack + filtered body + driven sub kick + low rolling tail.
function gunshot(o, { crack = 0.4, body = 0.6, bodyFreq = 1400, kick = 0.6, kickFreq = 80, tail = 0.3, len = 0.25 }) {
  noise(o, { dur: 0.035, freq: r(3200, 4200), type: 'bandpass', q: 0.8, vol: crack });
  noise(o, { dur: len, freq: bodyFreq * r(0.9, 1.1), vol: body, sweep: -bodyFreq * 0.75 });
  tone(o, { freq: kickFreq * r(0.95, 1.05), dur: len * 0.9, vol: kick, slide: -kickFreq * 0.55, drive: true });
  noise(o, { dur: len * 3.5, freq: 320, vol: tail, delay: 0.02, attack: 0.01 });
}

const SOUNDS = {
  // colonist weapons
  pistol: (o) => gunshot(o, { crack: 0.35, body: 0.55, bodyFreq: 1400, kick: 0.6, kickFreq: 95, tail: 0.25, len: 0.22 }),
  shotgun: (o) => gunshot(o, { crack: 0.5, body: 0.95, bodyFreq: 1100, kick: 0.95, kickFreq: 62, tail: 0.5, len: 0.45 }),
  rifle: (o) => gunshot(o, { crack: 0.4, body: 0.45, bodyFreq: 1800, kick: 0.5, kickFreq: 85, tail: 0.2, len: 0.16 }),
  laser: (o) => { gunshot(o, { crack: 0.2, body: 0.35, bodyFreq: 1600, kick: 0.55, kickFreq: 70, tail: 0.2, len: 0.25 }); tone(o, { freq: 1100, dur: 0.22, vol: 0.14, type: 'sawtooth', slide: -900, drive: true }); },
  rocket: (o) => { noise(o, { dur: 0.7, freq: 600, vol: 0.8, sweep: 1400, attack: 0.03 }); tone(o, { freq: 48, dur: 0.6, vol: 0.8, slide: -15, drive: true }); noise(o, { dur: 1.2, freq: 260, vol: 0.35, delay: 0.1 }); },
  swing: (o) => { tone(o, { freq: 300, dur: 0.15, vol: 0.12, type: 'sawtooth', slide: 600 }); noise(o, { dur: 0.12, freq: 2500, type: 'bandpass', q: 2, vol: 0.18, sweep: 2500 }); },
  katana: (o) => { tone(o, { freq: 520, dur: 0.3, vol: 0.12, type: 'sawtooth', slide: 900, vibrato: 30 }); noise(o, { dur: 0.15, freq: 4000, type: 'bandpass', q: 3, vol: 0.15, sweep: 3000 }); },
  chainsaw: (o) => { tone(o, { freq: r(85, 100), dur: 0.12, vol: 0.22, type: 'sawtooth', vibrato: 35, drive: true }); noise(o, { dur: 0.1, freq: 1200, vol: 0.12 }); },
  // turrets (pitch and weight rise with size)
  laser_s: (o) => { tone(o, { freq: r(1100, 1300), dur: 0.1, vol: 0.13, type: 'sawtooth', slide: -900, drive: true }); tone(o, { freq: 90, dur: 0.09, vol: 0.32, slide: -40, drive: true }); noise(o, { dur: 0.05, freq: 2400, type: 'bandpass', vol: 0.15 }); },
  laser_m: (o) => { tone(o, { freq: r(700, 820), dur: 0.2, vol: 0.18, type: 'sawtooth', slide: -500, drive: true }); tone(o, { freq: 70, dur: 0.18, vol: 0.45, slide: -30, drive: true }); noise(o, { dur: 0.25, freq: 900, vol: 0.3, sweep: -500 }); },
  laser_l: (o) => { tone(o, { freq: 420, dur: 0.55, vol: 0.3, type: 'sawtooth', slide: -330, drive: true }); noise(o, { dur: 0.6, freq: 1400, vol: 0.5, sweep: -1100 }); tone(o, { freq: 42, dur: 0.6, vol: 0.85, slide: -12, drive: true }); noise(o, { dur: 1.1, freq: 220, vol: 0.3, delay: 0.15 }); },
  rail_l: (o) => { tone(o, { freq: 300, dur: 0.25, vol: 0.12, type: 'sawtooth', slide: 2600, attack: 0.2 }); noise(o, { dur: 0.25, freq: 6000, type: 'highpass', vol: 0.45, delay: 0.2 }); tone(o, { freq: 50, dur: 0.6, vol: 0.5, drive: true, delay: 0.2 }); },
  tesla: (o) => { tone(o, { freq: 2600, dur: 0.2, vol: 0.12, type: 'sawtooth', slide: -2200 }); noise(o, { dur: 0.2, freq: 6000, type: 'highpass', vol: 0.25 }); noise(o, { dur: 0.06, freq: 3000, type: 'bandpass', vol: 0.2, delay: 0.08 }); },
  flak: (o) => gunshot(o, { crack: 0.45, body: 0.8, bodyFreq: 900, kick: 0.85, kickFreq: 58, tail: 0.45, len: 0.35 }),
  launch: (o) => { noise(o, { dur: 0.5, freq: 900, vol: 0.4, sweep: 2000, attack: 0.03 }); tone(o, { freq: 200, dur: 0.4, vol: 0.12, type: 'sawtooth', slide: 600 }); },
  mortar: (o) => { tone(o, { freq: 90, dur: 0.35, vol: 0.5, slide: -40, drive: true }); noise(o, { dur: 0.3, freq: 500, vol: 0.4 }); tone(o, { freq: 600, dur: 0.6, vol: 0.06, type: 'sine', slide: -500, delay: 0.1 }); },
  hq: (o) => { tone(o, { freq: 900, dur: 0.12, vol: 0.12, type: 'sawtooth', slide: -700, drive: true }); tone(o, { freq: 80, dur: 0.12, vol: 0.35, slide: -30, drive: true }); },
  drone: (o) => gunshot(o, { crack: 0.2, body: 0.25, bodyFreq: 2000, kick: 0.25, kickFreq: 110, tail: 0.08, len: 0.1 }),
  // impacts & destruction
  hit: (o) => { noise(o, { dur: 0.05, freq: r(2500, 3500), vol: 0.22, type: 'bandpass', q: 2 }); tone(o, { freq: r(700, 1000), dur: 0.05, vol: 0.06, type: 'square' }); },
  metalkill: (o) => { noise(o, { dur: 0.25, freq: 2200, vol: 0.4, type: 'bandpass', q: 1.5, sweep: -1500 }); tone(o, { freq: r(300, 420), dur: 0.2, vol: 0.12, type: 'square', slide: -250 }); noise(o, { dur: 0.15, freq: 7000, type: 'highpass', vol: 0.15, delay: 0.05 }); },
  boom: (o) => { noise(o, { dur: 1.4, freq: 900, vol: 1, sweep: -800 }); tone(o, { freq: 55, dur: 0.9, vol: 0.8, slide: -30, drive: true }); noise(o, { dur: 0.1, freq: 4000, type: 'highpass', vol: 0.4 }); },
  splat: (o) => { tone(o, { freq: 600, dur: 0.15, vol: 0.12, type: 'sine', slide: -450 }); noise(o, { dur: 0.15, freq: 1200, vol: 0.2 }); },
  destroyed: (o) => { noise(o, { dur: 0.8, freq: 1400, vol: 0.6, sweep: -1200 }); noise(o, { dur: 0.08, freq: 3000, type: 'bandpass', vol: 0.3, delay: 0.15 }); tone(o, { freq: 70, dur: 0.5, vol: 0.4, drive: true }); },
  shieldhit: (o) => { tone(o, { freq: 1200, dur: 0.2, vol: 0.12, type: 'sine', slide: -500 }); tone(o, { freq: 1810, dur: 0.14, vol: 0.06, type: 'triangle' }); },
  hurt: (o) => { tone(o, { freq: 240, dur: 0.16, vol: 0.28, type: 'square', slide: -140 }); noise(o, { dur: 0.1, freq: 800, vol: 0.2 }); },
  wasp: (o) => tone(o, { freq: r(180, 240), dur: 0.5, vol: 0.06, type: 'sawtooth', vibrato: 40, attack: 0.1 }),
  servo: (o) => tone(o, { freq: r(300, 500), dur: 0.25, vol: 0.05, type: 'square', slide: r(-200, 200), attack: 0.05, filter: 1200 }),
  boss: (o) => { tone(o, { freq: 45, dur: 2.4, vol: 0.6, type: 'sawtooth', slide: -14, drive: true, attack: 0.2 }); noise(o, { dur: 2, freq: 260, vol: 0.5, attack: 0.3 }); tone(o, { freq: 90, dur: 1.8, vol: 0.25, type: 'square', vibrato: 6, attack: 0.3, filter: 600 }); },
  stomp: (o) => { tone(o, { freq: 38, dur: 0.9, vol: 0.9, type: 'sine', slide: -15 }); noise(o, { dur: 0.7, freq: 220, vol: 0.8 }); },
  // mining & logistics
  dig: (o) => { noise(o, { dur: 0.09, freq: r(600, 900), vol: 0.22, type: 'bandpass', q: 3 }); tone(o, { freq: r(110, 140), dur: 0.08, vol: 0.1, type: 'sawtooth', filter: 800 }); },
  dug: (o) => { noise(o, { dur: 0.6, freq: 500, vol: 0.55, sweep: -350 }); noise(o, { dur: 0.08, freq: 1800, type: 'bandpass', vol: 0.25, delay: 0.1 }); noise(o, { dur: 0.08, freq: 1500, type: 'bandpass', vol: 0.2, delay: 0.22 }); },
  ore: (o) => { tone(o, { freq: 1320, dur: 0.12, vol: 0.12, type: 'triangle' }); tone(o, { freq: 1760, dur: 0.2, vol: 0.1, type: 'triangle', delay: 0.07 }); },
  ore_rare: (o) => [1568, 2093, 2637].forEach((f, i) => tone(o, { freq: f, dur: 0.3, vol: 0.1, type: 'triangle', delay: i * 0.06 })),
  deposit: (o) => { noise(o, { dur: 0.5, freq: 400, vol: 0.25, sweep: 1500, attack: 0.1 }); tone(o, { freq: 523, dur: 0.15, vol: 0.08, type: 'triangle', delay: 0.3 }); },
  elevator: (o) => { tone(o, { freq: 60, dur: 1.4, vol: 0.3, type: 'sawtooth', filter: 300, attack: 0.2 }); noise(o, { dur: 0.08, freq: 2000, type: 'bandpass', vol: 0.3, delay: 1.2 }); tone(o, { freq: 880, dur: 0.3, vol: 0.08, type: 'sine', delay: 1.3 }); },
  drill: (o) => { tone(o, { freq: r(160, 200), dur: 0.3, vol: 0.08, type: 'sawtooth', vibrato: 20, filter: 900 }); noise(o, { dur: 0.2, freq: 700, vol: 0.1 }); },
  // building & power
  build: (o) => { noise(o, { dur: 0.05, freq: 2000, vol: 0.3, type: 'bandpass', q: 3 }); noise(o, { dur: 0.05, freq: 1800, vol: 0.25, type: 'bandpass', q: 3, delay: 0.09 }); tone(o, { freq: 160, dur: 0.1, vol: 0.2 }); },
  built: (o) => { tone(o, { freq: 392, dur: 0.12, vol: 0.1, type: 'triangle' }); tone(o, { freq: 587, dur: 0.2, vol: 0.1, type: 'triangle', delay: 0.08 }); },
  upgrade: (o) => [440, 554, 659, 880].forEach((f, i) => tone(o, { freq: f, dur: 0.25, vol: 0.12, type: 'square', delay: i * 0.06, filter: 3000 })),
  wire: (o) => { tone(o, { freq: 3000, dur: 0.12, vol: 0.1, type: 'sawtooth', slide: -2400 }); noise(o, { dur: 0.08, freq: 6000, type: 'highpass', vol: 0.15 }); },
  powerdown: (o) => { tone(o, { freq: 400, dur: 1.2, vol: 0.25, type: 'sawtooth', slide: -360, filter: 1400 }); noise(o, { dur: 0.1, freq: 900, vol: 0.3 }); },
  powerup: (o) => tone(o, { freq: 60, dur: 0.9, vol: 0.2, type: 'sawtooth', slide: 300, filter: 1200, attack: 0.3 }),
  module: (o) => { tone(o, { freq: 880, dur: 0.08, vol: 0.1, type: 'square' }); tone(o, { freq: 1320, dur: 0.15, vol: 0.1, type: 'square', delay: 0.08 }); noise(o, { dur: 0.05, freq: 3000, type: 'bandpass', vol: 0.2 }); },
  // ui & alerts
  wave: (o) => { tone(o, { freq: 440, dur: 1.4, vol: 0.18, type: 'sawtooth', slide: 220, attack: 0.3, filter: 2000 }); tone(o, { freq: 330, dur: 1.4, vol: 0.14, type: 'sawtooth', slide: 165, attack: 0.3, filter: 2000, delay: 0.7 }); tone(o, { freq: 55, dur: 1.6, vol: 0.4, type: 'sawtooth', drive: true, delay: 0.2 }); },
  cleared: (o) => [523, 659, 784, 1046].forEach((f, i) => tone(o, { freq: f, dur: 0.4, vol: 0.12, type: 'triangle', delay: i * 0.1 })),
  alarm: (o) => { for (let i = 0; i < 3; i++) tone(o, { freq: 880, dur: 0.15, vol: 0.12, type: 'square', delay: i * 0.3 }); },
  o2alarm: (o) => { tone(o, { freq: 1200, dur: 0.1, vol: 0.12, type: 'square' }); tone(o, { freq: 1200, dur: 0.1, vol: 0.12, type: 'square', delay: 0.18 }); },
  pickup: (o) => { tone(o, { freq: 988, dur: 0.07, vol: 0.1, type: 'square' }); tone(o, { freq: 1319, dur: 0.1, vol: 0.1, type: 'square', delay: 0.06 }); },
  loot: (o) => [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(o, { freq: f, dur: 0.35, vol: 0.1, type: 'triangle', delay: i * 0.07 })),
  research: (o) => [523, 784, 1046, 1568].forEach((f, i) => tone(o, { freq: f, dur: 0.5, vol: 0.1, type: 'sine', delay: i * 0.12 })),
  cash: (o) => { tone(o, { freq: 1568, dur: 0.12, vol: 0.12, type: 'triangle' }); tone(o, { freq: 2093, dur: 0.3, vol: 0.12, type: 'triangle', delay: 0.08 }); },
  click: (o) => tone(o, { freq: 1800, dur: 0.03, vol: 0.06, type: 'square' }),
  deny: (o) => { tone(o, { freq: 160, dur: 0.12, vol: 0.2, type: 'square' }); tone(o, { freq: 120, dur: 0.18, vol: 0.2, type: 'square', delay: 0.1 }); },
  level: (o) => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(o, { freq: f, dur: 0.3, vol: 0.15, type: 'triangle', delay: i * 0.08 })),
  thunder: (o) => { noise(o, { dur: 3, freq: 180, vol: 0.9, attack: 0.05 }); noise(o, { dur: 1.5, freq: 600, vol: 0.4, delay: 0.1, sweep: -400 }); },
  heal: (o) => [660, 880, 1100].forEach((f, i) => tone(o, { freq: f, dur: 0.25, vol: 0.08, type: 'sine', delay: i * 0.05 })),
  footstep: (o) => { noise(o, { dur: 0.06, freq: r(250, 400), vol: 0.14, type: 'bandpass', q: 2 }); tone(o, { freq: 70, dur: 0.05, vol: 0.06 }); },
  fall: (o) => { noise(o, { dur: 0.2, freq: 300, vol: 0.5 }); tone(o, { freq: 90, dur: 0.15, vol: 0.3 }); },
  reload: (o) => { tone(o, { freq: 400, dur: 0.3, vol: 0.08, type: 'sawtooth', slide: 800, filter: 2000 }); noise(o, { dur: 0.05, freq: 1800, type: 'bandpass', q: 4, vol: 0.2, delay: 0.3 }); },
  robot: (o) => { tone(o, { freq: 880, dur: 0.06, vol: 0.08, type: 'square' }); tone(o, { freq: 1320, dur: 0.06, vol: 0.08, type: 'square', delay: 0.08 }); },
};

export function sfx(name, pos = null, { gap = 40, vol = 1, verb = 1 } = {}) {
  if (settings.muted || !SOUNDS[name] || !ensure() || ac.state !== 'running') return;
  const now = performance.now();
  if (last[name] && now - last[name] < gap) return;
  const v = voice(pos, vol, verb);
  if (!v.audible) return;
  last[name] = now;
  SOUNDS[name](v.out);
}

// ------------------------------------------------------------------ ambience beds
export function setAmbience({ wind = 'calm', underground = false, combat = false } = {}) {
  if (!ensure() || ac.state !== 'running') return;
  if (!ambient) {
    const mk = (freq, type, q) => {
      const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ac.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(buses.ambience); src.start();
      return g;
    };
    const hum = ac.createOscillator(); hum.type = 'sine'; hum.frequency.value = 48;
    const hg = ac.createGain(); hg.gain.value = 0; hum.connect(hg); hg.connect(buses.ambience); hum.start();
    ambient = { wind: mk(380, 'bandpass', 0.5), rumble: mk(90, 'lowpass', 0.7), hiss: mk(5000, 'highpass', 0.3), hum: hg };
  }
  const t = ac.currentTime;
  ambient.wind.gain.setTargetAtTime(underground ? 0.01 : wind === 'storm' ? 0.16 : wind === 'dust' ? 0.08 : 0.03, t, 1);
  ambient.rumble.gain.setTargetAtTime(underground ? 0.12 : combat ? 0.05 : 0.02, t, 1.5);
  ambient.hiss.gain.setTargetAtTime(wind === 'storm' && !underground ? 0.03 : 0.004, t, 1);
  ambient.hum.gain.setTargetAtTime(underground ? 0.05 : 0.015, t, 1);
}

// ------------------------------------------------------------------ music sequencer
// A minor progression (Am - F - C - G); each state changes tempo, drums and instruments.
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const BASS = [45, 41, 36, 43];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const music = { state: 'off', step: 0, nextTime: 0, timer: null, intensity: 0 };
const STATES = {
  build: { bpm: 86, drums: 0, arp: 0.5, pad: 1, bass: 0.5 },
  battle: { bpm: 132, drums: 1, arp: 1, pad: 0.5, bass: 1 },
  boss: { bpm: 140, drums: 1.2, arp: 1, pad: 0.6, bass: 1.3, heavy: true },
  under: { bpm: 72, drums: 0, arp: 0.3, pad: 1, bass: 0.4, dark: true },
};

function scheduleStep(st, t) {
  const out = buses.music;
  const s = music.step % 64, bar = Math.floor(s / 16) % 4, beat = s % 16;
  const chord = CHORDS[bar];
  const dur16 = 60 / st.bpm / 4;
  if (st.drums) {
    if (beat % 4 === 0) { tone(out, { freq: 150, dur: 0.25, vol: 0.55 * st.drums, slide: -110, at: t }); }
    if (beat === 4 || beat === 12) { noise(out, { dur: 0.18, freq: 1800, type: 'bandpass', q: 0.8, vol: 0.32 * st.drums, at: t }); tone(out, { freq: 190, dur: 0.1, vol: 0.12, at: t }); }
    if (music.intensity > 0.3 || st.heavy) noise(out, { dur: 0.04, freq: 8000, type: 'highpass', vol: (beat % 2 ? 0.05 : 0.09) * st.drums, at: t });
    if (st.heavy && beat % 8 === 6) tone(out, { freq: 110, dur: 0.2, vol: 0.3, slide: -50, at: t });
  }
  if (st.bass && (st.drums ? beat % 2 === 0 : beat % 8 === 0)) {
    const note = BASS[bar] + (st.drums && beat % 8 === 6 ? 12 : 0);
    tone(out, { freq: mtof(note), dur: dur16 * (st.drums ? 1.8 : 7), vol: 0.22 * st.bass, type: 'sawtooth', filter: st.heavy ? 900 : 500, drive: !!st.heavy, at: t });
  }
  if (st.arp && (st.drums ? true : beat % 2 === 0) && Math.random() < 0.55 + music.intensity * 0.4) {
    const n = chord[(s * 7) % 3] + 12 + (beat % 8 === 4 ? 12 : 0) - (st.dark ? 12 : 0);
    tone(out, { freq: mtof(n), dur: dur16 * 1.6, vol: 0.07 * st.arp, type: st.drums ? 'square' : 'triangle', filter: 2400, at: t });
  }
  if (st.pad && beat === 0) for (const m of chord) {
    for (const det of [-8, 8]) tone(out, { freq: mtof(m - (st.dark ? 12 : 0)), dur: dur16 * 16, vol: 0.035 * st.pad, type: 'sawtooth', attack: dur16 * 4, detune: det, filter: st.dark ? 600 : 1100, at: t });
  }
}

function musicTick() {
  if (!ac || music.state === 'off') return;
  const st = STATES[music.state];
  while (music.nextTime < ac.currentTime + 0.12) {
    scheduleStep(st, music.nextTime);
    music.nextTime += 60 / st.bpm / 4;
    music.step++;
  }
}

export function setMusic(state, intensity = 0) {
  music.intensity = intensity;
  if (!ensure() || ac.state !== 'running' || music.state === state) return;
  music.state = state;
  music.nextTime = ac.currentTime + 0.05;
  if (!music.timer) music.timer = setInterval(musicTick, 25);
}
