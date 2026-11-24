import * as THREE from 'three';
import { fbm, valueNoise, clamp, lerp, smoothstep as ss } from './rng.js';

// Map: 96 x 96 walkable cells of 1 world unit (~1 m). Point-symmetric about the origin so both
// sides are fair: the player starts south-west, the AI north-east, a river runs between them
// with three shallow fords.
export const N = 96;
export const HALF = 48;
export const WATER_Y = -0.42;
export const BASES = [{ x: -30, z: 30 }, { x: 30, z: -30 }];
export const FORDS = [-27, 0, 27];
const SQ = Math.SQRT1_2;

const meander = (s) => 4 * Math.sin(0.09 * s) + 2 * Math.sin(0.21 * s);

export class Terrain {
  constructor(seed = 11) {
    this.seed = seed;
    this.fordPoints = FORDS.map((s) => this.riverPoint(s));
    this.paths = [];
    for (const b of BASES) {
      for (const f of this.fordPoints) {
        // only connect a base to the ford points on its own side of the river
        this.paths.push([b.x, b.z, f.x, f.z]);
      }
    }
    // a few extra roads to expansions
    this.paths.push([-30, 30, -24, -8], [30, -30, 24, 8], [-30, 30, 6, 26], [30, -30, -6, -26]);
    this._hCache = new Map();
  }

  riverPoint(s) {
    const m = meander(s);
    return { x: (s + m) * SQ, z: (s - m) * SQ };
  }
  river(x, z) {
    const s = (x + z) * SQ, d = (x - z) * SQ;
    return { s, dist: Math.abs(d - meander(s)), side: Math.sign(d - meander(s)) };
  }
  fordAmt(s) {
    let k = 0;
    for (const f of FORDS) k = Math.max(k, 1 - ss(2.2, 4.4, Math.abs(s - f)));
    return k;
  }
  pathDist(x, z) {
    let best = 1e9;
    for (const [ax, az, bx, bz] of this.paths) {
      const dx = bx - ax, dz = bz - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      const px = ax + dx * t - x, pz = az + dz * t - z;
      best = Math.min(best, Math.hypot(px, pz));
    }
    return best;
  }
  edge(x, z) { return Math.max(Math.abs(x), Math.abs(z)); }

  rawHills(x, z) {
    const f = (a, b) => (fbm(a * 0.045 + 50, b * 0.045 + 50, this.seed, 4) - 0.5) * 3.2;
    return 0.5 * (f(x, z) + f(-x, -z));
  }

  height(x, z) {
    let h = this.rawHills(x, z);
    for (const b of BASES) h = lerp(0.25, h, ss(12, 19, Math.hypot(x - b.x, z - b.z)));
    const pd = this.pathDist(x, z);
    h = lerp(h * 0.4 + 0.1, h, ss(1.5, 4, pd));
    const e = this.edge(x, z);
    if (e > 42) {
      const k = ss(42, 46, e);
      h += Math.pow(e - 42, 1.35) * 0.95 + (valueNoise(x * 0.35, z * 0.35, this.seed + 5) - 0.3) * 2.2 * k;
    }
    const { s, dist } = this.river(x, z);
    const ford = this.fordAmt(s);
    const bank = ss(1.7, 5.2, dist);
    const bed = lerp(-1.7, -0.16, ford);
    h = lerp(bed, Math.max(h, 0.05 * (1 - ford)), bank);
    return h;
  }

  // Height used by units/buildings standing on the ground (never below the water surface).
  groundY(x, z) { return Math.max(this.height(x, z), WATER_Y + 0.02); }

  forestDensity(x, z) {
    const f = (a, b) => fbm(a * 0.075 + 9, b * 0.075 - 3, this.seed + 11, 3);
    return 0.5 * (f(x, z) + f(-x, -z));
  }

  color(x, z, h, out) {
    const grassA = new THREE.Color(0x5b9a45), grassB = new THREE.Color(0x86b84f);
    const n = valueNoise(x * 0.18, z * 0.18, this.seed + 3);
    out.copy(grassA).lerp(grassB, n);
    const fd = this.forestDensity(x, z);
    out.lerp(new THREE.Color(0x3f7a39), ss(0.5, 0.65, fd) * 0.7);
    const pd = this.pathDist(x, z);
    out.lerp(new THREE.Color(0xb2955f), (1 - ss(1.2, 2.6, pd)) * 0.85);
    for (const b of BASES) {
      const d = Math.hypot(x - b.x, z - b.z);
      out.lerp(new THREE.Color(0xa99067), (1 - ss(5.5, 8, d)) * 0.8);
    }
    const { dist } = this.river(x, z);
    out.lerp(new THREE.Color(0xd9c58f), 1 - ss(3.5, 6.2, dist));
    if (h < WATER_Y + 0.05) out.lerp(new THREE.Color(0x8d7d5c), 0.8);
    const e = this.edge(x, z);
    out.lerp(new THREE.Color(0x8a8e86), ss(43, 46, e) * 0.85);
    return out;
  }

