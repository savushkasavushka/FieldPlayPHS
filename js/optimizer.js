// Эталонная расстановка: жадный подбор скважин по ЧДД. Работает в фоновом потоке (Web Worker),
// чтобы не подвешивать интерфейс. На вход — сценарий и стартовый проект (только пункт сдачи).
import { buildField } from './field.js';
import { analyze, simulate, HORIZ } from './sim.js';

const LIM = 20 - 0.6;
const snap = v => Math.round(v * 2) / 2;

self.onmessage = e => {
  const { sc, fresh } = e.data;
  const state = optimize(sc, fresh, p => self.postMessage({ progress: p }));
  self.postMessage({ state });
};

export function optimize(sc, fresh, progress) {
  const field = buildField(sc), N = field.N, half = N / 2;
  const cellOf = (x, z) => {
    const i = Math.floor(x + half), j = Math.floor(z + half);
    return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
  };
  const npvOf = st => {
    const an = analyze(st, field, sc);
    return an.capex.total > sc.budget ? -Infinity : simulate(an, field, sc).npv;
  };

  // УПН — в центре тяжести запасов
  let sx = 0, sz = 0, sw = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const w = field.oil[j * N + i];
    sx += w * (i + 0.5 - half); sz += w * (j + 0.5 - half); sw += w;
  }
  const st = JSON.parse(JSON.stringify(fresh));
  const exp = st.objects.find(o => o.type === 'export');
  const counters = {};
  const add = (o, link) => {
    o.id = st.nextId++;
    const [k, pre] = { vert: ['prod', 'Д'], horiz: ['prod', 'Д'], inj: ['inj', 'Н'], upn: ['upn', 'УПН'], npz: ['npz', 'НПЗ'], gtes: ['gtes', 'ГТЭС'] }[o.type];
    counters[k] = (counters[k] || 0) + 1;
    o.label = `${pre}-${counters[k]}`;
    st.objects.push(o);
    st.pipes.push({ id: st.nextId++, a: o.id, b: link });
    return o;
  };
  const upn = add({ type: 'upn', x: snap(sw ? sx / sw : 0), z: snap(sw ? sz / sw : 0) }, exp.id);

  // Кандидаты: добывающие — в нефтеносной зоне, нагнетательные — в ней и у контура, горизонтальные — реже
  const oilNear = (x, z, r) => {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const id = cellOf(x + dx, z + dz);
      if (id >= 0 && field.h[id] > 0) return true;
    }
    return false;
  };
  const cands = [];
  for (let z = -LIM; z <= LIM; z += 2) for (let x = -LIM; x <= LIM; x += 2) {
    const X = snap(x), Z = snap(z), id = cellOf(X, Z);
    if (id >= 0 && field.h[id] > 0) cands.push({ type: 'vert', x: X, z: Z });
    if (oilNear(X, Z, 4)) cands.push({ type: 'inj', x: X, z: Z });
  }
  for (let z = -LIM; z <= LIM; z += 3) for (let x = -LIM; x <= LIM; x += 3) {
    const X = snap(x), Z = snap(z), id = cellOf(X, Z);
    if (id < 0 || field.h[id] <= 0) continue;
    for (let a = 0; a < 8; a++) for (const len of [600, HORIZ.def + 200, 1400]) cands.push({ type: 'horiz', x: X, z: Z, len, angle: a * Math.PI / 4 });
  }

  const free = c => st.objects.every(o => Math.hypot(o.x - c.x, o.z - c.z) >= 2);
  // Ленивый перебор: раз в 6 шагов пересчитываем всех кандидатов, в остальные — только 60 лучших по прошлой оценке
  let best = npvOf(st), prods = 0;
  for (let it = 0; it < 120; it++) {
    let pick = null, pickNpv = -Infinity;
    const pool = it % 6 === 0 ? cands : [...cands].filter(c => c.v != null).sort((a, b) => b.v - a.v).slice(0, 120);
    for (const c of pool) {
      if (!free(c)) { c.v = null; continue; }
      const { v: _, ...geom } = c;
      const o = { ...geom, id: st.nextId, label: '' };
      st.objects.push(o);
      st.pipes.push({ id: st.nextId + 1, a: o.id, b: upn.id });
      const v = npvOf(st);
      st.objects.pop(); st.pipes.pop();
      c.v = v;
      if (v > pickNpv) { pickNpv = v; pick = geom; }
    }
    // На шаге с неполным списком «ничего не улучшает» перепроверяем полным перебором
    if (it % 6 !== 0 && (!pick || pickNpv <= best + 1) && prods >= 3) { it = Math.ceil(it / 6) * 6 - 1; continue; }
    // Первые добывающие ставим, даже если ЧДД пока отрицательный: без них проект не окупится
    if (!pick || (pickNpv <= best + 1 && prods >= 3)) break;
    add({ ...pick }, upn.id);
    if (pick.type !== 'inj') prods++;
    best = pickNpv;
    progress({ wells: st.objects.length - 2, npv: Math.round(best) });
  }

  // Доп. объекты у УПН: оставляем, если они повышают ЧДД
  for (const type of ['gtes', 'npz']) {
    const spot = [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]].map(([dx, dz]) => ({ x: snap(upn.x + dx), z: snap(upn.z + dz) })).find(free);
    if (!spot) continue;
    add({ type, ...spot }, upn.id);
    const v = npvOf(st);
    if (v > best) best = v;
    else { st.objects.pop(); st.pipes.pop(); counters[type]--; }
  }
  st.counters = counters;
  return st;
}
