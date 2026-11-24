import * as THREE from 'three';
import { Terrain, Grid, BASES, HALF, N, WATER_Y } from './terrain.js';
import { InstancedProp, fit } from './assets.js';
const MAP_HALF = HALF;
import { mulberry32, smoothstep as ss } from './rng.js';
import { RESOURCE } from './config.js';

// A gatherable node: a tree (wood) or a crystal formation (crystal).
export class Resource {
  constructor(world, kind, x, z, cx, cz) {
    this.world = world;
    this.kind = kind;
    this.isResource = true;
    this.alive = true;
    this.pos = new THREE.Vector3(x, world.terrain.groundY(x, z), z);
    this.cx = cx; this.cz = cz;
    this.amount = this.max = kind === 'crystal' ? RESOURCE.crystalPerNode : RESOURCE.woodPerTree;
    this.radius = 0.55;
    this.height = kind === 'crystal' ? 1.5 : 3;
    world.grid.occupy(cx, cz, 1, 1, 1);
  }
  // A worker can only chop a tree that has open ground next to it (forest interiors open up
  // as the outer trees are felled).
  reachable() {
    const G = this.world.grid;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dz) && G.free(this.cx + dx, this.cz + dz)) return true;
    }
    return false;
  }
  take(n) {
    const got = Math.min(n, this.amount);
    this.amount -= got;
    if (this.kind === 'crystal' && this.obj) {
      const s = 0.45 + 0.55 * (this.amount / this.max);
      this.obj.scale.setScalar(s * this.baseScale);
    }
    if (this.amount <= 0 && this.alive) this.deplete();
    return got;
  }
  deplete() {
    this.alive = false;
    this.world.grid.occupy(this.cx, this.cz, 1, 1, -1);
    if (this.kind === 'wood') {
      this.prop.hide(this.index);
      const m = new THREE.Matrix4().compose(this.pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * 6, 0)), new THREE.Vector3(1, 1, 1));
      this.world.stumps.add(m);
    } else if (this.obj) {
      this.obj.parent?.remove(this.obj);
    }
  }
}

export class World {
  constructor(scene, factory, assets, seed = 11) {
    this.scene = scene;
    this.factory = factory;
    this.terrain = new Terrain(seed);
    this.grid = new Grid(this.terrain);
    this.resources = [];
    const { mesh, water } = this.terrain.buildMesh();
    scene.add(mesh, water);
    this.terrainMesh = mesh;
    this.water = water;
    this.props = new THREE.Group();
    this.spinners = [];
    this.props.name = 'props';
    scene.add(this.props);
    this.populate(assets, seed);
  }

  populate(assets, seed) {
    const T = this.terrain, G = this.grid;
    const rand = mulberry32(seed * 977 + 13);
    const taken = new Uint8Array(N * N);
    const mark = (cx, cz) => { taken[cz * N + cx] = 1; };
    const isTaken = (cx, cz) => taken[cz * N + cx] === 1;
    const cellOK = (cx, cz) => G.terrainFree(cx, cz) && !isTaken(cx, cz);
    const mirror = (c) => N - 1 - c;
    const W = (c) => c - HALF + 0.5;

    // ---- crystal fields (defined for the player's half, mirrored for the AI) -----------------
    const crystalSpots = [];
    const field = (x, z, count, radius, rot = 0) => {
      for (let i = 0; i < count; i++) {
        const a = rot + (i / count) * Math.PI * 2;
        const r = radius * (0.75 + 0.25 * ((i * 7) % 3) / 2);
        crystalSpots.push([x + Math.cos(a) * r, z + Math.sin(a) * r]);
      }
    };
    // home mineral line: an arc on the west side of the player's keep
    const B = BASES[0];
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (-0.8 + (1.6 * i) / 6);
      crystalSpots.push([B.x + Math.cos(a) * 8.5, B.z + Math.sin(a) * 8.5]);
    }
    field(-24, -8, 6, 2.2, 0.3);   // western flank expansion
    field(6, 26, 6, 2.2, 1.1);     // southern flank expansion
    field(-8, 9, 4, 1.6, 0.7);     // contested, near the centre ford

