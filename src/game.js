import * as THREE from 'three';
import { Unit, Building } from './entities.js';
import { World } from './world.js';
import { BASES, HALF } from './terrain.js';
import { UNIT_TYPES, BUILDING_TYPES, START_RES, MAX_POP, DIFFICULTY, PLAYER, ENEMY, VIKING, TEAM_NAMES, SAGA } from './config.js';
import { Saga } from './saga.js';
import { AI } from './ai.js';
import { FX } from './fx.js';

const _v = new THREE.Vector3();

export class Game {
  constructor({ scene, factory, assets, difficulty = 'normal', mode = 'classic', hooks = {}, save = null }) {
    this.scene = scene;
    this.factory = factory;
    this.hooks = hooks;
    this.mode = mode;
    this.viking = mode === 'viking';
    this.vk = VIKING;
    this.jarl = null;
    this.shakeAmt = 0;
    this.camTarget = null;
    this.world = new World(scene, factory, assets);
    this.terrain = this.world.terrain;
    this.grid = this.world.grid;
    this.resources = this.world.resources;
    this.units = [];
    this.buildings = [];
    this.projectiles = [];
    this.fx = new FX(scene);
    this.time = 0;
    this.over = false;
    this.selection = [];
    this.difficulty = DIFFICULTY[difficulty];
    this.teams = [0, 1].map(() => ({ crystal: START_RES.crystal, wood: START_RES.wood, pop: 0, popCap: 0, gathered: 0, lost: 0, killed: 0 }));
    this.notifyT = {};
    this.attackAlertT = -99;

    // starting bases (the Clan Saga has no enemy base: Barbarian camps and raids instead)
    this.keeps = [];
    BASES.forEach((b, team) => {
      if (this.viking && team === ENEMY) { this.keeps.push(null); return; }
      const cx = this.grid.cell(b.x) - 2, cz = this.grid.cell(b.z) - 2;
      const k = this.addBuilding('keep', team, cx, cz, true);
      this.keeps.push(k);
      for (let i = 0; i < 5; i++) {
        const a = (team === 0 ? Math.PI : 0) + (i - 2) * 0.45;
        const p = this.grid.nearestFree(b.x + Math.cos(a) * 3.6, b.z + Math.sin(a) * 3.6);
        this.spawnUnit('worker', team, p.x, p.z);
      }
    });
    if (this.viking) {
      this.keeps[PLAYER].level = 1;
      this.saga = new Saga(this, save);
      this.saga.init();
    } else {
      this.ai = new AI(this, ENEMY, this.difficulty);
      // player's starting workers go mine
      this.units.filter((u) => u.team === PLAYER).forEach((u, i) => {
        const r = this.nearestResource(i < 3 ? 'crystal' : 'wood', u.pos, 30, u);
        if (r) u.gather(r);
      });
    }
    this.recomputePop();
    this.started = true;
  }

  // ---- Viking (Clan Saga) mode -----------------------------------------------------------------
  trainsFor(type, team) {
    if (this.viking && team === PLAYER && VIKING.trains[type]) return VIKING.trains[type];
    return BUILDING_TYPES[type].trains || null;
  }
  buildingLabel(type, team) {
    return (this.viking && team === PLAYER && VIKING.buildingLabels[type]) || (this.viking && team === ENEMY && type === 'house' ? 'Barbarian Hut' : BUILDING_TYPES[type].label);
  }
  unitLabel(type, team) {
    if (this.viking && team === ENEMY) return `Barbarian ${UNIT_TYPES[type].label}`;
    return (this.viking && team === PLAYER && VIKING.unitLabels[type]) || UNIT_TYPES[type].label;
  }
  teamName(team) { return this.viking ? (team === PLAYER ? VIKING.teamName : 'Barbarians') : TEAM_NAMES[team]; }
  hallReq(type) { return this.viking ? SAGA.hallReq[type] || 1 : 1; }
  hallLocked(type) { return this.viking && this.saga.hallLevel() < this.hallReq(type); }

