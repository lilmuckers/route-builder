# Path Tracer

GPS route tracking PWA. Records, replays, and analyses drives. Overlays Citroën fuel efficiency data onto routes.

**Live:** https://pages.patrick-mckinley.com

## Features

- **Live tracking** — high-accuracy GPS via `watchPosition`, logs every point with lat/lng/altitude/accuracy/heading/speed/GPS timestamp/device timestamp
- **Route map** — Leaflet + OpenStreetMap, route drawn in real time
- **Saved routes** — IndexedDB storage, indexed by start time
- **Statistics** — distance, duration, avg/max speed, elevation gain/loss, min/max altitude
- **Replay** — animates a saved route at 1×/2×/5×/10×/30× real time
- **Export** — download as JSON or push to a private GitHub Gist
- **Fuel overlay** — import Citroën app TSV export, match trips to route by time, colour-code segments by mpg (red → green)
- **PWA** — installable, service worker caches all assets for offline use

## Stack

No build tooling. Vanilla ES modules, Leaflet 1.9, IndexedDB.

```
index.html          app shell
sw.js               service worker
css/app.css         all styles (dark, mobile-first)
js/
  app.js            UI orchestration and state
  storage.js        IndexedDB wrapper (routes + settings)
  tracker.js        GPS Tracker class
  stats.js          haversine distance, speed, elevation calc
  replay.js         timestamp-accurate route replay
  export.js         JSON download + GitHub Gist POST
  fuel.js           Citroën TSV parser, trip matcher, segment builder
  map/
    index.js        MapManager — provider-agnostic interface
    leaflet-provider.js   Leaflet implementation
```

## Adding a map provider

Implement the interface used by `LeafletProvider` (see [SPEC.md](SPEC.md#map-provider-interface)) and pass the provider name to `MapManager`:

```js
const map = new MapManager('map', 'google'); // once GoogleProvider exists
```

## Deployment

GitHub Actions deploys `main` to GitHub Pages on every push. See [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

## Settings

Tap ⚙ in the top-right to set a GitHub personal access token (needs `gist` scope) for Gist export.

## Citroën fuel import

Export trips from the MyCitroën app. The expected format is tab-delimited with columns:

```
date  time of departure  time of arrival  time (hr:min)
address of departure  destination address  distance (mi)
mileage on odometer (mi)  avg. consumption (mpg)
price of fuel (GBP/l)  cost (GBP)  category
```

Trips are matched to a GPS route by time overlap. Matched segments are drawn as a separate colour-coded polyline layer over the base route.