    const crystals = [];
    for (const [x, z] of crystalSpots) {
      for (const [px, pz] of [[x, z], [-x, -z]]) {
        const cx = G.cell(px), cz = G.cell(pz);
        if (!G.terrainFree(cx, cz) || isTaken(cx, cz)) continue;
        mark(cx, cz);
        crystals.push([W(cx), W(cz), cx, cz]);
      }
    }
    for (const [x, z, cx, cz] of crystals) {
      const r = new Resource(this, 'crystal', x, z, cx, cz);
      const o = this.factory.prefabs.crystal.clone(true);
      r.baseScale = 0.85 + rand() * 0.3;
      o.scale.setScalar(r.baseScale);
      o.rotation.y = rand() * Math.PI * 2;
      o.position.copy(r.pos);
      this.props.add(o);
      r.obj = o;
      this.resources.push(r);
      // a couple of small shards around each node (decor only)
      for (let k = 0; k < 2; k++) {
        const s = this.factory.prefabs.crystalSmall.clone(true);
        const a = rand() * Math.PI * 2;
        s.position.set(x + Math.cos(a) * 0.55, 0, z + Math.sin(a) * 0.55);
        s.position.y = T.groundY(s.position.x, s.position.z);
        s.rotation.y = rand() * 6;
        s.scale.setScalar(0.5 + rand() * 0.3);
        this.props.add(s);
      }
    }

    // ---- clearings that must stay open -------------------------------------------------------
    const clear = (x, z) => {
      for (const b of BASES) if (Math.hypot(x - b.x, z - b.z) < 9.5) return true;
      if (T.pathDist(x, z) < 2.6) return true;
      if (T.river(x, z).dist < 5.5) return true;
      for (const [cx, cz] of crystalSpots) {
        if (Math.hypot(x - cx, z - cz) < 2.6 || Math.hypot(x + cx, z + cz) < 2.6) return true;
      }
      return false;
    };

    // ---- trees, rocks and decor: decide on the player's half, mirror to the AI's -------------
    const treeKinds = ['kkTreeA', 'kkTreeB', 'kkTreeA', 'kkTreeB', 'treeOak', 'treePine', 'treePineRound', 'treeDetailed'].filter((k, i, a) => a.indexOf(k) === i);
    const treeH = { kkTreeA: 3.3, kkTreeB: 3.6, treeDefault: 3.2, treeOak: 3.4, treePine: 3.8, treePineRound: 3.4, treeFat: 3.0, treeDetailed: 3.6 };
    const trees = Object.fromEntries(treeKinds.map((k) => [k, []]));
    const rocks = { rockA: [], rockC: [], rockTall: [], stoneB: [] };
    const decor = { bush: [], bushLarge: [], flowerRed: [], flowerYellow: [], grass: [], mushrooms: [] };

