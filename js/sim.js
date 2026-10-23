// Расчётное ядро: сеть сбора, зоны дренирования, добыча по характеристике вытеснения, экономика (ЧДД).
import { CELL_M } from './field.js';

export const CATALOG = {
  vert:   { name: 'Вертикальная добывающая скважина', short: 'Вертикальная', icon: '🛢️', cost: 120 },
  horiz:  { name: 'Горизонтальная добывающая скважина', short: 'Горизонтальная', icon: '➰', cost: null },
  inj:    { name: 'Нагнетательная скважина (ППД)', short: 'Нагнетательная', icon: '💧', cost: 110 },
  dns:    { name: 'ДНС — дожимная насосная станция', short: 'ДНС', icon: '⛽', cost: 350, cap: 1500 },
  upn:    { name: 'УПН — установка подготовки нефти', short: 'УПН', icon: '🏭', cost: 1400, cap: 5000 },
  npz:    { name: 'Мини-НПЗ', short: 'Мини-НПЗ', icon: '🏗️', cost: 2200, cap: 600 },
  gtes:   { name: 'ГТЭС на попутном газе', short: 'ГТЭС', icon: '⚡', cost: 450 },
  export: { name: 'Пункт сдачи нефти в магистральный нефтепровод', short: 'Сдача нефти', icon: '🚩', cost: 0 },
};

export const PIPE_COST_PER_KM = 22;   // млн ₽/км
export const MAX_GATHER_M = 2500;     // предельная длина сбора от скважины до ДНС/УПН
export const DRAIN_R_M = 450;         // радиус зоны дренирования
export const SUPPORT_R_M = 900;       // радиус влияния нагнетательной скважины
export const HORIZ = { min: 300, max: 1500, step: 50, def: 800 };
export const START_YEAR = 2027;
export const YEARS = 20;
const PROFIT_TAX = 0.2;

export const isWell = t => t === 'vert' || t === 'horiz' || t === 'inj';
export const isProducer = t => t === 'vert' || t === 'horiz';

export const horizCost = len => Math.round(160 + 18 * len / 100);
export const objectCost = o => (o.type === 'horiz' ? horizCost(o.len) : CATALOG[o.type].cost);
export const distM = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) * CELL_M;
export const pipeCost = (a, b) => distM(a, b) / 1000 * PIPE_COST_PER_KM;
export const toePoint = o => ({ x: o.x + Math.cos(o.angle) * o.len / CELL_M, z: o.z + Math.sin(o.angle) * o.len / CELL_M });

