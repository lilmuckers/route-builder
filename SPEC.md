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
