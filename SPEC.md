# Path Tracer — Specification

## GPS Data Model

Every recorded point (`GeoPoint`) captures the full `GeolocationPosition` payload plus a device-side timestamp:

```ts
interface GeoPoint {
  lat:              number;   // degrees
  lng:              number;   // degrees
  altitude:         number | null;  // metres above WGS84 ellipsoid
  accuracy:         number;   // horizontal accuracy radius, metres
  altitudeAccuracy: number | null;  // metres
  heading:          number | null;  // degrees clockwise from true north, 0–360
  speed:            number | null;  // m/s ground speed
  gpsTimestamp:     number;   // ms since epoch, from GeolocationPosition.timestamp
  deviceTimestamp:  number;   // ms since epoch, from Date.now() at point receipt
  speedLimitKmh?:   number | null;  // matched OSM maxspeed, km/h (see Speed Limits)
}
```

## Route Model

```ts
interface Route {
  id:        string;       // crypto.randomUUID()
  name:      string;
  startTime: number;       // gpsTimestamp of first point
  endTime:   number;       // gpsTimestamp of last point
  points:    GeoPoint[];
  fuelTrips: FuelTrip[];   // empty until fuel data imported
}
```

## Storage

IndexedDB database `path-tracer` v1.

| Store      | Key      | Indexes    | Contents                    |
|------------|----------|------------|-----------------------------|
| `routes`   | `id`     | `startTime`| `Route` objects             |
| `settings` | `key`    | —          | `{ key, value }` pairs      |

Settings keys: `githubToken`.

## Statistics

All calculated from `GeoPoint[]` in `js/stats.js`.

| Metric          | Method                                              |
|-----------------|-----------------------------------------------------|
| Distance        | Haversine sum over consecutive points, metres       |
| Duration        | `last.gpsTimestamp − first.gpsTimestamp`, seconds   |
| Avg speed       | `distance / duration`, m/s → displayed as km/h     |
| Max speed       | Max per-segment `Δdist / Δtime`                     |
| Elevation gain  | Sum of positive `Δaltitude` between consecutive pts |
| Elevation loss  | Sum of absolute negative `Δaltitude`                |
| Min/max alt     | Min/max `altitude` across all points                |

## Replay

`js/replay.js` — `Replay` class.

Playback uses actual `gpsTimestamp` deltas divided by the speed multiplier to schedule each step via `setTimeout`. Minimum frame delay is 16 ms (≈60 fps).

```
delay = max(16, (nextPt.gpsTimestamp − curPt.gpsTimestamp) / speed)
```

Supported multipliers: 1×, 2×, 5×, 10×, 30×.

## Export

### JSON
Full `Route` object serialised with `JSON.stringify`, downloaded as `route-<id>.json`.

### GitHub Gist
`POST https://api.github.com/gists` with `Authorization: token <pat>`. Creates a **private** gist. Requires a PAT with `gist` scope, stored in IndexedDB settings.

## Citroën Fuel Import

### Input format
Tab-delimited, no header row expected (header row is skipped if `avg. consumption` is not a number).

Columns (in order):
1. `date` — `DD/MM/YYYY` or `YYYY-MM-DD`
2. `time of departure` — `HH:MM`
3. `time of arrival` — `HH:MM`
4. `time (hr:min)` — ignored
5. `address of departure`
6. `destination address`
7. `distance (mi)`
8. `mileage on odometer (mi)`
9. `avg. consumption (mpg)`
10. `price of fuel (GBP/l)`
11. `cost (GBP)`
12. `category`

### Trip → Route matching
A fuel trip matches a GPS route when the time ranges overlap:

```
trip.departureTs < route.endTime  AND  trip.arrivalTs > route.startTime
```

If `arrivalTs` is missing or unparseable, `departureTs + 1 hour` is used as a fallback.

### Efficiency segments
Matched trips are rendered as colour-coded polyline segments over the route. Colour is HSL with hue interpolated from 0° (red, worst mpg in the matched set) to 120° (green, best mpg):

```
hue = ((mpg − min) / (max − min)) × 120
color = hsl(hue, 90%, 50%)
```

Derived fields also computed per trip:
- `litersUsed = (distanceMi / mpg) × 4.54609`

## Speed Limits

`js/speedlimits.js`. On demand (per route), queries the Overpass API for OSM
`highway` ways tagged with `maxspeed` within the route's bounding box (+0.003°
padding):

```
[out:json][timeout:30];
way["highway"]["maxspeed"](south,west,north,east);
out geom;
```

`maxspeed` values are parsed to km/h (`"30 mph"` → `48.28`, `"50"` → `50`).
Unparseable values (e.g. `"national"`) are dropped.

### Matching

