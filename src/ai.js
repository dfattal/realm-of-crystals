import { BUILDING_TYPES, UNIT_TYPES, PLAYER } from './config.js';
import { BASES } from './terrain.js';

// The Bone Legion: a simple but complete RTS opponent. It runs an economy (workers on crystal
// and wood), expands supply, builds production and towers, trains a mixed army, defends its base
// and sends growing attack waves at the player.
export class AI {
  constructor(game, team, diff) {
    this.game = game;
    this.team = team;
    this.diff = diff;
    this.t = 0;
    this.acc = 0;
    this.waveSize = diff.wave;
    this.nextAttack = diff.firstAttack;
    this.attacking = new Set();
    this.home = BASES[team];
    this.enemyHome = BASES[1 - team];
    this.trainToggle = 0;
  }

  onSpawn(u) {
    if (u.team !== this.team) return;
    if (u.type === 'worker') this.assignWorker(u);
  }

  mine(type) { return this.game.buildings.filter((b) => b.alive && b.team === this.team && b.type === type && !b.outpost); }

  update(dt) {
    this.t += dt;
    this.acc += dt;
    if (this.acc < 0.8) return;
    this.acc = 0;
    this.think();
  }

  assignWorker(w) {
    const g = this.game;
    const workers = g.units.filter((u) => u.alive && u.team === this.team && u.type === 'worker');
    const onWood = workers.filter((u) => (u.state === 'gather' || u.state === 'return') && u.lastRes?.kind === 'wood').length;
    const wantWood = Math.round(workers.length * (this.t < 120 ? 0.35 : 0.45));
    const kind = onWood < wantWood ? 'wood' : 'crystal';
    const keep = g.keeps[this.team];
    const r = g.nearestResource(kind, keep.alive ? keep.pos : w.pos, 60, w) || g.nearestResource(kind === 'wood' ? 'crystal' : 'wood', w.pos, 80, w);
    if (r) w.gather(r);
  }

