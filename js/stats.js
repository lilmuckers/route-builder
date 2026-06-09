const R = 6371000; // earth radius meters

function toRad(d) { return d * Math.PI / 180; }

export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function calcStats(points) {
  if (!points || points.length < 2) {
    return { distance: 0, duration: 0, avgSpeed: 0, maxSpeed: 0, elevGain: 0, elevLoss: 0, minAlt: null, maxAlt: null, pointCount: points?.length ?? 0 };
  }

  let distance = 0;
  let elevGain = 0;
  let elevLoss = 0;
  let minAlt = null;
  let maxAlt = null;
  let maxSpeed = 0;
  const speeds = [];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];

    distance += haversine(prev, cur);

    if (cur.altitude != null && prev.altitude != null) {
      const delta = cur.altitude - prev.altitude;
      if (delta > 0) elevGain += delta;
      else elevLoss += Math.abs(delta);
    }

    if (cur.altitude != null) {
      if (minAlt === null || cur.altitude < minAlt) minAlt = cur.altitude;
      if (maxAlt === null || cur.altitude > maxAlt) maxAlt = cur.altitude;
    }

    const dtS = (cur.gpsTimestamp - prev.gpsTimestamp) / 1000;
    const segDist = haversine(prev, cur);
    const segSpeed = dtS > 0 ? segDist / dtS : 0;
    speeds.push(segSpeed);
    if (segSpeed > maxSpeed) maxSpeed = segSpeed;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const duration = (last.gpsTimestamp - first.gpsTimestamp) / 1000;
  const avgSpeed = duration > 0 ? distance / duration : 0;

  return {
    distance,
    duration,
    avgSpeed,
    maxSpeed,
    elevGain,
    elevLoss,
    minAlt,
    maxAlt,
    pointCount: points.length,
    speeds,
  };
}

export function fmtDistance(m) {
  if (m >= 1000) return (m / 1000).toFixed(2) + ' km';
  return Math.round(m) + ' m';
}

export function fmtSpeed(ms) {
  return (ms * 3.6).toFixed(1) + ' km/h';
}

export function fmtDuration(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function fmtAlt(m) {
  if (m == null) return 'n/a';
  return Math.round(m) + ' m';
}

export function mpgColor(mpg, min, max) {
  const t = max === min ? 0.5 : (mpg - min) / (max - min);
  const hue = Math.round(t * 120);
  return `hsl(${hue},90%,45%)`;
}
