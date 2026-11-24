export const TEAM_COLORS = [0x2f7cf6, 0xe0403a];
export const TEAM_CSS = ['#3d8bff', '#e0403a'];
export const TEAM_NAMES = ['Azure Order', 'Bone Legion'];
export const PLAYER = 0;
export const ENEMY = 1;
export const MAX_POP = 80;
export const START_RES = { crystal: 250, wood: 220 };
export const CARRY = 10;

// Character models per team (KayKit Adventurers vs KayKit Skeletons), with the weapons each holds.
export const UNIT_MODELS = {
  worker: [
    { model: 'char_Barbarian', show: ['1H_Axe', 'Barbarian_Hat'] },
    { model: 'char_Skeleton_Minion', attach: { r: 'w_Skeleton_Axe' } },
  ],
  knight: [
    { model: 'char_Knight', show: ['1H_Sword', 'Round_Shield', 'Knight_Helmet', 'Knight_Cape'] },
    { model: 'char_Skeleton_Warrior', show: ['Skeleton_Warrior_Helmet'], attach: { r: 'w_Skeleton_Blade', l: 'w_Skeleton_Shield_Small_A' } },
  ],
  ranger: [
    { model: 'char_Rogue_Hooded', show: ['2H_Crossbow', 'Rogue_Cape'] },
    { model: 'char_Skeleton_Rogue', show: ['Skeleton_Rogue_Hood', 'Skeleton_Rogue_Cape'], attach: { r: 'w_Skeleton_Crossbow' } },
  ],
  mage: [
    { model: 'char_Mage', show: ['2H_Staff', 'Mage_Hat', 'Mage_Cape'] },
    { model: 'char_Skeleton_Mage', show: ['Skeleton_Mage_Hat'], attach: { r: 'w_Skeleton_Staff' } },
  ],
  // ---- Viking Raid roster (player side only; the second entry is never used) ----
  berserker: [{ model: 'char_Barbarian', show: ['2H_Axe', 'Barbarian_Cape'] }],
  huscarl: [{ model: 'char_Barbarian', show: ['1H_Axe', 'Barbarian_Round_Shield', 'Barbarian_Hat', 'Barbarian_Cape'] }],
  thrower: [{ model: 'char_Barbarian', show: ['1H_Axe', '1H_Axe_Offhand', 'Barbarian_Hat'] }],
  seer: [{ model: 'char_Mage', show: ['2H_Staff', 'Mage_Cape'] }],
  jarl: [{ model: 'char_Barbarian', show: ['2H_Axe', 'Barbarian_Hat', 'Barbarian_Cape'] }],
  shieldmaiden: [{ model: 'char_Knight', show: ['1H_Sword', 'Badge_Shield', 'Knight_Cape'] }],
  volva: [{ model: 'char_Mage', show: ['2H_Staff', 'Mage_Hat', 'Mage_Cape'] }],
};
for (const v of Object.values(UNIT_MODELS)) if (v.length === 1) v.push(v[0]);