  buildMesh() {
    const size = 150, seg = 300;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.height(x, z);
      pos.setY(i, h);
      this.color(x, z, h, c);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x4a9ccc, roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.82 }),
    );
    water.position.y = WATER_Y;
    water.receiveShadow = true;
    water.name = 'water';
    return { mesh, water };
  }

  // Ray / heightfield intersection (the ground is never below the water surface for picking).
  raycast(origin, dir, out) {
    let t = 0, prev = 0;
    const step = 0.6;
    for (let i = 0; i < 800; i++) {
      t += step;
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (y < this.groundY(x, z)) {
        let lo = prev, hi = t;
        for (let k = 0; k < 14; k++) {
          const m = (lo + hi) / 2;
          const mx = origin.x + dir.x * m, my = origin.y + dir.y * m, mz = origin.z + dir.z * m;
          if (my < this.groundY(mx, mz)) hi = m; else lo = m;
        }
        return out.copy(origin).addScaledVector(dir, hi);
      }
      prev = t;
      if (y < -10) break;
    }
    return null;
  }

  minimapImage(size) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size);
    const c = new THREE.Color();
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = (px + 0.5) / size * N - HALF, z = (py + 0.5) / size * N - HALF;
        const h = this.height(x, z);
        if (h < WATER_Y) c.set(0x3f8fc2); else this.color(x, z, h, c);
        const shade = clamp(1 + h * 0.06, 0.75, 1.25);
        const i = (py * size + px) * 4;
        img.data[i] = clamp(c.r * 255 * shade, 0, 255);
        img.data[i + 1] = clamp(c.g * 255 * shade, 0, 255);
        img.data[i + 2] = clamp(c.b * 255 * shade, 0, 255);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }
}

// ---------------------------------------------------------------------------------------------
// Walkability grid + A* pathfinding (8-connected, no corner cutting, line-of-sight smoothing).