export function capexOf(state) {
  const byId = new Map(state.objects.map(o => [o.id, o]));
  let wells = 0, fac = 0, pipes = 0, pipeLen = 0;
  for (const o of state.objects) {
    if (isWell(o.type)) wells += objectCost(o); else fac += objectCost(o);
  }
  for (const p of state.pipes) {
    const a = byId.get(p.a), b = byId.get(p.b);
    if (a && b) { pipeLen += distM(a, b); pipes += pipeCost(a, b); }
  }
  return { wells, fac, pipes, pipeLen, total: wells + fac + pipes };
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function wellSegment(o) {
  const A = { x: o.x, z: o.z };
  return [A, o.type === 'horiz' ? toePoint(o) : A];
}

// ---------- Анализ проекта: сеть, статусы, параметры скважин ----------
export function analyze(state, field, sc) {
  const N = field.N, objs = state.objects;
  const byId = new Map(objs.map(o => [o.id, o]));
  const adj = new Map(objs.map(o => [o.id, []]));
  for (const p of state.pipes) {
    const a = byId.get(p.a), b = byId.get(p.b);
    if (!a || !b) continue;
    const L = distM(a, b);
    adj.get(a.id).push({ to: b.id, L });
    adj.get(b.id).push({ to: a.id, L });
  }

  // Компоненты связности трубопроводной сети
  const comp = new Map();
  let nc = 0;
  for (const o of objs) {
    if (comp.has(o.id)) continue;
    const st = [o.id];
    comp.set(o.id, nc);
    while (st.length) {
      const u = st.pop();
      for (const e of adj.get(u)) if (!comp.has(e.to)) { comp.set(e.to, nc); st.push(e.to); }
    }
    nc++;
  }
  const compTypes = Array.from({ length: nc }, () => new Set());
  for (const o of objs) compTypes[comp.get(o.id)].add(o.type);

  const upnOkComp = new Set();
  for (const o of objs) if (o.type === 'upn' && compTypes[comp.get(o.id)].has('export')) upnOkComp.add(comp.get(o.id));

  const fac = new Map();
  for (const o of objs) {
    if (isWell(o.type)) continue;
    const c = comp.get(o.id);
    let ok = true, reason = '';
    if (o.type === 'export') ok = upnOkComp.has(c);
    else if (o.type === 'upn') { ok = compTypes[c].has('export'); if (!ok) reason = 'не соединена с пунктом сдачи нефти 🚩'; }
    else { ok = upnOkComp.has(c); if (!ok) reason = 'не соединена с работающей УПН'; }
    fac.set(o.id, { ok, reason });
  }

  // Ближайший объект подготовки (ДНС/УПН) по трубам; транзит разрешён только через скважины (кустовая обвязка)
  function gather(startId) {
    const dist = new Map([[startId, 0]]), done = new Set();
    for (;;) {
      let u = null, best = Infinity;
      for (const [id, d] of dist) if (!done.has(id) && d < best) { best = d; u = id; }
      if (u === null) return null;
      done.add(u);
      const o = byId.get(u);
      if (u !== startId && (o.type === 'dns' || o.type === 'upn')) return { id: u, L: best };
      if (u !== startId && !isWell(o.type)) continue;
      for (const e of adj.get(u)) {
        const nd = best + e.L;
        if (nd < (dist.has(e.to) ? dist.get(e.to) : Infinity)) dist.set(e.to, nd);
      }
    }
  }

  const sumW = new Float32Array(N * N);
  const Rc = DRAIN_R_M / CELL_M, half = N / 2;
  const wells = [];
  for (const o of objs) {
    if (!isWell(o.type)) continue;
    const w = { id: o.id, type: o.type, obj: o, status: 'ok', reason: '', facility: null, gatherL: 0, comp: comp.get(o.id), cells: [] };
    const g = gather(o.id);
    if (!g) {
      w.status = 'noconn';
      w.reason = 'Не подключена трубопроводом к ДНС или УПН';
    } else {
      w.facility = g.id;
      w.gatherL = g.L;
      const fo = byId.get(g.id);
      if (g.L > MAX_GATHER_M) {
        w.status = 'toolong';
        w.reason = `До ${CATALOG[fo.type].short} ${(g.L / 1000).toFixed(1).replace('.', ',')} км (больше 2,5 км): не хватит устьевого давления`;
      } else if (!fac.get(g.id).ok) {
        w.status = 'nooutlet';
        w.reason = `${fo.label || CATALOG[fo.type].short} ${fac.get(g.id).reason}`;
      }
    }
    if (isProducer(o.type)) {
      const [A, B] = wellSegment(o);
      const i0 = Math.max(0, Math.floor(Math.min(A.x, B.x) - Rc + half));
      const i1 = Math.min(N - 1, Math.ceil(Math.max(A.x, B.x) + Rc + half));
      const j0 = Math.max(0, Math.floor(Math.min(A.z, B.z) - Rc + half));
      const j1 = Math.min(N - 1, Math.ceil(Math.max(A.z, B.z) + Rc + half));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const d = segDist(i + 0.5 - half, j + 0.5 - half, A.x, A.z, B.x, B.z) * CELL_M;
          if (d < DRAIN_R_M) {
            const wt = 1 - (d / DRAIN_R_M) ** 2;
            w.cells.push(j * N + i, wt);
            sumW[j * N + i] += wt;
          }
        }
      }
    }
    wells.push(w);
  }

  const { pvt, reservoir: res } = sc;
  const M = pvt.muO / pvt.muW;
  const Ed = Math.max(0.35, 0.65 - 0.1 * Math.log10(M)); // коэффициент вытеснения
  const prods = wells.filter(w => isProducer(w.type));
  const injs = wells.filter(w => w.type === 'inj');

  // Поддержка давления: каждая нагнетательная обслуживает ~2,5 добывающих в радиусе 900 м
  const raw = injs.map(inj => prods.map(p => {
    const [A, B] = wellSegment(p.obj);
    const d = segDist(inj.obj.x, inj.obj.z, A.x, A.z, B.x, B.z) * CELL_M;
    return { g: Math.max(0, 1 - d / SUPPORT_R_M), d };
  }));
  const injScale = injs.map((inj, ii) => {
    const G = raw[ii].reduce((s, r) => s + r.g, 0);
    return inj.status === 'ok' ? Math.min(1, 2.5 / Math.max(G, 1e-9)) : 0;
  });

  prods.forEach((p, pi) => {
    let S = 0, dmin = Infinity;
    injs.forEach((inj, ii) => {
      S += raw[ii][pi].g * injScale[ii];
      if (injScale[ii] > 0) dmin = Math.min(dmin, raw[ii][pi].d);
    });
    S = Math.min(1, 1.4 * S);

    let Np = 0, NpAlone = 0, wSum = 0, khw = 0, w2 = 0, hOil = 0, wOil = 0, wWater = 0;
    for (let c = 0; c < p.cells.length; c += 2) {
      const idx = p.cells[c], wt = p.cells[c + 1];
      Np += field.oil[idx] * wt / Math.max(1, sumW[idx]);
      NpAlone += field.oil[idx] * wt;
      wSum += wt;
      khw += wt * wt * field.k[idx] * field.h[idx];
      w2 += wt * wt;
      if (field.h[idx] > 0) { hOil += wt * field.h[idx]; wOil += wt; } else wWater += wt;
    }
    const kh = w2 > 0 ? khw / w2 : 0;
    const hAvg = wOil > 0 ? hOil / wOil : 0;
    const waterFrac = wSum > 0 ? wWater / wSum : 1;
    let mult = 1;
    if (p.type === 'horiz') mult = 1 + (p.obj.len / 300) * Math.min(2, 12 / Math.max(hAvg, 1));
    const q0 = Math.min(500, 0.12 * kh / pvt.muO * mult); // м³/сут жидкости
    const E = Ed * (res.edep + (res.ewf - res.edep) * S); // конечный КИН зоны
    let s = 1 + 0.012 * (M - 1) + 1.2 * waterFrac;
    if (dmin < 300) s += 0.8 * (1 - dmin / 300); // ранний прорыв от близкой нагнетательной
    Object.assign(p, {
      Np, NpAlone, q0, E, s, S, kh, hAvg, waterFrac, mult, dmin,
      fw0: 1 - 1 / s,
      interf: NpAlone > 0 ? 1 - Np / NpAlone : 0,
    });
  });

  const okCount = t => objs.filter(o => o.type === t && fac.get(o.id).ok).length;
  return {
    objs, byId, comp, fac, upnOkComp, wells, prods, injs, M, Ed,
    wellById: new Map(wells.map(w => [w.id, w])),
    gtesOk: okCount('gtes') > 0,
    npzCount: okCount('npz'),
    capex: capexOf(state),
  };
}