export const UNIT_TYPES = {
  worker: {
    label: 'Worker', glyph: '⚒', cost: { crystal: 50, wood: 0 }, hp: 60, armor: 0, speed: 3.4,
    dmg: 5, range: 0.8, cooldown: 1.3, aggro: 0, time: 9, pop: 1, height: 1.45, radius: 0.42,
    kind: 'char', attackAnim: '1H_Melee_Attack_Chop', hitAt: 0.45,
    desc: 'Gathers crystal and wood, and builds structures.',
  },
  knight: {
    label: 'Knight', glyph: '⚔', cost: { crystal: 60, wood: 20 }, hp: 160, armor: 2, speed: 3.7,
    dmg: 13, range: 0.9, cooldown: 1.0, aggro: 8, time: 13, pop: 1, height: 1.65, radius: 0.52,
    kind: 'char', attackAnim: ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Stab'], hitAt: 0.42,
    desc: 'Sturdy sword-and-shield fighter. Strong against rangers and mages.',
  },
  ranger: {
    label: 'Ranger', glyph: '➶', cost: { crystal: 45, wood: 45 }, hp: 85, armor: 0, speed: 3.6,
    dmg: 10, range: 7.5, cooldown: 1.4, aggro: 9, time: 13, pop: 1, height: 1.55, radius: 0.46,
    kind: 'char', projectile: 'arrow', attackAnim: '2H_Ranged_Shoot', hitAt: 0.35,
    desc: 'Crossbow skirmisher. Keep it behind your knights.',
  },
  mage: {
    label: 'Mage', glyph: '✦', cost: { crystal: 95, wood: 35 }, hp: 75, armor: 0, speed: 3.3,
    dmg: 20, range: 8.5, cooldown: 2.4, aggro: 10, time: 17, pop: 2, height: 1.75, radius: 0.46,
    kind: 'char', projectile: 'orb', splash: 1.7, attackAnim: 'Spellcast_Shoot', hitAt: 0.45,
    desc: 'Hurls arcane orbs that burst on impact, hitting groups of enemies.',
  },
  catapult: {
    label: 'Catapult', glyph: '☄', cost: { crystal: 100, wood: 150 }, hp: 220, armor: 1, speed: 2.3,
    dmg: 38, range: 11, cooldown: 3.8, aggro: 11, time: 22, pop: 3, height: 1.7, radius: 0.95,
    kind: 'catapult', projectile: 'boulder', vsBuilding: 2.6, splash: 1.9,
    desc: 'Siege engine with splash damage. Devastating against buildings.',
  },

  // ---- Viking Raid roster ----
  berserker: {
    label: 'Berserker', glyph: '⚔', cost: { crystal: 65, wood: 20 }, hp: 140, armor: 0, speed: 4.0,
    dmg: 17, range: 1.0, cooldown: 1.15, aggro: 9, time: 13, pop: 1, height: 1.6, radius: 0.5,
    kind: 'char', attackAnim: ['2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice'], hitAt: 0.5, combatIdle: '2H_Melee_Idle',
    rage: true, heavy: true,
    desc: 'Two-handed axe fighter. Hits harder the more wounded it is.',
  },
  huscarl: {
    label: 'Huscarl', glyph: '⛨', cost: { crystal: 60, wood: 30 }, hp: 190, armor: 3, speed: 3.5,
    dmg: 11, range: 0.9, cooldown: 1.0, aggro: 8, time: 14, pop: 1, height: 1.6, radius: 0.52,
    kind: 'char', attackAnim: ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Stab'], hitAt: 0.42,
    block: 0.35,
    desc: 'Axe-and-shield warrior. Blocks a third of incoming arrows and orbs.',
  },
  thrower: {
    label: 'Axe Thrower', glyph: '➶', cost: { crystal: 45, wood: 50 }, hp: 90, armor: 0, speed: 3.7,
    dmg: 12, range: 6.5, cooldown: 1.5, aggro: 8.5, time: 13, pop: 1, height: 1.5, radius: 0.46,
    kind: 'char', projectile: 'axe', attackAnim: '1H_Ranged_Shoot', hitAt: 0.38,
    desc: 'Hurls spinning throwing axes. Keep it behind your shield wall.',
  },
  seer: {
    label: 'Seer', glyph: 'ᚱ', cost: { crystal: 90, wood: 40 }, hp: 80, armor: 0, speed: 3.3,
    dmg: 16, range: 8, cooldown: 2.3, aggro: 9, time: 17, pop: 2, height: 1.7, radius: 0.46,
    kind: 'char', projectile: 'orb', orb: 'orb_rune', splash: 1.5, attackAnim: 'Spellcast_Shoot', hitAt: 0.45,
    heal: { rate: 4, range: 5 },
    desc: 'Casts rune bolts and slowly heals wounded allies nearby.',
  },
  jarl: {
    label: 'Jarl', glyph: '♛', cost: { crystal: 0, wood: 0 }, hp: 520, armor: 3, speed: 3.9,
    dmg: 30, range: 1.1, cooldown: 1.25, aggro: 10, time: 0, pop: 0, height: 2.0, radius: 0.6,
    kind: 'char', attackAnim: ['2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice'], hitAt: 0.5, combatIdle: '2H_Melee_Idle',
    hero: true, heavy: true, cleave: 1.4,
    desc: 'Hero. Levels up from battle. Leads a warband. Returns from Valhalla if slain.',
  },
  shieldmaiden: {
    label: 'Shieldmaiden', glyph: '⛉', cost: { crystal: 0, wood: 0 }, hp: 600, armor: 5, speed: 3.8,
    dmg: 22, range: 1.0, cooldown: 1.0, aggro: 10, time: 0, pop: 0, height: 1.9, radius: 0.58,
    kind: 'char', attackAnim: ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Stab'], hitAt: 0.42,
    hero: true, block: 0.4,
    desc: 'Hero. A wall of iron who protects her warband. Levels up from battle.',
  },
  volva: {
    label: 'Völva', glyph: 'ᛟ', cost: { crystal: 0, wood: 0 }, hp: 380, armor: 1, speed: 3.6,
    dmg: 26, range: 8.5, cooldown: 2.0, aggro: 10, time: 0, pop: 0, height: 1.9, radius: 0.5,
    kind: 'char', projectile: 'orb', orb: 'orb_rune', splash: 1.8, attackAnim: 'Spellcast_Shoot', hitAt: 0.45,
    hero: true, heal: { rate: 6, range: 6 },
    desc: 'Hero. A rune-witch who calls storms and mends the wounded. Levels up from battle.',
  },
};

