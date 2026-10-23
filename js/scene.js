// 3D-сцена на Three.js: карта участка, пласт, объекты обустройства, выбор и перетаскивание.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CATALOG, toePoint, isWell, isProducer, DRAIN_R_M } from './sim.js';
import { CELL_M, cellAt } from './field.js';

const HALF = 20;
const STATUS = { ok: 0x0ca30c, bad: 0xd03b3b, warn: 0xfab219, idle: 0x898781 };
const WELL_COLOR = { vert: 0xe0a33a, horiz: 0xeb6834, inj: 0x3987e5 };
const HIT_R = { vert: 1.2, horiz: 1.2, inj: 1.2, dns: 1.7, upn: 2.0, npz: 2.0, gtes: 1.7, export: 1.8 };
const LIGHT_Y = { vert: 2.0, horiz: 2.0, inj: 2.0, dns: 1.5, upn: 2.8, npz: 3.3, gtes: 2.1, export: 3.0 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const matCache = {};
const lam = color => (matCache[color] ||= new THREE.MeshLambertMaterial({ color }));

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(color));
  m.position.set(x, y + h / 2, z);
  return m;
}
function cyl(r, h, color, x = 0, y = 0, z = 0, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), lam(color));
  m.position.set(x, y + h / 2, z);
  return m;
}

function buildModel(type) {
  const g = new THREE.Group();
  switch (type) {
    case 'vert': case 'horiz': case 'inj': {
      g.add(box(1.0, 0.12, 1.0, 0x3c4248));
      const rig = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.6, 4), lam(WELL_COLOR[type]));
      rig.position.y = 0.92;
      rig.rotation.y = Math.PI / 4;
      g.add(rig, cyl(0.1, 0.5, 0xd6dde2, 0.38, 0.12, 0.38, 8));
      break;
    }
    case 'dns':
      g.add(box(1.9, 0.12, 1.5, 0x3c4248), cyl(0.4, 0.85, 0xc8d0d6, -0.45, 0.12, -0.1), cyl(0.4, 0.85, 0xc8d0d6, 0.45, 0.12, -0.1), box(0.6, 0.4, 0.4, 0xeb6834, 0, 0.12, 0.5));
      break;
    case 'upn':
      g.add(box(2.8, 0.12, 2.2, 0x3c4248));
      for (const x of [-0.85, 0, 0.85]) g.add(cyl(0.4, 1.0, 0xd6dde2, x, 0.12, -0.5));
      g.add(cyl(0.2, 2.4, 0x9aa7b0, 0.9, 0.12, 0.55), box(1.1, 0.6, 0.7, 0x2a78d6, -0.5, 0.12, 0.55));
      break;
    case 'npz': {
      g.add(box(2.8, 0.12, 2.4, 0x3c4248));
      [[-0.8, 1.6], [-0.2, 2.2], [0.4, 2.8]].forEach(([x, h]) => g.add(cyl(0.22, h, 0xbfc6cc, x, 0.12, -0.4)));
      g.add(box(0.9, 0.5, 0.8, 0x6250d6, 0.5, 0.12, 0.6), cyl(0.06, 3.2, 0x9aa7b0, 1.1, 0.12, -0.8, 6));
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
      flame.position.set(1.1, 3.45, -0.8);
      g.add(flame);
      break;
    }
    case 'gtes':
      g.add(box(2.0, 0.12, 1.6, 0x3c4248), box(1.3, 0.85, 0.9, 0xeda100, 0, 0.12, 0.15), cyl(0.13, 1.7, 0x9aa7b0, -0.4, 0.12, -0.5, 8), cyl(0.13, 1.7, 0x9aa7b0, 0.2, 0.12, -0.5, 8));
      break;
    case 'export': {
      g.add(cyl(0.9, 1.0, 0xe8ecef), cyl(0.93, 0.18, 0xe34948, 0, 0.55), cyl(0.05, 2.6, 0xdddddd, 0.95, 0, 0.95, 6));
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshBasicMaterial({ color: 0xe34948, side: THREE.DoubleSide }));
      flag.position.set(1.4, 2.3, 0.95);
      g.add(flag);
      break;
    }
  }
  return g;
}

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 80;
  const x = c.getContext('2d');
  x.font = 'bold 42px system-ui, -apple-system, "Segoe UI", sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const w = Math.min(250, x.measureText(text).width + 30);
  x.fillStyle = 'rgba(11,16,19,0.78)';
  x.beginPath();
  if (x.roundRect) x.roundRect((256 - w) / 2, 10, w, 60, 18); else x.rect((256 - w) / 2, 10, w, 60);
  x.fill();
  x.fillStyle = '#f0efec';
  x.fillText(text, 128, 42);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(2.4, 0.75, 1);
  s.renderOrder = 10;
  return s;
}

