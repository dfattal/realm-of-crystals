import * as THREE from 'three';
import { BUILDING_TYPES, PLAYER } from './config.js';
import { HALF } from './terrain.js';

export class Input {
  constructor({ canvas, camera, rtsCam, game, scene, factory }) {
    this.canvas = canvas;
    this.camera = camera;
    this.cam = rtsCam;
    this.game = game;
    this.scene = scene;
    this.factory = factory;
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.mx = 0; this.my = 0;
    this.inside = false;
    this.mode = null;          // null | 'amove' | 'place'
    this.placeType = null;
    this.ghost = null;
    this.drag = null;
    this.mdrag = null;
    this.groups = {};
    this.lastClick = { t: 0, id: -1 };
    this.dragbox = document.getElementById('dragbox');
    this.hud = null;
    this.enabled = true;
    this.bind();
  }

  setRay(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
  }
  groundAt(clientX, clientY) {
    this.setRay(clientX, clientY);
    return this.game.terrain.raycast(this.ray.ray.origin, this.ray.ray.direction, new THREE.Vector3());
  }

  select(list, add = false) {
    const g = this.game;
    if (!add) for (const e of g.selection) e.setSelected?.(false);
    const set = new Set(add ? g.selection : []);
    for (const e of list) set.add(e);
    g.selection = [...set].filter((e) => e.alive !== false);
    for (const e of g.selection) e.setSelected?.(true);
    this.hud?.renderCommands();
  }

  setMode(m) {
    this.mode = m;
    this.canvas.style.cursor = m === 'amove' ? 'crosshair' : '';
  }
  startPlacement(type) {
    const d = BUILDING_TYPES[type];
    if (d.requires && !this.game.hasBuilding(PLAYER, d.requires)) { this.game.notify(`Requires a ${BUILDING_TYPES[d.requires].label}`, 'warn'); return; }
    if (!this.game.canAfford(PLAYER, d.cost)) { this.game.notifyCost(d.cost); return; }
    this.cancelPlacement();
    this.mode = 'place';
    this.placeType = type;
    this.ghost = this.factory.ghost(type);
    this.scene.add(this.ghost);
    this.updateGhost();
  }
  cancelPlacement() {
    if (this.ghost) this.scene.remove(this.ghost);
    this.ghost = null;
    this.placeType = null;
    if (this.mode === 'place') this.mode = null;
  }
  ghostCell() {
    const p = this.groundAt(this.mx, this.my);
    if (!p) return null;
    const s = BUILDING_TYPES[this.placeType].size;
    return [Math.round(p.x + HALF - s / 2), Math.round(p.z + HALF - s / 2)];
  }
  updateGhost() {
    if (!this.ghost) return;
    const c = this.ghostCell();
    if (!c) { this.ghost.visible = false; return; }
    this.ghost.visible = true;
    const s = BUILDING_TYPES[this.placeType].size;
    const x = c[0] - HALF + s / 2, z = c[1] - HALF + s / 2;
    this.ghost.position.set(x, this.game.terrain.groundY(x, z), z);
    const ok = this.game.canPlace(this.placeType, c[0], c[1]) && this.game.canAfford(PLAYER, BUILDING_TYPES[this.placeType].cost);
    this.ghost.userData.mat.color.setHex(ok ? 0x55ff77 : 0xff4b3e);
  }