// ---------- Динамика добычи и экономика ----------
export function simulate(an, field, sc) {
  const SUB = 12, DT = 330 / SUB; // 330 рабочих суток в году
  const { econ: e, reservoir: res, pvt } = sc;
  const act = an.prods.filter(p => p.status === 'ok');
  const n = act.length;
  const tau = new Float64Array(n), shut = new Uint8Array(n), cumOil = new Float64Array(n);
  const isDns = act.map(p => an.byId.get(p.facility).type === 'dns');

  const dnsCap = new Map(), upnCap = new Map();
  for (const o of an.objs) {
    if (o.type === 'dns') dnsCap.set(o.id, CATALOG.dns.cap * DT);
    if (o.type === 'upn') { const c = an.comp.get(o.id); upnCap.set(c, (upnCap.get(c) || 0) + CATALOG.upn.cap * DT); }
  }
  const peakDns = new Map(), peakUpn = new Map();

  const years = [];
  for (let y = 1; y <= YEARS; y++) {
    let oil = 0, liq = 0, limited = false;
    const activeSet = new Uint8Array(n);
    for (let s = 0; s < SUB; s++) {
      const t = (y - 1) + (s + 0.5) / SUB;
      const pot = new Float64Array(n);
      const dnsLoad = new Map();
      for (let i = 0; i < n; i++) {
        if (shut[i]) continue;
        const p = act[i];
        pot[i] = p.q0 * (p.S + (1 - p.S) * Math.exp(-res.decline * t)) * DT;
        if (isDns[i]) dnsLoad.set(p.facility, (dnsLoad.get(p.facility) || 0) + pot[i]);
      }
      const k1 = new Map();
      for (const [f, L] of dnsLoad) {
        k1.set(f, Math.min(1, dnsCap.get(f) / L));
        peakDns.set(f, Math.max(peakDns.get(f) || 0, L / dnsCap.get(f)));
      }
      const upnLoad = new Map();
      for (let i = 0; i < n; i++) {
        if (shut[i]) continue;
        const v = pot[i] * (isDns[i] ? k1.get(act[i].facility) : 1);
        upnLoad.set(act[i].comp, (upnLoad.get(act[i].comp) || 0) + v);
      }
      const k2 = new Map();
      for (const [c, L] of upnLoad) {
        const cap = upnCap.get(c) || 1e-9;
        k2.set(c, Math.min(1, cap / L));
        peakUpn.set(c, Math.max(peakUpn.get(c) || 0, L / cap));
      }
      for (let i = 0; i < n; i++) {
        if (shut[i]) continue;
        const p = act[i];
        const q = pot[i] * (isDns[i] ? k1.get(p.facility) : 1) * k2.get(p.comp);
        if (q < pot[i] * 0.999) limited = true;
        // Характеристика вытеснения: КИН(τ) = E·(1 − exp(−τ/(E·s))), τ — прокачка жидкости в долях запасов зоны
        const frac = Math.exp(-tau[i] / (p.E * p.s)) / p.s;
        const qo = q * frac;
        tau[i] += q / Math.max(p.Np, 1);
        oil += qo; liq += q; cumOil[i] += qo;
        activeSet[i] = 1;
        if (frac < 0.02) shut[i] = 1; // обводнённость > 98% — скважина выводится из работы
      }
    }
    let activeP = 0;
    for (let i = 0; i < n; i++) activeP += activeSet[i];
    years.push({ y, year: START_YEAR + y, oilM3: oil, oilT: oil * pvt.rho, liq, activeP, limited });
  }

  // Экономика
  const capex = an.capex.total, facCapex = an.capex.fac;
  const injActive = an.injs.filter(w => w.status === 'ok').length;
  const npzCapT = an.npzCount * CATALOG.npz.cap * 330;
  const r = e.discount;
  let npv = -capex, cumD = -capex, payback = null, abandoned = false;
  const cfs = [-capex];
  const rows = [];
  for (const Y of years) {
    let rev = 0, npzB = 0, ndpi = 0, opex = 0, flare = 0, tax = 0, cf = 0;
    if (!abandoned && Y.oilT > 0) {
      const gas = Y.oilT * pvt.gor;
      rev = Y.oilT * e.price / 1e6;
      npzB = Math.min(Y.oilT, npzCapT) * e.npzUplift / 1e6;
      ndpi = rev * e.ndpi;
      opex = Y.liq * e.opexLiq / 1e6 * (an.gtesOk ? 0.8 : 1) + Y.activeP * e.opexWell + injActive * e.opexInj + facCapex * 0.04;
      flare = an.gtesOk ? 0 : gas / 1000 * e.flareFine / 1e6;
      const ebitda = rev + npzB - ndpi - opex - flare;
      if (ebitda < 0 && Y.y >= 3) {
        abandoned = true; // промысел убыточен — ликвидируем
      } else {
        const dep = Y.y <= 10 ? capex / 10 : 0;
        tax = Math.max(0, ebitda - dep) * PROFIT_TAX;
        cf = ebitda - tax;
      }
    }
    if (abandoned) { rev = npzB = ndpi = opex = flare = tax = cf = 0; Y.oilT = 0; Y.oilM3 = 0; Y.liq = 0; Y.activeP = 0; }
    const df = 1 / Math.pow(1 + r, Y.y - 0.5);
    npv += cf * df;
    cumD += cf * df;
    if (payback === null && cumD >= 0 && cf > 0) payback = Y.year;
    rows.push({ ...Y, wc: Y.liq > 0 ? 1 - Y.oilM3 / Y.liq : 0, rev, npzB, ndpi, opex, flare, tax, cf, dcf: cf * df, cumD });
    cfs.push(cf);
  }

  const cumOilM3 = rows.reduce((s, x) => s + x.oilM3, 0);
  const cumOilT = rows.reduce((s, x) => s + x.oilT, 0);
  return {
    rows, npv, capex, payback,
    irr: irr(cfs),
    pi: capex > 0 ? 1 + npv / capex : 0,
    cumOilT, cumOilM3,
    kin: field.stoiipM3 > 0 ? cumOilM3 / field.stoiipM3 : 0,
    peakDns, peakUpn,
    limitedYears: rows.filter(x => x.limited).length,
    activeProducers: n,
    wellCumT: new Map(act.map((p, i) => [p.id, cumOil[i] * pvt.rho])),
  };
}

