import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { TEAM_COLORS, UNIT_TYPES, UNIT_MODELS, BUILDING_TYPES } from './config.js';

// All models are CC0:
//  - KayKit (Kay Lousberg): Adventurers + Skeletons character packs, Medieval Hexagon pack
//  - Kenney: Castle, Tower Defense and Nature kits
// See public/licenses/.
const KK = (n) => `kk/${n}`;
const PATHS = {
  // characters + weapons
  char_Barbarian: KK('char_Barbarian'), char_Knight: KK('char_Knight'), char_Rogue_Hooded: KK('char_Rogue_Hooded'), char_Mage: KK('char_Mage'),
  char_Skeleton_Minion: KK('char_Skeleton_Minion'), char_Skeleton_Warrior: KK('char_Skeleton_Warrior'),
  char_Skeleton_Rogue: KK('char_Skeleton_Rogue'), char_Skeleton_Mage: KK('char_Skeleton_Mage'),
  w_Skeleton_Axe: KK('w_Skeleton_Axe'), w_Skeleton_Blade: KK('w_Skeleton_Blade'), w_Skeleton_Crossbow: KK('w_Skeleton_Crossbow'),
  w_Skeleton_Staff: KK('w_Skeleton_Staff'), w_Skeleton_Shield_Small_A: KK('w_Skeleton_Shield_Small_A'), w_arrow: KK('w_arrow'),
  // neutral building parts / effects
  scaffolding: KK('n_building_scaffolding'), destroyed: KK('n_building_destroyed'), projCatapult: KK('n_projectile_catapult'),
  stageA: KK('n_building_stage_A'), grain: KK('n_building_grain'), fenceWood: KK('n_fence_wood_straight'),
  // nature
  kkTreeA: KK('d_tree_single_A'), kkTreeB: KK('d_tree_single_B'), kkTreeACut: KK('d_tree_single_A_cut'), kkTreeBCut: KK('d_tree_single_B_cut'),
  mountainA: KK('d_mountain_A_grass_trees'), mountainB: KK('d_mountain_B_grass_trees'), mountainC: KK('d_mountain_C_grass_trees'),
  mountainBare: KK('d_mountain_A'), mountainBareB: KK('d_mountain_B'), hillsA: KK('d_hills_A_trees'), hillsB: KK('d_hills_B_trees'),
  cloudBig: KK('d_cloud_big'), cloudSmall: KK('d_cloud_small'),
  lilyA: KK('d_waterlily_A'), lilyB: KK('d_waterlily_B'), wplantA: KK('d_waterplant_A'), wplantB: KK('d_waterplant_B'),
  kkRockA: KK('d_rock_single_A'), kkRockC: KK('d_rock_single_C'), kkRockE: KK('d_rock_single_E'),
  // props
  tent: KK('p_tent'), weaponrack: KK('p_weaponrack'), lumber: KK('p_resource_lumber'), stone: KK('p_resource_stone'),
  sack: KK('p_sack'), target: KK('p_target'), wheelbarrow: KK('p_wheelbarrow'), barrel: KK('p_barrel'), crate: KK('p_crate_A_big'),
  crateSmall: KK('p_crate_B_small'), arrowsBucket: KK('p_bucket_arrows'), crateLong: KK('p_crate_long_A'),
  flag_blue: KK('p_flag_blue'), flag_red: KK('p_flag_red'),
  // Kenney
  catapult: 'castle/siege-catapult', catapultWreck: 'castle/siege-catapult-demolished',
  crystal: 'td/detail-crystal-large', crystalSmall: 'td/detail-crystal',
  treeDefault: 'nature/tree_default', treeOak: 'nature/tree_oak', treeFat: 'nature/tree_fat', treeDetailed: 'nature/tree_detailed',
  treePine: 'nature/tree_pineDefaultA', treePineRound: 'nature/tree_pineRoundC',
  rockA: 'nature/rock_largeA', rockC: 'nature/rock_largeC', rockTall: 'nature/rock_tallA', stoneB: 'nature/stone_largeB',
  bush: 'nature/plant_bush', bushLarge: 'nature/plant_bushLarge', flowerRed: 'nature/flower_redA', flowerYellow: 'nature/flower_yellowA',
  grass: 'nature/grass_large', mushrooms: 'nature/mushroom_redGroup', logStack: 'nature/log_stack', stump: 'nature/stump_round',
};
for (const t of Object.values(BUILDING_TYPES)) {
  PATHS[`b_${t.model}_blue`] = KK(`b_${t.model}_blue`);
  PATHS[`b_${t.model}_red`] = KK(`b_${t.model}_red`);
}
PATHS.b_windmill_blue = KK('b_windmill_blue');
PATHS.b_windmill_red = KK('b_windmill_red');

