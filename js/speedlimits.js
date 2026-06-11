const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const MATCH_THRESHOLD_M = 30;
const GRID_DEG = 0.0015; // ~150m cells

/**
 * Fetch highway ways with maxspeed tags within the bounding box of the route.
 * Returns [{ maxspeedKmh, geometry: [{lat,lng}, ...] }, ...]
 */
export async function fetchSpeedLimits(points) {
  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  const pad = 0.003;
  const bbox = [
    Math.min(...lats) - pad,
    Math.min(...lngs) - pad,
    Math.max(...lats) + pad,
    Math.max(...lngs) + pad,
  ].join(',');

  const query = `[out:json][timeout:30];way["highway"]["maxspeed"](${bbox});out geom;`;

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass error ${res.status}`);
  const data = await res.json();

  return data.elements
    .filter(el => el.type === 'way' && el.geometry && el.tags?.maxspeed)
    .map(el => ({
      maxspeedKmh: parseMaxspeed(el.tags.maxspeed),
      geometry: el.geometry.map(g => ({ lat: g.lat, lng: g.lon })),
    }))
    .filter(w => w.maxspeedKmh != null);
}

function parseMaxspeed(val) {
  const m = String(val).match(/(\d+(\.\d+)?)\s*(mph)?/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (isNaN(num)) return null;
  return /mph/i.test(val) ? num * 1.60934 : num;
}

/**
 * Mutates points in place, adding `speedLimitKmh` (number or null) based on
 * nearest matching way segment within MATCH_THRESHOLD_M.
 */
export function matchSpeedLimits(points, ways) {
  const index = new Map();

  const cellKey = (lat, lng) => `${Math.round(lat / GRID_DEG)}:${Math.round(lng / GRID_DEG)}`;

  for (const way of ways) {
    for (let i = 0; i < way.geometry.length - 1; i++) {
      const a = way.geometry[i];
      const b = way.geometry[i + 1];
      const seg = { a, b, maxspeedKmh: way.maxspeedKmh };
      for (const pt of [a, b]) {
        const key = cellKey(pt.lat, pt.lng);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(seg);
      }
    }
  }

  for (const pt of points) {
    const cellLat = Math.round(pt.lat / GRID_DEG);
    const cellLng = Math.round(pt.lng / GRID_DEG);

    let best = null;
    let bestDist = Infinity;

    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLng = -1; dLng <= 1; dLng++) {
        const segs = index.get(`${cellLat + dLat}:${cellLng + dLng}`);
        if (!segs) continue;
        for (const seg of segs) {
          const d = pointToSegmentMeters(pt, seg.a, seg.b);
          if (d < bestDist) { bestDist = d; best = seg; }
        }
      }
    }

    pt.speedLimitKmh = bestDist <= MATCH_THRESHOLD_M ? best.maxspeedKmh : null;
  }
}

function toXY(lat, lng, refLat) {
  const R = 6371000;
  return [
    lng * Math.PI / 180 * R * Math.cos(refLat * Math.PI / 180),
    lat * Math.PI / 180 * R,
  ];
}

function pointToSegmentMeters(p, a, b) {
  const ref = p.lat;
  const [px, py] = toXY(p.lat, p.lng, ref);
  const [ax, ay] = toXY(a.lat, a.lng, ref);
  const [bx, by] = toXY(b.lat, b.lng, ref);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
