export class Replay {
  constructor({ points, onTick, onDone }) {
    this.points = points;
    this.onTick = onTick;
    this.onDone = onDone;
    this.speed = 1;
    this.index = 0;
    this._timer = null;
    this.running = false;
    this.paused = false;
  }

  start(speed = 1) {
    this.speed = speed;
    this.index = 0;
    this.running = true;
    this.paused = false;
    this._tick();
  }

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    clearTimeout(this._timer);
  }

  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this._tick();
  }

  setSpeed(speed) {
    this.speed = speed;
  }

  stop() {
    clearTimeout(this._timer);
    this.running = false;
    this.paused = false;
    this.index = 0;
  }

  _tick() {
    if (!this.running || this.paused) return;
    const pt = this.points[this.index];
    this.onTick(pt, this.index, this.points.length);

    const next = this.points[this.index + 1];
    if (!next) {
      this.running = false;
      this.onDone();
      return;
    }

    const realDt = next.gpsTimestamp - pt.gpsTimestamp;
    const delay = Math.max(16, realDt / this.speed);
    this.index++;
    this._timer = setTimeout(() => this._tick(), delay);
  }
}