Each route point is matched to the nearest way segment via a ~150m grid
spatial index (`GRID_DEG = 0.0015`), checking the point's cell and its 8
neighbours. If the nearest segment is within `MATCH_THRESHOLD_M = 30`, its
`maxspeedKmh` is written to `point.speedLimitKmh`; otherwise `null`.

Results are persisted on the route (mutates `points[]` in place, then
`saveRoute`), so the Overpass query only needs to run once per route.

## Map Colour Views

`js/stats.js` → `buildColoredSegments(points, mode)` returns
`{ points: [a,b], color, point, speedKmh, chunkDistance? }[]`, rendered via
`MapManager.drawColoredSegments`. Each segment is independently clickable.

| Mode       | Colour rule |
|------------|-------------|
| `plain`    | Single blue polyline (no segmentation) |
| `absolute` | Per-point speed normalised to the route's min/max, hue 240° (blue, slowest) → 0° (red, fastest) |
| `relative` | `diff = speed − speedLimitKmh`. `diff ≤ −5`: blue→green (hue 240°→120°, scaled over −25..−5). `−5 < diff ≤ 5`: green (hue 120°). `diff > 5`: green→red (hue 120°→0°, scaled over 5..35). No limit data: grey (`hsl(0,0%,55%)`) |
| `pace`     | Points grouped into 60s chunks by `gpsTimestamp`. Each chunk's total distance normalised to the route's min/max chunk distance, hue 0° (red, least distance = traffic) → 120° (green, most distance) |

Speed used is `pointSpeedKmh()`: device-reported `point.speed` if present,
else haversine distance / time delta from the previous point.

## Point Details

Clicking any segment in a non-`plain` view opens a modal showing: GPS time,
elapsed time since route start, speed, matched speed limit (or "unknown"),
altitude, accuracy, heading, and (in `pace` mode) the distance covered in
that point's 60s chunk.

## 3D Terrain View

Selectable alongside the 2D map via "2D Map" / "3D Terrain" buttons. In 3D
mode the Leaflet map (`#map`) is hidden and a Three.js scene (`#view3d`,
`js/view3d.js`) renders the route as a coloured line in space:

- **Projection**: equirectangular local-meters, anchored at the route's first
  point. `x = (lng - lng0) * cos(lat0) * 111320`, `z = -(lat - lat0) * 111320`.
- **Height**: `y = (altitude - minAltitude) * heightMultiplier`, so the lowest
  point of the route sits on the ground plane.
- **Colour**: reuses the same segment colouring as the 2D "Map View" mode
  (`plain` maps to `absolute` speed colouring in 3D, since a flat colour line
  in 3D has no value); rendered as a vertex-coloured `THREE.LineSegments`.
- **Height Exaggeration**: buttons for 1×, 2×, 5×, 10×, 20×, 50× rebuild the
  route geometry with the new multiplier (camera is not refit on multiplier
  change, only on initial load/route switch).
- **Navigation**: `OrbitControls` (drag to rotate, scroll/pinch to zoom,
  damped). Camera auto-frames the route on first load based on its bounding
  box footprint.
- A `THREE.GridHelper` ground plane is drawn under the route for spatial
  reference.
- Switching back to "2D Map" disposes the Three.js renderer/scene and
  restores the Leaflet map.

## Map Provider Interface

`MapManager` (`js/map/index.js`) delegates all rendering to a provider. To add Google Maps or Mapbox, create a class implementing:

```ts
interface MapProvider {
  init(): Promise<void>;
  panTo(lat: number, lng: number): void;
  setUserMarker(lat: number, lng: number, accuracy?: number): void;
  addPolyline(points: GeoPoint[], opts: { color: string; weight: number; opacity: number }): Layer;
  addMarker(lat: number, lng: number, opts: { type?: 'replay' | 'pin' }): Marker;
  moveMarker(marker: Marker, lat: number, lng: number): void;
  bindTooltip(layer: Layer, text: string): void;
  removeLayer(layer: Layer | Marker): void;
  fitBounds(points: GeoPoint[]): void;
}
```

Pass the provider name string to `MapManager('map', 'yourprovider')` and register it in `js/map/index.js`'s `PROVIDERS` map.

## PWA

- Manifest: `manifest.json` — `display: standalone`, `orientation: any`, SVG icons
- Service worker: `sw.js` — cache-first strategy, precaches all app assets and Leaflet CDN files
- iOS: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`
- Safe area insets applied via `env(safe-area-inset-*)` throughout CSS

## UI States

| State       | FAB label | Sheet | Live bar |
|-------------|-----------|-------|----------|
| Idle        | ▶         | peek  | hidden   |
| Tracking    | ⏹         | peek  | visible  |
| Route view  | ▶         | peek  | hidden   |
| Replay      | ▶         | peek  | hidden   |

Sheet states: `collapsed` (80 px visible) → `peek` (280 px) → `expanded` (full height). Toggled by tapping the handle or swiping.
