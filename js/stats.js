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
  let minAltIndex = null;
  let maxAltIndex = null;
  let maxSpeedIndex = null;
  let maxAccelF = null;
  let maxAccelIndex = null;
  let minAccelF = null;
  let minAccelIndex = null;
  let maxLateral = null;
  let maxLateralIndex = null;
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
      if (minAlt === null || cur.altitude < minAlt) { minAlt = cur.altitude; minAltIndex = i; }
      if (maxAlt === null || cur.altitude > maxAlt) { maxAlt = cur.altitude; maxAltIndex = i; }
    }

    const dtS = (cur.gpsTimestamp - prev.gpsTimestamp) / 1000;
    const segDist = haversine(prev, cur);
    const segSpeed = dtS > 0 ? segDist / dtS : 0;
    speeds.push(segSpeed);
    if (segSpeed > maxSpeed) { maxSpeed = segSpeed; maxSpeedIndex = i; }

    const m = cur.motion;
    if (m && m.confidence > 0.5) {
      if (maxAccelF === null || m.maxAccelF > maxAccelF) { maxAccelF = m.maxAccelF; maxAccelIndex = i; }
      if (minAccelF === null || m.minAccelF < minAccelF) { minAccelF = m.minAccelF; minAccelIndex = i; }
      if (maxLateral === null || m.maxLateralAbs > maxLateral) { maxLateral = m.maxLateralAbs; maxLateralIndex = i; }
    }
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
    minAltIndex,
    maxAltIndex,
    maxSpeedIndex,
    maxAccelF,
    maxAccelIndex,
    minAccelF,
    minAccelIndex,
    maxLateral,
    maxLateralIndex,
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

export function fmtAccel(mps2) {
  if (mps2 == null) return 'n/a';
  return (mps2 / 9.81).toFixed(2) + ' g';
}

export function mpgColor(mpg, min, max) {
  const t = max === min ? 0.5 : (mpg - min) / (max - min);
  const hue = Math.round(t * 120);
  return `hsl(${hue},90%,45%)`;
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Speed (km/h) at point i, preferring device-reported speed, falling back to computed. */
export function pointSpeedKmh(points, i) {
  if (points[i].speed != null) return points[i].speed * 3.6;
  if (i === 0) return 0;
  const dt = (points[i].gpsTimestamp - points[i - 1].gpsTimestamp) / 1000;
  if (dt <= 0) return 0;
  return haversine(points[i - 1], points[i]) / dt * 3.6;
}

/** Blue (slow) -> red (fast). */
export function speedColor(speedKmh, minKmh, maxKmh) {
  const t = maxKmh === minKmh ? 0.5 : clamp((speedKmh - minKmh) / (maxKmh - minKmh), 0, 1);
  const hue = 240 - t * 240;
  return `hsl(${hue},85%,50%)`;
}

/** Blue (under limit) -> green (at limit) -> red (over limit). Grey if no limit known. */
export function relativeSpeedColor(speedKmh, limitKmh) {
  if (limitKmh == null) return 'hsl(0,0%,55%)';
  const diff = speedKmh - limitKmh;
  let hue;
  if (diff <= -5) {
    const t = clamp((diff + 25) / 20, 0, 1); // -25 -> 0, -5 -> 1
    hue = 240 - t * 120; // blue -> green
  } else if (diff <= 5) {
    hue = 120; // green band around the limit
  } else {
    const t = clamp((diff - 5) / 30, 0, 1); // 5 -> 0, 35+ -> 1
    hue = 120 - t * 120; // green -> red
  }
  return `hsl(${hue},85%,50%)`;
}

/** Red (slow chunk, traffic) -> green (fast chunk). */
export function paceColor(dist, minD, maxD) {
  const t = maxD === minD ? 0.5 : clamp((dist - minD) / (maxD - minD), 0, 1);
  return `hsl(${Math.round(t * 120)},85%,50%)`;
}

/**
 * Build per-segment {points:[a,b], color, point, speedKmh, chunkDistance?} for the
 * given colour mode: 'plain' | 'absolute' | 'relative' | 'pace'.
 */
export function buildColoredSegments(points, mode) {
  if (points.length < 2) return [];
  if (mode === 'pace') return buildPaceSegments(points);

  const speeds = points.map((_, i) => pointSpeedKmh(points, i));
  const minS = Math.min(...speeds);
  const maxS = Math.max(...speeds);

  const segs = [];
  for (let i = 1; i < points.length; i++) {
    const speedKmh = speeds[i];
    let color;
    if (mode === 'absolute') color = speedColor(speedKmh, minS, maxS);
    else if (mode === 'relative') color = relativeSpeedColor(speedKmh, points[i].speedLimitKmh);
    else color = '#3b82f6';
    segs.push({ points: [points[i - 1], points[i]], color, point: points[i], speedKmh });
  }
  return segs;
}

function buildPaceSegments(points, chunkSeconds = 60) {
  const start = points[0].gpsTimestamp;
  const chunkOf = i => Math.floor((points[i].gpsTimestamp - start) / 1000 / chunkSeconds);

  const chunkRanges = [];
  let chunkStart = 0;
  for (let i = 1; i < points.length; i++) {
    if (chunkOf(i) !== chunkOf(chunkStart)) {
      chunkRanges.push([chunkStart, i]);
      chunkStart = i;
    }
  }
  chunkRanges.push([chunkStart, points.length - 1]);

  const dists = chunkRanges.map(([a, b]) => {
    let d = 0;
    for (let i = Math.max(a, 1); i <= b; i++) d += haversine(points[i - 1], points[i]);
    return d;
  });
  const minD = Math.min(...dists);
  const maxD = Math.max(...dists);

  const segs = [];
  chunkRanges.forEach(([a, b], ci) => {
    const color = paceColor(dists[ci], minD, maxD);
    for (let i = Math.max(a, 1); i <= b; i++) {
      segs.push({ points: [points[i - 1], points[i]], color, point: points[i], chunkDistance: dists[ci], speedKmh: pointSpeedKmh(points, i) });
    }
  });
  return segs;
}
