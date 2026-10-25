/* ===== src/core.js ===== */
'use strict';
/* =====================================================================
   Konfetti – Partyspiele für Kinder ab 2 und ab 4
   Kern: Canvas, Skalierung, Spielschleife, Eingabe (ein Finger), Tweens,
   Partikel, Ton (WebAudio, live erzeugt), Musik, Sprache (iPad-Sprachausgabe),
   Zeigehand-Hilfe, Szenenwechsel.
   Logisches Koordinatensystem: sicherer Bereich 1024×768 (iPad 4:3);
   Hintergründe werden bis zu den echten Bildschirmrändern verlängert.
   ===================================================================== */
const TAU = Math.PI * 2;
const DW = 1024, DH = 768;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function sample(arr, n) { return shuffle(arr.slice()).slice(0, n); }

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const View = {
  cw: 0, ch: 0, dpr: 1, sc: 1, vw: DW, vh: DH, ox: 0, oy: 0,
  get L() { return -this.ox; }, get T() { return -this.oy; },
  get R() { return DW + this.ox; }, get B() { return DH + this.oy; },
  get portrait() { return this.ch > this.cw * 1.05; },
};
function resize() {
  const w = Math.max(1, canvas.clientWidth || window.innerWidth), h = Math.max(1, canvas.clientHeight || window.innerHeight);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  View.cw = w; View.ch = h; View.dpr = dpr;
  View.sc = Math.min(w / DW, h / DH);
  View.vw = w / View.sc; View.vh = h / View.sc;
  View.ox = (View.vw - DW) / 2; View.oy = (View.vh - DH) / 2;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 60));
resize();

/* ---------- Speicher: Einstellungen und Fortschritt (je Altersstufe) ---------- */
const Store = {
  key: 'konfetti-v1', data: null,
  fresh() { return { settings: { music: true, sfx: true, voice: true }, mode: 'small', hero: null, done: { small: {}, big: {} }, party: { small: false, big: false }, plays: 0 }; },
  load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(this.key) || 'null'); } catch (e) { d = null; }
    const f = this.fresh();
    if (!d || typeof d !== 'object') d = f;
    d.settings = Object.assign(f.settings, d.settings || {});
    if (d.mode !== 'small' && d.mode !== 'big') d.mode = 'small';
    d.done = d.done || f.done; d.done.small = d.done.small || {}; d.done.big = d.done.big || {};
    d.party = d.party || f.party; d.plays = d.plays || 0;
    if (typeof d.hero !== 'string') d.hero = null;
    this.data = d;
  },
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) { /* privat/gesperrt: egal */ } },
  resetProgress(mode) { this.data.done[mode] = {}; this.data.party[mode] = false; this.save(); },
};
Store.load();

/* ---------- Easing / Tweens / Timer ---------- */
const Ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  inBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return c3 * t * t * t - c1 * t * t; },
  outElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
  outBounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};
const Tweens = {
  list: [],
  add(obj, props, dur, opts = {}) {
    const tw = { obj, props, dur: Math.max(0.0001, dur), t: -(opts.delay || 0), ease: Ease[opts.ease || 'outCubic'] || Ease.outCubic, from: null, done: opts.done, update: opts.update, owner: opts.owner !== undefined ? opts.owner : Game.scene };
    this.list.push(tw);
    return tw;
  },
  kill(obj) { for (const t of this.list) if (t.obj === obj) t.dead = true; },
  killOwner(o) { for (const t of this.list) if (t.owner === o) t.dead = true; },
  update(dt) {
    for (let i = 0; i < this.list.length; i++) {
      const tw = this.list[i];
      if (tw.dead) continue;
      tw.t += dt;
      if (tw.t < 0) continue;
      if (!tw.from) { tw.from = {}; for (const k in tw.props) tw.from[k] = tw.obj[k]; }
      const p = Math.min(1, tw.t / tw.dur), e = tw.ease(p);
      for (const k in tw.props) tw.obj[k] = tw.from[k] + (tw.props[k] - tw.from[k]) * e;
      if (tw.update) tw.update(p);
      if (p >= 1) { tw.dead = true; if (tw.done) tw.done(); }
    }
    if (this.list.some((t) => t.dead)) this.list = this.list.filter((t) => !t.dead);
  },
};
const tween = (o, p, d, opts) => Tweens.add(o, p, d, opts);
const Timers = {
  list: [],
  after(sec, fn, owner) { const t = { at: Game.time + sec, fn, owner: owner !== undefined ? owner : Game.scene }; this.list.push(t); return t; },
  cancel(t) { if (t) t.dead = true; },
  clearOwner(o) { for (const t of this.list) if (t.owner === o) t.dead = true; },
  update() {
    const now = Game.time, due = [];
    for (const t of this.list) if (!t.dead && t.at <= now) { due.push(t); t.dead = true; }
    if (due.length || this.list.some((t) => t.dead)) this.list = this.list.filter((t) => !t.dead);
    for (const t of due) if (t.owner === 'global' || t.owner === Game.scene || (t.owner && t.owner.alive)) { try { t.fn(); } catch (e) { console.error(e); } }
  },
};
const after = (s, fn, owner) => Timers.after(s, fn, owner);

/* ---------- Partikel: Konfetti, Funken, Sterne, Wölkchen, Ringe, Herzen ---------- */
const Particles = {
  list: [],
  add(p) {
    p.age = 0; p.life = p.life || 1; p.vx = p.vx || 0; p.vy = p.vy || 0; p.g = p.g || 0; p.drag = p.drag || 0;
    p.rot = p.rot || 0; p.vr = p.vr || 0; p.size = p.size || 8; p.alpha = p.alpha === undefined ? 1 : p.alpha; p.layer = p.layer || 0;
    this.list.push(p);
    if (this.list.length > 600) this.list.splice(0, this.list.length - 600);
    return p;
  },
  burst(type, x, y, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = o.angle !== undefined ? o.angle + rand(-(o.spread || Math.PI), o.spread || Math.PI) : rand(0, TAU);
      const sp = rand((o.speed || 200) * 0.4, o.speed || 200);
      const col = Array.isArray(o.colors) ? pick(o.colors) : (o.color || '#fff');
      this.add({ type, x: x + rand(-(o.jitter || 0), o.jitter || 0), y: y + rand(-(o.jitter || 0), o.jitter || 0), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: o.g || 0, drag: o.drag || 0, life: rand((o.life || 1) * 0.7, o.life || 1), size: rand((o.size || 10) * 0.6, o.size || 10), color: col, rot: rand(0, TAU), vr: rand(-6, 6), layer: o.layer || 0, floor: o.floor });
    }
  },
  confettiRain(n, o = {}) {
    for (let i = 0; i < n; i++) this.add({ type: 'confetti', x: rand(View.L, View.R), y: rand(View.T - 300, View.T - 10), vx: rand(-30, 30), vy: rand(60, 160), g: 40, drag: 0.4, life: rand(4, 7), size: rand(8, 16), color: pick(CONFETTI), rot: rand(0, TAU), vr: rand(-5, 5), layer: o.layer || 1, sway: rand(1, 3) });
  },
  update(dt) {
    for (const p of this.list) {
      p.age += dt; p.vy += p.g * dt;
      if (p.drag) { const f = Math.max(0, 1 - p.drag * dt); p.vx *= f; p.vy *= f; }
      p.x += p.vx * dt + (p.sway ? Math.sin(p.age * p.sway + p.rot) * 40 * dt : 0); p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.floor !== undefined && p.y > p.floor) { p.y = p.floor; p.vy *= -0.3; p.vx *= 0.6; }
    }
    if (this.list.some((p) => p.age >= p.life)) this.list = this.list.filter((p) => p.age < p.life);
  },
  draw(c, layer = 0) {
    for (const p of this.list) {
      if (p.layer !== layer) continue;
      const k = p.age / p.life;
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
      switch (p.type) {
        case 'confetti':
          c.globalAlpha = p.alpha * (k > 0.8 ? (1 - k) / 0.2 : 1);
          c.scale(1, Math.abs(Math.sin(p.age * 9 + p.rot)) * 0.9 + 0.1);
          c.fillStyle = p.color; c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          break;
        case 'spark': {
          c.globalAlpha = p.alpha * (1 - k); const s = p.size * (1 - k * 0.5);
          c.fillStyle = p.color; c.beginPath();
          for (let i = 0; i < 8; i++) { const r = i % 2 ? s * 0.32 : s, an = (i / 8) * TAU; c.lineTo(Math.cos(an) * r, Math.sin(an) * r); }
          c.closePath(); c.fill(); break;
        }
        case 'star':
          c.globalAlpha = p.alpha * (k > 0.7 ? (1 - k) / 0.3 : 1);
          Draw.starPath(c, 0, 0, p.size, p.size * 0.48, 5); c.fillStyle = p.color; c.fill(); c.lineWidth = 2; c.strokeStyle = shade(p.color, -0.35); c.stroke();
          break;
        case 'puff':
          c.globalAlpha = p.alpha * (1 - k) * 0.85; c.fillStyle = p.color; c.beginPath(); c.arc(0, 0, p.size * (0.6 + k * 0.8), 0, TAU); c.fill(); break;
        case 'ring':
          c.globalAlpha = p.alpha * (1 - k); c.lineWidth = 5 * (1 - k) + 1; c.strokeStyle = p.color; c.beginPath(); c.arc(0, 0, p.size * (0.3 + k * 1.2), 0, TAU); c.stroke(); break;
        case 'heart':
          c.globalAlpha = p.alpha * (k > 0.6 ? (1 - k) / 0.4 : Math.min(1, k * 6)); c.rotate(-p.rot + Math.sin(p.age * 4) * 0.25);
          Draw.heartPath(c, 0, 0, p.size); c.fillStyle = p.color; c.fill(); break;
        case 'bubble':
          c.globalAlpha = p.alpha * (k > 0.8 ? (1 - k) / 0.2 : 0.9); c.beginPath(); c.arc(0, 0, p.size, 0, TAU);
          c.fillStyle = 'rgba(255,255,255,0.35)'; c.fill(); c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,0.9)'; c.stroke(); break;
        default: break;
      }
      c.restore();
    }
  },
  clear() { this.list.length = 0; },
};
const CONFETTI = ['#eb4642', '#f4d918', '#5fcf2a', '#1a7ef0', '#f08ae6', '#8a5bd6', '#ff9a2e', '#ffffff'];

/* ---------- Spielzustand & Szenenwechsel ---------- */
const Game = {
  scene: null, overlay: null, time: 0, lastInput: 0, trans: null, dragging: false,
  get mode() { return Store.data.mode; },
  get small() { return Store.data.mode === 'small'; },
};
function swapScene(sc) {
  const old = Game.scene;
  if (old) { old.alive = false; if (old.exit) old.exit(); Timers.clearOwner(old); Tweens.killOwner(old); }
  Particles.clear(); Hand.stop(); Game.dragging = false; Game.overlay = null;
  Game.scene = sc; sc.alive = true; Game.lastInput = Game.time;
  if (sc.enter) sc.enter();
}
function setScene(sc, opts = {}) {
  if (!Game.scene || opts.instant) { swapScene(sc); return; }
  if (Game.trans) return;
  Game.trans = { t: 0, dur: opts.dur || 0.7, next: sc, swapped: false, color: opts.color || '#f4d918' };
  Sound.play('whoosh');
}

/* ---------- Eingabe: nur ein Finger zählt (Kleinkind-Handballen werden ignoriert) ---------- */
const Input = { active: null, x: 0, y: 0, down: false };
function toGame(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / View.sc - View.ox, y: (e.clientY - r.top) / View.sc - View.oy, id: e.pointerId }; }
function inputTarget() { return Game.overlay || Game.scene; }
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (Input.active !== null) return;
  Input.active = e.pointerId;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetische Events */ }
  const p = toGame(e);
  Input.x = p.x; Input.y = p.y; Input.down = true; Game.lastInput = Game.time;
  Sound.unlock(); Voice.warm(); Hand.userTouched();
  if (Game.trans) return;
  const t = inputTarget(); if (t && t.down) t.down(p);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== Input.active) return;
  const p = toGame(e); Input.x = p.x; Input.y = p.y; Game.lastInput = Game.time;
  if (Game.trans) return;
  const t = inputTarget(); if (t && t.move) t.move(p);
});
function endPointer(e) {
  if (e.pointerId !== Input.active) return;
  const p = toGame(e); Input.active = null; Input.down = false; Game.lastInput = Game.time;
  if (Game.trans) return;
  const t = inputTarget(); if (t && t.up) t.up(p);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
for (const ev of ['touchstart', 'touchmove', 'touchend']) document.addEventListener(ev, (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
const inCircle = (p, x, y, r) => (p.x - x) ** 2 + (p.y - y) ** 2 <= r * r;
const inRect = (p, x, y, w, h) => p.x >= x - w / 2 && p.x <= x + w / 2 && p.y >= y - h / 2 && p.y <= y + h / 2;

/* =====================================================================
   Ton: alle Geräusche werden live mit WebAudio erzeugt (keine Dateien).
   ===================================================================== */
const Sound = {
  ctx: null, out: null, sfx: null, music: null, noise: null, unlocked: false,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { this.ctx = null; return; }
    const c = this.ctx;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.out = c.createGain(); this.out.gain.value = 0.9; comp.connect(this.out); this.out.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = Store.data.settings.sfx ? 1 : 0; this.sfx.connect(comp);
    this.music = c.createGain(); this.music.gain.value = 0; this.music.connect(comp);
    const len = Math.floor(c.sampleRate * 2), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  },
  unlock() {
    this.init(); if (!this.ctx) return;
    if (this.ctx.state !== 'running') { try { this.ctx.resume(); } catch (e) { /* */ } }
    if (!this.unlocked) {
      try { const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0); } catch (e) { /* */ }
      this.unlocked = true; Music.maybeStart();
    }
  },
  get ok() { return !!(this.ctx && this.ctx.state === 'running'); },
  applySettings() { if (!this.ctx) return; this.sfx.gain.setTargetAtTime(Store.data.settings.sfx ? 1 : 0, this.ctx.currentTime, 0.05); Music.applyLevel(); },
  tone(o) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime + (o.when || 0), osc = c.createOscillator();
    osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.f, t);
    const a = o.a || 0.006, d = o.dur || 0.2, v = o.vol || 0.25;
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + (o.slide || a + d));
    const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(v, t + a); gn.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    let node = osc;
    if (o.filter) { const f = c.createBiquadFilter(); f.type = o.filter; f.frequency.value = o.ff || 1200; f.Q.value = o.q || 1; osc.connect(f); node = f; }
    node.connect(gn); gn.connect(o.dest || this.sfx);
    if (o.vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = o.vib; lg.gain.value = o.vibAmt || 12; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + a + d + 0.05); }
    osc.start(t); osc.stop(t + a + d + 0.05);
  },
  hiss(o) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime + (o.when || 0), src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = o.filter || 'bandpass'; f.frequency.setValueAtTime(o.f || 1000, t);
    const a = o.a || 0.004, d = o.dur || 0.2;
    if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f2), t + a + d);
    f.Q.value = o.q || 1;
    const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(o.vol || 0.25, t + a); gn.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    src.connect(f); f.connect(gn); gn.connect(o.dest || this.sfx);
    src.start(t, Math.random() * 1.5); src.stop(t + a + d + 0.05);
  },
  play(name, opt = {}) { if (!this.ok || !Store.data.settings.sfx) return; const fn = SFX[name]; if (fn) { try { fn(opt); } catch (e) { /* */ } } },
};
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const SFX = {
  pop(o) { const p = o.pitch || 1; Sound.tone({ f: 380 * p, f2: 900 * p, dur: 0.09, vol: 0.32 }); Sound.hiss({ f: 3000, dur: 0.02, vol: 0.06, filter: 'highpass' }); },
  plop(o) { const p = o.pitch || 1; Sound.tone({ f: 320 * p, f2: 110 * p, dur: 0.14, vol: 0.38, type: 'triangle' }); },
  tap() { Sound.tone({ f: 900, f2: 620, dur: 0.05, vol: 0.14 }); },
  select(o) { const p = o.pitch || 1; Sound.tone({ f: 620 * p, f2: 990 * p, dur: 0.1, vol: 0.2, type: 'triangle' }); },
  boing() { Sound.tone({ f: 170, f2: 430, slide: 0.12, dur: 0.38, vol: 0.26, vib: 13, vibAmt: 30 }); },
  whoosh() { Sound.hiss({ f: 380, f2: 2600, dur: 0.32, vol: 0.2, q: 0.9 }); },
  swish() { Sound.hiss({ f: 1200, f2: 4200, dur: 0.16, vol: 0.18, q: 1.4 }); },
  sparkle() { [1318, 1568, 2093, 2637].forEach((f, i) => Sound.tone({ f, dur: 0.28, vol: 0.09, when: i * 0.055 })); },
  success() { [523, 659, 784, 1047].forEach((f, i) => { Sound.tone({ f, dur: 0.3, vol: 0.14, type: 'triangle', when: i * 0.08 }); Sound.tone({ f: f * 2, dur: 0.18, vol: 0.04, when: i * 0.08 }); }); },
  fanfare() {
    const seq = [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.32], [784, 0.46], [1047, 0.56], [1319, 0.7]];
    seq.forEach(([f, w]) => { Sound.tone({ f, dur: 0.35, vol: 0.15, type: 'triangle', when: w }); Sound.tone({ f: f / 2, dur: 0.3, vol: 0.06, when: w }); });
    [523, 659, 784].forEach((f) => Sound.tone({ f, dur: 1.1, vol: 0.07, when: 0.7 }));
  },
  ding() { Sound.tone({ f: 1568, dur: 1.3, vol: 0.22, a: 0.002 }); Sound.tone({ f: 3136, dur: 0.6, vol: 0.06, a: 0.002 }); Sound.tone({ f: 2093, dur: 0.9, vol: 0.08, a: 0.002, when: 0.02 }); },
  chomp() { Sound.hiss({ f: 900, dur: 0.08, vol: 0.4, filter: 'lowpass' }); Sound.tone({ f: 120, f2: 70, dur: 0.07, vol: 0.14, type: 'square', filter: 'lowpass', ff: 600 }); Sound.hiss({ f: 800, dur: 0.07, vol: 0.32, filter: 'lowpass', when: 0.16 }); Sound.tone({ f: 110, f2: 65, dur: 0.06, vol: 0.12, type: 'square', filter: 'lowpass', ff: 600, when: 0.16 }); },
  giggle() { [900, 820, 960, 780, 900].forEach((f, i) => Sound.tone({ f, f2: f * 0.85, dur: 0.07, vol: 0.12, when: i * 0.09, vib: 30, vibAmt: 40 })); },
  yay() { Sound.tone({ f: 520, f2: 780, dur: 0.18, vol: 0.14, type: 'triangle' }); Sound.tone({ f: 780, f2: 1040, dur: 0.25, vol: 0.12, type: 'triangle', when: 0.16 }); },
  magic() { [1568, 1976, 2349, 2637, 3136].forEach((f, i) => Sound.tone({ f, dur: 0.42, vol: 0.08, when: i * 0.07 })); },
  bell() { Sound.tone({ f: 1046, dur: 0.6, vol: 0.12, a: 0.002 }); Sound.tone({ f: 1568, dur: 0.5, vol: 0.06, a: 0.002, when: 0.05 }); },
  click() { Sound.hiss({ f: 4000, dur: 0.015, vol: 0.18, filter: 'highpass' }); },
  thud() { Sound.tone({ f: 140, f2: 60, dur: 0.12, vol: 0.3, type: 'triangle' }); Sound.hiss({ f: 500, dur: 0.05, vol: 0.15, filter: 'lowpass' }); },
  honk() { Sound.tone({ f: 330, dur: 0.18, vol: 0.2, type: 'sawtooth', filter: 'lowpass', ff: 1200, q: 3 }); Sound.tone({ f: 392, dur: 0.22, vol: 0.18, type: 'sawtooth', filter: 'lowpass', ff: 1200, q: 3, when: 0.2 }); },
  slide() { Sound.tone({ f: 600, f2: 1400, dur: 0.22, vol: 0.12, type: 'triangle' }); },
  drum() { Sound.tone({ f: 160, f2: 50, dur: 0.18, vol: 0.4, a: 0.003 }); Sound.hiss({ f: 1800, dur: 0.06, vol: 0.2 }); },
  lid() { Sound.hiss({ f: 2200, dur: 0.05, vol: 0.2, filter: 'highpass' }); Sound.tone({ f: 700, f2: 420, dur: 0.08, vol: 0.14, type: 'triangle' }); },
  crunch() { for (let i = 0; i < 3; i++) Sound.hiss({ f: rand(1500, 2500), q: 2, dur: 0.04, vol: 0.28, when: i * 0.05 }); },
  count(o) { const n = o.n || 1; Sound.tone({ f: NOTE(72 + Math.min(12, n * 2)), dur: 0.18, vol: 0.14, type: 'triangle' }); },
};

/* ---------- Musik: ein eigenes Party-Thema als Spieluhr/Marimba-Schleife ---------- */
const Music = {
  on: false, timer: null, next: 0, step: 0, spec: null, level: 0.42, muted: false,
  sd: 0.19, // Schrittlänge in Sekunden (Achtel bei 158 bpm)
  melody: ['C5 E5 G5 E5 C5 E5 G5:2', 'A5 G5 E5 D5 E5:4', 'D5 F5 A5 F5 D5 F5 A5:2', 'G5 F5 E5 D5 C5:4', 'E5 G5 C6 G5 E5 G5 C6:2', 'B5 A5 G5 A5 B5:2 G5:2', 'A5 F5 D5 F5 G5 E5 C5 E5', 'D5:2 B4:2 C5:4'],
  bass: ['C3:4 G3:4', 'A3:4 E3:4', 'D3:4 A3:4', 'G3:4 D3:4', 'C3:4 E3:4', 'G3:4 D3:4', 'F3:4 G3:4', 'G3:4 C3:4'],
  perc: 'k . h . k . h h',
  parse(bars) {
    const NN = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }, ev = [];
    let s = 0;
    for (const tok of bars.join(' ').trim().split(/\s+/)) {
      const m = /^(-|[A-G][#b]?\d)(?::(\d+))?$/.exec(tok); if (!m) continue;
      const n = m[2] ? +m[2] : 1;
      if (m[1] !== '-') { const mm = /^([A-G])([#b]?)(\d)$/.exec(m[1]); ev.push({ s, n, midi: 12 * (+mm[3] + 1) + NN[mm[1]] + (mm[2] === '#' ? 1 : mm[2] === 'b' ? -1 : 0) }); }
      s += n;
    }
    const at = new Array(s); for (const e of ev) (at[e.s] = at[e.s] || []).push(e);
    return { at, len: s };
  },
  build() { if (!this.spec) this.spec = { mel: this.parse(this.melody), bass: this.parse(this.bass), perc: this.perc.replace(/\s+/g, '').split('') }; },
  inst(f, t, dur, vol) {
    const c = Sound.ctx, d = Sound.music;
    const o1 = c.createOscillator(), g1 = c.createGain(); o1.type = 'sine'; o1.frequency.value = f;
    g1.gain.setValueAtTime(0.0001, t); g1.gain.exponentialRampToValueAtTime(vol, t + 0.004); g1.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(1.2, dur * 1.6)); o1.connect(g1); g1.connect(d); o1.start(t); o1.stop(t + 1.3);
    const o2 = c.createOscillator(), g2 = c.createGain(); o2.type = 'triangle'; o2.frequency.value = f * 2;
    g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(vol * 0.25, t + 0.003); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.18); o2.connect(g2); g2.connect(d); o2.start(t); o2.stop(t + 0.25);
  },
  bassInst(f, t, dur, vol) {
    const c = Sound.ctx, d = Sound.music, o = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.value = 700;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.2, dur * 0.9));
    o.connect(fl); fl.connect(g); g.connect(d); o.start(t); o.stop(t + dur + 0.1);
  },
  percInst(ch, t) {
    const c = Sound.ctx, d = Sound.music;
    if (ch === 'k') { const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.1); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(g); g.connect(d); o.start(t); o.stop(t + 0.25); }
    if (ch === 'h') { const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = Sound.noise; f.type = 'highpass'; f.frequency.value = 7000; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04); s.connect(f); f.connect(g); g.connect(d); s.start(t, Math.random()); s.stop(t + 0.06); }
  },
  tick() {
    if (!this.on || !Sound.ok) return;
    const c = Sound.ctx;
    while (this.next < c.currentTime + 0.35) {
      const t = Math.max(this.next, c.currentTime + 0.01), sp = this.spec, st = this.step;
      const m = sp.mel.at[st % sp.mel.len]; if (m) for (const e of m) this.inst(NOTE(e.midi), t, e.n * this.sd, 0.16);
      const b = sp.bass.at[st % sp.bass.len]; if (b) for (const e of b) this.bassInst(NOTE(e.midi), t, e.n * this.sd, 0.2);
      const p = sp.perc[st % sp.perc.length]; if (p !== '.') this.percInst(p, t);
      this.step++; this.next += this.sd;
    }
  },
  maybeStart() { if (Store.data.settings.music && Sound.ok) this.start(); },
  start() {
    if (this.on || !Sound.ok) return;
    this.build(); this.on = true; this.step = 0; this.next = Sound.ctx.currentTime + 0.1;
    this.applyLevel();
    this.timer = setInterval(() => this.tick(), 120);
  },
  stop() { this.on = false; if (this.timer) clearInterval(this.timer); this.timer = null; if (Sound.ctx) Sound.music.gain.setTargetAtTime(0, Sound.ctx.currentTime, 0.2); },
  duck(on) { this.muted = on; this.applyLevel(); },
  applyLevel() {
    if (!Sound.ctx) return;
    const want = Store.data.settings.music ? (this.muted ? this.level * 0.35 : this.level) : 0;
    if (Store.data.settings.music && !this.on && Sound.ok) this.start();
    if (!Store.data.settings.music && this.on) { this.stop(); return; }
    Sound.music.gain.setTargetAtTime(want, Sound.ctx.currentTime, 0.4);
  },
};

