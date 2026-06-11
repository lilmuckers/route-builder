import { MapManager } from './map/index.js';
import { Tracker } from './tracker.js';
import { Replay } from './replay.js';
import { calcStats, fmtDistance, fmtSpeed, fmtDuration, fmtAlt, fmtTime, pointSpeedKmh, buildColoredSegments } from './stats.js';
import { saveRoute, getRoute, getAllRoutes, deleteRoute, getSetting, setSetting } from './storage.js';
import { exportJSON, exportGist } from './export.js';
import { parseFuelCSV, matchFuelToRoute, buildEfficiencySegments } from './fuel.js';
import { fetchSpeedLimits, matchSpeedLimits } from './speedlimits.js';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  tracking: false,
  selectedRoute: null,
  replayActive: false,
  routes: [],
  activeTab: 'routes',
  sheetState: 'peek', // 'collapsed' | 'peek' | 'expanded'
  mapView: 'plain', // 'plain' | 'absolute' | 'relative' | 'pace'
};

let mapMgr, tracker, replay, wakeLock;

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  mapMgr = new MapManager('map', 'leaflet');
  await mapMgr.init();

  mapMgr.provider.map.on('user-dragged', () => {
    if (state.tracking) mapMgr.setFollowUser(false);
  });

  setupSheetGestures();
  setupTabs();
  setupFab();
  setupSettingsModal();

  await loadRoutes();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  tryGetInitialLocation();
}

function tryGetInitialLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => mapMgr.provider.map.setView([pos.coords.latitude, pos.coords.longitude], 15),
    () => {}
  );
}

// ─── Routes ───────────────────────────────────────────────────────────────────

async function loadRoutes() {
  state.routes = await getAllRoutes();
  state.routes.sort((a, b) => b.startTime - a.startTime);
  renderRoutesList();
}

function renderRoutesList() {
  const el = document.getElementById('routes-list');
  if (!state.routes.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🗺️</div>
      <p>No saved routes yet.<br>Tap the button below to start tracking.</p>
    </div>`;
    return;
  }

  el.innerHTML = state.routes.map(r => {
    const stats = calcStats(r.points);
    const date = new Date(r.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const isSelected = state.selectedRoute?.id === r.id;
    return `<div class="route-item${isSelected ? ' selected' : ''}" data-id="${r.id}">
      <div class="route-name">${escHtml(r.name)}</div>
      <div class="route-meta">
        <span>${date}</span>
        <span>${fmtDistance(stats.distance)}</span>
        <span>${fmtDuration(stats.duration)}</span>
        ${r.fuelTrips?.length ? '<span>⛽ fuel</span>' : ''}
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.route-item').forEach(el => {
    el.addEventListener('click', () => selectRoute(el.dataset.id));
  });
}

async function selectRoute(id) {
  const route = await getRoute(id);
  state.selectedRoute = route;
  state.mapView = 'plain';
  setTab('stats');
  mapMgr.clearAll();
  renderMapView(route);
  mapMgr.fitRoute(route.points);
  mapMgr.setFollowUser(false);

  if (route.fuelTrips?.length) {
    const segments = buildEfficiencySegments(route, route.fuelTrips);
    mapMgr.drawFuelSegments(segments);
  }

  renderStatsPanel();
  setSheetState('peek');
  renderRoutesList();
}

function renderMapView(route) {
  mapMgr.clearTrack('track');
  mapMgr.clearTrack('track-colored');
  if (state.mapView === 'plain') {
    mapMgr.drawTrack(route.points, 'track');
  } else {
    const segments = buildColoredSegments(route.points, state.mapView);
    mapMgr.drawColoredSegments(segments, 'track-colored', seg => showPointDetails(seg, route));
  }
}

// ─── Tracking ─────────────────────────────────────────────────────────────────

function setupFab() {
  const fab = document.getElementById('fab');
  fab.addEventListener('click', () => {
    if (state.tracking) stopTracking();
    else startTracking();
  });
}

