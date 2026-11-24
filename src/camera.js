import * as THREE from 'three';
import { clamp } from './rng.js';

// Tilted top-down strategy camera. Tilt is measured from straight down (DisplayXR's
// groundPlaneRig convention): the map plane is tilted about the glass, its centre stays on the
// zero-disparity plane, near edge slightly in front and far edge slightly behind.
export class RTSCamera {
  constructor(camera, terrain) {
    this.camera = camera;
    this.terrain = terrain;
    this.target = new THREE.Vector3();
    this.groundY = 0;
    this.height = 24;
    this.wantHeight = 24;
    this.minHeight = 5;
    this.maxHeight = 62;
    this.tiltDeg = 38;
    this.yaw = -Math.PI / 4;
    this.wantYaw = this.yaw;
    this.vel = new THREE.Vector2();
    this.keys = new Set();
    this.edge = new THREE.Vector2();
  }
  focus(x, z) { this.target.set(x, 0, z); }

  // pan in screen-aligned directions (dx right, dz down/back)
  pan(dx, dz) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.target.x += dx * c + dz * s;
    this.target.z += -dx * s + dz * c;
  }
  zoom(f) { this.wantHeight = clamp(this.wantHeight * f, this.minHeight, this.maxHeight); }
  rotate(a) { this.wantYaw += a; }

  update(dt) {
    let ix = 0, iz = 0;
    if (this.keys.has('ArrowLeft')) ix -= 1;
    if (this.keys.has('ArrowRight')) ix += 1;
    if (this.keys.has('ArrowUp')) iz -= 1;
    if (this.keys.has('ArrowDown')) iz += 1;
    ix += this.edge.x; iz += this.edge.y;
    const speed = this.height * 1.25;
    this.pan(ix * speed * dt, iz * speed * dt);
    this.target.x = clamp(this.target.x, -44, 44);
    this.target.z = clamp(this.target.z, -44, 44);
    this.wantHeight = clamp(this.wantHeight, this.minHeight, this.maxHeight);
    this.height += (this.wantHeight - this.height) * Math.min(1, dt * 8);
    this.yaw += (this.wantYaw - this.yaw) * Math.min(1, dt * 8);
    const gy = Math.max(0, this.terrain.groundY(this.target.x, this.target.z));
    this.groundY += (gy - this.groundY) * Math.min(1, dt * 3);
    this.target.y = this.groundY;
    this.apply();
  }
  apply() {
    const t = THREE.MathUtils.degToRad(this.tilt());
    const back = this.height * Math.tan(t);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * back,
      this.target.y + this.height,
      this.target.z + Math.cos(this.yaw) * back,
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
  // zoomed right in, the view swings lower so you see units from the side, not the top of their heads
  tilt() {
    const k = clamp((18 - this.height) / (18 - this.minHeight), 0, 1);
    return this.tiltDeg + k * k * 22;
  }
  // distance from the camera to the ground point at the view centre
  get viewDistance() { return this.height / Math.cos(THREE.MathUtils.degToRad(this.tilt())); }
}