/* ---------- Sprache: deutsche Sprachausgabe des iPads (Web Speech API) ---------- */
const Voice = {
  voice: null, ready: false, busy: false, lastText: '', lastAt: -9,
  init() {
    if (!('speechSynthesis' in window)) return;
    const pickVoice = () => {
      let vs = []; try { vs = speechSynthesis.getVoices() || []; } catch (e) { vs = []; }
      const de = vs.filter((v) => /^de/i.test(v.lang));
      const pref = de.find((v) => /Anna|Helena|Petra|Viktor|Markus|Google Deutsch|Katja/i.test(v.name)) || de.find((v) => v.localService) || de[0] || null;
      this.voice = pref; this.ready = true;
    };
    pickVoice();
    try { speechSynthesis.onvoiceschanged = pickVoice; } catch (e) { /* */ }
  },
  warm() { if (!this.ready) this.init(); },
  say(text, o = {}) {
    if (!text || !Store.data.settings.voice || !('speechSynthesis' in window)) return;
    if (this.busy && !o.force) return;
    if (text === this.lastText && Game.time - this.lastAt < 2 && !o.force) return;
    try {
      if (!this.ready) this.init();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE'; if (this.voice) u.voice = this.voice;
      u.rate = o.rate || 0.92; u.pitch = o.pitch || 1.15; u.volume = 1;
      this.busy = true; this.lastText = text; this.lastAt = Game.time;
      const free = () => { this.busy = false; };
      u.onend = free; u.onerror = free;
      setTimeout(free, Math.min(8000, 1200 + text.length * 90));
      try { speechSynthesis.resume(); } catch (e) { /* */ }
      speechSynthesis.speak(u);
    } catch (e) { this.busy = false; }
  },
  stop() { try { speechSynthesis.cancel(); } catch (e) { /* */ } this.busy = false; },
  praise() { this.say(pick(['Super!', 'Toll gemacht!', 'Prima!', 'Genau richtig!', 'Klasse!', 'Juhu!', 'Wunderbar!'])); },
};

/* ---------- Zeigehand: zeigt nach einer Pause die Geste vor ---------- */
const Hand = {
  active: false, x: 0, y: 0, press: 0, t: 0, from: null, to: null, loops: 0, alpha: 0, visible: false, wait: 0,
  start(from, to) { this.from = from; this.to = to; this.t = 0; this.loops = 0; this.active = true; this.visible = true; this.alpha = 0; },
  stop() { this.active = false; this.visible = false; this.alpha = 0; },
  userTouched() { this.stop(); },
  delay() { return Game.small ? 4 : 8; },
  update(dt) {
    const sc = Game.scene;
    if (!this.active) {
      if (sc && sc.hint && !Game.overlay && !Game.trans && !Input.down && Game.time - Game.lastInput > this.delay() + this.wait) {
        const h = sc.hint(); if (h) this.start({ x: h.x1, y: h.y1 }, { x: h.x2, y: h.y2 }); else Game.lastInput = Game.time;
      }
      return;
    }
    this.t += dt;
    const cycle = 2.2, k = (this.t % cycle) / cycle;
    this.alpha = Math.min(1, this.t * 3);
    if (k < 0.18) { this.x = this.from.x; this.y = this.from.y + 30 * (1 - k / 0.18); this.press = k / 0.18; }
    else if (k < 0.7) { const u = Ease.inOutQuad((k - 0.18) / 0.52); this.x = lerp(this.from.x, this.to.x, u); this.y = lerp(this.from.y, this.to.y, u); this.press = 1; }
    else if (k < 0.85) { this.x = this.to.x; this.y = this.to.y; this.press = 1 - (k - 0.7) / 0.15; }
    else { this.x = this.to.x; this.y = this.to.y + 30 * ((k - 0.85) / 0.15); this.press = 0; this.alpha = 1 - (k - 0.85) / 0.15; }
    if (Math.floor(this.t / cycle) >= 2) { this.stop(); this.wait = 3; Game.lastInput = Game.time; }
  },
  draw(c) { if (!this.active) return; c.save(); c.globalAlpha = this.alpha; Draw.hand(c, this.x + 14, this.y + 18, this.press); c.restore(); },
};

/* ---------- Farben & Hilfen ---------- */
const INK = '#2b1d14';
const PAL = { red: '#eb4642', orange: '#ff9a2e', yellow: '#f4d918', green: '#5fcf2a', blue: '#1a7ef0', purple: '#8a5bd6', pink: '#f08ae6', brown: '#a5692f', white: '#ffffff', wood: '#ac906b', woodDark: '#7a5a3a', wall: '#72ecf7', wallStar: '#8ff2fb', btn: '#efcc28', btnText: '#5b5327', blueBtn: '#68d4e4', cream: '#fff5d6', skyLight: '#bff4ff' };
const COLOR_NAMES = { red: 'rot', blue: 'blau', green: 'grün', yellow: 'gelb', purple: 'lila', pink: 'rosa', orange: 'orange' };
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function shade(hex, amt) { const [r, g, b] = hexToRgb(hex); const f = (v) => clamp(Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt), 0, 255); return '#' + [f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join(''); }
function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

/* ---------- Hauptschleife ---------- */
let lastFrame = 0, fpsSkip = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016); lastFrame = now;
  Game.time += dt;
  if (Game.trans) {
    const tr = Game.trans; tr.t += dt;
    if (!tr.swapped && tr.t >= tr.dur * 0.5) { tr.swapped = true; swapScene(tr.next); }
    if (tr.t >= tr.dur) Game.trans = null;
  }
  Tweens.update(dt); Timers.update();
  const sc = Game.scene;
  if (sc && sc.update) sc.update(dt);
  if (Game.overlay && Game.overlay.update) Game.overlay.update(dt);
  Particles.update(dt); Hand.update(dt);
  const c = ctx, k = View.sc * View.dpr;
  c.setTransform(k, 0, 0, k, View.ox * k, View.oy * k);
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (sc && sc.draw) sc.draw(c);
  Particles.draw(c, 0);
  if (Game.overlay && Game.overlay.draw) Game.overlay.draw(c);
  Particles.draw(c, 1);
  Hand.draw(c);
  if (Game.trans) {
    const tr = Game.trans, p = tr.t / tr.dur, a = p < 0.5 ? Ease.inQuad(p * 2) : 1 - Ease.outQuad((p - 0.5) * 2);
    c.save(); c.globalAlpha = clamp(a, 0, 1); c.fillStyle = tr.color; c.fillRect(View.L - 5, View.T - 5, View.vw + 10, View.vh + 10); c.restore();
  }
  if (View.portrait) drawRotateHint(c);
}
function drawRotateHint(c) {
  c.save();
  c.fillStyle = 'rgba(43,29,20,0.86)'; c.fillRect(View.L - 5, View.T - 5, View.vw + 10, View.vh + 10);
  const cx = DW / 2, cy = DH / 2;
  c.translate(cx, cy - 40); c.rotate(Math.sin(Game.time * 2) * 0.35 - 0.4);
  Draw.rrPath(c, -60, -90, 120, 180, 18); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 8; c.strokeStyle = PAL.blueBtn; c.stroke();
  c.fillStyle = PAL.blueBtn; c.beginPath(); c.arc(0, 70, 8, 0, TAU); c.fill();
  c.restore();
  c.save(); c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '600 40px Fredoka, sans-serif'; c.fillStyle = '#fff';
  c.fillText('Bitte das iPad quer halten', DW / 2, DH / 2 + 120); c.restore();
}

/* ===== src/draw.js ===== */
/* =====================================================================
   Zeichenbibliothek: alles wird live als Vektorgrafik gezeichnet.
   Stil wie bei einer Kinderzimmer-Tapete: dicke dunkle Kontur, satte
   Farben, weißer Glanzpunkt, weicher Schatten. Alle Funktionen zeichnen
   um den Punkt (x, y) herum.
   ===================================================================== */