function startTracking() {
  if (!navigator.geolocation) {
    toast('Geolocation not supported on this device.');
    return;
  }

  state.tracking = true;
  state.selectedRoute = null;
  mapMgr.clearAll();
  mapMgr.setFollowUser(true);

  const fab = document.getElementById('fab');
  fab.textContent = '⏹';
  fab.classList.add('tracking');
  document.getElementById('rec-indicator').classList.add('active');
  document.getElementById('live-stats').classList.add('active');

  setTab('live');

  tracker = new Tracker({
    onPoint: (pt, points) => {
      mapMgr.updateUserLocation(pt.lat, pt.lng);
      mapMgr.drawTrack(points);
      renderLiveStats(points);
    },
    onError: err => {
      toast(geoErrMsg(err));
      stopTracking();
    },
  });

  tracker.start();
  acquireWakeLock();
}

async function stopTracking() {
  const points = tracker ? tracker.stop() : [];
  state.tracking = false;

  const fab = document.getElementById('fab');
  fab.textContent = '▶';
  fab.classList.remove('tracking');
  document.getElementById('rec-indicator').classList.remove('active');
  document.getElementById('live-stats').classList.remove('active');
  document.getElementById('live-panel-idle').style.display = '';
  document.getElementById('live-panel-active').style.display = 'none';
  releaseWakeLock();

  if (points.length < 2) {
    toast('Too few points recorded.');
    return;
  }

  const name = await promptRouteName();
  if (name === null) return;

  const route = {
    id: crypto.randomUUID(),
    name: name || `Route ${new Date().toLocaleDateString()}`,
    startTime: points[0].gpsTimestamp,
    endTime: points[points.length - 1].gpsTimestamp,
    points,
    fuelTrips: [],
  };

  await saveRoute(route);
  await loadRoutes();
  await selectRoute(route.id);
}

// ─── Live stats ───────────────────────────────────────────────────────────────

function renderLiveStats(points) {
  const stats = calcStats(points);
  const last = points[points.length - 1];
  const spd = last.speed != null ? fmtSpeed(last.speed) : fmtSpeed(stats.avgSpeed);

  // top bar mini stats
  setLiveStat('live-speed', spd);
  setLiveStat('live-dist', fmtDistance(stats.distance));
  setLiveStat('live-dur', fmtDuration(stats.duration));
  setLiveStat('live-alt', fmtAlt(last.altitude));
  setLiveStat('live-acc', last.accuracy != null ? `±${Math.round(last.accuracy)}m` : 'n/a');

  // live tab full cards
  document.getElementById('live-panel-idle').style.display = 'none';
  document.getElementById('live-panel-active').style.display = 'block';
  setLiveStat('live2-speed', spd);
  setLiveStat('live2-dist', fmtDistance(stats.distance));
  setLiveStat('live2-dur', fmtDuration(stats.duration));
  setLiveStat('live2-alt', fmtAlt(last.altitude));
  setLiveStat('live2-hdg', last.heading != null ? `${Math.round(last.heading)}°` : 'n/a');
  setLiveStat('live2-acc', last.accuracy != null ? `±${Math.round(last.accuracy)}m` : 'n/a');
  setLiveStat('live2-pts', String(points.length));
  setLiveStat('live2-maxspd', fmtSpeed(stats.maxSpeed));
}

