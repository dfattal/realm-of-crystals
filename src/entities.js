import * as THREE from 'three';
import { UNIT_TYPES, BUILDING_TYPES, CARRY } from './config.js';
import { HALF } from './terrain.js';

let NEXT_ID = 1;

// soft glowing ring texture shared by every selection circle
let RING_TEX = null;
function ringTexture() {
  if (RING_TEX) return RING_TEX;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 34, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  RING_TEX = new THREE.CanvasTexture(cv);
  RING_TEX.colorSpace = THREE.SRGBColorSpace;
  return RING_TEX;
}

function makeHpBar(width) {
  const g = new THREE.Group();
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x1a1010, depthWrite: false }));
  bg.center.set(0, 0.5);
  bg.scale.set(width + 0.08, 0.17, 1);
  bg.position.x = -width / 2 - 0.04;
  const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x5ccf6a, depthWrite: false }));
  fg.center.set(0, 0.5);
  fg.scale.set(width, 0.11, 1);
  fg.position.set(-width / 2, 0, 0.001);
  fg.renderOrder = 2;
  g.add(bg, fg);
  g.userData = { fg, width };
  return g;
}

class Entity {
  constructor(game, team) {
    this.id = NEXT_ID++;
    this.game = game;
    this.team = team;
    this.alive = true;
    this.obj = new THREE.Group();
    this.pos = this.obj.position;
    this.selected = false;
    this.hpBar = null;
    this.flashT = 0;
  }
  updateHpBar() {
    const show = this.alive && (this.selected || this.hp < this.maxHp);
    if (!show) { if (this.hpBar) this.hpBar.visible = false; return; }
    if (!this.hpBar) {
      this.hpBar = makeHpBar(this.isBuilding ? Math.min(2.8, this.size * 0.7) : 0.9);
      this.hpBar.position.y = this.barHeight;
      this.obj.add(this.hpBar);
    }
    this.hpBar.visible = true;
    const f = Math.max(0, this.hp / this.maxHp);
    const { fg, width } = this.hpBar.userData;
    fg.scale.x = Math.max(0.001, width * f);
    fg.material.color.setHex(f > 0.6 ? 0x5ccf6a : f > 0.3 ? 0xe8c46a : 0xef5a4f);
  }
  setSelected(v) {
    this.selected = v;
    if (v && !this.ring) {
      const r = this.isBuilding ? this.size * 0.5 * 1.5 : this.radius + 0.45;
      this.ring = new THREE.Mesh(
        new THREE.PlaneGeometry(r * 2, r * 2).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          map: ringTexture(), color: this.team === 0 ? 0x7dff8a : 0xff6d63, transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      this.ring.position.y = 0.1;
      this.ring.renderOrder = 1;
      this.obj.add(this.ring);
    }
    if (this.ring) this.ring.visible = v;
    this.updateHpBar();
  }
  flash() { this.flashT = 0.16; }
  updateFlash(dt) {
    if (!this.mats || this.flashT <= 0 && !this._flashing) return;
    this.flashT -= dt;
    const k = Math.max(0, this.flashT / 0.16);
    for (const m of this.mats) { if (m.emissive) { m.emissive.setRGB(k * 0.9, k * 0.25, k * 0.2); } }
    this._flashing = k > 0;
  }
}

// ---------------------------------------------------------------------------------------------

export class Unit extends Entity {
  constructor(game, type, team, x, z) {
    super(game, team);
    this.isUnit = true;
    this.type = type;
    this.def = UNIT_TYPES[type];
    this.label = game.unitLabel(type, team);
    this.hp = this.maxHp = this.def.hp;
    this.radius = this.def.radius;
    this.height = this.def.height;
    this.barHeight = this.height + 0.45;
    this.state = 'idle';
    this.path = [];
    this.target = null;
    this.dest = null;
    this.cool = Math.random() * 0.5;
    this.carry = 0;
    this.carryType = null;
    this.workT = 0;
    this.scanT = Math.random() * 0.5;
    this.repathT = 0;
    this.yaw = team === 0 ? Math.PI * 0.75 : -Math.PI * 0.25;
    this.moving = false;
    this.working = null;
    this.deathT = 0;
    this.stuckT = 0;
    this.swingT = -1;     // time into the current attack swing (-1: not swinging)
    this.swingHit = false;
    this.swingAnim = null;
    this.special = null;  // 'slam' | 'cry' while a hero ability swing plays
    this.staggerT = 0;    // hit-reaction clip time left
    this.staggerCd = 0;   // minimum gap between hit reactions
    this.hitStop = 0;     // brief animation freeze on impact
    this.kb = new THREE.Vector2(); // knockback velocity (x, z)
    this.lunge = 0;       // forward body offset during a melee swing
    this.buffT = 0;       // war-cry buff time left
    this.healT = Math.random();
    this.emberT = 0;

    const v = game.factory.makeUnit(type, team);
    this.model = v.root;
    this.mixer = v.mixer;
    this.actions = v.actions;
    this.carryObj = v.carry;
    this.mats = v.mats;
    this.arm = this.model.getObjectByName('catapult');
    this.obj.add(this.model);
    if (this.def.hero) {
      // a gold aura on the ground marks the hero
      const aura = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2, 2.2).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: ringTexture(), color: 0xffc75a, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      aura.position.y = 0.08;
      aura.renderOrder = 1;
      this.obj.add(aura);
    }
    this.curAnim = null;
    this.playAnim(this.idleAnim());
    if (this.mixer) this.mixer.update(Math.random() * 2);
    this.pos.set(x, game.terrain.groundY(x, z), z);
    this.obj.rotation.y = this.yaw;
    game.scene.add(this.obj);
  }