const Draw = {
  LW: 4,
  rrPath(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  },
  starPath(c, x, y, R, r, n = 5, rot = -Math.PI / 2) {
    c.beginPath();
    for (let i = 0; i < n * 2; i++) { const rad = i % 2 ? r : R, a = rot + (i / (n * 2)) * TAU; c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
    c.closePath();
  },
  heartPath(c, x, y, s) {
    c.beginPath(); c.moveTo(x, y + s * 0.95);
    c.bezierCurveTo(x - s * 1.1, y + s * 0.2, x - s * 0.9, y - s * 0.9, x, y - s * 0.35);
    c.bezierCurveTo(x + s * 0.9, y - s * 0.9, x + s * 1.1, y + s * 0.2, x, y + s * 0.95); c.closePath();
  },
  polyPath(c, x, y, r, n, rot = -Math.PI / 2) { c.beginPath(); for (let i = 0; i < n; i++) { const a = rot + (i / n) * TAU; c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } c.closePath(); },
  ellipse(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU); },
  fs(c, color, lw = Draw.LW, stroke = INK) { c.fillStyle = color; c.fill(); if (lw > 0) { c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); } },
  shine(c, x, y, rx, ry, a = 0.55) { c.save(); c.globalAlpha *= a; Draw.ellipse(c, x, y, rx, ry); c.fillStyle = '#fff'; c.fill(); c.restore(); },
  shadow(c, x, y, rx, ry, a = 0.18) { c.save(); c.globalAlpha *= a; Draw.ellipse(c, x, y, rx, ry); c.fillStyle = INK; c.fill(); c.restore(); },

  /* ---------- Text ---------- */
  label(c, text, x, y, size, fill = '#fff', stroke = INK, weight = 700, align = 'center') {
    c.save(); c.font = `${weight} ${size}px Fredoka, "Arial Rounded MT Bold", sans-serif`; c.textAlign = align; c.textBaseline = 'middle';
    if (stroke) { c.lineWidth = Math.max(3, size * 0.16); c.strokeStyle = stroke; c.lineJoin = 'round'; c.strokeText(text, x, y); }
    c.fillStyle = fill; c.fillText(text, x, y); c.restore();
  },

  /* ---------- Lern-Formen (auch als Silhouette) ---------- */
  shapePath(c, kind, x, y, s) {
    switch (kind) {
      case 'circle': c.beginPath(); c.arc(x, y, s, 0, TAU); break;
      case 'square': Draw.rrPath(c, x - s * 0.9, y - s * 0.9, s * 1.8, s * 1.8, s * 0.22); break;
      case 'triangle': Draw.polyPath(c, x, y + s * 0.12, s * 1.15, 3); break;
      case 'star': Draw.starPath(c, x, y, s * 1.15, s * 0.52, 5); break;
      case 'heart': Draw.heartPath(c, x, y - s * 0.05, s * 1.0); break;
      case 'hexagon': Draw.polyPath(c, x, y, s * 1.05, 6, 0); break;
      case 'diamond': Draw.polyPath(c, x, y, s * 1.15, 4); break;
      case 'moon': c.beginPath(); c.arc(x, y, s, Math.PI * 0.25, Math.PI * 1.75); c.arc(x - s * 0.45, y, s * 0.78, Math.PI * 1.7, Math.PI * 0.3, true); c.closePath(); break;
      default: c.beginPath(); c.arc(x, y, s, 0, TAU);
    }
  },
  shape(c, kind, x, y, s, color, o = {}) {
    Draw.shapePath(c, kind, x, y, s);
    if (o.silhouette) { c.fillStyle = o.silhouette; c.fill(); return; }
    Draw.fs(c, color, o.lw === undefined ? Draw.LW : o.lw);
    if (!o.noShine) Draw.shine(c, x - s * 0.35, y - s * 0.4, s * 0.22, s * 0.14);
  },

  /* ---------- Oberfläche ---------- */
  button(c, x, y, w, h, o = {}) {
    const col = o.color || PAL.btn, pressed = o.pressed ? 3 : 0;
    Draw.shadow(c, x, y + h / 2 + 6, w / 2, 10, 0.16);
    Draw.rrPath(c, x - w / 2, y - h / 2 + pressed, w, h, h / 2.4); Draw.fs(c, col, 4);
    Draw.rrPath(c, x - w / 2 + 8, y - h / 2 + 6 + pressed, w - 16, h * 0.32, h / 4); c.save(); c.globalAlpha *= 0.35; c.fillStyle = '#fff'; c.fill(); c.restore();
    if (o.label) Draw.label(c, o.label, x + (o.icon ? 18 : 0), y + pressed + 1, o.size || h * 0.46, o.text || PAL.btnText, null, 700);
    if (o.icon) o.icon(c, x - w / 2 + h * 0.55, y + pressed);
  },
  roundButton(c, x, y, r, color, icon, o = {}) {
    Draw.shadow(c, x, y + r + 4, r * 0.9, 7, 0.16);
    c.beginPath(); c.arc(x, y, r, 0, TAU); Draw.fs(c, color, 4);
    Draw.shine(c, x - r * 0.3, y - r * 0.45, r * 0.3, r * 0.18, 0.4);
    if (icon) icon(c, x, y, r);
  },
  iconHome(c, x, y, r = 22) {
    c.save(); c.translate(x, y); c.lineWidth = 4; c.strokeStyle = INK; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(-r * 0.75, 0); c.lineTo(0, -r * 0.7); c.lineTo(r * 0.75, 0); c.closePath(); c.fillStyle = PAL.red; c.fill(); c.stroke();
    Draw.rrPath(c, -r * 0.5, -r * 0.05, r, r * 0.65, 3); c.fillStyle = '#fff'; c.fill(); c.stroke();
    Draw.rrPath(c, -r * 0.14, r * 0.2, r * 0.28, r * 0.4, 2); c.fillStyle = PAL.blue; c.fill();
    c.restore();
  },
  iconGear(c, x, y, r = 16) {
    c.save(); c.translate(x, y); c.rotate(Game.time * 0.3);
    c.beginPath(); for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, rr = i % 2 ? r : r * 0.72; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } c.closePath();
    Draw.fs(c, '#fff', 3); c.beginPath(); c.arc(0, 0, r * 0.28, 0, TAU); Draw.fs(c, PAL.blueBtn, 3); c.restore();
  },
  iconNote(c, x, y, r = 16) { c.save(); c.translate(x, y); c.lineWidth = 4; c.strokeStyle = INK; c.beginPath(); c.moveTo(r * 0.2, -r * 0.8); c.lineTo(r * 0.2, r * 0.35); c.stroke(); c.beginPath(); c.moveTo(r * 0.2, -r * 0.8); c.quadraticCurveTo(r * 0.9, -r * 0.6, r * 0.9, -r * 0.1); c.stroke(); Draw.ellipse(c, 0, r * 0.45, r * 0.42, r * 0.3); Draw.fs(c, INK, 0); c.restore(); },
  iconSpeaker(c, x, y, r = 16) { c.save(); c.translate(x, y); c.beginPath(); c.moveTo(-r * 0.8, -r * 0.35); c.lineTo(-r * 0.3, -r * 0.35); c.lineTo(r * 0.2, -r * 0.8); c.lineTo(r * 0.2, r * 0.8); c.lineTo(-r * 0.3, r * 0.35); c.lineTo(-r * 0.8, r * 0.35); c.closePath(); Draw.fs(c, INK, 0); c.lineWidth = 3.5; c.strokeStyle = INK; c.beginPath(); c.arc(r * 0.3, 0, r * 0.55, -0.9, 0.9); c.stroke(); c.beginPath(); c.arc(r * 0.3, 0, r * 0.9, -0.9, 0.9); c.stroke(); c.restore(); },
  iconMouth(c, x, y, r = 16) { c.save(); c.translate(x, y); Draw.ellipse(c, 0, 0, r * 0.9, r * 0.6); Draw.fs(c, '#ffb3c6', 3); Draw.ellipse(c, 0, r * 0.05, r * 0.55, r * 0.3); Draw.fs(c, '#7a1d3a', 0); c.restore(); },
  iconStar(c, x, y, r = 16, color = PAL.yellow) { Draw.starPath(c, x, y, r, r * 0.46, 5); Draw.fs(c, color, 3); },
  iconArrow(c, x, y, r = 16) { c.save(); c.translate(x, y); c.beginPath(); c.moveTo(r * 0.6, -r * 0.1); c.lineTo(-r * 0.1, -r * 0.1); c.lineTo(-r * 0.1, -r * 0.6); c.lineTo(-r * 0.9, 0.08 * r); c.lineTo(-r * 0.1, r * 0.75); c.lineTo(-r * 0.1, r * 0.3); c.lineTo(r * 0.6, r * 0.3); c.closePath(); Draw.fs(c, '#fff', 3); c.restore(); },
  iconPlay(c, x, y, r = 16) { c.beginPath(); c.moveTo(x - r * 0.55, y - r * 0.8); c.lineTo(x + r * 0.8, y); c.lineTo(x - r * 0.55, y + r * 0.8); c.closePath(); Draw.fs(c, '#fff', 3.5); },
  check(c, x, y, r, on) {
    Draw.rrPath(c, x - r, y - r, r * 2, r * 2, r * 0.4); Draw.fs(c, on ? PAL.green : '#ddd', 4);
    if (on) { c.lineWidth = 6; c.strokeStyle = '#fff'; c.beginPath(); c.moveTo(x - r * 0.5, y); c.lineTo(x - r * 0.1, y + r * 0.45); c.lineTo(x + r * 0.55, y - r * 0.45); c.stroke(); }
  },
  hand(c, x, y, press = 0) {
    c.save(); c.translate(x, y); c.rotate(-0.35); c.scale(1 - press * 0.08, 1 - press * 0.08);
    c.lineWidth = 4; c.strokeStyle = INK; c.lineJoin = 'round';
    Draw.rrPath(c, -22, 2, 44, 40, 16); c.fillStyle = '#fff'; c.fill(); c.stroke();
    Draw.rrPath(c, -8, -46 + press * 10, 18, 56, 9); c.fillStyle = '#fff'; c.fill(); c.stroke();
    Draw.rrPath(c, -22, 4, 44, 14, 7); c.fillStyle = '#fff'; c.fill();
    c.beginPath(); c.moveTo(-14, 20); c.lineTo(-14, 30); c.moveTo(-2, 22); c.lineTo(-2, 32); c.moveTo(10, 20); c.lineTo(10, 30); c.stroke();
    Draw.rrPath(c, -26, 30, 52, 30, 12); c.fillStyle = PAL.blue; c.fill(); c.stroke();
    c.restore();
  },

  /* ---------- Raum ---------- */
  wallpaper(c, color = PAL.wall, star = PAL.wallStar) {
    c.fillStyle = color; c.fillRect(View.L - 5, View.T - 5, View.vw + 10, View.vh + 10);
    c.fillStyle = star;
    const x0 = Math.floor(View.L / 96) * 96 - 96, x1 = View.R + 96, y0 = Math.floor(View.T / 96) * 96 - 96, y1 = View.B + 96;
    for (let yy = y0, j = 0; yy < y1; yy += 96, j++) for (let xx = x0; xx < x1; xx += 96) { const sx = xx + (j % 2 ? 48 : 0); Draw.starPath(c, sx, yy, 16, 7, 5); c.fill(); }
  },
  floor(c, y, color = '#d9a66b') {
    c.fillStyle = color; c.fillRect(View.L - 5, y, View.vw + 10, View.B - y + 10);
    c.strokeStyle = rgba('#7a5a3a', 0.35); c.lineWidth = 3;
    for (let yy = y + 44; yy < View.B + 10; yy += 44) { c.beginPath(); c.moveTo(View.L - 5, yy); c.lineTo(View.R + 5, yy); c.stroke(); }
    c.lineWidth = 5; c.strokeStyle = INK; c.beginPath(); c.moveTo(View.L - 5, y); c.lineTo(View.R + 5, y); c.stroke();
  },
  grass(c, y, color = '#7fd24a') {
    c.fillStyle = color; c.fillRect(View.L - 5, y, View.vw + 10, View.B - y + 10);
    c.lineWidth = 5; c.strokeStyle = INK; c.beginPath(); c.moveTo(View.L - 5, y); c.lineTo(View.R + 5, y); c.stroke();
    c.fillStyle = shade(color, -0.15);
    for (let xx = Math.floor(View.L / 70) * 70; xx < View.R + 70; xx += 70) { c.beginPath(); c.moveTo(xx, y + 30); c.lineTo(xx + 8, y + 8); c.lineTo(xx + 16, y + 30); c.closePath(); c.fill(); }
  },
  sky(c, top = '#8fdcff', bottom = '#dff6ff') {
    const g = c.createLinearGradient(0, View.T, 0, DH); g.addColorStop(0, top); g.addColorStop(1, bottom);
    c.fillStyle = g; c.fillRect(View.L - 5, View.T - 5, View.vw + 10, View.vh + 10);
  },
  cloud(c, x, y, s) {
    const parts = [[-0.9, 0, 0.6], [-0.2, -0.45, 0.75], [0.6, -0.1, 0.65], [0.1, 0.25, 0.6]];
    c.lineWidth = 4; c.strokeStyle = INK; c.fillStyle = '#fff';
    for (const [dx, dy, r] of parts) { c.beginPath(); c.arc(x + dx * s, y + dy * s, r * s, 0, TAU); c.stroke(); }
    for (const [dx, dy, r] of parts) { c.beginPath(); c.arc(x + dx * s, y + dy * s, r * s, 0, TAU); c.fill(); }
  },
  sun(c, x, y, r) {
    c.save(); c.translate(x, y); c.rotate(Game.time * 0.2); c.lineWidth = 4; c.strokeStyle = INK;
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; c.beginPath(); c.moveTo(Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25); c.lineTo(Math.cos(a) * r * 1.6, Math.sin(a) * r * 1.6); c.stroke(); }
    c.beginPath(); c.arc(0, 0, r, 0, TAU); Draw.fs(c, PAL.yellow, 4); c.restore();
  },
  shelf(c, x, y, w) {
    Draw.shadow(c, x, y + 26, w / 2, 10, 0.12);
    Draw.rrPath(c, x - w / 2, y, w, 22, 6); Draw.fs(c, PAL.wood, 4);
    c.save(); c.globalAlpha *= 0.3; c.fillStyle = '#fff'; Draw.rrPath(c, x - w / 2 + 10, y + 4, w - 20, 6, 3); c.fill(); c.restore();
    for (const s of [-1, 1]) { c.beginPath(); c.arc(x + s * (w / 2 + 2), y + 11, 13, 0, TAU); Draw.fs(c, PAL.wood, 4); c.beginPath(); c.arc(x + s * (w / 2 + 2), y + 11, 5, 0, TAU); Draw.fs(c, PAL.woodDark, 0); }
  },
  table(c, x, y, w, color = '#f6e7c8') {
    Draw.rrPath(c, x - w / 2, y, w, 26, 8); Draw.fs(c, color, 4);
    for (const s of [-1, 1]) { Draw.rrPath(c, x + s * (w / 2 - 50) - 14, y + 24, 28, 120, 8); Draw.fs(c, shade(color, -0.25), 4); }
  },
  blanket(c, x, y, w, h, col1 = '#ff6b6b', col2 = '#fff') {
    c.save(); Draw.rrPath(c, x - w / 2, y - h / 2, w, h, 16); c.clip();
    c.fillStyle = col2; c.fillRect(x - w / 2, y - h / 2, w, h); c.fillStyle = col1;
    const t = 44;
    for (let j = 0; j * t < h; j++) for (let i = 0; i * t < w; i++) if ((i + j) % 2 === 0) c.fillRect(x - w / 2 + i * t, y - h / 2 + j * t, t, t);
    c.restore(); Draw.rrPath(c, x - w / 2, y - h / 2, w, h, 16); c.lineWidth = 4; c.strokeStyle = INK; c.stroke();
  },
  garland(c, x1, y1, x2, y2, bulbs, sag = 60) {
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2 + sag * 2;
    c.lineWidth = 4; c.strokeStyle = '#2f6b2f'; c.beginPath(); c.moveTo(x1, y1); c.quadraticCurveTo(cx, cy, x2, y2); c.stroke();
    const n = bulbs.length;
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / (n + 1), bx = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2, by = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;
      const b = bulbs[i];
      c.lineWidth = 4; c.strokeStyle = '#2f6b2f'; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx, by + 10); c.stroke();
      Draw.rrPath(c, bx - 7, by + 8, 14, 9, 3); Draw.fs(c, '#3b3b3b', 2);
      if (b.on) { c.save(); c.globalAlpha *= 0.35 + Math.sin(Game.time * 5 + i) * 0.12; c.beginPath(); c.arc(bx, by + 30, 26, 0, TAU); c.fillStyle = b.color; c.fill(); c.restore(); }
      Draw.ellipse(c, bx, by + 30, 11, 15); Draw.fs(c, b.on ? b.color : shade(b.color, -0.55), 3);
      if (b.on) Draw.shine(c, bx - 4, by + 24, 4, 6, 0.6);
    }
  },
  balloon(c, x, y, color, r = 34, o = {}) {
    const sway = o.sway === undefined ? Math.sin(Game.time * 2 + x * 0.01) * 0.06 : o.sway;
    c.save(); c.translate(x, y); c.rotate(sway);
    if (!o.noString) { c.lineWidth = 2.5; c.strokeStyle = INK; c.beginPath(); c.moveTo(0, r * 1.25); c.quadraticCurveTo(10, r * 1.6, -4, r * 2.1); c.stroke(); }
    c.beginPath(); c.moveTo(-7, r * 1.28); c.lineTo(7, r * 1.28); c.lineTo(0, r * 1.1); c.closePath(); Draw.fs(c, color, 3);
    Draw.ellipse(c, 0, 0, r, r * 1.18); Draw.fs(c, color, Draw.LW);
    Draw.shine(c, -r * 0.35, -r * 0.45, r * 0.22, r * 0.32, 0.5);
    c.restore();
  },
  hat(c, x, y, R, color = PAL.purple, dots = PAL.yellow) {
    c.save(); c.translate(x, y);
    c.beginPath(); c.moveTo(-R * 0.62, R * 0.1); c.lineTo(0, -R * 1.25); c.lineTo(R * 0.62, R * 0.1); c.closePath(); Draw.fs(c, color, Draw.LW);
    c.save(); c.beginPath(); c.moveTo(-R * 0.62, R * 0.1); c.lineTo(0, -R * 1.25); c.lineTo(R * 0.62, R * 0.1); c.closePath(); c.clip(); c.fillStyle = dots;
    for (const [dx, dy] of [[-0.2, -0.1], [0.22, -0.25], [0, -0.6], [-0.3, -0.45], [0.3, 0.02]]) { c.beginPath(); c.arc(dx * R, dy * R, R * 0.09, 0, TAU); c.fill(); }
    c.restore();
    c.beginPath(); c.arc(0, -R * 1.25, R * 0.17, 0, TAU); Draw.fs(c, PAL.pink, 3);
    c.restore();
  },

  /* ---------- Tiere: Kopf + Körper, Partyhut optional ---------- */
  ANIMALS: {
    bear: { fur: '#c58b4a', muzzle: '#f2d8b0', nose: INK, name: 'Bär' },
    rabbit: { fur: '#f4f4f4', muzzle: '#fde6ee', nose: '#f08ae6', name: 'Hase' },
    cat: { fur: '#f3a33a', muzzle: '#ffe3b8', nose: '#f08ae6', name: 'Katze' },
    dog: { fur: '#b98253', muzzle: '#f2d8b0', nose: INK, name: 'Hund' },
    bird: { fur: '#58b7ff', muzzle: '#58b7ff', nose: PAL.orange, name: 'Vogel' },
    pig: { fur: '#f7a8c9', muzzle: '#f98fb8', nose: '#e2588f', name: 'Schwein' },
    frog: { fur: '#6fd14a', muzzle: '#b5ef8c', nose: INK, name: 'Frosch' },
    fox: { fur: '#f28c3a', muzzle: '#fff1e0', nose: INK, name: 'Fuchs' },
    dino: { fur: '#6fd14a', muzzle: '#c9f2a6', nose: INK, name: 'Dino' },
    dragon: { fur: '#a67bf0', muzzle: '#e6d6ff', nose: INK, name: 'Drache' },
    robot: { fur: '#b8c7d6', muzzle: '#b8c7d6', nose: INK, name: 'Roboter' },
  },
  animal(c, kind, x, y, R, o = {}) {
    const A = Draw.ANIMALS[kind] || Draw.ANIMALS.bear, fur = o.fur || A.fur, mood = o.mood || 'happy';
    const blink = o.blink !== undefined ? o.blink : (Math.sin(Game.time * 1.7 + x * 0.05) > 0.96 ? 1 : 0);
    c.save(); c.translate(x, y); if (o.rot) c.rotate(o.rot); if (o.scale) c.scale(o.scale, o.scale);
    if (!o.headOnly) {
      // Umhang und Flügel liegen hinter dem Körper
      if (o.cape) { c.beginPath(); c.moveTo(-R * 0.9, R * 0.9); c.quadraticCurveTo(-R * 1.7, R * 1.8, -R * 1.55, R * 2.5); c.lineTo(R * 1.55, R * 2.5); c.quadraticCurveTo(R * 1.7, R * 1.8, R * 0.9, R * 0.9); c.closePath(); Draw.fs(c, o.cape, Draw.LW); }
      if (o.wings) { for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * R * 0.6, R * 1.3); c.quadraticCurveTo(s * R * 2.1, R * 0.5, s * R * 2.0, R * 1.5); c.quadraticCurveTo(s * R * 1.7, R * 1.3, s * R * 1.5, R * 1.9); c.quadraticCurveTo(s * R * 1.2, R * 1.6, s * R * 0.7, R * 2.0); c.closePath(); Draw.fs(c, o.wings, Draw.LW); } }
      // Körper (Shirt) + Hände
      Draw.ellipse(c, 0, R * 1.55, R * 0.95, R * 0.85); Draw.fs(c, o.shirt || PAL.blue, Draw.LW);
      if (o.stripes) { c.save(); Draw.ellipse(c, 0, R * 1.55, R * 0.95, R * 0.85); c.clip(); c.fillStyle = o.stripes; for (let k = -3; k <= 3; k++) c.fillRect(-R, R * 1.55 + k * R * 0.36 - R * 0.09, R * 2, R * 0.18); c.restore(); }
      if (o.bolt) { c.beginPath(); c.moveTo(R * 0.1, R * 0.95); c.lineTo(-R * 0.3, R * 1.6); c.lineTo(R * 0.02, R * 1.6); c.lineTo(-R * 0.15, R * 2.15); c.lineTo(R * 0.32, R * 1.4); c.lineTo(R * 0.02, R * 1.4); c.closePath(); Draw.fs(c, o.bolt, 3); }
      if (o.star) { Draw.starPath(c, 0, R * 1.5, R * 0.36, R * 0.16, 5); Draw.fs(c, o.star, 3); }
      if (o.panel) { Draw.rrPath(c, -R * 0.45, R * 1.25, R * 0.9, R * 0.55, R * 0.1); Draw.fs(c, '#dfe8f0', 3); for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(-R * 0.25 + i * R * 0.25, R * 1.52, R * 0.08, 0, TAU); Draw.fs(c, [PAL.red, PAL.yellow, PAL.green][i], 0); } }
      for (const s of [-1, 1]) { const wave = o.wave && s === 1 ? -R * 0.9 : 0; c.beginPath(); c.arc(s * R * 1.05, R * 1.75 + wave, R * 0.26, 0, TAU); Draw.fs(c, fur, Draw.LW); }
    }
    // Ohren, Hörner, Zacken
    if (kind === 'rabbit') { for (const s of [-1, 1]) { Draw.ellipse(c, s * R * 0.45, -R * 1.35, R * 0.26, R * 0.75); Draw.fs(c, fur, Draw.LW); Draw.ellipse(c, s * R * 0.45, -R * 1.35, R * 0.12, R * 0.5); Draw.fs(c, '#f9bfd8', 0); } }
    else if (kind === 'cat' || kind === 'fox') { for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * R * 0.35, -R * 0.75); c.lineTo(s * R * 0.95, -R * 1.45); c.lineTo(s * R * 1.0, -R * 0.55); c.closePath(); Draw.fs(c, fur, Draw.LW); c.beginPath(); c.moveTo(s * R * 0.5, -R * 0.85); c.lineTo(s * R * 0.85, -R * 1.25); c.lineTo(s * R * 0.9, -R * 0.7); c.closePath(); Draw.fs(c, '#f9bfd8', 0); } }
    else if (kind === 'dog') { for (const s of [-1, 1]) { Draw.ellipse(c, s * R * 0.95, -R * 0.2, R * 0.32, R * 0.7); Draw.fs(c, shade(fur, -0.3), Draw.LW); } }
    else if (kind === 'bear' || kind === 'pig') { for (const s of [-1, 1]) { c.beginPath(); c.arc(s * R * 0.7, -R * 0.75, R * 0.32, 0, TAU); Draw.fs(c, fur, Draw.LW); c.beginPath(); c.arc(s * R * 0.7, -R * 0.75, R * 0.15, 0, TAU); Draw.fs(c, A.muzzle, 0); } }
    else if (kind === 'frog') { for (const s of [-1, 1]) { c.beginPath(); c.arc(s * R * 0.55, -R * 0.85, R * 0.36, 0, TAU); Draw.fs(c, fur, Draw.LW); } }
    else if (kind === 'dino') { for (const dx of [-0.45, 0, 0.45]) { c.beginPath(); c.moveTo(dx * R - R * 0.2, -R * 0.85); c.lineTo(dx * R, -R * 1.35); c.lineTo(dx * R + R * 0.2, -R * 0.85); c.closePath(); Draw.fs(c, shade(fur, -0.3), Draw.LW); } }
    else if (kind === 'dragon') { for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * R * 0.35, -R * 0.8); c.quadraticCurveTo(s * R * 0.75, -R * 1.5, s * R * 0.95, -R * 1.45); c.lineTo(s * R * 0.75, -R * 0.65); c.closePath(); Draw.fs(c, PAL.yellow, Draw.LW); } }
    else if (kind === 'robot') { c.lineWidth = Draw.LW; c.strokeStyle = INK; c.beginPath(); c.moveTo(0, -R); c.lineTo(0, -R * 1.45); c.stroke(); c.beginPath(); c.arc(0, -R * 1.55, R * 0.17, 0, TAU); Draw.fs(c, PAL.red, 3); for (const s of [-1, 1]) { Draw.rrPath(c, s * R * 0.95 - R * 0.14, -R * 0.3, R * 0.28, R * 0.5, R * 0.08); Draw.fs(c, shade(fur, -0.25), Draw.LW); } }
    // Kopf
    if (kind === 'robot') { Draw.rrPath(c, -R, -R, R * 2, R * 2, R * 0.45); Draw.fs(c, fur, Draw.LW); }
    else { c.beginPath(); c.arc(0, 0, R, 0, TAU); Draw.fs(c, fur, Draw.LW); }
    if (kind === 'bird') { c.beginPath(); c.moveTo(-R * 0.1, -R * 0.95); c.quadraticCurveTo(-R * 0.3, -R * 1.5, R * 0.15, -R * 1.3); c.quadraticCurveTo(R * 0.05, -R * 1.1, R * 0.2, -R * 0.98); Draw.fs(c, fur, 3); }
    if (kind === 'bear' || kind === 'dog' || kind === 'cat' || kind === 'rabbit' || kind === 'fox' || kind === 'dino' || kind === 'dragon') { Draw.ellipse(c, 0, R * 0.42, R * 0.5, R * 0.36); Draw.fs(c, A.muzzle, 0); }
    if (kind === 'pig') { Draw.ellipse(c, 0, R * 0.35, R * 0.42, R * 0.3); Draw.fs(c, A.muzzle, Draw.LW); for (const s of [-1, 1]) { Draw.ellipse(c, s * R * 0.16, R * 0.36, R * 0.07, R * 0.1); Draw.fs(c, A.nose, 0); } }
    // Augen (bei Maske hinter der Maske noch einmal)
    const ey = kind === 'frog' ? -R * 0.85 : -R * 0.12, ex = kind === 'frog' ? R * 0.55 : R * 0.38, er = R * 0.2;
    if (o.mask) { Draw.ellipse(c, -ex, ey, er * 1.65, er * 1.25); Draw.fs(c, o.mask, 3); Draw.ellipse(c, ex, ey, er * 1.65, er * 1.25); Draw.fs(c, o.mask, 3); Draw.rrPath(c, -ex, ey - er * 0.5, ex * 2, er, er * 0.4); Draw.fs(c, o.mask, 0); }
    for (const s of [-1, 1]) {
      if (blink > 0.5) { c.lineWidth = 4; c.strokeStyle = INK; c.beginPath(); c.arc(s * ex, ey, er * 0.8, 0.15, Math.PI - 0.15); c.stroke(); continue; }
      if (kind === 'robot') { Draw.rrPath(c, s * ex - er, ey - er * 0.8, er * 2, er * 1.6, er * 0.4); Draw.fs(c, '#dff6ff', 3); c.beginPath(); c.arc(s * ex, ey, er * 0.45, 0, TAU); Draw.fs(c, PAL.blue, 0); continue; }
      c.beginPath(); c.arc(s * ex, ey, er, 0, TAU); Draw.fs(c, '#fff', 3);
      c.beginPath(); c.arc(s * ex + R * 0.03, ey + R * 0.03, er * 0.52, 0, TAU); Draw.fs(c, INK, 0);
      c.beginPath(); c.arc(s * ex - er * 0.2, ey - er * 0.25, er * 0.18, 0, TAU); Draw.fs(c, '#fff', 0);
    }
    if (o.patch) { c.beginPath(); c.arc(ex, ey, er * 1.1, 0, TAU); Draw.fs(c, INK, 0); c.lineWidth = 3; c.strokeStyle = INK; c.beginPath(); c.moveTo(ex - er * 0.9, ey - er * 0.6); c.lineTo(-R * 0.9, -R * 0.5); c.stroke(); }
    // Wangen, Nase, Mund
    c.save(); c.globalAlpha *= 0.45; for (const s of [-1, 1]) { Draw.ellipse(c, s * R * 0.62, R * 0.28, R * 0.16, R * 0.1); Draw.fs(c, '#ff7ea0', 0); } c.restore();
    if (kind === 'bird') { c.beginPath(); c.moveTo(-R * 0.22, R * 0.18); c.lineTo(R * 0.32, R * 0.32); c.lineTo(-R * 0.22, R * 0.5); c.closePath(); Draw.fs(c, A.nose, 3); }
    else if (kind === 'robot') { /* keine Nase */ }
    else if (kind !== 'pig') { Draw.ellipse(c, 0, R * 0.26, R * 0.15, R * 0.11); Draw.fs(c, A.nose, 0); }
    c.lineWidth = 3.5; c.strokeStyle = INK;
    if (mood === 'open') { Draw.ellipse(c, 0, R * 0.62, R * 0.22, R * 0.2); Draw.fs(c, '#7a1d3a', 3); Draw.ellipse(c, 0, R * 0.72, R * 0.12, R * 0.07); Draw.fs(c, '#ff7ea0', 0); }
    else if (mood === 'wow') { Draw.ellipse(c, 0, R * 0.62, R * 0.14, R * 0.17); Draw.fs(c, '#7a1d3a', 3); }
    else if (kind === 'robot') { Draw.rrPath(c, -R * 0.3, R * 0.45, R * 0.6, R * 0.16, R * 0.08); Draw.fs(c, INK, 0); }
    else if (kind !== 'bird') { c.beginPath(); c.arc(0, R * 0.45, R * 0.28, 0.25, Math.PI - 0.25); c.stroke(); }
    if (kind === 'cat') { c.lineWidth = 2.5; for (const s of [-1, 1]) for (const dy of [-0.05, 0.1]) { c.beginPath(); c.moveTo(s * R * 0.5, R * (0.35 + dy)); c.lineTo(s * R * 1.1, R * (0.25 + dy * 2)); c.stroke(); } }
    // Kopfbedeckungen
    if (o.hat) Draw.hat(c, 0, -R * 0.85, R * 0.75, o.hat, o.hatDots);
    if (o.headband) { Draw.rrPath(c, -R * 1.02, -R * 0.62, R * 2.04, R * 0.26, R * 0.1); Draw.fs(c, o.headband, 3); c.lineWidth = 3; c.strokeStyle = INK; for (const dy of [0, 0.22]) { c.beginPath(); c.moveTo(R * 0.98, -R * 0.5); c.quadraticCurveTo(R * 1.5, -R * 0.4 + dy * R, R * 1.55, -R * (0.15 - dy)); c.stroke(); c.lineWidth = 7; c.strokeStyle = o.headband; c.stroke(); c.lineWidth = 3; c.strokeStyle = INK; } }
    if (o.helmet === 'fire') { c.beginPath(); c.arc(0, -R * 0.45, R * 1.02, Math.PI, 0); c.closePath(); Draw.fs(c, PAL.red, Draw.LW); Draw.rrPath(c, -R * 1.2, -R * 0.55, R * 2.4, R * 0.22, R * 0.1); Draw.fs(c, PAL.red, Draw.LW); Draw.rrPath(c, -R * 0.28, -R * 1.1, R * 0.56, R * 0.42, R * 0.1); Draw.fs(c, PAL.yellow, 3); }
    if (o.helmet === 'space') { c.save(); c.globalAlpha *= 0.35; c.beginPath(); c.arc(0, -R * 0.1, R * 1.35, 0, TAU); c.fillStyle = '#dff6ff'; c.fill(); c.restore(); c.beginPath(); c.arc(0, -R * 0.1, R * 1.35, 0, TAU); c.lineWidth = Draw.LW; c.strokeStyle = INK; c.stroke(); Draw.shine(c, -R * 0.6, -R * 0.8, R * 0.25, R * 0.12, 0.7); }
    if (o.pirate) { c.beginPath(); c.moveTo(-R * 1.25, -R * 0.7); c.quadraticCurveTo(-R * 0.9, -R * 1.75, 0, -R * 1.55); c.quadraticCurveTo(R * 0.9, -R * 1.75, R * 1.25, -R * 0.7); c.closePath(); Draw.fs(c, '#2b2b35', Draw.LW); Draw.starPath(c, 0, -R * 1.2, R * 0.22, R * 0.1, 5); Draw.fs(c, PAL.yellow, 2); }
    if (o.crown) { c.beginPath(); c.moveTo(-R * 0.75, -R * 0.75); c.lineTo(-R * 0.75, -R * 1.45); c.lineTo(-R * 0.37, -R * 1.1); c.lineTo(0, -R * 1.55); c.lineTo(R * 0.37, -R * 1.1); c.lineTo(R * 0.75, -R * 1.45); c.lineTo(R * 0.75, -R * 0.75); c.closePath(); Draw.fs(c, PAL.yellow, Draw.LW); }
    c.restore();
  },
  /* Held: Tier + Ausrüstung aus einer Heldenbeschreibung (HEROES) */
  hero(c, h, x, y, R, o = {}) {
    const opt = Object.assign({ shirt: h.shirt, fur: h.fur, cape: h.cape, mask: h.mask, helmet: h.helmet, headband: h.headband, pirate: h.pirate, patch: h.patch, bolt: h.bolt, star: h.star, panel: h.panel, wings: h.wings, stripes: h.stripes, crown: h.crown }, o);
    Draw.animal(c, h.kind, x, y, R, opt);
  },

  /* ---------- Essen ---------- */
  food(c, kind, x, y, s = 1, color) {
    c.save(); c.translate(x, y); c.scale(s, s);
    switch (kind) {
      case 'apple': c.beginPath(); c.arc(-9, 2, 22, 0, TAU); c.arc(9, 2, 22, 0, TAU); Draw.fs(c, color || PAL.red, Draw.LW); c.beginPath(); c.arc(-9, 2, 22, 0, TAU); c.arc(9, 2, 22, 0, TAU); c.fillStyle = color || PAL.red; c.fill(); c.lineWidth = 4; c.strokeStyle = INK; c.beginPath(); c.moveTo(0, -18); c.lineTo(2, -32); c.stroke(); Draw.ellipse(c, 10, -28, 10, 5); Draw.fs(c, PAL.green, 3); Draw.shine(c, -12, -8, 6, 9); break;
      case 'banana': c.beginPath(); c.moveTo(-30, -14); c.quadraticCurveTo(0, 30, 32, -6); c.quadraticCurveTo(28, 2, 24, 6); c.quadraticCurveTo(0, 36, -34, -4); c.closePath(); Draw.fs(c, PAL.yellow, Draw.LW); c.beginPath(); c.arc(-31, -9, 5, 0, TAU); Draw.fs(c, '#8a5a2a', 0); break;
      case 'cookie': c.beginPath(); c.arc(0, 0, 26, 0, TAU); Draw.fs(c, '#d9a35a', Draw.LW); for (const [dx, dy] of [[-10, -8], [8, -10], [10, 8], [-8, 10], [0, 0]]) { c.beginPath(); c.arc(dx, dy, 4.5, 0, TAU); Draw.fs(c, '#5b3a1e', 0); } break;
      case 'cheese': c.beginPath(); c.moveTo(-30, 18); c.lineTo(30, 18); c.lineTo(30, -8); c.lineTo(-30, -22); c.closePath(); Draw.fs(c, '#ffd54a', Draw.LW); for (const [dx, dy, r] of [[-12, 4, 5], [10, 2, 6], [0, -8, 3]]) { c.beginPath(); c.arc(dx, dy, r, 0, TAU); Draw.fs(c, '#e0a92a', 0); } break;
      case 'strawberry': c.beginPath(); c.moveTo(0, 28); c.quadraticCurveTo(-30, 10, -24, -10); c.quadraticCurveTo(-16, -24, 0, -20); c.quadraticCurveTo(16, -24, 24, -10); c.quadraticCurveTo(30, 10, 0, 28); c.closePath(); Draw.fs(c, color || PAL.red, Draw.LW); c.fillStyle = '#ffe9a8'; for (const [dx, dy] of [[-10, -4], [8, -6], [0, 8], [-12, 12], [12, 10], [0, -10]]) { Draw.ellipse(c, dx, dy, 2.2, 3.2); c.fill(); } for (const a of [-0.9, -0.3, 0.3, 0.9]) { Draw.ellipse(c, Math.sin(a) * 12, -20 - Math.cos(a) * 4, 7, 4); c.save(); c.translate(Math.sin(a) * 12, -20 - Math.cos(a) * 4); c.rotate(a); Draw.ellipse(c, 0, 0, 9, 4); Draw.fs(c, PAL.green, 3); c.restore(); } break;
      case 'cherry': c.lineWidth = 4; c.strokeStyle = INK; c.beginPath(); c.moveTo(-12, 6); c.quadraticCurveTo(-4, -26, 8, -30); c.moveTo(14, 8); c.quadraticCurveTo(12, -20, 8, -30); c.stroke(); for (const [dx, dy] of [[-14, 12], [14, 14]]) { c.beginPath(); c.arc(dx, dy, 14, 0, TAU); Draw.fs(c, '#d6262c', Draw.LW); Draw.shine(c, dx - 5, dy - 5, 4, 5); } break;
      case 'blueberry': c.beginPath(); c.arc(0, 0, 20, 0, TAU); Draw.fs(c, '#4f63d2', Draw.LW); Draw.starPath(c, 0, -8, 7, 3, 5); Draw.fs(c, '#2e3a8c', 0); Draw.shine(c, -7, -4, 5, 6); break;
      case 'carrot': c.beginPath(); c.moveTo(-16, -14); c.lineTo(16, -14); c.quadraticCurveTo(14, 20, 0, 34); c.quadraticCurveTo(-14, 20, -16, -14); c.closePath(); Draw.fs(c, PAL.orange, Draw.LW); for (const a of [-0.6, 0, 0.6]) { c.save(); c.translate(0, -16); c.rotate(a); Draw.ellipse(c, 0, -12, 6, 14); Draw.fs(c, PAL.green, 3); c.restore(); } c.lineWidth = 2.5; c.strokeStyle = shade(PAL.orange, -0.3); for (const dy of [-2, 8, 18]) { c.beginPath(); c.moveTo(-9 + dy * 0.2, dy); c.lineTo(9 - dy * 0.2, dy); c.stroke(); } break;
      case 'bone': Draw.rrPath(c, -22, -8, 44, 16, 8); Draw.fs(c, '#fff', Draw.LW); for (const dx of [-24, 24]) for (const dy of [-9, 9]) { c.beginPath(); c.arc(dx, dy, 11, 0, TAU); Draw.fs(c, '#fff', Draw.LW); } Draw.rrPath(c, -22, -7, 44, 14, 7); c.fillStyle = '#fff'; c.fill(); break;
      case 'fish': c.beginPath(); c.moveTo(30, 0); c.lineTo(44, -16); c.lineTo(44, 16); c.closePath(); Draw.fs(c, '#4aa3df', Draw.LW); Draw.ellipse(c, 0, 0, 32, 18); Draw.fs(c, '#58b7ff', Draw.LW); c.beginPath(); c.arc(-14, -4, 5, 0, TAU); Draw.fs(c, '#fff', 2); c.beginPath(); c.arc(-13, -4, 2.5, 0, TAU); Draw.fs(c, INK, 0); c.lineWidth = 2.5; c.strokeStyle = shade('#58b7ff', -0.3); for (const dx of [4, 14]) { c.beginPath(); c.arc(dx, 0, 10, -1.1, 1.1); c.stroke(); } break;
      case 'worm': c.lineWidth = 16; c.strokeStyle = INK; c.beginPath(); c.moveTo(-30, 6); c.quadraticCurveTo(-15, -22, 0, 4); c.quadraticCurveTo(15, 30, 30, 0); c.stroke(); c.lineWidth = 9; c.strokeStyle = '#ff9bb5'; c.stroke(); c.beginPath(); c.arc(30, 0, 9, 0, TAU); Draw.fs(c, '#ff9bb5', 3.5); c.beginPath(); c.arc(32, -2, 2.5, 0, TAU); Draw.fs(c, INK, 0); break;
      case 'honey': Draw.rrPath(c, -22, -14, 44, 40, 10); Draw.fs(c, '#f5b534', Draw.LW); Draw.rrPath(c, -18, -26, 36, 16, 5); Draw.fs(c, '#c98a2a', Draw.LW); Draw.shine(c, -12, 0, 4, 12); break;
      case 'acorn': Draw.ellipse(c, 0, 8, 17, 22); Draw.fs(c, '#b5753a', Draw.LW); Draw.ellipse(c, 0, -10, 21, 11); Draw.fs(c, '#6b4a22', Draw.LW); c.lineWidth = 4; c.strokeStyle = INK; c.beginPath(); c.moveTo(0, -20); c.lineTo(0, -30); c.stroke(); break;
      case 'fly': Draw.ellipse(c, 0, 4, 10, 8); Draw.fs(c, INK, 0); for (const s of [-1, 1]) { c.save(); c.globalAlpha *= 0.7; Draw.ellipse(c, s * 12, -6, 12, 6); Draw.fs(c, '#dff4ff', 2); c.restore(); } break;
      case 'leaf': Draw.ellipse(c, 0, 0, 26, 12); Draw.fs(c, PAL.green, Draw.LW); c.lineWidth = 3; c.strokeStyle = shade(PAL.green, -0.3); c.beginPath(); c.moveTo(-22, 0); c.lineTo(22, 0); c.stroke(); break;
      case 'corn': Draw.ellipse(c, 0, 0, 14, 30); Draw.fs(c, PAL.yellow, Draw.LW); c.fillStyle = shade(PAL.yellow, -0.2); for (let j = -2; j <= 2; j++) for (let i = -1; i <= 1; i++) { c.beginPath(); c.arc(i * 8, j * 11, 3, 0, TAU); c.fill(); } break;
      case 'lollipop': c.lineWidth = 5; c.strokeStyle = INK; c.beginPath(); c.moveTo(0, 10); c.lineTo(0, 40); c.stroke(); c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke(); c.beginPath(); c.arc(0, -4, 20, 0, TAU); Draw.fs(c, color || PAL.pink, Draw.LW); c.lineWidth = 4; c.strokeStyle = '#fff'; c.beginPath(); for (let a = 0; a < TAU * 2; a += 0.1) { const r = a * 2.6; c.lineTo(Math.cos(a) * r, -4 + Math.sin(a) * r); } c.stroke(); break;
      case 'cupcake': Draw.rrPath(c, -20, 0, 40, 28, 6); Draw.fs(c, '#f6c0e2', Draw.LW); c.beginPath(); c.arc(0, -6, 23, Math.PI, 0); c.closePath(); Draw.fs(c, color || PAL.pink, Draw.LW); c.beginPath(); c.arc(-4, -30, 6, 0, TAU); Draw.fs(c, PAL.red, 3); break;
      case 'donut': c.beginPath(); c.arc(0, 0, 26, 0, TAU); c.arc(0, 0, 9, 0, TAU, true); Draw.fs(c, '#e8a35a', Draw.LW); c.beginPath(); c.arc(0, 0, 9, 0, TAU); c.lineWidth = 4; c.strokeStyle = INK; c.stroke(); c.save(); c.beginPath(); c.arc(0, 0, 26, 0, TAU); c.arc(0, 0, 9, 0, TAU, true); c.clip(); c.beginPath(); c.arc(0, -3, 26, 0, TAU); c.fillStyle = color || PAL.pink; c.fill(); c.restore(); break;
      default: c.beginPath(); c.arc(0, 0, 20, 0, TAU); Draw.fs(c, color || PAL.red, Draw.LW);
    }
    c.restore();
  },

  /* ---------- Muster (für Geschenke): zeichnet in den aktuellen Clip ---------- */
  pattern(c, kind, x, y, w, h, color) {
    c.save(); c.fillStyle = color; c.strokeStyle = color;
    if (kind === 'dots') { for (let yy = y + 12; yy < y + h; yy += 24) for (let xx = x + 12 + ((yy - y) / 24 % 2 ? 12 : 0); xx < x + w; xx += 24) { c.beginPath(); c.arc(xx, yy, 6, 0, TAU); c.fill(); } }
    else if (kind === 'stripes') { c.lineWidth = 10; for (let xx = x - h; xx < x + w + h; xx += 28) { c.beginPath(); c.moveTo(xx, y + h); c.lineTo(xx + h, y); c.stroke(); } }
    else if (kind === 'stars') { for (let yy = y + 14; yy < y + h; yy += 28) for (let xx = x + 14 + ((yy - y) / 28 % 2 ? 14 : 0); xx < x + w; xx += 28) { Draw.starPath(c, xx, yy, 8, 3.6, 5); c.fill(); } }
    else if (kind === 'zigzag') { c.lineWidth = 6; for (let yy = y + 10; yy < y + h; yy += 24) { c.beginPath(); for (let xx = x, i = 0; xx <= x + w + 12; xx += 12, i++) c.lineTo(xx, yy + (i % 2 ? 8 : -8)); c.stroke(); } }
    else if (kind === 'hearts') { for (let yy = y + 14; yy < y + h; yy += 28) for (let xx = x + 14 + ((yy - y) / 28 % 2 ? 14 : 0); xx < x + w; xx += 28) { Draw.heartPath(c, xx, yy, 7); c.fill(); } }
    else if (kind === 'checks') { for (let yy = y; yy < y + h; yy += 20) for (let xx = x + ((yy - y) / 20 % 2 ? 20 : 0); xx < x + w; xx += 40) c.fillRect(xx, yy, 20, 20); }
    c.restore();
  },
  gift(c, x, y, w, h, color, pat = 'plain', o = {}) {
    const ribbon = o.ribbon || PAL.yellow, pc = o.patColor || '#fff';
    c.save(); c.translate(x, y);
    Draw.shadow(c, 0, h / 2 + 6, w / 2, 8, 0.15);
    Draw.rrPath(c, -w / 2, -h / 2 + h * 0.2, w, h * 0.8, 8); Draw.fs(c, color, Draw.LW);
    c.save(); Draw.rrPath(c, -w / 2, -h / 2 + h * 0.2, w, h * 0.8, 8); c.clip(); Draw.pattern(c, pat, -w / 2, -h / 2 + h * 0.2, w, h * 0.8, pc); c.restore();
    if (!o.open) { Draw.rrPath(c, -w / 2 - 6, -h / 2, w + 12, h * 0.3, 7); Draw.fs(c, color, Draw.LW); c.save(); Draw.rrPath(c, -w / 2 - 6, -h / 2, w + 12, h * 0.3, 7); c.clip(); Draw.pattern(c, pat, -w / 2 - 6, -h / 2, w + 12, h * 0.3, pc); c.restore(); }
    c.fillStyle = ribbon; c.fillRect(-w * 0.1, -h / 2 + (o.open ? h * 0.2 : 0), w * 0.2, h); c.lineWidth = 3; c.strokeStyle = INK; c.strokeRect(-w * 0.1, -h / 2 + (o.open ? h * 0.2 : 0), w * 0.2, h);
    if (!o.open) { for (const s of [-1, 1]) { Draw.ellipse(c, s * w * 0.18, -h / 2 - 6, w * 0.17, h * 0.13); Draw.fs(c, ribbon, 3); } c.beginPath(); c.arc(0, -h / 2 - 4, w * 0.07, 0, TAU); Draw.fs(c, ribbon, 3); }
    c.restore();
  },
  box(c, x, y, w, h, color, pat = 'plain', pc = '#fff') {
    c.save(); c.translate(x, y);
    Draw.shadow(c, 0, h / 2 + 6, w / 2, 8, 0.15);
    Draw.rrPath(c, -w / 2, -h / 2, w, h, 10); Draw.fs(c, color, Draw.LW);
    c.save(); Draw.rrPath(c, -w / 2, -h / 2, w, h, 10); c.clip(); Draw.pattern(c, pat, -w / 2, -h / 2, w, h, pc); c.restore();
    Draw.rrPath(c, -w / 2 - 8, -h / 2 - 16, w + 16, 26, 8); Draw.fs(c, shade(color, -0.12), Draw.LW);
    c.save(); Draw.rrPath(c, -w / 2 - 8, -h / 2 - 16, w + 16, 26, 8); c.clip(); Draw.pattern(c, pat, -w / 2 - 8, -h / 2 - 16, w + 16, 26, pc); c.restore();
    c.restore();
  },
  bus(c, x, y, color, w = 230, windows = 3, o = {}) {
    const h = w * 0.5;
    c.save(); c.translate(x, y);
    Draw.shadow(c, 0, h / 2 + 24, w / 2, 10, 0.16);
    Draw.rrPath(c, -w / 2, -h / 2, w, h, 22); Draw.fs(c, color, Draw.LW);
    c.fillStyle = shade(color, -0.2); Draw.rrPath(c, -w / 2 + 6, h * 0.2, w - 12, h * 0.16, 6); c.fill();
    const ww = (w - 40) / windows;
    for (let i = 0; i < windows; i++) { const wx = -w / 2 + 20 + i * ww + 6; Draw.rrPath(c, wx, -h / 2 + 14, ww - 12, h * 0.42, 8); Draw.fs(c, '#dff6ff', 3.5); }
    for (const wx of [-w * 0.3, w * 0.3]) { c.beginPath(); c.arc(wx, h / 2 + 2, w * 0.085, 0, TAU); Draw.fs(c, '#3b3b3b', Draw.LW); c.beginPath(); c.arc(wx, h / 2 + 2, w * 0.035, 0, TAU); Draw.fs(c, '#ddd', 2); }
    c.beginPath(); c.arc(w / 2 - 2, h * 0.1, 9, 0, TAU); Draw.fs(c, PAL.yellow, 3);
    c.restore();
    return { windows: Array.from({ length: windows }, (_, i) => ({ x: x - w / 2 + 20 + i * ww + ww / 2, y: y - h / 2 + 14 + h * 0.21 })) };
  },
  pot(c, x, y, color, w = 150, o = {}) {
    const h = w * 0.62;
    c.save(); c.translate(x, y);
    Draw.shadow(c, 0, h / 2 + 8, w / 2, 9, 0.16);
    for (const s of [-1, 1]) { Draw.rrPath(c, s * (w / 2 + 6) - 14, -h * 0.25, 28, 20, 8); Draw.fs(c, shade(color, -0.25), Draw.LW); }
    Draw.rrPath(c, -w / 2, -h / 2, w, h, 16); Draw.fs(c, color, Draw.LW);
    c.save(); c.globalAlpha *= 0.25; c.fillStyle = '#fff'; Draw.rrPath(c, -w / 2 + 10, -h / 2 + 8, 14, h - 20, 7); c.fill(); c.restore();
    Draw.ellipse(c, 0, -h / 2, w / 2 + 4, 14); Draw.fs(c, shade(color, -0.15), Draw.LW);
    Draw.ellipse(c, 0, -h / 2, w / 2 - 8, 8); Draw.fs(c, o.fill || '#ffe08a', 3);
    if (o.dots) { const n = o.dots; for (let i = 0; i < n; i++) { const dx = (i - (n - 1) / 2) * 30; c.beginPath(); c.arc(dx, h * 0.12, 11, 0, TAU); Draw.fs(c, '#fff', 3.5); } }
    c.restore();
  },
  ring(c, x, y, rx, color, ry) {
    ry = ry || rx * 0.42;
    c.save(); c.translate(x, y);
    Draw.ellipse(c, 0, ry * 0.55, rx, ry); Draw.fs(c, shade(color, -0.3), Draw.LW);
    c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, TAU); c.ellipse(0, 0, rx * 0.36, ry * 0.4, 0, 0, TAU, true); Draw.fs(c, color, Draw.LW);
    c.beginPath(); c.ellipse(0, 0, rx * 0.36, ry * 0.4, 0, 0, TAU); c.lineWidth = Draw.LW; c.strokeStyle = INK; c.stroke();
    Draw.shine(c, -rx * 0.5, -ry * 0.25, rx * 0.22, ry * 0.2, 0.5);
    c.restore();
  },
  peg(c, x, y, h = 300) {
    Draw.ellipse(c, x, y, 110, 34); Draw.fs(c, '#e8c27a', Draw.LW);
    Draw.rrPath(c, x - 14, y - h, 28, h, 14); Draw.fs(c, '#d8a24f', Draw.LW);
    c.save(); c.globalAlpha *= 0.3; c.fillStyle = '#fff'; Draw.rrPath(c, x - 9, y - h + 8, 7, h - 24, 4); c.fill(); c.restore();
  },
  cake(c, x, y, tiers = 3, o = {}) {
    const col = o.color || '#f6c0e2', cream = o.cream || '#fff6fb', W = o.w || 360, TH = o.th || 70;
    c.save(); c.translate(x, y);
    Draw.ellipse(c, 0, 0, W / 2 + 40, 30); Draw.fs(c, '#fff', Draw.LW);
    for (let i = 0; i < tiers; i++) {
      const tw = W - i * (W / tiers) * 0.95, th = TH, ty = -i * th;
      Draw.rrPath(c, -tw / 2, ty - th, tw, th, 12); Draw.fs(c, col, Draw.LW);
      c.beginPath(); c.moveTo(-tw / 2, ty - th + th * 0.2);
      for (let k = 0; k <= 8; k++) { const px = -tw / 2 + (k / 8) * tw; c.quadraticCurveTo(px - tw / 16, ty - th + th * 0.5, px, ty - th + th * 0.2); }
      c.lineTo(tw / 2, ty - th); c.lineTo(-tw / 2, ty - th); c.closePath(); Draw.fs(c, cream, 3.5);
    }
    if (o.candles) for (let i = 0; i < o.candles; i++) { const cx = (i - (o.candles - 1) / 2) * 34, cy = -tiers * TH - 6; Draw.rrPath(c, cx - 6, cy - 34, 12, 34, 4); Draw.fs(c, [PAL.red, PAL.blue, PAL.green, PAL.yellow][i % 4], 3); if (o.lit) { Draw.ellipse(c, cx, cy - 46 + Math.sin(Game.time * 12 + i) * 2, 6, 11); Draw.fs(c, PAL.orange, 2.5); Draw.ellipse(c, cx, cy - 44, 3, 5); Draw.fs(c, PAL.yellow, 0); } }
    c.restore();
  },
  bowl(c, x, y, r, color = '#ff9a2e') { Draw.ellipse(c, x, y + r * 0.35, r, r * 0.42); Draw.fs(c, shade(color, -0.2), Draw.LW); Draw.ellipse(c, x, y, r * 1.05, r * 0.38); Draw.fs(c, color, Draw.LW); Draw.ellipse(c, x, y, r * 0.85, r * 0.26); Draw.fs(c, shade(color, -0.35), 0); },
  lid(c, x, y, r, color = '#9fb7c9') {
    c.save(); c.translate(x, y);
    c.beginPath(); c.ellipse(0, 0, r * 1.1, r * 0.42, 0, 0, Math.PI, false); c.lineTo(-r * 1.1, 0); c.closePath(); Draw.fs(c, shade(color, -0.25), Draw.LW);
    c.beginPath(); c.ellipse(0, 0, r * 1.1, r * 0.42, 0, Math.PI, 0, false); c.lineTo(r * 1.1, 0); c.closePath();
    c.beginPath(); c.moveTo(-r * 1.1, 0); c.bezierCurveTo(-r * 1.1, -r * 0.95, r * 1.1, -r * 0.95, r * 1.1, 0); c.closePath(); Draw.fs(c, color, Draw.LW);
    Draw.shine(c, -r * 0.45, -r * 0.45, r * 0.25, r * 0.12, 0.5);
    c.beginPath(); c.arc(0, -r * 0.72, r * 0.16, 0, TAU); Draw.fs(c, shade(color, -0.35), Draw.LW);
    c.restore();
  },
  plate(c, x, y, r, color = '#fff') { Draw.ellipse(c, x, y, r, r * 0.36); Draw.fs(c, color, Draw.LW); Draw.ellipse(c, x, y, r * 0.68, r * 0.22); c.lineWidth = 2.5; c.strokeStyle = rgba(INK, 0.25); c.stroke(); },
  card(c, x, y, w, h, color = '#fff') {
    c.save(); c.translate(x, y); Draw.shadow(c, 6, h / 2 + 10, w / 2, 12, 0.14);
    Draw.rrPath(c, -w / 2, -h / 2, w, h, 18); Draw.fs(c, color, Draw.LW);
    c.lineWidth = 3; c.strokeStyle = rgba(PAL.pink, 0.9); c.setLineDash([10, 8]); Draw.rrPath(c, -w / 2 + 18, -h / 2 + 18, w - 36, h - 36, 12); c.stroke(); c.setLineDash([]);
    c.restore();
  },
  speech(c, x, y, w, h, tail = 'left') {
    Draw.rrPath(c, x - w / 2, y - h / 2, w, h, 22); Draw.fs(c, '#fff', Draw.LW);
    c.beginPath(); if (tail === 'left') { c.moveTo(x - w / 2 + 30, y + h / 2 - 2); c.lineTo(x - w / 2 + 10, y + h / 2 + 28); c.lineTo(x - w / 2 + 60, y + h / 2 - 2); } else { c.moveTo(x + w / 2 - 30, y + h / 2 - 2); c.lineTo(x + w / 2 - 10, y + h / 2 + 28); c.lineTo(x + w / 2 - 60, y + h / 2 - 2); }
    c.closePath(); Draw.fs(c, '#fff', Draw.LW); c.fillStyle = '#fff'; c.fillRect(x - w / 2 + (tail === 'left' ? 26 : w - 64), y + h / 2 - 8, 40, 10);
  },
  teddy(c, x, y, s = 1) { Draw.animal(c, 'bear', x, y, 26 * s, { shirt: PAL.red, blink: 0 }); },
  dots(c, x, y, n, r = 11, color = '#fff') { for (let i = 0; i < n; i++) { const dx = (i - (n - 1) / 2) * r * 2.7; c.beginPath(); c.arc(x + dx, y, r, 0, TAU); Draw.fs(c, color, 3.5); } },
};