// Clan Saga (the Viking mode): a persistent city that grows between sessions.
export const SAGA = {
  maxLevel: 10,
  builders: 2,                      // building upgrades that can run at once
  maxPop: 150,
  // Great Hall level needed for each building type
  hallReq: { house: 1, lumbermill: 1, mine: 1, barracks: 1, tower: 2, archery: 2, sanctum: 3, workshop: 4, infirmary: 2, yard: 3 },
  // Infirmary: fallen troops are carried here as wounded instead of dying, then healed back.
  infirmary: { cap: 6, capPerLevel: 3, healEvery: 9, aura: 7, auraHeal: 3 },
  // Training Yard: heroes resting inside drill for XP, up to a level cap set by the yard's level.
  yard: { range: 7, xp: 1, xpPerLevel: 0.5, capBase: 4, capPerLevel: 2, offline: 0.5,
    drill: { jarl: ['2H_Melee_Attack_Chop'], shieldmaiden: ['1H_Melee_Attack_Chop'], volva: ['Spellcasting', 'Spellcast_Shoot', 'Spellcast_Raise'] } },
  heroes: {
    jarl: { name: 'Jarl Eirik', hall: 1, abilities: [
      { id: 'cry', key: 'F', name: 'War Cry', glyph: 'ᛉ', cd: 30, anim: 'Cheer', speed: 1.8, hitAt: 0.25, dur: 9, range: 9, dmg: 1.35, haste: 1.25,
        tip: 'Warriors within 9m deal 35% more damage and move 25% faster for 9s.' },
      { id: 'slam', key: 'G', name: 'Ground Slam', glyph: 'ᛏ', cd: 16, anim: '2H_Melee_Attack_Chop', speed: 1, hitAt: 0.5, dmg: 55, range: 3.4, push: 7.5,
        tip: 'Smashes the ground, damaging every enemy in front and hurling them back.' },
    ] },
    shieldmaiden: { name: 'Sigrun Shieldmaiden', hall: 3, abilities: [
      { id: 'wall', key: 'F', name: 'Shield Wall', glyph: 'ᛒ', cd: 28, anim: 'Cheer', speed: 1.6, hitAt: 0.3, dur: 8, range: 8, reduce: 0.5,
        tip: 'Allies within 8m take half damage for 8s.' },
      { id: 'bash', key: 'G', name: 'Shield Bash', glyph: 'ᚦ', cd: 12, anim: '1H_Melee_Attack_Stab', speed: 0.9, hitAt: 0.45, dmg: 40, range: 2.6, push: 9,
        tip: 'Rams the shield forward, damaging and knocking back enemies in front.' },
    ] },
    volva: { name: 'Ylva the Völva', hall: 5, abilities: [
      { id: 'storm', key: 'F', name: 'Rune Storm', glyph: 'ᛋ', cd: 20, anim: 'Spellcast_Raise', speed: 1, hitAt: 0.6, dmg: 75, range: 3.4, reach: 8, push: 4,
        tip: 'Calls down a storm of runes on the nearest enemy group within 8m.' },
      { id: 'mend', key: 'G', name: 'Healing Chant', glyph: 'ᛚ', cd: 24, anim: 'Spellcast_Raise', speed: 1.2, hitAt: 0.5, heal: 150, range: 8,
        tip: 'Heals every ally within 8m for 150 HP.' },
    ] },
  },
  heroRespawn: 35,
  heroMaxLevel: 20,
  camps: 7,
  campRespawn: 45,
  firstRaid: 360,
  raidEvery: [360, 480],
};

// Viking Raid mode: what each production building trains, building names, and team names.
export const VIKING = {
  trains: { keep: ['worker'], barracks: ['berserker', 'huscarl'], archery: ['thrower'], sanctum: ['seer'], workshop: ['catapult'] },
  unitLabels: { worker: 'Thrall' },
  buildingLabels: {
    keep: 'Great Hall', house: 'Longhouse', tower: 'Watchtower', barracks: 'Warrior Lodge',
    archery: 'Hunting Lodge', sanctum: 'Rune Shrine', workshop: 'Siege Workshop',
  },
  teamName: 'Northmen Clan',
  glory: [0, 6, 15, 28, 45, 70],       // Glory needed for Jarl levels 1..6
  jarlRespawn: 35,
  warCry: { cd: 30, dur: 9, range: 9, dmg: 1.35, speed: 1.25 },
  slam: { cd: 16, dmg: 55, range: 3.4 },
  // Bone Legion raid camps on every expansion crystal field: [x, z, strong]. The three on the
  // player's side of the river are light camps; the three on the far side have a guard tower.
  outposts: [[-24, -8, 0], [6, 26, 0], [-8, 9, 1], [24, 8, 1], [-6, -26, 1], [8, -9, 1]],
};