  idleAnim() {
    if (this.team === 1 && this.type !== 'worker' && this.actions.Idle_Combat) return 'Idle_Combat';
    return 'Idle';
  }
  // the guard stance held between swings
  combatIdleAnim() {
    if (this.def.combatIdle && this.actions[this.def.combatIdle]) return this.def.combatIdle;
    if (this.actions.Idle_Combat) return 'Idle_Combat';
    return 'Idle';
  }

  playAnim(name, speed = 1, once = false, fade = 0.15) {
    if (!this.mixer) return;
    const a = this.actions[name];
    if (!a) return;
    a.timeScale = speed;
    if (this.curAnim === name && !once) return;
    const prev = this.actions[this.curAnim];
    if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    else if (!/^(Death|Cheer)/.test(name)) { a.setLoop(THREE.LoopRepeat, Infinity); a.clampWhenFinished = false; }
    a.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (prev && prev !== a) prev.fadeOut(fade);
    this.curAnim = name;
  }

  // ---- combat stats (buffs, rage, hero level) ----
  get level() { return this.heroLevel || this.tier || 1; }
  speed() { return this.def.speed * (this.buffT > 0 ? this.buffSpeed || 1 : 1); }
  attackDamage() {
    let d = this.def.dmg * (this.dmgMul || 1);
    if (this.buffT > 0) d *= this.buffDmg || 1;
    if (this.def.rage) d *= 1 + 0.7 * (1 - this.hp / this.maxHp);
    return d;
  }

  // Called by Game.damage: flinch, knockback and hit-stop so blows read as blows.
  onHit(attacker, amount, push = 0) {
    if (!this.alive) return;
    if (attacker && push > 0) {
      const dx = this.pos.x - attacker.pos.x, dz = this.pos.z - attacker.pos.z, d = Math.hypot(dx, dz) || 1;
      const k = push / (this.def.kind === 'catapult' ? 4 : this.def.hero ? 2.5 : 1);
      this.kb.x += (dx / d) * k; this.kb.y += (dz / d) * k;
    }
    // flinch on solid hits, but never interrupt our own swing
    if (this.mixer && this.swingT < 0 && this.staggerCd <= 0 && amount >= this.maxHp * 0.06 && this.actions.Hit_A) {
      const sp = 1.7;
      this.playAnim('Hit_A', sp, true, 0.06);
      this.staggerT = this.actions.Hit_A.getClip().duration / sp * 0.8;
      this.staggerCd = this.def.hero ? 2.5 : 1.1;
    }
  }