/* ===== src/heroes.js ===== */
/* =====================================================================
   Helden: eigene Figuren mit Umhang, Maske, Helm und Superkraft.
   Das Kind wählt einen Helden; der begleitet es im Zimmer und in den Spielen.
   ===================================================================== */
const HEROES = [
  { id: 'bo', name: 'Kapitän Bo', kind: 'bear', shirt: PAL.red, cape: PAL.red, mask: PAL.yellow, star: PAL.yellow, say: 'Kapitän Bo ist stark wie ein Bär!' },
  { id: 'blitz', name: 'Blitz', kind: 'fox', shirt: PAL.blue, cape: PAL.yellow, mask: PAL.blue, bolt: PAL.yellow, say: 'Blitz ist schnell wie der Wind!' },
  { id: 'dax', name: 'Dino Dax', kind: 'dino', shirt: PAL.orange, helmet: 'fire', say: 'Dino Dax löscht jedes Feuer!' },
  { id: 'luna', name: 'Luna', kind: 'cat', shirt: '#e3ecff', helmet: 'space', star: PAL.blue, say: 'Luna fliegt bis zum Mond!' },
  { id: 'robi', name: 'Robi', kind: 'robot', shirt: '#9fb7c9', panel: true, say: 'Robi piept und blinkt!' },
  { id: 'funki', name: 'Funki', kind: 'dragon', shirt: PAL.purple, wings: '#c9a8ff', say: 'Funki pustet Seifenblasen!' },
  { id: 'pit', name: 'Pirat Pit', kind: 'pig', shirt: '#fff', stripes: PAL.red, pirate: true, say: 'Pirat Pit sucht den Schatz!' },
  { id: 'nessa', name: 'Ninja Nessa', kind: 'frog', shirt: '#3a3a4a', headband: PAL.red, say: 'Ninja Nessa hüpft ganz leise!' },
];
const heroById = (id) => HEROES.find((h) => h.id === id) || HEROES[0];
function currentHero() { return heroById(Store.data.hero); }
function otherHeroes() { const me = currentHero(); return HEROES.filter((h) => h !== me); }

/* Kleines Helden-Abzeichen oben in der Mitte: freut sich bei jedem Treffer */
function hudHero(c, g) {
  const h = currentHero(), joy = g && g.heroJoy !== undefined ? Game.time - g.heroJoy : 9, big = g && g.heroBig !== undefined ? Game.time - g.heroBig : 9;
  const k = joy < 0.5 ? 1 + Math.sin(joy / 0.5 * Math.PI) * 0.22 : 1;
  c.save(); c.translate(512, 64); c.scale(k, k);
  c.beginPath(); c.arc(0, 0, 38, 0, TAU); Draw.fs(c, '#fff', 4);
  c.save(); c.beginPath(); c.arc(0, 0, 34, 0, TAU); c.clip(); Draw.hero(c, h, 0, 8, 24, { headOnly: true, mood: joy < 0.5 || big < 1.2 ? 'open' : 'happy', blink: 0 }); c.restore();
  c.restore();
  if (big < 1.2) { for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i - 1) * 0.9, r = 52 + big * 30; Draw.starPath(c, 512 + Math.cos(a) * r, 64 + Math.sin(a) * r, 10, 4.5, 5); c.save(); c.globalAlpha = 1 - big / 1.2; Draw.fs(c, PAL.yellow, 2); c.restore(); } }
}

/* ---------- Heldenwahl ---------- */
function makeHeroSelect(back) {
  const cards = HEROES.map((h, i) => ({ h, x: 190 + (i % 4) * 215, y: 300 + Math.floor(i / 4) * 230, scale: 1 }));
  return {
    pressed: null, chosen: null,
    enter() { Music.duck(false); after(0.3, () => Voice.say('Wer spielt mit? Such dir einen Helden aus!', { force: true }), this); },
    hint() { const cd = cards[randi(0, cards.length - 1)]; return { x1: cd.x, y1: cd.y, x2: cd.x, y2: cd.y }; },
    hit(p) { return cards.find((cd) => inRect(p, cd.x, cd.y, 190, 205)); },
    down(p) {
      if (this.chosen) return;
      if (back && inCircle(p, 62, 62, 44)) { this.pressed = 'back'; Sound.play('tap'); return; }
      const cd = this.hit(p); if (cd) { this.pressed = cd; Sound.play('select'); tween(cd, { scale: 0.92 }, 0.1, { owner: this }); }
    },
    up(p) {
      const pr = this.pressed; this.pressed = null; if (!pr) return;
      if (pr === 'back') { if (inCircle(p, 62, 62, 60)) goHub(); return; }
      tween(pr, { scale: 1 }, 0.3, { ease: 'outBack', owner: this });
      if (this.hit(p) !== pr) return;
      this.chosen = pr; Store.data.hero = pr.h.id; Store.save();
      Sound.play('yay'); Voice.say(pr.h.say, { force: true });
      tween(pr, { scale: 1.25 }, 0.4, { ease: 'outElastic', owner: this });
      Particles.burst('star', pr.x, pr.y, 14, { colors: [PAL.yellow, '#fff'], speed: 260, life: 1, size: 14, g: 200 });
      after(1.4, () => setScene(makeHub(true), { color: PAL.yellow }), this);
    },
    draw(c) {
      Draw.sky(c, '#7fd7ff', '#e3f7ff'); Draw.cloud(c, 150 + Math.sin(Game.time * 0.3) * 20, 120, 36); Draw.cloud(c, 900, 100, 30);
      Draw.grass(c, 690, '#86d65a');
      Draw.label(c, 'Wer spielt mit?', 512, 110, 54, '#fff', INK, 700);
      for (const cd of cards) {
        const on = cd === this.chosen || (!this.chosen && Store.data.hero === cd.h.id);
        c.save(); c.translate(cd.x, cd.y); c.scale(cd.scale, cd.scale);
        Draw.rrPath(c, -92, -100, 184, 200, 24); Draw.fs(c, on ? PAL.btn : '#fff', 4);
        Draw.hero(c, cd.h, 0, -28, 36, { blink: 0, mood: on ? 'open' : 'happy', wave: on && Math.sin(Game.time * 5) > 0 });
        Draw.label(c, cd.h.name, 0, 76, 24, INK, null, 600);
        c.restore();
      }
      if (back) hudHome(c);
    },
  };
}

/* ===== src/sortgame.js ===== */
/* =====================================================================
   Generisches Sortierspiel: Objekte werden mit einem Finger in Zielplätze
   gezogen. Passt es, rastet es ein (Pop, Funken, Lob). Passt es nicht,
   springt es zurück (Boing). Kein Scheitern, kein Timer, keine Schrift.
   Jedes Spiel ist eine Beschreibung (def), siehe games/*.js.
   ===================================================================== */
const GAMES = [];
function registerGame(def) { GAMES.push(def); return def; }
const gameById = (id) => GAMES.find((g) => g.id === id);

function hudHome(c) {
  Draw.roundButton(c, 62, 62, 38, PAL.blueBtn, (cc, x, y) => Draw.iconHome(cc, x, y + 2, 22));
}
function hudRounds(c, i, n) {
  for (let k = 0; k < n; k++) { const x = DW - 40 - (n - 1 - k) * 34; c.beginPath(); c.arc(x, 62, 11, 0, TAU); Draw.fs(c, k < i ? PAL.yellow : 'rgba(255,255,255,0.55)', 3.5); if (k < i) { Draw.starPath(c, x, 62, 7, 3.2, 5); Draw.fs(c, PAL.orange, 0); } }
}
function goHub() { setScene(makeHub(), { color: PAL.yellow }); }

function makeSortGame(def) {
  const g = {
    def, items: [], slots: [], round: 0, specs: [], state: 'intro', drag: null, hover: null, wrongAt: -9, placedCount: 0, t: 0, homePressed: false,
    enter() {
      this.specs = def.rounds(Game.mode); this.round = 0; this.t = 0;
      Music.duck(false);
      this.startRound(true);
      after(0.5, () => Voice.say(def.intro), this);
    },
    exit() { Voice.stop(); },
    startRound(first) {
      this.items = []; this.slots = []; this.hover = null; this.drag = null; this.state = 'play';
      const spec = this.specs[this.round];
      def.setup(this, spec);
      this.items.forEach((it, i) => {
        it.hx = it.x; it.hy = it.y; it.placed = false; it.scale = 0; it.rot = it.rot || 0; it.z = i; it.r = it.r || 48; it.bob = rand(0, TAU);
        tween(it, { scale: 1 }, 0.45, { ease: 'outBack', delay: 0.15 + i * 0.07, owner: this });
      });
      this.slots.forEach((s) => { s.filled = s.filled || []; s.r = s.r || 70; s.glow = 0; });
      if (!first) Sound.play('swish');
      Game.lastInput = Game.time;
    },
    nextZ() { return (this.items.reduce((m, it) => Math.max(m, it.z), 0) || 0) + 1; },
    hitItem(p) {
      const list = this.items.filter((it) => !it.placed && it.scale > 0.5).sort((a, b) => b.z - a.z);
      for (const it of list) { const rr = it.r * (Game.small ? 1.25 : 1.1); if (it.hitTest ? it.hitTest(p, it) : (p.x - it.x) ** 2 + (p.y - it.y) ** 2 <= rr * rr) return it; }
      return null;
    },
    down(p) {
      if (inCircle(p, 62, 62, 44)) { this.homePressed = true; Sound.play('tap'); return; }
      if (this.state !== 'play') { if (def.tap) def.tap(this, p); return; }
      const it = this.hitItem(p);
      if (it) {
        this.drag = { it, ox: it.x - p.x, oy: it.y - p.y }; it.z = this.nextZ(); it.dragging = true; Game.dragging = true;
        Tweens.kill(it); tween(it, { scale: 1.14 }, 0.15, { owner: this });
        Sound.play('select', { pitch: 1 + rand(-0.1, 0.1) });
        if (def.pick) def.pick(this, it);
      } else if (def.tap) def.tap(this, p);
    },
    move(p) {
      const d = this.drag; if (!d) return;
      d.it.x = clamp(p.x + d.ox, View.L + 20, View.R - 20); d.it.y = clamp(p.y + d.oy, View.T + 20, View.B - 20);
      this.hover = this.bestSlot(d.it, false);
    },
    up(p) {
      if (this.homePressed) { this.homePressed = false; if (inCircle(p, 62, 62, 60)) { goHub(); } return; }
      const d = this.drag; if (!d) return;
      this.drag = null; Game.dragging = false; const it = d.it; it.dragging = false;
      const slot = this.bestSlot(it, false), near = this.bestSlot(it, true);
      this.hover = null;
      if (slot) this.placeItem(it, slot);
      else { if (near) this.wrong(it, near); this.sendHome(it, !!near); }
    },
    /* nächster Zielplatz in Reichweite: anySlot=false → nur passende, anySlot=true → auch unpassende (für das Boing) */
    bestSlot(it, anySlot) {
      let best = null, bd = 1e9;
      for (const s of this.slots) {
        if (s.filled.length >= (s.cap || 1)) continue;
        const d = Math.hypot(it.x - s.x, it.y - s.y), reach = s.r + (Game.small ? 30 : 10);
        if (d > reach || d >= bd) continue;
        if (anySlot || def.accept(it, s, this)) { best = s; bd = d; }
      }
      return best;
    },
    wrong(it, slot) {
      Sound.play('boing'); this.wrongAt = Game.time; slot.shake = 1; tween(slot, { shake: 0 }, 0.5, { owner: this });
      if (def.wrong) def.wrong(this, it, slot);
    },
    sendHome(it, bounced) {
      Tweens.kill(it);
      tween(it, { x: it.hx, y: it.hy, scale: 1, rot: 0 }, bounced ? 0.5 : 0.35, { ease: bounced ? 'outBounce' : 'outCubic', owner: this });
      if (!bounced) Sound.play('plop', { pitch: 1.3 });
    },
    placeItem(it, slot) {
      it.placed = true; it.slot = slot; slot.filled.push(it); it.z = this.nextZ(); this.placedCount++;
      const pos = def.place ? def.place(it, slot, this) : { x: slot.x, y: slot.y };
      Tweens.kill(it);
      tween(it, { x: pos.x, y: pos.y, scale: pos.scale === undefined ? 1 : pos.scale, rot: pos.rot || 0 }, 0.28, { ease: 'outBack', owner: this });
      Sound.play('pop', { pitch: 0.9 + slot.filled.length * 0.08 }); this.heroJoy = Game.time;
      Particles.burst('spark', pos.x, pos.y, 10, { colors: ['#fff', PAL.yellow], speed: 160, life: 0.5, size: 12 });
      slot.glow = 1; tween(slot, { glow: 0 }, 0.6, { owner: this });
      if (def.onPlace) def.onPlace(this, it, slot);
      const left = this.items.filter((x) => !x.placed).length;
      if (left === 0) this.roundDone(); else if (Math.random() < 0.45) Voice.praise();
    },
    roundDone() {
      this.state = 'celebrate'; Sound.play('success'); this.heroBig = Game.time;
      Particles.burst('confetti', DW / 2, DH * 0.45, 70, { colors: CONFETTI, speed: 420, g: 500, drag: 0.8, life: 2.2, size: 14, layer: 1 });
      if (def.onRound) def.onRound(this);
      const last = this.round >= this.specs.length - 1;
      Voice.say(last ? pick(['Geschafft! Super gemacht!', 'Fertig! Das war toll!']) : pick(['Geschafft!', 'Super! Weiter geht es!', 'Prima! Und noch eine Runde!']), { force: true });
      after(last ? 1.2 : 1.5, () => {
        if (last) this.finish(); else { this.items.forEach((it, i) => tween(it, { scale: 0 }, 0.3, { delay: i * 0.03, ease: 'inBack', owner: this })); after(0.45, () => { this.round++; this.startRound(false); }, this); }
      }, this);
    },
    finish() {
      this.state = 'done'; Sound.play('fanfare'); Particles.confettiRain(120);
      Store.data.done[Game.mode][def.id] = true; Store.data.plays++; Store.save();
      after(2.6, () => goHub(), this);
    },
    hint() {
      if (this.state !== 'play' || this.drag) return null;
      const it = def.hintItem ? def.hintItem(this) : this.items.filter((x) => !x.placed && x.scale > 0.9).sort((a, b) => a.z - b.z)[0]; if (!it) return null;
      const s = def.hintFor ? def.hintFor(it, this) : this.slots.find((sl) => sl.filled.length < (sl.cap || 1) && def.accept(it, sl, this));
      if (!s) return null;
      const pos = def.place && s ? def.place(it, s, this, true) : { x: s.x, y: s.y };
      return { x1: it.x, y1: it.y, x2: pos.x, y2: pos.y };
    },
    update(dt) {
      this.t += dt;
      for (const it of this.items) { if (!it.placed && !it.dragging && it.scale >= 0.99) { it.rot = Math.sin(Game.time * 2 + it.bob) * 0.04; } else if (it.dragging) it.rot = Math.sin(Game.time * 12) * 0.06; }
      if (def.update) def.update(this, dt);
    },
    draw(c) {
      def.bg(c, this);
      for (const s of this.slots) {
        c.save(); if (s.shake) c.translate(Math.sin(Game.time * 60) * 6 * s.shake, 0);
        def.drawSlot(c, s, this);
        if (this.hover === s && this.drag) { c.save(); c.globalAlpha = 0.5 + Math.sin(Game.time * 8) * 0.2; c.beginPath(); c.arc(s.x, s.y, s.r * 0.9, 0, TAU); c.lineWidth = 8; c.strokeStyle = '#fff'; c.stroke(); c.restore(); }
        c.restore();
      }
      if (def.mid) def.mid(c, this);
      const list = this.items.slice().sort((a, b) => (a.placed === b.placed ? a.z - b.z : a.placed ? -1 : 1));
      for (const it of list) {
        if (it.scale <= 0.01) continue;
        c.save(); c.translate(it.x, it.y);
        if (it.dragging) { Draw.shadow(c, 6, it.r * 0.9 + 10, it.r * 0.8, it.r * 0.3, 0.2); }
        c.rotate(it.rot || 0); c.scale(it.scale, it.scale);
        def.drawItem(c, it, this);
        c.restore();
      }
      if (def.fg) def.fg(c, this);
      hudHome(c); hudHero(c, this); hudRounds(c, this.round + (this.state !== 'play' ? 1 : 0), this.specs.length);
    },
  };
  return g;
}