export class Grid {
  constructor(terrain) {
    const n = N;
    this.n = n;
    const c = n * n;
    this.block = new Uint8Array(c);  // static terrain: water / cliffs
    this.occ = new Uint16Array(c);   // trees, rocks, crystals, buildings
    this.g = new Float32Array(c);
    this.parent = new Int32Array(c);
    this.stamp = new Uint32Array(c);
    this.closed = new Uint32Array(c);
    this.gen = 0;
    this.heap = new Int32Array(c * 8);
    this.heapF = new Float32Array(c * 8);
    for (let cz = 0; cz < n; cz++) {
      for (let cx = 0; cx < n; cx++) {
        const x = cx - HALF + 0.5, z = cz - HALF + 0.5;
        let blocked = false;
        if (terrain.edge(x, z) > 44.2) blocked = true;
        for (let k = 0; k < 5 && !blocked; k++) {
          const ox = [0, 0.4, -0.4, 0, 0][k], oz = [0, 0, 0, 0.4, -0.4][k];
          if (terrain.height(x + ox, z + oz) < WATER_Y + 0.12) blocked = true;
        }
        if (!blocked) {
          const h = terrain.height(x, z);
          const sl = Math.max(Math.abs(terrain.height(x + 0.5, z) - h), Math.abs(terrain.height(x, z + 0.5) - h));
          if (sl > 0.75) blocked = true;
        }
        this.block[cz * n + cx] = blocked ? 1 : 0;
      }
    }
  }
  cell(v) { return Math.floor(v + HALF); }
  center(c) { return c - HALF + 0.5; }
  inb(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.n && cz < this.n; }
  free(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= this.n || cz >= this.n) return false;
    const i = cz * this.n + cx;
    return this.block[i] === 0 && this.occ[i] === 0;
  }
  freeAt(x, z) { return this.free(this.cell(x), this.cell(z)); }
  terrainFree(cx, cz) { return this.inb(cx, cz) && this.block[cz * this.n + cx] === 0; }
  occupy(cx, cz, w, h, d) {
    for (let z = cz; z < cz + h; z++) for (let x = cx; x < cx + w; x++) if (this.inb(x, z)) this.occ[z * this.n + x] += d;
  }

  _push(i, f) {
    let k = this.hs++;
    const H = this.heap, F = this.heapF;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (F[p] <= f) break;
      H[k] = H[p]; F[k] = F[p]; k = p;
    }
    H[k] = i; F[k] = f;
  }
  _pop() {
    const H = this.heap, F = this.heapF;
    const top = H[0];
    const li = H[--this.hs], lf = F[this.hs];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= this.hs) break;
      if (c + 1 < this.hs && F[c + 1] < F[c]) c++;
      if (F[c] >= lf) break;
      H[k] = H[c]; F[k] = F[c]; k = c;
    }
    H[k] = li; F[k] = lf;
    return top;
  }

  // goal(x, z) -> true when a cell centre is an acceptable end point. (tx, tz) drives the heuristic.
  findPath(sx, sz, tx, tz, goal, maxIter = 12000) {
    const n = this.n;
    const scx = clamp(this.cell(sx), 0, n - 1), scz = clamp(this.cell(sz), 0, n - 1);
    const gen = ++this.gen;
    const start = scz * n + scx;
    const heur = (cx, cz) => {
      const dx = Math.abs(this.center(cx) - tx), dz = Math.abs(this.center(cz) - tz);
      return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
    };
    this.hs = 0;
    this.g[start] = 0; this.stamp[start] = gen; this.parent[start] = -1;
    this._push(start, heur(scx, scz));
    let best = start, bestH = heur(scx, scz), found = -1, iter = 0;
    while (this.hs > 0 && iter++ < maxIter) {
      const cur = this._pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      const cx = cur % n, cz = (cur / n) | 0;
      if (cur !== start && goal(this.center(cx), this.center(cz))) { found = cur; break; }
      const hc = heur(cx, cz);
      if (hc < bestH) { bestH = hc; best = cur; }
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!this.free(nx, nz)) continue;
          if (dx && dz && (!this.free(cx + dx, cz) || !this.free(cx, cz + dz))) continue;
          const ni = nz * n + nx;
          if (this.closed[ni] === gen) continue;
          const ng = this.g[cur] + (dx && dz ? 1.4142 : 1);
          if (this.stamp[ni] !== gen || ng < this.g[ni]) {
            this.stamp[ni] = gen; this.g[ni] = ng; this.parent[ni] = cur;
            this._push(ni, ng + heur(nx, nz));
          }
        }
      }
    }
    const end = found >= 0 ? found : best;
    if (end === start) return [];
    const cells = [];
    for (let i = end; i !== -1 && i !== start; i = this.parent[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => ({ x: this.center(i % n), z: this.center((i / n) | 0) }));
    return this.smooth(sx, sz, pts);
  }

  los(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / 0.3);
    const r = 0.32;
    for (let k = 1; k <= steps; k++) {
      const x = ax + (bx - ax) * k / steps, z = az + (bz - az) * k / steps;
      if (!this.freeAt(x + r, z + r) || !this.freeAt(x - r, z + r) || !this.freeAt(x + r, z - r) || !this.freeAt(x - r, z - r)) return false;
    }
    return true;
  }
  smooth(sx, sz, pts) {
    if (pts.length < 2) return pts;
    const out = [];
    let ax = sx, az = sz, i = 0;
    while (i < pts.length) {
      let j = i;
      while (j + 1 < pts.length && this.los(ax, az, pts[j + 1].x, pts[j + 1].z)) j++;
      out.push(pts[j]);
      ax = pts[j].x; az = pts[j].z;
      i = j + 1;
    }
    return out;
  }

  // Nearest free cell centre to (x, z), searching outward in rings.
  nearestFree(x, z, maxR = 12) {
    const cx = this.cell(x), cz = this.cell(z);
    if (this.free(cx, cz)) return { x: this.center(cx), z: this.center(cz) };
    for (let r = 1; r <= maxR; r++) {
      let best = null, bd = 1e9;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this.free(cx + dx, cz + dz)) continue;
          const wx = this.center(cx + dx), wz = this.center(cz + dz);
          const d = (wx - x) ** 2 + (wz - z) ** 2;
          if (d < bd) { bd = d; best = { x: wx, z: wz }; }
        }
      }
      if (best) return best;
    }
    return null;
  }
}
