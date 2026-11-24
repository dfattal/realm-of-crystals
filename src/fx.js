import * as THREE from 'three';

// GPU point-sprite particles: one draw call per blend mode, a few thousand particles.
class Particles {
  constructor(scene, { additive = false, max = 3000 } = {}) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.s0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 800 } },
      vertexShader: `
        attribute float alpha; attribute float size; attribute vec3 color;
        varying float vA; varying vec3 vC; uniform float uScale;
        void main() {
          vA = alpha; vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * uScale / max(0.1, -mv.z);
        }`,
      fragmentShader: `
        varying float vA; varying vec3 vC;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          float a = smoothstep(1.0, 0.25, r) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vC, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size, color, alpha = 1, grow = 0, grav = 0, drag = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.life[i] = life; this.age[i] = 0; this.size[i] = this.s0[i] = size; this.alpha[i] = this.a0[i] = alpha;
    this.grow[i] = grow; this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // swap-remove
        const j = --this.n;
        if (i !== j) {
          for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; this.col[i * 3 + k] = this.col[j * 3 + k]; }
          this.life[i] = this.life[j]; this.age[i] = this.age[j]; this.size[i] = this.size[j]; this.s0[i] = this.s0[j];
          this.alpha[i] = this.alpha[j]; this.a0[i] = this.a0[j]; this.grow[i] = this.grow[j]; this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j];
        }
        continue;
      }
      const k = this.age[i] / this.life[i];
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 2] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] * (1 + this.grow[i] * k);
      this.alpha[i] = this.a0[i] * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
      i++;
    }
    const g = this.geo;
    g.setDrawRange(0, this.n);
    for (const a of ['position', 'color', 'alpha', 'size']) g.attributes[a].needsUpdate = true;
  }
}

const C = (h) => new THREE.Color(h);
const COLORS = {
  leaf: [C(0x5f9e3a), C(0x7fbf4a), C(0x3f7a2f)], dust: [C(0xcbb592), C(0xb9a17c)], smoke: [C(0x55504a), C(0x3d3a37), C(0x77706a)],
  fire: [C(0xffb347), C(0xff7a1a), C(0xffd27a)], spark: [C(0xffe7a0), C(0xffffff)], shard: [C(0xff9ff0), C(0xe46ad6), C(0xffffff)],
  blue: [C(0x8fd0ff), C(0xbfe8ff), C(0x5aa8ff)], green: [C(0x9dff7a), C(0xd2ffb8), C(0x52e05a)], blood: [C(0xc4c4c4), C(0xe8e3d6)],
  gold: [C(0xffd27a), C(0xffe9b0), C(0xffb347)], red: [C(0xb3241c), C(0x8a1712), C(0xd23a2a)], bone: [C(0xe8e3d6), C(0xcfc8b4), C(0xffffff)],
  ember: [C(0xff7a1a), C(0xffb347), C(0xff4a1a)], heal: [C(0x8dffb0), C(0xd9ffe4), C(0x52e07a)], rock: [C(0x7a6a55), C(0x5c5040), C(0x9a8a70)],
};
const TEAM_FX = [COLORS.blue, COLORS.green, COLORS.gold];
const TEAM_HEX = [0x8fd0ff, 0x9dff7a, 0xffc75a];

// a crescent swoosh texture (bright leading edge fading along the arc)
let SLASH_GEO = null;
function slashGeometry() {
  if (SLASH_GEO) return SLASH_GEO;
  const g = new THREE.RingGeometry(0.45, 1.0, 28, 1, 0, Math.PI * 1.15);
  // vertex alpha: fades toward the tail of the arc and toward the inner edge
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const a = Math.atan2(y, x), r = Math.hypot(x, y);
    const k = Math.pow(Math.max(0, a / (Math.PI * 1.15)), 1.6) * Math.min(1, (r - 0.45) / 0.4);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  SLASH_GEO = g;
  return g;
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const R = (s = 1) => (Math.random() - 0.5) * 2 * s;

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.alpha = new Particles(scene, { additive: false, max: 4000 });
    this.add = new Particles(scene, { additive: true, max: 3000 });
    this.meshes = [];
  }
  setScale(s) { this.alpha.mat.uniforms.uScale.value = s; this.add.mat.uniforms.uScale.value = s; }

  leaves(p) {
    for (let i = 0; i < 6; i++) this.alpha.emit(p.x + R(0.6), p.y + 1.4 + Math.random() * 1.4, p.z + R(0.6), R(1.2), 0.4 + Math.random(), R(1.2), 1.2, 0.16, pick(COLORS.leaf), 1, 0, 1.8, 0.8);
  }
  shards(p) {
    for (let i = 0; i < 6; i++) this.add.emit(p.x + R(0.3), p.y + 0.6 + Math.random() * 0.6, p.z + R(0.3), R(2), 1.5 + Math.random() * 2, R(2), 0.6, 0.14, pick(COLORS.shard), 1, -0.4, 7, 0.5);
  }
  dust(p, scale = 1, n = 8) {
    for (let i = 0; i < n; i++) this.alpha.emit(p.x + R(scale), p.y + 0.2, p.z + R(scale), R(1.4 * scale), 0.6 + Math.random() * scale, R(1.4 * scale), 1.2 + Math.random() * 0.6, 0.55 * scale + 0.25, pick(COLORS.dust), 0.65, 2.2, -0.2, 1.6);
  }
  spark(p, h = 1) {
    for (let i = 0; i < 7; i++) this.add.emit(p.x + R(0.2), p.y + h, p.z + R(0.2), R(3), 1 + Math.random() * 2.5, R(3), 0.35, 0.12, pick(COLORS.spark), 1, -0.5, 9, 0);
    if (Math.random() < 0.5) for (let i = 0; i < 3; i++) this.alpha.emit(p.x + R(0.2), p.y + h * 0.8, p.z + R(0.2), R(1), 1 + Math.random(), R(1), 0.5, 0.1, pick(COLORS.blood), 1, 0, 8, 0);
  }
  fire(p, size, h, heavy) {
    const n = heavy ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const x = p.x + R(size * 0.35), z = p.z + R(size * 0.35), y = p.y + h * (0.4 + Math.random() * 0.5);
      this.add.emit(x, y, z, R(0.3), 1.5 + Math.random(), R(0.3), 0.6 + Math.random() * 0.3, 0.55, pick(COLORS.fire), 0.9, -0.6, 0, 0.5);
      this.alpha.emit(x, y + 0.4, z, R(0.3) + 0.3, 1.2 + Math.random() * 0.8, R(0.3), 2.2 + Math.random(), 0.6, pick(COLORS.smoke), 0.55, 2.8, -0.15, 0.3);
    }
  }
  magic(p, team, scale = 1) {
    const cols = TEAM_FX[team] || COLORS.blue;
    for (let i = 0; i < 22 * scale; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 3;
      this.add.emit(p.x, p.y + 0.3, p.z, Math.cos(a) * s * scale, 1 + Math.random() * 2.5, Math.sin(a) * s * scale, 0.55, 0.28, pick(cols), 1, -0.6, 3, 2);
    }
    this.shockwave(p, TEAM_HEX[team] ?? 0x8fd0ff, 1.8 * scale);
  }

  // A weapon swoosh in front of the attacker. The arc's tilt follows the swing clip
  // (overhead chop = vertical, slice = diagonal, stab = short and flat).
  slash(p, yaw, h, team, heavy, anim = '') {
    const m = new THREE.Mesh(slashGeometry(), new THREE.MeshBasicMaterial({
      color: heavy ? 0xffe2b0 : 0xffffff, vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    const chop = /Chop/.test(anim), stab = /Stab/.test(anim);
    const s = (heavy ? 1.15 : 0.85) * h * 0.55;
    const g = new THREE.Group();
    g.position.set(p.x + Math.sin(yaw) * 0.45, p.y + h * 0.55, p.z + Math.cos(yaw) * 0.45);
    g.rotation.y = yaw;
    m.rotation.set(chop ? 0 : Math.PI / 2, chop ? Math.PI / 2 : 0, stab ? 0.2 : chop ? -0.6 : 0.5 + Math.random() * 0.4);
    if (stab) m.scale.set(s * 0.8, s * 0.35, s);
    else m.scale.setScalar(s);
    g.add(m);
    g.renderOrder = 7;
    this.scene.add(g);
    const spin = (Math.random() < 0.5 ? 1 : -1) * 5;
    this.meshes.push({ mesh: g, mat: m.material, geoShared: true, t: 0, life: heavy ? 0.24 : 0.18, upd: (it, dt) => {
      const k = it.t / it.life;
      m.material.opacity = 0.9 * (1 - k * k);
      m.rotation.z += spin * dt * (chop ? 0.4 : 1);
      g.scale.setScalar(1 + k * 0.25);
    } });
  }
  // Contact burst at the point of a hit, thrown away from the attacker.
  impact(p, dx, dz, heavy, team, building = false) {
    const d = Math.hypot(dx, dz) || 1;
    const nx = dx / d, nz = dz / d;
    const n = heavy ? 14 : 8;
    for (let i = 0; i < n; i++) {
      const s = 2 + Math.random() * (heavy ? 4 : 2.5);
      this.add.emit(p.x, p.y, p.z, nx * s + R(1.6), 0.6 + Math.random() * 2.2, nz * s + R(1.6), 0.28, 0.12, pick(COLORS.spark), 1, -0.6, 7, 0.5);
    }
    // chips: splinters from buildings, bone from the undead, red from the living
    const chips = building ? COLORS.rock : team === 1 ? COLORS.bone : COLORS.red;
    for (let i = 0; i < (heavy ? 9 : 5); i++) {
      const s = 1.5 + Math.random() * 2.5;
      this.alpha.emit(p.x, p.y, p.z, nx * s + R(1), 1 + Math.random() * 2.2, nz * s + R(1), 0.55, 0.09 + Math.random() * 0.06, pick(chips), 1, 0, 11, 0.4);
    }
    if (heavy) this.shockwave({ x: p.x, y: p.y - 0.9, z: p.z }, 0xfff0d0, 0.9);
    // a flat flash disc at the contact point
    const fl = new THREE.Mesh(new THREE.CircleGeometry(heavy ? 0.42 : 0.3, 12), new THREE.MeshBasicMaterial({ color: 0xfff4d8, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    fl.position.set(p.x, p.y, p.z);
    fl.lookAt(p.x - nx, p.y, p.z - nz);
    fl.renderOrder = 7;
    this.scene.add(fl);
    this.meshes.push({ mesh: fl, t: 0, life: 0.1, upd: (it) => { const k = it.t / it.life; fl.scale.setScalar(1 + k * 1.4); fl.material.opacity = 1 - k; } });
  }
  debris(p, n = 12) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 4;
      this.alpha.emit(p.x, p.y + 0.3, p.z, Math.cos(a) * s, 3 + Math.random() * 4, Math.sin(a) * s, 0.9, 0.12 + Math.random() * 0.12, pick(COLORS.rock), 1, 0, 14, 0.3);
    }
  }
  embers(p, h = 1.6, n = 2) {
    for (let i = 0; i < n; i++) this.add.emit(p.x + R(0.35), p.y + Math.random() * h, p.z + R(0.35), R(0.4), 0.8 + Math.random() * 1.2, R(0.4), 0.6 + Math.random() * 0.3, 0.12, pick(COLORS.ember), 0.9, -0.5, -0.4, 0.5);
  }
  heal(p, h = 1.6) {
    for (let i = 0; i < 4; i++) this.add.emit(p.x + R(0.4), p.y + 0.2 + Math.random() * h * 0.6, p.z + R(0.4), 0, 0.9 + Math.random() * 0.6, 0, 0.9, 0.16, pick(COLORS.heal), 0.9, -0.3, -0.2, 0);
  }
  levelUp(p) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.3 + Math.random() * 0.6;
      this.add.emit(p.x + Math.cos(a) * r, p.y + 0.1, p.z + Math.sin(a) * r, 0, 2 + Math.random() * 3, 0, 1.1, 0.2, pick(COLORS.gold), 1, -0.4, 0.6, 0);
    }
    this.shockwave(p, 0xffd27a, 3);
  }
  trail(p, team, kind) {
    if (kind === 'orb') this.add.emit(p.x + R(0.05), p.y + R(0.05), p.z + R(0.05), 0, 0, 0, 0.35, 0.32, pick(TEAM_FX[team] || COLORS.blue), 0.8, -0.8);
    else if (kind === 'boulder') this.alpha.emit(p.x, p.y, p.z, 0, 0.2, 0, 0.6, 0.28, pick(COLORS.dust), 0.45, 1.5);
  }
  explosion(p) {
    this.dust(p, 1.1, 12);
    for (let i = 0; i < 10; i++) this.add.emit(p.x, p.y + 0.4, p.z, R(4), 2 + Math.random() * 3, R(4), 0.45, 0.3, pick(COLORS.fire), 1, -0.5, 8, 0.5);
    this.shockwave(p, 0xffd9a0, 2.4);
  }
  shockwave(p, color, radius) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 1, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    m.position.set(p.x, p.y + 0.12, p.z);
    m.renderOrder = 4;
    this.scene.add(m);
    this.meshes.push({ mesh: m, t: 0, life: 0.45, upd: (it) => { const k = it.t / it.life; m.scale.setScalar(0.2 + k * radius); m.material.opacity = 0.8 * (1 - k); } });
  }
  marker(p, color) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.5, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false }),
    );
    m.position.set(p.x, p.y + 0.12, p.z);
    m.renderOrder = 3;
    this.scene.add(m);
    this.meshes.push({ mesh: m, t: 0, life: 0.6, upd: (it) => { const k = it.t / it.life; m.scale.setScalar(1 + k * 0.8); m.material.opacity = 1 - k; } });
  }
  update(dt) {
    this.alpha.update(dt);
    this.add.update(dt);
    for (let i = this.meshes.length - 1; i >= 0; i--) {
      const it = this.meshes[i];
      it.t += dt;
      if (it.t >= it.life) {
        this.scene.remove(it.mesh);
        if (it.mat) it.mat.dispose();
        else { it.mesh.geometry.dispose(); it.mesh.material.dispose(); }
        this.meshes.splice(i, 1); continue;
      }
      it.upd(it, dt);
    }
  }
}
