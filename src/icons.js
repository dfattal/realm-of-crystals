import * as THREE from 'three';
import { UNIT_TYPES, BUILDING_TYPES } from './config.js';

// Renders a small 3D portrait of every unit and building once at startup, for the HUD.
export function renderIcons(renderer, factory) {
  const S = 96;
  const rt = new THREE.WebGLRenderTarget(S, S, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const px = new Uint8Array(S * S * 4);
  const img = ctx.createImageData(S, S);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  const out = {};
  const shoot = (name, obj, portrait) => {
    scene.add(obj);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    if (portrait) { c.y = box.max.y - sz.y * 0.28; }
    const r = portrait ? sz.y * 0.36 : Math.max(sz.x, sz.y, sz.z) * 0.62;
    const d = r / Math.tan(THREE.MathUtils.degToRad(15));
    cam.position.set(c.x + d * 0.55, c.y + d * 0.35, c.z + d * 0.76);
    cam.lookAt(c);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, S, S, px);
    for (let y = 0; y < S; y++) img.data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
    ctx.putImageData(img, 0, 0);
    out[name] = cv.toDataURL('image/png');
    scene.remove(obj);
  };
  for (const type of Object.keys(UNIT_TYPES)) {
    for (const team of [0, 1]) {
      const v = factory.makeUnit(type, team);
      if (v.mixer) { const a = v.actions.Idle; if (a) { a.play(); v.mixer.update(0.3); } }
      v.root.rotation.y = 0.2;
      shoot(team ? `${type}_1` : type, v.root, UNIT_TYPES[type].kind === 'char');
    }
  }
  for (const type of Object.keys(BUILDING_TYPES)) {
    for (const team of [0, 1]) {
      const g = factory.prefabs[`${type}_${team}`].clone(true);
      g.rotation.y = -0.5;
      shoot(team ? `${type}_1` : type, g, false);
    }
  }
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  rt.dispose();
  return out;
}