function setLiveStat(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ─── Stats panel ──────────────────────────────────────────────────────────────

function renderStatsPanel() {
  const route = state.selectedRoute;
  if (!route) return;

  const stats = calcStats(route.points);
  const panel = document.getElementById('stats-panel');

  panel.innerHTML = `
    <div class="route-name" style="font-size:17px;font-weight:700;margin-bottom:4px">${escHtml(route.name)}</div>
    <div class="route-meta" style="margin-bottom:14px">
      ${new Date(route.startTime).toLocaleString()}
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card-label">Distance</div>
        <div class="stat-card-val">${fmtDistance(stats.distance)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Duration</div>
        <div class="stat-card-val">${fmtDuration(stats.duration)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Avg Speed</div>
        <div class="stat-card-val">${fmtSpeed(stats.avgSpeed)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Max Speed</div>
        <div class="stat-card-val">${fmtSpeed(stats.maxSpeed)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Elev Gain</div>
        <div class="stat-card-val">${fmtAlt(stats.elevGain)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Elev Loss</div>
        <div class="stat-card-val">${fmtAlt(stats.elevLoss)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Min Alt</div>
        <div class="stat-card-val">${fmtAlt(stats.minAlt)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Max Alt</div>
        <div class="stat-card-val">${fmtAlt(stats.maxAlt)}</div>
      </div>
    </div>

    <div class="divider"></div>
    <div class="section-title">Map View</div>
    <div class="view-btns">
      ${[
        ['plain', 'Plain'],
        ['absolute', 'Speed'],
        ['relative', 'vs Limit'],
        ['pace', 'Traffic'],
      ].map(([key, label]) => `<button class="view-btn${state.mapView === key ? ' active' : ''}" data-view="${key}">${label}</button>`).join('')}
    </div>
    ${renderViewLegend(state.mapView)}
    ${!route.points.some(p => p.speedLimitKmh != null) ? '<button class="btn btn-ghost btn-sm" id="btn-fetch-limits">📍 Fetch Speed Limits</button>' : `<div style="font-size:12px;color:var(--text2)">Speed limits: ${route.points.filter(p=>p.speedLimitKmh!=null).length}/${route.points.length} points matched. <button class="btn btn-ghost btn-sm" id="btn-fetch-limits">↻ Refetch</button></div>`}

    <div id="replay-controls" class="replay-controls-hidden">
      <div class="replay-header">Replay</div>
      <div class="replay-row">
        <button class="btn btn-ghost btn-sm" id="replay-playpause">▶ Play</button>
        <button class="btn btn-ghost btn-sm" id="replay-stop">⏹ Stop</button>
        <div class="replay-progress"><div class="replay-progress-fill" id="replay-fill" style="width:0%"></div></div>
      </div>
      <div class="replay-row">
        <span style="font-size:12px;color:var(--text2)">Speed:</span>
        <div class="speed-btns">
          ${[1,2,5,10,30].map(s => `<button class="speed-btn${s===1?' active':''}" data-speed="${s}">${s}×</button>`).join('')}
        </div>
      </div>
    </div>

    <div class="divider"></div>
    <div class="section-title">Actions</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <button class="btn btn-primary btn-sm" id="btn-replay">▶ Replay</button>
      <button class="btn btn-ghost btn-sm" id="btn-export-json">⬇ JSON</button>
      <button class="btn btn-ghost btn-sm" id="btn-export-gist">⬆ Gist</button>
      <button class="btn btn-ghost btn-sm" id="btn-import-fuel">⛽ Fuel</button>
      <button class="btn btn-danger btn-sm" id="btn-delete">🗑 Delete</button>
    </div>

    ${renderFuelSection(route)}
  `;

  setupStatsActions(route, stats);
}

function renderViewLegend(mode) {
  const bars = {
    plain: null,
    absolute: { stops: ['hsl(240,85%,50%)', 'hsl(0,85%,50%)'], left: 'Slow', right: 'Fast' },
    relative: { stops: ['hsl(240,85%,50%)', 'hsl(120,85%,50%)', 'hsl(0,85%,50%)'], left: 'Under limit', right: 'Over limit' },
    pace: { stops: ['hsl(0,85%,50%)', 'hsl(120,85%,50%)'], left: 'Slow (traffic)', right: 'Fast' },
  };
  const bar = bars[mode];
  if (!bar) return '';
  return `<div class="view-legend">
    <div class="view-legend-bar" style="background:linear-gradient(to right,${bar.stops.join(',')})"></div>
    <div class="view-legend-labels"><span>${bar.left}</span><span>${bar.right}</span></div>
  </div>`;
}

function showPointDetails(seg, route) {
  const p = seg.point;
  const idx = route.points.indexOf(p);
  const elapsedS = (p.gpsTimestamp - route.points[0].gpsTimestamp) / 1000;
  const speedKmh = seg.speedKmh ?? pointSpeedKmh(route.points, idx);

  openModal('Point Details', `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-card-label">Time</div><div class="stat-card-val">${fmtTime(p.gpsTimestamp)}</div></div>
      <div class="stat-card"><div class="stat-card-label">Elapsed</div><div class="stat-card-val">${fmtDuration(elapsedS)}</div></div>
      <div class="stat-card"><div class="stat-card-label">Speed</div><div class="stat-card-val">${fmtSpeed(speedKmh / 3.6)}</div></div>
      <div class="stat-card"><div class="stat-card-label">Speed Limit</div><div class="stat-card-val">${p.speedLimitKmh != null ? Math.round(p.speedLimitKmh) + ' km/h' : 'unknown'}</div></div>
      <div class="stat-card"><div class="stat-card-label">Altitude</div><div class="stat-card-val">${fmtAlt(p.altitude)}</div></div>
      <div class="stat-card"><div class="stat-card-label">Accuracy</div><div class="stat-card-val">${p.accuracy != null ? '±' + Math.round(p.accuracy) + 'm' : 'n/a'}</div></div>
      <div class="stat-card"><div class="stat-card-label">Heading</div><div class="stat-card-val">${p.heading != null ? Math.round(p.heading) + '°' : 'n/a'}</div></div>
      ${seg.chunkDistance != null ? `<div class="stat-card"><div class="stat-card-label">Min. Distance</div><div class="stat-card-val">${fmtDistance(seg.chunkDistance)}</div></div>` : ''}
    </div>
  `);
}

function renderFuelSection(route) {
  if (!route.fuelTrips?.length) return '';
  const trips = route.fuelTrips;
  const allMpg = trips.map(t => t.mpg);
  const minMpg = Math.min(...allMpg);
  const maxMpg = Math.max(...allMpg);
  const segs = buildEfficiencySegments(route, trips);

  return `<div class="fuel-section">
    <h3>Fuel Efficiency</h3>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:12px">
      <span style="color:hsl(0,90%,50%)">■ ${minMpg.toFixed(1)} mpg</span>
      <div style="flex:1;height:6px;border-radius:3px;background:linear-gradient(to right,hsl(0,90%,50%),hsl(120,90%,45%))"></div>
      <span style="color:hsl(120,90%,45%)">■ ${maxMpg.toFixed(1)} mpg</span>
    </div>
    ${segs.map(s => `<div class="fuel-trip-item">
      <div class="fuel-trip-header">
        <div class="fuel-color-swatch" style="background:${s.color}"></div>
        <strong>${s.trip.mpg.toFixed(1)} mpg</strong>
        <span style="color:var(--text2)">${s.trip.distanceMi.toFixed(1)} mi</span>
        <span style="color:var(--text2)">£${s.trip.costGBP?.toFixed(2) ?? '?'}</span>
      </div>
      <div class="fuel-trip-route">${escHtml(s.trip.depAddr)} → ${escHtml(s.trip.destAddr)}</div>
    </div>`).join('')}
  </div>`;
}

function setupStatsActions(route, stats) {
  document.getElementById('btn-replay')?.addEventListener('click', () => startReplay(route));
  document.getElementById('btn-export-json')?.addEventListener('click', () => exportJSON(route));
  document.getElementById('btn-export-gist')?.addEventListener('click', async () => {
    try {
      const url = await exportGist(route);
      toast(`Gist created! Opening…`);
      window.open(url, '_blank');
    } catch (e) {
      toast(e.message);
    }
  });
  document.getElementById('btn-import-fuel')?.addEventListener('click', () => openFuelImport(route));
  document.getElementById('btn-delete')?.addEventListener('click', async () => {
    if (!confirm(`Delete "${route.name}"?`)) return;
    await deleteRoute(route.id);
    state.selectedRoute = null;
    mapMgr.clearAll();
    setTab('routes');
    await loadRoutes();
  });

  document.getElementById('replay-playpause')?.addEventListener('click', toggleReplayPlayPause);
  document.getElementById('replay-stop')?.addEventListener('click', stopReplay);

  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (replay) replay.setSpeed(Number(btn.dataset.speed));
    });
  });

  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mapView = btn.dataset.view;
      if (state.mapView === 'relative' && !route.points.some(p => p.speedLimitKmh != null)) {
        toast('Fetch speed limits to use this view.');
      }
      renderStatsPanel();
      renderMapView(route);
    });
  });

  document.getElementById('btn-fetch-limits')?.addEventListener('click', async () => {
    toast('Fetching speed limits…');
    try {
      const ways = await fetchSpeedLimits(route.points);
      matchSpeedLimits(route.points, ways);
      await saveRoute(route);
      const matched = route.points.filter(p => p.speedLimitKmh != null).length;
      toast(`${matched}/${route.points.length} points matched.`);
      renderStatsPanel();
      renderMapView(route);
    } catch (e) {
      toast('Speed limit fetch failed: ' + e.message);
    }
  });
}

