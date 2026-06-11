export class LeafletProvider {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this._userMarker = null;
    this._userCircle = null;
  }

  async init() {
    await this._waitForLeaflet();
    this.map = L.map(this.containerId, {
      zoomControl: false,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(this.map);

    L.control.zoom({ position: 'topright' }).addTo(this.map);

    this.map.setView([51.505, -0.09], 13);

    this.map.on('dragstart', () => {
      this.map.fire('user-dragged');
    });
  }

  _waitForLeaflet() {
    return new Promise(resolve => {
      const check = () => typeof L !== 'undefined' ? resolve() : setTimeout(check, 50);
      check();
    });
  }

  panTo(lat, lng) {
    this.map.panTo([lat, lng]);
  }

  setUserMarker(lat, lng, accuracy) {
    if (!this._userMarker) {
      const icon = L.divIcon({
        className: '',
        html: '<div class="user-dot"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      this._userMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(this.map);
      if (accuracy) {
        this._userCircle = L.circle([lat, lng], { radius: accuracy, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 1 }).addTo(this.map);
      }
    } else {
      this._userMarker.setLatLng([lat, lng]);
      if (this._userCircle && accuracy) this._userCircle.setLatLng([lat, lng]).setRadius(accuracy);
    }
  }

  addPolyline(points, opts = {}) {
    const latlngs = points.map(p => [p.lat, p.lng]);
    return L.polyline(latlngs, {
      color: opts.color ?? '#3b82f6',
      weight: opts.weight ?? 4,
      opacity: opts.opacity ?? 0.85,
    }).addTo(this.map);
  }

  addMarker(lat, lng, opts = {}) {
    const isReplay = opts.type === 'replay';
    const icon = L.divIcon({
      className: '',
      html: isReplay
        ? '<div class="replay-dot"></div>'
        : '<div class="pin-dot"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    return L.marker([lat, lng], { icon }).addTo(this.map);
  }

  moveMarker(marker, lat, lng) {
    marker.setLatLng([lat, lng]);
  }

  onLayerClick(layer, cb) {
    layer.on('click', e => {
      L.DomEvent.stopPropagation(e);
      cb(e.latlng);
    });
  }

  bindTooltip(layer, text) {
    layer.bindTooltip(text.replace('\n', '<br>'), { sticky: true });
  }

  removeLayer(layer) {
    if (layer && this.map.hasLayer(layer)) this.map.removeLayer(layer);
  }

  fitBounds(points) {
    const latlngs = points.map(p => [p.lat, p.lng]);
    this.map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
  }
}