// size = footprint in cells; model = KayKit building (team-coloured variants); fit = model width.
export const BUILDING_TYPES = {
  keep: {
    label: 'Castle', glyph: '♜', hp: 3000, armor: 4, size: 4, pop: 10, dropoff: 'all', trains: ['worker'],
    time: 60, cost: { crystal: 400, wood: 400 }, buildable: false, model: 'castle', fit: 4.3,
    desc: 'Your seat of power. Trains workers and accepts all resources. Lose it and you lose the war.',
    attack: { dmg: 9, range: 8, cooldown: 1.5, projectile: 'arrow' },
  },
  house: {
    label: 'House', glyph: '⌂', hp: 450, armor: 1, size: 2, pop: 6, time: 15, model: 'home_A', fit: 2.3,
    cost: { crystal: 0, wood: 70 }, key: 'Q', desc: '+6 population.',
  },
  lumbermill: {
    label: 'Lumber Mill', glyph: '🪓', hp: 600, armor: 1, size: 3, dropoff: 'wood', time: 18, model: 'lumbermill', fit: 3.1,
    cost: { crystal: 0, wood: 90 }, key: 'W', desc: 'Drop-off point for wood. Build it next to a forest.',
  },
  mine: {
    label: 'Crystal Mine', glyph: '⛏', hp: 600, armor: 1, size: 3, dropoff: 'crystal', time: 18, model: 'mine', fit: 3.1,
    cost: { crystal: 0, wood: 100 }, key: 'E', desc: 'Drop-off point for crystal. Build it next to a crystal field.',
  },
  tower: {
    label: 'Guard Tower', glyph: '♖', hp: 800, armor: 3, size: 2, time: 24, model: 'tower_A', fit: 2.0,
    cost: { crystal: 90, wood: 110 }, attack: { dmg: 15, range: 10, cooldown: 1.6, projectile: 'arrow' }, key: 'R',
    desc: 'Defensive tower whose archers fire at enemies in range.',
  },
  barracks: {
    label: 'Barracks', glyph: '⚑', hp: 1000, armor: 2, size: 4, trains: ['knight'], time: 30, model: 'barracks', fit: 3.8,
    cost: { crystal: 60, wood: 150 }, key: 'Z', desc: 'Trains Knights.',
  },
  archery: {
    label: 'Archery Range', glyph: '◎', hp: 850, armor: 2, size: 4, trains: ['ranger'], time: 28, model: 'archeryrange', fit: 3.8,
    cost: { crystal: 50, wood: 160 }, key: 'X', desc: 'Trains Rangers.',
  },
  sanctum: {
    label: 'Arcane Sanctum', glyph: '✧', hp: 800, armor: 2, size: 3, trains: ['mage'], time: 32, model: 'church', fit: 2.9,
    cost: { crystal: 180, wood: 120 }, requires: 'barracks', key: 'C', desc: 'Trains Mages. Requires a Barracks.',
  },
  workshop: {
    label: 'Siege Workshop', glyph: '⚙', hp: 900, armor: 2, size: 4, trains: ['catapult'], time: 35, model: 'blacksmith', fit: 3.9,
    cost: { crystal: 150, wood: 200 }, requires: 'barracks', key: 'V', desc: 'Builds Catapults. Requires a Barracks.',
  },
  // Clan Saga only
  infirmary: {
    label: 'Infirmary', glyph: '✚', hp: 700, armor: 1, size: 3, time: 25, model: 'home_B', fit: 2.7, saga: true,
    cost: { crystal: 80, wood: 120 }, key: 'I',
    desc: 'Troops that fall in battle are carried here as wounded instead of dying, then healed and sent back out. Also slowly heals troops standing nearby.',
  },
  yard: {
    label: 'Training Yard', glyph: '⚔', hp: 800, armor: 2, size: 3, time: 30, model: 'market', fit: 3.0, saga: true,
    cost: { crystal: 120, wood: 140 }, key: 'Y',
    desc: 'Heroes that rest here drill and gain XP over time, even while you are away. Upgrade it to raise the level heroes can train to.',
  },
};

export const RESOURCE = { crystalPerNode: 400, woodPerTree: 120 };

export const DIFFICULTY = {
  easy: { gather: 0.75, firstAttack: 480, wave: 5, waveGrow: 2, interval: 160, maxWorkers: 14, maxArmy: 18, label: 'Easy' },
  normal: { gather: 1.0, firstAttack: 330, wave: 7, waveGrow: 3, interval: 130, maxWorkers: 18, maxArmy: 30, label: 'Normal' },
  hard: { gather: 1.35, firstAttack: 240, wave: 8, waveGrow: 3, interval: 100, maxWorkers: 22, maxArmy: 42, label: 'Hard' },
};