// ─── Replay ───────────────────────────────────────────────────────────────────

function startReplay(route) {
  if (replay) stopReplay();

  state.replayActive = true;
  document.getElementById('replay-controls').classList.remove('replay-controls-hidden');
  const playPauseBtn = document.getElementById('replay-playpause');
  if (playPauseBtn) playPauseBtn.textContent = '⏸ Pause';

  const speed = Number(document.querySelector('.speed-btn.active')?.dataset.speed ?? 1);

  replay = new Replay({
    points: route.points,
    onTick: (pt, idx, total) => {
      mapMgr.setReplayMarker(pt.lat, pt.lng);
      const fill = document.getElementById('replay-fill');
      if (fill) fill.style.width = `${(idx / (total - 1)) * 100}%`;
    },
    onDone: () => {
      state.replayActive = false;
      if (playPauseBtn) playPauseBtn.textContent = '▶ Play';
      mapMgr.clearReplayMarker();
    },
  });

  replay.start(speed);
}

function toggleReplayPlayPause() {
  if (!replay) return;
  const btn = document.getElementById('replay-playpause');
  if (replay.paused) {
    replay.resume();
    if (btn) btn.textContent = '⏸ Pause';
  } else {
    replay.pause();
    if (btn) btn.textContent = '▶ Play';
  }
}

