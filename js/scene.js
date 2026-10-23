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

// Цветовые шкалы карты: толщина — от жёлтого к тёмно-красному, проницаемость — голубая,
// глубина — семицветная радуга (свод красный, крылья синие)
const RAMPS = {
  h: ['#fff3b0', '#ffd23f', '#ffa41b', '#f26a1b', '#d63a16', '#a11d0e', '#661005'],
  k: ['#e0f3ff', '#a6dcff', '#5fb6f5', '#2f8ce6', '#1f63c4', '#16439b', '#0d2a6e'],
  top: ['#e3241b', '#f5821f', '#f7d31e', '#3dbb3d', '#22b8d6', '#2a6fe0', '#1a2f9e'],
};
export function rampColor(name, t) {
  const stops = RAMPS[name].map(h => new THREE.Color(h));
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return stops[i].clone().lerp(stops[i + 1], t - i);
}
// Тот же цвет, но в sRGB-компонентах 0…1 — для шейдера карты (он пишет цвет без пересчёта)
function rampSRGB(name, t) {
  const stops = RAMPS[name];
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
  const rgb = h => [1, 3, 5].map(o => parseInt(h.slice(o, o + 2), 16) / 255);
  const a = rgb(stops[i]), b = rgb(stops[i + 1]);
  return new THREE.Vector3(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
}
const toHex = v => '#' + [v.x, v.y, v.z].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');

// «Круглый» шаг изолиний: 1, 2, 2.5, 5 × 10ⁿ
function niceStep(range, target) {
  const raw = range / target, mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
}

// Бикубическая (Catmull-Rom) выборка из сетки N×N: изолинии получаются гладкими, без изломов по клеткам
function cr(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}
function sampleCR(arr, N, u, v) {
  const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
  const g = (i, j) => arr[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)];
  const row = j => cr(g(iu - 1, j), g(iu, j), g(iu + 1, j), g(iu + 2, j), fu);
  return cr(row(iv - 1), row(iv), row(iv + 1), row(iv + 2), fv);
}

const RELIEF = 3.5;      // перепад рельефа на карте, ед. сцены (1 ед. = 100 м)
const MESH_N = 160;      // разбиение поверхности
const DATA_N = 256;      // разрешение текстуры свойств
const MAX_LEV = 16;

// Карта: ступенчатая заливка между изолиниями, тонкие сглаженные изолинии, контур ВНК, сетка 500 м
const MAP_VERT = `
varying vec2 vUv; varying vec3 vN; varying vec2 vW;
#include <fog_pars_vertex>
void main() {
  vUv = uv; vN = normal; vW = position.xz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const MAP_FRAG = `
