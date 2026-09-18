// ============================================================
// shake.js — turn a physical shake of the phone into a dice roll.
//
// Reads the accelerometer and looks for several hard jolts in quick
// succession. One jolt is a phone being put down on a table; three
// inside a second is somebody shaking it on purpose.
//
// Needs a secure context (GitHub Pages and localhost both qualify), and
// on iOS 13+ an explicit permission that must be asked for from inside a
// user gesture — hence requestMotionPermission() being separate.
// ============================================================

const REST_G = 9.81;   // magnitude the accelerometer reports lying still

export function motionSupported() {
  return typeof window.DeviceMotionEvent !== 'undefined';
}

/** iOS 13+ gates the accelerometer behind a prompt. */
export function needsMotionPermission() {
  return motionSupported() && typeof DeviceMotionEvent.requestPermission === 'function';
}

/** Call this synchronously from a tap handler, or iOS rejects it. */
export async function requestMotionPermission() {
  if (!needsMotionPermission()) return 'granted';
  try { return await DeviceMotionEvent.requestPermission(); }
  catch { return 'denied'; }
}

export class ShakeDetector {
  /**
   * @param {object} opts
   * @param {() => void} opts.onShake   fired once per deliberate shake
   * @param {() => void} [opts.onNoSensor] no readings arrived — desktop, or a phone without one
   * @param {() => void} [opts.onSensorOk] first reading arrived, so clear any earlier warning
   * @param {number} [opts.threshold]   m/s² away from rest that counts as a jolt
   * @param {number} [opts.hits]        jolts needed before it counts as a shake
   * @param {number} [opts.window]      ms the jolts must land within
   * @param {number} [opts.cooldown]    ms of silence after firing, so one shake is one roll
   */
  constructor(opts) {
    this.onShake = opts.onShake;
    this.onNoSensor = opts.onNoSensor;
    this.onSensorOk = opts.onSensorOk;
    this.threshold = opts.threshold ?? 12;
    this.hits = opts.hits ?? 3;
    this.window = opts.window ?? 1000;
    this.cooldown = opts.cooldown ?? 1500;

    this.spikes = [];
    this.lastFire = 0;
    this.sawData = false;
    this.running = false;
    this._handler = (e) => this.#onMotion(e);
  }

  start() {
    if (this.running || !motionSupported()) return false;
    window.addEventListener('devicemotion', this._handler);
    this.running = true;
    this.spikes = [];
    this.sawData = false;   // re-probe: a remembered iOS grant can have lapsed
    // A desktop browser exposes DeviceMotionEvent but never fires it, and
    // some phones have no usable sensor. Say so instead of looking broken.
    clearTimeout(this._probe);
    this._probe = setTimeout(() => { if (!this.sawData) this.onNoSensor?.(); }, 2500);
    return true;
  }

  stop() {
    clearTimeout(this._probe);
    if (!this.running) return;
    window.removeEventListener('devicemotion', this._handler);
    this.running = false;
    this.spikes = [];
  }

  #onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    if (!this.sawData) { this.sawData = true; this.onSensorOk?.(); }

    const now = performance.now();
    if (now - this.lastFire < this.cooldown) return;

    const jolt = Math.abs(Math.hypot(a.x, a.y, a.z) - REST_G);
    if (jolt < this.threshold) return;

    // One swing of the arm spans many samples; collapse it into one spike.
    const last = this.spikes[this.spikes.length - 1];
    if (last != null && now - last < 90) return;

    this.spikes.push(now);
    this.spikes = this.spikes.filter(t => now - t <= this.window);

    if (this.spikes.length >= this.hits) {
      this.spikes = [];
      this.lastFire = now;
      this.onShake();
    }
  }
}
