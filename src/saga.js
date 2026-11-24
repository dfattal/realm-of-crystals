import * as THREE from 'three';
import { UNIT_TYPES, BUILDING_TYPES, PLAYER, ENEMY, SAGA, VIKING } from './config.js';
import { BASES } from './terrain.js';

// Clan Saga: the persistent Viking mode. Your city, heroes and troops are saved in the browser
// and keep growing between sessions. Buildings level up on real-time timers (they finish while you
// are away), heroes gain levels and lead warbands, Barbarian camps (Lv 1-10) respawn across the
// map, and raiders come for your Great Hall every few minutes.

const KEY = 'roc-saga-v1';
export function loadSave() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
export function clearSave() { try { localStorage.removeItem(KEY); } catch { /* storage blocked */ } }

const round10 = (v) => Math.round(v / 10) * 10;
export const fmtTime = (s) => {
  s = Math.max(0, Math.ceil(s));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
};
const xpToNext = (lvl) => 30 + lvl * 20;

function labelSprite(text, color = '#ffd27a') {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(20,12,10,0.72)';
  ctx.beginPath(); ctx.roundRect(8, 8, 240, 48, 14); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true }));
  sp.scale.set(3.4, 0.85, 1);
  sp.renderOrder = 5;
  return sp;
}

export class Saga {
  constructor(game, save) {
    this.game = game;
    this.save0 = save;
    this.heroes = {};
    for (const id of Object.keys(SAGA.heroes)) this.heroes[id] = { id, xp: 0, level: 1, unit: null, respawnT: -1, unlocked: false };
    this.camps = [];
    this.campT = 0;
    this.raid = null;
    this.raidT = SAGA.firstRaid;
    this.raidWarned = false;
    this.campsCleared = 0;
    this.maxCleared = 0;
    this.plunder = 0;
    this.saveT = 15;
    this.tick = 0;
    this.away = [];
    this.wounded = [];          // fallen troops waiting in the Infirmary: { type, tier, band }
    this.healT = 0;
    this.auraT = 1;
    this.woundMsgT = 0;
    const diffMul = { Easy: 0.8, Normal: 1, Hard: 1.25 }[game.difficulty.label] || 1;
    this.campMul = diffMul;
    this.spots = this.findSpots();
  }

  // ---- setup / persistence --------------------------------------------------------------------
  // Called by Game once the player's Great Hall exists (enemy base is not built in this mode).
  init() {
    const g = this.game, s = this.save0;
    if (s) this.restore(s);
    else {
      // a fresh clan: five thralls at work
      g.units.filter((u) => u.team === PLAYER && u.type === 'worker').forEach((u, i) => {
        const r = g.nearestResource(i < 3 ? 'crystal' : 'wood', u.pos, 30, u);
        if (r) u.gather(r);
      });
    }
    this.checkHeroUnlocks(true);
    // heroes that were drilling when the game closed go straight back to the yard
    for (const id of s?.training || []) if (this.heroes[id]?.unit) this.sendToYard(this.heroes[id].unit, true);
    while (this.camps.length < SAGA.camps) if (!this.spawnCamp()) break;
    g.recomputePop();
  }

  restore(s) {
    const g = this.game;
    const st = g.teams[PLAYER];
    st.crystal = s.res?.crystal ?? st.crystal;
    st.wood = s.res?.wood ?? st.wood;
    Object.assign(st, { gathered: s.stats?.gathered || 0, killed: s.stats?.killed || 0, lost: s.stats?.lost || 0 });
    this.plunder = s.stats?.plunder || 0;
    this.campsCleared = s.stats?.campsCleared || 0;
    this.maxCleared = s.stats?.maxCleared || 0;
    this.raidT = s.raidT ?? SAGA.firstRaid;
    g.time = s.playTime || 0;
    // the starting thralls are replaced by the saved population
    for (const u of g.units) if (u.team === PLAYER) { g.scene.remove(u.obj); u.alive = false; }
    g.units = g.units.filter((u) => u.alive);
    const keep = g.keeps[PLAYER];
    for (const b of s.buildings || []) {
      let bb;
      if (b.type === 'keep') bb = keep;
      else {
        this.clearFootprint(b.type, b.cx, b.cz);
        if (!g.canPlace(b.type, b.cx, b.cz)) continue;
        bb = g.addBuilding(b.type, PLAYER, b.cx, b.cz, !!b.complete);
        if (!b.complete) { bb.progress = 0; bb.addProgress(b.progress || 0); }
      }
      bb.level = b.level || 1;
      this.applyBuildingLevel(bb, true);
      if (b.hp != null && bb.complete) bb.hp = Math.max(1, Math.round(bb.maxHp * b.hp));
      if (b.upg) bb.upg = b.upg;
      if (b.rally) bb.rally = { x: b.rally.x, z: b.rally.z };
    }
    for (const [id, h] of Object.entries(s.heroes || {})) {
      if (!this.heroes[id]) continue;
      this.heroes[id].xp = h.xp || 0;
      this.heroes[id].level = h.level || 1;
    }
    for (const u of s.units || []) {
      const p = g.grid.nearestFree(u.x, u.z) || g.grid.nearestFree(BASES[PLAYER].x + 4, BASES[PLAYER].z - 4);
      if (!p) continue;
      const nu = g.spawnUnit(u.type, PLAYER, p.x, p.z);
      this.setTier(nu, u.tier || 1);
      if (u.hp != null) nu.hp = Math.max(1, Math.round(nu.maxHp * u.hp));
      if (u.band) nu.band = u.band;
      if (nu.type === 'worker') g.autoGather(nu);
    }
    for (const c of s.camps || []) this.spawnCamp(c);
    this.wounded = (s.wounded || []).filter((w) => UNIT_TYPES[w.type]);
    // time away: finished upgrades and the hall's tribute
    const away = Math.max(0, (Date.now() - (s.t || Date.now())) / 1000);
    this.checkUpgrades();
    if (away > 60) {
      const mins = Math.min(away, 8 * 3600) / 60;
      const lvl = keep.level || 1;
      const c = Math.round(mins * lvl * 3), w = Math.round(mins * lvl * 3);
      st.crystal += c; st.wood += w;
      this.away.push(`While you were away (${fmtTime(away)}), your hall collected ${c} crystal and ${w} wood in tribute.`);
    }
    if (away > 30) {
      const secs = Math.min(away, 8 * 3600);
      // the infirmary kept healing
      if (this.wounded.length && this.infirmaries().length) {
        g.recomputePop();
        let n = 0;
        for (let t = this.healInterval(); t <= secs && this.wounded.length; t += this.healInterval()) { if (!this.healOne(true)) break; n++; }
        if (n) this.away.push(`The Infirmary healed ${n} wounded warrior${n > 1 ? 's' : ''} while you were away.`);
      }
      // heroes kept drilling at the yard
      const yard = this.yardFor();
      if (yard) {
        for (const id of s.training || []) {
          const h = this.heroes[id];
          if (!h) continue;
          const before = h.level;
          this.trainXp(h, yard, secs * SAGA.yard.offline, true);
          if (h.level > before) this.away.push(`${SAGA.heroes[id].name} trained at the yard and reached level ${h.level}.`);
        }
      }
    }
  }