uniform sampler2D data; uniform vec4 mask; uniform float levels[${MAX_LEV}]; uniform int nLev;
uniform vec3 cols[${MAX_LEV + 1}]; uniform float oilOnly; uniform float oilT; uniform vec3 tundra;
uniform float opacity; uniform vec3 lightDir;
varying vec2 vUv; varying vec3 vN; varying vec2 vW;
#include <fog_pars_fragment>
void main() {
  vec4 d = texture2D(data, vUv);
  float v = dot(d, mask);
  int band = 0; float dist = 1e5;
  for (int i = 0; i < ${MAX_LEV}; i++) {
    if (i >= nLev) break;
    if (v >= levels[i]) band = i + 1;
    dist = min(dist, abs(v - levels[i]));
  }
  vec3 c = cols[band];
  bool oil = d.g >= oilT;
  float line = 1.0 - smoothstep(0.45, 1.25, dist / max(fwidth(v), 1e-6));
  if (oilOnly > 0.5 && !oil) { c = tundra; line = 0.0; }
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 lc = lum > 0.42 ? c * 0.22 : mix(c, vec3(1.0), 0.65);
  c = mix(c, lc, line * 0.9);
  // сетка 500 м
  vec2 gq = abs(fract(vW / 5.0 - 0.5) - 0.5) / fwidth(vW / 5.0);
  c = mix(c, vec3(1.0), (1.0 - min(min(gq.x, gq.y), 1.0)) * 0.10);
  // контур нефтеносности
  float e = abs(d.g - oilT) / max(fwidth(d.g), 1e-6);
  c = mix(c, vec3(1.0, 0.96, 0.78), 1.0 - smoothstep(0.7, 1.7, e));
  // освещение рельефа
  float diff = max(dot(normalize(vN), lightDir), 0.0);
  c *= 0.42 + 0.66 * diff;
  gl_FragColor = vec4(c, opacity);
  #include <fog_fragment>
}`;

function makeIsoLabel(text) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 48;
  const x = c.getContext('2d');
  x.font = 'bold 30px system-ui, -apple-system, "Segoe UI", sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.lineWidth = 6;
  x.strokeStyle = 'rgba(0,0,0,0.75)';
  x.strokeText(text, 64, 25);
  x.fillStyle = '#ffffff';
  x.fillText(text, 64, 25);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(1.5, 0.56, 1);
  s.renderOrder = 4;
  return s;
}

export class GameScene {
  constructor(container) {
    this.container = container;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(r.domElement);
    this.canvas = r.domElement;
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020a09);
    this.scene.fog = new THREE.Fog(0x020a09, 70, 160);
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
      c.target.y = RELIEF * 0.4;
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
    this.pipeMat = {
      oil: new THREE.MeshLambertMaterial({ color: 0xd9822b }),
      water: new THREE.MeshLambertMaterial({ color: 0x3987e5 }),
      idle: new THREE.MeshLambertMaterial({ color: 0x6d737a }),
      sel: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    };
    this.drainMat = {};
    for (const t of ['vert', 'horiz']) {
      const dm = { transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
      this.drainMat[t] = new THREE.MeshBasicMaterial({ ...dm, color: WELL_COLOR[t], opacity: 0.16 });
      this.drainMat[t + 'Sel'] = new THREE.MeshBasicMaterial({ ...dm, color: 0xffffff, opacity: 0.25 });
    }
    this.trajMat = {
      vert: new THREE.MeshLambertMaterial({ color: WELL_COLOR.vert }),
      horiz: new THREE.MeshLambertMaterial({ color: WELL_COLOR.horiz }),
      inj: new THREE.MeshLambertMaterial({ color: WELL_COLOR.inj }),
    };
    this.dashMat = new THREE.LineDashedMaterial({ color: 0xffb070, dashSize: 0.45, gapSize: 0.3 });
    this.toeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    this.selRing = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.6, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false }));
    this.selRing.renderOrder = 6;
    this.selRing.rotation.x = -Math.PI / 2;
    this.selRing.position.y = 0.05;
    this.selRing.visible = false;
    this.fxGroup.add(this.selRing);

    const rg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.rubber = new THREE.Line(rg, new THREE.LineBasicMaterial({ color: 0xffffff }));
    this.rubber.visible = false;
    this.fxGroup.add(this.rubber);

    this.ghost = null;
    this.ghostRing = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 32), new THREE.MeshBasicMaterial({ color: 0x0ca30c, transparent: true, opacity: 0.8, depthWrite: false, depthTest: false }));
    this.ghostRing.renderOrder = 6;
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
    this.controls.target.set(0, RELIEF * 0.4, 0);
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
      this.ground.material.uniforms.opacity.value = this.view3d ? 0.3 : 1;
      this.ground.material.depthWrite = !this.view3d;
      this.skirt.material.opacity = this.view3d ? 0.25 : 1;
      this.skirt.material.depthWrite = !this.view3d;
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

    this.dataTex?.dispose();
    this.outer = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshLambertMaterial({ color: 0x0c201c, transparent: true }));
    this.outer.rotation.x = -Math.PI / 2;
    this.outer.position.y = -0.05;
    this.fieldGroup.add(this.outer);

    this.buildRelief(field);
    this.buildDataTexture(field);

    // Поверхность участка: рельеф кровли, раскраска шейдером
    const M = MESH_N + 1, gpos = new Float32Array(M * M * 3), guv = new Float32Array(M * M * 2), gidx = [];
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const id = j * M + i, x = -HALF + (i / MESH_N) * 2 * HALF, z = -HALF + (j / MESH_N) * 2 * HALF;
        gpos.set([x, this.hgt[id], z], id * 3);
        guv.set([i / MESH_N, j / MESH_N], id * 2);
        if (i < MESH_N && j < MESH_N) gidx.push(id, id + M, id + 1, id + 1, id + M, id + M + 1);
      }
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(gpos, 3));
    gg.setAttribute('uv', new THREE.BufferAttribute(guv, 2));
    gg.setIndex(gidx);
    gg.computeVertexNormals();
    const L = new THREE.Vector3(-20, 40, 15).normalize();
    const mat = new THREE.ShaderMaterial({
      vertexShader: MAP_VERT, fragmentShader: MAP_FRAG, fog: true, transparent: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        data: { value: null }, mask: { value: new THREE.Vector4() },
        levels: { value: new Array(MAX_LEV).fill(0) }, nLev: { value: 0 },
        cols: { value: Array.from({ length: MAX_LEV + 1 }, () => new THREE.Vector3()) },
        oilOnly: { value: 0 }, oilT: { value: 0.5 }, tundra: { value: new THREE.Vector3(0.2, 0.27, 0.23) },
        opacity: { value: 1 }, lightDir: { value: L },
      }]),
    });
    mat.uniforms.data.value = this.dataTex;
    this.ground = new THREE.Mesh(gg, mat);
    this.fieldGroup.add(this.ground);

    // Борта участка: от края рельефа вниз до основания
    const sk = [];
    const edge = [];
    for (let i = 0; i <= MESH_N; i++) edge.push([i, 0]);
    for (let j = 1; j <= MESH_N; j++) edge.push([MESH_N, j]);
    for (let i = MESH_N - 1; i >= 0; i--) edge.push([i, MESH_N]);
    for (let j = MESH_N - 1; j >= 0; j--) edge.push([0, j]);
    const ep = edge.map(([i, j]) => new THREE.Vector3(-HALF + (i / MESH_N) * 2 * HALF, this.hgt[j * M + i], -HALF + (j / MESH_N) * 2 * HALF));
    for (let n = 0; n < ep.length - 1; n++) {
      const a = ep[n], b = ep[n + 1];
      sk.push(a.x, a.y, a.z, a.x, -0.05, a.z, b.x, b.y, b.z, b.x, b.y, b.z, a.x, -0.05, a.z, b.x, -0.05, b.z);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sk), 3));
    sg.computeVertexNormals();
    this.skirt = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color: 0x2a3a33, side: THREE.DoubleSide, transparent: true }));
    this.fieldGroup.add(this.skirt);

    const border = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ep.map(p => new THREE.Vector3(p.x, p.y + 0.04, p.z))),
      new THREE.LineBasicMaterial({ color: 0xe34948 }),
    );
    this.fieldGroup.add(border);
    this.isoGroup = new THREE.Group();
    this.fieldGroup.add(this.isoGroup);
    this.drawLayer(this.layer);

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

  // Высоты рельефа: свод (малая глубина кровли) — выше, крылья — ниже
  buildRelief(f) {
    const M = MESH_N + 1, hs = RELIEF / Math.max(10, f.topMax - f.topMin);
    this.hgt = new Float32Array(M * M);
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const x = (i / MESH_N) * 2 * HALF, z = (j / MESH_N) * 2 * HALF;
        this.hgt[j * M + i] = Math.max(0, (f.topMax - sampleCR(f.top, f.N, x - 0.5, z - 0.5)) * hs);
      }
    }
  }
  surfY(x, z) {
    if (!this.hgt || Math.abs(x) > HALF || Math.abs(z) > HALF) return 0;
    const M = MESH_N + 1, u = (x + HALF) / (2 * HALF) * MESH_N, v = (z + HALF) / (2 * HALF) * MESH_N;
    const i = Math.min(MESH_N - 1, Math.floor(u)), j = Math.min(MESH_N - 1, Math.floor(v)), fu = u - i, fv = v - j;
    const H = this.hgt, a = H[j * M + i], b = H[j * M + i + 1], c = H[(j + 1) * M + i], d = H[(j + 1) * M + i + 1];
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }

  // Свойства в текстуре (полуфлоат, нормированные 0…1): R — глубина, G — толщина, B — lg проницаемости
  buildDataTexture(f) {
    const D = DATA_N, range = Math.max(1e-6, f.topMax - f.topMin);
    this.lk = [Math.log10(Math.max(1, f.kMin || 1)), Math.log10(Math.max(2, f.kMax || 2))];
    const lkR = Math.max(0.05, this.lk[1] - this.lk[0]);
    const lk = new Float32Array(f.N * f.N);
    for (let n = 0; n < lk.length; n++) lk[n] = Math.log10(Math.max(1, f.k[n] || 1));
    this.dat = { top: new Float32Array(D * D), h: new Float32Array(D * D), k: new Float32Array(D * D) };
    const buf = new Uint16Array(D * D * 4), half = THREE.DataUtils.toHalfFloat;
    for (let j = 0; j < D; j++) {
      for (let i = 0; i < D; i++) {
        const p = j * D + i, u = (i + 0.5) / D * f.N - 0.5, v = (j + 0.5) / D * f.N - 0.5;
        const t = (sampleCR(f.top, f.N, u, v) - f.topMin) / range;
        const h = Math.max(0, sampleCR(f.h, f.N, u, v)) / Math.max(0.1, f.hMax);
        const k = (sampleCR(lk, f.N, u, v) - this.lk[0]) / lkR;
        this.dat.top[p] = t; this.dat.h[p] = h; this.dat.k[p] = k;
        buf[p * 4] = half(t); buf[p * 4 + 1] = half(h); buf[p * 4 + 2] = half(k); buf[p * 4 + 3] = half(1);
      }
    }
    const tex = new THREE.DataTexture(buf, D, D, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.dataTex = tex;
  }

  // Шкала и изолинии выбранного свойства; описание шкалы — в this.legend для панели легенды
  drawLayer(layer) {
    const f = this.field, u = this.ground.material.uniforms;
    let lo, hi, vals, norm, fmt;
    if (layer === 'top') {
      lo = f.topMin; hi = f.topMax;
      const s = niceStep(hi - lo, 8);
      vals = []; for (let v = Math.ceil(lo / s + 1e-6) * s; v < hi - 1e-6; v += s) vals.push(v);
      norm = v => (v - lo) / Math.max(1e-6, hi - lo);
      fmt = v => String(Math.round(v));
    } else if (layer === 'h') {
      lo = 0; hi = f.hMax;
      const s = niceStep(hi, 7);
      vals = []; for (let v = s; v < hi - 1e-6; v += s) vals.push(v);
      norm = v => v / Math.max(0.1, hi);
      fmt = v => (s < 1 ? v.toFixed(1) : String(Math.round(v * 10) / 10)).replace('.', ',');
    } else {
      lo = 10 ** this.lk[0]; hi = 10 ** this.lk[1];
      if (hi / lo < 8) {
        // узкий диапазон — равный шаг в мД
        const s = niceStep(hi - lo, 7);
        vals = []; for (let v = Math.ceil(lo / s + 1e-6) * s; v < hi - 1e-6; v += s) vals.push(v);
      } else {
        const cand = [];
        for (let e = -1; e <= 5; e++) for (const m of [1, 2, 5]) cand.push(m * 10 ** e);
        vals = cand.filter(v => v > lo * 1.05 && v < hi / 1.05);
        if (vals.length > 10) vals = vals.filter(v => String(v)[0] !== '2');
      }
      norm = v => (Math.log10(v) - this.lk[0]) / Math.max(0.05, this.lk[1] - this.lk[0]);
      fmt = v => String(Math.round(v));
    }
    vals = vals.filter(v => norm(v) > 0.04 && norm(v) < 0.96).slice(0, MAX_LEV);
    const nB = vals.length + 1;
    const cols = Array.from({ length: nB }, (_, b) => rampSRGB(layer, nB > 1 ? b / (nB - 1) : 0.5));
    u.mask.value.set(layer === 'top' ? 1 : 0, layer === 'h' ? 1 : 0, layer === 'k' ? 1 : 0, 0);
    vals.forEach((v, i) => { u.levels.value[i] = norm(v); });
    u.nLev.value = vals.length;
    cols.forEach((c, i) => u.cols.value[i].copy(c));
    u.oilOnly.value = layer === 'top' ? 0 : 1;
    u.oilT.value = 0.25 / Math.max(0.1, f.hMax);
    this.legend = { lo: fmt(lo), hi: fmt(hi), levels: vals.map(fmt), colors: cols.map(toHex) };
    this.isoLabels(layer, vals.map(norm), vals.map(fmt), u.oilT.value);
  }

  // Подписи изолиний: точки пересечения уровней на грубой сетке, разнесённые друг от друга
  isoLabels(layer, levels, texts, oilT) {
    for (const s of [...this.isoGroup.children]) { this.isoGroup.remove(s); s.material.map.dispose(); s.material.dispose(); }
    const D = DATA_N, A = this.dat[layer], Hd = this.dat.h, step = 6, picked = [];
    const toW = c => (c + 0.5) / D * 2 * HALF - HALF;
    for (let j = step; j < D - step; j += step) {
      for (let i = step; i < D - step; i += step) {
        const p = j * D + i, a = A[p];
        for (const [q, di, dj] of [[p + step, step, 0], [p + step * D, 0, step]]) {
          const b = A[q];
          levels.forEach((L, li) => {
            if ((a - L) * (b - L) >= 0) return;
            const t = (L - a) / (b - a), x = toW(i + di * t), z = toW(j + dj * t);
            if (layer !== 'top' && (Hd[p] < oilT || Hd[q] < oilT)) return;
            if (picked.length >= 30) return;
            if (picked.some(o => (o.x - x) ** 2 + (o.z - z) ** 2 < (o.li === li ? 13 * 13 : 5.5 * 5.5))) return;
            picked.push({ x, z, li });
          });
        }
      }
    }
    for (const o of picked) {
      const s = makeIsoLabel(texts[o.li]);
      s.position.set(o.x, this.surfY(o.x, o.z) + 0.35, o.z);
      this.isoGroup.add(s);
    }
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
      it.group.position.set(o.x, this.surfY(o.x, o.z), o.z);
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
        const drain = new THREE.Mesh(this.drapedStadium(o.x, o.z, o.type === 'horiz' ? o.angle : 0, len, DRAIN_R_M / CELL_M, 0.05 + (o.id % 7) * 0.002), this.drainMat[o.type + (o.id === selObj ? 'Sel' : '')]);
        this.dynGroup.add(drain);
      }
      if (o.type === 'horiz') {
        const t = toePoint(o);
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.drapedLine(o, t, 0.1)), this.dashMat);
        line.computeLineDistances();
        const toe = new THREE.Mesh(new THREE.SphereGeometry(o.id === selObj ? 0.55 : 0.42, 14, 10), this.toeMat);
        toe.position.set(t.x, this.surfY(t.x, t.z) + 0.45, t.z);
        const toeHit = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), this.hitMat);
        toeHit.position.copy(toe.position);
        toeHit.userData = { kind: 'toe', id: o.id };
        this.dynGroup.add(line, toe, toeHit);
        this.pickTargets.push(toeHit);
      }
      if (isWell(o.type) && this.view3d) this.addTrajectory(o);
    }

    // Трубопроводы — по рельефу
    for (const p of state.pipes) {
      const a = an.byId.get(p.a), b = an.byId.get(p.b);
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-3) continue;
      const active = an.upnOkComp.has(an.comp.get(a.id));
      const waterLine = a.type === 'inj' || b.type === 'inj';
      const isSel = selected?.kind === 'pipe' && selected.id === p.id;
      const pts = this.drapedLine(a, b, 0.14);
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.1, 6), isSel ? this.pipeMat.sel : !active ? this.pipeMat.idle : waterLine ? this.pipeMat.water : this.pipeMat.oil);
      // зона касания — без концов, чтобы не перехватывать касания объектов
      const cut = Math.min(0.45, 1.1 / len);
      const hp = this.drapedLine({ x: a.x + (b.x - a.x) * cut, z: a.z + (b.z - a.z) * cut }, { x: b.x - (b.x - a.x) * cut, z: b.z - (b.z - a.z) * cut }, 0.14);
      const hit = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hp), hp.length, 0.55, 6), this.hitMat);
      hit.userData = { kind: 'pipe', id: p.id };
      this.dynGroup.add(m, hit);
      this.pickTargets.push(hit);
    }

    // Выделение
    if (selObj && this.items.has(selObj)) {
      const o = an.byId.get(selObj);
      this.selRing.visible = true;
      this.selRing.position.set(o.x, this.surfY(o.x, o.z) + 0.08, o.z);
      this.selRing.scale.setScalar(HIT_R[o.type] / 1.2);
    } else {
      this.selRing.visible = false;
    }
  }

  // Линия по поверхности рельефа от a до b (шаг ~0,5 ед.), приподнятая на lift
  drapedLine(a, b, lift) {
    const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
    const pts = [];
    for (let s = 0; s <= n; s++) {
      const x = a.x + (b.x - a.x) * s / n, z = a.z + (b.z - a.z) * s / n;
      pts.push(new THREE.Vector3(x, this.surfY(x, z) + lift, z));
    }
    return pts;
  }

  // Зона дренирования («стадион» вокруг ствола), уложенная на рельеф кольцами от оси к краю
  drapedStadium(x0, z0, ang, len, r, lift) {
    const B = [];
    const side = (y, from, to) => { const n = Math.max(1, Math.ceil(Math.abs(to - from) / 0.5)); for (let s = 0; s < n; s++) B.push([from + (to - from) * s / n, y]); };
    const arc = (cx, a0) => { for (let s = 0; s < 24; s++) { const a = a0 + Math.PI * s / 24; B.push([cx + r * Math.cos(a), r * Math.sin(a)]); } };
    side(-r, 0, len); arc(len, -Math.PI / 2); side(r, len, 0); arc(0, Math.PI / 2);
    const ca = Math.cos(ang), sa = Math.sin(ang), R = 5, K = B.length;
    const pos = new Float32Array(K * (R + 1) * 3), idx = [];
    B.forEach(([bx, by], k) => {
      const cx = clamp(bx, 0, len);
      for (let q = 0; q <= R; q++) {
        const sx = cx + (bx - cx) * q / R, sy = by * q / R;
        const x = x0 + sx * ca - sy * sa, z = z0 + sx * sa + sy * ca;
        pos.set([x, this.surfY(x, z) + lift, z], (k * (R + 1) + q) * 3);
      }
    });
    for (let k = 0; k < K; k++) {
      const k2 = (k + 1) % K;
      for (let q = 0; q < R; q++) {
        const a = k * (R + 1) + q, b = k2 * (R + 1) + q;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  addTrajectory(o) {
    const yr = this.reservoirY(o.x, o.z), y0 = this.surfY(o.x, o.z);
    let pts;
    if (o.type === 'horiz') {
      const t = toePoint(o), dx = Math.cos(o.angle), dz = Math.sin(o.angle);
      pts = [new THREE.Vector3(o.x, y0, o.z), new THREE.Vector3(o.x, yr * 0.55, o.z), new THREE.Vector3(o.x + dx * 1.2, yr + 0.15, o.z + dz * 1.2)];
      const steps = Math.max(2, Math.round(o.len / 200));
      for (let s = 1; s <= steps; s++) {
        const f = s / steps, x = o.x + dx * 1.2 + (t.x - o.x - dx * 1.2) * f, z = o.z + dz * 1.2 + (t.z - o.z - dz * 1.2) * f;
        pts.push(new THREE.Vector3(x, this.reservoirY(x, z) - 0.15, z));
      }
    } else {
      pts = [new THREE.Vector3(o.x, y0, o.z), new THREE.Vector3(o.x, yr * 0.5, o.z), new THREE.Vector3(o.x, yr - 0.6, o.z)];
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
    if (this.ground) {
      const h = this.raycaster.intersectObject(this.ground, false)[0];
      if (h) return { x: h.point.x, z: h.point.z };
    }
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
    const y = this.surfY(x, z);
    this.ghost.position.set(x, y, z);
    this.ghostRing.visible = true;
    this.ghostRing.position.set(x, y + 0.08, z);
    this.ghostRing.material.color.setHex(ok ? STATUS.ok : STATUS.bad);
    this.ghostRing.scale.setScalar(HIT_R[type] / 1.2);
  }
  hideGhost() {
    if (this.ghost) this.ghost.visible = false;
    this.ghostRing.visible = false;
  }

  setRubber(a, b) {
    const pos = this.rubber.geometry.attributes.position;
    pos.setXYZ(0, a.x, this.surfY(a.x, a.z) + 0.3, a.z);
    pos.setXYZ(1, b.x, this.surfY(b.x, b.z) + 0.3, b.z);
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