/* Hilfen für Spielbeschreibungen */
function spreadX(n, x0, x1) { return Array.from({ length: n }, (_, i) => (n === 1 ? (x0 + x1) / 2 : x0 + (i / (n - 1)) * (x1 - x0))); }
function scatter(n, x0, x1, y0, y1, minD = 100) {
  // zufällige, aber nicht überlappende Startplätze
  const pts = [];
  for (let i = 0; i < n; i++) {
    let best = null, bd = -1;
    for (let k = 0; k < 40; k++) {
      const x = rand(x0, x1), y = rand(y0, y1);
      const d = Math.min(1e9, ...pts.map((p) => Math.hypot(p.x - x, p.y - y)));
      if (d > bd) { bd = d; best = { x, y }; }
      if (d > minD) break;
    }
    pts.push(best);
  }
  return pts;
}

/* ===== src/hub.js ===== */
/* =====================================================================
   Startbildschirm, Kinderzimmer (Hub mit Regalen, zwei Seiten), Elternbereich, Finale
   ===================================================================== */
const ORDER = ['rings', 'bus', 'cards', 'cake', 'pots', 'gifts', 'feed', 'picnic', 'balloons', 'pinata', 'drums', 'dressup', 'puzzle', 'hide'];
function orderedGames() { return GAMES.slice().sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99)); }
const doneCount = () => GAMES.filter((g) => Store.data.done[Game.mode][g.id]).length;
const PAGE_SIZE = 8;
let hubPage = 0;

/* ---------- Startbildschirm ---------- */
function makeTitle() {
  const letters = 'Konfetti'.split(''), cols = [PAL.red, PAL.orange, PAL.yellow, PAL.green, PAL.blue, PAL.purple, PAL.pink, PAL.red];
  const balloons = Array.from({ length: 7 }, (_, i) => ({ x: 90 + i * 140 + rand(-30, 30), y: rand(120, 700), color: cols[i % cols.length], sp: rand(18, 36), r: rand(26, 40) }));
  return {
    pressed: null,
    enter() { Music.duck(false); },
    hint() { return null; },
    down(p) {
      if (inRect(p, 512, 560, 320, 100)) { this.pressed = 'play'; Sound.play('tap'); }
      else if (inCircle(p, 430, 680, 46)) { this.pressed = 'small'; }
      else if (inCircle(p, 594, 680, 46)) { this.pressed = 'big'; }
    },
    up(p) {
      const pr = this.pressed; this.pressed = null;
      if (pr === 'play' && inRect(p, 512, 560, 360, 140)) {
        if (Store.data.hero) { Voice.say('Hallo! Komm, wir feiern eine Party!', { force: true }); setScene(makeHub(true), { color: PAL.yellow }); }
        else setScene(makeHeroSelect(false), { color: PAL.yellow });
      }
      if (pr === 'small' || pr === 'big') { Store.data.mode = pr; Store.save(); Sound.play('select', { pitch: pr === 'big' ? 1.3 : 1 }); Voice.say(pr === 'small' ? 'Für Kinder ab zwei.' : 'Für Kinder ab vier.', { force: true }); }
    },
    update(dt) { for (const b of balloons) { b.y -= b.sp * dt; if (b.y < View.T - 120) { b.y = View.B + 120; b.x = rand(View.L + 40, View.R - 40); } } },
    draw(c) {
      Draw.sky(c, '#7fd7ff', '#e3f7ff');
      Draw.cloud(c, 160 + Math.sin(Game.time * 0.3) * 20, 150, 40); Draw.cloud(c, 760 + Math.sin(Game.time * 0.25 + 2) * 20, 120, 44); Draw.sun(c, View.R - 120, View.T + 110, 50);
      for (const b of balloons) Draw.balloon(c, b.x, b.y, b.color, b.r);
      Draw.grass(c, 700, '#86d65a');
      c.save(); c.font = '700 122px Fredoka, "Arial Rounded MT Bold", sans-serif';
      const widths = letters.map((L) => c.measureText(L).width + 10), total = widths.reduce((a, b) => a + b, 0);
      let lx = 512 - total / 2;
      letters.forEach((L, i) => { const y = 215 + Math.sin(Game.time * 3 + i * 0.7) * 12; c.save(); c.translate(lx + widths[i] / 2, y); c.rotate(Math.sin(Game.time * 2 + i) * 0.08); Draw.label(c, L, 0, 0, 122, cols[i], INK, 700); c.restore(); lx += widths[i]; });
      c.restore();
      Draw.label(c, 'Partyspiele für Kinder ab 2', 512, 330, 36, '#fff', INK, 600);
      const me = currentHero(), other = otherHeroes()[0];
      Draw.hero(c, me, 190, 560 + Math.sin(Game.time * 2.5) * 6, 58, { wave: Math.sin(Game.time * 3) > 0 });
      Draw.hero(c, other, 850, 585 + Math.sin(Game.time * 2.5 + 1) * 6, 50, {});
      Draw.button(c, 512, 560, 320, 100, { label: 'Spielen', size: 48, pressed: this.pressed === 'play', icon: (cc, x, y) => Draw.iconPlay(cc, x, y, 20) });
      Draw.label(c, 'ab', 512, 680, 30, '#fff', INK, 600);
      for (const [x, m, t] of [[430, 'small', '2'], [594, 'big', '4']]) {
        const on = Store.data.mode === m, pr = this.pressed === m;
        Draw.roundButton(c, x, 680 + (pr ? 3 : 0), on ? 46 : 40, on ? PAL.btn : '#fff', (cc, xx, yy) => Draw.label(cc, t, xx, yy + 2, on ? 48 : 40, on ? PAL.btnText : '#9a9a9a', null, 700));
      }
    },
  };
}

/* ---------- Kinderzimmer: Regale mit Spielzeug, zwei Seiten ---------- */
function makeHub(fromTitle) {
  const shelfXs = spreadX(4, 200, 720), shelfYs = [300, 510];
  const all = orderedGames(), pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  hubPage = clamp(hubPage, 0, pages - 1);
  const toys = all.map((def, i) => ({ def, page: Math.floor(i / PAGE_SIZE), x: shelfXs[i % 4], y: shelfYs[Math.floor((i % PAGE_SIZE) / 4)] - 8, scale: 1, i }));
  const WALLS = [[PAL.wall, PAL.wallStar], ['#c9f0a8', '#d9f6c0']];
  const h = {
    toys, pressed: null, gearDown: null, finale: null, bubble: fromTitle ? 4 : 0, guests: [], cakeY: 0, swipe: null, slide: 0, pages,
    enter() {
      Music.duck(false);
      const n = doneCount(), nGuests = Math.min(otherHeroes().length, Math.floor(n * otherHeroes().length / all.length + 1e-6));
      this.guests = otherHeroes().slice(0, nGuests).map((hd, i) => ({ h: hd, x: 95 + i * 84, y: 605, bob: rand(0, TAU), jump: 0 }));
      if (fromTitle) after(0.3, () => Voice.say('Hilf mir, die Party vorzubereiten! Such dir ein Spiel aus.', { force: true }), this);
      if (n >= all.length && !Store.data.party[Game.mode]) after(0.9, () => this.startFinale(), this);
      else if (n >= all.length) this.cakeY = 1;
    },
    visible() { return this.toys.filter((t) => t.page === hubPage); },
    hint() {
      if (this.finale || Game.overlay) return null;
      const t = this.visible().find((x) => !Store.data.done[Game.mode][x.def.id]);
      if (t) return { x1: t.x, y1: t.y - 50, x2: t.x, y2: t.y - 50 };
      if (hubPage < this.pages - 1) return { x1: DW - 62, y1: 420, x2: DW - 62, y2: 420 };
      return null;
    },
    hitToy(p) { return this.visible().find((t) => inRect(p, t.x, t.y - 60, 150, 150)); },
    flip(dir) {
      const np = clamp(hubPage + dir, 0, this.pages - 1); if (np === hubPage) return;
      hubPage = np; Sound.play('swish'); this.slide = dir * 400; tween(this, { slide: 0 }, 0.45, { ease: 'outCubic', owner: this }); Game.lastInput = Game.time;
    },
    down(p) {
      if (this.finale) return;
      if (inCircle(p, DW - 52, 62, 40)) { this.gearDown = Game.time; Sound.play('tap'); return; }
      if (hubPage < this.pages - 1 && inCircle(p, DW - 62, 420, 50)) { this.pressed = 'right'; Sound.play('tap'); return; }
      if (hubPage > 0 && inCircle(p, 62, 420, 50)) { this.pressed = 'left'; Sound.play('tap'); return; }
      if (inRect(p, 935, 590, 170, 240)) { this.pressed = 'hero'; Sound.play('select'); return; }
      const t = this.hitToy(p);
      if (t) { this.pressed = t; Sound.play('select'); tween(t, { scale: 0.9 }, 0.12, { owner: this }); }
      this.swipe = { x: p.x, y: p.y };
    },
    move(p) { if (this.swipe && Math.abs(p.x - this.swipe.x) > 90) { const d = p.x < this.swipe.x ? 1 : -1; this.swipe = null; if (this.pressed && this.pressed.def) { tween(this.pressed, { scale: 1 }, 0.2, { owner: this }); } this.pressed = null; this.flip(d); } },
    up(p) {
      this.gearDown = null; this.swipe = null;
      const t = this.pressed; this.pressed = null;
      if (t === 'right') { if (inCircle(p, DW - 62, 420, 70)) this.flip(1); return; }
      if (t === 'left') { if (inCircle(p, 62, 420, 70)) this.flip(-1); return; }
      if (t === 'hero') { if (inRect(p, 935, 590, 200, 280)) { Voice.stop(); setScene(makeHeroSelect(true), { color: PAL.yellow }); } return; }
      if (t && t.def) { tween(t, { scale: 1 }, 0.25, { ease: 'outBack', owner: this }); if (this.hitToy(p) === t) this.open(t.def); }
    },
    open(def) { Voice.stop(); Sound.play('pop'); setScene(def.make ? def.make() : makeSortGame(def), { color: PAL.yellow }); },
    startFinale() {
      this.finale = { t: 0 }; Sound.play('fanfare'); Music.duck(true);
      Particles.confettiRain(160);
      after(0.4, () => Voice.say('Alles ist fertig! Die Party kann losgehen! Hurra!', { force: true }), this);
      tween(this, { cakeY: 1 }, 1.2, { ease: 'outBounce', delay: 0.5, owner: this });
      for (let i = 0; i < 6; i++) after(0.8 + i * 0.9, () => { Particles.confettiRain(60); Sound.play(i % 2 ? 'yay' : 'sparkle'); }, this);
      after(7, () => { this.finale = null; Store.data.party[Game.mode] = true; Store.save(); Music.duck(false); }, this);
    },
    update(dt) {
      if (this.bubble > 0) this.bubble -= dt;
      if (this.gearDown !== null) {
        if (!Input.down || !inCircle(Input, DW - 52, 62, 70)) this.gearDown = null;
        else if (Game.time - this.gearDown > 1.1) { this.gearDown = null; Sound.play('ding'); Game.overlay = makeParents(this); }
      }
      if (this.finale) { this.finale.t += dt; for (const g of this.guests) g.jump = Math.abs(Math.sin(Game.time * 6 + g.bob)) * 40; }
      else for (const g of this.guests) g.jump = 0;
    },
    draw(c) {
      const wall = WALLS[hubPage % WALLS.length];
      Draw.wallpaper(c, wall[0], wall[1]);
      Draw.floor(c, 640);
      const pageGames = all.slice(hubPage * PAGE_SIZE, hubPage * PAGE_SIZE + PAGE_SIZE);
      Draw.garland(c, View.L - 10, View.T + 36, DW - 120, View.T + 36, pageGames.map((g, i) => ({ color: CONFETTI[i % 7], on: !!Store.data.done[Game.mode][g.id] })), 50);
      c.save(); c.translate(this.slide, 0);
      for (const y of shelfYs) Draw.shelf(c, 460, y, 650);
      for (const t of this.visible()) {
        const done = !!Store.data.done[Game.mode][t.def.id];
        c.save(); c.translate(t.x, t.y); c.scale(t.scale, t.scale); if (this.pressed === t) c.translate(0, 4);
        Draw.shadow(c, 0, 4, 60, 10, 0.14);
        t.def.icon(c, 0, 0, 1);
        if (done) { c.save(); c.translate(58, -112); c.rotate(Math.sin(Game.time * 3 + t.i) * 0.15); Draw.starPath(c, 0, 0, 24, 11, 5); Draw.fs(c, PAL.yellow, 4); c.restore(); }
        c.restore();
      }
      c.restore();
      // Seitenpfeile
      if (hubPage < this.pages - 1) Draw.roundButton(c, DW - 62, 420 + (this.pressed === 'right' ? 3 : 0), 40, PAL.btn, (cc, x, y) => { cc.save(); cc.translate(x, y); cc.scale(-1, 1); Draw.iconArrow(cc, 0, 0, 20); cc.restore(); });
      if (hubPage > 0) Draw.roundButton(c, 62, 420 + (this.pressed === 'left' ? 3 : 0), 40, PAL.btn, (cc, x, y) => Draw.iconArrow(cc, x, y, 20));
      for (let i = 0; i < this.pages; i++) { c.beginPath(); c.arc(512 + (i - (this.pages - 1) / 2) * 26, 742, 8, 0, TAU); Draw.fs(c, i === hubPage ? PAL.btn : 'rgba(255,255,255,0.6)', 3); }
      // Gäste und Gastgeber
      for (const g of this.guests) Draw.hero(c, g.h, g.x, g.y - g.jump + Math.sin(Game.time * 2 + g.bob) * 3, 32, { hat: this.finale || Store.data.party[Game.mode] ? CONFETTI[(g.x / 84) % 7 | 0] : undefined, mood: this.finale ? 'open' : 'happy' });
      Draw.hero(c, currentHero(), 935, 575 + Math.sin(Game.time * 2.5) * 5, 50, { wave: this.bubble > 0 || this.finale ? Math.sin(Game.time * 4) > 0 : false, mood: this.finale ? 'open' : 'happy', scale: this.pressed === 'hero' ? 0.94 : 1 });
      if (this.cakeY > 0) { const y = lerp(View.B + 200, 690, this.cakeY); Draw.table(c, 775, y - 16, 230, '#f3d9a4'); Draw.cake(c, 775, y - 26, 3, { w: 170, th: 40, candles: Game.small ? 2 : 4, lit: true }); }
      if (this.bubble > 0 && !this.finale) { c.save(); c.globalAlpha = Math.min(1, this.bubble); Draw.speech(c, 760, 420, 300, 110, 'right'); Draw.label(c, 'Hilfst du mir?', 760, 420, 34, INK, null, 600); c.restore(); }
      Draw.roundButton(c, DW - 52, 62, 30, '#fff', (cc, x, y) => Draw.iconGear(cc, x, y, 15));
      if (this.gearDown !== null) { const p = clamp((Game.time - this.gearDown) / 1.1, 0, 1); c.lineWidth = 7; c.strokeStyle = PAL.blueBtn; c.beginPath(); c.arc(DW - 52, 62, 38, -Math.PI / 2, -Math.PI / 2 + p * TAU); c.stroke(); }
      if (this.finale) { Draw.label(c, 'Party!', 512, 128 + Math.sin(Game.time * 4) * 8, 96, PAL.yellow, INK, 700); }
    },
  };
  return h;
}

/* ---------- Elternbereich (Overlay) ---------- */
function makeParents(hub) {
  const rows = [
    { key: 'music', label: 'Musik', icon: Draw.iconNote }, { key: 'sfx', label: 'Geräusche', icon: Draw.iconSpeaker }, { key: 'voice', label: 'Sprache', icon: Draw.iconMouth },
  ];
  const ov = {
    pressed: null,
    down(p) {
      if (inRect(p, 660, 614, 240, 70)) this.pressed = 'close';
      else if (inRect(p, 364, 614, 240, 70)) this.pressed = 'reset';
      else if (inRect(p, 560, 250, 150, 70)) this.pressed = 'small';
      else if (inRect(p, 740, 250, 150, 70)) this.pressed = 'big';
      else rows.forEach((r, i) => { if (inRect(p, 640, 350 + i * 80, 320, 70)) this.pressed = r.key; });
      if (this.pressed) Sound.play('tap');
    },
    up() {
      const pr = this.pressed; this.pressed = null; if (!pr) return;
      if (pr === 'close') { Game.overlay = null; Sound.play('pop'); return; }
      if (pr === 'reset') { Store.resetProgress(Game.mode); Sound.play('swish'); Game.overlay = null; hubPage = 0; setScene(makeHub(), { instant: true }); return; }
      if (pr === 'small' || pr === 'big') { Store.data.mode = pr; Store.save(); Sound.play('select'); Game.overlay = null; setScene(makeHub(), { instant: true }); return; }
      Store.data.settings[pr] = !Store.data.settings[pr]; Store.save(); Sound.applySettings(); Sound.play('select');
      if (pr === 'voice' && Store.data.settings.voice) Voice.say('Sprache an.', { force: true });
    },
    draw(c) {
      c.fillStyle = 'rgba(20,10,30,0.6)'; c.fillRect(View.L - 5, View.T - 5, View.vw + 10, View.vh + 10);
      Draw.rrPath(c, 162, 110, 700, 560, 28); Draw.fs(c, '#fff', 5);
      Draw.label(c, 'Für Eltern', 512, 165, 44, INK, null, 700);
      Draw.label(c, `Geschafft: ${doneCount()} von ${GAMES.length} Spielen`, 512, 205, 24, '#777', null, 500);
      Draw.label(c, 'Alter', 320, 250, 30, INK, null, 600, 'left');
      for (const [x, m, t] of [[560, 'small', 'ab 2'], [740, 'big', 'ab 4']]) { const on = Store.data.mode === m; Draw.button(c, x, 250, 150, 66, { label: t, size: 30, color: on ? PAL.btn : '#eee', text: on ? PAL.btnText : '#999', pressed: this.pressed === m }); }
      rows.forEach((r, i) => {
        const y = 350 + i * 80, on = Store.data.settings[r.key];
        r.icon(c, 330, y, 16); Draw.label(c, r.label, 370, y, 30, INK, null, 600, 'left');
        Draw.check(c, 760, y, 26, on);
      });
      Draw.button(c, 364, 614, 240, 70, { label: 'Neue Party', size: 28, color: '#eee', text: '#666', pressed: this.pressed === 'reset' });
      Draw.button(c, 660, 614, 240, 70, { label: 'Zurück', size: 30, pressed: this.pressed === 'close' });
    },
  };
  return ov;
}

/* ===== src/games/balloons.js ===== */
/* =====================================================================
   Spiel: Luftballons – alle Ballons einer FARBE antippen (Tippen statt Ziehen).
   Der Held sagt die Farbe an und zeigt sie in seiner Sprechblase.
   ===================================================================== */
(() => {
  const COLS = ['red', 'blue', 'green', 'yellow', 'purple'];
  const ADJ = { red: 'roten', blue: 'blauen', green: 'grünen', yellow: 'gelben', purple: 'lila' };
  function makeBalloons() {
    const def = gameById('balloons');
    return {
      specs: [], round: 0, state: 'play', balloons: [], target: null, left: 0, homePressed: false, heroJoy: -9, heroBig: -9,
      enter() {
        this.specs = Game.small ? [{ colors: 2, targets: 3, speed: 28 }, { colors: 2, targets: 4, speed: 34 }, { colors: 3, targets: 4, speed: 40 }] : [{ colors: 3, targets: 4, speed: 44 }, { colors: 4, targets: 5, speed: 54 }, { colors: 5, targets: 6, speed: 64 }];
        this.round = 0; Music.duck(false); this.startRound();
        after(0.4, () => Voice.say(def.intro, { force: true }), this);
      },
      exit() { Voice.stop(); },
      startRound() {
        const spec = this.specs[this.round], cols = sample(COLS, spec.colors);
        this.target = cols[0]; this.left = spec.targets; this.state = 'play';
        this.balloons = [];
        const total = spec.targets + (spec.colors - 1) * Math.max(2, spec.targets - 1);
        const pts = scatter(total, 150, 880, 120, 560, 120);
        let k = 0;
        for (let i = 0; i < spec.targets; i++) this.balloons.push({ x: pts[k].x, y: pts[k++].y, color: this.target, r: 46, vy: rand(0.8, 1.2) * spec.speed, alive: true, wob: 0, ph: rand(0, TAU) });
        for (const col of cols.slice(1)) for (let i = 0; i < Math.max(2, spec.targets - 1); i++) this.balloons.push({ x: pts[k].x, y: pts[k++].y, color: col, r: 46, vy: rand(0.8, 1.2) * spec.speed, alive: true, wob: 0, ph: rand(0, TAU) });
        after(0.9, () => Voice.say(`Tipp alle ${ADJ[this.target]} Luftballons!`, { force: true }), this);
        Game.lastInput = Game.time;
      },
      down(p) {
        if (inCircle(p, 62, 62, 44)) { this.homePressed = true; Sound.play('tap'); return; }
        if (this.state !== 'play') return;
        const hit = this.balloons.filter((b) => b.alive && inCircle(p, b.x, b.y, b.r + 16)).sort((a, b) => dist(p.x, p.y, a.x, a.y) - dist(p.x, p.y, b.x, b.y))[0];
        if (!hit) return;
        if (hit.color === this.target) {
          hit.alive = false; this.left--; this.heroJoy = Game.time;
          Sound.play('pop', { pitch: 1.1 + rand(-0.15, 0.15) }); Sound.play('click');
          Particles.burst('puff', hit.x, hit.y, 10, { color: PAL[hit.color], speed: 260, life: 0.5, size: 16 });
          Particles.burst('confetti', hit.x, hit.y, 10, { colors: [PAL[hit.color], '#fff'], speed: 220, g: 400, life: 1.2, size: 10 });
          if (this.left <= 0) this.roundDone(); else if (Math.random() < 0.5) Voice.praise();
        } else { Sound.play('boing'); hit.wob = 1; tween(hit, { wob: 0 }, 0.5, { owner: this }); Voice.say(`Nein, die ${ADJ[this.target]}!`, {}); }
      },
      up(p) { if (this.homePressed) { this.homePressed = false; if (inCircle(p, 62, 62, 60)) goHub(); } },
      roundDone() {
        this.state = 'celebrate'; this.heroBig = Game.time; Sound.play('success');
        Particles.burst('confetti', DW / 2, DH * 0.45, 70, { colors: CONFETTI, speed: 420, g: 500, drag: 0.8, life: 2.2, size: 14, layer: 1 });
        const last = this.round >= this.specs.length - 1;
        Voice.say(last ? 'Geschafft! Alle Ballons gefunden!' : 'Super! Jetzt eine andere Farbe!', { force: true });
        after(1.6, () => { if (last) this.finish(); else { this.round++; this.startRound(); } }, this);
      },
      finish() { this.state = 'done'; Sound.play('fanfare'); Particles.confettiRain(120); Store.data.done[Game.mode][def.id] = true; Store.data.plays++; Store.save(); after(2.6, () => goHub(), this); },
      hint() { if (this.state !== 'play') return null; const b = this.balloons.find((x) => x.alive && x.color === this.target); return b ? { x1: b.x, y1: b.y, x2: b.x, y2: b.y } : null; },
      update(dt) {
        for (const b of this.balloons) {
          if (!b.alive) continue;
          b.y -= b.vy * dt; b.x += Math.sin(Game.time * 1.3 + b.ph) * 18 * dt;
          if (b.y < View.T - 80) { b.y = View.B + 70; b.x = rand(150, 880); }
          if (b.x < View.L + 60) b.x = View.L + 60; if (b.x > View.R - 60) b.x = View.R - 60;
        }
      },
      draw(c) {
        Draw.sky(c, '#8fdcff', '#eaf8ff'); Draw.cloud(c, 300 + Math.sin(Game.time * 0.2) * 25, 150, 34); Draw.cloud(c, 820, 230, 28);
        Draw.grass(c, 690, '#8ad65c');
        for (const b of this.balloons) { if (!b.alive) continue; c.save(); c.translate(b.x, b.y); c.rotate(Math.sin(Game.time * 40) * 0.2 * b.wob); Draw.balloon(c, 0, 0, PAL[b.color], b.r, { sway: Math.sin(Game.time * 2 + b.ph) * 0.08 }); c.restore(); }
        // Held mit Sprechblase: die gesuchte Farbe
        const hy = 620 + Math.sin(Game.time * 2.5) * 4;
        Draw.hero(c, currentHero(), 120, hy, 48, { mood: this.state === 'play' ? 'wow' : 'open' });
        if (this.state === 'play') { Draw.speech(c, 215, 455, 150, 120, 'left'); Draw.balloon(c, 215, 448, PAL[this.target], 32, { sway: 0, noString: true }); }
        hudHome(c); hudHero(c, this); hudRounds(c, this.round + (this.state !== 'play' ? 1 : 0), this.specs.length);
      },
    };
  }
  registerGame({
    id: 'balloons', name: 'Luftballons', make: makeBalloons,
    intro: 'Hier kommen die Luftballons! Tipp nur auf die Farbe, die ich dir sage.',
    icon(c, x, y) { Draw.balloon(c, x - 30, y - 70, PAL.red, 26, { sway: 0 }); Draw.balloon(c, x + 26, y - 82, PAL.blue, 26, { sway: 0 }); Draw.balloon(c, x + 2, y - 56, PAL.yellow, 24, { sway: 0 }); },
  });
})();