function stopReplay() {
  if (replay) { replay.stop(); replay = null; }
  state.replayActive = false;
  mapMgr.clearReplayMarker();
  const fill = document.getElementById('replay-fill');
  if (fill) fill.style.width = '0%';
  const btn = document.getElementById('replay-playpause');
  if (btn) btn.textContent = '▶ Play';
}

// ─── Fuel import ──────────────────────────────────────────────────────────────

function openFuelImport(route) {
  openModal('Import Fuel Data', `
    <p style="color:var(--text2);font-size:13px;margin-bottom:16px">
      Upload the tab-delimited CSV exported from the Citroën app.
      Trips will be matched to this route by time.
    </p>
    <div class="field">
      <label>Citroën Export File (.csv)</label>
      <input type="file" id="fuel-file" accept=".csv,.txt" style="padding:8px 0;border:none;background:none;color:var(--text)">
    </div>
    <button class="btn btn-primary" id="btn-fuel-import-confirm">Import</button>
  `);

  document.getElementById('btn-fuel-import-confirm').addEventListener('click', async () => {
    const file = document.getElementById('fuel-file').files[0];
    if (!file) { toast('Select a file first.'); return; }

    const text = await file.text();
    const trips = parseFuelCSV(text);

    if (!trips.length) { toast('No valid trips found in file.'); return; }

    const matched = matchFuelToRoute(route, trips);
    if (!matched.length) {
      toast(`No trips matched this route's time window. (${trips.length} trips parsed)`);
      return;
    }

    route.fuelTrips = matched;
    await saveRoute(route);
    state.selectedRoute = route;

    const segments = buildEfficiencySegments(route, matched);
    mapMgr.drawFuelSegments(segments);

    closeModal();
    renderStatsPanel();
    toast(`${matched.length} fuel trip(s) matched.`);
  });
}

// ─── Settings modal ───────────────────────────────────────────────────────────

