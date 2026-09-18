// ============================================================
// sfx.js — every sound is synthesised on the fly with Web Audio.
//
// No audio files: nothing to download, nothing to wait for, and the
// whole app stays a handful of text files. Dice clacks are short bursts
// of filtered noise, chimes are oscillators.
//
// iOS starts every AudioContext suspended until a real touch reaches the
// page, so ensure() is also wired to the first pointerdown. Note that
// Safari routes Web Audio through the ringer switch — a phone on silent
// stays silent, which is the behaviour people expect anyway.
// ============================================================

const MASTER_GAIN = 0.9;

let ctx = null;
let master = null;
let noise = null;
let muted = false;

function ensure() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try { ctx = new AC(); } catch { return null; }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_GAIN;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => { /* still waiting for a gesture */ });
  return ctx;
}

// Any tap anywhere is a good moment to wake the audio engine up.
window.addEventListener('pointerdown', () => ensure(), { passive: true, capture: true });

export function primeAudio() { ensure(); }
export function isMuted() { return muted; }
export function setMuted(v) {
  muted = !!v;
  if (master) master.gain.value = muted ? 0 : MASTER_GAIN;
}

/** Half a second of white noise, reused by every percussive sound. */
function noiseBuf() {
  if (noise) return noise;
  const len = Math.floor(ctx.sampleRate * 0.5);
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

/** A single dry knock — one die hitting wood. */
function clack(t, { freq = 2600, q = 6, gain = 0.3, dur = 0.05 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t, Math.random() * 0.3);
  src.stop(t + dur + 0.02);
}

function tone(t, { freq = 440, to = null, dur = 0.25, type = 'sine', gain = 0.2 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Filtered noise sweeping upward — cloth, card, a lid coming off. */
function whoosh(t, { from = 300, to = 2000, dur = 0.25, gain = 0.14 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf();
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(from, t);
  bp.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

const SOUNDS = {
  // dice tumbling inside the cup, then two settling knocks
  roll(t) {
    for (let i = 0; i < 9; i++) {
      clack(t + i * 0.045 + Math.random() * 0.02, {
        freq: 1800 + Math.random() * 2200,
        q: 5 + Math.random() * 6,
        gain: 0.16 + Math.random() * 0.12,
        dur: 0.05,
      });
    }
    clack(t + 0.50, { freq: 1400, q: 3,   gain: 0.42, dur: 0.12 });
    clack(t + 0.57, { freq: 900,  q: 2.5, gain: 0.28, dur: 0.14 });
  },
  lift(t)   { whoosh(t, { from: 260, to: 1800, dur: 0.24, gain: 0.13 }); },
  flip(t)   { clack(t, { freq: 3200, q: 2, gain: 0.2, dur: 0.06 });
              whoosh(t + 0.01, { from: 900, to: 2600, dur: 0.16, gain: 0.07 }); },
  lock(t)   { clack(t, { freq: 2200, q: 10, gain: 0.36, dur: 0.045 });
              tone(t + 0.02, { freq: 1180, dur: 0.1, type: 'square', gain: 0.05 }); },
  unlock(t) { tone(t, { freq: 760, to: 1180, dur: 0.12, type: 'triangle', gain: 0.12 });
              clack(t + 0.06, { freq: 2600, q: 8, gain: 0.22, dur: 0.04 }); },
  deny(t)   { tone(t, { freq: 150, to: 90, dur: 0.22, type: 'sawtooth', gain: 0.14 }); },
  deal(t)   { for (let i = 0; i < 6; i++) {
                clack(t + i * 0.07, { freq: 3400 + Math.random() * 1200, q: 1.6, gain: 0.14, dur: 0.07 });
              } },
  reveal(t) { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
                tone(t + i * 0.08, { freq: f, dur: 0.5, type: 'triangle', gain: 0.12 })); },
  join(t)   { tone(t, { freq: 880, dur: 0.14, gain: 0.15 });
              tone(t + 0.1, { freq: 1318.5, dur: 0.22, gain: 0.12 }); },
  start(t)  { [392, 523.25, 659.25].forEach((f, i) =>
                tone(t + i * 0.06, { freq: f, dur: 0.35, type: 'triangle', gain: 0.13 })); },
  tap(t)    { clack(t, { freq: 2800, q: 4, gain: 0.12, dur: 0.03 }); },
};

export function sfx(name) {
  if (muted) return;
  const c = ensure();
  // Scheduling into a suspended context queues everything up to fire at
  // once the moment it resumes, so drop the sound instead.
  if (!c || c.state === 'suspended') return;
  const fn = SOUNDS[name];
  if (!fn) return;
  try { fn(c.currentTime + 0.01); } catch { /* audio graph hiccup; not worth breaking play */ }
}