/* ===== src/games/bus.js ===== */
/* =====================================================================
   Spiel: Bus – Gäste nach FARBE in den passenden Bus ziehen.
   Vorlage für alle Sortierspiele: Beschreibung (def) für makeSortGame.
   ===================================================================== */
(() => {
  const BUS_W = 230, KINDS = ['rabbit', 'cat', 'dog', 'bird', 'pig', 'frog', 'fox'];
  const COLS = ['red', 'blue', 'green', 'yellow'];
  function windowsOf(x, y, w, n) { const h = w * 0.5, ww = (w - 40) / n; return Array.from({ length: n }, (_, i) => ({ x: x - w / 2 + 20 + i * ww + ww / 2, y: y - h / 2 + 14 + h * 0.21 })); }

  registerGame({
    id: 'bus', name: 'Bus',
    intro: 'Alle Gäste wollen zur Party fahren. Zieh jeden Gast in den Bus mit seiner Farbe!',
    icon(c, x, y) { Draw.bus(c, x, y - 48, PAL.red, 125, 2); Draw.balloon(c, x + 40, y - 120, PAL.blue, 16); },
    rounds(mode) { return mode === 'small' ? [{ colors: 2, per: 2 }, { colors: 2, per: 2 }, { colors: 3, per: 2 }] : [{ colors: 3, per: 2 }, { colors: 3, per: 3 }, { colors: 4, per: 2 }]; },
    setup(g, spec) {
      const cols = sample(COLS, spec.colors), xs = spreadX(spec.colors, 250, 774);
      g.slots = cols.map((col, i) => ({ x: xs[i], y: 560, r: 125, color: col, cap: spec.per, filled: [], win: windowsOf(xs[i], 560, BUS_W, spec.per) }));
      const pts = scatter(spec.colors * spec.per, 150, 880, 140, 380, 150);
      g.items = []; let k = 0;
      for (const col of cols) for (let j = 0; j < spec.per; j++) { const p = pts[k++]; g.items.push({ x: p.x, y: p.y, r: 52, color: col, kind: pick(KINDS) }); }
      shuffle(g.items);
    },
    accept(it, s) { return it.color === s.color; },
    place(it, s, g, preview) { const idx = preview ? s.filled.length : s.filled.indexOf(it); const w = s.win[Math.min(idx, s.win.length - 1)]; return { x: w.x, y: w.y + 4, scale: 0.8 }; },
    onPlace(g, it, s) { if (s.filled.length >= s.cap) { Sound.play('honk'); s.bounce = 1; tween(s, { bounce: 0 }, 0.6, { ease: 'outElastic', owner: g }); } },
    bg(c, g) {
      Draw.sky(c);
      Draw.sun(c, View.R - 130, 190, 44); Draw.cloud(c, 200 + Math.sin(Game.time * 0.2) * 30, 110, 36); Draw.cloud(c, 620, 80, 30);
      // Hügel und Straße
      c.fillStyle = '#9ddc6a'; c.beginPath(); c.moveTo(View.L - 10, 520); c.quadraticCurveTo(300, 380, 620, 500); c.quadraticCurveTo(820, 400, View.R + 10, 500); c.lineTo(View.R + 10, 700); c.lineTo(View.L - 10, 700); c.closePath(); c.fill();
      c.fillStyle = '#6f6f78'; c.fillRect(View.L - 10, 600, View.vw + 20, View.B - 600 + 20);
      c.lineWidth = 5; c.strokeStyle = INK; c.beginPath(); c.moveTo(View.L - 10, 600); c.lineTo(View.R + 10, 600); c.stroke();
      c.lineWidth = 6; c.strokeStyle = '#fff'; c.setLineDash([36, 28]); c.beginPath(); c.moveTo(View.L - 10, 680); c.lineTo(View.R + 10, 680); c.stroke(); c.setLineDash([]);
    },
    drawSlot(c, s) { c.save(); if (s.bounce) c.translate(0, -Math.sin(s.bounce * Math.PI) * 14); Draw.bus(c, s.x, s.y, PAL[s.color], BUS_W, s.cap); c.restore(); },
    drawItem(c, it) {
      if (!it.placed) { Draw.balloon(c, 2, -64, PAL[it.color], 24); Draw.animal(c, it.kind, 0, 12, 30, { shirt: PAL[it.color] }); }
      else { Draw.animal(c, it.kind, 0, 0, 26, { shirt: PAL[it.color], headOnly: true, mood: 'happy' }); Draw.balloon(c, 30, -34, PAL[it.color], 12, { noString: true }); }
    },
  });
})();

/* ===== src/games/cake.js ===== */
/* =====================================================================
   Spiel: Torte – Früchte nach GRÖSSE auf die Torte setzen:
   große nach unten, mittlere in die Mitte, kleine nach oben.
   ===================================================================== */
(() => {
  const CX = 640, CY = 610, W = 380;
  const SIZES = { big: { scale: 1.5, r: 66, tier: 0, gap: 110 }, medium: { scale: 1.05, r: 50, tier: 1, gap: 72 }, small: { scale: 0.7, r: 40, tier: 2, gap: 44 } };
  const KINDS = ['strawberry', 'cherry', 'apple'];
  registerGame({
    id: 'cake', name: 'Torte',
    intro: 'Die Torte braucht noch Früchte! Die großen nach unten, die kleinen nach oben.',
    icon(c, x, y) { Draw.cake(c, x, y - 8, 3, { w: 112, th: 34, color: '#f6c0e2' }); Draw.food(c, 'strawberry', x, y - 122, 0.42); Draw.food(c, 'strawberry', x - 40, y - 50, 0.36); Draw.food(c, 'strawberry', x + 40, y - 50, 0.36); },
    rounds(mode) {
      return mode === 'small'
        ? [{ sizes: ['big', 'small'], per: 1, kind: 'strawberry' }, { sizes: ['big', 'medium', 'small'], per: 1, kind: 'cherry' }, { sizes: ['big', 'medium', 'small'], per: 1, kind: 'apple' }]
        : [{ sizes: ['big', 'medium', 'small'], per: 2, kind: 'strawberry' }, { sizes: ['big', 'medium', 'small'], per: 2, kind: 'cherry' }, { sizes: ['big', 'medium', 'small'], per: 3, kind: 'apple' }];
    },
    setup(g, spec) {
      g.slots = spec.sizes.map((sz) => { const S = SIZES[sz]; return { x: CX, y: CY - (S.tier + 1) * 70 - 14, r: S.tier === 0 ? 120 : S.tier === 1 ? 95 : 80, size: sz, cap: spec.per, filled: [], gap: S.gap }; });
      const n = spec.sizes.length * spec.per, pts = scatter(n, 130, 420, 170, 620, 135);
      g.items = []; let k = 0;
      for (const sz of spec.sizes) for (let j = 0; j < spec.per; j++) { const p = pts[k++]; g.items.push({ x: p.x, y: p.y, r: SIZES[sz].r, size: sz, kind: spec.kind }); }
      shuffle(g.items);
    },
    accept(it, s) { return it.size === s.size; },
    place(it, s, g, preview) { const idx = preview ? s.filled.length : s.filled.indexOf(it); return { x: s.x + (idx - (s.cap - 1) / 2) * s.gap, y: s.y }; },
    hintFor(it, g) { return g.slots.find((s) => s.size === it.size && s.filled.length < s.cap); },
    bg(c) {
      Draw.wallpaper(c, '#fff1cf', '#fff7e3');
      Draw.floor(c, 690, '#d9a66b');
      Draw.table(c, CX, 640, 520, '#f3d9a4');
      Draw.cake(c, CX, CY, 3, { w: W, color: '#f6c0e2', cream: '#fff6fb' });
    },
    drawSlot(c, s) { if (s.glow) { c.save(); c.globalAlpha = s.glow * 0.7; Draw.ellipse(c, s.x, s.y + 12, s.r * 0.9, 16); c.fillStyle = PAL.yellow; c.fill(); c.restore(); } },
    drawItem(c, it) { Draw.food(c, it.kind, 0, 0, SIZES[it.size].scale); },
    wrong(g, it, s) { Voice.say(it.size === 'big' ? 'Die große nach unten!' : it.size === 'small' ? 'Die kleine nach oben!' : 'Die mittlere in die Mitte!', { force: true }); },
  });
})();

/* ===== src/games/cards.js ===== */
/* =====================================================================
   Spiel: Einladungskarten – Formen in die passenden Löcher der Karte ziehen.
   ===================================================================== */
(() => {
  const KINDS = ['circle', 'square', 'triangle', 'star', 'heart', 'hexagon', 'diamond'];
  const COLOR_OF = { circle: PAL.red, square: PAL.blue, triangle: PAL.green, star: PAL.yellow, heart: PAL.pink, hexagon: PAL.purple, diamond: PAL.orange, moon: '#58b7ff' };
  const S = 50; // Größe der Formen
  registerGame({
    id: 'cards', name: 'Einladungskarten',
    intro: 'Die Einladung ist noch leer! Zieh jede Form in das passende Loch.',
    icon(c, x, y) { Draw.card(c, x, y - 52, 112, 82, '#fff'); Draw.shape(c, 'star', x - 30, y - 52, 13, PAL.yellow, { lw: 3 }); Draw.shape(c, 'heart', x, y - 52, 13, PAL.pink, { lw: 3 }); Draw.shape(c, 'circle', x + 30, y - 52, 12, PAL.red, { lw: 3 }); },
    rounds(mode) { return mode === 'small' ? [{ n: 2 }, { n: 3 }, { n: 3 }] : [{ n: 4 }, { n: 5 }, { n: 6 }]; },
    setup(g, spec) {
      const kinds = sample(KINDS, spec.n), xs = spreadX(spec.n, 512 - (spec.n - 1) * 64, 512 + (spec.n - 1) * 64);
      g.slots = kinds.map((k, i) => ({ x: xs[i], y: 320, r: 60, kind: k, cap: 1, filled: [] }));
      const pts = scatter(spec.n, 170, 860, 520, 640, 140);
      g.items = kinds.map((k, i) => ({ x: pts[i].x, y: pts[i].y, r: 62, kind: k }));
      shuffle(g.items);
    },
    accept(it, s) { return it.kind === s.kind; },
    place(it, s) { return { x: s.x, y: s.y }; },
    onRound(g) { Particles.burst('star', 512, 320, 16, { colors: [PAL.yellow, PAL.pink, '#fff'], speed: 220, life: 1.1, size: 14, g: 120 }); },
    bg(c, g) {
      Draw.wallpaper(c, '#ffd9e6', '#ffe6ef');
      Draw.floor(c, 690, '#e9b98a');
      // Tisch mit Karte
      Draw.rrPath(c, View.L - 10, 380, View.vw + 20, 320, 0); c.fillStyle = '#f8ead2'; c.fill();
      c.lineWidth = 5; c.strokeStyle = INK; c.beginPath(); c.moveTo(View.L - 10, 380); c.lineTo(View.R + 10, 380); c.stroke();
      const w = Math.max(380, g.slots.length * 128 + 150);
      Draw.card(c, 512, 320, w, 240, '#fff');
      // Girlande auf der Karte als Deko
      c.lineWidth = 3; c.strokeStyle = PAL.pink; c.beginPath(); c.moveTo(512 - w / 2 + 40, 235); c.quadraticCurveTo(512, 265, 512 + w / 2 - 40, 235); c.stroke();
      for (let i = 0; i < 5; i++) { const t = (i + 1) / 6, px = 512 - w / 2 + 40 + t * (w - 80), py = 235 + 4 * (1 - (2 * t - 1) ** 2) * 7; c.beginPath(); c.moveTo(px - 8, py); c.lineTo(px + 8, py); c.lineTo(px, py + 16); c.closePath(); Draw.fs(c, [PAL.yellow, PAL.blue, PAL.green, PAL.red, PAL.purple][i], 2); }
    },
    drawSlot(c, s) {
      Draw.shape(c, s.kind, s.x, s.y, S, null, { silhouette: 'rgba(43,29,20,0.22)' });
      c.save(); c.setLineDash([8, 6]); c.lineWidth = 3; c.strokeStyle = rgba(INK, 0.45); Draw.shapePath(c, s.kind, s.x, s.y, S); c.stroke(); c.restore();
      if (s.glow) { c.save(); c.globalAlpha = s.glow; c.lineWidth = 8; c.strokeStyle = PAL.yellow; Draw.shapePath(c, s.kind, s.x, s.y, S + 8); c.stroke(); c.restore(); }
    },
    drawItem(c, it) { Draw.shape(c, it.kind, 0, 0, S, COLOR_OF[it.kind]); },
  });
})();

/* ===== src/games/dressup.js ===== */
/* =====================================================================
   Spiel: Verkleiden – Hut auf den Kopf, Brille auf die Nase, Schleife an den Hals,
   Ballon in die Hand (Zuordnen nach BEDEUTUNG / Körperstelle).
   ===================================================================== */
(() => {
  const CX = 660, CY = 400, R = 92;
  const SLOTS = { head: { x: CX, y: CY - R * 1.15, r: 95 }, eyes: { x: CX, y: CY - R * 0.12, r: 70 }, neck: { x: CX, y: CY + R * 0.95, r: 70 }, hand: { x: CX + R * 1.05, y: CY + R * 1.75, r: 70 } };
  const ITEMS = {
    head: [{ kind: 'partyhat', color: PAL.purple }, { kind: 'crown', color: PAL.yellow }, { kind: 'cap', color: PAL.red }],
    eyes: [{ kind: 'sunglasses', color: '#2b2b35' }, { kind: 'starglasses', color: PAL.yellow }],
    neck: [{ kind: 'bowtie', color: PAL.red }, { kind: 'scarf', color: PAL.blue }],
    hand: [{ kind: 'balloon', color: PAL.pink }, { kind: 'flag', color: PAL.green }, { kind: 'lolli', color: PAL.orange }],
  };
  const KINDS = ['rabbit', 'cat', 'dog', 'pig', 'bear', 'fox'];
  const NAMES = { rabbit: 'Der Hase', cat: 'Die Katze', dog: 'Der Hund', pig: 'Das Schwein', bear: 'Der Bär', fox: 'Der Fuchs' };
  function drawAcc(c, it) {
    switch (it.kind) {
      case 'partyhat': Draw.hat(c, 0, 10, 44, it.color, PAL.yellow); break;
      case 'crown': c.beginPath(); c.moveTo(-40, 24); c.lineTo(-40, -22); c.lineTo(-20, 0); c.lineTo(0, -30); c.lineTo(20, 0); c.lineTo(40, -22); c.lineTo(40, 24); c.closePath(); Draw.fs(c, it.color, Draw.LW); for (const dx of [-40, 0, 40]) { c.beginPath(); c.arc(dx, dx === 0 ? -30 : -22, 6, 0, TAU); Draw.fs(c, PAL.red, 2); } break;
      case 'cap': c.beginPath(); c.arc(0, 6, 42, Math.PI, 0); c.closePath(); Draw.fs(c, it.color, Draw.LW); Draw.rrPath(c, -8, 2, 64, 16, 8); Draw.fs(c, shade(it.color, -0.2), Draw.LW); c.beginPath(); c.arc(0, -36, 7, 0, TAU); Draw.fs(c, it.color, 3); break;
      case 'sunglasses': for (const s of [-1, 1]) { Draw.rrPath(c, s * 36 - 26, -16, 52, 34, 12); Draw.fs(c, it.color, Draw.LW); Draw.shine(c, s * 36 - 10, -8, 8, 4, 0.5); } c.lineWidth = 4; c.strokeStyle = INK; c.beginPath(); c.moveTo(-10, -4); c.lineTo(10, -4); c.stroke(); break;
      case 'starglasses': for (const s of [-1, 1]) { Draw.starPath(c, s * 36, 0, 30, 14, 5); Draw.fs(c, it.color, Draw.LW); } c.lineWidth = 4; c.strokeStyle = INK; c.beginPath(); c.moveTo(-10, -2); c.lineTo(10, -2); c.stroke(); break;
      case 'bowtie': c.beginPath(); c.moveTo(0, 0); c.lineTo(-44, -24); c.lineTo(-44, 24); c.closePath(); Draw.fs(c, it.color, Draw.LW); c.beginPath(); c.moveTo(0, 0); c.lineTo(44, -24); c.lineTo(44, 24); c.closePath(); Draw.fs(c, it.color, Draw.LW); c.beginPath(); c.arc(0, 0, 10, 0, TAU); Draw.fs(c, shade(it.color, -0.3), 3); break;
      case 'scarf': Draw.rrPath(c, -52, -14, 104, 28, 14); Draw.fs(c, it.color, Draw.LW); Draw.rrPath(c, 10, 4, 26, 56, 10); Draw.fs(c, it.color, Draw.LW); c.lineWidth = 3; c.strokeStyle = rgba('#ffffff', 0.7); for (const dy of [38, 48]) { c.beginPath(); c.moveTo(14, dy); c.lineTo(32, dy); c.stroke(); } break;
      case 'balloon': Draw.balloon(c, 0, -30, it.color, 30, { sway: 0 }); break;
      case 'flag': c.lineWidth = 5; c.strokeStyle = INK; c.beginPath(); c.moveTo(-20, -50); c.lineTo(-20, 40); c.stroke(); c.lineWidth = 3; c.strokeStyle = '#d8a24f'; c.stroke(); c.beginPath(); c.moveTo(-18, -50); c.lineTo(40, -30); c.lineTo(-18, -10); c.closePath(); Draw.fs(c, it.color, Draw.LW); break;
      case 'lolli': Draw.food(c, 'lollipop', 0, -10, 1.1, it.color); break;
      default: break;
    }
  }
  registerGame({
    id: 'dressup', name: 'Verkleiden',
    intro: 'Die Gäste wollen sich verkleiden! Zieh jedes Teil dahin, wo es hingehört.',
    icon(c, x, y) { Draw.animal(c, 'rabbit', x, y - 72, 30, { shirt: PAL.green, hat: PAL.purple, blink: 0 }); c.save(); c.translate(x, y - 76); c.scale(0.5, 0.5); drawAcc(c, { kind: 'sunglasses', color: '#2b2b35' }); c.restore(); },
    rounds(mode) {
      return mode === 'small'
        ? [{ slots: ['head', 'eyes'] }, { slots: ['head', 'neck'] }, { slots: ['head', 'eyes', 'hand'] }]
        : [{ slots: ['head', 'eyes', 'neck'] }, { slots: ['head', 'eyes', 'neck', 'hand'] }, { slots: ['head', 'eyes', 'neck', 'hand'] }];
    },
    setup(g, spec) {
      g.kind = KINDS[(g.round + randi(0, 5)) % KINDS.length]; g.shirt = pick([PAL.green, PAL.blue, PAL.orange, PAL.purple]);
      g.slots = spec.slots.map((k) => ({ x: SLOTS[k].x, y: SLOTS[k].y, r: SLOTS[k].r, kind: k, cap: 1, filled: [] }));
      const pts = scatter(spec.slots.length, 130, 420, 160, 620, 150);
      g.items = spec.slots.map((k, i) => { const it = pick(ITEMS[k]); return { x: pts[i].x, y: pts[i].y, r: 58, slot: k, kind: it.kind, color: it.color }; });
      shuffle(g.items);
      after(0.9, () => Voice.say(`${NAMES[g.kind]} ist dran!`, {}), g);
    },
    accept(it, s) { return it.slot === s.kind; },
    place(it, s) { return { x: s.x, y: s.y, scale: 1 }; },
    onPlace(g, it, s) { g.wow = Game.time; },
    bg(c, g) {
      Draw.wallpaper(c, '#ffe3ee', '#ffeef5');
      Draw.floor(c, 690, '#d9a66b');
      // Spiegel
      Draw.rrPath(c, 840, 150, 150, 420, 60); Draw.fs(c, '#d8a24f', Draw.LW); Draw.rrPath(c, 858, 168, 114, 384, 50); Draw.fs(c, '#dff6ff', 3); Draw.shine(c, 890, 260, 10, 60, 0.6);
      Draw.animal(c, g.kind, CX, CY, R, { shirt: g.shirt, mood: Game.time - (g.wow || -9) < 0.8 ? 'open' : 'happy' });
    },
    drawSlot(c, s) { if (s.filled.length) return; c.save(); c.globalAlpha = 0.35 + Math.sin(Game.time * 4) * 0.12; c.setLineDash([10, 8]); c.lineWidth = 5; c.strokeStyle = '#fff'; c.beginPath(); c.arc(s.x, s.y, 46, 0, TAU); c.stroke(); c.restore(); },
    drawItem(c, it) { drawAcc(c, it); },
  });
})();

/* ===== src/games/drums.js ===== */
/* =====================================================================
   Spiel: Trommeln – der Held trommelt vor, das Kind spielt nach (Hören, Merken).
   ===================================================================== */
(() => {
  const DRUM_COLS = [PAL.red, PAL.yellow, PAL.blue, PAL.green];
  const NOTES = [60, 64, 67, 72];
  function drumSound(i) { Sound.tone({ f: NOTE(NOTES[i]), dur: 0.35, vol: 0.22, type: 'triangle' }); Sound.tone({ f: 120 - i * 10, f2: 60, dur: 0.14, vol: 0.3 }); Sound.hiss({ f: 2500, dur: 0.04, vol: 0.12 }); }
  function makeDrums() {
    const def = gameById('drums');
    return {
      specs: [], round: 0, state: 'show', drums: [], seq: [], pos: 0, rep: 0, homePressed: false, heroJoy: -9, heroBig: -9, stick: 0, showTimer: null,
      enter() {
        this.specs = Game.small ? [{ drums: 2, len: 1 }, { drums: 2, len: 2 }, { drums: 3, len: 2 }] : [{ drums: 3, len: 2 }, { drums: 3, len: 3 }, { drums: 4, len: 4 }];
        this.round = 0; Music.duck(true); this.startRound();
        after(0.4, () => Voice.say(def.intro, { force: true }), this);
      },
      exit() { Voice.stop(); Music.duck(false); },
      startRound() {
        const spec = this.specs[this.round], xs = spreadX(spec.drums, spec.drums === 2 ? 450 : 330, spec.drums === 2 ? 780 : 900);
        this.drums = xs.map((x, i) => ({ x, y: 560, color: DRUM_COLS[i], lit: -9, pop: 0 }));
        this.drums.forEach((d, i) => tween(d, { pop: 1 }, 0.4, { ease: 'outBack', delay: i * 0.1, owner: this }));
        this.rep = 0; after(1.2, () => this.newSequence(), this);
      },
      newSequence() {
        const spec = this.specs[this.round];
        this.seq = Array.from({ length: spec.len }, () => randi(0, spec.drums - 1));
        if (spec.len > 1 && this.seq.every((v) => v === this.seq[0])) this.seq[1] = (this.seq[0] + 1) % spec.drums;
        this.show();
      },
      show() {
        this.state = 'show'; this.pos = 0;
        Voice.say('Hör zu!', { force: true });
        this.seq.forEach((d, i) => after(0.9 + i * 0.75, () => { this.hit(d, true); }, this));
        after(0.9 + this.seq.length * 0.75 + 0.3, () => { this.state = 'repeat'; this.pos = 0; Voice.say('Jetzt du!', { force: true }); Game.lastInput = Game.time; }, this);
      },
      hit(i, byHero) {
        const d = this.drums[i]; d.lit = Game.time; drumSound(i);
        if (byHero) { this.stick = 1; tween(this, { stick: 0 }, 0.3, { owner: this }); }
        Particles.burst('ring', d.x, d.y - 30, 1, { color: '#fff', speed: 0, life: 0.5, size: 40 });
      },
      down(p) {
        if (inCircle(p, 62, 62, 44)) { this.homePressed = true; Sound.play('tap'); return; }
        if (this.state !== 'repeat') return;
        const i = this.drums.findIndex((d) => inRect(p, d.x, d.y - 20, 220, 200)); if (i < 0) return;
        this.hit(i, false);
        if (i === this.seq[this.pos]) {
          this.pos++; this.heroJoy = Game.time;
          if (this.pos >= this.seq.length) {
            this.state = 'between'; this.rep++;
            Sound.play('sparkle'); Voice.praise();
            if (this.rep >= 2) after(1.0, () => this.roundDone(), this); else after(1.2, () => this.newSequence(), this);
          }
        } else {
          this.state = 'oops'; Sound.play('boing'); Voice.say('Hmm, noch mal hören!', { force: true });
          after(1.3, () => this.show(), this);
        }
      },
      up(p) { if (this.homePressed) { this.homePressed = false; if (inCircle(p, 62, 62, 60)) goHub(); } },
      roundDone() {
        this.state = 'celebrate'; this.heroBig = Game.time; Sound.play('success');
        Particles.burst('confetti', DW / 2, DH * 0.45, 60, { colors: CONFETTI, speed: 420, g: 500, drag: 0.8, life: 2, size: 14, layer: 1 });
        const last = this.round >= this.specs.length - 1;
        Voice.say(last ? 'Du bist ein echter Trommler!' : 'Prima! Jetzt wird es ein bisschen länger.', { force: true });
        after(1.6, () => { if (last) this.finish(); else { this.round++; this.startRound(); } }, this);
      },
      finish() { this.state = 'done'; Sound.play('fanfare'); Particles.confettiRain(120); Store.data.done[Game.mode][def.id] = true; Store.data.plays++; Store.save(); after(2.6, () => goHub(), this); },
      hint() { if (this.state !== 'repeat') return null; const d = this.drums[this.seq[this.pos]]; return { x1: d.x, y1: d.y - 30, x2: d.x, y2: d.y - 30 }; },
      drawDrum(c, d) {
        const lit = Game.time - d.lit < 0.35, k = lit ? 1 + Math.sin((Game.time - d.lit) / 0.35 * Math.PI) * 0.08 : 1;
        c.save(); c.translate(d.x, d.y); c.scale(d.pop * k, d.pop * k);
        if (lit) { c.save(); c.globalAlpha = 0.5; Draw.ellipse(c, 0, -40, 120, 60); c.fillStyle = '#fff'; c.fill(); c.restore(); }
        Draw.rrPath(c, -90, -40, 180, 110, 14); Draw.fs(c, d.color, Draw.LW);
        c.save(); c.globalAlpha = 0.5; c.fillStyle = '#fff'; for (let i = -2; i <= 2; i++) { c.save(); c.translate(i * 36, 10); c.rotate(0.4); c.fillRect(-6, -40, 12, 80); c.restore(); } c.restore();
        Draw.ellipse(c, 0, 70, 90, 20); Draw.fs(c, shade(d.color, -0.3), Draw.LW);
        Draw.rrPath(c, -90, -40, 180, 110, 14); c.lineWidth = Draw.LW; c.strokeStyle = INK; c.stroke();
        Draw.ellipse(c, 0, -40, 92, 32); Draw.fs(c, lit ? '#fff' : '#fbf3e3', Draw.LW);
        Draw.ellipse(c, 0, -40, 70, 22); c.lineWidth = 2.5; c.strokeStyle = rgba(INK, 0.3); c.stroke();
        c.restore();
      },
      draw(c) {
        Draw.wallpaper(c, '#ffd6e7', '#ffe3ee');
        // Bühne
        Draw.rrPath(c, View.L - 10, 600, View.vw + 20, 200, 0); c.fillStyle = '#8a4bd3'; c.fill();
        c.lineWidth = 5; c.strokeStyle = INK; c.beginPath(); c.moveTo(View.L - 10, 600); c.lineTo(View.R + 10, 600); c.stroke();
        for (let xx = Math.floor(View.L / 90) * 90; xx < View.R + 90; xx += 90) { Draw.starPath(c, xx + 45, 690, 14, 6, 5); c.fillStyle = rgba('#ffffff', 0.25); c.fill(); }
        for (const d of this.drums) this.drawDrum(c, d);
        // Held mit Trommelstöcken
        const hx = 110, hy = 580;
        Draw.hero(c, currentHero(), hx, hy + Math.sin(Game.time * 2.5) * 3, 52, { mood: this.state === 'show' ? 'open' : 'happy' });
        c.save(); c.translate(hx + 60, hy + 70); c.rotate(-0.6 + this.stick * 0.9); Draw.rrPath(c, -5, -110, 10, 118, 5); Draw.fs(c, '#d8a24f', 3.5); c.beginPath(); c.arc(0, -112, 9, 0, TAU); Draw.fs(c, '#f1d4a3', 3); c.restore();
        if (this.state === 'show') { Draw.speech(c, 215, 400, 170, 100, 'left'); Draw.iconNote(c, 215, 400, 26); }
        if (this.state === 'repeat') { Draw.speech(c, 215, 400, 170, 100, 'left'); Draw.hand(c, 227, 392, 0.6); }
        hudHome(c); hudHero(c, this); hudRounds(c, this.round + (this.state === 'celebrate' || this.state === 'done' ? 1 : 0), this.specs.length);
      },
    };
  }
  registerGame({
    id: 'drums', name: 'Trommeln', make: makeDrums,
    intro: 'Ich trommle etwas vor, und du spielst es nach!',
    icon(c, x, y) { Draw.rrPath(c, x - 50, y - 80, 100, 70, 10); Draw.fs(c, PAL.red, 4); Draw.ellipse(c, x, y - 80, 52, 18); Draw.fs(c, '#fbf3e3', 4); c.save(); c.translate(x + 30, y - 100); c.rotate(0.5); Draw.rrPath(c, -3, -50, 6, 60, 3); Draw.fs(c, '#d8a24f', 3); c.restore(); c.save(); c.translate(x - 30, y - 100); c.rotate(-0.5); Draw.rrPath(c, -3, -50, 6, 60, 3); Draw.fs(c, '#d8a24f', 3); c.restore(); },
  });
})();