  findSpot(type, near, dirX, dirZ, push) {
    const g = this.game;
    const s = BUILDING_TYPES[type].size;
    const px = near.x + dirX * push, pz = near.z + dirZ * push;
    const ccx = g.grid.cell(px) - Math.floor(s / 2), ccz = g.grid.cell(pz) - Math.floor(s / 2);
    for (let r = 0; r < 14; r++) {
      const cands = [];
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        cands.push([ccx + dx, ccz + dz]);
      }
      for (const [cx, cz] of cands) {
        if (g.canPlace(type, cx, cz, 1)) {
          // keep the crystal line and the keep's doorway clear
          const wx = cx - 48 + s / 2, wz = cz - 48 + s / 2;
          let bad = false;
          for (const res of g.resources) if (res.alive && res.kind === 'crystal' && Math.hypot(res.pos.x - wx, res.pos.z - wz) < s / 2 + 2.2) { bad = true; break; }
          if (!bad) return [cx, cz];
        }
      }
    }
    return null;
  }

  tryBuild(type, push = 8) {
    const g = this.game;
    const def = BUILDING_TYPES[type];
    if (!g.canAfford(this.team, def.cost)) return false;
    if (def.requires && !g.hasBuilding(this.team, def.requires)) return false;
    const keep = g.keeps[this.team];
    if (!keep.alive) return false;
    const dx = this.enemyHome.x - this.home.x, dz = this.enemyHome.z - this.home.z, d = Math.hypot(dx, dz);
    // mills toward the back, military toward the front
    const sign = type === 'house' ? -0.4 : 1;
    const jitter = (Math.random() - 0.5) * 1.2;
    const ang = Math.atan2(dz, dx) + jitter;
    const spot = this.findSpot(type, keep.pos, Math.cos(ang) * sign, Math.sin(ang) * sign, push);
    if (!spot) return false;
    const workers = g.units.filter((u) => u.alive && u.team === this.team && u.type === 'worker' && u.state !== 'build');
    if (!workers.length) return false;
    workers.sort((a, b) => a.pos.distanceTo(keep.pos) - b.pos.distanceTo(keep.pos));
    const n = type === 'tower' || type === 'house' || type === 'mine' || type === 'lumbermill' ? 1 : 2;
    const builders = workers.slice(0, n);
    const b = g.placeBuilding(type, this.team, spot[0], spot[1], builders);
    return !!b;
  }

  // drop-off buildings go next to the resource the workers are actually harvesting
  tryBuildNear(type, kind, minFromKeep = 8) {
    const g = this.game;
    const keep = g.keeps[this.team];
    const res = g.resources.filter((r) => r.alive && r.kind === kind && Math.hypot(r.pos.x - keep.pos.x, r.pos.z - keep.pos.z) > minFromKeep && Math.hypot(r.pos.x - keep.pos.x, r.pos.z - keep.pos.z) < 26);
    if (!res.length || !g.canAfford(this.team, BUILDING_TYPES[type].cost)) return false;
    res.sort((a, b) => Math.hypot(a.pos.x - keep.pos.x, a.pos.z - keep.pos.z) - Math.hypot(b.pos.x - keep.pos.x, b.pos.z - keep.pos.z));
    const r = res[0];
    const s = BUILDING_TYPES[type].size;
    for (let rad = 2; rad < 9; rad++) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const cx = g.grid.cell(r.pos.x + Math.cos(a) * rad) - Math.floor(s / 2), cz = g.grid.cell(r.pos.z + Math.sin(a) * rad) - Math.floor(s / 2);
        if (!g.canPlace(type, cx, cz, 1)) continue;
        const w = g.units.filter((u) => u.alive && u.team === this.team && u.type === 'worker' && u.state !== 'build').sort((a1, b1) => a1.pos.distanceTo(r.pos) - b1.pos.distanceTo(r.pos))[0];
        if (!w) return false;
        return !!g.placeBuilding(type, this.team, cx, cz, [w]);
      }
    }
    return false;
  }

  think() {
    const g = this.game;
    const st = g.teams[this.team];
    const keep = g.keeps[this.team];
    if (!keep || !keep.alive) return;
    const units = g.units.filter((u) => u.alive && u.team === this.team && !u.guard);
    const workers = units.filter((u) => u.type === 'worker');
    const army = units.filter((u) => u.type !== 'worker');

    // idle workers back to work; finish abandoned construction sites
    const sites = g.buildings.filter((b) => b.alive && b.team === this.team && !b.complete);
    for (const s of sites) {
      if (!workers.some((w) => w.state === 'build' && w.target === s)) {
        const w = workers.find((u) => u.state !== 'build');
        if (w) w.build(s);
      }
    }
    for (const w of workers) if (w.state === 'idle') this.assignWorker(w);

    // economy
    if (workers.length < this.diff.maxWorkers && keep.queue.length < 2 && (army.length >= 2 || workers.length < 12 || st.crystal > 200)) {
      g.train(keep, 'worker');
    }
    const building = (type) => sites.some((s) => s.type === type);
    if (st.popCap - st.pop <= 4 && st.popCap < 80 && !building('house')) this.tryBuild('house', 7);
    if (this.t > 70 && this.mine('lumbermill').length === 0 && !building('lumbermill')) this.tryBuildNear('lumbermill', 'wood');
    if (this.t > 150 && this.mine('mine').length === 0 && !building('mine')) this.tryBuildNear('mine', 'crystal', 14);

    const barracks = this.mine('barracks');
    const towers = this.mine('tower');
    const workshops = this.mine('workshop');
    if (barracks.length === 0 && workers.length >= 8 && !building('barracks')) this.tryBuild('barracks', 8);
    if (barracks.length === 1 && this.t > 360 && workers.length >= 14 && !building('barracks')) this.tryBuild('barracks', 9);
    if (towers.length < (this.t > 420 ? 3 : 1) && this.t > 200 && !building('tower')) this.tryBuild('tower', 10);
    const archeries = this.mine('archery');
    const sanctums = this.mine('sanctum');
    if (archeries.length === 0 && this.t > 200 && barracks.length && !building('archery')) this.tryBuild('archery', 9);
    if (sanctums.length === 0 && this.t > 380 && barracks.some((b) => b.complete) && !building('sanctum')) this.tryBuild('sanctum', 8);
    if (workshops.length === 0 && this.t > 330 && barracks.some((b) => b.complete) && !building('workshop')) this.tryBuild('workshop', 9);

    // military production, capped per difficulty so the Legion never just out-masses the player
    const armyPop = army.reduce((n, u) => n + u.def.pop, 0) + [...barracks, ...archeries, ...sanctums, ...workshops].reduce((n, b) => n + b.queue.length, 0);
    const canArm = armyPop < this.diff.maxArmy;
    if (canArm) for (const b of barracks) {
      if (!b.complete || b.queue.length >= 2) continue;
      const knights = army.filter((u) => u.type === 'knight').length;
      const rangers = army.filter((u) => u.type === 'ranger').length;
      g.train(b, 'knight');
    }
    if (canArm) for (const b of archeries) if (b.complete && b.queue.length < 2) g.train(b, 'ranger');
    if (canArm) for (const b of sanctums) if (b.complete && b.queue.length < 1 && army.filter((u) => u.type === 'mage').length < 5) g.train(b, 'mage');
    if (canArm) for (const w of workshops) {
      if (!w.complete || w.queue.length >= 1) continue;
      if (army.filter((u) => u.type === 'catapult').length < 3) g.train(w, 'catapult');
    }
    for (const b of [...barracks, ...workshops, ...archeries, ...sanctums]) b.rally = { x: keep.pos.x + (this.enemyHome.x - this.home.x) * 0.12, z: keep.pos.z + (this.enemyHome.z - this.home.z) * 0.12 };

    // defence: any player unit near our buildings?
    let threat = null, td = Infinity;
    for (const u of g.units) {
      if (!u.alive || u.team === this.team) continue;
      for (const b of g.buildings) {
        if (!b.alive || b.team !== this.team || b.outpost) continue;
        const d = Math.hypot(u.pos.x - b.pos.x, u.pos.z - b.pos.z);
        if (d < 14 && d < td) { td = d; threat = u; }
      }
    }
    if (threat) {
      for (const a of army) if (a.state !== 'attack' || !a.target?.alive) a.attack(threat, true);
      // pull workers to fight when the keep itself is in trouble
      if (keep.hp < keep.maxHp * 0.5) for (const w of workers.slice(0, 6)) if (w.state !== 'attack') w.attack(threat, true);
      return;
    }

    // attack waves
    const ready = army.filter((u) => !this.attacking.has(u));
    if (this.t >= this.nextAttack && ready.length >= Math.min(this.waveSize, Math.floor(this.diff.maxArmy * 0.75))) {
      const target = this.pickTarget();
      if (target) {
        for (const u of ready) { this.attacking.add(u); u.moveTo(target.x + (Math.random() - 0.5) * 3, target.z + (Math.random() - 0.5) * 3, true); }
        this.waveSize += this.diff.waveGrow;
        this.nextAttack = this.t + this.diff.interval;
        g.notify('An enemy army is marching on you!', 'warn', 'wave');
      }
    }
    // keep the wave moving until it dies
    for (const u of this.attacking) {
      if (!u.alive) { this.attacking.delete(u); continue; }
      if (u.state === 'idle') {
        const t = this.pickTarget();
        if (t) u.moveTo(t.x, t.z, true);
      }
    }
    // gather the rest of the army at the rally point
    for (const u of ready) {
      if (u.state === 'idle' && barracks[0]?.rally) {
        const r = barracks[0].rally;
        if (Math.hypot(u.pos.x - r.x, u.pos.z - r.z) > 6) u.moveTo(r.x + (Math.random() - 0.5) * 4, r.z + (Math.random() - 0.5) * 4);
      }
    }
  }

  pickTarget() {
    const g = this.game;
    // prefer outlying player buildings, then the keep
    let best = null, bd = Infinity;
    for (const b of g.buildings) {
      if (!b.alive || b.team !== PLAYER) continue;
      const d = Math.hypot(b.pos.x - this.home.x, b.pos.z - this.home.z) + (b.type === 'keep' ? 6 : 0);
      if (d < bd) { bd = d; best = b; }
    }
    return best ? { x: best.pos.x, z: best.pos.z } : null;
  }
}

export { UNIT_TYPES };