function irr(cfs) {
  const f = rate => cfs.reduce((s, c, t) => s + c / Math.pow(1 + rate, t), 0);
  if (f(0) <= 0) return null;
  let lo = 0, hi = 5;
  if (f(hi) > 0) return hi;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------- Советник ----------
export function buildHints(an, sim, sc) {
  const H = [];
  const add = (level, text) => H.push({ level, text });
  const names = list => list.map(w => w.obj.label).join(', ');
  const prods = an.prods;

  if (an.capex.total > sc.budget) add('bad', `Перерасход бюджета на ${Math.round(an.capex.total - sc.budget)} млн ₽. Удалите или передвиньте объекты.`);
  if (!prods.length) add('tip', 'Начните с добывающей скважины: перетащите 🛢️ на оранжевую зону карты, там нефть.');
  const upns = an.objs.filter(o => o.type === 'upn');
  if (prods.length && !upns.length) add('bad', 'Нужна УПН 🏭: без подготовки нефть не примут в пункте сдачи.');
  const upnBad = upns.filter(o => !an.fac.get(o.id).ok);
  if (upnBad.length) add('bad', `${upnBad.map(o => o.label).join(', ')}: проведите трубопровод 🔗 до пункта сдачи нефти 🚩.`);

  const noconn = an.wells.filter(w => w.status === 'noconn');
  if (noconn.length) add('bad', `Не подключены: ${names(noconn)}. Соедините их трубопроводом 🔗 с ДНС или УПН.`);
  const toolong = an.wells.filter(w => w.status === 'toolong');
  if (toolong.length) add('bad', `${names(toolong)}: больше 2,5 км до ДНС/УПН. Поставьте ДНС поближе.`);
  const noout = an.wells.filter(w => w.status === 'nooutlet');
  if (noout.length) add('bad', `${names(noout)}: нефть некуда отдавать. ${noout[0].reason}.`);
  for (const o of an.objs) {
    if ((o.type === 'dns' || o.type === 'npz' || o.type === 'gtes') && !an.fac.get(o.id).ok) add('warn', `${o.label} ${an.fac.get(o.id).reason}.`);
  }

  const dry = prods.filter(p => p.waterFrac > 0.6 || p.Np < 15000);
  if (dry.length) add('warn', `${names(dry)}: стоит за контуром нефтеносности (ВНК), получится почти одна вода.`);
  const crowd = prods.filter(p => p.interf > 0.35);
  if (crowd.length >= 2) add('warn', `${names(crowd)}: стоят слишком плотно и забирают нефть друг у друга (интерференция).`);
  const bt = prods.filter(p => p.dmin < 300);
  if (bt.length) add('warn', `${names(bt)}: нагнетательная скважина ближе 300 м, вода быстро прорвётся.`);

  if (sim.limitedYears > 0) add('warn', `ДНС/УПН перегружены ${sim.limitedYears} г. из 20: добыча упирается в мощность. Добавьте ДНС или УПН.`);
  if (prods.length >= 3 && !an.injs.length) {
    add('tip', sc.reservoir.decline >= 0.2
      ? 'Пластовое давление здесь падает быстро. Нагнетательные скважины 💧 (ППД) удержат добычу и повысят КИН.'
      : 'Попробуйте ППД: нагнетательная скважина 💧 между добывающими поддержит давление и повысит КИН.');
  }
  if (sc.pvt.gor >= 150 && prods.length && !an.gtesOk) add('tip', `Газовый фактор ${sc.pvt.gor} м³/т: попутный газ сжигается на факеле, а за это штрафы. ГТЭС ⚡ у УПН решит проблему.`);
  const verts = prods.filter(p => p.type === 'vert' && p.hAvg > 0);
  if (verts.length >= 2 && verts.reduce((s, p) => s + p.hAvg, 0) / verts.length < 6) add('tip', 'Пласт тонкий: горизонтальная скважина ➰ даст в несколько раз больше вертикальной.');
  return H;
}