  findCampSpot(type, x, z) {
    const s = BUILDING_TYPES[type].size;
    for (let r = 3; r < 10; r++) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const wx = x + Math.cos(a) * r, wz = z + Math.sin(a) * r;
        const cx = this.grid.cell(wx) - Math.floor(s / 2), cz = this.grid.cell(wz) - Math.floor(s / 2);
        if (!this.canPlace(type, cx, cz, 1)) continue;
        let bad = false;
        for (const res of this.resources) if (res.alive && Math.hypot(res.pos.x - wx, res.pos.z - wz) < s / 2 + 1.6) { bad = true; break; }
        if (!bad) return [cx, cz];
      }
    }
    return null;
  }
  heroAbility(u, id) { return SAGA.heroes[u.heroId]?.abilities.find((a) => a.id === id); }
  heroAbilityHit(u, special) {
    const ab = this.heroAbility(u, special);
    if (!ab) return;
    const pow = u.dmgMul || 1;
    const allies = (r) => this.units.filter((a) => a.alive && a.team === u.team && Math.hypot(a.pos.x - u.pos.x, a.pos.z - u.pos.z) <= r);
    const blast = (cx, cz, dmg, range, push) => {
      const c = new THREE.Vector3(cx, this.terrain.groundY(cx, cz), cz);
      for (const e of [...this.units, ...this.buildings]) {
        if (!e.alive || e.team === u.team) continue;
        const d = e.isBuilding ? this.distTo({ pos: c, radius: 0 }, e) : Math.hypot(e.pos.x - cx, e.pos.z - cz) - e.radius;
        if (d > range) continue;
        this.damage(e, e.isBuilding ? dmg * 0.6 : dmg, u, 1, push, { pos: c });
      }
      return c;
    };
    if (special === 'cry') {
      const list = allies(ab.range);
      for (const a of list) { a.buffT = ab.dur; a.buffDmg = ab.dmg; a.buffSpeed = ab.haste; }
      this.fx.shockwave(u.pos, 0xffb347, ab.range);
      this.fx.shockwave(u.pos, 0xff5a2a, ab.range * 0.6);
      this.fx.embers(u.pos, u.height, 30);
      this.shake(0.25, u.pos);
      this.notify(`War Cry! ${list.length} warrior${list.length === 1 ? '' : 's'} fight harder and faster.`, 'good', 'cry', 0);
    } else if (special === 'wall') {
      const list = allies(ab.range);
      for (const a of list) { a.wallT = ab.dur; a.wallReduce = ab.reduce; this.fx.spark(a.pos, a.height); }
      this.fx.shockwave(u.pos, 0x7fc8ff, ab.range);
      this.fx.shockwave(u.pos, 0xd8f0ff, ab.range * 0.5);
      this.notify(`Shield Wall! ${list.length} warrior${list.length === 1 ? '' : 's'} take half damage.`, 'good', 'wall', 0);
    } else if (special === 'mend') {
      const list = allies(ab.range);
      for (const a of list) { a.hp = Math.min(a.maxHp, a.hp + ab.heal * pow); this.fx.heal(a.pos, a.height); this.fx.heal(a.pos, a.height); }
      this.fx.shockwave(u.pos, 0x8dffb0, ab.range);
      this.notify(`Healing Chant mends ${list.length} warrior${list.length === 1 ? '' : 's'}.`, 'good', 'mend', 0);
    } else if (special === 'slam' || special === 'bash') {
      const fwd = special === 'slam' ? 1.3 : 1.1;
      const c = blast(u.pos.x + Math.sin(u.yaw) * fwd, u.pos.z + Math.cos(u.yaw) * fwd, ab.dmg * pow, ab.range, ab.push);
      this.fx.explosion(c);
      this.fx.dust(c, 1.8, 22);
      this.fx.shockwave(c, 0xfff0c0, ab.range * 1.2);
      this.fx.debris(c, special === 'slam' ? 18 : 10);
      this.shake(special === 'slam' ? 0.7 : 0.45, c);
      u.hitStop = 0.12;
    } else if (special === 'storm') {
      // the densest enemy spot within reach, else straight ahead
      let best = null, bn = 0;
      for (const e of this.units) {
        if (!e.alive || e.team === u.team || Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z) > ab.reach) continue;
        let n = 0;
        for (const f of this.units) if (f.alive && f.team === e.team && Math.hypot(f.pos.x - e.pos.x, f.pos.z - e.pos.z) < ab.range) n++;
        if (n > bn) { bn = n; best = e; }
      }
      const tx = best ? best.pos.x : u.pos.x + Math.sin(u.yaw) * 4, tz = best ? best.pos.z : u.pos.z + Math.cos(u.yaw) * 4;
      const c = blast(tx, tz, ab.dmg * pow, ab.range, ab.push);
      for (let i = 0; i < 6; i++) this.fx.magic(c.clone().add(new THREE.Vector3((Math.random() - 0.5) * ab.range * 1.4, Math.random() * 0.5, (Math.random() - 0.5) * ab.range * 1.4)), 2, 0.9);
      this.fx.shockwave(c, 0xffd27a, ab.range * 1.2);
      this.fx.embers(c, 2.5, 30);
      this.shake(0.4, c);
    }
  }
  shake(a, p) {
    let k = 1;
    if (p && this.camTarget) k = Math.max(0, 1 - Math.hypot(p.x - this.camTarget.x, p.z - this.camTarget.z) / 32);
    this.shakeAmt = Math.min(1, Math.max(this.shakeAmt, a * k));
  }

  // ---- queries ------------------------------------------------------------------------------
  distTo(a, e) {
    if (e.isBuilding) {
      const h = e.size / 2;
      const dx = Math.max(Math.abs(a.pos.x - e.pos.x) - h, 0), dz = Math.max(Math.abs(a.pos.z - e.pos.z) - h, 0);
      return Math.hypot(dx, dz) - (a.radius || 0);
    }
    return Math.hypot(a.pos.x - e.pos.x, a.pos.z - e.pos.z) - (e.radius || 0) - (a.isBuilding ? a.size / 2 : (a.radius || 0));
  }
  pathTo(u, x, z, reach) {
    const pts = this.grid.findPath(u.pos.x, u.pos.z, x, z, (cx, cz) => Math.hypot(cx - x, cz - z) <= reach + 0.75);
    if (pts.length && this.grid.freeAt(x, z)) {
      const last = pts[pts.length - 1];
      if (Math.hypot(last.x - x, last.z - z) < 1.5) pts[pts.length - 1] = { x, z };
    }
    return pts;
  }
  pathToEntity(u, e, reach) {
    const probe = { pos: new THREE.Vector3(), radius: u.radius };
    return this.grid.findPath(u.pos.x, u.pos.z, e.pos.x, e.pos.z, (cx, cz) => {
      probe.pos.set(cx, 0, cz);
      return this.distTo(probe, e) <= reach + 0.55;
    });
  }
  findEnemy(src, range, preferUnits = true) {
    let best = null, bd = Infinity;
    for (const u of this.units) {
      if (!u.alive || u.team === src.team) continue;
      const d = this.distTo(src, u);
      if (d <= range && d < bd) { bd = d; best = u; }
    }
    if (best && preferUnits) return best;
    for (const b of this.buildings) {
      if (!b.alive || b.team === src.team) continue;
      const d = this.distTo(src, b) + 2;
      if (d <= range + 2 && d < bd) { bd = d; best = b; }
    }
    return best;
  }
  nearestResource(kind, p, maxD = 999, worker = null) {
    let best = null, bd = maxD;
    for (const r of this.resources) {
      if (!r.alive || r.kind !== kind) continue;
      let d = Math.hypot(r.pos.x - p.x, r.pos.z - p.z);
      if (d >= bd) continue;
      if (!r.reachable()) continue;
      // spread workers out: penalise crowded nodes
      if (worker) {
        let n = 0;
        for (const u of this.units) if (u !== worker && u.target === r && u.state === 'gather') n++;
        d += n * 2.5;
      }
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }
  nearestDropoff(team, p, kind) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      if (!b.alive || b.team !== team || !b.complete || !b.def.dropoff) continue;
      if (kind && b.def.dropoff !== 'all' && b.def.dropoff !== kind) continue;
      const d = Math.hypot(b.pos.x - p.x, b.pos.z - p.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  gatherRate(team) { return team === ENEMY ? this.difficulty.gather : 1; }

  // ---- economy ------------------------------------------------------------------------------
  deposit(team, kind, n, unit) {
    if (!kind || !n) return;
    if (unit && team === PLAYER) this.hooks.onDeposit?.(unit.pos, kind, n);
    this.teams[team][kind] += n;
    this.teams[team].gathered += n;
  }
  canAfford(team, cost) { const t = this.teams[team]; return t.crystal >= (cost.crystal || 0) && t.wood >= (cost.wood || 0); }
  pay(team, cost) { const t = this.teams[team]; t.crystal -= cost.crystal || 0; t.wood -= cost.wood || 0; }
  refund(team, cost) { const t = this.teams[team]; t.crystal += cost.crystal || 0; t.wood += cost.wood || 0; }
  recomputePop() {
    for (let t = 0; t < 2; t++) {
      let pop = 0, cap = 0;
      // raid-camp guards and camp houses are neutral scenery: they neither use nor add supply
      for (const u of this.units) if (u.alive && u.team === t && !u.guard) pop += u.def.pop;
      for (const b of this.buildings) if (b.alive && b.team === t && b.complete && b.def.pop && !b.outpost) cap += this.saga ? this.saga.popFor(b) : b.def.pop;
      this.teams[t].pop = pop;
      this.teams[t].popCap = Math.min(this.saga ? SAGA.maxPop : MAX_POP, cap);
    }
  }
  hasBuilding(team, type) { return this.buildings.some((b) => b.alive && b.team === team && b.type === type && b.complete); }

  train(b, type) {
    const def = UNIT_TYPES[type];
    if (!b.complete || !b.trains?.includes(type)) return false;
    if (b.queue.length >= 5) { if (b.team === PLAYER) this.notify('Queue is full', 'warn'); return false; }
    if (!this.canAfford(b.team, def.cost)) { if (b.team === PLAYER) this.notifyCost(def.cost); return false; }
    this.pay(b.team, def.cost);
    b.enqueue(type);
    return true;
  }
  cancelTrain(b, i) {
    const type = b.queue[i];
    if (!type) return;
    b.queue.splice(i, 1);
    if (i === 0) b.trainT = 0;
    this.refund(b.team, UNIT_TYPES[type].cost);
  }
  notifyCost(cost) {
    const t = this.teams[PLAYER];
    if (t.crystal < (cost.crystal || 0)) this.notify('Not enough crystal', 'warn', 'crystal');
    else this.notify('Not enough wood', 'warn', 'wood');
  }

  // ---- spawning ------------------------------------------------------------------------------
  spawnUnit(type, team, x, z) {
    const u = new Unit(this, type, team, x, z);
    this.units.push(u);
    this.recomputePop();
    return u;
  }
  spawnFromBuilding(b, type) {
    const toward = b.rally || { x: 0, z: 0 };
    const dx = toward.x - b.pos.x, dz = toward.z - b.pos.z, d = Math.hypot(dx, dz) || 1;
    const sx = b.pos.x + (dx / d) * (b.size / 2 + 0.8), sz = b.pos.z + (dz / d) * (b.size / 2 + 0.8);
    const p = this.grid.nearestFree(sx, sz) || { x: sx, z: sz };
    const u = this.spawnUnit(type, b.team, p.x, p.z);
    if (b.rally) {
      if (b.rally.resource && u.type === 'worker') u.gather(b.rally.resource);
      else u.moveTo(b.rally.x, b.rally.z);
    } else if (u.type === 'worker' && b.team === PLAYER) {
      this.autoGather(u);
    }
    this.saga?.onTrained(u, b);
    if (b.team === PLAYER) this.hooks.onTrained?.(u);
    this.ai?.onSpawn(u);
    return u;
  }
  // send a worker to whichever resource its team has fewer gatherers on, near the nearest drop-off
  autoGather(u, prefer = null) {
    let kind = prefer;
    if (!kind) {
      let wood = 0, crystal = 0;
      for (const w of this.units) {
        if (!w.alive || w.team !== u.team || w === u || w.type !== 'worker') continue;
        const k = w.lastRes?.kind || w.carryType;
        if (w.state === 'gather' || w.state === 'return') { if (k === 'wood') wood++; else if (k === 'crystal') crystal++; }
      }
      kind = wood * 1.3 < crystal ? 'wood' : 'crystal';
    }
    const drop = this.nearestDropoff(u.team, u.pos, kind);
    const from = drop && Math.hypot(drop.pos.x - u.pos.x, drop.pos.z - u.pos.z) < 20 ? drop.pos : u.pos;
    const r = this.nearestResource(kind, from, 28, u) || this.nearestResource(kind === 'wood' ? 'crystal' : 'wood', u.pos, 28, u);
    if (r) { u.gather(r); return true; }
    return false;
  }
  // the resource closest to a ground point, for forgiving right-clicks
  resourceNear(p, radius) {
    let best = null, bd = radius;
    for (const r of this.resources) {
      if (!r.alive) continue;
      const d = Math.hypot(r.pos.x - p.x, r.pos.z - p.z);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  canPlace(type, cx, cz, margin = 0) {
    const s = BUILDING_TYPES[type].size;
    for (let z = cz - margin; z < cz + s + margin; z++) {
      for (let x = cx - margin; x < cx + s + margin; x++) {
        if (!this.grid.free(x, z)) return false;
      }
    }
    // terrain must be reasonably flat
    let lo = Infinity, hi = -Infinity;
    for (const [ox, oz] of [[0, 0], [s, 0], [0, s], [s, s], [s / 2, s / 2]]) {
      const h = this.terrain.height(cx + ox - HALF, cz + oz - HALF);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    if (hi - lo > 1.1) return false;
    // no units standing in the footprint (other than workers, who step aside)
    for (const u of this.units) {
      if (!u.alive || u.type === 'worker') continue;
      const ux = this.grid.cell(u.pos.x), uz = this.grid.cell(u.pos.z);
      if (ux >= cx && ux < cx + s && uz >= cz && uz < cz + s) return false;
    }
    return true;
  }
  addBuilding(type, team, cx, cz, complete) {
    const b = new Building(this, type, team, cx, cz, complete);
    this.buildings.push(b);
    // nudge units out of the footprint
    for (const u of this.units) {
      const ux = this.grid.cell(u.pos.x), uz = this.grid.cell(u.pos.z);
      if (ux >= cx && ux < cx + b.size && uz >= cz && uz < cz + b.size) {
        const p = this.grid.nearestFree(u.pos.x, u.pos.z);
        if (p) { u.pos.x = p.x; u.pos.z = p.z; u.path = []; }
      }
    }
    if (complete) this.recomputePop();
    return b;
  }
  placeBuilding(type, team, cx, cz, workers) {
    const def = BUILDING_TYPES[type];
    if (def.requires && !this.hasBuilding(team, def.requires)) {
      if (team === PLAYER) this.notify(`Requires a ${this.buildingLabel(def.requires, team)}`, 'warn');
      return null;
    }
    if (team === PLAYER && this.hallLocked(type)) { this.notify(`Requires Great Hall Lv ${this.hallReq(type)}`, 'warn'); return null; }
    if (!this.canAfford(team, def.cost)) { if (team === PLAYER) this.notifyCost(def.cost); return null; }
    if (!this.canPlace(type, cx, cz)) { if (team === PLAYER) this.notify("Can't build there", 'warn'); return null; }
    this.pay(team, def.cost);
    const b = this.addBuilding(type, team, cx, cz, false);
    for (const w of workers) w.build(b);
    return b;
  }
  onBuildingComplete(b) {
    this.recomputePop();
    if (b.team === PLAYER) this.notify(`${b.label} complete`, 'good');
  }

  // ---- combat -------------------------------------------------------------------------------
  fireProjectile(src, target, kind, dmg) {
    const proto = kind === 'orb' ? this.factory.prefabs[src.def?.orb || `orb_${src.team}`] : this.factory.prefabs[kind];
    const mesh = proto.clone(true);
    const from = src.pos.clone();
    if (src.isBuilding) from.y = src.pos.y + src.height * 0.8;
    else {
      from.y += src.height * (kind === 'boulder' ? 0.9 : 0.65);
      from.x += Math.sin(src.yaw) * 0.4; from.z += Math.cos(src.yaw) * 0.4;
    }
    const to = target.pos.clone();
    to.y += target.isBuilding ? Math.min(2, target.height * 0.5) : target.height * 0.5;
    const dist = from.distanceTo(to);
    const speed = kind === 'boulder' ? 9 : kind === 'orb' ? 12 : kind === 'axe' ? 15 : 24;
    mesh.position.copy(from);
    this.scene.add(mesh);
    if (kind === 'orb') this.fx.magic(from, src.team, 0.25);
    this.projectiles.push({
      mesh, from, to, target, kind, dmg, src, team: src.team,
      t: 0, dur: Math.max(0.15, dist / speed), arc: kind === 'boulder' ? dist * 0.35 : kind === 'orb' || kind === 'axe' ? dist * 0.12 : dist * 0.08,
      splash: src.def?.splash || 0, vsBuilding: src.def?.vsBuilding || 1,
    });
  }
  updateProjectiles(dt) {
    const prev = new THREE.Vector3();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      if (p.kind !== 'boulder' && p.target.alive) {
        p.to.set(p.target.pos.x, p.target.pos.y + (p.target.isBuilding ? Math.min(2, p.target.height * 0.5) : p.target.height * 0.5), p.target.pos.z);
      }
      const k = Math.min(1, p.t / p.dur);
      prev.copy(p.mesh.position);
      p.mesh.position.lerpVectors(p.from, p.to, k);
      p.mesh.position.y += Math.sin(k * Math.PI) * p.arc;
      if (p.kind === 'arrow' || p.kind === 'axe') {
        const dir = p.mesh.position.clone().sub(prev);
        if (dir.lengthSq() > 1e-6) p.mesh.lookAt(p.mesh.position.clone().add(dir));
        if (p.kind === 'axe') p.mesh.rotateX(p.t * 22); // tumbling end over end
      } else {
        p.mesh.rotation.x += dt * 6;
        p.mesh.rotation.y += dt * 4;
        this.fx.trail(p.mesh.position, p.src.def?.orb ? 2 : p.team, p.kind);
      }
      if (k >= 1) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        if (p.splash) {
          if (p.kind === 'orb') this.fx.magic(p.to, p.src.def?.orb ? 2 : p.team, 0.8);
          else { this.fx.explosion(p.to); this.fx.debris(p.to, 10); this.shake(0.35, p.to); }
          const from = { pos: p.to };
          for (const e of [...this.units, ...this.buildings]) {
            if (!e.alive || e.team === p.team) continue;
            const d = e.isBuilding ? this.distTo({ pos: p.to, radius: 0 }, e) : Math.hypot(e.pos.x - p.to.x, e.pos.z - p.to.z) - e.radius;
            if (d <= p.splash) this.damage(e, e === p.target ? p.dmg : p.dmg * 0.55, p.src, p.vsBuilding, p.kind === 'boulder' ? 5 : 2.5, from);
          }
        } else if (p.target.alive) {
          const t = p.target;
          if (t.def.block && Math.random() < t.def.block) {
            // caught on the shield
            this.fx.spark(p.to, 0);
            this.fx.spark(p.to, 0);
            this.hooks.onFloat?.(t.pos, 'Block', 'block');
          } else {
            this.damage(t, p.dmg, p.src, undefined, p.kind === 'axe' ? 1.6 : 0.8, { pos: p.from });
            this.fx.impact(p.to, p.to.x - p.from.x, p.to.z - p.from.z, false, t.team);
          }
        }
      }
    }
  }
  // Melee contact: damage plus the feel of the blow (slash arc, chips, hit-stop, knockback).
  meleeHit(a, t) {
    const heavy = !!a.def.heavy;
    const dmg = a.attackDamage();
    const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z;
    const h = t.isBuilding ? 1.2 : t.height * 0.6;
    _v.set(t.isBuilding ? a.pos.x + Math.sin(a.yaw) * 0.9 : t.pos.x, t.pos.y + h, t.isBuilding ? a.pos.z + Math.cos(a.yaw) * 0.9 : t.pos.z);
    this.fx.slash(a.pos, a.yaw, a.height, a.team, heavy, a.curAnim);
    this.fx.impact(_v, dx, dz, heavy, t.team, t.isBuilding);
    a.hitStop = heavy ? 0.09 : 0.06;
    if (t.isUnit) t.hitStop = a.hitStop;
    this.damage(t, dmg, a, undefined, heavy ? 2.8 : 1.6);
    if (heavy) this.shake(a.def.hero ? 0.22 : 0.12, t.pos);
    // big blows carry through to enemies standing next to the target
    if (a.def.cleave) {
      for (const e of this.units) {
        if (!e.alive || e === t || e.team === a.team) continue;
        if (Math.hypot(e.pos.x - t.pos.x, e.pos.z - t.pos.z) - e.radius > a.def.cleave) continue;
        if (this.distTo(a, e) > a.def.range + 1.2) continue;
        this.damage(e, dmg * 0.5, a, undefined, 2);
      }
    }
  }

  damage(t, amount, attacker, vsBuilding = attacker?.def?.vsBuilding || 1, push = 0, from = attacker) {
    if (!t.alive) return;
    let dmg = Math.max(1, amount - (t.def.armor || 0));
    if (t.isBuilding) dmg *= vsBuilding;
    if (t.isBuilding && !t.complete) dmg *= 1.5;
    if (t.wallT > 0) dmg *= 1 - (t.wallReduce || 0);
    if (this.saga && t === this.keeps[PLAYER] && t.hp - dmg <= 0) { this.saga.sack(); return; }
    t.hp -= dmg;
    t.flash();
    t.updateHpBar();
    t.lastHitFrom = from?.pos ? { x: from.pos.x, z: from.pos.z } : null;
    if (t.isUnit) t.onHit(from, dmg, push);
    if (dmg >= 20) this.hooks.onFloat?.(t.pos, `${Math.round(dmg)}`, t.team === PLAYER ? 'hurt' : 'dmg');
    if (t.team === PLAYER && this.time - this.attackAlertT > 12 && attacker && attacker.team !== PLAYER) {
      this.attackAlertT = this.time;
      this.notify(t.isBuilding ? 'Your base is under attack!' : 'Your forces are under attack!', 'warn');
      this.hooks.onAttackAlert?.(t.pos);
    }
    // retaliate / call for help
    if (t.isUnit && attacker && attacker.alive && t.alive) {
      if (t.state === 'idle' || (t.type === 'worker' && t.state !== 'attack' && attacker.isUnit && attacker.def.range < 2 && t.team === ENEMY)) {
        if (t.def.aggro || this.distTo(t, attacker) < 2) t.attack(attacker, true);
      }
      for (const u of this.units) {
        if (u.alive && u.team === t.team && u.state === 'idle' && u.def.aggro && u.pos.distanceTo(t.pos) < 9) u.attack(attacker, true);
      }
    }
    if (t.hp <= 0) this.kill(t, attacker);
  }
  kill(e, by) {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    if (e.selected) { e.setSelected(false); this.selection = this.selection.filter((s) => s !== e); this.hooks.onSelectionChange?.(); }
    if (e.hpBar) e.hpBar.visible = false;
    if (by && by.team !== undefined) this.teams[by.team].killed++;
    this.teams[e.team].lost++;
    this.saga?.onKill(e, by);
    if (e.isUnit) {
      e.swingT = -1;
      e.special = null;
      e.staggerT = 0;
      // the killing blow throws the body back
      const f = e.lastHitFrom;
      if (f) {
        const dx = e.pos.x - f.x, dz = e.pos.z - f.z, d = Math.hypot(dx, dz) || 1;
        const k = by?.def?.heavy || by?.def?.splash ? 4.5 : 2.2;
        e.kb.x += (dx / d) * k; e.kb.y += (dz / d) * k;
        e.yaw = Math.atan2(-dx, -dz); // fall away from the blow
        e.obj.rotation.y = e.yaw;
      }
      e.hitStop = 0.1;
      if (e.mixer) e.playAnim(Math.random() < 0.5 ? 'Death_A' : 'Death_B', 1.15, true, 0.05);
      else {
        e.obj.remove(e.model);
        e.model = this.factory.prefabs.catapultWreck.clone(true);
        e.obj.add(e.model);
        this.fx.explosion(e.pos);
      }
      if (e.carryObj) e.carryObj.visible = false;
      this.recomputePop();
    } else {
      this.grid.occupy(e.cx, e.cz, e.size, e.size, -1);
      this.fx.explosion(e.pos);
      this.fx.dust(e.pos, e.size * 0.7, 26);
      if (e.scaffold) e.obj.remove(e.scaffold);
      e.collapseT = 0;
      e.rubbleT = 0;
      for (const b of this.buildings) if (b.attackTarget === e) b.attackTarget = null;
      this.recomputePop();
      if (e.type === 'keep' && !this.viking) this.endGame(e.team === PLAYER ? 'defeat' : 'victory');
    }
  }
  endGame(result) {
    if (this.over) return;
    this.over = result;
    const winner = result === 'victory' ? PLAYER : ENEMY;
    for (const u of this.units) if (u.alive && u.team === winner) u.cheer();
    this.hooks.onGameOver?.(result);
  }

  // ---- player commands ----------------------------------------------------------------------
  notify(text, kind = 'info', key = text, every = 3) {
    const now = performance.now() / 1000;
    if (this.notifyT[key] && now - this.notifyT[key] < every) return;
    this.notifyT[key] = now;
    this.hooks.onNotify?.(text, kind);
  }
  commandRightClick(sel, ground, ent) {
    const own = sel.filter((e) => e.alive && e.team === PLAYER);
    if (!own.length) return;
    const units = own.filter((e) => e.isUnit);
    const blds = own.filter((e) => e.isBuilding);
    if (!units.length && blds.length) {
      // set rally points
      for (const b of blds) {
        if (!b.trains) continue;
        if (ent && ent.isResource) b.rally = { x: ent.pos.x, z: ent.pos.z, resource: ent };
        else if (ground) b.rally = { x: ground.x, z: ground.z };
      }
      if (ground) this.fx.marker(ground, 0xe8c46a);
      return;
    }
    if (ent && ent.alive !== false && ent.team !== undefined && ent.team !== PLAYER && !ent.isResource) {
      for (const u of units) u.attack(ent);
      this.fx.marker(ent.pos, 0xff5544);
      return;
    }
    const workers = units.filter((u) => u.type === 'worker');
    const others = units.filter((u) => u.type !== 'worker');
    if (!ent && ground && workers.length) ent = this.resourceNear(ground, 1.9);
    if (ent && ent.isResource && workers.length) {
      for (const w of workers) w.gather(ent);
      this.fx.marker(ent.pos, 0x7dff8a);
      if (others.length) this.formationMove(others, ent.pos.x, ent.pos.z, false);
      return;
    }
    if (ent && ent.isBuilding && ent.team === PLAYER && workers.length) {
      if (!ent.complete) for (const w of workers) w.build(ent);
      else if (ent.def.dropoff) {
        // right-click a drop-off: return what they carry, then work the resources around it
        const kind = ent.def.dropoff === 'all' ? null : ent.def.dropoff;
        for (const w of workers) {
          const r = this.nearestResource(kind || w.lastRes?.kind || 'crystal', ent.pos, 16, w);
          if (r) w.lastRes = r;
          if (w.carry) w.returnCargo(); else if (r) w.gather(r); else w.stop();
        }
      }
      this.fx.marker(ent.pos, 0x7dff8a);
      if (others.length) this.formationMove(others, ent.pos.x, ent.pos.z, false);
      return;
    }
    if (ground) {
      this.formationMove(units, ground.x, ground.z, false);
      this.fx.marker(ground, 0x7dff8a);
    }
  }
  formationMove(units, x, z, attackMove) {
    const n = units.length;
    const cols = Math.ceil(Math.sqrt(n));
    const sp = 1.15;
    // keep the group's facing: rows perpendicular to the travel direction
    let cx = 0, cz = 0;
    for (const u of units) { cx += u.pos.x; cz += u.pos.z; }
    cx /= n; cz /= n;
    const ang = Math.atan2(x - cx, z - cz);
    const fx = Math.sin(ang), fz = Math.cos(ang), rx = fz, rz = -fx;
    const sorted = [...units].sort((a, b) => (a.def.range > 2) - (b.def.range > 2)); // melee in front
    sorted.forEach((u, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const ox = (c - (cols - 1) / 2) * sp, oz = -r * sp;
      let tx = x + rx * ox + fx * oz, tz = z + rz * ox + fz * oz;
      if (!this.grid.freeAt(tx, tz)) { const p = this.grid.nearestFree(tx, tz, 4); if (p) { tx = p.x; tz = p.z; } }
      u.moveTo(tx, tz, attackMove);
    });
  }

  // ---- frame --------------------------------------------------------------------------------
  update(dt) {
    if (this.over) dt *= 0.25;
    this.time += dt;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    this.saga?.update(dt);
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (!u.update(dt)) { this.scene.remove(u.obj); this.units.splice(i, 1); }
    }
    this.separate(dt);
    for (let i = this.buildings.length - 1; i >= 0; i--) {
      const b = this.buildings[i];
      if (!b.alive) {
        b.rubbleT += dt;
        if (b.collapseT !== null && b.collapseT !== undefined) {
          // the building sinks into a cloud of dust, then the ruins are left behind
          b.collapseT += dt;
          b.vis.position.y = -b.collapseT * b.height * 0.9;
          b.vis.rotation.z = Math.sin(b.collapseT * 9) * 0.02;
          if (Math.random() < dt * 20) this.fx.dust(b.pos, b.size * 0.5, 2);
          if (b.collapseT > 1.1) {
            b.obj.remove(b.vis);
            b.obj.add(this.factory.makeRubble(b.size));
            b.collapseT = null;
          }
        }
        if (b.rubbleT > 30) { this.scene.remove(b.obj); this.buildings.splice(i, 1); }
        continue;
      }
      b.update(dt);
    }
    this.updateProjectiles(dt);
    this.fx.update(dt);
    if (!this.over && this.aiEnabled !== false) this.ai?.update(dt);
    this.hpBarT = (this.hpBarT || 0) - dt;
    if (this.hpBarT <= 0) {
      this.hpBarT = 0.2;
      for (const u of this.units) u.updateHpBar();
      for (const b of this.buildings) b.updateHpBar();
    }
  }
  separate(dt) {
    const us = this.units;
    const g = this.grid;
    for (let i = 0; i < us.length; i++) {
      const a = us[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < us.length; j++) {
        const b = us[j];
        if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) * 0.5 * Math.min(1, dt * 10);
        const nx = d2 > 1e-6 ? dx / d : Math.random() - 0.5, nz = d2 > 1e-6 ? dz / d : Math.random() - 0.5;
        // the busy (working) unit holds its ground
        const wa = a.working ? 0.2 : b.working ? 1.8 : 1, wb = 2 - wa;
        const ax = a.pos.x - nx * push * wa, az = a.pos.z - nz * push * wa;
        const bx = b.pos.x + nx * push * wb, bz = b.pos.z + nz * push * wb;
        if (g.freeAt(ax, az)) { a.pos.x = ax; a.pos.z = az; }
        if (g.freeAt(bx, bz)) { b.pos.x = bx; b.pos.z = bz; }
      }
    }
  }

  // ---- picking ------------------------------------------------------------------------------
  pick(ray) {
    let best = null, bt = Infinity;
    const c = new THREE.Vector3();
    // each thing is a vertical capsule from its base to its top, so clicking anywhere on it counts
    const a = new THREE.Vector3(), hit = new THREE.Vector3();
    const test = (e, cy, r, top) => {
      a.set(e.pos.x, e.pos.y + 0.1, e.pos.z);
      c.set(e.pos.x, top ?? cy, e.pos.z);
      const d2 = ray.ray.distanceSqToSegment(a, c, hit);
      const t = d2 <= r * r ? ray.ray.origin.distanceTo(hit) : Infinity;
      if (t < bt) { bt = t; best = e; }
    };
    for (const u of this.units) if (u.alive) test(u, u.pos.y + u.height * 0.5, Math.max(u.radius + 0.15, u.height * 0.55));
    for (const b of this.buildings) if (b.alive) test(b, b.pos.y + Math.min(b.height, 3) * 0.5, b.size * 0.62);
    if (!best) {
      for (const r of this.resources) if (r.alive) test(r, 0, r.kind === 'wood' ? 1.15 : 0.85, r.pos.y + (r.kind === 'wood' ? 3.2 : 1.4));
    }
    return best;
  }
}

export { PLAYER, ENEMY };