function stadiumGeometry(len, r) {
  const s = new THREE.Shape();
  s.moveTo(0, -r);
  s.lineTo(len, -r);
  s.absarc(len, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(0, r);
  s.absarc(0, 0, r, Math.PI / 2, Math.PI * 1.5, false);
  const g = new THREE.ShapeGeometry(s, 24);
  g.rotateX(-Math.PI / 2);
  return g;
}

// Цветовые шкалы карты
const RAMPS = {
  h: ['#f6dc8a', '#d9822b', '#7a2e0b'],
  k: ['#cde2fb', '#3987e5', '#104281'],
  top: ['#efe6cf', '#a8865a', '#3d2c1b'],
};
export function rampColor(name, t) {
  const stops = RAMPS[name].map(h => new THREE.Color(h));
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return stops[i].clone().lerp(stops[i + 1], t - i);
}
export const RAMP_CSS = name => `linear-gradient(90deg, ${RAMPS[name].join(', ')})`;

export class GameScene {
  constructor(container) {
    this.container = container;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(r.domElement);
    this.canvas = r.domElement;
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1013);
    this.scene.fog = new THREE.Fog(0x0b1013, 70, 160);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.3, 500);
    this.scene.add(new THREE.HemisphereLight(0xdfe9f3, 0x2a2a20, 1.4));
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.8);
    sun.position.set(-20, 40, 15);
    this.scene.add(sun);

    const c = (this.controls = new OrbitControls(this.camera, this.canvas));
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.screenSpacePanning = false;
    c.minDistance = 8;
    c.maxDistance = 95;
    c.addEventListener('change', () => {
      c.target.x = clamp(c.target.x, -HALF - 4, HALF + 4);
      c.target.z = clamp(c.target.z, -HALF - 4, HALF + 4);
      c.target.y = 0;
    });

    this.fieldGroup = new THREE.Group();
    this.underGroup = new THREE.Group();
    this.objGroup = new THREE.Group();
    this.dynGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    this.scene.add(this.fieldGroup, this.underGroup, this.objGroup, this.dynGroup, this.fxGroup);
    this.underGroup.visible = false;

    this.items = new Map();
    this.pickTargets = [];
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.view3d = false;
    this.layer = 'h';
    this.flow = false;
    this.badLights = [];

    this.hitMat = new THREE.MeshBasicMaterial({ visible: false });
    this.lightGeo = new THREE.SphereGeometry(0.2, 12, 8);
    this.pipeGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
    this.pipeGeo.userData.shared = true;
    this.pipeMat = {
      oil: new THREE.MeshLambertMaterial({ color: 0xd9822b }),
      water: new THREE.MeshLambertMaterial({ color: 0x3987e5 }),
      idle: new THREE.MeshLambertMaterial({ color: 0x6d737a }),
      sel: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    };
    this.drainMat = {};
    for (const t of ['vert', 'horiz']) {
      this.drainMat[t] = new THREE.MeshBasicMaterial({ color: WELL_COLOR[t], transparent: true, opacity: 0.1, depthWrite: false });
      this.drainMat[t + 'Sel'] = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false });
    }
    this.trajMat = {
      vert: new THREE.MeshLambertMaterial({ color: WELL_COLOR.vert }),
      horiz: new THREE.MeshLambertMaterial({ color: WELL_COLOR.horiz }),
      inj: new THREE.MeshLambertMaterial({ color: WELL_COLOR.inj }),
    };
    this.dashMat = new THREE.LineDashedMaterial({ color: 0xffb070, dashSize: 0.45, gapSize: 0.3 });
    this.toeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    this.selRing = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.6, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    this.selRing.rotation.x = -Math.PI / 2;
    this.selRing.position.y = 0.05;
    this.selRing.visible = false;
    this.fxGroup.add(this.selRing);

    const rg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.rubber = new THREE.Line(rg, new THREE.LineBasicMaterial({ color: 0xffffff }));
    this.rubber.visible = false;
    this.fxGroup.add(this.rubber);

    this.ghost = null;
    this.ghostRing = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 32), new THREE.MeshBasicMaterial({ color: 0x0ca30c, transparent: true, opacity: 0.8, depthWrite: false }));
    this.ghostRing.rotation.x = -Math.PI / 2;
    this.ghostRing.position.y = 0.05;
    this.ghostRing.visible = false;
    this.fxGroup.add(this.ghostRing);

    this.applyMode();
    this.resize();
    this.resetCamera();
    new ResizeObserver(() => this.resize()).observe(container);
    this.clock = new THREE.Clock();
    r.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Сдвиг картинки влево, когда справа открыта вкладка итогов
    if (this.shiftPx) this.camera.setViewOffset(w, h, this.shiftPx, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  setShift(px) {
    this.shiftPx = Math.round(px);
    this.resize();
  }

  resetCamera() {
    // В портретной ориентации отодвигаем камеру, чтобы участок 4×4 км влез по ширине
    const k = this.camera.aspect < 1 ? 1.25 / this.camera.aspect : 1;
    this.camera.position.set(0, 36 * k, 30 * k);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  applyMode() {
    const c = this.controls;
    if (this.view3d) {
      c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      c.maxPolarAngle = 1.5;
    } else {
      c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
      c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
      c.maxPolarAngle = 1.15;
    }
    if (this.ground) {
      this.ground.material.opacity = this.view3d ? 0.3 : 1;
      this.ground.material.depthWrite = !this.view3d;
      this.outer.material.opacity = this.view3d ? 0.25 : 1;
      this.outer.material.depthWrite = !this.view3d;
    }
    this.underGroup.visible = this.view3d;
  }

  set3D(on) {
    this.view3d = on;
    this.applyMode();
    if (on) {
      const t = this.controls.target;
      this.camera.position.set(t.x + 30, 14, t.z + 34);
      this.controls.update();
    } else {
      this.resetCamera();
    }
  }

  // ---------- Месторождение ----------
  setField(field, sc) {
    this.field = field;
    this.sc = sc;
    for (const g of [this.fieldGroup, this.underGroup]) {
      for (const ch of [...g.children]) {
        g.remove(ch);
        ch.traverse(n => { n.geometry?.dispose(); if (n.material) { n.material.map?.dispose(); n.material.dispose(); } });
      }
    }
    for (const id of [...this.items.keys()]) this.removeItem(id);

    this.outer = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshLambertMaterial({ color: 0x18231c, transparent: true }));
    this.outer.rotation.x = -Math.PI / 2;
    this.outer.position.y = -0.03;
    this.fieldGroup.add(this.outer);

    this.texCanvas = document.createElement('canvas');
    this.texCanvas.width = this.texCanvas.height = 512;
    this.groundTex = new THREE.CanvasTexture(this.texCanvas);
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundTex.anisotropy = 4;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ map: this.groundTex, transparent: true }));
    this.ground.rotation.x = -Math.PI / 2;
    this.fieldGroup.add(this.ground);
    this.drawLayer(this.layer);

    const border = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]].map(([x, z]) => new THREE.Vector3(x, 0.04, z))),
      new THREE.LineBasicMaterial({ color: 0xe34948 }),
    );
    this.fieldGroup.add(border);

    // Пласт в 3D: кровля с вертикальным преувеличением
    const N = field.N;
    this.vScale = 3.5 / Math.max(10, field.topMax - field.topMin);
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3);
    const water = new THREE.Color('#2e5a78');
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const id = j * N + i;
        pos.set([i + 0.5 - HALF, this.depthY(field.top[id]), j + 0.5 - HALF], id * 3);
        const cl = field.h[id] > 0 ? rampColor('h', field.h[id] / field.hMax) : water;
        col.set([cl.r, cl.g, cl.b], id * 3);
      }
    }
    const idx = [];
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i, b = a + 1, c2 = a + N, d = c2 + 1;
        idx.push(a, c2, b, b, c2, d);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    rg.setIndex(idx);
    rg.computeVertexNormals();
    this.underGroup.add(new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));

    const owc = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x3987e5, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    owc.rotation.x = -Math.PI / 2;
    owc.position.y = this.depthY(sc.reservoir.owc);
    this.underGroup.add(owc);
    this.applyMode();
  }

  depthY(top) {
    return -6 - (top - this.field.topMin) * this.vScale;
  }
  reservoirY(x, z) {
    const id = cellAt(this.field, x, z);
    return id < 0 ? this.depthY(this.field.topMax) : this.depthY(this.field.top[id]);
  }

  setLayer(layer) {
    this.layer = layer;
    if (this.field) this.drawLayer(layer);
  }

  drawLayer(layer) {
    const f = this.field, N = f.N, S = 512;
    const ctx = this.texCanvas.getContext('2d');
    const img = ctx.createImageData(S, S), d = img.data;
    const sample = (arr, u, v) => {
      const x = clamp(u - 0.5, 0, N - 1), y = clamp(v - 0.5, 0, N - 1);
      const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(N - 1, x0 + 1), y1 = Math.min(N - 1, y0 + 1);
      const fx = x - x0, fy = y - y0;
      return (arr[y0 * N + x0] * (1 - fx) + arr[y0 * N + x1] * fx) * (1 - fy) + (arr[y1 * N + x0] * (1 - fx) + arr[y1 * N + x1] * fx) * fy;
    };
    const T = new Float32Array(S * S), H = new Float32Array(S * S), K = new Float32Array(S * S);
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const u = (px + 0.5) / S * N, v = (py + 0.5) / S * N, p = py * S + px;
        T[p] = sample(f.top, u, v);
        H[p] = sample(f.h, u, v);
        K[p] = sample(f.k, u, v);
      }
    }
    const range = f.topMax - f.topMin;
    const step = range > 60 ? 10 : range > 25 ? 5 : 2;
    const tundra = new THREE.Color('#2a3a2e');
    const lkMin = Math.log(f.kMin || 1), lkMax = Math.log(f.kMax || 2);
    const cellPx = S / N;
    const srgb = { r: 0, g: 0, b: 0 };
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const p = py * S + px;
        let cl;
        const oilHere = H[p] > 0.25;
        if (layer === 'top') cl = rampColor('top', (T[p] - f.topMin) / range);
        else if (!oilHere) cl = tundra.clone();
        else if (layer === 'h') cl = rampColor('h', H[p] / f.hMax);
        else cl = rampColor('k', (Math.log(K[p]) - lkMin) / Math.max(0.1, lkMax - lkMin));
        // изолинии кровли
        const iso = q => Math.floor(q / step);
        const r = px < S - 1 ? p + 1 : p, b = py < S - 1 ? p + S : p;
        if (iso(T[p]) !== iso(T[r]) || iso(T[p]) !== iso(T[b])) cl.multiplyScalar(0.72);
        // контур нефтеносности (ВНК)
        const edge = (H[r] > 0.25) !== oilHere || (H[b] > 0.25) !== oilHere;
        if (edge) cl.setRGB(1, 0.93, 0.7);
        // сетка 500 м
        if (px % (cellPx * 5) < 1 || py % (cellPx * 5) < 1) cl.lerp(new THREE.Color(1, 1, 1), 0.1);
        const o = p * 4;
        cl.getRGB(srgb, THREE.SRGBColorSpace);
        d[o] = srgb.r * 255; d[o + 1] = srgb.g * 255; d[o + 2] = srgb.b * 255; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.groundTex.needsUpdate = true;
  }

  // ---------- Объекты ----------
  createItem(o) {
    const group = new THREE.Group();
    group.add(buildModel(o.type));
    const hit = new THREE.Mesh(new THREE.SphereGeometry(HIT_R[o.type], 10, 8), this.hitMat);
    hit.position.y = 0.6;
    hit.userData = { kind: 'obj', id: o.id };
    const light = new THREE.Mesh(this.lightGeo, new THREE.MeshBasicMaterial({ color: STATUS.idle }));
    light.position.y = LIGHT_Y[o.type];
    const label = makeLabel(o.label || CATALOG[o.type].short);
    label.position.y = LIGHT_Y[o.type] + 0.75;
    group.add(hit, light, label);
    this.objGroup.add(group);
    const it = { type: o.type, group, hit, light, label, labelText: o.label };
    this.items.set(o.id, it);
    return it;
  }

  removeItem(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.objGroup.remove(it.group);
    it.hit.geometry.dispose();
    it.light.material.dispose();
    it.label.material.map.dispose();
    it.label.material.dispose();
    it.group.traverse(n => { if (n.geometry && n.geometry !== this.lightGeo) n.geometry.dispose(); });
    this.items.delete(id);
  }

  sync(state, an, selected) {
    const seen = new Set();
    this.badLights = [];
    for (const o of state.objects) {
      seen.add(o.id);
      let it = this.items.get(o.id);
      if (it && (it.type !== o.type || it.labelText !== o.label)) { this.removeItem(o.id); it = null; }
      if (!it) it = this.createItem(o);
      it.group.position.set(o.x, 0, o.z);
      let st = 'ok';
      if (isWell(o.type)) {
        const w = an.wellById.get(o.id);
        if (w.status !== 'ok') st = 'bad';
        else if (isProducer(o.type) && (w.waterFrac > 0.6 || w.Np < 15000 || w.interf > 0.35)) st = 'warn';
      } else {
        st = an.fac.get(o.id)?.ok ? 'ok' : 'bad';
      }
      it.light.material.color.setHex(STATUS[st]);
      it.light.scale.setScalar(1);
      if (st === 'bad') this.badLights.push(it.light);
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this.removeItem(id);

    // Динамические элементы пересобираем целиком
    for (const ch of [...this.dynGroup.children]) {
      this.dynGroup.remove(ch);
      if (ch.geometry && !ch.geometry.userData.shared) ch.geometry.dispose();
    }
    for (const ch of [...this.underGroup.children].filter(c => c.userData.traj)) {
      this.underGroup.remove(ch);
      ch.geometry.dispose();
    }
    this.pickTargets = [...this.items.values()].map(it => it.hit);

    const selObj = selected?.kind === 'obj' ? selected.id : null;
    for (const o of state.objects) {
      if (isProducer(o.type)) {
        const len = o.type === 'horiz' ? o.len / CELL_M : 0;
        const drain = new THREE.Mesh(stadiumGeometry(len, DRAIN_R_M / CELL_M), this.drainMat[o.type + (o.id === selObj ? 'Sel' : '')]);
        drain.position.set(o.x, 0.03 + (o.id % 7) * 0.001, o.z);
        drain.rotation.y = o.type === 'horiz' ? -o.angle : 0;
        this.dynGroup.add(drain);
      }
      if (o.type === 'horiz') {
        const t = toePoint(o);
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(o.x, 0.08, o.z), new THREE.Vector3(t.x, 0.08, t.z)]), this.dashMat);
        line.computeLineDistances();
        const toe = new THREE.Mesh(new THREE.SphereGeometry(o.id === selObj ? 0.55 : 0.42, 14, 10), this.toeMat);
        toe.position.set(t.x, 0.45, t.z);
        const toeHit = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), this.hitMat);
        toeHit.position.copy(toe.position);
        toeHit.userData = { kind: 'toe', id: o.id };
        this.dynGroup.add(line, toe, toeHit);
        this.pickTargets.push(toeHit);
      }
      if (isWell(o.type) && this.view3d) this.addTrajectory(o);
    }

    // Трубопроводы
    const up = new THREE.Vector3(0, 1, 0);
    for (const p of state.pipes) {
      const a = an.byId.get(p.a), b = an.byId.get(p.b);
      if (!a || !b) continue;
      const A = new THREE.Vector3(a.x, 0.14, a.z), B = new THREE.Vector3(b.x, 0.14, b.z);
      const dir = B.clone().sub(A), len = dir.length();
      if (len < 1e-3) continue;
      const active = an.upnOkComp.has(an.comp.get(a.id));
      const waterLine = a.type === 'inj' || b.type === 'inj';
      const isSel = selected?.kind === 'pipe' && selected.id === p.id;
      const m = new THREE.Mesh(this.pipeGeo, isSel ? this.pipeMat.sel : !active ? this.pipeMat.idle : waterLine ? this.pipeMat.water : this.pipeMat.oil);
      m.position.copy(A).add(B).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(up, dir.clone().normalize());
      m.scale.set(0.1, len, 0.1);
      const hit = new THREE.Mesh(this.pipeGeo, this.hitMat);
      hit.position.copy(m.position);
      hit.quaternion.copy(m.quaternion);
      hit.scale.set(0.55, Math.max(0.1, len - 2.2), 0.55);
      hit.userData = { kind: 'pipe', id: p.id };
      this.dynGroup.add(m, hit);
      this.pickTargets.push(hit);
    }

    // Выделение
    if (selObj && this.items.has(selObj)) {
      const o = an.byId.get(selObj);
      this.selRing.visible = true;
      this.selRing.position.set(o.x, 0.05, o.z);
      this.selRing.scale.setScalar(HIT_R[o.type] / 1.2);
    } else {
      this.selRing.visible = false;
    }
  }

  addTrajectory(o) {
    const yr = this.reservoirY(o.x, o.z);
    let pts;
    if (o.type === 'horiz') {
      const t = toePoint(o), dx = Math.cos(o.angle), dz = Math.sin(o.angle);
      pts = [new THREE.Vector3(o.x, 0, o.z), new THREE.Vector3(o.x, yr * 0.55, o.z), new THREE.Vector3(o.x + dx * 1.2, yr + 0.15, o.z + dz * 1.2)];
      const steps = Math.max(2, Math.round(o.len / 200));
      for (let s = 1; s <= steps; s++) {
        const f = s / steps, x = o.x + dx * 1.2 + (t.x - o.x - dx * 1.2) * f, z = o.z + dz * 1.2 + (t.z - o.z - dz * 1.2) * f;
        pts.push(new THREE.Vector3(x, this.reservoirY(x, z) - 0.15, z));
      }
    } else {
      pts = [new THREE.Vector3(o.x, 0, o.z), new THREE.Vector3(o.x, yr * 0.5, o.z), new THREE.Vector3(o.x, yr - 0.6, o.z)];
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.13, 6), this.trajMat[o.type]);
    m.userData.traj = true;
    this.underGroup.add(m);
  }

  // ---------- Ввод ----------
  setRay(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }
  pick(cx, cy) {
    this.scene.updateMatrixWorld();
    this.setRay(cx, cy);
    const hits = this.raycaster.intersectObjects(this.pickTargets, false);
    if (!hits.length) return null;
    const pr = h => ({ toe: 0, obj: 1, pipe: 2 }[h.object.userData.kind]);
    hits.sort((a, b) => pr(a) - pr(b) || a.distance - b.distance);
    const u = hits[0].object.userData;
    return { kind: u.kind, id: u.id };
  }
  groundPoint(cx, cy) {
    this.setRay(cx, cy);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, p) ? { x: p.x, z: p.z } : null;
  }

  showGhost(type, x, z, ok) {
    if (!this.ghost || this.ghost.userData.type !== type) {
      if (this.ghost) this.fxGroup.remove(this.ghost);
      const g = buildModel(type);
      g.traverse(n => {
        if (n.material) { n.material = n.material.clone(); n.material.transparent = true; n.material.opacity = 0.55; n.material.depthWrite = false; }
      });
      g.userData.type = type;
      this.ghost = g;
      this.fxGroup.add(g);
    }
    this.ghost.visible = true;
    this.ghost.position.set(x, 0, z);
    this.ghostRing.visible = true;
    this.ghostRing.position.set(x, 0.05, z);
    this.ghostRing.material.color.setHex(ok ? STATUS.ok : STATUS.bad);
    this.ghostRing.scale.setScalar(HIT_R[type] / 1.2);
  }
  hideGhost() {
    if (this.ghost) this.ghost.visible = false;
    this.ghostRing.visible = false;
  }

  setRubber(a, b) {
    const pos = this.rubber.geometry.attributes.position;
    pos.setXYZ(0, a.x, 0.3, a.z);
    pos.setXYZ(1, b.x, 0.3, b.z);
    pos.needsUpdate = true;
    this.rubber.geometry.computeBoundingSphere();
    this.rubber.visible = true;
  }
  hideRubber() {
    this.rubber.visible = false;
  }

  setFlow(on) {
    this.flow = on;
    if (!on) this.pipeMat.oil.emissive.setRGB(0, 0, 0);
  }

  frame() {
    const t = this.clock.getElapsedTime();
    this.controls.update();
    const k = 1 + 0.35 * Math.sin(t * 6);
    for (const l of this.badLights) l.scale.setScalar(k);
    if (this.selRing.visible) this.selRing.material.opacity = 0.65 + 0.3 * Math.sin(t * 4);
    if (this.flow) {
      const f = 0.5 + 0.5 * Math.sin(t * 10);
      this.pipeMat.oil.emissive.setRGB(0.6 * f, 0.3 * f, 0);
      this.pipeMat.water.emissive.setRGB(0, 0.15 * f, 0.5 * f);
    } else {
      this.pipeMat.water.emissive.setRGB(0, 0, 0);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