    const placeTree = (cx, cz, kind, rot, sc) => {
      for (const [ax, az, r] of [[cx, cz, rot], [mirror(cx), mirror(cz), rot + Math.PI]]) {
        if (!cellOK(ax, az)) continue;
        mark(ax, az);
        trees[kind].push({ cx: ax, cz: az, rot: r, sc });
      }
    };
    for (let cz = 0; cz < N; cz++) {
      for (let cx = 0; cx < N; cx++) {
        const x = W(cx), z = W(cz);
        if (x - z >= 0) continue; // player's half only (the river line x = z splits the map)
        if (!cellOK(cx, cz) || clear(x, z)) continue;
        const fd = T.forestDensity(x, z);
        const e = T.edge(x, z);
        // home wood line: an arc south of each keep
        const b = BASES[0];
        const db = Math.hypot(x - b.x, z - b.z);
        const ang = Math.atan2(z - b.z, x - b.x);
        const homeArc = db > 10 && db < 15.5 && ang > 0.25 && ang < 2.2;
        const border = e > 39.5 && e < 44.2;
        let p = 0;
        if (homeArc) p = 0.62;
        else if (border) p = 0.55;
        else if (fd > 0.56) p = 0.35 + (fd - 0.56) * 4;
        if (rand() < p) {
          const pool = ['kkTreeA', 'kkTreeB', 'kkTreeA', 'kkTreeB', 'kkTreeA', 'treeOak', 'treePine', 'treePineRound', 'treeDetailed'];
          const kind = pool[Math.floor(rand() * pool.length)];
          placeTree(cx, cz, kind, rand() * Math.PI * 2, 0.85 + rand() * 0.35);
        } else if (rand() < 0.012 && e < 40) {
          // rock outcrops: impassable, used as natural cover
          const kind = ['rockA', 'rockC', 'rockTall', 'stoneB'][Math.floor(rand() * 4)];
          for (const [ax, az, r] of [[cx, cz, rand() * 6], [mirror(cx), mirror(cz), rand() * 6]]) {
            if (!cellOK(ax, az)) continue;
            mark(ax, az);
            G.occupy(ax, az, 1, 1, 1);
            rocks[kind].push({ cx: ax, cz: az, rot: r, sc: 1 + rand() * 0.5 });
          }
        }
      }
    }
    // non-blocking ground decor (no mirroring needed, purely cosmetic)
    for (let i = 0; i < 1600; i++) {
      const x = (rand() * 2 - 1) * 46, z = (rand() * 2 - 1) * 46;
      const cx = G.cell(x), cz = G.cell(z);
      if (!G.terrainFree(cx, cz) || isTaken(cx, cz)) continue;
      if (T.pathDist(x, z) < 1.8) continue;
      let near = false;
      for (const b of BASES) if (Math.hypot(x - b.x, z - b.z) < 7) near = true;
      if (near) continue;
      const fd = T.forestDensity(x, z);
      const keys = fd > 0.56 ? ['mushrooms', 'bush', 'bushLarge', 'grass'] : ['grass', 'grass', 'flowerRed', 'flowerYellow', 'bush'];
      decor[keys[Math.floor(rand() * keys.length)]].push({ x, z, rot: rand() * 6, sc: 0.6 + rand() * 0.6 });
    }

    // water lilies on the river and reeds along its banks
    decor.lilyA = []; decor.lilyB = []; decor.wplantA = []; decor.wplantB = [];
    for (let i = 0; i < 2600; i++) {
      const x = (rand() * 2 - 1) * 46, z = (rand() * 2 - 1) * 46;
      const h = T.height(x, z);
      if (h < WATER_Y - 0.25 && rand() < 0.07 && T.pathDist(x, z) > 2.5) decor[rand() < 0.5 ? 'lilyA' : 'lilyB'].push({ x, z, rot: rand() * 6, sc: 0.7 + rand() * 0.5, water: true });
      else if (h > WATER_Y - 0.05 && h < WATER_Y + 0.25 && rand() < 0.18 && T.pathDist(x, z) > 2) decor[rand() < 0.5 ? 'wplantA' : 'wplantB'].push({ x, z, rot: rand() * 6, sc: 0.8 + rand() * 0.6 });
    }

    // ---- build instanced meshes --------------------------------------------------------------
    const A = assets;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    for (const kind of treeKinds) {
      const list = trees[kind];
      if (!list.length) continue;
      const prop = new InstancedProp(fit(A[kind].scene.clone(true), { height: treeH[kind] }), list.length, this.props, { sway: 0.012 });
      for (const t of list) {
        const x = W(t.cx) + (rand() - 0.5) * 0.3, z = W(t.cz) + (rand() - 0.5) * 0.3;
        p.set(x, T.groundY(x, z) - 0.05, z);
        q.setFromEuler(e.set(0, t.rot, 0));
        s.setScalar(t.sc);
        const idx = prop.add(m.compose(p, q, s));
        const r = new Resource(this, 'wood', x, z, t.cx, t.cz);
        r.prop = prop; r.index = idx;
        this.resources.push(r);
      }
    }
    for (const kind of Object.keys(rocks)) {
      const list = rocks[kind];
      if (!list.length) continue;
      const prop = new InstancedProp(fit(A[kind].scene.clone(true), { width: 1.3 }), list.length, this.props);
      for (const t of list) {
        const x = W(t.cx), z = W(t.cz);
        p.set(x, T.groundY(x, z) - 0.1, z);
        q.setFromEuler(e.set(0, t.rot, 0));
        s.setScalar(t.sc);
        prop.add(m.compose(p, q, s));
      }
    }
    const decorSize = { lilyA: 0.9, lilyB: 0.9, wplantA: 0.8, wplantB: 0.8, bush: 0.8, bushLarge: 1.2, flowerRed: 0.45, flowerYellow: 0.45, grass: 0.55, mushrooms: 0.5 };
    for (const kind of Object.keys(decor)) {
      const list = decor[kind];
      if (!list.length) continue;
      const prop = new InstancedProp(fit(A[kind].scene.clone(true), { width: decorSize[kind] }), list.length, this.props, { shadows: false, sway: /grass|bush|wplant/.test(kind) ? 0.08 : 0 });
      for (const t of list) {
        p.set(t.x, t.water ? WATER_Y + 0.03 : T.groundY(t.x, t.z) - 0.02, t.z);
        q.setFromEuler(e.set(0, t.rot, 0));
        s.setScalar(t.sc);
        prop.add(m.compose(p, q, s));
      }
    }
    this.stumps = new InstancedProp(fit(A.stump.scene.clone(true), { width: 0.6 }), 2000, this.props);

