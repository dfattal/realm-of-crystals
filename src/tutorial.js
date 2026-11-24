import * as THREE from 'three';
import { PLAYER, ENEMY, BUILDING_TYPES } from './config.js';
import { BASES } from './terrain.js';

const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const T = (mouse, touch) => (TOUCH ? touch : mouse);

// Guided first game. The enemy stays in its base until the last lesson; each step checks the
// game state and advances by itself. Resources are topped up so nobody waits on the economy.
export class Tutorial {
  constructor({ game, hud, input, rtsCam, scene, onFinish }) {
    Object.assign(this, { game, hud, input, rtsCam, scene, onFinish });
    game.aiEnabled = false;
    this.i = -1;
    this.t = 0;
    this.done = false;
    this.el = document.getElementById('tutorial');
    this.el.classList.remove('hidden');
    document.getElementById('tut-skip').onclick = () => this.finish(true);
    document.getElementById('tut-next').onclick = () => { if (this.step?.manual) this.next(); };

    // a bouncing arrow that points at the thing to click
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd34d, depthTest: false, transparent: true });
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 4).rotateX(Math.PI), mat);
    this.arrow.renderOrder = 20;
    this.arrow.visible = false;
    scene.add(this.arrow);

    const g = game;
    const mine = (type) => g.buildings.filter((b) => b.alive && b.team === PLAYER && b.type === type);
    const units = (type) => g.units.filter((u) => u.alive && u.team === PLAYER && u.type === type);
    const sel = () => g.selection.filter((e) => e.alive && e.team === PLAYER);
    const keep = g.keeps[PLAYER];
    const nearTree = () => g.nearestResource('wood', keep.pos, 40);
    const camStart = rtsCam.target.clone();

    this.steps = [
      {
        title: 'Welcome, commander',
        text: `The undead <b>Bone Legion</b> lies across the river. Before they march, let's learn the basics.<br><br>${T('Move the camera with the <b>arrow keys</b>, by pushing the mouse to the <b>screen edge</b>, or by dragging with the <b>middle mouse button</b>. Scroll to zoom.', '<b>Drag one finger</b> to move the map. <b>Pinch</b> to zoom, twist two fingers to rotate.')}`,
        goal: 'Move the camera',
        check: () => rtsCam.target.distanceTo(camStart) > 6,
      },
      {
        title: 'Select a worker',
        text: `Workers gather resources and build. ${T('<b>Left-click</b> a worker to select it, or <b>drag a box</b> around several.', '<b>Tap</b> a worker to select it.')}`,
        goal: 'Select a worker',
        start: () => rtsCam.focus(keep.pos.x + 2, keep.pos.z - 2),
        target: () => units('worker')[0],
        check: () => sel().some((e) => e.type === 'worker'),
      },
      {
        title: 'Chop wood',
        text: `Trees give <b class="c-wood">wood</b>. With a worker selected, ${T('<b>right-click</b> a tree', '<b>tap</b> a tree')}. The worker chops it and carries the wood back to your Castle by itself.`,
        goal: 'Send a selected worker to a tree',
        target: () => nearTree(),
        check: () => sel().some((u) => u.type === 'worker' && u.state === 'gather' && u.target?.kind === 'wood' && u.orderedAt > this.t0),
      },
      {
        title: 'Mine crystal',
        text: `Pink formations are <b class="c-crystal">crystal</b>, the other resource. Select a worker and send it to a crystal the same way.`,
        goal: 'Send a worker to a crystal',
        target: () => g.nearestResource('crystal', keep.pos, 40),
        check: () => g.units.some((u) => u.alive && u.team === PLAYER && u.state === 'gather' && u.target?.kind === 'crystal' && u.orderedAt > this.t0),
      },
      {
        title: 'Train a worker',
        text: `More workers means a faster economy. ${T('Click', 'Tap')} your <b>Castle</b> to select it, then press <b>Worker</b> in the command card (bottom right).`,
        goal: 'Train a worker at the Castle',
        target: () => keep,
        start: () => this.topUp(100, 0),
        check: () => keep.queue.length > 0 || units('worker').length > 5,
      },
      {
        title: 'Build a House',
        text: `Each unit takes population (top bar). Houses raise the limit. Select a worker, press <b>House</b>, then ${T('click', 'tap')} open ground to place it. The worker walks over and builds it.`,
        goal: 'Place a House',
        start: () => this.topUp(0, 120),
        check: () => mine('house').length > 0,
      },
      {
        title: 'Raise a Barracks',
        text: `Barracks train <b>Knights</b>. Select a worker and build a <b>Barracks</b>. ${T('Shift-click to place it with all selected workers', 'Select several workers first')} to build faster.`,
        goal: 'Build a Barracks and wait for it to finish',
        start: () => this.topUp(100, 200),
        target: () => mine('barracks')[0],
        check: () => mine('barracks').some((b) => b.complete),
      },
      {
        title: 'Train Knights',
        text: 'Select the Barracks and train <b>3 Knights</b>. Units walk to the rally point; with the Barracks selected, ' + T('right-click', 'tap') + ' the ground to set it.',
        goal: () => `Knights: ${units('knight').length} / 3`,
        start: () => this.topUp(220, 80),
        target: () => mine('barracks')[0],
        check: () => units('knight').length >= 3,
      },
      {
        title: 'Defend!',
        text: `A skeleton raiding party is coming! Select your Knights${T(' (drag a box around them)', '')} and ${T('right-click', 'tap')} an enemy to attack. ${T('Press <b>A</b> then click the ground to attack-move: units fight anything on the way.', 'Press <b>Attack</b>, then tap the ground to attack-move: units fight anything on the way.')}`,
        goal: () => `Raiders left: ${this.raid ? this.raid.filter((u) => u.alive).length : 3}`,
        start: () => this.spawnRaid(),
        target: () => this.raid?.find((u) => u.alive),
        check: () => this.raid && this.raid.every((u) => !u.alive),
      },
      {
        title: 'You are ready',
        text: `Well fought! What's next:<br>• <b>Lumber Mill</b> and <b>Crystal Mine</b> are drop-off points; build them near far resources.<br>• <b>Archery Range</b>, <b>Arcane Sanctum</b> and <b>Siege Workshop</b> unlock Rangers, Mages and Catapults.<br>• <b>Guard Towers</b> defend your base.<br><br>Destroy the enemy <b>Castle</b> across the river to win. The Bone Legion is waking up…`,
        goal: '',
        manual: 'Start the battle',
      },
    ];
    this.next();
  }

  topUp(crystal, wood) {
    const st = this.game.teams[PLAYER];
    st.crystal = Math.max(st.crystal, crystal + 50);
    st.wood = Math.max(st.wood, wood + 50);
  }

  spawnRaid() {
    const g = this.game;
    const k = g.keeps[PLAYER].pos, e = BASES[ENEMY];
    const dx = e.x - k.x, dz = e.z - k.z, d = Math.hypot(dx, dz);
    const sx = k.x + (dx / d) * 22, sz = k.z + (dz / d) * 22;
    this.raid = ['worker', 'knight', 'worker'].map((type, i) => {
      const p = g.grid.nearestFree(sx + i * 1.2, sz - i * 0.8) || { x: sx, z: sz };
      const u = g.spawnUnit(type, ENEMY, p.x, p.z);
      u.hp = u.maxHp = Math.round(u.maxHp * 0.6);
      u.moveTo(k.x + (dx / d) * 6, k.z + (dz / d) * 6, true);
      return u;
    });
    g.notify('Skeleton raiders approach!', 'warn');
    this.rtsCam.focus(k.x + (dx / d) * 10, k.z + (dz / d) * 10);
  }

  next() {
    this.i++;
    if (this.i >= this.steps.length) { this.finish(false); return; }
    this.step = this.steps[this.i];
    this.t0 = this.game.time;
    this.step.start?.();
    this.render();
  }

  render() {
    const s = this.step;
    const goal = typeof s.goal === 'function' ? s.goal() : s.goal;
    this.el.querySelector('.tut-count').textContent = `Tutorial ${this.i + 1} / ${this.steps.length}`;
    this.el.querySelector('.tut-title').textContent = s.title;
    this.el.querySelector('.tut-text').innerHTML = s.text;
    const gEl = this.el.querySelector('.tut-goal');
    gEl.innerHTML = goal ? `<span class="box"></span>${goal}` : '';
    gEl.classList.toggle('hidden', !goal);
    if (!this.pending) gEl.classList.remove('done');
    const btn = document.getElementById('tut-next');
    btn.textContent = s.manual || '';
    btn.classList.toggle('hidden', !s.manual);
    this.lastGoal = goal;
  }

  update(dt) {
    if (this.done) return;
    const s = this.step;
    // keep the player alive and stocked during the lessons
    const tgt = s.target?.();
    if (tgt && tgt.alive !== false) {
      const h = tgt.isBuilding ? Math.min(tgt.height, 4) + 1.2 : tgt.isResource ? (tgt.kind === 'wood' ? 3.8 : 2.2) : tgt.height + 1.3;
      this.arrow.visible = true;
      this.arrow.position.set(tgt.pos.x, tgt.pos.y + h + Math.abs(Math.sin(performance.now() / 260)) * 0.6, tgt.pos.z);
      this.arrow.rotation.y += dt * 2;
    } else this.arrow.visible = false;
    const goal = typeof s.goal === 'function' ? s.goal() : s.goal;
    if (goal !== this.lastGoal) this.render();
    if (!s.manual && s.check?.()) {
      if (this.pending == null) {
        this.pending = 0.9;
        this.el.querySelector('.tut-goal')?.classList.add('done');
      }
    }
    if (this.pending != null) {
      this.pending -= dt;
      if (this.pending <= 0) { this.pending = null; this.el.querySelector('.tut-goal').classList.remove('done'); this.next(); }
    }
  }

  finish(skipped) {
    if (this.done) return;
    this.done = true;
    this.el.classList.add('hidden');
    this.arrow.parent?.remove(this.arrow);
    this.game.aiEnabled = true;
    this.game.ai.t = 0; // the AI starts its build-up now, giving the player a head start
    this.game.notify(skipped ? 'Tutorial skipped. The Bone Legion stirs…' : 'The Bone Legion stirs. Good luck, commander!', 'warn');
    this.onFinish?.();
  }
}
