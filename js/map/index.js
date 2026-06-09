import { LeafletProvider } from './leaflet-provider.js';

const PROVIDERS = {
  leaflet: LeafletProvider,
};

export class MapManager {
  constructor(containerId, providerName = 'leaflet') {
    const Provider = PROVIDERS[providerName];
    if (!Provider) throw new Error(`Unknown map provider: ${providerName}`);
    this.provider = new Provider(containerId);
    this._layers = new Map();
    this._trackLayerId = null;
    this._replayMarker = null;
    this._fuelLayers = [];
    this._followUser = true;
  }

  async init() {
    await this.provider.init();
  }

  setFollowUser(val) {
    this._followUser = val;
  }

  updateUserLocation(lat, lng) {
    this.provider.setUserMarker(lat, lng);
    if (this._followUser) this.provider.panTo(lat, lng);
  }

  drawTrack(points, id = 'track', color = '#3b82f6', weight = 4) {
    if (this._layers.has(id)) {
      this.provider.removeLayer(this._layers.get(id));
    }
    if (!points.length) return;
    const layer = this.provider.addPolyline(points, { color, weight, opacity: 0.85 });
    this._layers.set(id, layer);
    return layer;
  }

  clearTrack(id = 'track') {
    if (this._layers.has(id)) {
      this.provider.removeLayer(this._layers.get(id));
      this._layers.delete(id);
    }
  }

  drawFuelSegments(segments) {
    this._fuelLayers.forEach(l => this.provider.removeLayer(l));
    this._fuelLayers = [];
    for (const seg of segments) {
      const layer = this.provider.addPolyline(seg.segment, {
        color: seg.color,
        weight: 7,
        opacity: 0.9,
      });
      this.provider.bindTooltip(layer,
        `${seg.trip.mpg.toFixed(1)} mpg\n${seg.trip.depAddr} → ${seg.trip.destAddr}`
      );
      this._fuelLayers.push(layer);
    }
  }

  clearFuelSegments() {
    this._fuelLayers.forEach(l => this.provider.removeLayer(l));
    this._fuelLayers = [];
  }

  setReplayMarker(lat, lng) {
    if (!this._replayMarker) {
      this._replayMarker = this.provider.addMarker(lat, lng, { type: 'replay' });
    } else {
      this.provider.moveMarker(this._replayMarker, lat, lng);
    }
    this.provider.panTo(lat, lng);
  }

  clearReplayMarker() {
    if (this._replayMarker) {
      this.provider.removeLayer(this._replayMarker);
      this._replayMarker = null;
    }
  }

  fitRoute(points) {
    if (points.length) this.provider.fitBounds(points);
  }

  clearAll() {
    this._layers.forEach(l => this.provider.removeLayer(l));
    this._layers.clear();
    this.clearFuelSegments();
    this.clearReplayMarker();
  }
}
