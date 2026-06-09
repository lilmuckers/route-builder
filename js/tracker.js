export class Tracker {
  constructor({ onPoint, onError }) {
    this.onPoint = onPoint;
    this.onError = onError;
    this._watchId = null;
    this.points = [];
    this.active = false;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.points = [];

    const opts = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000,
    };

    this._watchId = navigator.geolocation.watchPosition(
      pos => this._handlePosition(pos),
      err => this.onError(err),
      opts
    );
  }

  stop() {
    if (this._watchId !== null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
    this.active = false;
    return this.points.slice();
  }

  _handlePosition(pos) {
    const { coords, timestamp } = pos;
    const pt = {
      lat: coords.latitude,
      lng: coords.longitude,
      altitude: coords.altitude,
      accuracy: coords.accuracy,
      altitudeAccuracy: coords.altitudeAccuracy,
      heading: coords.heading,
      speed: coords.speed,
      deviceTimestamp: Date.now(),
      gpsTimestamp: timestamp,
    };
    this.points.push(pt);
    this.onPoint(pt, this.points);
  }
}
