import * as THREE from 'three';
import { UNIT_TYPES, BUILDING_TYPES, TEAM_CSS, PLAYER, SAGA } from './config.js';
import { fmtTime } from './saga.js';
import { N, HALF } from './terrain.js';

const $ = (id) => document.getElementById(id);
const costText = (c) => [c.crystal ? `${c.crystal}◆` : '', c.wood ? `${c.wood}▬` : ''].filter(Boolean).join(' ');

export class HUD {
  constructor(game, rtsCam, input) {
    this.game = game;
    this.cam = rtsCam;
    this.input = input;
    this.el = $('hud');
    this.sel = $('selection-panel');
    this.card = $('command-card');
    this.tip = $('tooltip');
    this.mm = $('minimap');
    this.mmCtx = this.mm.getContext('2d');
    this.mmBase = game.terrain.minimapImage(200);
    this.sig = '';
    this.t = 0;
    this.commands = [];
    this.alerts = [];
    this.el.classList.remove('hidden');
    this.bindMinimap();
  }

  toast(text, kind = 'info') {
    const box = $('toasts');
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.textContent = text;
    box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 450); }, 2600);
  }
  alertAt(p) { this.alerts.push({ x: p.x, z: p.z, t: 0 }); }

  // ---- commands for the current selection ----
  buildCommands() {
    const g = this.game;
    const sel = g.selection.filter((e) => e.alive && e.team === PLAYER);
    const cmds = [];
    if (!sel.length) return cmds;
    const units = sel.filter((e) => e.isUnit);
    const blds = sel.filter((e) => e.isBuilding);
    const st = g.teams[PLAYER];
    if (units.length) {
      const hasWorker = units.some((u) => u.type === 'worker');
      if (hasWorker) {
        const order = ['house', 'lumbermill', 'mine', 'tower', 'barracks', 'archery', 'sanctum', 'workshop', ...(g.saga ? ['infirmary', 'yard'] : [])];
        order.forEach((type) => {
          const d = BUILDING_TYPES[type];
          const hallLock = g.hallLocked(type);
          const locked = hallLock || (d.requires && !g.hasBuilding(PLAYER, d.requires));
          const lbl = g.buildingLabel(type, PLAYER);
          const desc = g.viking && g.trainsFor(type, PLAYER) && d.trains ? `Trains ${g.trainsFor(type, PLAYER).map((t) => g.unitLabel(t, PLAYER)).join(' and ')}s.${d.requires ? ` Requires a ${g.buildingLabel(d.requires, PLAYER)}.` : ''}` : d.desc;
          cmds.push({
            key: d.key, label: lbl, icon: this.icons?.[type], glyph: d.glyph, cost: d.cost,
            disabled: locked || !g.canAfford(PLAYER, d.cost),
            tip: `<b>${lbl}</b><br>${desc}${hallLock ? `<br><span style="color:#ef5a4f">Requires Great Hall Lv ${g.hallReq(type)}</span>` : locked ? `<br><span style="color:#ef5a4f">Requires ${g.buildingLabel(d.requires, PLAYER)}</span>` : ''}`,
            run: () => this.input.startPlacement(type),
          });
        });
      }
      const hero = g.saga && units.find((u) => u.heroId);
      if (hero) {
        const cdTxt = (v) => (v > 0 ? ` (${Math.ceil(v)}s)` : '');
        SAGA.heroes[hero.heroId].abilities.forEach((ab, i) => {
          const cd = hero.cd[ab.id] || 0;
          cmds.push({ key: ab.key, label: `${ab.name}${cdTxt(cd)}`, glyph: ab.glyph, disabled: cd > 0, slot: 4 + i, hidden: hasWorker,
            tip: `<b>${ab.name}</b> · cooldown ${ab.cd}s<br>${ab.tip}`,
            run: () => { if (!hero.useAbility(ab.id)) g.notify(`${ab.name} is not ready`, 'warn', `cd${ab.id}`); } });
        });
        const h = g.saga.heroes[hero.heroId];
        cmds.push({ key: 'B', label: 'Warband', glyph: '⚑', slot: 6, hidden: hasWorker,
          tip: `<b>Form warband</b> (${g.saga.band(h).length}/${g.saga.bandSize(h)})<br>Select troops together with the hero and press B: they follow the hero and join its fights. Press B with only band members selected to release them. Room grows with hero level.`,
          run: () => g.saga.formBand(hero, units) });
        cmds.push({ key: 'T', label: 'March home', glyph: '⌂', slot: 7, hidden: hasWorker,
          tip: '<b>March home</b><br>The hero and its warband return to the Great Hall.', run: () => g.saga.marchHome(hero) });
        const yard = g.saga.yardFor();
        cmds.push({ key: 'Y', label: 'Train', glyph: '⚔', slot: 11, hidden: hasWorker, disabled: !yard,
          tip: `<b>Train at the Training Yard</b><br>${yard ? `The hero walks to the yard and drills for XP (up to Lv ${g.saga.yardCap(yard)}).` : '<span style="color:#ef5a4f">Build a Training Yard first (Great Hall Lv 3).</span>'}`,
          run: () => g.saga.sendToYard(hero) });
      }
      cmds.push({ key: 'A', label: 'Attack', glyph: '⚔', tip: '<b>Attack-move</b><br>Move and engage enemies on the way.', run: () => this.input.setMode('amove'), slot: 8 });
      cmds.push({ key: 'S', label: 'Stop', glyph: '■', tip: '<b>Stop</b>', run: () => { for (const u of units) u.stop(); }, slot: 9 });
      if (hasWorker) cmds.push({ key: 'D', label: 'Return', glyph: '⇲', tip: '<b>Return cargo</b><br>Carry resources to the nearest drop-off.', run: () => { for (const u of units) u.returnCargo(); }, slot: 10 });
    } else if (blds.length) {
      const b = blds[0];
      if (g.saga && b.team === PLAYER) {
        const sg = g.saga, why = sg.canUpgrade(b);
        const lv = b.level || 1;
        if (lv < SAGA.maxLevel) {
          const cost = sg.upgradeCost(b);
          const msg = { busy: b.upg ? `Upgrading… ${fmtTime((b.upg.end - Date.now()) / 1000)}` : 'Finish construction first', hall: `Requires Great Hall Lv ${lv + 1}`, builders: `All ${SAGA.builders} builders busy`, cost: 'Not enough resources' }[why] || '';
          cmds.push({ key: 'U', label: b.upg ? `Lv ${b.upg.to} ${fmtTime((b.upg.end - Date.now()) / 1000)}` : `Upgrade Lv ${lv + 1}`, glyph: '⬆', cost: b.upg ? null : cost, disabled: !!why, slot: 11,
            tip: `<b>Upgrade to Lv ${lv + 1}</b> · ${fmtTime(sg.upgradeTime(b))}<br>${this.upgradeText(b)}<br><small>Upgrades keep going in real time, even after you close the game.</small>${msg ? `<br><span style="color:#ef5a4f">${msg}</span>` : ''}`,
            run: () => sg.startUpgrade(b) });
        }
      }
      if (b.complete && b.trains) {
        const keys = ['Q', 'W', 'E', 'R'];
        b.trains.forEach((type, i) => {
          const d = UNIT_TYPES[type];
          const lbl = g.unitLabel(type, PLAYER);
          cmds.push({
            key: keys[i], label: lbl, icon: this.icons?.[type], glyph: d.glyph, cost: d.cost,
            disabled: !g.canAfford(PLAYER, d.cost) || st.pop + d.pop > st.popCap,
            tip: `<b>${lbl}</b> · ${d.time}s · pop ${d.pop}<br>${d.desc}<br>HP ${d.hp} · DMG ${d.dmg} · Range ${d.range}`,
            run: () => { for (const bb of blds) if (bb.type === b.type) { g.train(bb, type); break; } },
          });
        });
      }
    }
    return cmds;
  }
  upgradeText(b) {
    const g = this.game;
    if (b.type === 'keep') {
      const L = (b.level || 1) + 1;
      const unl = Object.entries(SAGA.hallReq).filter(([, l]) => l === L).map(([t]) => g.buildingLabel(t, PLAYER));
      const heroes = Object.values(SAGA.heroes).filter((h) => h.hall === L).map((h) => h.name);
      return `+20% HP, +3 population, more tribute. Other buildings can be raised to Lv ${L}.${unl.length ? ` Unlocks ${unl.join(', ')}.` : ''}${heroes.length ? ` ${heroes.join(', ')} joins your clan.` : ''}`;
    }
    if (b.trains) return 'Troops trained here gain +12% HP and +10% damage per level.';
    if (b.type === 'house') return '+2 population, +20% HP.';
    if (b.type === 'tower') return '+15% arrow damage, +20% HP.';
    if (b.def.dropoff) return '+10% resources from every load dropped off here.';
    if (b.type === 'infirmary') return `+${SAGA.infirmary.capPerLevel} wounded beds, faster healing, +20% HP.`;
    if (b.type === 'yard') return `Heroes can train ${SAGA.yard.capPerLevel} levels higher and gain XP faster.`;
    return '+20% HP.';
  }
  renderCommands() {
    this.commands = this.buildCommands();
    const slots = new Array(12).fill(null);
    let i = 0;
    for (const c of this.commands) {
      if (c.hidden) continue; // hotkey only (no room on the card)
      if (c.slot != null) slots[c.slot] = c;
      else { while (slots[i]) i++; slots[i++] = c; }
    }
    this.card.innerHTML = '';
    slots.forEach((c) => {
      const d = document.createElement('div');
      if (!c) { d.style.visibility = 'hidden'; this.card.appendChild(d); return; }
      d.className = `cmd${c.disabled ? ' disabled' : ''}`;
      const art = c.icon ? `<img class="icon" src="${c.icon}" alt="">` : `<span class="glyph">${c.glyph}</span>`;
      d.innerHTML = `<span class="key">${c.key}</span>${art}<span class="lbl">${c.label}</span>${c.cost ? `<span class="cost">${costText(c.cost)}</span>` : ''}`;
      d.addEventListener('click', (ev) => { ev.stopPropagation(); c.run(); });
      d.addEventListener('mouseenter', () => this.showTip(c.tip, d));
      d.addEventListener('mouseleave', () => this.hideTip());
      this.card.appendChild(d);
    });
  }
  trigger(key) {
    const c = this.commands.find((c) => c.key === key);
    if (c) { c.run(); return true; }
    return false;
  }
  showTip(html, anchor) {
    if (!html) return;
    this.tip.innerHTML = html;
    this.tip.style.display = 'block';
    const r = anchor.getBoundingClientRect();
    this.tip.style.left = `${Math.min(window.innerWidth - 270, r.left)}px`;
    this.tip.style.top = `${r.top - this.tip.offsetHeight - 8}px`;
  }
  hideTip() { this.tip.style.display = 'none'; }

  // ---- selection panel ----
  renderSelection() {
    const g = this.game;
    const sel = g.selection.filter((e) => e.alive);
    if (!sel.length) {
      const st = g.teams[PLAYER];
      const sg = g.saga;
      const raid = sg ? `<br>Great Hall <b>Lv ${sg.hallLevel()}</b> · Camps cleared <b>${sg.campsCleared}</b> (best Lv ${sg.maxCleared}) · Plunder <b>${sg.plunder}</b>
        <br>${sg.raid ? '<b style="color:#ef5a4f">Raid in progress!</b>' : sg.hallLevel() < 2 ? 'No raids until Great Hall Lv 2' : `Next raid in <b>${fmtTime(sg.raidT)}</b>`} · <b>J</b> cycles heroes · progress saves automatically` : '';
      this.sel.innerHTML = `<div class="sel-title">${g.teamName(PLAYER)}</div>
        <div class="desc">Select units with a left click or drag. Right-click to give orders.<br>
        Gathered <b>${st.gathered}</b> · Enemies defeated <b>${st.killed}</b> · Losses <b>${st.lost}</b>${raid}</div>`;
      return;
    }
    if (sel.length === 1) {
      const e = sel[0];
      const f = Math.max(0, e.hp / (e.maxHp || 1));
      if (e.isResource) {
        this.sel.innerHTML = `<div class="sel-title">${e.kind === 'crystal' ? 'Crystal formation' : 'Tree'}</div>
          <div class="stats"><span>Remaining <b>${Math.ceil(e.amount)}</b> ${e.kind}</span></div>`;
        return;
      }
      const d = e.def;
      const pic = this.icons?.[e.type] ? `<img class="portrait" src="${this.icons[e.type + (e.team ? '_1' : '')] || this.icons[e.type]}" alt="">` : '';
      const lvTag = g.saga && e.team === PLAYER && e.isBuilding ? ` · Lv ${e.level || 1}` : g.saga && e.isUnit && !d.hero && e.tier > 1 && e.team === PLAYER ? ` · Rank ${e.tier}` : g.saga && e.team !== PLAYER && e.tier ? ` · Lv ${e.tier}` : '';
      let html = `${pic}<div class="sel-title">${e.label || d.label}${lvTag}<span class="team" style="color:${TEAM_CSS[e.team]}">${g.teamName(e.team)}</span></div>
        <div class="hpbar"><i style="width:${f * 100}%"></i></div>
        <div class="stats"><span>HP <b>${Math.ceil(e.hp)}/${e.maxHp}</b></span><span>Armor <b>${d.armor || 0}</b></span>`;
      if (e.isUnit) {
        html += `<span>Damage <b>${Math.round(e.attackDamage())}</b></span><span>Range <b>${d.range}</b></span>`;
        if (d.hero && e.heroId) {
          const h = g.saga.heroes[e.heroId];
          html += `<span>Level <b>${h.level}</b></span><span>XP <b>${h.level >= SAGA.heroMaxLevel ? 'max' : `${Math.floor(h.xp)}/${g.saga.xpNeeded(h)}`}</b></span><span>Warband <b>${g.saga.band(h).length}/${g.saga.bandSize(h)}</b></span>`;
        }
        if (e.band && g.saga) html += `<span>Warband <b>${SAGA.heroes[e.band].name.split(' ')[0]}</b></span>`;
        if (e.buffT > 0) html += `<span style="color:#ffb347">War Cry <b>${Math.ceil(e.buffT)}s</b></span>`;
        if (e.wallT > 0) html += `<span style="color:#7fc8ff">Shield Wall <b>${Math.ceil(e.wallT)}s</b></span>`;
        if (e.carry) html += `<span>Carrying <b>${e.carry} ${e.carryType}</b></span>`;
        html += `<span>State <b>${({ idle: 'Idle', move: 'Moving', amove: 'Attack-moving', attack: 'Fighting', gather: 'Gathering', return: 'Returning cargo', build: 'Building' })[e.state]}</b></span>`;
      } else if (d.attack) html += `<span>Damage <b>${d.attack.dmg}</b></span><span>Range <b>${d.attack.range}</b></span>`;
      html += '</div>';
      if (e.isBuilding && e.upg) html += `<div class="desc" style="color:#ffd27a">Upgrading to Lv ${e.upg.to} — ${fmtTime((e.upg.end - Date.now()) / 1000)} left<div class="hpbar"><i style="width:${Math.min(100, (1 - (e.upg.end - Date.now()) / 1000 / e.upg.dur) * 100)}%;background:#e8c46a"></i></div></div>`;
      if (g.saga && e.isBuilding && e.complete && e.team === PLAYER) html += g.saga.panelText(e);
      if (e.isBuilding && !e.complete) html += `<div class="desc">Under construction — ${Math.floor(e.progress * 100)}%</div>`;
      else if (e.isBuilding && e.team === PLAYER && e.queue.length) {
        html += '<div class="queue">';
        e.queue.forEach((t, i) => {
          const p = i === 0 ? (e.trainT / UNIT_TYPES[t].time) * 100 : 0;
          html += `<div class="q" data-i="${i}" title="Click to cancel">${this.icons?.[t] ? `<img src="${this.icons[t]}" alt="">` : UNIT_TYPES[t].glyph}<div class="prog" style="width:${p}%"></div></div>`;
        });
        html += '</div>';
        if (e.blocked) html += '<div class="desc" style="color:#ef5a4f">Population limit reached — build a House.</div>';
      } else html += `<div class="desc">${g.saga && e.type === 'keep' && e.team === PLAYER ? 'Your seat of power. Trains thralls and takes all resources. Upgrade it (U) to unlock buildings and heroes. If raiders bring it down it is sacked, losing 20% of your stores, but never destroyed.' : d.desc}</div>`;
      this.sel.innerHTML = html;
      this.sel.querySelectorAll('.q').forEach((q) => q.addEventListener('click', () => g.cancelTrain(e, +q.dataset.i)));
      return;
    }
    const groups = new Map();
    for (const e of sel) {
      const k = e.type;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    let html = `<div class="sel-title">${sel.length} selected</div><div class="groups">`;
    for (const [k, list] of groups) {
      const d = list[0].def;
      const hp = list.reduce((s, e) => s + e.hp, 0) / list.reduce((s, e) => s + e.maxHp, 0);
      const ic = this.icons?.[k] ? `<img src="${this.icons[k]}" alt="">` : d.glyph;
      html += `<div class="gcard" data-k="${k}"><div class="n">${ic} ${list.length}</div>${list[0].label || d.label}<div class="mini"><i style="width:${hp * 100}%"></i></div></div>`;
    }
    html += '</div>';
    this.sel.innerHTML = html;
    this.sel.querySelectorAll('.gcard').forEach((c) => c.addEventListener('click', () => this.input.select(sel.filter((e) => e.type === c.dataset.k))));
  }

  // ---- minimap (a diamond: rotated with the camera so "up" is always forward) ----
  mmTransform() {
    const W = this.mm.width;
    const s = (W / N) * Math.SQRT1_2 * 0.98;
    return { W, s, yaw: this.cam.yaw };
  }
  worldToMM(x, z) {
    const { W, s, yaw } = this.mmTransform();
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    // rotate world so the camera's forward points up on the minimap
    const rx = x * c - z * sn, rz = x * sn + z * c;
    return [W / 2 + rx * s, W / 2 + rz * s];
  }
  mmToWorld(px, py) {
    const { W, s, yaw } = this.mmTransform();
    const rx = (px - W / 2) / s, rz = (py - W / 2) / s;
    const c = Math.cos(-yaw), sn = Math.sin(-yaw);
    return [rx * c - rz * sn, rx * sn + rz * c];
  }
  bindMinimap() {
    const toWorld = (ev) => {
      const r = this.mm.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * this.mm.width, py = ((ev.clientY - r.top) / r.height) * this.mm.height;
      return this.mmToWorld(px, py);
    };
    let dragging = false;
    this.mm.addEventListener('contextmenu', (e) => e.preventDefault());
    this.mm.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      const [x, z] = toWorld(ev);
      if (ev.button === 0) { dragging = true; this.cam.focus(x, z); this.mm.setPointerCapture(ev.pointerId); }
      else if (ev.button === 2) this.input.rightClickAt({ x, y: this.game.terrain.groundY(x, z), z }, null);
    });
    this.mm.addEventListener('pointermove', (ev) => { if (dragging) { const [x, z] = toWorld(ev); this.cam.focus(x, z); } });
    this.mm.addEventListener('pointerup', () => { dragging = false; });
  }
  drawMinimap(dt) {
    const ctx = this.mmCtx, g = this.game;
    const W = this.mm.width;
    ctx.fillStyle = '#1b232c';
    ctx.fillRect(0, 0, W, W);
    const { s, yaw } = this.mmTransform();
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(yaw);
    ctx.scale(s, s);
    ctx.drawImage(this.mmBase, -HALF, -HALF, N, N);
    ctx.restore();
    const dot = (x, z, size, color) => { const [px, py] = this.worldToMM(x, z); ctx.fillStyle = color; ctx.fillRect(px - size / 2, py - size / 2, size, size); };
    for (const r of g.resources) if (r.alive && r.kind === 'crystal') dot(r.pos.x, r.pos.z, 3, '#f59be8');
    for (const b of g.buildings) if (b.alive) { dot(b.pos.x, b.pos.z, b.size * 2.2 + 1, '#000'); dot(b.pos.x, b.pos.z, b.size * 2.2, TEAM_CSS[b.team]); }
    for (const u of g.units) if (u.alive) dot(u.pos.x, u.pos.z, u.selected ? 4 : 3, u.selected ? '#b6ffbf' : TEAM_CSS[u.team]);
    // attack pings
    for (let i = this.alerts.length - 1; i >= 0; i--) {
      const a = this.alerts[i];
      a.t += dt;
      if (a.t > 3) { this.alerts.splice(i, 1); continue; }
      const [px, py] = this.worldToMM(a.x, a.z);
      ctx.strokeStyle = `rgba(255,80,60,${1 - a.t / 3})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 4 + (a.t % 1) * 14, 0, Math.PI * 2); ctx.stroke();
    }
    // camera footprint
    const cam = this.cam.camera;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
      const v = new THREE.Vector3(x, y, 0.5).unproject(cam).sub(cam.position).normalize();
      const p = new THREE.Vector3();
      const t = v.y < -0.01 ? (this.cam.target.y - cam.position.y) / v.y : 200;
      p.copy(cam.position).addScaledVector(v, Math.min(t, 200));
      return this.worldToMM(p.x, p.z);
    });
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
  }

  update(dt) {
    const g = this.game;
    const st = g.teams[PLAYER];
    this.t -= dt;
    this.drawMinimap(dt);
    if (this.t > 0) return;
    this.t = 0.15;
    $('r-crystal').textContent = Math.floor(st.crystal);
    $('r-wood').textContent = Math.floor(st.wood);
    $('r-pop').textContent = `${st.pop}/${st.popCap}`;
    $('r-pop').style.color = st.pop >= st.popCap ? '#ef5a4f' : '';
    const m = Math.floor(g.time / 60), s = Math.floor(g.time % 60);
    $('clock').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    // rebuild the command card when its inputs change
    const sel = g.selection.filter((e) => e.alive);
    let sig = sel.map((e) => `${e.id}:${e.complete}`).join(',') + `|${Math.floor(st.crystal / 10)}|${Math.floor(st.wood / 10)}|${st.pop}/${st.popCap}|${g.hasBuilding(PLAYER, 'barracks')}`;
    if (g.saga) {
      for (const e of sel) {
        if (e.cd) sig += `|${Object.values(e.cd).map((v) => Math.max(0, Math.ceil(v))).join('/')}`;
        if (e.isBuilding) sig += `|${e.level}|${e.upg ? Math.ceil((e.upg.end - Date.now()) / 1000) : '-'}`;
      }
      sig += `|${g.saga.hallLevel()}|${g.saga.buildersBusy()}`;
      const el = $('r-glory');
      el.parentElement.classList.remove('hidden');
      const dead = Object.values(g.saga.heroes).filter((h) => h.respawnT >= 0);
      el.textContent = `Hall Lv ${g.saga.hallLevel()} · Builders ${SAGA.builders - g.saga.buildersBusy()}/${SAGA.builders}${dead.length ? ` · Valhalla ${Math.ceil(dead[0].respawnT)}s` : ''}`;
    }
    if (sig !== this.sig) { this.sig = sig; this.renderCommands(); }
    this.renderSelection();
  }

  // a small "+10" that rises from where a worker dropped off resources (HTML, not in-scene text)
  floatText(p, text, kind) {
    const cam = this.input.camera;
    const v = p.clone(); v.y += 2; v.project(cam);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return;
    const el = document.createElement('div');
    el.className = `float ${kind}`;
    el.innerHTML = kind === 'crystal' || kind === 'wood' ? `${text} <i class="ic-${kind}"></i>` : text;
    if (kind !== 'crystal' && kind !== 'wood') el.style.marginLeft = `${(Math.random() - 0.5) * 30}px`;
    el.style.left = `${((v.x + 1) / 2) * window.innerWidth}px`;
    el.style.top = `${((1 - v.y) / 2) * window.innerHeight}px`;
    document.getElementById('hud').appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }
}