  rightClickAt(ground, ent) {
    const g = this.game;
    if (this.mode === 'place') { this.cancelPlacement(); return; }
    if (this.mode === 'amove') { this.setMode(null); return; }
    g.commandRightClick(g.selection, ground, ent);
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    this.touches = new Map();
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') { this.touchMove(e); return; }
      this.mx = e.clientX; this.my = e.clientY;
      this.inside = true;
      const w = window.innerWidth, h = window.innerHeight, m = 6;
      this.cam.edge.set(e.clientX < m ? -1 : e.clientX > w - m ? 1 : 0, e.clientY < m ? -1 : e.clientY > h - m ? 1 : 0);
      if (this.mdrag) {
        const dx = e.clientX - this.mdrag.x, dy = e.clientY - this.mdrag.y;
        this.mdrag.x = e.clientX; this.mdrag.y = e.clientY;
        const k = this.cam.height / window.innerHeight * 1.6;
        this.cam.pan(-dx * k, -dy * k);
      }
      if (this.drag) {
        const x0 = Math.min(this.drag.x, e.clientX), y0 = Math.min(this.drag.y, e.clientY);
        const x1 = Math.max(this.drag.x, e.clientX), y1 = Math.max(this.drag.y, e.clientY);
        if (x1 - x0 > 5 || y1 - y0 > 5) {
          this.drag.active = true;
          Object.assign(this.dragbox.style, { display: 'block', left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
        }
      }
    });
    document.addEventListener('mouseleave', () => { this.inside = false; this.cam.edge.set(0, 0); });
    window.addEventListener('blur', () => { this.cam.keys.clear(); this.cam.edge.set(0, 0); });

    c.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      c.setPointerCapture(e.pointerId);
      if (e.pointerType === 'touch') { this.touchDown(e); return; }
      if (e.button === 1) { e.preventDefault(); this.mdrag = { x: e.clientX, y: e.clientY }; return; }
      if (e.button === 2) {
        this.setRay(e.clientX, e.clientY);
        const ent = this.game.pick(this.ray);
        const ground = this.groundAt(e.clientX, e.clientY);
        this.rightClickAt(ground, ent);
        return;
      }
      if (e.button !== 0) return;
      if (this.primaryAt(e.clientX, e.clientY, e.shiftKey)) return;
      this.drag = { x: e.clientX, y: e.clientY, active: false, shift: e.shiftKey };
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') { this.touchUp(e); return; }
      if (e.button === 1) { this.mdrag = null; return; }
      if (e.button !== 0 || !this.drag) return;
      const d = this.drag;
      this.drag = null;
      this.dragbox.style.display = 'none';
      if (d.active) this.boxSelect(d.x, d.y, e.clientX, e.clientY, d.shift);
      else this.clickSelect(e.clientX, e.clientY, d.shift);
    });
    window.addEventListener('pointercancel', (e) => { if (e.pointerType === 'touch') this.touches.delete(e.pointerId); });
    this._bindRest(c);
  }

  // Left click / tap while placing a building or attack-moving. Returns true if it was consumed.
  primaryAt(x, y, shift) {
      if (this.mode === 'place') {
        this.mx = x; this.my = y; this.updateGhost?.();
        const cell = this.ghostCell();
        if (cell) {
          const workers = this.game.selection.filter((u) => u.alive && u.isUnit && u.type === 'worker' && u.team === PLAYER);
          // the closest worker builds; Shift sends the whole selection
          workers.sort((a, b) => a.pos.distanceTo(this.ghost.position) - b.pos.distanceTo(this.ghost.position));
          const builders = shift ? workers : workers.slice(0, 1);
          for (const w of builders) if (w.state === 'gather' || w.state === 'return') w.lastRes = w.lastRes || w.target;
          const b = this.game.placeBuilding(this.placeType, PLAYER, cell[0], cell[1], builders);
          if (b) { this.game.fx.marker(b.pos, 0x7dff8a); if (!shift) this.cancelPlacement(); }
        }
        return true;
      }
      if (this.mode === 'amove') {
        this.setRay(x, y);
        const ent = this.game.pick(this.ray);
        const units = this.game.selection.filter((u) => u.alive && u.isUnit && u.team === PLAYER);
        if (ent && !ent.isResource && ent.team !== PLAYER) { for (const u of units) u.attack(ent); this.game.fx.marker(ent.pos, 0xff5544); }
        else {
          const p = this.groundAt(x, y);
          if (p) { this.game.formationMove(units, p.x, p.z, true); this.game.fx.marker(p, 0xff5544); }
        }
        if (!shift) this.setMode(null);
        return true;
      }
      return false;
  }

  _bindRest(c) {
    const clampZ = (v) => Math.max(-0.5, Math.min(0.5, v));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      // normalise line/page scrolling (Firefox, some mice) to pixels
      const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
      if (e.altKey || e.shiftKey) this.cam.rotate(dy * 0.004);
      // trackpad pinch arrives as ctrl+wheel with small deltas: give it more punch
      else this.cam.zoom(Math.exp(clampZ(dy * (e.ctrlKey ? 0.01 : 0.0022))));
    }, { passive: false });

    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.cam.keys.delete(e.key));
  }

  // ---- touch: one finger drags the map, two fingers pinch-zoom (and twist to rotate), tap acts ----
  groundPlane(x, y) {
    this.setRay(x, y);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.cam.target.y), p) ? p : null;
  }
  touchDown(e) {
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    this.cam.edge.set(0, 0);
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
      this.multi = true;
    }
  }
  touchMove(e) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    t.x = e.clientX; t.y = e.clientY;
    if (this.mode === 'place') { this.mx = e.clientX; this.my = e.clientY; }
    if (this.touches.size === 1 && !this.multi) {
      if (Math.hypot(t.x - t.x0, t.y - t.y0) > 10) t.moved = true;
      if (t.moved && this.mode !== 'place') {
        // grab the map: the ground point under the finger stays under the finger
        const a = this.groundPlane(t.x - dx, t.y - dy), b = this.groundPlane(t.x, t.y);
        if (a && b) { this.cam.target.x += a.x - b.x; this.cam.target.z += a.z - b.z; this.cam.update(0); }
      }
    } else if (this.touches.size === 2 && this.pinch) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (d > 10) this.cam.zoom(this.pinch.d / d);
      let da = ang - this.pinch.ang;
      if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
      this.cam.rotate(-da);
      this.pinch = { d, ang };
    }
  }
  touchUp(e) {
    const t = this.touches.get(e.pointerId);
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
    if (!t) return;
    const wasMulti = this.multi;
    if (this.touches.size === 0) this.multi = false;
    if (wasMulti || t.moved || performance.now() - t.t0 > 600) return;
    this.tap(t.x, t.y);
  }
  tap(x, y) {
    if (this.primaryAt(x, y, false)) return;
    this.setRay(x, y);
    const ent = this.game.pick(this.ray);
    const mine = this.game.selection.some((u) => u.alive && u.team === PLAYER);
    // tapping your own stuff selects it; with your units selected, tapping anything else is an order
    if (ent && ent.team === PLAYER && !ent.isResource) { this.clickSelect(x, y, false); return; }
    if (mine) {
      const ground = this.groundAt(x, y);
      this.rightClickAt(ground, ent);
      return;
    }
    this.clickSelect(x, y, false);
  }

  clickSelect(x, y, add) {
    this.setRay(x, y);
    const ent = this.game.pick(this.ray);
    if (!ent) { if (!add) this.select([]); return; }
    const now = performance.now();
    if (ent.isUnit && ent.team === PLAYER && this.lastClick.id === ent.id && now - this.lastClick.t < 350) {
      // double click: everyone of this type on screen
      const same = this.game.units.filter((u) => u.alive && u.team === PLAYER && u.type === ent.type && this.onScreen(u.pos));
      this.select(same, add);
    } else if (add && ent.selected) {
      ent.setSelected(false);
      this.game.selection = this.game.selection.filter((e) => e !== ent);
      this.hud?.renderCommands();
    } else this.select([ent], add && ent.team === PLAYER);
    this.lastClick = { t: now, id: ent.id };
  }
  onScreen(p) {
    const v = p.clone().project(this.camera);
    return v.x > -1 && v.x < 1 && v.y > -1 && v.y < 1 && v.z < 1;
  }
  boxSelect(x0, y0, x1, y1, add) {
    const r = this.canvas.getBoundingClientRect();
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    const v = new THREE.Vector3();
    const inBox = (e, yOff) => {
      v.set(e.pos.x, e.pos.y + yOff, e.pos.z).project(this.camera);
      const sx = r.left + ((v.x + 1) / 2) * r.width, sy = r.top + ((1 - v.y) / 2) * r.height;
      return sx >= lx && sx <= hx && sy >= ly && sy <= hy && v.z < 1;
    };
    const units = this.game.units.filter((u) => u.alive && u.team === PLAYER && inBox(u, u.height * 0.5));
    if (units.length) {
      // prefer the army over workers when both are boxed
      const army = units.filter((u) => u.type !== 'worker');
      this.select(army.length && army.length < units.length && !add ? army : units, add);
      return;
    }
    const blds = this.game.buildings.filter((b) => b.alive && b.team === PLAYER && inBox(b, 1));
    if (blds.length) this.select(blds.slice(0, 1), add);
    else if (!add) this.select([]);
  }

  onKey(e) {
    if (!this.enabled) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key;
    if (k.startsWith('Arrow')) { this.cam.keys.add(k); e.preventDefault(); return; }
    if (k === 'Escape') { if (this.mode === 'place') this.cancelPlacement(); else if (this.mode) this.setMode(null); else this.select([]); return; }
    if (/^[1-9]$/.test(k)) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.groups[k] = this.game.selection.filter((s) => s.team === PLAYER);
        this.game.notify(`Group ${k} set`, 'info', `grp${k}`);
      } else if (this.groups[k]) {
        const list = this.groups[k].filter((s) => s.alive);
        const now = performance.now();
        if (this.lastGroup === k && now - this.lastGroupT < 350 && list.length) this.cam.focus(list[0].pos.x, list[0].pos.z);
        this.lastGroup = k; this.lastGroupT = now;
        this.select(list);
      }
      return;
    }
    if (k === '[') { this.cam.rotate(-Math.PI / 8); return; }
    if (k === ']') { this.cam.rotate(Math.PI / 8); return; }
    if (k === '+' || k === '=') { this.cam.zoom(0.75); return; }
    if (k === '-' || k === '_') { this.cam.zoom(1.33); return; }
    if (k === 'h' || k === 'H' || k === ' ') {
      e.preventDefault();
      const keep = this.game.keeps[PLAYER];
      if (keep.alive) { this.cam.focus(keep.pos.x, keep.pos.z); this.select([keep]); }
      return;
    }
    if ((k === 'j' || k === 'J') && this.game.saga) {
      // cycle through the heroes; each comes with its warband
      const sg = this.game.saga;
      const hs = Object.values(sg.heroes).filter((h) => h.unit?.alive);
      if (!hs.length) { this.game.notify('Your heroes are in Valhalla', 'info', 'herogone'); return; }
      const cur = this.game.selection.find((e) => e.heroId);
      const i = cur ? (hs.findIndex((h) => h.unit === cur) + 1) % hs.length : 0;
      const h = hs[i];
      this.select([h.unit, ...sg.band(h)]);
      this.cam.focus(h.unit.pos.x, h.unit.pos.z);
      return;
    }
    if (k === '.') {
      const idle = this.game.units.filter((u) => u.alive && u.team === PLAYER && u.type === 'worker' && u.state === 'idle');
      if (idle.length) {
        this.idleIdx = ((this.idleIdx || 0) + 1) % idle.length;
        const w = idle[this.idleIdx];
        this.select([w]); this.cam.focus(w.pos.x, w.pos.z);
      } else this.game.notify('No idle workers', 'info', 'idle');
      return;
    }
    if (k === 'p' || k === 'P' || k === 'F3') return; // handled in main
    if (k.length === 1) this.hud?.trigger(k.toUpperCase());
  }

  update() {
    if (this.mode === 'place') this.updateGhost();
  }
}
