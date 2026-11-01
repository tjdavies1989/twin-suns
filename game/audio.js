// ============================================================================
//  audio.js — synthesised SFX (WebAudio) with optional file overrides.
//  No assets required. theme.sounds[name] = 'assets/x.mp3' overrides a synth.
//  Nothing here throws before initAudio or when AudioContext is missing.
// ============================================================================

const NAMES = ['blaster', 'saber', 'explosion', 'push', 'lightning', 'enemyShot', 'hit',
  'death', 'pickup', 'levelup', 'hurt', 'bossAlert', 'victory', 'gameover', 'uiClick'];

// Minimum gap between plays of the same sound, in ms.
const MIN_GAP = {
  blaster: 40, saber: 120, explosion: 60, push: 150, lightning: 70, enemyShot: 50,
  hit: 35, death: 45, pickup: 30, levelup: 200, hurt: 150, bossAlert: 800,
  victory: 1000, gameover: 1000, uiClick: 40,
};

let theme = null;
let ctx = null;
let master = null;
let noiseBuf = null;
let musicGain = null;
let musicSrc = null;
let musicBuf = null;
let wantMusic = false;
let muted = false;
let sfxVolume = 0.6;
const overrides = {};       // name -> AudioBuffer
const lastPlay = {};        // name -> ms
let pickupStreak = 0;
let lastPickupAt = 0;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------------------------------------------------------------- init ------

export async function initAudio(t) {
  try {
    theme = t || theme;
    const s = (theme && theme.sounds) || {};
    if (typeof s.sfxVolume === 'number') sfxVolume = s.sfxVolume;
    if (!ctx) {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : sfxVolume;
      master.connect(ctx.destination);
      // One shared 1 s white-noise buffer, reused by every noise-based sound.
      const len = Math.floor(ctx.sampleRate * 1);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const jobs = [];
    for (const n of NAMES) {
      if (typeof s[n] === 'string' && s[n]) jobs.push(loadBuffer(s[n]).then(b => { if (b) overrides[n] = b; }));
    }
    if (typeof s.music === 'string' && s.music) {
      jobs.push(loadBuffer(s.music).then(b => { if (b) { musicBuf = b; if (wantMusic) startMusic(); } }));
    }
    await Promise.all(jobs);
  } catch (e) {
    console.warn('[audio] init failed, sound may be unavailable:', e);
  }
}

async function loadBuffer(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.arrayBuffer();
    return await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(data, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
  } catch (e) {
    console.warn('[audio] could not load "' + path + '", using synth:', e && e.message ? e.message : e);
    return null;
  }
}

// ------------------------------------------------------------- helpers ------

// Oscillator with frequency sweep f0 -> f1 and a fast-attack exponential decay.
function osc(type, f0, f1, t, dur, vol, attack = 0.004, dest = master) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20, f0), t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.02);
  return o;
}

// Filtered noise burst. Filter sweeps fa -> fb.
function noise(type, fa, fb, q, t, dur, vol, attack = 0.004, offset = 0) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(Math.max(20, fa), t);
  if (fb !== fa) f.frequency.exponentialRampToValueAtTime(Math.max(20, fb), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t, offset % 0.4); s.stop(t + dur + 0.02);
  return s;
}

// ---------------------------------------------------------- synth sounds ----
// Each: (t, v, p) where v = volume 0..1 multiplier, p = pitch multiplier.