export async function loadAssets(onProgress) {
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL || '/';
  const keys = Object.keys(PATHS);
  const out = {};
  let done = 0;
  await Promise.all(keys.map(async (k) => {
    const gltf = await loader.loadAsync(`${base}models/${PATHS[k]}.glb`);
    gltf.scene.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    out[k] = gltf;
    onProgress?.(++done / keys.length);
  }));
  return out;
}

const _box = new THREE.Box3();
const _v = new THREE.Vector3();

// Wrap a model so it is centred on x/z, sits on y = 0, and has the requested height or width.
export function fit(obj, { height, width }) {
  const root = obj;
  root.updateMatrixWorld(true);
  _box.setFromObject(root);
  const size = _box.getSize(_v);
  const s = height ? height / size.y : width / Math.max(size.x, size.z);
  const g = new THREE.Group();
  root.scale.multiplyScalar(s);
  root.position.set(
    root.position.x * s - ((_box.min.x + _box.max.x) / 2) * s,
    root.position.y * s - _box.min.y * s,
    root.position.z * s - ((_box.min.z + _box.max.z) / 2) * s,
  );
  g.add(root);
  return g;
}

// ---- wind: a shared clock and a material patch that sways vertices by their height ----------
export const WIND = { value: 0 };
const swayCache = new WeakMap();
export function swayMaterial(mat, amount = 0.05) {
  const key = `${amount}`;
  let per = swayCache.get(mat);
  if (!per) { per = {}; swayCache.set(mat, per); }
  if (per[key]) return per[key];
  const m = mat.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = WIND;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ip = instanceMatrix[3].xz;
        #else
          vec2 ip = vec2(0.0);
        #endif
        float sw = sin(uWind * 1.6 + ip.x * 0.35 + ip.y * 0.27) + 0.4 * sin(uWind * 3.1 + ip.x * 0.9);
        float hgt = max(transformed.y, 0.0);
        transformed.x += sw * ${amount.toFixed(3)} * hgt * hgt;
        transformed.z += sw * ${(amount * 0.6).toFixed(3)} * hgt * hgt;`);
  };
  m.customProgramCacheKey = () => `sway${amount}`;
  per[key] = m;
  return m;
}

// Many copies of one prefab, drawn with one InstancedMesh per sub-mesh.
export class InstancedProp {
  constructor(prefab, capacity, parent, { shadows = true, sway = 0 } = {}) {
    prefab.updateMatrixWorld(true);
    this.parts = [];
    prefab.traverse((o) => {
      if (!o.isMesh) return;
      const mat = sway ? (Array.isArray(o.material) ? o.material.map((mm) => swayMaterial(mm, sway)) : swayMaterial(o.material, sway)) : o.material;
      const im = new THREE.InstancedMesh(o.geometry, mat, capacity);
      im.castShadow = shadows; im.receiveShadow = true;
      im.frustumCulled = false;
      im.count = 0;
      this.parts.push({ im, local: o.matrixWorld.clone() });
      parent.add(im);
    });
    this.n = 0;
    this._m = new THREE.Matrix4();
  }
  add(matrix) {
    const i = this.n++;
    this.set(i, matrix);
    for (const p of this.parts) p.im.count = this.n;
    return i;
  }
  set(i, matrix) {
    for (const p of this.parts) {
      this._m.multiplyMatrices(matrix, p.local);
      p.im.setMatrixAt(i, this._m);
      p.im.instanceMatrix.needsUpdate = true;
    }
  }
  hide(i) { this.set(i, new THREE.Matrix4().makeScale(0, 0, 0)); }
}

// ---------------------------------------------------------------------------------------------
// Visual factory: turns loaded models into characters, buildings, props and projectiles.

const TEAM_SUFFIX = ['blue', 'red'];
const sanitize = (n) => THREE.PropertyBinding.sanitizeNodeName(n);

export class Factory {
  constructor(assets) {
    this.a = assets;
    this.matCache = new Map();
    this.prefabs = {};
    this.charTemplates = {};
    const A = assets;
    const c = (k) => A[k].scene.clone(true);

    for (const [type, def] of Object.entries(BUILDING_TYPES)) {
      for (const team of [0, 1]) {
        this.prefabs[`${type}_${team}`] = fit(c(`b_${def.model}_${TEAM_SUFFIX[team]}`), { width: def.fit });
      }
    }
    this.prefabs.windmill_0 = fit(c('b_windmill_blue'), { width: 2.4 });
    this.prefabs.windmill_1 = fit(c('b_windmill_red'), { width: 2.4 });
    this.prefabs.scaffolding = fit(c('scaffolding'), { width: 1 });
    this.prefabs.rubble = fit(c('destroyed'), { width: 1 });

    const cat = c('catapult'); cat.rotation.y = -Math.PI / 2; // model's long axis is +X; units face +Z
    this.prefabs.catapult = fit(cat, { width: 2.2 });
    const wreck = c('catapultWreck'); wreck.rotation.y = -Math.PI / 2;
    this.prefabs.catapultWreck = fit(wreck, { width: 2.2 });
    this.prefabs.crystal = fit(c('crystal'), { height: 1.6 });
    this.prefabs.crystalSmall = fit(c('crystalSmall'), { height: 0.9 });
    this.prefabs.boulder = fit(c('projCatapult'), { width: 0.6 });
    const arrow = c('w_arrow'); arrow.rotation.x = Math.PI / 2; // model points +Y; projectiles fly along +Z
    this.prefabs.arrow = fit(arrow, { height: 0.12 });
    this.prefabs.arrow.scale.setScalar(1.6);
    this.prefabs.lumber = fit(c('lumber'), { width: 0.55 });
    for (const k of ['tent', 'weaponrack', 'target', 'wheelbarrow', 'barrel', 'crate', 'crateSmall', 'arrowsBucket', 'crateLong', 'sack', 'stone', 'grain', 'fenceWood']) {
      this.prefabs[k] = fit(c(k), { width: 1 });
    }
    this.prefabs.flag_0 = fit(c('flag_blue'), { height: 1 });
    this.prefabs.flag_1 = fit(c('flag_red'), { height: 1 });

    // crystals glow softly (they also feed the bloom pass)
    this.prefabs.crystal.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xd04dc0); o.material.emissiveIntensity = 0.35; } });

    // the orb projectile: a bright core + a soft additive halo
    const orb = new THREE.Group();
    orb.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), new THREE.MeshBasicMaterial({ color: 0xffffff })));
    const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.name = 'halo';
    orb.add(halo);
    this.prefabs.orb = orb;
    const orbR = orb.clone(true);
    orbR.getObjectByName('halo').material = new THREE.MeshBasicMaterial({ color: 0x9dff7a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    this.prefabs.orb_1 = orbR;
    this.prefabs.orb_0 = orb;
    const rune = orb.clone(true);
    rune.getObjectByName('halo').material = new THREE.MeshBasicMaterial({ color: 0xffc75a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
    this.prefabs.orb_rune = rune;
    // thrown axe: centred on its middle so it tumbles about its own centre
    const axe = fit(c('w_Skeleton_Axe'), { height: 0.55 });
    axe.children[0].position.y -= 0.275;
    this.prefabs.axe = new THREE.Group().add(axe);

    // character templates: the skinned scene, its clips, and the scale that gives the target height
    for (const [type, perTeam] of Object.entries(UNIT_MODELS)) {
      perTeam.forEach((spec, team) => {
        const gltf = A[spec.model];
        const tpl = skeletonClone(gltf.scene);
        const show = new Set((spec.show || []).map(sanitize));
        let bodyH = 0;
        tpl.updateMatrixWorld(true);
        tpl.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.receiveShadow = false;
          if (o.isSkinnedMesh) {
            bodyH = Math.max(bodyH, new THREE.Box3().expandByObject(o).max.y);
          } else {
            o.visible = show.has(o.name);
          }
        });
        for (const [side, key] of Object.entries(spec.attach || {})) {
          const bone = tpl.getObjectByName(side === 'r' ? 'handslotr' : 'handslotl');
          if (bone) bone.add(c(key));
        }
        this.charTemplates[`${type}_${team}`] = { scene: tpl, clips: gltf.animations, scale: UNIT_TYPES[type].height / (bodyH || 2.4) };
      });
    }
  }

  plainMat(color) {
    const key = `plain:${color}`;
    let m = this.matCache.get(key);
    if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.8 }); this.matCache.set(key, m); }
    return m;
  }

  makeBuilding(type, team) {
    const def = BUILDING_TYPES[type];
    const g = new THREE.Group();
    const model = this.prefabs[`${type}_${team}`].clone(true);
    model.name = 'model';
    g.add(model);
    // team-coloured ground ring so ownership reads at a glance (offset above the ground: no z-fight)
    const s = def.size;
    const plate = new THREE.Mesh(
      new THREE.RingGeometry(s * 0.5 * 1.22, s * 0.5 * 1.34, 4, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 4),
      new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.6, depthWrite: false }),
    );
    plate.position.y = 0.07;
    plate.renderOrder = 1;
    g.add(plate);
    const spin = [];
    model.traverse((o) => { if (/fan|saw/.test(o.name)) spin.push(o); });
    g.userData.spin = spin;
    return g;
  }

  makeScaffold(size) {
    const g = new THREE.Group();
    const sc = this.prefabs.scaffolding.clone(true);
    sc.scale.setScalar(size * 0.95);
    g.add(sc);
    return g;
  }
  makeRubble(size) {
    const r = this.prefabs.rubble.clone(true);
    r.scale.setScalar(size * 0.85);
    return r;
  }

  makeUnit(type, team) {
    const def = UNIT_TYPES[type];
    if (def.kind === 'catapult') {
      const g = this.prefabs.catapult.clone(true);
      const fl = this.prefabs[`flag_${team}`].clone(true);
      fl.scale.setScalar(1.2);
      fl.position.set(-0.55, 0.25, -0.65);
      g.add(fl);
      const mats = [];
      g.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); mats.push(o.material); } });
      return { root: g, mixer: null, actions: {}, mats };
    }
    const tpl = this.charTemplates[`${type}_${team}`];
    const model = skeletonClone(tpl.scene);
    model.scale.setScalar(tpl.scale);
    const root = new THREE.Group();
    root.add(model);
    // per-unit material copies so hits can flash a single unit
    const mats = [];
    const remap = new Map();
    model.traverse((o) => {
      if (!o.isMesh) return;
      const sw = (m) => { if (!remap.has(m)) { const n = m.clone(); remap.set(m, n); mats.push(n); } return remap.get(m); };
      o.material = Array.isArray(o.material) ? o.material.map(sw) : sw(o.material);
    });
    let carry = null;
    if (type === 'worker') {
      carry = new THREE.Group();
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshStandardMaterial({ color: 0xef8ae0, emissive: 0x7a1c6c, roughness: 0.3 }));
      crystal.scale.y = 1.4;
      const log = this.prefabs.lumber.clone(true);
      log.rotation.y = Math.PI / 2;
      log.position.y = -0.12;
      crystal.name = 'crystal'; log.name = 'wood';
      carry.add(crystal, log);
      carry.position.set(0, def.height * 0.72, -0.32);
      carry.visible = false;
      root.add(carry);
    }
    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const clip of tpl.clips) actions[clip.name] = mixer.clipAction(clip);
    for (const n of ['Death_A', 'Death_B', 'Cheer']) {
      if (actions[n]) { actions[n].setLoop(THREE.LoopOnce, 1); actions[n].clampWhenFinished = true; }
    }
    return { root, mixer, actions, carry, mats };
  }

  ghost(type) {
    const g = this.prefabs[`${type}_0`].clone(true);
    const mat = new THREE.MeshBasicMaterial({ color: 0x55ff77, transparent: true, opacity: 0.45, depthWrite: false });
    g.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = false; } });
    g.userData.mat = mat;
    return g;
  }
}