  // ---- orders ----
  stop() { this.state = 'idle'; this.path = []; this.target = null; this.dest = null; this.resume = null; this.buildQueue = null; }
  moveTo(x, z, attackMove = false) {
    this.buildQueue = null;
    this.target = null;
    this.dest = { x, z };
    this.state = attackMove ? 'amove' : 'move';
    this.path = this.game.pathTo(this, x, z, 0.5);
    this.resume = null;
  }
  attack(t, auto = false) {
    if (!t || !t.alive || t.team === this.team) return;
    if (auto && this.state === 'amove') this.resume = { ...this.dest };
    else if (!auto) this.resume = null;
    if (!auto) this.buildQueue = null;
    this.target = t;
    this.state = 'attack';
    this.path = [];
    this.repathT = 0;
    this.anchor = auto ? this.pos.clone() : null;
  }
  gather(r) {
    if (this.type !== 'worker' || !r) return;
    this.buildQueue = null;
    this.orderedAt = this.game.time;
    if (!r.reachable()) r = this.game.nearestResource(r.kind, r.pos, 6, this) || r;
    this.target = r; this.state = 'gather'; this.path = []; this.repathT = 0; this.lastRes = r;
  }
  build(b) {
    if (this.type !== 'worker' || !b) return;
    // switching away from an unfinished site: remember it so the worker comes back afterwards
    const prev = this.state === 'build' ? this.target : null;
    if (prev && prev !== b && prev.alive && !prev.complete) {
      this.buildQueue = (this.buildQueue || []).filter((q) => q !== prev && q !== b);
      this.buildQueue.push(prev);
    } else if (this.buildQueue) this.buildQueue = this.buildQueue.filter((q) => q !== b);
    this.target = b; this.state = 'build'; this.path = []; this.repathT = 0;
  }
  returnCargo() {
    if (this.carry > 0) { this.state = 'return'; this.path = []; this.repathT = 0; }
  }