/* ===== src/games/feed.js ===== */
/* =====================================================================
   Spiel: Füttern – jedes Tier bekommt sein Lieblingsessen (BEDEUTUNG).
   ===================================================================== */
(() => {
  const PAIRS = [['dog', 'bone'], ['rabbit', 'carrot'], ['cat', 'fish'], ['bird', 'worm'], ['bear', 'honey'], ['pig', 'corn'], ['fox', 'cookie']];
  const FOOD_OF = Object.fromEntries(PAIRS);
  const SHIRTS = [PAL.red, PAL.blue, PAL.green, PAL.yellow, PAL.purple, PAL.orange, PAL.pink, '#2bb5a0'];
  registerGame({
    id: 'feed', name: 'Füttern',
    intro: 'Alle haben Hunger! Gib jedem Tier sein Lieblingsessen.',
    icon(c, x, y) { Draw.animal(c, 'dog', x - 22, y - 62, 34, { shirt: PAL.blue, headOnly: true, blink: 0 }); Draw.food(c, 'bone', x + 34, y - 34, 0.6); },
    rounds(mode) { return mode === 'small' ? [{ n: 2 }, { n: 3 }, { n: 3 }] : [{ n: 4 }, { n: 4 }, { n: 5 }]; },
    setup(g, spec) {
      const pairs = sample(PAIRS, spec.n), xs = spreadX(spec.n, 512 - (spec.n - 1) * 118, 512 + (spec.n - 1) * 118);
      g.slots = pairs.map(([kind], i) => ({ x: xs[i], y: 560, r: 95, kind, cap: 1, filled: [], shirt: SHIRTS[(i * 3) % SHIRTS.length], mouth: -9, no: 0 }));
      const pts = scatter(spec.n, 160, 860, 150, 380, 150);
      g.items = pairs.map(([, food], i) => ({ x: pts[i].x, y: pts[i].y, r: 58, kind: food }));
      shuffle(g.items);
    },
    accept(it, s) { return FOOD_OF[s.kind] === it.kind; },
    place(it, s) { return { x: s.x, y: s.y + 30, scale: 0.8 }; },
    onPlace(g, it, s) {
      s.mouth = Game.time; Sound.play('chomp');
      Particles.burst('heart', s.x, s.y - 70, 6, { colors: ['#ff5d8f', '#ff8fab'], speed: 110, life: 1.2, size: 14, g: -70 });
      tween(it, { scale: 0 }, 0.25, { delay: 0.4, owner: g });
    },
    wrong(g, it, s) { s.no = 1; tween(s, { no: 0 }, 0.5, { owner: g }); },
    bg(c) {
      Draw.sky(c); Draw.sun(c, View.R - 130, 190, 46); Draw.cloud(c, 260 + Math.sin(Game.time * 0.2) * 25, 110, 34); Draw.cloud(c, 700, 90, 28);
      // Zaun
      c.lineWidth = 4; c.strokeStyle = INK;
      for (let x = Math.floor(View.L / 64) * 64; x < View.R + 64; x += 64) { Draw.rrPath(c, x, 400, 30, 90, 12); Draw.fs(c, '#d9a66b', 4); }
      for (const y of [430, 465]) { Draw.rrPath(c, View.L - 10, y, View.vw + 20, 14, 0); Draw.fs(c, '#e2b07a', 3); }
      Draw.grass(c, 480, '#8ad65c');
    },
    drawSlot(c, s) {
      const open = Game.time - s.mouth < 0.7, hov = false;
      Draw.animal(c, s.kind, s.x, s.y, 52, { shirt: s.shirt, mood: open ? 'open' : (s.hovered ? 'wow' : 'happy'), rot: Math.sin(Game.time * 30) * 0.12 * s.no });
      if (s.hovered) s.hovered = false;
    },
    update(g) { if (g.hover && g.drag) g.hover.hovered = true; },
    drawItem(c, it) { Draw.food(c, it.kind, 0, 0, it.placed ? 0.9 : 1.3); },
  });
})();

/* ===== src/games/gifts.js ===== */
/* =====================================================================
   Spiel: Geschenke – Päckchen nach MUSTER in die Kiste mit demselben Muster.
   Die Farbe hilft absichtlich nicht: Nur das Muster zählt.
   ===================================================================== */
(() => {
  const PATS = ['dots', 'stripes', 'stars', 'zigzag', 'hearts', 'checks'];
  const COLS = [PAL.red, PAL.blue, PAL.green, PAL.purple, PAL.orange, PAL.pink, '#2bb5a0'];
  registerGame({
    id: 'gifts', name: 'Geschenke',
    intro: 'Pack die Geschenke ein! Jedes Geschenk kommt in die Kiste mit demselben Muster.',
    icon(c, x, y) { Draw.gift(c, x, y - 52, 96, 88, PAL.red, 'dots', { ribbon: PAL.yellow }); },
    rounds(mode) { return mode === 'small' ? [{ pats: 2, per: 2 }, { pats: 2, per: 2 }, { pats: 3, per: 2 }] : [{ pats: 3, per: 2 }, { pats: 4, per: 2 }, { pats: 4, per: 3 }]; },
    setup(g, spec) {
      const pats = sample(PATS, spec.pats), cols = sample(COLS, spec.pats), xs = spreadX(spec.pats, 512 - (spec.pats - 1) * 118, 512 + (spec.pats - 1) * 118);
      g.slots = pats.map((p, i) => ({ x: xs[i], y: 585, r: 115, pat: p, color: cols[i], cap: spec.per, filled: [] }));
      const pts = scatter(spec.pats * spec.per, 170, 850, 160, 390, 160);
      g.items = []; let k = 0;
      for (let i = 0; i < pats.length; i++) for (let j = 0; j < spec.per; j++) { const p = pts[k++]; g.items.push({ x: p.x, y: p.y, r: 62, pat: pats[i], color: pick(COLS.filter((cc) => cc !== cols[i])), ribbon: pick([PAL.yellow, '#fff', PAL.pink]) }); }
      shuffle(g.items);
    },
    accept(it, s) { return it.pat === s.pat; },
    place(it, s, g, preview) { const idx = preview ? s.filled.length : s.filled.indexOf(it); return { x: s.x + (idx - (s.cap - 1) / 2) * 34, y: s.y - 18 - idx * 4, scale: 0.72, rot: (idx - (s.cap - 1) / 2) * 0.12 }; },
    bg(c) {
      Draw.wallpaper(c, '#e9dcff', '#f3ecff');
      Draw.floor(c, 660, '#d9a66b');
      Draw.rrPath(c, 512 - 440, 640, 880, 110, 40); c.fillStyle = '#ff8fab'; c.fill(); c.lineWidth = 4; c.strokeStyle = INK; c.stroke();
      c.fillStyle = '#ffb3c6'; Draw.rrPath(c, 512 - 400, 660, 800, 70, 30); c.fill();
    },
    drawSlot(c, s) { Draw.box(c, s.x, s.y, 190, 120, s.color, s.pat, '#fff'); },
    drawItem(c, it) { Draw.gift(c, 0, 0, 100, 90, it.color, it.pat, { ribbon: it.ribbon }); },
  });
})();

/* ===== src/games/hide.js ===== */
/* =====================================================================
   Spiel: Verstecken – die Helden verstecken sich hinter Büschen; einer guckt kurz
   heraus, das Kind tippt den richtigen Busch an (Aufmerksamkeit, Merken).
   ===================================================================== */
(() => {
  function makeHide() {
    const def = gameById('hide');
    return {
      specs: [], round: 0, state: 'intro', bushes: [], want: null, homePressed: false, heroJoy: -9, heroBig: -9, peekTimer: null,
      enter() {
        this.specs = Game.small ? [{ n: 2 }, { n: 3 }, { n: 3 }] : [{ n: 4 }, { n: 5 }, { n: 5 }];
        this.round = 0; Music.duck(false); this.startRound();
        after(0.4, () => Voice.say(def.intro, { force: true }), this);
      },
      exit() { Voice.stop(); },
      startRound() {
        const spec = this.specs[this.round], hs = sample(otherHeroes(), spec.n), xs = spreadX(spec.n, 512 - (spec.n - 1) * 95, 512 + (spec.n - 1) * 95);
        this.bushes = hs.map((h, i) => ({ h, x: xs[i], y: 560, peek: 0, found: false, jump: 0, wob: 0, pop: 0, tint: pick(['#5fcf2a', '#4db83a', '#7fd24a']) }));
        this.bushes.forEach((b, i) => tween(b, { pop: 1 }, 0.4, { ease: 'outBack', delay: i * 0.1, owner: this }));
        this.state = 'wait'; after(1.6, () => this.next(), this);
      },
      next() {
        const left = this.bushes.filter((b) => !b.found);
        if (!left.length) return this.roundDone();
        this.want = pick(left); this.state = 'peek';
        Voice.say(`Wo ist ${this.want.h.name}?`, { force: true });
        after(0.8, () => this.peek(this.want, true), this);
      },
      peek(b, isWanted) {
        Sound.play('giggle');
        tween(b, { peek: 1 }, 0.35, { ease: 'outBack', owner: this, done: () => tween(b, { peek: 0 }, 0.3, { ease: 'inBack', delay: 0.9, owner: this, done: () => { if (isWanted && this.state === 'peek') { this.state = 'ask'; Game.lastInput = Game.time; this.schedulePeek(); } } }) });
      },
      schedulePeek() { Timers.cancel(this.peekTimer); this.peekTimer = after(Game.small ? 3 : 6, () => { if (this.state === 'ask') { this.peek(this.want, false); this.schedulePeek(); } }, this); },
      down(p) {
        if (inCircle(p, 62, 62, 44)) { this.homePressed = true; Sound.play('tap'); return; }
        if (this.state !== 'ask') return;
        const b = this.bushes.find((bb) => !bb.found && inRect(p, bb.x, bb.y - 40, 190, 240)); if (!b) return;
        Timers.cancel(this.peekTimer);
        if (b === this.want) {
          this.state = 'found'; b.found = true; this.heroJoy = Game.time;
          Tweens.kill(b); b.peek = 1; tween(b, { jump: 1 }, 0.5, { ease: 'outBack', owner: this });
          Sound.play('yay'); Particles.burst('star', b.x, b.y - 150, 12, { colors: [PAL.yellow, '#fff'], speed: 240, life: 0.9, size: 12, g: 200 });
          Voice.say(pick(['Gefunden!', 'Da ist er ja!', 'Juhu, gefunden!']), { force: true });
          after(1.3, () => this.next(), this);
        } else {
          this.state = 'wrong'; Sound.play('boing'); b.wob = 1; tween(b, { wob: 0 }, 0.5, { owner: this });
          Voice.say(`Hier ist ${b.h.name}!`, { force: true });
          this.peek(b, false);
          after(1.6, () => { this.state = 'ask'; this.schedulePeek(); Voice.say(`Wo ist ${this.want.h.name}?`, { force: true }); }, this);
        }
      },
      up(p) { if (this.homePressed) { this.homePressed = false; if (inCircle(p, 62, 62, 60)) goHub(); } },
      roundDone() {
        this.state = 'celebrate'; this.heroBig = Game.time; Sound.play('success');
        Particles.burst('confetti', DW / 2, DH * 0.45, 60, { colors: CONFETTI, speed: 420, g: 500, drag: 0.8, life: 2, size: 14, layer: 1 });
        const last = this.round >= this.specs.length - 1;
        Voice.say(last ? 'Alle gefunden! Du bist ein Spürnase!' : 'Super! Sie verstecken sich noch einmal!', { force: true });
        after(1.8, () => { if (last) this.finish(); else { this.round++; this.startRound(); } }, this);
      },
      finish() { this.state = 'done'; Sound.play('fanfare'); Particles.confettiRain(120); Store.data.done[Game.mode][def.id] = true; Store.data.plays++; Store.save(); after(2.6, () => goHub(), this); },
      hint() { if (this.state !== 'ask' || !this.want) return null; return { x1: this.want.x, y1: this.want.y - 40, x2: this.want.x, y2: this.want.y - 40 }; },
      drawBush(c, b) {
        c.save(); c.translate(b.x + Math.sin(Game.time * 40) * 6 * b.wob, b.y); c.scale(b.pop, b.pop);
        const col = b.tint;
        c.beginPath(); c.arc(-60, 10, 52, 0, TAU); c.arc(0, -30, 62, 0, TAU); c.arc(62, 8, 54, 0, TAU); c.arc(0, 30, 58, 0, TAU);
        c.fillStyle = col; c.fill(); c.lineWidth = Draw.LW; c.strokeStyle = INK;
        c.beginPath(); c.arc(-60, 10, 52, 0, TAU); c.stroke(); c.beginPath(); c.arc(0, -30, 62, 0, TAU); c.stroke(); c.beginPath(); c.arc(62, 8, 54, 0, TAU); c.stroke(); c.beginPath(); c.arc(0, 30, 58, 0, TAU); c.stroke();
        c.beginPath(); c.arc(-60, 10, 52, 0, TAU); c.arc(0, -30, 62, 0, TAU); c.arc(62, 8, 54, 0, TAU); c.arc(0, 30, 58, 0, TAU); c.fillStyle = col; c.fill();
        for (const [dx, dy] of [[-40, -10], [20, -40], [50, 20], [-10, 40]]) { c.beginPath(); c.arc(dx, dy, 7, 0, TAU); Draw.fs(c, PAL.red, 2.5); }
        c.restore();
      },
      draw(c) {
        Draw.sky(c); Draw.sun(c, View.R - 130, 190, 44); Draw.cloud(c, 240 + Math.sin(Game.time * 0.2) * 25, 130, 34); Draw.cloud(c, 720, 110, 28);
        Draw.grass(c, 470, '#8ad65c');
        // Verstecke Helden (hinter dem Busch): Kopf lugt heraus
        for (const b of this.bushes) {
          const up = b.found ? 150 + b.jump * 30 : b.peek * 95;
          if (up > 1) Draw.hero(c, b.h, b.x, b.y - 30 - up, 40, { headOnly: !b.found, mood: b.found ? 'open' : 'wow', blink: 0 });
        }
        for (const b of this.bushes) this.drawBush(c, b);
        const hx = 120, hy = 600;
        Draw.hero(c, currentHero(), hx, hy + Math.sin(Game.time * 2.5) * 3, 46, { mood: this.state === 'ask' ? 'wow' : 'happy' });
        if ((this.state === 'ask' || this.state === 'peek') && this.want) { Draw.speech(c, 215, 430, 160, 130, 'left'); Draw.hero(c, this.want.h, 215, 440, 30, { headOnly: true, blink: 0 }); Draw.label(c, '?', 262, 400, 40, INK, null, 700); }
        hudHome(c); hudHero(c, this); hudRounds(c, this.round + (this.state === 'celebrate' || this.state === 'done' ? 1 : 0), this.specs.length);
      },
    };
  }
  registerGame({
    id: 'hide', name: 'Verstecken', make: makeHide,
    intro: 'Meine Freunde haben sich versteckt! Schau gut hin, wer herausguckt.',
    icon(c, x, y) { Draw.animal(c, 'rabbit', x + 6, y - 100, 20, { headOnly: true, blink: 0, mood: 'wow' }); c.beginPath(); c.arc(x - 34, y - 30, 30, 0, TAU); c.arc(x, y - 52, 36, 0, TAU); c.arc(x + 36, y - 30, 32, 0, TAU); c.arc(x, y - 22, 34, 0, TAU); Draw.fs(c, '#5fcf2a', 4); c.beginPath(); c.arc(x - 34, y - 30, 30, 0, TAU); c.arc(x, y - 52, 36, 0, TAU); c.arc(x + 36, y - 30, 32, 0, TAU); c.arc(x, y - 22, 34, 0, TAU); c.fillStyle = '#5fcf2a'; c.fill(); },
  });
})();

/* ===== src/games/picnic.js ===== */
/* =====================================================================
   Spiel: Picknick – Merken und wiederfinden (Gedächtnis).
   Essen liegt auf Tellern, wird mit Deckeln verdeckt; der Bär fragt
   nach einem Teil, das Kind tippt auf den richtigen Deckel.
   ===================================================================== */
(() => {
  const FOODS = [
    { kind: 'apple', ask: 'Wo ist der Apfel?' }, { kind: 'banana', ask: 'Wo ist die Banane?' }, { kind: 'cookie', ask: 'Wo ist der Keks?' },
    { kind: 'cheese', ask: 'Wo ist der Käse?' }, { kind: 'strawberry', ask: 'Wo ist die Erdbeere?' }, { kind: 'carrot', ask: 'Wo ist die Karotte?' },
    { kind: 'donut', ask: 'Wo ist der Donut?' }, { kind: 'cupcake', ask: 'Wo ist der Muffin?' },
  ];
  function makePicnic() {
    const def = gameById('picnic');
    return {
      specs: [], round: 0, state: 'show', bowls: [], want: null, homePressed: false, eat: null, bearMouth: 0,
      enter() {
        this.specs = Game.small ? [{ n: 2, show: 3 }, { n: 2, show: 3 }, { n: 3, show: 3 }] : [{ n: 3, show: 2.6 }, { n: 4, show: 2.2 }, { n: 4, show: 2 }];
        this.round = 0; Music.duck(false); this.startRound();
        after(0.4, () => Voice.say(def.intro, { force: true }), this);
      },
      exit() { Voice.stop(); },
      startRound() {
        const spec = this.specs[this.round], foods = sample(FOODS, spec.n), xs = spreadX(spec.n, 330, 800);
        this.bowls = foods.map((f, i) => ({ x: xs[i], y: 540, food: f, lid: -300, found: false, open: true, eaten: false, pop: 0 }));
        this.bowls.forEach((b, i) => tween(b, { pop: 1 }, 0.4, { ease: 'outBack', delay: i * 0.1, owner: this }));
        this.state = 'show'; this.want = null;
        after(spec.show + 0.4, () => this.cover(), this);
      },
      cover() {
        this.state = 'hide';
        this.bowls.forEach((b, i) => tween(b, { lid: 0 }, 0.55, { ease: 'outBounce', delay: i * 0.15, owner: this, done: () => { b.open = false; Sound.play('lid'); } }));
        after(0.6 + this.bowls.length * 0.15 + 0.5, () => this.ask(), this);
      },
      ask() {
        const left = this.bowls.filter((b) => !b.found);
        if (!left.length) return this.roundDone();
        this.want = pick(left); this.state = 'ask'; Voice.say(this.want.food.ask, { force: true }); Game.lastInput = Game.time; Sound.play('bell');
      },
      down(p) {
        if (inCircle(p, 62, 62, 44)) { this.homePressed = true; Sound.play('tap'); return; }
        if (this.state !== 'ask') return;
        const b = this.bowls.find((bb) => !bb.found && inRect(p, bb.x, bb.y - 60, 180, 220));
        if (!b) return;
        if (b === this.want) this.correct(b); else this.wrongTap(b);
      },
      up(p) { if (this.homePressed) { this.homePressed = false; if (inCircle(p, 62, 62, 60)) goHub(); } },
      correct(b) {
        this.state = 'reveal'; b.found = true; b.open = true;
        this.heroJoy = Game.time; tween(b, { lid: -140 }, 0.3, { ease: 'outBack', owner: this, done: () => tween(b, { lid: -700 }, 0.5, { ease: 'inCubic', owner: this }) }); Sound.play('pop');
        Particles.burst('spark', b.x, b.y - 40, 12, { colors: ['#fff', PAL.yellow], speed: 180, life: 0.5 });
        const fly = { x: b.x, y: b.y - 30, s: 1.1, kind: b.food.kind }; this.eat = fly; b.eaten = true;
        tween(fly, { x: 165, y: 500, s: 0.7 }, 0.65, { ease: 'inOutQuad', delay: 0.25, owner: this, done: () => { this.eat = null; Sound.play('chomp'); this.bearMouth = 0.7; Voice.praise(); after(1.0, () => this.ask(), this); } });
      },
      wrongTap(b) {
        this.state = 'peek'; Sound.play('boing'); b.open = true;
        tween(b, { lid: -120 }, 0.25, { owner: this });
        after(0.9, () => { tween(b, { lid: 0 }, 0.35, { ease: 'outBounce', owner: this, done: () => { b.open = false; } }); after(0.45, () => { this.state = 'ask'; Voice.say(this.want.food.ask, { force: true }); }, this); }, this);
      },
      roundDone() {
        this.state = 'celebrate'; Sound.play('success'); this.heroBig = Game.time;
        Particles.burst('confetti', DW / 2, DH * 0.45, 70, { colors: CONFETTI, speed: 420, g: 500, drag: 0.8, life: 2.2, size: 14, layer: 1 });
        const last = this.round >= this.specs.length - 1;
        Voice.say(last ? 'Geschafft! Du hast alles gefunden!' : 'Prima! Und noch einmal!', { force: true });
        after(1.6, () => { if (last) this.finish(); else { this.round++; this.startRound(); } }, this);
      },
      finish() {
        this.state = 'done'; Sound.play('fanfare'); Particles.confettiRain(120);
        Store.data.done[Game.mode][def.id] = true; Store.data.plays++; Store.save();
        after(2.6, () => goHub(), this);
      },
      hint() { if (this.state !== 'ask' || !this.want) return null; return { x1: this.want.x, y1: this.want.y - 70, x2: this.want.x, y2: this.want.y - 70 }; },
      update(dt) { if (this.bearMouth > 0) this.bearMouth -= dt; },
      draw(c) {
        Draw.sky(c); Draw.sun(c, View.R - 130, 190, 46); Draw.cloud(c, 300 + Math.sin(Game.time * 0.2) * 25, 120, 34); Draw.cloud(c, 760, 90, 28);
        Draw.grass(c, 400, '#8ad65c');
        Draw.blanket(c, 565, 580, 620, 230, '#ff6b6b', '#fff');
        Draw.animal(c, 'bear', 165, 540, 54, { shirt: PAL.red, hat: PAL.purple, mood: this.bearMouth > 0 ? 'open' : (this.state === 'ask' ? 'wow' : 'happy') });
        if (this.state === 'ask' && this.want) { const by = 345 + Math.sin(Game.time * 3) * 5; Draw.speech(c, 215, by, 190, 140, 'left'); Draw.food(c, this.want.food.kind, 215, by, 1.05); }
        for (const b of this.bowls) { c.save(); c.translate(b.x, b.y); c.scale(b.pop, b.pop); Draw.plate(c, 0, 0, 72); if (!b.eaten) Draw.food(c, b.food.kind, 0, -30, 1.15); c.restore(); }
        for (const b of this.bowls) { if (b.pop < 0.5) continue; const ly = b.y - 22 + b.lid; Draw.lid(c, b.x, ly, 74, b.found ? '#bfe3bf' : '#9fb7c9'); }
        if (this.eat) Draw.food(c, this.eat.kind, this.eat.x, this.eat.y, this.eat.s);
        hudHome(c); hudHero(c, this); hudRounds(c, this.round + (this.state === 'celebrate' || this.state === 'done' ? 1 : 0), this.specs.length);
      },
    };
  }
  registerGame({
    id: 'picnic', name: 'Picknick', make: makePicnic,
    intro: 'Schau genau hin, was auf den Tellern liegt. Gleich verstecke ich es!',
    icon(c, x, y) { Draw.rrPath(c, x - 58, y - 70, 116, 70, 14); Draw.fs(c, '#c98a4b', 4); c.lineWidth = 4; c.strokeStyle = INK; c.beginPath(); c.arc(x, y - 70, 40, Math.PI, 0); c.stroke(); c.lineWidth = 2.5; c.strokeStyle = rgba(INK, 0.3); for (let i = -40; i <= 40; i += 20) { c.beginPath(); c.moveTo(x + i, y - 66); c.lineTo(x + i, y - 4); c.stroke(); } Draw.food(c, 'apple', x - 26, y - 82, 0.65); Draw.food(c, 'banana', x + 24, y - 86, 0.6); },
  });
})();