    // a ring of tree-covered mountains closes the world beyond the playable map
    const mk = ['mountainA', 'mountainB', 'mountainC', 'mountainA', 'hillsA', 'hillsB'];
    const mprops = Object.fromEntries([...new Set(mk)].map((k) => [k, []]));
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2 + rand() * 0.05;
      const r = MAP_HALF + 8 + rand() * 14;
      const sq = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      const x = (Math.cos(a) * r) / sq, z = (Math.sin(a) * r) / sq;
      if (Math.abs(x) > 72 || Math.abs(z) > 72) continue;
      mprops[mk[Math.floor(rand() * mk.length)]].push({ x, z, rot: rand() * 6, sc: 0.8 + rand() * 0.7 });
    }
    for (const [kind, list] of Object.entries(mprops)) {
      if (!list.length) continue;
      const prop = new InstancedProp(fit(A[kind].scene.clone(true), { width: 13 }), list.length, this.props, { shadows: false });
      for (const t of list) {
        p.set(t.x, T.groundY(Math.max(-47, Math.min(47, t.x)), Math.max(-47, Math.min(47, t.z))) - 0.5, t.z);
        q.setFromEuler(e.set(0, t.rot, 0));
        s.setScalar(t.sc);
        prop.add(m.compose(p, q, s));
      }
    }

    // a little life around each base: a windmill, tents, crates and banners (cosmetic)
    const F = this.factory.prefabs;
    const dress = [
      ['windmill', 6.8, 2.6, 1], ['tent', 6.2, -3.8, 1.6], ['tent', 7.2, -1.2, 1.6], ['weaponrack', 4.6, -5.2, 1.1],
      ['target', -5.2, -6.4, 0.9], ['crate', 3.6, 4.2, 0.8], ['crateSmall', 4.4, 4.9, 0.6], ['barrel', 3.1, 5.1, 0.55],
      ['wheelbarrow', -4.1, 5.0, 0.9], ['sack', -3.4, 5.6, 0.5], ['flag', 2.9, -2.9, 1.6], ['flag', -2.9, 2.9, 1.6],
    ];
    BASES.forEach((b, team) => {
      const sgn = team === 0 ? 1 : -1;
      for (const [k, ox, oz, sc] of dress) {
        const proto = k === 'windmill' || k === 'flag' ? F[`${k}_${team}`] : F[k];
        if (!proto) continue;
        const o = proto.clone(true);
        const x = b.x + ox * sgn, z = b.z + oz * sgn;
        o.position.set(x, T.groundY(x, z), z);
        o.rotation.y = (team === 0 ? Math.PI * 0.75 : -Math.PI * 0.25) + (k === 'windmill' ? 0 : rand() * 0.6 - 0.3);
        o.scale.multiplyScalar(sc);
        this.props.add(o);
        if (k === 'windmill') o.traverse((c) => { if (/fan/.test(c.name)) this.spinners.push(c); });
        if (k === 'windmill' || k === 'tent') G.occupy(G.cell(x), G.cell(z), 1, 1, 1);
      }
    });
  }
}