  // ---- movement helpers ----
  stepToward(x, z, dt) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const sp = this.speed() * dt;
    if (d < 1e-4) return true;
    this.faceTo(x, z, dt);
    const k = Math.min(1, sp / d);
    const nx = this.pos.x + dx * k, nz = this.pos.z + dz * k;
    const g = this.game.grid;
    if (g.freeAt(nx, nz) || !g.freeAt(this.pos.x, this.pos.z)) { this.pos.x = nx; this.pos.z = nz; }
    else if (g.freeAt(nx, this.pos.z)) this.pos.x = nx;
    else if (g.freeAt(this.pos.x, nz)) this.pos.z = nz;
    else { this.stuckT += dt; }
    this.moving = true;
    return d <= sp;
  }
  faceTo(x, z, dt = 1) {
    const want = Math.atan2(x - this.pos.x, z - this.pos.z);
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * 12);
  }
  followPath(dt) {
    if (!this.path.length) return true;
    const p = this.path[0];
    if (this.stepToward(p.x, p.z, dt)) this.path.shift();
    if (this.stuckT > 1.2) {
      this.stuckT = 0;
      const last = this.path[this.path.length - 1];
      if (last) this.path = this.game.pathTo(this, last.x, last.z, 0.5);
    }
    return this.path.length === 0;
  }
  approach(e, reach, dt) {
    const d = this.game.distTo(this, e);
    if (d <= reach) { this.path = []; return true; }
    this.repathT -= dt;
    if (this.repathT <= 0 || (!this.path.length)) {
      this.repathT = 0.9 + Math.random() * 0.6;
      this.path = this.game.pathToEntity(this, e, reach);
      if (!this.path.length) {
        this.stepToward(e.pos.x, e.pos.z, dt);
        return false;
      }
    }
    this.followPath(dt);
    return false;
  }

  // knockback slide, blocked by walls/buildings like normal movement
  applyKnockback(dt) {
    const kb = this.kb;
    if (kb.lengthSq() < 1e-4) { kb.set(0, 0); return; }
    const g = this.game.grid;
    const nx = this.pos.x + kb.x * dt, nz = this.pos.z + kb.y * dt;
    if (g.freeAt(nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
    else kb.set(0, 0);
    kb.multiplyScalar(Math.exp(-dt * 9));
  }

  update(dt) {
    this.updateFlash(dt);
    if (!this.alive) {
      this.deathT += dt;
      this.applyKnockback(dt);
      this.pos.y = this.deathT > 2.2 ? this.pos.y - dt * 0.5 : this.game.terrain.groundY(this.pos.x, this.pos.z);
      if (this.mixer) this.mixer.update(this.hitStop > 0 ? dt * 0.1 : dt);
      this.hitStop -= dt;
      this.model.position.z *= Math.exp(-dt * 10);
      return this.deathT < 4;
    }
    this.moving = false;
    this.working = null;
    this.cool -= dt;
    this.scanT -= dt;
    this.staggerT -= dt;
    this.staggerCd -= dt;
    this.buffT -= dt;
    if (this.wallT > 0) this.wallT -= dt;
    if (this.cd) for (const k in this.cd) this.cd[k] -= dt;
    const def = this.def;
    this.applyKnockback(dt);
    if (def.heal) this.updateHeal(dt);
    if (this.buffT > 0) {
      this.emberT -= dt;
      if (this.emberT <= 0) { this.emberT = 0.12; this.game.fx.embers(this.pos, this.height); }
    }

    // a flinching unit loses its footing for a moment; a hero plants its feet for an ability
    if ((this.staggerT > 0 && this.swingT < 0) || this.special) {
      this.updateSwing(dt);
      this.finishFrame(dt);
      return true;
    }

    switch (this.state) {
      case 'idle': {
        if (this.scanT <= 0) {
          this.scanT = 0.45;
          if (def.aggro) {
            const e = this.game.findEnemy(this, def.aggro);
            if (e) this.attack(e, true);
          }
        }
        break;
      }
      case 'move':
        if (this.followPath(dt)) this.state = 'idle';
        break;
      case 'amove': {
        if (this.scanT <= 0) {
          this.scanT = 0.35;
          const e = this.game.findEnemy(this, Math.max(def.aggro, def.range + 1));
          if (e) { this.attack(e, true); break; }
        }
        if (this.followPath(dt)) this.state = 'idle';
        break;
      }
      case 'attack': this.doAttack(dt); break;
      case 'gather': this.doGather(dt); break;
      case 'return': this.doReturn(dt); break;
      case 'build': this.doBuild(dt); break;
      case 'cheer': break;
    }
    this.updateSwing(dt);
    this.finishFrame(dt);
    return true;
  }

  finishFrame(dt) {
    // animation
    if (this.mixer && this.state !== 'cheer') {
      if (this.swingT >= 0 || this.staggerT > 0) { /* a one-shot clip (swing / flinch) is playing */ }
      else if (this.moving) {
        // melee units charge (lean-in run) when closing on a target
        const charge = this.state === 'attack' && this.def.range < 2 && this.actions.Running_B;
        this.playAnim(charge ? 'Running_B' : 'Running_A', this.speed() / 4.2);
      }
      else if (this.working === 'wood' || this.working === 'build') this.playAnim('1H_Melee_Attack_Chop', 1.0);
      else if (this.working === 'crystal') this.playAnim('2H_Melee_Attack_Chop', 0.9);
      else if (this.state === 'attack' && this.target?.alive) this.playAnim(this.combatIdleAnim(), 1, false, 0.1);
      else if (this.drill && this.state === 'idle') this.playAnim(this.drill, 0.85);
      else this.playAnim(this.idleAnim());
    }
    if (this.mixer) this.mixer.update(this.hitStop > 0 ? dt * 0.08 : dt);
    this.hitStop -= dt;
    // lunge: the body steps into a melee swing, then settles back
    let lungeWant = 0;
    if (this.swingT >= 0 && !this.def.projectile && this.def.kind === 'char') {
      const k = this.swingT / Math.max(0.01, this.swingHitAt);
      lungeWant = k < 1 ? Math.sin(k * Math.PI * 0.5) * (this.def.heavy ? 0.38 : 0.26) : Math.max(0, 1 - (this.swingT - this.swingHitAt) / 0.25) * (this.def.heavy ? 0.38 : 0.26);
      if (this.special === 'slam' || this.special === 'bash') lungeWant *= 1.6;
    }
    this.lunge += (lungeWant - this.lunge) * Math.min(1, dt * 18);
    if (this.def.kind === 'char') this.model.position.z = this.lunge;
    if (this.arm && this.armT > 0) {
      this.armT -= dt;
      const k = Math.max(0, this.armT / 0.7);
      this.arm.rotation.z = -Math.sin(k * Math.PI) * 1.4;
    }
    if (this.carryObj) {
      this.carryObj.visible = this.carry > 0;
      if (this.carry > 0) {
        this.carryObj.children[0].visible = this.carryType === 'crystal';
        this.carryObj.children[1].visible = this.carryType === 'wood';
      }
    }
    this.pos.y = this.game.terrain.groundY(this.pos.x, this.pos.z);
    this.obj.rotation.y = this.yaw;
  }

  // An attack is a swing: the clip plays once, and damage (or the projectile) lands partway in.
  // Clips don't repeat back to back, so a melee exchange looks like a fight rather than a loop.
  startSwing(t, opts = {}) {
    const def = this.def;
    let name = opts.anim;
    if (!name) {
      const anims = Array.isArray(def.attackAnim) ? def.attackAnim : [def.attackAnim];
      const pool = anims.length > 1 ? anims.filter((n) => n !== this.lastSwing) : anims;
      name = pool[Math.floor(Math.random() * pool.length)];
      this.lastSwing = name;
    }
    const a = this.actions[name];
    this.swingTarget = t;
    this.swingHit = false;
    this.swingT = 0;
    this.special = opts.special || null;
    if (a) {
      const dur = a.getClip().duration;
      const speed = opts.speed || Math.max(1, dur / (def.cooldown * 0.95));
      this.swingDur = dur / speed;
      this.playAnim(name, speed, true, 0.08);
    } else {
      this.swingDur = 0.6;
      this.armT = 0.7; // catapult throwing arm
    }
    this.swingHitAt = this.swingDur * (opts.hitAt ?? def.hitAt ?? 0.35);
  }
  updateSwing(dt) {
    if (this.swingT < 0) return;
    this.swingT += dt;
    if (!this.swingHit && this.swingT >= this.swingHitAt) {
      this.swingHit = true;
      if (this.special) this.game.heroAbilityHit(this, this.special);
      else {
        const t = this.swingTarget;
        if (t && t.alive) {
          if (this.def.projectile) this.game.fireProjectile(this, t, this.def.projectile, this.attackDamage());
          else this.game.meleeHit(this, t);
        }
      }
    }
    if (this.swingT >= this.swingDur) { this.swingT = -1; this.special = null; }
  }

  // Seers mend wounded allies around them.
  updateHeal(dt) {
    this.healT -= dt;
    if (this.healT > 0) return;
    this.healT = 1;
    const h = this.def.heal;
    for (const u of this.game.units) {
      if (!u.alive || u.team !== this.team || u.hp >= u.maxHp || u.def.kind !== 'char') continue;
      if (Math.hypot(u.pos.x - this.pos.x, u.pos.z - this.pos.z) > h.range) continue;
      u.hp = Math.min(u.maxHp, u.hp + h.rate);
      this.game.fx.heal(u.pos, u.height);
    }
  }

  // ---- hero abilities (the Jarl) ----
  // abilities cut into an ordinary swing, but not into another ability or a flinch
  canUse(ab) { return this.alive && this.def.hero && ab && (this.cd?.[ab.id] || 0) <= 0 && !this.special; }
  useAbility(id) {
    const ab = this.game.heroAbility(this, id);
    if (!this.canUse(ab)) return false;
    this.cd[ab.id] = ab.cd;
    this.path = [];
    this.startSwing(null, { anim: ab.anim, speed: ab.speed, hitAt: ab.hitAt, special: ab.id });
    return true;
  }

  doAttack(dt) {
    const t = this.target;
    if (!t || !t.alive) {
      this.target = null;
      const nxt = this.def.aggro ? this.game.findEnemy(this, this.def.aggro) : null;
      if (nxt && (this.resume || this.anchor)) { this.attack(nxt, true); return; }
      if (this.resume) { const r = this.resume; this.moveTo(r.x, r.z, true); }
      else this.state = 'idle';
      return;
    }
    if (this.anchor && !this.resume && this.pos.distanceTo(this.anchor) > 16) {
      const a = this.anchor; this.anchor = null; this.target = null;
      this.moveTo(a.x, a.z); return;
    }
    if (this.swingT >= 0) { this.faceTo(t.pos.x, t.pos.z, dt * (this.swingT < this.swingHitAt ? 1 : 0.3)); return; }
    const range = this.def.range;
    if (!this.approach(t, range, dt)) return;
    this.faceTo(t.pos.x, t.pos.z, dt);
    if (this.cool <= 0) {
      this.cool = this.def.cooldown;
      this.startSwing(t);
    }
  }

  doGather(dt) {
    let r = this.target;
    if (!r || !r.alive) {
      r = this.game.nearestResource(this.lastRes ? this.lastRes.kind : (this.carryType || 'crystal'), this.lastRes ? this.lastRes.pos : this.pos, 16, this);
      if (!r) { if (this.carry > 0) this.returnCargo(); else this.state = 'idle'; return; }
      this.target = r;
    }
    if (!r.reachable() && this.game.distTo(this, r) > 0.8) {
      // walled in by other trees: chop the nearest open one instead
      const alt = this.game.nearestResource(r.kind, r.pos, 8, this);
      if (alt) { this.target = r = alt; this.path = []; this.repathT = 0; }
    }
    this.lastRes = r;
    if (this.carry > 0 && this.carryType !== r.kind) { this.returnCargo(); return; }
    if (this.carry >= CARRY) { this.returnCargo(); return; }
    if (!this.approach(r, 0.55, dt)) return;
    this.faceTo(r.pos.x, r.pos.z, dt);
    this.working = r.kind;
    this.workT += dt * this.game.gatherRate(this.team);
    if (this.workT >= (r.kind === 'wood' ? 0.55 : 0.8)) {
      this.workT = 0;
      const got = r.take(2);
      if (got > 0) { this.carry += got; this.carryType = r.kind; }
      if (got > 0) r.kind === 'wood' ? this.game.fx.leaves(r.pos) : this.game.fx.shards(r.pos);
      if (this.carry >= CARRY || !r.alive) this.returnCargo();
    }
  }

  doReturn(dt) {
    const drop = this.game.nearestDropoff(this.team, this.pos, this.carryType);
    if (!drop) { this.state = 'idle'; return; }
    if (!this.approach(drop, 0.6, dt)) return;
    this.game.deposit(this.team, this.carryType, this.game.saga && this.team === 0 ? Math.round(this.carry * this.game.saga.dropBonus(drop)) : this.carry, this);
    this.carry = 0;
    this.carryType = null;
    if (this.lastRes) { this.state = 'gather'; this.target = this.lastRes.alive ? this.lastRes : null; this.path = []; this.repathT = 0; }
    else this.state = 'idle';
  }

  doBuild(dt) {
    const b = this.target;
    if (!b || !b.alive || b.complete) {
      // go back to any site this worker was pulled away from
      while (this.buildQueue?.length) {
        const next = this.buildQueue.pop();
        if (next.alive && !next.complete) { this.target = next; this.path = []; this.repathT = 0; if (!this.buildQueue.length) this.buildQueue = null; return; }
      }
      this.buildQueue = null;
      this.target = null;
      this.state = 'idle';
      if (this.team !== 0) return;
      // builders of a drop-off start working the resource it serves; others go back to their job
      const drop = b && b.alive && b.def.dropoff && b.def.dropoff !== 'all' ? b.def.dropoff : null;
      if (drop) { const r = this.game.nearestResource(drop, b.pos, 14, this); if (r) { this.gather(r); return; } }
      if (this.lastRes) { const r = this.lastRes.alive ? this.lastRes : this.game.nearestResource(this.lastRes.kind, this.lastRes.pos, 14, this); if (r) { this.gather(r); return; } }
      this.game.autoGather(this);
      return;
    }
    if (!this.approach(b, 0.6, dt)) return;
    this.faceTo(b.pos.x, b.pos.z, dt);
    this.working = 'build';
    b.addProgress(dt / b.def.time);
    if (Math.random() < dt * 1.5) this.game.fx.dust(new THREE.Vector3(this.pos.x + Math.sin(this.yaw) * 0.6, this.pos.y, this.pos.z + Math.cos(this.yaw) * 0.6), 0.35, 2);
  }

  cheer() {
    if (!this.alive || !this.mixer) return;
    this.state = 'cheer';
    this.path = [];
    this.playAnim('Cheer', 1, true);
  }
}

// ---------------------------------------------------------------------------------------------

export class Building extends Entity {
  constructor(game, type, team, cx, cz, complete = false) {
    super(game, team);
    this.isBuilding = true;
    this.type = type;
    this.def = BUILDING_TYPES[type];
    this.size = this.def.size;
    this.cx = cx; this.cz = cz;
    this.maxHp = this.def.hp;
    this.complete = complete;
    this.progress = complete ? 1 : 0;
    this.hp = complete ? this.maxHp : Math.max(1, this.maxHp * 0.1);
    this.radius = this.size * 0.5;
    this.trains = game.trainsFor(type, team);
    this.label = game.buildingLabel(type, team);
    this.queue = [];
    this.trainT = 0;
    this.rally = null;
    this.cool = 0;
    this.scanT = 0;
    this.attackTarget = null;
    this.fireT = 0;
    const x = cx - HALF + this.size / 2, z = cz - HALF + this.size / 2;
    let y = Infinity;
    for (const [ox, oz] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      y = Math.min(y, game.terrain.groundY(x + ox * this.size * 0.45, z + oz * this.size * 0.45));
    }
    this.pos.set(x, y, z);
    this.vis = game.factory.makeBuilding(type, team);
    this.model = this.vis.getObjectByName('model');
    this.vis.rotation.y = team === 0 ? Math.PI * 0.75 : -Math.PI * 0.25; // face the map centre
    this.obj.add(this.vis);
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    this.height = box.max.y - box.min.y;
    this.barHeight = this.height + 0.6;
    this.spin = this.vis.userData.spin;
    this.mats = [];
    this.model.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); this.mats.push(o.material); } });
    if (!complete) {
      this.model.scale.y = 0.05;
      this.scaffold = game.factory.makeScaffold(this.size);
      this.obj.add(this.scaffold);
    }
    game.grid.occupy(cx, cz, this.size, this.size, 1);
    game.scene.add(this.obj);
  }

  addProgress(p) {
    if (this.complete || !this.alive) return;
    this.progress = Math.min(1, this.progress + p);
    this.hp = Math.min(this.maxHp, this.hp + p * this.maxHp * 0.9);
    this.model.scale.y = 0.05 + 0.95 * this.progress;
    if (this.scaffold) this.scaffold.scale.y = 1 - this.progress * 0.25;
    if (this.progress >= 1) {
      this.complete = true;
      this.model.scale.y = 1;
      if (this.scaffold) { this.obj.remove(this.scaffold); this.scaffold = null; }
      this.game.fx.dust(this.pos, this.size * 0.5, 10);
      this.game.onBuildingComplete(this);
    }
  }

  enqueue(type) { this.queue.push(type); }

  update(dt) {
    this.updateFlash(dt);
    if (!this.alive) return false;
    // fire and smoke when badly damaged
    const f = this.hp / this.maxHp;
    if (f < 0.6 && this.complete) {
      this.fireT -= dt;
      if (this.fireT <= 0) {
        this.fireT = 0.08 + f * 0.25;
        this.game.fx.fire(this.pos, this.size, Math.min(this.height, 4), f < 0.3);
      }
    }
    if (!this.complete) return true;
    for (const s of this.spin) s.rotation.z += dt * 1.2;
    // training
    if (this.queue.length) {
      const type = this.queue[0];
      const def = UNIT_TYPES[type];
      const st = this.game.teams[this.team];
      if (st.pop + def.pop > st.popCap) {
        this.blocked = true;
        if (this.team === 0) this.game.notify('Not enough population — build a House', 'warn', 'pop', 20);
      } else {
        this.blocked = false;
        this.trainT += dt;
        if (this.trainT >= def.time) {
          this.trainT = 0;
          this.queue.shift();
          this.game.spawnFromBuilding(this, type);
        }
      }
    }
    // defensive fire
    const atk = this.def.attack;
    if (atk) {
      this.cool -= dt;
      this.scanT -= dt;
      if (this.scanT <= 0) {
        this.scanT = 0.4;
        const t = this.attackTarget;
        if (!t || !t.alive || this.game.distTo(this, t) > atk.range) this.attackTarget = this.game.findEnemy(this, atk.range, true);
      }
      const t = this.attackTarget;
      if (t && t.alive && this.cool <= 0) {
        this.cool = atk.cooldown;
        this.game.fireProjectile(this, t, atk.projectile, atk.dmg * (this.dmgMul || 1));
      }
    }
    return true;
  }
}