function setupSettingsModal() {
  document.getElementById('btn-settings').addEventListener('click', async () => {
    const token = await getSetting('githubToken') ?? '';
    openModal('Settings', `
      <div class="field">
        <label>GitHub Token (for Gist export)</label>
        <input type="password" id="setting-gh-token" value="${escHtml(token)}" placeholder="ghp_…" autocomplete="off">
      </div>
      <button class="btn btn-primary" id="btn-settings-save">Save</button>

      <div class="divider"></div>
      <div class="section-title">App</div>
      <button class="btn btn-danger" id="btn-clear-cache">⟳ Clear Cache & Reload</button>
    `);

    document.getElementById('btn-settings-save').addEventListener('click', async () => {
      const t = document.getElementById('setting-gh-token').value.trim();
      await setSetting('githubToken', t);
      closeModal();
      toast('Settings saved.');
    });

    document.getElementById('btn-clear-cache').addEventListener('click', clearCacheAndReload);
  });
}

async function clearCacheAndReload() {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  }
  location.reload(true);
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function openModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function setupTabs() {
  document.querySelectorAll('.sheet-tab').forEach(tab => {
    tab.addEventListener('click', () => setTab(tab.dataset.tab));
  });
}

function setTab(name) {
  state.activeTab = name;
  document.querySelectorAll('.sheet-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.style.display = p.dataset.panel === name ? 'block' : 'none';
  });
  if (name !== 'collapsed') setSheetState('peek');
}

// ─── Sheet gestures ───────────────────────────────────────────────────────────

function setupSheetGestures() {
  const sheet = document.getElementById('bottom-sheet');
  const handleArea = document.getElementById('sheet-handle-area');

  let startY = 0;
  let startState = 'peek';

  handleArea.addEventListener('click', () => {
    cycleSheetState();
  });

  handleArea.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
    startState = state.sheetState;
  }, { passive: true });

  handleArea.addEventListener('touchend', e => {
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dy) < 10) { cycleSheetState(); return; }
    if (dy < -40) {
      setSheetState(startState === 'collapsed' ? 'peek' : 'expanded');
    } else if (dy > 40) {
      setSheetState(startState === 'expanded' ? 'peek' : 'collapsed');
    }
  }, { passive: true });
}

function cycleSheetState() {
  const next = { collapsed: 'peek', peek: 'expanded', expanded: 'collapsed' };
  setSheetState(next[state.sheetState]);
}

function setSheetState(s) {
  state.sheetState = s;
  const sheet = document.getElementById('bottom-sheet');
  const fab = document.getElementById('fab');
  const liveStats = document.getElementById('live-stats');
  sheet.classList.toggle('collapsed', s === 'collapsed');
  sheet.classList.toggle('expanded', s === 'expanded');
  fab.classList.toggle('sheet-collapsed', s === 'collapsed');
  liveStats.classList.toggle('sheet-collapsed', s === 'collapsed');
}

// ─── Route name prompt ────────────────────────────────────────────────────────

function promptRouteName() {
  return new Promise(resolve => {
    openModal('Save Route', `
      <div class="field">
        <label>Route Name</label>
        <input type="text" id="route-name-input" value="${new Date().toLocaleDateString()}" placeholder="Route name">
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-primary" id="btn-name-save">Save</button>
        <button class="btn btn-ghost" id="btn-name-discard">Discard</button>
      </div>
    `);

    document.getElementById('btn-name-save').addEventListener('click', () => {
      const name = document.getElementById('route-name-input').value.trim();
      closeModal();
      resolve(name);
    });
    document.getElementById('btn-name-discard').addEventListener('click', () => {
      closeModal();
      resolve(null);
    });
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let _toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function geoErrMsg(err) {
  const msgs = {
    1: 'Location permission denied.',
    2: 'Location unavailable.',
    3: 'Location request timed out.',
  };
  return msgs[err.code] ?? 'Location error.';
}

// ─── Wake Lock ────────────────────────────────────────────────────────────────

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    document.getElementById('wakelock-indicator').classList.add('active');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      document.getElementById('wakelock-indicator').classList.remove('active');
    });
  } catch (e) {
    // permission denied or not supported — silent, tracking still works
  }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
}

// Re-acquire after a phone call or brief interruption returns the page to foreground
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.tracking && !wakeLock) {
    acquireWakeLock();
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

document.getElementById('modal-overlay')?.addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});