/* ===== src/games/pinata.js ===== */
/* =====================================================================
   Spiel: Piñata – auf die Piñata tippen, bis sie platzt, dann die Süßigkeiten
   einsammeln (und dabei zählen).
   ===================================================================== */
(() => {
  const NUM = ['eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben'];
  const SHAPES = [{ kind: 'star', color: PAL.yellow }, { kind: 'heart', color: PAL.pink }, { kind: 'circle', color: PAL.blue }];
  const CANDY = ['lollipop', 'donut', 'cookie', 'cupcake', 'apple', 'cherry'];
  const BANDS = [PAL.red, PAL.orange, PAL.yellow, PAL.green, PAL.blue, PAL.purple];
  function makePinata() {
    const def = gameById('pinata');
    return {
      specs: [], round: 0, state: 'hit', hits: 0, need: 0, swing: 0, crack: 0, candies: [], got: 0, homePressed: false, heroJoy: -9, heroBig: -9, bat: 0, shape: SHAPES[0], px: 560, py: 330,
      enter() {
        this.specs = Game.small ? [{ hits: 4, candies: 3 }, { hits: 5, candies: 3 }, { hits: 6, candies: 4 }] : [{ hits: 6, candies: 4 }, { hits: 8, candies: 5 }, { hits: 10, candies: 6 }];
        this.round = 0; Music.duck(false); this.startRound();
        after(0.4, () => Voice.say(def.intro, { force: true }), this);
      },
      exit() { Voice.stop(); },
      startRound() {
        const spec = this.specs[this.round];
        this.shape = SHAPES[this.round % SHAPES.length]; this.need = spec.hits; this.hits = 0; this.crack = 0; this.candies = []; this.got = 0; this.state = 'hit'; this.swing = 0; this.scale = 0;
        tween(this, { scale: 1 }, 0.5, { ease: 'outBack', owner: this });
        if (this.round > 0) after(0.6, () => Voice.say('Noch eine Piñata! Hau drauf!', { force: true }), this);
        Game.lastInput = Game.time;
      },
      down(p) {
        if (inCircle(p, 62, 62, 44)) { this.homePressed = true; Sound.play('tap'); return; }
        if (this.state === 'hit') {
          if (!inCircle(p, this.px, this.py, 150)) return;
          this.hits++; this.crack = this.hits / this.need; this.heroJoy = Game.time;
          Sound.play('thud'); Sound.play('crunch');
          this.bat = 1; tween(this, { bat: 0 }, 0.35, { ease: 'outCubic', owner: this });
          this.swing = (Math.random() < 0.5 ? -1 : 1) * 0.6; tween(this, { swing: 0 }, 0.9, { ease: 'outElastic', owner: this });
          Particles.burst('star', p.x, p.y, 6, { colors: [PAL.yellow, '#fff'], speed: 200, life: 0.6, size: 10, g: 300 });
          if (this.hits >= this.need) this.burst(); else if (this.hits === Math.ceil(this.need / 2)) Voice.say('Weiter so! Fester!', {});
          return;
        }
        if (this.state === 'collect') {
          const cd = this.candies.filter((k) => !k.got && inCircle(p, k.x, k.y, 52)).sort((a, b) => dist(p.x, p.y, a.x, a.y) - dist(p.x, p.y, b.x, b.y))[0];
          if (!cd) return;
          cd.got = true; cd.vx = 0; cd.vy = 0; cd.g = 0; this.got++; this.heroJoy = Game.time;
          Sound.play('pop', { pitch: 1 + this.got * 0.1 });
          tween(cd, { x: 150, y: 560, s: 0.3 }, 0.5, { ease: 'inOutQuad', owner: this, done: () => { cd.gone = true; } });
          Voice.say(NUM[Math.min(this.got - 1, NUM.length - 1)] + '!', { force: true });
          if (this.got >= this.candies.length) after(0.8, () => this.roundDone(), this);
        }
      },
      up(p) { if (this.homePressed) { this.homePressed = false; if (inCircle(p, 62, 62, 60)) goHub(); } },
      burst() {
        this.state = 'burst'; this.heroBig = Game.time; Sound.play('drum'); Sound.play('success');
        Particles.burst('confetti', this.px, this.py, 60, { colors: CONFETTI, speed: 500, g: 600, drag: 0.6, life: 2, size: 14, layer: 1 });
        Particles.burst('puff', this.px, this.py, 12, { color: '#fff', speed: 300, life: 0.6, size: 30 });
        const n = this.specs[this.round].candies;
        for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.45 + rand(-0.1, 0.1); this.candies.push({ x: this.px, y: this.py, vx: Math.cos(a) * rand(260, 380), vy: Math.sin(a) * rand(380, 520), g: 900, s: 0.95, kind: CANDY[i % CANDY.length], got: false, gone: false, rot: rand(-0.3, 0.3) }); }
        after(1.3, () => { this.state = 'collect'; Voice.say('Sammle alle Süßigkeiten ein!', { force: true }); Game.lastInput = Game.time; }, this);
      },
      roundDone() {
        this.state = 'celebrate'; this.heroBig = Game.time; Sound.play('success');
        Particles.burst('confetti', DW / 2, DH * 0.45, 50, { colors: CONFETTI, speed: 420, g: 500, drag: 0.8, life: 2, size: 14, layer: 1 });
        const last = this.round >= this.specs.length - 1;
        Voice.say(last ? 'Alle Süßigkeiten eingesammelt! Super!' : 'Prima! Da hängt schon die nächste!', { force: true });
        after(1.6, () => { if (last) this.finish(); else { this.round++; this.startRound(); } }, this);
      },
      finish() { this.state = 'done'; Sound.play('fanfare'); Particles.confettiRain(120); Store.data.done[Game.mode][def.id] = true; Store.data.plays++; Store.save(); after(2.6, () => goHub(), this); },
      hint() {
        if (this.state === 'hit') return { x1: this.px, y1: this.py, x2: this.px, y2: this.py };
        if (this.state === 'collect') { const cd = this.candies.find((k) => !k.got); return cd ? { x1: cd.x, y1: cd.y, x2: cd.x, y2: cd.y } : null; }
        return null;
      },
      update(dt) {
        for (const k of this.candies) {
          if (k.got) continue;
          k.vy += k.g * dt; k.x += k.vx * dt; k.y += k.vy * dt;
          if (k.y > 640) { k.y = 640; k.vy *= -0.35; k.vx *= 0.7; if (Math.abs(k.vy) < 30) k.vy = 0; }
          if (k.x < 230) { k.x = 230; k.vx = Math.abs(k.vx); } if (k.x > 900) { k.x = 900; k.vx = -Math.abs(k.vx); }
        }
      },
      drawPinata(c) {
        const S = 110, sw = this.swing + Math.sin(Game.time * 1.2) * 0.04;
        c.save(); c.translate(this.px, View.T); c.rotate(sw);
        const len = this.py - View.T;
        c.lineWidth = 4; c.strokeStyle = INK; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, len - S * 1.1); c.stroke();
        c.translate(0, len); c.scale(this.scale, this.scale);
        Draw.shapePath(c, this.shape.kind, 0, 0, S); c.fillStyle = this.shape.color; c.fill();
        c.save(); Draw.shapePath(c, this.shape.kind, 0, 0, S); c.clip(); for (let i = 0; i < 6; i++) { c.fillStyle = BANDS[i]; c.fillRect(-S * 1.3, -S * 1.3 + i * S * 0.45, S * 2.6, S * 0.45); } c.restore();
        Draw.shapePath(c, this.shape.kind, 0, 0, S); c.lineWidth = Draw.LW; c.strokeStyle = INK; c.stroke();
        // Gesicht und Risse
        for (const s of [-1, 1]) { c.beginPath(); c.arc(s * S * 0.3, -S * 0.05, S * 0.12, 0, TAU); Draw.fs(c, '#fff', 3); c.beginPath(); c.arc(s * S * 0.3 + 3, -S * 0.03, S * 0.06, 0, TAU); Draw.fs(c, INK, 0); }
        c.lineWidth = 3.5; c.strokeStyle = INK; c.beginPath(); c.arc(0, S * 0.2, S * 0.2, 0.3, Math.PI - 0.3); c.stroke();
        if (this.crack > 0) { c.lineWidth = 3; c.strokeStyle = INK; const n = Math.ceil(this.crack * 4); for (let i = 0; i < n; i++) { const a = i * 1.7 + 0.4; c.beginPath(); c.moveTo(Math.cos(a) * S * 0.3, Math.sin(a) * S * 0.3); c.lineTo(Math.cos(a + 0.3) * S * 0.6, Math.sin(a + 0.3) * S * 0.6); c.lineTo(Math.cos(a + 0.15) * S * 0.85, Math.sin(a + 0.15) * S * 0.85); c.stroke(); } }
        c.restore();
      },
      draw(c) {
        Draw.wallpaper(c, '#ffe6a7', '#fff0c2');
        Draw.floor(c, 660, '#e2b07a');
        if (this.state !== 'burst' && this.state !== 'collect' && this.state !== 'celebrate' && this.state !== 'done') this.drawPinata(c);
        else if (this.state === 'burst') { /* geplatzt */ }
        // Held mit Stock
        const hx = 150, hy = 600;
        c.save(); c.translate(hx + 40, hy - 10); c.rotate(-1.1 + this.bat * 1.4); Draw.rrPath(c, -8, -150, 16, 160, 8); Draw.fs(c, '#d8a24f', 4); c.restore();
        Draw.hero(c, currentHero(), hx, hy + Math.sin(Game.time * 2.5) * 3, 50, { mood: this.state === 'collect' ? 'open' : 'happy' });
        if (this.state === 'collect' || this.state === 'celebrate') { Draw.rrPath(c, hx - 50, hy + 90, 100, 60, 14); Draw.fs(c, PAL.red, 4); c.lineWidth = 4; c.strokeStyle = INK; c.beginPath(); c.arc(hx, hy + 90, 40, Math.PI, 0); c.stroke(); }
        for (const k of this.candies) { if (k.gone) continue; c.save(); c.translate(k.x, k.y); c.rotate(k.rot); Draw.food(c, k.kind, 0, 0, k.s); c.restore(); }
        hudHome(c); hudHero(c, this); hudRounds(c, this.round + (this.state === 'celebrate' || this.state === 'done' ? 1 : 0), this.specs.length);
      },
    };
  }
  registerGame({
    id: 'pinata', name: 'Piñata', make: makePinata,
    intro: 'Eine Piñata! Tipp fest drauf, bis sie platzt!',
    icon(c, x, y) { c.lineWidth = 4; c.strokeStyle = INK; c.beginPath(); c.moveTo(x, y - 130); c.lineTo(x, y - 100); c.stroke(); Draw.shapePath(c, 'star', x, y - 52, 48); c.fillStyle = PAL.yellow; c.fill(); c.save(); Draw.shapePath(c, 'star', x, y - 52, 48); c.clip(); for (let i = 0; i < 5; i++) { c.fillStyle = BANDS[i]; c.fillRect(x - 60, y - 112 + i * 24, 120, 24); } c.restore(); Draw.shapePath(c, 'star', x, y - 52, 48); c.lineWidth = 4; c.strokeStyle = INK; c.stroke(); },
  });
})();

/* ===== src/games/pots.js ===== */
/* =====================================================================
   Spiel: Kochen – Gemüsebündel nach MENGE (1, 2, 3) in den Topf mit
   genauso vielen Punkten ziehen.
   ===================================================================== */
(() => {
  const POT_W = 170, POT_COLORS = [PAL.blue, PAL.red, PAL.green];
  const KINDS = ['carrot', 'corn', 'apple', 'cherry'];
  function bundle(c, kind, n, scale) { for (let i = 0; i < n; i++) Draw.food(c, kind, (i - (n - 1) / 2) * 46 * scale / 0.75, 0, scale); }
  registerGame({
    id: 'pots', name: 'Kochen',
    intro: 'Zähl mit! Zieh das Gemüse in den Topf mit genauso vielen Punkten.',
    icon(c, x, y) { Draw.pot(c, x, y - 50, PAL.blue, 110, { dots: 2 }); Draw.food(c, 'carrot', x - 16, y - 112, 0.55); Draw.food(c, 'carrot', x + 18, y - 116, 0.55); },
    rounds(mode) {
      return mode === 'small'
        ? [{ counts: [1, 2], per: 1, mixed: false }, { counts: [1, 2], per: 2, mixed: false }, { counts: [1, 2, 3], per: 1, mixed: false }]
        : [{ counts: [1, 2, 3], per: 1, mixed: false }, { counts: [1, 2, 3], per: 2, mixed: false }, { counts: [1, 2, 3], per: 2, mixed: true }];
    },
    setup(g, spec) {
      const xs = spreadX(spec.counts.length, 512 - (spec.counts.length - 1) * 130, 512 + (spec.counts.length - 1) * 130);
      g.slots = spec.counts.map((n, i) => ({ x: xs[i], y: 560, r: 110, n, cap: spec.per, filled: [], color: POT_COLORS[i], wob: 0 }));
      const total = spec.counts.length * spec.per, pts = scatter(total, 190, 840, 160, 390, 190), kind = pick(KINDS);
      g.items = []; let k = 0;
      for (const n of spec.counts) for (let j = 0; j < spec.per; j++) { const p = pts[k++]; g.items.push({ x: p.x, y: p.y, r: 52 + 22 * n, n, kind: spec.mixed ? pick(KINDS) : kind }); }
      shuffle(g.items);
    },
    accept(it, s) { return it.n === s.n; },
    place(it, s, g, preview) { const idx = preview ? s.filled.length : s.filled.indexOf(it); return { x: s.x + (idx - (s.cap - 1) / 2) * 22, y: s.y - 62 - idx * 6, scale: 0.78 }; },
    onPlace(g, it, s) { Sound.play('count', { n: s.n }); s.wob = 1; tween(s, { wob: 0 }, 0.5, { owner: g }); Particles.burst('puff', s.x, s.y - 60, 6, { color: '#fff', speed: 60, life: 0.8, size: 18, g: -80 }); },
    bg(c, g) {
      Draw.wallpaper(c, '#fff1cf', '#fff7e3');
      Draw.floor(c, 700, '#c9c2b8');
      // Herd
      Draw.rrPath(c, View.L - 10, 600, View.vw + 20, 120, 0); c.fillStyle = '#5b5f66'; c.fill(); c.lineWidth = 5; c.strokeStyle = INK; c.beginPath(); c.moveTo(View.L - 10, 600); c.lineTo(View.R + 10, 600); c.stroke();
      for (const s of g.slots) { Draw.ellipse(c, s.x, 612, 92, 18); Draw.fs(c, '#3b3f45', 4); Draw.ellipse(c, s.x, 612, 70, 11); c.lineWidth = 3; c.strokeStyle = '#8b9099'; c.stroke(); }
      c.fillStyle = '#4a4e55'; for (let i = 0; i < g.slots.length; i++) { c.beginPath(); c.arc(View.L + 60 + i * 50, 660, 12, 0, TAU); c.fill(); }
    },
    drawSlot(c, s) { c.save(); c.translate(0, Math.sin(s.wob * Math.PI * 2) * 6 * s.wob); Draw.pot(c, s.x, s.y, s.color, POT_W, { dots: s.n, fill: '#ffe08a' }); c.restore(); },
    drawItem(c, it) { bundle(c, it.kind, it.n, it.placed ? 0.62 : 0.95); },
  });
})();

/* ===== src/games/puzzle.js ===== */
/* =====================================================================
   Spiel: Puzzle – ein Heldenbild in Teile zerschnitten; jedes Teil an seinen Platz
   im Rahmen ziehen (Formen und Bildausschnitte erkennen).
   ===================================================================== */
(() => {
  const FX = 690, FY = 390, FW = 420, FH = 300;
  const BGS = ['#ffd6e7', '#c9f0ff', '#fff1b8', '#dcffd6'];
  function makePicture(hero, bgCol) {
    const k = Math.max(1, Math.min(2, View.sc * View.dpr));
    const cv = document.createElement('canvas'); cv.width = Math.ceil(FW * k); cv.height = Math.ceil(FH * k);
    const c = cv.getContext('2d'); c.scale(k, k); c.lineJoin = 'round'; c.lineCap = 'round';
    c.fillStyle = bgCol; c.fillRect(0, 0, FW, FH);
    c.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 14; i++) { Draw.starPath(c, (i * 97) % FW, (i * 61 + 20) % FH, 12, 5, 5); c.fill(); }
    Draw.balloon(c, 70, 90, PAL.red, 30, { sway: 0 }); Draw.balloon(c, FW - 70, 100, PAL.blue, 30, { sway: 0 });
    Draw.hero(c, hero, FW / 2, 128, 64, { blink: 0, mood: 'happy' });
    return cv;
  }
  registerGame({
    id: 'puzzle', name: 'Puzzle',
    intro: 'Das Bild ist durcheinander! Zieh jedes Teil in den Rahmen, wo es hingehört.',
    icon(c, x, y) { Draw.rrPath(c, x - 56, y - 110, 112, 100, 10); Draw.fs(c, '#d8a24f', 4); const cols = [PAL.red, PAL.blue, PAL.yellow, PAL.green]; for (let i = 0; i < 4; i++) { Draw.rrPath(c, x - 44 + (i % 2) * 44, y - 98 + Math.floor(i / 2) * 38, 42, 36, 4); Draw.fs(c, cols[i], 3); } Draw.starPath(c, x + 22, y - 42, 12, 5, 5); Draw.fs(c, '#fff', 2); },
    rounds(mode) { return mode === 'small' ? [{ cols: 2, rows: 2 }, { cols: 2, rows: 2 }, { cols: 3, rows: 2 }] : [{ cols: 2, rows: 2 }, { cols: 3, rows: 2 }, { cols: 3, rows: 2 }]; },
    setup(g, spec) {
      const heroes = [currentHero(), ...otherHeroes()], hero = heroes[g.round % heroes.length];
      g.pic = makePicture(hero, BGS[g.round % BGS.length]); g.cols = spec.cols; g.rows = spec.rows;
      const pw = FW / spec.cols, ph = FH / spec.rows;
      g.slots = []; g.items = [];
      // Teile links auf einem Raster, gemischt
      const n = spec.cols * spec.rows, gx = spec.cols === 2 ? [140, 330] : [140, 290], gy = n <= 4 ? [230, 470] : [200, 370, 540];
      const pts = shuffle(gy.flatMap((y) => gx.map((x) => ({ x, y })))).slice(0, n);
      let k = 0;
      for (let r = 0; r < spec.rows; r++) for (let col = 0; col < spec.cols; col++) {
        const cell = r * spec.cols + col, sx = FX - FW / 2 + col * pw + pw / 2, sy = FY - FH / 2 + r * ph + ph / 2;
        g.slots.push({ x: sx, y: sy, r: Math.min(pw, ph) * 0.55, cell, cap: 1, filled: [] });
        g.items.push({ x: pts[k].x, y: pts[k++].y, r: Math.max(pw, ph) / 2, cell, col, row: r, pw, ph, hitTest: (p, it) => Math.abs(p.x - it.x) < it.pw / 2 + 12 && Math.abs(p.y - it.y) < it.ph / 2 + 12 });
      }
      shuffle(g.items);
    },
    accept(it, s) { return it.cell === s.cell; },
    place(it, s) { return { x: s.x, y: s.y, scale: 1, rot: 0 }; },
    onRound(g) { g.frameGlow = Game.time; },
    bg(c, g) {
      Draw.wallpaper(c, '#e3f3ff', '#eef8ff');
      Draw.floor(c, 700, '#d9a66b');
      Draw.table(c, FX, 560, 520, '#f3d9a4');
      // Rahmen mit blassem Bild als Vorlage
      Draw.rrPath(c, FX - FW / 2 - 18, FY - FH / 2 - 18, FW + 36, FH + 36, 16); Draw.fs(c, '#d8a24f', Draw.LW);
      c.save(); c.globalAlpha = 0.28; c.drawImage(g.pic, FX - FW / 2, FY - FH / 2, FW, FH); c.restore();
      c.lineWidth = 3; c.strokeStyle = rgba(INK, 0.35); c.setLineDash([8, 6]);
      for (let i = 1; i < g.cols; i++) { c.beginPath(); c.moveTo(FX - FW / 2 + i * FW / g.cols, FY - FH / 2); c.lineTo(FX - FW / 2 + i * FW / g.cols, FY + FH / 2); c.stroke(); }
      for (let i = 1; i < g.rows; i++) { c.beginPath(); c.moveTo(FX - FW / 2, FY - FH / 2 + i * FH / g.rows); c.lineTo(FX + FW / 2, FY - FH / 2 + i * FH / g.rows); c.stroke(); }
      c.setLineDash([]); c.lineWidth = Draw.LW; c.strokeStyle = INK; c.strokeRect(FX - FW / 2, FY - FH / 2, FW, FH);
    },
    drawSlot(c, s, g) { if (s.glow) { c.save(); c.globalAlpha = s.glow * 0.5; c.fillStyle = PAL.yellow; const pw = FW / g.cols, ph = FH / g.rows; c.fillRect(s.x - pw / 2, s.y - ph / 2, pw, ph); c.restore(); } },
    drawItem(c, it, g) {
      const k = g.pic.width / FW;
      c.save(); Draw.rrPath(c, -it.pw / 2, -it.ph / 2, it.pw, it.ph, 10); c.clip();
      c.drawImage(g.pic, it.col * it.pw * k, it.row * it.ph * k, it.pw * k, it.ph * k, -it.pw / 2, -it.ph / 2, it.pw, it.ph);
      c.restore();
      Draw.rrPath(c, -it.pw / 2, -it.ph / 2, it.pw, it.ph, 10); c.lineWidth = Draw.LW; c.strokeStyle = INK; c.stroke();
    },
  });
})();

/* ===== src/games/rings.js ===== */
/* =====================================================================
   Spiel: Stapelringe – Ringe nach GRÖSSE auf den Stab ziehen, den größten zuerst.
   ===================================================================== */
(() => {
  const COLORS = [PAL.blue, PAL.yellow, PAL.green, PAL.red, PAL.purple, PAL.pink];
  registerGame({
    id: 'rings', name: 'Stapelringe',
    intro: 'Zieh die Ringe auf den Stab. Den größten Ring zuerst!',
    icon(c, x, y) { Draw.ellipse(c, x, y - 2, 56, 16); Draw.fs(c, '#e8c27a', 4); Draw.rrPath(c, x - 7, y - 118, 14, 116, 7); Draw.fs(c, '#d8a24f', 4); [52, 44, 36, 28].forEach((rx, i) => Draw.ring(c, x, y - 18 - i * 22, rx, COLORS[i], rx * 0.42)); },
    rounds(mode) { return mode === 'small' ? [{ n: 3 }, { n: 3 }, { n: 4 }] : [{ n: 4 }, { n: 5 }, { n: 5 }]; },
    setup(g, spec) {
      g.need = 0;
      g.slots = [{ x: 700, y: 470, r: 215, base: 600, cap: spec.n, filled: [] }];
      const pts = scatter(spec.n, 130, 430, 210, 560, 125);
      g.items = Array.from({ length: spec.n }, (_, i) => ({ x: pts[i].x, y: pts[i].y, r: 62, size: i, rx: 150 - i * 20, color: COLORS[i] }));
      shuffle(g.items);
    },
    accept(it, s, g) { return it.size === g.need; },
    onPlace(g) { g.need++; },
    hintItem(g) { return g.items.find((it) => !it.placed && it.size === g.need); },
    place(it, s, g, preview) { const level = preview ? g.need : s.filled.indexOf(it); return { x: s.x, y: s.base - 12 - level * 42 }; },
    bg(c) {
      Draw.wallpaper(c, '#fde7b0', '#fff0c8');
      Draw.floor(c, 660, '#e2b07a');
      Draw.shadow(c, 700, 610, 150, 40, 0.1);
    },
    drawSlot(c, s) { Draw.peg(c, s.x, s.base, 310); if (s.glow) { c.save(); c.globalAlpha = s.glow * 0.6; c.beginPath(); c.arc(s.x, s.base - 300, 30, 0, TAU); c.fillStyle = PAL.yellow; c.fill(); c.restore(); } },
    drawItem(c, it) { Draw.ring(c, 0, 0, it.rx, it.color); },
    wrong(g, it, s) { Voice.say('Den größten zuerst!', { force: true }); },
  });
})();

/* ===== src/main.js ===== */
/* ---------- Start ---------- */
setScene(makeTitle(), { instant: true });
requestAnimationFrame(frame);
/* Entwicklerhaken (zum Testen im Browser): KF.open('bus'), KF.mode('big'), KF.hub() */
window.KF = {
  open(id) { const d = gameById(id); if (d) setScene(d.make ? d.make() : makeSortGame(d), { instant: true }); return !!d; },
  hub() { setScene(makeHub(), { instant: true }); },
  heroes() { setScene(makeHeroSelect(true), { instant: true }); },
  hero(id) { Store.data.hero = id; Store.save(); },
  page(n) { hubPage = n; },
  hint() { const s = Game.scene; return s && s.hint ? s.hint() : null; },
  title() { setScene(makeTitle(), { instant: true }); },
  mode(m) { Store.data.mode = m; Store.save(); },
  state() { const s = Game.scene; return { scene: s && s.def ? s.def.id : (s && s.toys ? 'hub' : 'other'), state: s && s.state, round: s && s.round, items: s && s.items ? s.items.map((it) => ({ x: it.x, y: it.y, placed: !!it.placed, r: it.r })) : null, slots: s && s.slots ? s.slots.map((sl) => ({ x: sl.x, y: sl.y, r: sl.r, filled: sl.filled.length, cap: sl.cap || 1 })) : null, bowls: s && s.bowls ? s.bowls.map((b) => ({ x: b.x, y: b.y, want: b === s.want, found: b.found })) : null }; },
  view() { return { sc: View.sc, ox: View.ox, oy: View.oy }; },
  games: () => GAMES.map((g) => g.id),
  allDone() { for (const g of GAMES) Store.data.done[Store.data.mode][g.id] = true; Store.data.party[Store.data.mode] = false; Store.save(); },
  reset() { Store.resetProgress('small'); Store.resetProgress('big'); },
  parents() { if (Game.scene && Game.scene.toys) Game.overlay = makeParents(Game.scene); },
  done: () => Store.data.done,
};