  clearFootprint(type, cx, cz) {
    const g = this.game, s = BUILDING_TYPES[type].size;
    for (const r of g.resources) {
      if (r.alive && r.cx >= cx && r.cx < cx + s && r.cz >= cz && r.cz < cz + s) r.deplete();
    }
  }

  serialize() {
    const g = this.game;
    const st = g.teams[PLAYER];
    const buildings = g.buildings.filter((b) => b.alive && b.team === PLAYER).map((b) => ({
      type: b.type, cx: b.cx, cz: b.cz, level: b.level || 1, complete: b.complete, progress: b.progress,
      hp: b.complete ? +(b.hp / b.maxHp).toFixed(3) : null, upg: b.upg || null,
      rally: b.rally && !b.rally.resource ? { x: b.rally.x, z: b.rally.z } : null,
    }));
    const units = g.units.filter((u) => u.alive && u.team === PLAYER && !u.def.hero).map((u) => ({
      type: u.type, x: +u.pos.x.toFixed(1), z: +u.pos.z.toFixed(1), tier: u.tier || 1, hp: +(u.hp / u.maxHp).toFixed(3), band: u.band || null,
    }));
    // units still in training are refunded into the treasury so nothing is lost
    let crystal = st.crystal, wood = st.wood;
    for (const b of g.buildings) if (b.alive && b.team === PLAYER) for (const t of b.queue) { crystal += UNIT_TYPES[t].cost.crystal || 0; wood += UNIT_TYPES[t].cost.wood || 0; }
    const heroes = {};
    for (const [id, h] of Object.entries(this.heroes)) heroes[id] = { xp: h.xp, level: h.level };
    return {
      v: 1, t: Date.now(), playTime: Math.round(g.time),
      res: { crystal: Math.floor(crystal), wood: Math.floor(wood) },
      stats: { gathered: st.gathered, killed: st.killed, lost: st.lost, plunder: this.plunder, campsCleared: this.campsCleared, maxCleared: this.maxCleared },
      buildings, units, heroes,
      camps: this.camps.filter((c) => !c.cleared).map((c) => ({ x: c.x, z: c.z, level: c.level })),
      raidT: Math.round(this.raid ? SAGA.raidEvery[0] : this.raidT),
      wounded: this.wounded,
      training: Object.values(this.heroes).filter((h) => h.unit?.alive && h.unit.drill).map((h) => h.id),
    };
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.serialize())); } catch { /* storage full / blocked */ }
  }

  // ---- building levels ------------------------------------------------------------------------
  hallLevel() { return this.game.keeps[PLAYER]?.level || 1; }
  maxLevelFor(b) { return b.type === 'keep' ? SAGA.maxLevel : Math.min(SAGA.maxLevel, this.hallLevel()); }
  upgradeCost(b) {
    const to = (b.level || 1) + 1;
    const base = b.type === 'keep' ? { crystal: 300, wood: 300 } : b.def.cost;
    const m = 0.7 * Math.pow(1.5, to - 2);
    return { crystal: round10((base.crystal || 30) * m), wood: round10((base.wood || 30) * m) };
  }
  upgradeTime(b) {
    const to = (b.level || 1) + 1;
    return Math.round(Math.max(10, b.def.time * 0.8) * Math.pow(1.3, to - 2));
  }
  buildersBusy() { return this.game.buildings.filter((b) => b.alive && b.team === PLAYER && b.upg).length; }
  canUpgrade(b) {
    if (!b.complete || b.upg) return 'busy';
    if ((b.level || 1) >= SAGA.maxLevel) return 'max';
    if ((b.level || 1) >= this.maxLevelFor(b)) return 'hall';
    if (this.buildersBusy() >= SAGA.builders) return 'builders';
    if (!this.game.canAfford(PLAYER, this.upgradeCost(b))) return 'cost';
    return null;
  }
  startUpgrade(b) {
    const g = this.game;
    const why = this.canUpgrade(b);
    if (why) {
      const msg = { busy: 'Already upgrading', max: 'Already at the highest level', hall: `Upgrade the Great Hall first (buildings can't pass its level)`,
        builders: `All ${SAGA.builders} builders are busy`, cost: null }[why];
      if (why === 'cost') g.notifyCost(this.upgradeCost(b)); else g.notify(msg, 'warn', `upg${why}`);
      return false;
    }
    g.pay(PLAYER, this.upgradeCost(b));
    const dur = this.upgradeTime(b);
    b.upg = { to: (b.level || 1) + 1, end: Date.now() + dur * 1000, dur };
    g.fx.dust(b.pos, b.size * 0.6, 14);
    g.notify(`${b.label} upgrading to Lv ${b.upg.to} (${fmtTime(dur)})`, 'info', `up${b.id}`, 0);
    this.save();
    return true;
  }
  checkUpgrades() {
    const g = this.game;
    const now = Date.now();
    for (const b of g.buildings) {
      if (!b.alive || !b.upg || b.upg.end > now) continue;
      b.level = b.upg.to;
      b.upg = null;
      this.applyBuildingLevel(b);
      g.fx.levelUp(b.pos);
      g.fx.dust(b.pos, b.size * 0.6, 18);
      const msg = `${b.label} reached Lv ${b.level}!`;
      if (g.started) g.notify(msg, 'good', `lvl${b.id}`, 0); else this.away.push(msg);
      if (b.type === 'keep') { this.onHallLevel(b.level); }
      g.recomputePop();
      this.save();
    }
  }
  applyBuildingLevel(b, silent = false) {
    const L = b.level || 1;
    const max = Math.round(b.def.hp * (1 + 0.2 * (L - 1)));
    const gain = max - b.maxHp;
    b.maxHp = max;
    b.dmgMul = 1 + 0.15 * (L - 1);
    if (b.complete) b.hp = Math.min(max, b.hp + Math.max(0, gain));
    if (b.model && b.complete) b.vis.scale.setScalar(1 + 0.03 * (L - 1));
    if (!silent) b.updateHpBar();
  }
  onHallLevel(L) {
    const unlocked = Object.entries(SAGA.hallReq).filter(([, l]) => l === L).map(([t]) => this.game.buildingLabel(t, PLAYER));
    if (unlocked.length) this.game.notify(`New buildings: ${unlocked.join(', ')}`, 'good', `unl${L}`, 0);
    this.checkHeroUnlocks();
  }
  popFor(b) {
    const L = b.level || 1;
    if (b.type === 'keep') return 10 + 3 * (L - 1);
    if (b.type === 'house') return 6 + 2 * (L - 1);
    return b.def.pop || 0;
  }
  // more resources per trip at upgraded drop-offs
  dropBonus(b) { return b ? 1 + (b.type === 'keep' ? 0.05 : 0.1) * ((b.level || 1) - 1) : 1; }

  // ---- troops ---------------------------------------------------------------------------------
  setTier(u, tier, hpK = 0.12, dmgK = 0.1) {
    u.tier = tier;
    const max = Math.round(u.def.hp * (1 + hpK * (tier - 1)));
    u.hp = Math.round(u.hp / u.maxHp * max);
    u.maxHp = max;
    u.dmgMul = 1 + dmgK * (tier - 1);
  }
  onTrained(u, b) { if (u.team === PLAYER && !u.def.hero) this.setTier(u, b.level || 1); }

  // ---- heroes ---------------------------------------------------------------------------------
  checkHeroUnlocks(quiet = false) {
    const hall = this.hallLevel();
    for (const [id, h] of Object.entries(this.heroes)) {
      const def = SAGA.heroes[id];
      if (h.unlocked || hall < def.hall) continue;
      h.unlocked = true;
      this.spawnHero(id);
      if (!quiet || id !== 'jarl') this.game.notify(`${def.name} joins your clan!`, 'good', `hero${id}`, 0);
    }
  }
  spawnHero(id) {
    const g = this.game, h = this.heroes[id];
    const keep = g.keeps[PLAYER];
    const b = BASES[PLAYER];
    const k = Object.keys(this.heroes).indexOf(id);
    const p = g.grid.nearestFree(b.x + 4.5 - k * 1.5, b.z - 4.5 - k * 1.5) || { x: b.x + 4.5, z: b.z - 4.5 };
    const u = g.spawnUnit(SAGA.heroes[id].type || id, PLAYER, p.x, p.z);
    u.heroId = id;
    u.label = SAGA.heroes[id].name;
    u.cd = {};
    h.unit = u;
    h.respawnT = -1;
    this.applyHeroLevel(h, true);
    g.fx.magic(u.pos, 0, 1.2);
    if (id === 'jarl') g.jarl = u;
    void keep;
    return u;
  }
  applyHeroLevel(h, full = false) {
    const u = h.unit;
    if (!u || !u.alive) return;
    const L = h.level;
    u.heroLevel = L;
    const max = Math.round(u.def.hp * (1 + 0.08 * (L - 1)));
    u.hp = full ? max : Math.min(max, u.hp + (max - u.maxHp));
    u.maxHp = max;
    u.dmgMul = 1 + 0.07 * (L - 1);
    u.model.scale.setScalar(1 + 0.015 * (L - 1));
  }
  heroOf(u) {
    if (!u) return null;
    if (u.heroId) return this.heroes[u.heroId];
    if (u.band) return this.heroes[u.band];
    return null;
  }
  addXp(h, n) {
    if (!h || h.level >= SAGA.heroMaxLevel) return;
    h.xp += n;
    let up = false;
    while (h.level < SAGA.heroMaxLevel && h.xp >= xpToNext(h.level)) { h.xp -= xpToNext(h.level); h.level++; up = true; }
    if (up) {
      this.applyHeroLevel(h);
      this.game.notify(`${SAGA.heroes[h.id].name} reaches level ${h.level}!`, 'good', `hl${h.id}`, 0);
      if (h.unit?.alive) { this.game.fx.levelUp(h.unit.pos); h.unit.flash(); }
    }
  }
  xpNeeded(h) { return xpToNext(h.level); }
  bandSize(h) { return 5 + Math.floor(h.level / 2); }
  band(h) { return this.game.units.filter((u) => u.alive && u.team === PLAYER && u.band === h.id); }
  formBand(hero, units) {
    const h = this.heroes[hero.heroId];
    const cur = this.band(h);
    const picks = units.filter((u) => !u.def.hero && u.type !== 'worker');
    // selecting only band members toggles them out
    if (picks.length && picks.every((u) => u.band === h.id)) {
      for (const u of picks) u.band = null;
      this.game.notify(`${picks.length} left ${SAGA.heroes[h.id].name}'s warband`, 'info', 'band', 0);
      return;
    }
    let room = this.bandSize(h) - cur.length, n = 0;
    for (const u of picks) { if (u.band === h.id) continue; if (room <= 0) break; u.band = h.id; room--; n++; }
    if (!picks.length) this.game.notify('Select troops together with the hero to form a warband', 'info', 'bandhelp');
    else this.game.notify(n ? `${n} warrior${n > 1 ? 's' : ''} joined the warband (${this.band(h).length}/${this.bandSize(h)})` : `The warband is full (${this.bandSize(h)} at this hero level)`, n ? 'good' : 'warn', 'band', 0);
  }
  marchHome(hero) {
    const g = this.game, h = this.heroes[hero.heroId];
    const k = g.keeps[PLAYER];
    hero.moveTo(k.pos.x + 4, k.pos.z - 4);
    for (const u of this.band(h)) u.followT = 0;
  }
  // followers keep formation behind their hero and join its fights
  updateBands() {
    const g = this.game;
    for (const u of g.units) {
      if (!u.alive || !u.band || u.team !== PLAYER) continue;
      const h = this.heroes[u.band];
      const L = h?.unit;
      if (!L || !L.alive) continue;
      if (u.state === 'attack' || u.state === 'gather' || u.state === 'build') continue;
      if (u.state === 'move' && !u.following) continue; // a direct order from the player
      if (L.state === 'attack' && L.target?.alive && L.target.team !== PLAYER) {
        const e = g.findEnemy(u, Math.max(u.def.aggro, 8)) || L.target;
        u.following = false;
        u.attack(e, true);
        continue;
      }
      const mates = this.band(h);
      const i = mates.indexOf(u);
      const row = Math.floor(i / 3) + 1, col = (i % 3) - 1;
      const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw);
      const tx = L.pos.x - fx * row * 1.3 + fz * col * 1.2, tz = L.pos.z - fz * row * 1.3 - fx * col * 1.2;
      const far = Math.hypot(u.pos.x - tx, u.pos.z - tz);
      const dest = u.dest ? Math.hypot(u.dest.x - tx, u.dest.z - tz) : 99;
      if (far > 2.2 && (u.state === 'idle' || dest > 1.8)) {
        const p = g.grid.freeAt(tx, tz) ? { x: tx, z: tz } : g.grid.nearestFree(tx, tz, 3);
        if (p) { u.moveTo(p.x, p.z, L.state === 'amove'); u.following = true; }
      }
    }
  }

  // ---- barbarian camps ------------------------------------------------------------------------
  findSpots() {
    const g = this.game, out = [];
    const base = BASES[PLAYER];
    for (let z = -42; z <= 42; z += 7) for (let x = -42; x <= 42; x += 7) {
      const jx = x + (Math.sin(x * 12.9 + z * 78.2) * 2), jz = z + (Math.cos(x * 39.3 + z * 11.1) * 2);
      const d = Math.hypot(jx - base.x, jz - base.z);
      if (d < 25) continue;
      const s = 2, cx = g.grid.cell(jx) - 1, cz = g.grid.cell(jz) - 1;
      if (!g.canPlace('house', cx, cz, 1)) continue;
      if (!g.grid.freeAt(jx + 3, jz) || !g.grid.freeAt(jx - 3, jz) || !g.grid.freeAt(jx, jz + 3)) continue;
      out.push({ x: jx, z: jz, d });
      void s;
    }
    return out;
  }
  pickLevel(spot) {
    const base = 1 + Math.floor((spot.d - 25) / 10);
    const prog = Math.floor(this.maxCleared / 3);
    let L = base + prog + Math.floor(Math.random() * 3) - 1;
    // always leave something beatable on the map
    const easy = this.camps.filter((c) => !c.cleared && c.level <= this.maxCleared + 1).length;
    if (easy < 2) L = Math.min(L, this.maxCleared + 1);
    return Math.max(1, Math.min(SAGA.maxLevel, L, this.hallLevel() + 3));
  }
  spawnCamp(saved = null) {
    const g = this.game;
    let spot;
    if (saved) spot = { x: saved.x, z: saved.z, d: Math.hypot(saved.x - BASES[PLAYER].x, saved.z - BASES[PLAYER].z) };
    else {
      const free = this.spots.filter((s) => this.camps.every((c) => c.cleared || Math.hypot(c.x - s.x, c.z - s.z) > 13)
        && g.units.every((u) => !u.alive || u.team !== PLAYER || Math.hypot(u.pos.x - s.x, u.pos.z - s.z) > 14)
        && g.buildings.every((b) => !b.alive || Math.hypot(b.pos.x - s.x, b.pos.z - s.z) > 9));
      if (!free.length) return null;
      spot = free[Math.floor(Math.random() * free.length)];
    }
    const L = saved?.level || this.pickLevel(spot);
    const camp = { x: spot.x, z: spot.z, level: L, guards: [], buildings: [], cleared: false };
    const types = ['house'];
    if (L >= 4) types.push('tower');
    if (L >= 8) types.push('tower');
    for (const type of types) {
      const p = g.findCampSpot(type, spot.x, spot.z);
      if (!p) continue;
      const b = g.addBuilding(type, ENEMY, p[0], p[1], true);
      b.outpost = camp;
      b.level = L;
      const max = Math.round(b.def.hp * (0.6 + 0.12 * (L - 1)) * this.campMul);
      b.maxHp = b.hp = max;
      b.dmgMul = (1 + 0.12 * (L - 1)) * this.campMul;
      camp.buildings.push(b);
    }
    const n = 3 + Math.floor(L / 2);
    const pool = ['knight', 'knight', 'ranger'];
    if (L >= 3) pool.push('mage');
    for (let i = 0; i < n; i++) {
      const t = L >= 6 && i === n - 1 ? 'catapult' : pool[i % pool.length];
      const a = (i / n) * Math.PI * 2;
      const p = g.grid.nearestFree(spot.x + Math.cos(a) * 3.2, spot.z + Math.sin(a) * 3.2);
      if (!p) continue;
      const u = g.spawnUnit(t, ENEMY, p.x, p.z);
      u.guard = camp;
      u.home = { x: p.x, z: p.z };
      this.setTier(u, L, 0.2 * this.campMul, 0.13 * this.campMul);
      u.hp = u.maxHp = Math.round(u.maxHp * this.campMul);
      u.yaw = Math.atan2(BASES[PLAYER].x - u.pos.x, BASES[PLAYER].z - u.pos.z);
      camp.guards.push(u);
    }
    camp.label = labelSprite(`Lv ${L} Barbarians`, L <= this.maxCleared + 1 ? '#ffd27a' : L <= this.maxCleared + 3 ? '#ff9a4a' : '#ff5a4a');
    camp.label.position.set(spot.x, g.terrain.groundY(spot.x, spot.z) + 4.2, spot.z);
    g.scene.add(camp.label);
    this.camps.push(camp);
    return camp;
  }
  updateCamps(dt) {
    const g = this.game;
    for (const c of this.camps) {
      if (c.cleared) continue;
      for (const u of c.guards) {
        if (!u.alive) continue;
        const d = Math.hypot(u.pos.x - c.x, u.pos.z - c.z);
        // guards don't chase far from camp, and recover between fights
        if (d > 14 && u.state !== 'move') { u.target = null; u.moveTo(u.home.x, u.home.z); u.leashed = true; }
        if (u.leashed && u.state === 'idle') u.leashed = false;
        if (u.state === 'idle' && u.hp < u.maxHp && !g.findEnemy(u, 10)) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.06 * dt);
      }
      if (c.guards.every((u) => !u.alive)) this.clearCamp(c);
    }
    // keep the map stocked
    const live = this.camps.filter((c) => !c.cleared).length;
    if (live < SAGA.camps) {
      this.campT += dt;
      if (this.campT >= SAGA.campRespawn) { this.campT = 0; this.spawnCamp(); }
    }
    this.camps = this.camps.filter((c) => !c.cleared || c.fadeT < 3);
    for (const c of this.camps) if (c.cleared) {
      c.fadeT += dt;
      c.label.material.opacity = Math.max(0, 1 - c.fadeT / 3);
      if (c.fadeT >= 3) g.scene.remove(c.label);
    }
  }
  clearCamp(c) {
    const g = this.game;
    c.cleared = true;
    c.fadeT = 0;
    for (const b of c.buildings) if (b.alive) g.kill(b, null);
    const L = c.level;
    const crystal = Math.round((60 + 50 * L) * (1 + 0.1 * L)), wood = Math.round((50 + 45 * L) * (1 + 0.1 * L));
    const pos = new THREE.Vector3(c.x, g.terrain.groundY(c.x, c.z), c.z);
    g.deposit(PLAYER, 'crystal', crystal, { pos: pos.clone().add(new THREE.Vector3(-0.6, 0, 0)) });
    g.deposit(PLAYER, 'wood', wood, { pos: pos.clone().add(new THREE.Vector3(0.6, 0.5, 0)) });
    this.plunder += crystal + wood;
    this.campsCleared++;
    this.maxCleared = Math.max(this.maxCleared, L);
    let named = [];
    for (const h of Object.values(this.heroes)) {
      if (!h.unit?.alive || Math.hypot(h.unit.pos.x - c.x, h.unit.pos.z - c.z) > 15) continue;
      this.addXp(h, 15 * L);
      named.push(SAGA.heroes[h.id].name.split(' ')[0]);
    }
    g.fx.levelUp(pos);
    g.notify(`Lv ${L} camp cleared! +${crystal} crystal, +${wood} wood${named.length ? `, +${15 * L} XP to ${named.join(' & ')}` : ''}`, 'good', `camp${c.x}`, 0);
    this.save();
  }

  // ---- raids on the city ----------------------------------------------------------------------
  updateRaids(dt) {
    const g = this.game;
    if (this.raid) {
      const alive = this.raid.units.filter((u) => u.alive);
      for (const u of alive) if (u.state === 'idle') { const k = g.keeps[PLAYER]; u.moveTo(k.pos.x, k.pos.z, true); }
      if (!alive.length) {
        const L = this.raid.level;
        const c = 40 * L, w = 40 * L;
        g.deposit(PLAYER, 'crystal', c); g.deposit(PLAYER, 'wood', w);
        for (const h of Object.values(this.heroes)) if (h.unit?.alive) this.addXp(h, 8 * L);
        g.notify(`Raid repelled! The raiders' loot is yours: +${c} crystal, +${w} wood`, 'good', 'raidwin', 0);
        this.raid = null;
        this.raidT = SAGA.raidEvery[0] + Math.random() * (SAGA.raidEvery[1] - SAGA.raidEvery[0]);
        this.save();
      }
      return;
    }
    if (this.hallLevel() < 2) return; // a young clan is left in peace
    this.raidT -= dt;
    if (this.raidT <= 25 && !this.raidWarned) {
      this.raidWarned = true;
      const from = this.raidOrigin();
      this.raidFrom = from;
      g.notify('Barbarian raiders are coming for your Great Hall! (25s)', 'warn', 'raidwarn', 0);
      g.hooks.onAttackAlert?.(from);
    }
    if (this.raidT <= 0) this.startRaid();
  }
  raidOrigin() {
    const opts = [{ x: 40, z: -40 }, { x: 40, z: 20 }, { x: -20, z: -40 }, { x: 10, z: 40 }, { x: -40, z: -10 }];
    const o = opts[Math.floor(Math.random() * opts.length)];
    return this.game.grid.nearestFree(o.x, o.z, 10) || { x: 30, z: -30 };
  }
  startRaid() {
    const g = this.game;
    const L = Math.min(SAGA.maxLevel, this.hallLevel());
    const from = this.raidFrom || this.raidOrigin();
    const n = 3 + L;
    const k = g.keeps[PLAYER];
    const units = [];
    for (let i = 0; i < n; i++) {
      const t = i % 4 === 3 ? 'ranger' : i % 7 === 6 && L >= 4 ? 'mage' : 'knight';
      const p = g.grid.nearestFree(from.x + (Math.random() - 0.5) * 5, from.z + (Math.random() - 0.5) * 5, 6);
      if (!p) continue;
      const u = g.spawnUnit(t, ENEMY, p.x, p.z);
      this.setTier(u, L, 0.15 * this.campMul, 0.1 * this.campMul);
      u.raider = true;
      u.moveTo(k.pos.x + (Math.random() - 0.5) * 4, k.pos.z + (Math.random() - 0.5) * 4, true);
      units.push(u);
    }
    this.raid = { level: L, units };
    this.raidWarned = false;
    this.raidFrom = null;
    g.notify(`A Lv ${L} raid has begun — defend the Great Hall!`, 'warn', 'raid', 0);
    g.hooks.onAttackAlert?.(from);
  }
  // the Great Hall can't be destroyed: it is sacked instead
  sack() {
    const g = this.game, st = g.teams[PLAYER];
    const k = g.keeps[PLAYER];
    const c = Math.floor(st.crystal * 0.2), w = Math.floor(st.wood * 0.2);
    st.crystal -= c; st.wood -= w;
    k.hp = Math.round(k.maxHp * 0.35);
    k.updateHpBar();
    g.fx.explosion(k.pos);
    g.shake(0.8, k.pos);
    if (this.raid) for (const u of this.raid.units) if (u.alive) { u.alive = false; g.fx.dust(u.pos, 0.8, 8); g.scene.remove(u.obj); }
    for (const u of g.units) if (u.alive && u.team === ENEMY && !u.guard) { u.alive = false; g.scene.remove(u.obj); }
    g.units = g.units.filter((u) => u.alive || u.team === PLAYER);
    this.raid = null;
    this.raidT = SAGA.raidEvery[1];
    g.notify(`The Great Hall was sacked! Raiders carried off ${c} crystal and ${w} wood.`, 'warn', 'sack', 0);
    g.recomputePop();
    this.save();
  }

  // ---- kills ----------------------------------------------------------------------------------
  onKill(e, by) {
    if (e.team === PLAYER && e.isUnit && !e.def.hero) this.wound(e);
    if (e.team === PLAYER && e.heroId) {
      const h = this.heroes[e.heroId];
      h.unit = null;
      h.respawnT = SAGA.heroRespawn;
      if (e === this.game.jarl) this.game.jarl = null;
      this.game.notify(`${SAGA.heroes[h.id].name} has fallen! Returning from Valhalla in ${SAGA.heroRespawn}s.`, 'warn', `hdead${h.id}`, 0);
      return;
    }
    if (!by || by.team !== PLAYER || e.team === PLAYER) return;
    // XP to the hero who struck the blow, or whose warband did, or who stood nearby
    let h = this.heroOf(by);
    if (!h) {
      for (const hh of Object.values(this.heroes)) if (hh.unit?.alive && Math.hypot(hh.unit.pos.x - e.pos.x, hh.unit.pos.z - e.pos.z) < 12) { h = hh; break; }
    }
    const L = e.tier || e.level || 1;
    const xp = e.isBuilding ? 6 * L : (2 + (e.def.pop || 1) * 2) * (1 + 0.25 * (L - 1));
    if (h) this.addXp(h, Math.round(xp));
    if (e.isUnit) {
      const c = e.def.cost || {};
      const cr = Math.round((c.crystal || 0) * 0.25), wd = Math.round((c.wood || 0) * 0.25);
      if (cr) g_dep(this.game, 'crystal', cr, e);
      if (wd) g_dep(this.game, 'wood', wd, e);
      this.plunder += cr + wd;
    }
  }

  // ---- Infirmary: the fallen are carried home wounded, then healed back into the clan ----------
  infirmaries() { return this.game.buildings.filter((b) => b.alive && b.team === PLAYER && b.type === 'infirmary' && b.complete); }
  woundCap() {
    const c = SAGA.infirmary;
    return this.infirmaries().reduce((n, b) => n + c.cap + c.capPerLevel * ((b.level || 1) - 1), 0);
  }
  healInterval() {
    const inf = this.infirmaries();
    const pow = inf.reduce((n, b) => n + 1 + 0.3 * ((b.level || 1) - 1), 0);
    return pow ? SAGA.infirmary.healEvery / pow : Infinity;
  }
  wound(e) {
    const g = this.game;
    if (this.wounded.length >= this.woundCap()) return;
    this.wounded.push({ type: e.type, tier: e.tier || 1, band: e.band || null });
    const inf = this.infirmaries()[0];
    g.fx.heal(e.pos, e.height);
    if (this.woundMsgT <= 0) {
      this.woundMsgT = 6;
      g.notify(`${g.unitLabel(e.type, PLAYER)} carried to the ${g.buildingLabel('infirmary', PLAYER)} (${this.wounded.length}/${this.woundCap()} wounded)`, 'info', 'wound');
    }
    if (inf && this.healT <= 0) this.healT = this.healInterval();
  }
  // returns false when there is no room (population) or no infirmary
  healOne(quiet = false) {
    const g = this.game, st = g.teams[PLAYER];
    const inf = this.infirmaries().sort((a, b) => (b.level || 1) - (a.level || 1))[0];
    const w = this.wounded[0];
    if (!inf || !w) return false;
    const def = UNIT_TYPES[w.type];
    if (st.pop + def.pop > st.popCap) return false;
    this.wounded.shift();
    const a = Math.random() * Math.PI * 2, r = inf.size / 2 + 1;
    const p = g.grid.nearestFree(inf.pos.x + Math.cos(a) * r, inf.pos.z + Math.sin(a) * r) || { x: inf.pos.x + r, z: inf.pos.z };
    const u = g.spawnUnit(w.type, PLAYER, p.x, p.z);
    this.setTier(u, w.tier || 1);
    u.hp = u.maxHp;
    if (w.band && this.heroes[w.band]?.unit?.alive) u.band = w.band;
    if (u.type === 'worker') g.autoGather(u);
    else if (inf.rally && !inf.rally.resource) u.moveTo(inf.rally.x, inf.rally.z);
    g.recomputePop();
    if (!quiet) {
      g.fx.heal(u.pos, u.height); g.fx.heal(u.pos, u.height);
      g.notify(`${g.unitLabel(w.type, PLAYER)} healed and back on their feet`, 'good', 'healed');
    }
    return true;
  }
  updateInfirmary(dt) {
    const g = this.game;
    this.woundMsgT -= dt;
    if (this.wounded.length) {
      this.healT -= dt;
      if (this.healT <= 0) {
        if (this.healOne()) this.healT = this.healInterval();
        else this.healT = 2; // wait for room / an infirmary
      }
    }
    this.auraT -= dt;
    if (this.auraT > 0) return;
    this.auraT = 1;
    const c = SAGA.infirmary;
    for (const b of this.infirmaries()) {
      const heal = c.auraHeal + (b.level || 1);
      for (const u of g.units) {
        if (!u.alive || u.team !== PLAYER || u.hp >= u.maxHp) continue;
        if (Math.hypot(u.pos.x - b.pos.x, u.pos.z - b.pos.z) > c.aura) continue;
        u.hp = Math.min(u.maxHp, u.hp + heal);
        if (Math.random() < 0.35) g.fx.heal(u.pos, u.height);
      }
    }
  }

  // ---- Training Yard: heroes drill for XP --------------------------------------------------------
  yardFor() {
    const ys = this.game.buildings.filter((b) => b.alive && b.team === PLAYER && b.type === 'yard' && b.complete);
    return ys.sort((a, b) => (b.level || 1) - (a.level || 1))[0] || null;
  }
  yardCap(y) { return Math.min(SAGA.heroMaxLevel, SAGA.yard.capBase + SAGA.yard.capPerLevel * (y.level || 1)); }
  trainXp(h, y, secs, quiet = false) {
    const c = SAGA.yard, cap = this.yardCap(y);
    let xp = secs * (c.xp + c.xpPerLevel * ((y.level || 1) - 1));
    // feed XP level by level so the yard's cap is respected
    while (xp > 0 && h.level < cap) {
      const need = xpToNext(h.level) - h.xp, n = Math.min(need, xp);
      xp -= n;
      if (quiet) { h.xp += n; if (h.xp >= xpToNext(h.level)) { h.xp -= xpToNext(h.level); h.level++; this.applyHeroLevel(h); } }
      else this.addXp(h, n);
    }
    return h.level < cap;
  }
  sendToYard(hero, quiet = false) {
    const y = this.yardFor();
    if (!y) { if (!quiet) this.game.notify('Build a Training Yard first', 'warn', 'noyard'); return; }
    const h = this.heroes[hero.heroId];
    const i = Object.keys(this.heroes).indexOf(hero.heroId);
    const a = (i / 3) * Math.PI * 2 + 0.6, r = y.size / 2 + 1.2;
    const p = this.game.grid.nearestFree(y.pos.x + Math.cos(a) * r, y.pos.z + Math.sin(a) * r) || { x: y.pos.x + r, z: y.pos.z };
    hero.moveTo(p.x, p.z);
    h.capWarned = false;
    if (!quiet) this.game.notify(`${SAGA.heroes[h.id].name} heads to the Training Yard`, 'info', `yard${h.id}`);
  }
  updateYard(dt) {
    const y = this.yardFor();
    for (const h of Object.values(this.heroes)) {
      const u = h.unit;
      if (!u?.alive) continue;
      const near = y && u.state === 'idle' && !u.moving && Math.hypot(u.pos.x - y.pos.x, u.pos.z - y.pos.z) < SAGA.yard.range;
      if (!near) { u.drill = null; continue; }
      if (this.trainXp(h, y, dt)) {
        if (!u.drill) u.drill = SAGA.yard.drill[h.id].find((a) => u.actions?.[a]) || null;
        if (Math.random() < 0.15) this.game.fx.dust(u.pos, 0.3, 2);
      } else {
        u.drill = null;
        if (!h.capWarned) {
          h.capWarned = true;
          this.game.notify(`${SAGA.heroes[h.id].name} has trained to Lv ${this.yardCap(y)} — upgrade the Training Yard to go further`, 'info', `ycap${h.id}`, 0);
        }
      }
    }
  }
  panelText(b) {
    if (b.type === 'infirmary') {
      const n = this.wounded.length, cap = this.woundCap();
      const next = n && Number.isFinite(this.healT) ? ` · next healed in ${Math.max(0, Math.ceil(this.healT))}s` : '';
      return `<div class="desc" style="color:#9be59b">Wounded <b>${n}/${cap}</b>${next}${n ? '' : ' · no one waiting'}</div>`;
    }
    if (b.type === 'yard') {
      const drilling = Object.values(this.heroes).filter((h) => h.unit?.alive && h.unit.drill).map((h) => SAGA.heroes[h.id].name.split(' ')[0]);
      const c = SAGA.yard, rate = c.xp + c.xpPerLevel * ((b.level || 1) - 1);
      return `<div class="desc" style="color:#ffd27a">Heroes train up to <b>Lv ${this.yardCap(b)}</b> · ${rate} XP/s${drilling.length ? ` · drilling: ${drilling.join(', ')}` : ' · select a hero and press Y'}</div>`;
    }
    return '';
  }

  // ---- frame ----------------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    for (const h of Object.values(this.heroes)) {
      if (h.respawnT < 0) continue;
      h.respawnT -= dt;
      if (h.respawnT < 0) { this.spawnHero(h.id); g.notify(`${SAGA.heroes[h.id].name} returns from Valhalla!`, 'good', `hback${h.id}`, 0); }
    }
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.4;
      this.checkUpgrades();
      this.updateBands();
      this.updateYard(0.4);
    }
    this.updateInfirmary(dt);
    this.updateCamps(dt);
    this.updateRaids(dt);
    for (const b of g.buildings) if (b.alive && b.upg && Math.random() < dt * 2) g.fx.dust(new THREE.Vector3(b.pos.x + (Math.random() - 0.5) * b.size, b.pos.y + Math.random() * b.height, b.pos.z + (Math.random() - 0.5) * b.size), 0.4, 2);
    this.saveT -= dt;
    if (this.saveT <= 0) { this.saveT = 15; this.save(); }
  }
}

function g_dep(game, kind, n, e) {
  game.deposit(PLAYER, kind, n, { pos: e.pos.clone().add(new THREE.Vector3(kind === 'crystal' ? -0.5 : 0.5, 0, 0)) });
}

export { VIKING };
