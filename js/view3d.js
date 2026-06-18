const M_PER_DEG_LAT = 111320;

export class View3D {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.heightMultiplier = 1;
    this.showUncertainty = false;
    this._points = null;
    this._segments = null;
    this._routeGroup = null;
  }

  init() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f172a);

    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 200000);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.5);
    dir.position.set(1, 1, 1);
    this.scene.add(dir);

    this._onResize = () => {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this._onResize);

    this._animate = () => {
      this._raf = requestAnimationFrame(this._animate);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    this._animate();
  }

  setRoute(segments, points) {
    this._segments = segments;
    this._points = points;
    this._buildRoute(true);
  }

  setHeightMultiplier(m) {
    this.heightMultiplier = m;
    this._buildRoute(false);
  }

  _toXYZ(p, lat0, lng0, minAlt) {
    const x = (p.lng - lng0) * Math.cos(lat0 * Math.PI / 180) * M_PER_DEG_LAT;
    const z = -(p.lat - lat0) * M_PER_DEG_LAT;
    const y = ((p.altitude ?? minAlt) - minAlt) * this.heightMultiplier;
    return new THREE.Vector3(x, y, z);
  }

  _buildRoute(refit) {
    if (this._routeGroup) {
      this.scene.remove(this._routeGroup);
      this._routeGroup.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this._routeGroup = null;
    }

    const points = this._points;
    if (!points || points.length < 2) return;

    const lat0 = points[0].lat;
    const lng0 = points[0].lng;
    const altitudes = points.map(p => p.altitude ?? 0);
    const minAlt = Math.min(...altitudes);

    const group = new THREE.Group();
    const positions = [];
    const colors = [];
    const colorObj = new THREE.Color();

    for (const seg of this._segments) {
      const a = this._toXYZ(seg.points[0], lat0, lng0, minAlt);
      const b = this._toXYZ(seg.points[1], lat0, lng0, minAlt);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      colorObj.set(seg.color);
      colors.push(colorObj.r, colorObj.g, colorObj.b, colorObj.r, colorObj.g, colorObj.b);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 });
    group.add(new THREE.LineSegments(geom, mat));

    const allXYZ = points.map(p => this._toXYZ(p, lat0, lng0, minAlt));
    const xs = allXYZ.map(p => p.x);
    const zs = allXYZ.map(p => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const size = Math.max(maxX - minX, maxZ - minZ, 50);
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;

    const grid = new THREE.GridHelper(size * 1.4, 20, 0x334155, 0x1e293b);
    grid.position.set(centerX, 0, centerZ);
    group.add(grid);

    if (this.showUncertainty) {
      // Altitude uncertainty: semi-transparent vertical quads around each segment
      const uPositions = [];
      const uColors = [];
      const uIndices = [];
      const uColor = new THREE.Color(0x60a5fa);
      let vi = 0;

      for (const seg of this._segments) {
        const p0 = seg.points[0], p1 = seg.points[1];
        const altAcc0 = (p0.altitudeAccuracy ?? 0) * this.heightMultiplier;
        const altAcc1 = (p1.altitudeAccuracy ?? 0) * this.heightMultiplier;
        const a = this._toXYZ(p0, lat0, lng0, minAlt);
        const b = this._toXYZ(p1, lat0, lng0, minAlt);

        // 4 corners: bottom-a, top-a, top-b, bottom-b
        uPositions.push(
          a.x, a.y - altAcc0, a.z,
          a.x, a.y + altAcc0, a.z,
          b.x, b.y + altAcc1, b.z,
          b.x, b.y - altAcc1, b.z,
        );
        for (let c = 0; c < 4; c++) uColors.push(uColor.r, uColor.g, uColor.b);
        uIndices.push(vi, vi+1, vi+2, vi, vi+2, vi+3);
        vi += 4;

        // Horizontal GPS accuracy: flat ground-level quads perpendicular to track
        const acc0 = (p0.accuracy ?? 0);
        const acc1 = (p1.accuracy ?? 0);
        if (acc0 > 0 || acc1 > 0) {
          const dx = b.x - a.x, dz = b.z - a.z;
          const len = Math.hypot(dx, dz) || 1;
          const px = -dz / len, pz = dx / len; // perpendicular in xz plane
          uPositions.push(
            a.x + px * acc0, a.y, a.z + pz * acc0,
            a.x - px * acc0, a.y, a.z - pz * acc0,
            b.x - px * acc1, b.y, b.z - pz * acc1,
            b.x + px * acc1, b.y, b.z + pz * acc1,
          );
          for (let c = 0; c < 4; c++) uColors.push(uColor.r, uColor.g, uColor.b);
          uIndices.push(vi, vi+1, vi+2, vi, vi+2, vi+3);
          vi += 4;
        }
      }

      if (uPositions.length) {
        const uGeom = new THREE.BufferGeometry();
        uGeom.setAttribute('position', new THREE.Float32BufferAttribute(uPositions, 3));
        uGeom.setAttribute('color', new THREE.Float32BufferAttribute(uColors, 3));
        uGeom.setIndex(uIndices);
        const uMat = new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        group.add(new THREE.Mesh(uGeom, uMat));
      }
    }

    this.scene.add(group);
    this._routeGroup = group;

    if (refit) {
      const dist = size * 0.9 + 50;
      this.camera.position.set(centerX, dist * 0.6, centerZ + dist);
      this.controls.target.set(centerX, 0, centerZ);
      this.controls.update();
    }
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    if (this._routeGroup) {
      this._routeGroup.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.controls?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}