const SYNTH = {
  blaster(t, v, p) {
    osc('square', 1500 * p, 260 * p, t, 0.16, 0.16 * v);
    osc('sawtooth', 750 * p, 130 * p, t, 0.12, 0.08 * v);
  },
  saber(t, v, p) {
    osc('sawtooth', 110 * p, 150 * p, t, 0.22, 0.09 * v, 0.03);
    osc('sine', 220 * p, 330 * p, t, 0.2, 0.08 * v, 0.03);
    noise('bandpass', 600 * p, 2400 * p, 3, t, 0.2, 0.09 * v, 0.05);
  },
  explosion(t, v, p) {
    noise('lowpass', 2400 * p, 120 * p, 0.7, t, 0.5, 0.45 * v, 0.003);
    osc('sine', 130 * p, 38, t, 0.4, 0.5 * v, 0.003);
  },
  push(t, v, p) {
    noise('bandpass', 250 * p, 2200 * p, 1.4, t, 0.45, 0.35 * v, 0.12);
    osc('sine', 90 * p, 45, t, 0.4, 0.22 * v, 0.02);
  },
  lightning(t, v, p) {
    // Crackle: several short high-passed noise ticks with jittered timing.
    for (let i = 0; i < 7; i++) {
      const dt = i * 0.045 + Math.random() * 0.03;
      noise('highpass', (2500 + Math.random() * 3000) * p, 3000 * p, 0.8, t + dt,
        0.04 + Math.random() * 0.04, (0.14 + Math.random() * 0.1) * v, 0.002, Math.random());
    }
    osc('sawtooth', 70 * p, 55 * p, t, 0.32, 0.05 * v, 0.01);
  },
  enemyShot(t, v, p) {
    osc('sawtooth', 700 * p, 180 * p, t, 0.14, 0.09 * v);
    osc('triangle', 350 * p, 120 * p, t, 0.14, 0.08 * v);
  },
  hit(t, v, p) {
    osc('square', 520 * p, 200 * p, t, 0.05, 0.1 * v, 0.001);
    noise('highpass', 3000, 3000, 0.7, t, 0.03, 0.08 * v, 0.001);
  },
  death(t, v, p) {
    osc('sawtooth', 170 * p, 55 * p, t, 0.3, 0.12 * v, 0.005);
    osc('square', 85 * p, 40 * p, t, 0.28, 0.07 * v, 0.005);
    noise('lowpass', 900, 200, 0.7, t, 0.18, 0.12 * v);
  },
  pickup(t, v, p) {
    osc('sine', 1100 * p, 1500 * p, t, 0.09, 0.1 * v, 0.002);
    osc('triangle', 2200 * p, 3000 * p, t, 0.07, 0.04 * v, 0.002);
  },
  levelup(t, v, p) {
    const base = 523.25 * p;
    [1, 1.2599, 1.5, 2].forEach((r, i) => {
      const at = t + i * 0.085;
      osc('triangle', base * r, base * r, at, 0.2, 0.14 * v, 0.006);
      osc('sine', base * r * 2, base * r * 2, at, 0.16, 0.05 * v, 0.006);
    });
  },
  hurt(t, v, p) {
    osc('sawtooth', 95 * p, 70 * p, t, 0.25, 0.2 * v, 0.004);
    osc('square', 47 * p, 40 * p, t, 0.25, 0.14 * v, 0.004);
    noise('lowpass', 500, 150, 0.7, t, 0.15, 0.1 * v);
  },
  bossAlert(t, v, p) {
    // Two-tone horn.
    [[185, 0], [138, 0.34]].forEach(([f, off]) => {
      osc('sawtooth', f * p, f * p, t + off, 0.4, 0.17 * v, 0.03);
      osc('square', f * p * 1.005, f * p * 1.005, t + off, 0.4, 0.08 * v, 0.03);
    });
  },
  victory(t, v, p) {
    [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) => {
      const at = t + i * 0.11;
      const dur = i === 5 ? 0.5 : 0.16;
      osc('triangle', f * p, f * p, at, dur, 0.15 * v, 0.008);
      osc('sine', f * p * 2, f * p * 2, at, dur, 0.04 * v, 0.008);
    });
  },
  gameover(t, v, p) {
    [392, 329.63, 261.63, 196].forEach((f, i) => {
      const at = t + i * 0.16;
      osc('sawtooth', f * p, f * p * 0.96, at, i === 3 ? 0.55 : 0.2, 0.12 * v, 0.01);
    });
  },
  uiClick(t, v, p) {
    osc('square', 900 * p, 600 * p, t, 0.04, 0.07 * v, 0.001);
  },
};

// ------------------------------------------------------------------ play ----

export function play(name, opts) {
  try {
    if (!ctx || muted || !master) return;
    const gap = MIN_GAP[name];
    const t0 = now();
    if (gap && lastPlay[name] !== undefined && t0 - lastPlay[name] < gap) return;
    lastPlay[name] = t0;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const v = opts && typeof opts.volume === 'number' ? opts.volume : 1;
    let p = opts && typeof opts.pitch === 'number' ? opts.pitch : 1;

    if (name === 'pickup') {
      // Rising pitch for streaks; resets after a quiet moment.
      pickupStreak = t0 - lastPickupAt < 350 ? Math.min(pickupStreak + 1, 12) : 0;
      lastPickupAt = t0;
      p *= Math.pow(1.0595, pickupStreak); // semitone steps
    }

    const buf = overrides[name];
    if (buf) {
      const s = ctx.createBufferSource();
      const g = ctx.createGain();
      s.buffer = buf;
      s.playbackRate.value = p;
      g.gain.value = v;
      s.connect(g); g.connect(master);
      s.start();
      return;
    }
    const fn = SYNTH[name];
    if (fn) fn(ctx.currentTime + 0.005, v, p);
  } catch (e) {
    // Audio must never break the game.
  }
}

// ----------------------------------------------------------- mute / music ---

export function setMuted(b) {
  muted = !!b;
  try {
    if (master) master.gain.value = muted ? 0 : sfxVolume;
    if (musicGain) musicGain.gain.value = muted ? 0 : musicVol();
  } catch (e) { /* ignore */ }
}

export function isMuted() { return muted; }

function musicVol() {
  const v = theme && theme.sounds && theme.sounds.musicVolume;
  return typeof v === 'number' ? v : 0.35;
}

export function startMusic() {
  wantMusic = true;
  try {
    if (!ctx || !musicBuf || musicSrc) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    musicGain = ctx.createGain();
    musicGain.gain.value = muted ? 0 : musicVol();
    musicGain.connect(ctx.destination);
    musicSrc = ctx.createBufferSource();
    musicSrc.buffer = musicBuf;
    musicSrc.loop = true;
    musicSrc.connect(musicGain);
    musicSrc.start();
  } catch (e) {
    console.warn('[audio] music failed:', e);
  }
}

export function stopMusic() {
  wantMusic = false;
  try {
    if (musicSrc) { musicSrc.stop(); musicSrc.disconnect(); }
    if (musicGain) musicGain.disconnect();
  } catch (e) { /* ignore */ }
  musicSrc = null;
  musicGain = null;
}
