const GRAVITY_ALPHA = 0.85; // low-pass filter for gravity vector estimate
const CALIB_THRESHOLD = 1.5; // m/s^2, linear accel magnitude to trigger forward-axis calibration
const CALIB_SAMPLES_NEEDED = 5;
const ROTATION_THRESHOLD = 15; // deg/s, above this we assume the phone is being handled, not the car moving

function normalize(v) {
  const m = Math.hypot(v.x, v.y, v.z);
  if (m === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

// Captures device motion and projects it into a vehicle-relative frame
// (forward / lateral / vertical), filtering out samples where the phone
// appears to be moving relative to its mount (not the car).
export class MotionSensor {
  constructor() {
    this.gravity = null; // smoothed "down" direction (unnormalized accel vector)
    this.forward = null; // unit vector, vehicle forward axis in device frame
    this.right = null; // unit vector, vehicle right axis in device frame
    this._calibrating = true;
    this._calibSamples = [];
    this.samples = []; // {t, accelF, accelL, accelV, confidence}
    this._handler = null;
  }

  static async requestPermission() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const res = await DeviceMotionEvent.requestPermission();
        return res === 'granted';
      } catch {
        return false;
      }
    }
    return typeof DeviceMotionEvent !== 'undefined';
  }

  start() {
    this.gravity = null;
    this.forward = null;
    this.right = null;
    this._calibrating = true;
    this._calibSamples = [];
    this.samples = [];
    this._handler = e => this._onMotion(e);
    window.addEventListener('devicemotion', this._handler);
  }

  stop() {
    if (this._handler) window.removeEventListener('devicemotion', this._handler);
    this._handler = null;
  }

  _onMotion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null) return;

    if (this.gravity) {
      this.gravity = {
        x: GRAVITY_ALPHA * this.gravity.x + (1 - GRAVITY_ALPHA) * g.x,
        y: GRAVITY_ALPHA * this.gravity.y + (1 - GRAVITY_ALPHA) * g.y,
        z: GRAVITY_ALPHA * this.gravity.z + (1 - GRAVITY_ALPHA) * g.z,
      };
    } else {
      this.gravity = { x: g.x, y: g.y, z: g.z };
      return;
    }

    const lin = sub(g, this.gravity);

    if (this._calibrating) {
      if (Math.hypot(lin.x, lin.y, lin.z) > CALIB_THRESHOLD) {
        this._calibSamples.push(lin);
        if (this._calibSamples.length >= CALIB_SAMPLES_NEEDED) {
          this._finishCalibration();
        }
      }
      return;
    }

    const r = e.rotationRate;
    const rotMag = r ? Math.hypot(r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0) : 0;
    const confidence = rotMag < ROTATION_THRESHOLD ? 1 : 0;

    const down = normalize(this.gravity);
    this.samples.push({
      t: Date.now(),
      accelF: dot(lin, this.forward),
      accelL: dot(lin, this.right),
      accelV: dot(lin, down),
      confidence,
    });
  }

  _finishCalibration() {
    const down = normalize(this.gravity);
    // average the calibration burst direction, then remove its vertical
    // component so "forward" lies in the horizontal plane of the mount
    let avg = { x: 0, y: 0, z: 0 };
    for (const s of this._calibSamples) avg = { x: avg.x + s.x, y: avg.y + s.y, z: avg.z + s.z };
    avg = scale(avg, 1 / this._calibSamples.length);

    const vertical = scale(down, dot(avg, down));
    const horizontal = sub(avg, vertical);

    if (Math.hypot(horizontal.x, horizontal.y, horizontal.z) < 0.1) {
      // burst was essentially vertical (e.g. pothole) - keep waiting
      this._calibSamples = [];
      return;
    }

    this.forward = normalize(horizontal);
    this.right = normalize(cross(down, this.forward));
    this._calibrating = false;
    this._calibSamples = [];
  }

  // Removes and summarizes all buffered samples with t <= uptoTime.
  // Returns null if no samples are available for the window.
  drainSummary(uptoTime) {
    const inWindow = [];
    const remaining = [];
    for (const s of this.samples) {
      if (s.t <= uptoTime) inWindow.push(s);
      else remaining.push(s);
    }
    this.samples = remaining;
    if (inWindow.length === 0) return null;

    let maxAccelF = -Infinity;
    let minAccelF = Infinity;
    let maxLateralAbs = 0;
    let confidentCount = 0;

    for (const s of inWindow) {
      if (s.accelF > maxAccelF) maxAccelF = s.accelF;
      if (s.accelF < minAccelF) minAccelF = s.accelF;
      if (Math.abs(s.accelL) > maxLateralAbs) maxLateralAbs = Math.abs(s.accelL);
      if (s.confidence) confidentCount++;
    }

    return {
      maxAccelF,
      minAccelF,
      maxLateralAbs,
      sampleCount: inWindow.length,
      confidence: confidentCount / inWindow.length,
    };
  }
}
