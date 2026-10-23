import { SCENARIOS } from './scenarios.js';
import { buildField, GRID_N } from './field.js';
import {
  CATALOG, HORIZ, PIPE_COST_PER_KM, START_YEAR, YEARS,
  analyze, simulate, buildHints, objectCost, pipeCost, distM, capexOf, isWell, isProducer, horizCost,
} from './sim.js';
import { GameScene } from './scene.js';
import { chart } from './charts.js';
import * as LB from './leaderboard.js';
import { GLOSSARY, termByKey } from './glossary.js';

const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const nf = (v, d = 0) => Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
};
const term = (key, text = key) => `<button class="term" data-term="${esc(key)}">${esc(text)}</button>`;

const TOOLS = ['vert', 'horiz', 'inj', 'pipe', 'dns', 'upn', 'npz', 'gtes'];
const TOOL_NAME = { vert: 'Вертикальная', horiz: 'Горизонт.', inj: 'Нагнетат.', pipe: 'Труба', dns: 'ДНС', upn: 'УПН', npz: 'Мини-НПЗ', gtes: 'ГТЭС' };
const LAYERS = [
  { id: 'h', name: 'Толщина', legend: 'Нефтенасыщенная толщина, м', ramp: 'h' },
  { id: 'k', name: 'Проницаемость', legend: 'Проницаемость, мД', ramp: 'k' },
  { id: 'top', name: 'Глубина', legend: 'Глубина кровли, м', ramp: 'top' },
];
// Шпаргалка слева: значок, название, зачем
const ELEMENTS = [
  ['vert', '🛢️', 'Скважина', 'добывает нефть'],
  ['horiz', '➰', 'Горизонтальная', 'для тонкого пласта'],
  ['inj', '💧', 'Нагнетательная', 'держит давление'],
  ['pipe', '🔗', 'Труба', 'соединяет объекты'],
  ['dns', '⛽', 'ДНС', 'сбор с дальних скважин'],
  ['upn', '🏭', 'УПН', 'готовит нефть, нужна всегда'],
  ['npz', '🏗️', 'Мини-НПЗ', 'топливо дороже нефти'],
  ['gtes', '⚡', 'ГТЭС', 'газ в ток, без штрафов'],
  [null, '🚩', 'Сдача', 'финиш для нефти'],
];
// Параметры, которые можно поменять в настройках
const PARAMS = [
  { g: 'reservoir', k: 'hGross', name: 'Толщина пласта', unit: 'м', min: 2, max: 40, step: 0.5, d: 1 },
  { g: 'reservoir', k: 'kMean', name: 'Проницаемость', unit: 'мД', min: 5, max: 2000, log: true },
  { g: 'reservoir', k: 'phiMean', name: 'Пористость', unit: '', min: 0.08, max: 0.3, step: 0.01, d: 2 },
  { g: 'reservoir', k: 'soMean', name: 'Нефтенасыщенность', unit: '', min: 0.4, max: 0.9, step: 0.01, d: 2 },
  { g: 'reservoir', k: 'owc', name: 'Отметка ВНК (глубже = больше залежь)', unit: 'м', step: 1,
    min: r => r.baseTop - Math.max(...r.domes.map(d => d.amp)) + 3, max: r => r.baseTop - 2 },
  { g: 'reservoir', k: 'decline', name: 'Падение дебита без ППД', unit: '%/год', min: 0.05, max: 0.5, step: 0.01, scale: 100 },
  { g: 'pvt', k: 'muO', name: 'Вязкость нефти', unit: 'мПа·с', min: 0.5, max: 200, log: true, d: 1 },
  { g: 'pvt', k: 'rho', name: 'Плотность нефти', unit: 'кг/м³', min: 0.75, max: 0.98, step: 0.005, scale: 1000 },
  { g: 'pvt', k: 'bo', name: 'Объёмный коэффициент', unit: '', min: 1, max: 1.8, step: 0.01, d: 2 },
  { g: 'pvt', k: 'gor', name: 'Газовый фактор', unit: 'м³/т', min: 5, max: 400, step: 5 },
];
const LABEL = { vert: ['prod', 'Д'], horiz: ['prod', 'Д'], inj: ['inj', 'Н'], dns: ['dns', 'ДНС'], upn: ['upn', 'УПН'], npz: ['npz', 'НПЗ'], gtes: ['gtes', 'ГТЭС'] };
const STATUS_TEXT = { ok: '✅ В работе', noconn: '⛔ Не подключена', toolong: '⛔ Далеко до ДНС/УПН', nooutlet: '⛔ Нет выхода к сдаче нефти' };
const lim = GRID_N / 2 - 0.6;

const app = {
  player: store.get('fieldx_player', ''),
  sc: null, field: null, state: null, history: [],
  tool: null, pipeFrom: null, selected: null,
  an: null, sim: null, hints: [],
  view3d: false, layer: 'h',
  autoPipe: store.get('fieldx_autopipe', true),
  // Раскрытые панели. На телефоне по умолчанию все свёрнуты до заголовков, чтобы не закрывать карту
  fold: Object.fromEntries(['rules', 'player', 'lb', 'advisor'].map(k => [k, innerWidth > 700])),
  scores: [],
  result: null, resOpen: false, npConfirm: false,
  baseId: 'training',
};

const scene = new GameScene($('#viewport'));
const byId = id => app.state.objects.find(o => o.id === id);
const budgetLeft = () => app.sc.budget - capexOf(app.state).total;

// ---------- Сценарий и проект ----------
function kmToWorld(p) { return { x: p.x * 10 - GRID_N / 2, z: p.y * 10 - GRID_N / 2 }; }

function freshState(sc) {
  const ex = kmToWorld(sc.export);
  return { nextId: 2, counters: {}, objects: [{ id: 1, type: 'export', x: ex.x, z: ex.z, label: 'Сдача нефти' }], pipes: [] };
}

// Сценарий с параметрами из настроек. Свои параметры — свой рейтинг (id с хешем изменений).
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 5);
}
function effectiveScenario(base) {
  const ov = store.get('fieldx_over_' + base.id, null);
  if (!ov || !Object.keys({ ...ov.reservoir, ...ov.pvt }).length) return base;
  return {
    ...base,
    id: `${base.id}-${hashStr(JSON.stringify(ov))}`,
    name: base.name + ' ✎',
    custom: true,
    reservoir: { ...base.reservoir, ...ov.reservoir },
    pvt: { ...base.pvt, ...ov.pvt },
  };
}

function loadScenario(id) {
  const base = SCENARIOS.find(s => s.id === id) || SCENARIOS[0];
  const sc = effectiveScenario(base);
  app.baseId = base.id;
  app.sc = sc;
  app.field = buildField(sc);
  const saved = store.get('fieldx_project_' + base.id, null);
  app.state = saved && Array.isArray(saved.objects) ? saved : freshState(sc);
  app.history = [];
  app.selected = null;
  app.tool = null;
  app.pipeFrom = null;
  app.result = null;
  setResultsOpen(false);
  scene.setField(app.field, sc);
  $('#scnName').textContent = sc.name;
  renderPalette();
  renderLayers();
  renderLegend();
  recompute();
  app.scores = [];
  renderLeaderboard();
  refreshLeaderboard();
}

function resetProject() {
  snapshot();
  app.state = freshState(app.sc);
  app.selected = null;
  changed();
}

function snapshot() {
  app.history.push(JSON.stringify(app.state));
  if (app.history.length > 80) app.history.shift();
}

function undo() {
  const s = app.history.pop();
  if (!s) return toast('Нечего отменять');
  app.state = JSON.parse(s);
  app.selected = null;
  changed();
}

function changed() {
  store.set('fieldx_project_' + app.baseId, app.state);
  if (app.result && !app.result.stale) { app.result.stale = true; const s = $('#resStale'); if (s) s.hidden = false; }
  recompute();
}

function recompute() {
  app.an = analyze(app.state, app.field, app.sc);
  app.sim = simulate(app.an, app.field, app.sc);
  app.hints = buildHints(app.an, app.sim, app.sc);
  if (app.selected && !(app.selected.kind === 'obj' ? byId(app.selected.id) : app.state.pipes.some(p => p.id === app.selected.id))) app.selected = null;
  scene.sync(app.state, app.an, app.selected);
  renderBudget();
  renderAdvisor();
  renderSelCard();
  renderPlayer();
}

let liveQueued = false;
function liveUpdate() {
  if (liveQueued) return;
  liveQueued = true;
  requestAnimationFrame(() => { liveQueued = false; recompute(); });
}

// ---------- Действия с объектами ----------
function nextLabel(type) {
  const [k, prefix] = LABEL[type];
  app.state.counters[k] = (app.state.counters[k] || 0) + 1;
  return `${prefix}-${app.state.counters[k]}`;
}

function placeError(x, z, ignoreId) {
  if (Math.abs(x) > lim || Math.abs(z) > lim) return 'За границей лицензионного участка';
  for (const o of app.state.objects) if (o.id !== ignoreId && Math.hypot(o.x - x, o.z - z) < 1.0) return 'Слишком близко к другому объекту';
  return null;
}

const snap = v => Math.round(v * 2) / 2;

function placeObject(type, x, z) {
  x = snap(x); z = snap(z);
  const err = placeError(x, z);
  if (err) return toast(err);
  const o = { id: 0, type, x, z };
  if (type === 'horiz') { o.len = HORIZ.def; o.angle = 0; }
  const cost = objectCost(o);
  if (cost > budgetLeft() + 1e-6) return toast(`Не хватает бюджета: нужно ${nf(cost)} млн ₽, осталось ${nf(budgetLeft())}`);
  snapshot();
  o.id = app.state.nextId++;
  o.label = nextLabel(type);
  app.state.objects.push(o);
  let auto = false;
  if (app.autoPipe && isWell(type)) auto = autoConnect(o);
  else if (app.autoPipe && type === 'dns') auto = autoConnect(o, ['upn']);
  else if (app.autoPipe && (type === 'npz' || type === 'gtes')) auto = autoConnect(o, ['upn']);
  app.selected = { kind: 'obj', id: o.id };
  changed();
  buzz();
  if (isWell(type) && !auto && app.autoPipe) toast('Рядом нет ДНС/УПН. Проведите трубопровод инструментом 🔗');
}

// Автоподключение к ближайшему объекту сбора (или к подключённой скважине, кустовая обвязка)
function autoConnect(o, types = ['dns', 'upn']) {
  const an = app.an;
  let best = null, bestD = Infinity;
  for (const c of app.state.objects) {
    if (c.id === o.id) continue;
    let okTarget = types.includes(c.type);
    if (!okTarget && isWell(o.type) && isWell(c.type)) {
      const w = an?.wellById.get(c.id);
      okTarget = w && w.status === 'ok' && w.gatherL + distM(o, c) <= 2400;
    }
    if (!okTarget) continue;
    const d = distM(o, c);
    const limit = isWell(o.type) ? 1500 : 4000;
    if (d < bestD && d <= limit) { bestD = d; best = c; }
  }
  if (!best) return false;
  if (pipeCost(o, best) > budgetLeft()) return false;
  app.state.pipes.push({ id: app.state.nextId++, a: o.id, b: best.id });
  return true;
}

function addPipe(aId, bId) {
  if (aId === bId) return;
  if (app.state.pipes.some(p => (p.a === aId && p.b === bId) || (p.a === bId && p.b === aId))) return toast('Эти объекты уже соединены');
  const a = byId(aId), b = byId(bId);
  const c = pipeCost(a, b);
  if (c > budgetLeft() + 1e-6) return toast(`Не хватает бюджета на трубу: ${nf(c)} млн ₽`);
  snapshot();
  const id = app.state.nextId++;
  app.state.pipes.push({ id, a: aId, b: bId });
  app.selected = { kind: 'pipe', id };
  changed();
  buzz();
  toast(`Трубопровод ${a.label} → ${b.label}: ${nf(distM(a, b) / 1000, 1)} км, ${nf(c)} млн ₽`);
}

function deleteSelected() {
  const s = app.selected;
  if (!s) return;
  if (s.kind === 'pipe') {
    snapshot();
    app.state.pipes = app.state.pipes.filter(p => p.id !== s.id);
  } else {
    const o = byId(s.id);
    if (!o || o.type === 'export') return toast('Пункт сдачи нефти удалить нельзя');
    snapshot();
    app.state.objects = app.state.objects.filter(x => x.id !== s.id);
    app.state.pipes = app.state.pipes.filter(p => p.a !== s.id && p.b !== s.id);
  }
  app.selected = null;
  changed();
}

function select(sel) {
  app.selected = sel;
  scene.sync(app.state, app.an, app.selected);
  renderSelCard();
}

function editHoriz(fn) {
  const o = byId(app.selected?.id);
  if (!o || o.type !== 'horiz') return;
  snapshot();
  const before = { len: o.len, angle: o.angle };
  fn(o);
  if (o.len > before.len && budgetLeft() < -1e-6) {
    Object.assign(o, before);
    app.history.pop();
    return toast('Не хватает бюджета на удлинение ствола');
  }
  changed();
}

// ---------- Жесты на карте ----------
const vp = $('#viewport');
const ptrs = new Map();
let drag = null;
let paletteDrag = null;

vp.addEventListener('pointerdown', onDown, true);
window.addEventListener('pointermove', onMove);
window.addEventListener('pointerup', onUp);
window.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); cancelDrag(); if (paletteDrag) { paletteDrag = null; scene.hideGhost(); } });

function onDown(e) {
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size > 1) { cancelDrag(); return; }
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const hit = scene.pick(e.clientX, e.clientY);
  const base = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false, hit };
  if (app.tool === 'pipe' && hit?.kind === 'obj') {
    drag = { ...base, kind: 'pipe', id: hit.id };
  } else if (hit?.kind === 'toe') {
    drag = { ...base, kind: 'toe', id: hit.id };
  } else if (hit?.kind === 'obj' && byId(hit.id)?.type !== 'export') {
    drag = { ...base, kind: 'move', id: hit.id };
  } else {
    drag = { ...base, kind: 'tap' };
    return; // карта: панорамирование остаётся за камерой
  }
  scene.controls.enabled = false;
}

function onMove(e) {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (paletteDrag && e.pointerId === paletteDrag.pid) return paletteMove(e);
  if (!drag || e.pointerId !== drag.pid) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 8) drag.moved = true;
  if (!drag.moved || drag.kind === 'tap') return;
  const g = scene.groundPoint(e.clientX, e.clientY);
  if (!g) return;
  const o = byId(drag.id);
  if (!o) return;
  if (drag.kind === 'move') {
    if (!drag.snapped) { snapshot(); drag.snapped = true; }
    o.x = clamp(snap(g.x), -lim, lim);
    o.z = clamp(snap(g.z), -lim, lim);
    app.selected = { kind: 'obj', id: o.id };
    liveUpdate();
  } else if (drag.kind === 'toe') {
    if (!drag.snapped) { snapshot(); drag.snapped = true; }
    const dx = g.x - o.x, dz = g.z - o.z;
    o.angle = Math.atan2(dz, dx);
    o.len = clamp(Math.round(Math.hypot(dx, dz) * 100 / HORIZ.step) * HORIZ.step, HORIZ.min, HORIZ.max);
    app.selected = { kind: 'obj', id: o.id };
    liveUpdate();
  } else if (drag.kind === 'pipe') {
    scene.setRubber(o, g);
  }
}

function onUp(e) {
  ptrs.delete(e.pointerId);
  if (paletteDrag && e.pointerId === paletteDrag.pid) return paletteUp(e);
  if (!drag || e.pointerId !== drag.pid) return;
  const d = drag;
  drag = null;
  scene.controls.enabled = true;
  scene.hideRubber();
  const isTap = !d.moved && performance.now() - d.t < 700;

  if (d.kind === 'pipe') {
    if (d.moved) {
      const h = scene.pick(e.clientX, e.clientY);
      if (h?.kind === 'obj' && h.id !== d.id) addPipe(d.id, h.id);
      else toast('Отпустите палец на втором объекте, чтобы соединить');
    } else if (isTap) {
      if (app.pipeFrom && app.pipeFrom !== d.id) { const from = app.pipeFrom; app.pipeFrom = null; addPipe(from, d.id); }
      else { app.pipeFrom = d.id; select({ kind: 'obj', id: d.id }); toast(`Начало трубы: ${byId(d.id).label}. Коснитесь второго объекта`); }
    }
    return;
  }
  if (d.kind === 'move' || d.kind === 'toe') {
    if (d.moved && d.snapped) {
      const o = byId(d.id);
      const err = d.kind === 'move' ? placeError(o.x, o.z, o.id) : null;
      if (err) { app.state = JSON.parse(app.history.pop()); toast(err); }
      changed();
    } else if (isTap) {
      select({ kind: 'obj', id: d.id });
    }
    return;
  }
  if (d.kind === 'tap' && isTap) {
    if (d.hit) {
      select(d.hit.kind === 'pipe' ? { kind: 'pipe', id: d.hit.id } : { kind: 'obj', id: d.hit.id });
    } else if (app.tool && app.tool !== 'pipe') {
      const g = scene.groundPoint(e.clientX, e.clientY);
      if (g) placeObject(app.tool, g.x, g.z);
    } else {
      app.pipeFrom = null;
      select(null);
    }
  }
}

function cancelDrag() {
  if (!drag) return;
  drag = null;
  scene.controls.enabled = true;
  scene.hideRubber();
  changed();
}

// ---------- Палитра: тап — выбрать инструмент, перетаскивание — поставить объект ----------
function renderPalette() {
  const el = $('#palette');
  el.innerHTML = TOOLS.map(t => {
    const isPipe = t === 'pipe';
    const icon = isPipe ? '🔗' : CATALOG[t].icon;
    const name = TOOL_NAME[t];
    const cost = isPipe ? `${PIPE_COST_PER_KM}/км` : t === 'horiz' ? `${horizCost(HORIZ.def)}` : `${CATALOG[t].cost}`;
    return `<button class="tool ${app.tool === t ? 'armed' : ''}" data-tool="${t}" title="${esc(isPipe ? 'Соединить объекты трубопроводом' : CATALOG[t].name)}">
      <span class="ti">${icon}</span><span class="tn">${esc(name)}</span><span class="tc">${cost} млн ₽</span></button>`;
  }).join('');
  $('#armHint').hidden = !app.tool;
  if (app.tool) {
    $('#armHint').innerHTML = app.tool === 'pipe'
      ? '🔗 Проведите пальцем от объекта к объекту (или коснитесь двух объектов по очереди) <button data-act="disarm">Готово</button>'
      : `${CATALOG[app.tool].icon} Касайтесь карты, чтобы ставить: ${esc(CATALOG[app.tool].short)} <button data-act="disarm">Готово</button>`;
  }
}

$('#palette').addEventListener('pointerdown', e => {
  const b = e.target.closest('.tool');
  if (!b) return;
  e.preventDefault();
  try { b.releasePointerCapture(e.pointerId); } catch { /* нет захвата */ }
  paletteDrag = { pid: e.pointerId, tool: b.dataset.tool, sx: e.clientX, sy: e.clientY, moved: false };
});

function overCanvas(e) {
  return document.elementFromPoint(e.clientX, e.clientY) === scene.canvas;
}

function paletteMove(e) {
  const p = paletteDrag;
  if (!p.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 10) p.moved = true;
  if (!p.moved || p.tool === 'pipe') return;
  const g = overCanvas(e) && scene.groundPoint(e.clientX, e.clientY);
  if (!g) return scene.hideGhost();
  const x = snap(g.x), z = snap(g.z);
  const probe = { type: p.tool, len: HORIZ.def };
  scene.showGhost(p.tool, x, z, !placeError(x, z) && objectCost(probe) <= budgetLeft());
}

function paletteUp(e) {
  const p = paletteDrag;
  paletteDrag = null;
  scene.hideGhost();
  if (!p.moved) {
    app.tool = app.tool === p.tool ? null : p.tool;
    app.pipeFrom = null;
    renderPalette();
    return;
  }
  if (p.tool === 'pipe') return;
  const g = overCanvas(e) && scene.groundPoint(e.clientX, e.clientY);
  if (g) placeObject(p.tool, g.x, g.z);
}

function disarm() {
  app.tool = null;
  app.pipeFrom = null;
  renderPalette();
}

// ---------- Панели ----------
function renderBudget() {
  const c = app.an.capex, b = app.sc.budget;
  const over = c.total > b;
  $('#budgetText').textContent = `${nf(c.total)} / ${nf(b)} млн ₽`;
  $('#budgetText').classList.toggle('over', over);
  const f = $('#budgetFill');
  f.style.width = `${Math.min(100, c.total / b * 100)}%`;
  f.classList.toggle('over', over);
  $('#budgetLeft').textContent = over ? `перерасход ${nf(c.total - b)}` : `осталось ${nf(b - c.total)}`;
}

function renderAdvisor() {
  const el = $('#advisor');
  const H = app.hints;
  const icon = { bad: '⛔', warn: '⚠️', tip: '💡' };
  const bad = H.filter(h => h.level === 'bad').length;
  const open = app.fold.advisor;
  el.classList.toggle('collapsed', !open);
  el.innerHTML = `<button class="adv-head" data-act="fold" data-fold="advisor">🧑‍🔧 Советник ${H.length ? `<span class="badge ${bad ? 'bad' : ''}">${H.length}</span>` : '<span class="badge ok">✓</span>'}${chev(open)}</button>
    ${open ? `<ul>${H.length ? H.slice(0, 2).map(h => `<li class="${h.level}">${icon[h.level]} ${esc(h.text)}</li>`).join('') : '<li class="ok">✅ Явных проблем нет. Жмите «Рассчитать».</li>'}</ul>` : ''}`;
}

function renderLegend() {
  const L = LAYERS.find(l => l.id === app.layer), g = scene.legend;
  // Ступени шкалы как на карте; подписи границ — не больше пяти, чтобы не слипались
  const n = g.colors.length, every = Math.ceil(g.levels.length / 5);
  $('#legend').innerHTML = `<div class="lg-title">${esc(L.legend)}</div>
    <div class="lg-steps">${g.colors.map(c => `<i style="background:${c}"></i>`).join('')}</div>
    <div class="lg-ticks"><span style="left:0">${g.lo}</span>${g.levels.map((v, i) => i % every ? '' : `<span style="left:${(i + 1) / n * 100}%">${v}</span>`).join('')}<span style="left:100%">${g.hi}</span></div>
    <div class="lg-note"><i class="owc"></i> контур ${term('ВНК')} · сетка 500 м</div>`;
}

function renderLayers() {
  $('#layers').innerHTML = LAYERS.map(l => `<button class="${l.id === app.layer ? 'on' : ''}" data-layer="${l.id}">${esc(l.name)}</button>`).join('');
}

const chev = open => `<span class="chev">${open ? '▾' : '▸'}</span>`;

function renderRules() {
  const open = app.fold.rules;
  $('#rules').classList.toggle('collapsed', !open);
  $('#rules').innerHTML = `<button class="fold-head" data-act="fold" data-fold="rules">📜 Правила${chev(open)}</button>
    ${open ? `<div class="slogans">
      <div>🛢️ Бури, где <em>оранжево</em>!</div>
      <div>🔗 Нефть → 🏭 УПН → 🚩</div>
      <div>💰 Бюджет один на всё!</div>
      <div>🏆 Больше ЧДД — выше в топе!</div>
    </div>
    <div class="el-head">Что можно построить</div>
    <ul class="elements">${ELEMENTS.map(([tool, icon, name, what]) =>
      `<li ${tool ? `data-arm="${tool}"` : ''}><span class="ei">${icon}</span><span><b>${esc(name)}</b> — ${esc(what)}</span></li>`).join('')}</ul>` : ''}`;
}

// ---------- Окно игрока ----------
// Пока раунд не начат (нет объектов), имя можно менять. Начался раунд — имя закреплено до «Новый игрок».
const roundStarted = () => app.state.objects.length > 1;
const nameLocked = () => roundStarted() && app.player.length >= 2;
let playerKey = '';

function renderPlayer(force = false) {
  const locked = nameLocked();
  const need = !app.player && roundStarted();
  const open = app.fold.player;
  const key = [locked, need, !!app.result, app.npConfirm, app.player, open].join('|');
  if (!force && key === playerKey) return;
  playerKey = key;
  const el = $('#playerbox');
  el.classList.toggle('need', need);
  el.classList.toggle('locked', locked);
  el.classList.toggle('collapsed', !open);
  if (!open) {
    el.innerHTML = `<button class="fold-head pb-head" data-act="fold" data-fold="player">👤 <span class="pb-name">${app.player ? esc(app.player) : 'Впишите имя'}</span>${locked ? '🔒' : ''}${chev(false)}</button>`;
    return;
  }
  el.innerHTML = `<button class="fold-head pb-head" data-act="fold" data-fold="player">👤 Игрок ${locked ? '<span class="pb-lock">🔒 идёт раунд</span>' : ''}${chev(true)}</button>
    <div class="pb-row">
      <input id="inPlayer" maxlength="24" placeholder="Впишите своё имя" value="${esc(app.player)}" ${locked ? 'disabled' : ''} autocomplete="off" enterkeyhint="done">
      ${locked ? '' : '<button class="btn primary" data-act="name-ok" aria-label="Готово">✔</button>'}
    </div>
    <div class="pb-actions">
      ${app.result ? `<button class="btn" data-act="results-toggle">📊 Итоги</button>` : ''}
      <button class="btn ${app.npConfirm ? 'danger' : ''}" data-act="new-player">${app.npConfirm ? 'Стереть проект? Ещё раз' : '🔄 Новый игрок'}</button>
    </div>`;
}

function commitName(v) {
  v = v.trim();
  if (v === app.player) return;
  if (v.length < 2) { if (v) toast('Имя — хотя бы 2 буквы'); return; }
  app.player = v;
  store.set('fieldx_player', v);
  renderPlayer(true);
  renderLeaderboard();
  if (app.result && !app.result.submitted) submitResult();
  else if (!roundStarted()) toast(`${v}, удачи! Перетащите 🛢️ на оранжевое пятно`, 4000);
}

document.addEventListener('keydown', e => { if (e.target.id === 'inPlayer' && e.key === 'Enter') e.target.blur(); });
document.addEventListener('change', e => { if (e.target.id === 'inPlayer') commitName(e.target.value); });

function wellCard(o, w) {
  const sc = app.sc;
  const rows = [];
  if (isProducer(o.type)) {
    const qo = w.q0 * (1 - w.fw0) * sc.pvt.rho;
    rows.push(['Стартовый ' + term('Дебит', 'дебит') + ' нефти', `${nf(qo, 1)} т/сут`]);
    rows.push(['Запасы ' + term('Дренирование', 'зоны дренирования'), `${nf(w.Np * sc.pvt.rho / 1000, 1)} тыс. т`]);
    rows.push({ more: true, k: 'Дебит жидкости', v: `${nf(w.q0, 1)} м³/сут` });
    rows.push({ more: true, k: term('h', 'Нефтенасыщ. толщина'), v: `${nf(w.hAvg, 1)} м` });
    rows.push({ more: true, k: term('ППД', 'Поддержка ППД'), v: `${nf(w.S * 100)}%` });
    rows.push({ more: true, k: term('Интерференция'), v: `${nf(w.interf * 100)}%` });
    rows.push({ more: true, k: 'Ожидаемый ' + term('КИН') + ' зоны', v: nf(w.E, 2) });
  } else {
    const n = app.an.prods.filter(p => p.dmin <= 900).length;
    rows.push(['Влияет на добывающие (до 900 м)', `${n}`]);
  }
  rows.push(['Стоимость', `${nf(objectCost(o))} млн ₽`]);
  if (w.status === 'ok' && w.facility) rows.push(['Сбор до ' + esc(byId(w.facility).label), `${nf(w.gatherL / 1000, 1)} км`]);
  let extra = '';
  if (o.type === 'horiz') {
    extra = `<div class="hz-ctl">
      <span>Ствол ${term('ГС', 'ГС')}:</span>
      <button data-act="len-">−</button><b>${o.len} м</b><button data-act="len+">+</button>
      <button data-act="rot-" title="Повернуть">⟲</button><button data-act="rot+" title="Повернуть">⟳</button>
    </div><div class="muted small">Или тяните белый шарик на конце ствола</div>`;
  }
  const status = w.status === 'ok' ? STATUS_TEXT.ok : `${STATUS_TEXT[w.status]}<div class="small">${esc(w.reason)}</div>`;
  return { rows, extra, status };
}

function renderSelCard() {
  const el = $('#selcard');
  const s = app.selected;
  if (!s) { el.hidden = true; return; }
  let title, sub = '', rows = [], extra = '', status = '', canDelete = true;
  if (s.kind === 'pipe') {
    const p = app.state.pipes.find(x => x.id === s.id);
    const a = byId(p.a), b = byId(p.b);
    title = `🔗 Трубопровод ${esc(a.label)} — ${esc(b.label)}`;
    rows = [['Длина', `${nf(distM(a, b) / 1000, 2)} км`], ['Стоимость', `${nf(pipeCost(a, b))} млн ₽`]];
  } else {
    const o = byId(s.id);
    const cat = CATALOG[o.type];
    title = `${cat.icon} ${esc(o.label)}`;
    sub = esc(cat.name);
    if (isWell(o.type)) {
      ({ rows, extra, status } = wellCard(o, app.an.wellById.get(o.id)));
    } else {
      const f = app.an.fac.get(o.id);
      status = f.ok ? '✅ В работе' : `⛔ ${esc(f.reason)}`;
      if (o.type === 'export') {
        canDelete = false;
        status = f.ok ? '✅ Принимает нефть' : '⏳ Ждёт подключения УПН';
        rows = [['Что это', 'Вход в магистральный нефтепровод']];
      }
      if (o.type === 'dns') rows.push(['Мощность', `${nf(cat.cap)} м³/сут жидкости`], ['Пиковая загрузка', `${nf((app.sim.peakDns.get(o.id) || 0) * 100)}%`]);
      if (o.type === 'upn') rows.push(['Мощность', `${nf(cat.cap)} м³/сут жидкости`], ['Пиковая загрузка', `${nf((app.sim.peakUpn.get(app.an.comp.get(o.id)) || 0) * 100)}%`]);
      if (o.type === 'npz') rows.push(['Переработка', `до ${cat.cap} т/сут`], ['Доп. маржа', `${nf(app.sc.econ.npzUplift)} ₽/т`]);
      if (o.type === 'gtes') rows.push(['Эффект', '−20% затрат на жидкость, без штрафов за факел']);
      if (cat.cost) rows.push(['Стоимость', `${nf(cat.cost)} млн ₽`]);
      const key = { dns: 'ДНС', upn: 'УПН', npz: 'НПЗ', gtes: 'ГТЭС', export: 'Сдача' }[o.type];
      sub += ` ${term(key, 'ⓘ')}`;
    }
  }
  el.innerHTML = `<div class="sc-head"><div><div class="sc-title">${title}</div><div class="sc-sub">${sub}</div></div>
      <button class="icon-btn small" data-act="close" aria-label="Закрыть">✕</button></div>
    ${status ? `<div class="sc-status">${status}</div>` : ''}
    <table class="sc-rows">${rows.filter(r => !r.more).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
    ${extra}
    ${rows.some(r => r.more) ? `<details class="sc-more"><summary>Подробнее</summary><table class="sc-rows">${rows.filter(r => r.more).map(r => `<tr><td>${r.k}</td><td>${r.v}</td></tr>`).join('')}</table></details>` : ''}
    ${canDelete ? '<div class="sc-actions"><button class="btn danger" data-act="delete">🗑 Удалить</button></div>' : ''}`;
  el.hidden = false;
}

// ---------- Рейтинг ----------
async function refreshLeaderboard() {
  const id = app.sc.id;
  const scores = await LB.fetchScores(id);
  if (id !== app.sc.id) return;
  app.scores = scores;
  renderLeaderboard();
}

// Рейтинг всегда на экране, по текущему месторождению
function renderLeaderboard() {
  const el = $('#leaderboard');
  const hl = app.player.toLowerCase();
  const myIdx = hl ? app.scores.findIndex(s => s.player.trim().toLowerCase() === hl) : -1;
  const mode = LB.online ? (LB.lastError ? '<span class="dot warn"></span>нет связи' : '<span class="dot ok"></span>онлайн') : '';
  const row = (s, i) => `<li class="${i === myIdx ? 'me' : ''}"><span class="rk">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span><span class="pl">${esc(s.player)}</span><span class="sc">${nf(s.npv)}</span></li>`;
  const open = app.fold.lb;
  el.classList.toggle('collapsed', !open);
  if (!open) {
    el.innerHTML = `<button class="fold-head lb-head" data-act="fold" data-fold="lb">🏆 Рейтинг${myIdx >= 0 ? ` <span class="lb-me">№${myIdx + 1}</span>` : ''}${chev(false)}</button>`;
    return;
  }
  el.innerHTML = `<button class="fold-head lb-head" data-act="fold" data-fold="lb">🏆 Рейтинг <span class="lb-scn">${esc(app.sc.name)}</span>${chev(true)}</button>
    <div class="lb-sub">ЧДД, млн ₽ ${mode}</div>
    <ol class="lb-list">${app.scores.length ? app.scores.slice(0, 10).map(row).join('') : '<li class="empty">Пока никого.<br>Станьте первым!</li>'}
    ${myIdx >= 10 ? `<li class="sep">…</li>${row(app.scores[myIdx], myIdx)}` : ''}</ol>`;
}

// ---------- Расчёт ----------
function runCalc() {
  const an = app.an;
  if (an.capex.total > app.sc.budget) return toast('Перерасход бюджета: уберите что-нибудь');
  if (!an.prods.some(p => p.status === 'ok')) return toast('Нет ни одной работающей добывающей скважины. Посмотрите советы 🧑‍🔧');
  disarm();
  select(null);
  const sim = app.sim;
  const root = $('#modal-root');
  root.innerHTML = `<div class="calc-overlay"><div class="calc-box">
    <div class="calc-label">Моделирование разработки</div>
    <div class="calc-year" id="cYear">${START_YEAR}</div>
    <div class="calc-bar"><i id="cBar"></i></div>
    <div class="calc-stats"><div><span>Добыто нефти</span><b id="cOil">0</b> тыс. т</div><div><span>ЧДД</span><b id="cNpv">${nf(-sim.capex)}</b> млн ₽</div></div>
  </div></div>`;
  scene.setFlow(true);
  const t0 = performance.now(), dur = 2600;
  const step = () => {
    const p = clamp((performance.now() - t0) / dur, 0, 1);
    const k = Math.floor(p * YEARS);
    const rows = sim.rows.slice(0, k);
    $('#cYear').textContent = START_YEAR + k;
    $('#cBar').style.width = `${p * 100}%`;
    $('#cOil').textContent = nf(rows.reduce((s, r) => s + r.oilT, 0) / 1000);
    $('#cNpv').textContent = nf(k ? rows[k - 1].cumD : -sim.capex);
    if (p < 1) setTimeout(step, 30);
    else setTimeout(() => {
      scene.setFlow(false);
      closeModal();
      try { showResults(sim); } catch (err) { toast(`Ошибка расчёта: ${err.message}`, 8000); console.error(err); }
    }, 350);
  };
  step();
}

// Итоги — вкладка справа: слева остаётся карта, справа результаты
function showResults(sim) {
  const sc = app.sc, an = app.an;
  app.result = {
    rec: {
      player: app.player, scenario: sc.id, npv: Math.round(sim.npv),
      oil_kt: Math.round(sim.cumOilT / 1000), kin: Math.round(sim.kin * 1000) / 1000,
      capex: Math.round(sim.capex), wells: an.prods.length + an.injs.length,
    },
    place: app.scores.filter(s => s.npv > sim.npv).length + 1,
    submitted: false, sending: false, stale: false,
  };
  const tiles = [
    ['Добыча за 20 лет', `${nf(sim.cumOilT / 1000)}`, 'тыс. т'],
    [term('КИН'), nf(sim.kin, 3), `из ${nf(app.field.stoiipT / 1e6, 1)} млн т запасов`],
    [term('CAPEX'), nf(sim.capex), 'млн ₽'],
    [term('IRR'), sim.irr == null ? '< 0' : `${nf(sim.irr * 100)}%`, `ставка ${nf(sc.econ.discount * 100)}%`],
    [term('PI', 'Индекс доходности'), nf(sim.pi, 2), 'руб. на рубль'],
    ['Окупаемость', sim.payback ? `${sim.payback}` : 'нет', sim.payback ? `${sim.payback - START_YEAR} лет` : 'за 20 лет'],
  ];
  const data = sim.rows.map(r => ({ year: r.year, oil: r.oilT / 1000, wc: r.liq > 0 ? r.wc * 100 : null, cum: r.cumD }));
  const lastProd = [...sim.rows].reverse().find(r => r.oilT > 0);
  const stopNote = lastProd && lastProd.year < START_YEAR + YEARS
    ? `<div class="muted small">Добыча завершена в ${lastProd.year} г.: скважины обводнились или промысел стал убыточным.</div>` : '';
  const cumData = [{ year: START_YEAR, cum: -sim.capex }, ...data];
  $('#resBody').innerHTML = `
    <div class="res-head">
      <div class="muted">Итоги · ${esc(sc.name)}</div>
      <div class="hero"><span class="hero-label">${term('ЧДД')} — ваши очки</span>
        <span class="hero-num ${sim.npv < 0 ? 'neg' : ''}">${nf(sim.npv)}</span><span class="hero-unit">млн ₽</span></div>
      <div id="resStatus"></div>
      <div id="resStale" class="stale" hidden>✏️ Проект изменён — нажмите ▶ «Рассчитать» ещё раз</div>
    </div>
    <div class="res-actions">
      <button class="btn big" data-act="results-toggle">✏️ Улучшить проект</button>
      <button class="btn big" data-act="new-player-now">🔄 Новый игрок</button>
    </div>
    <div class="tiles">${tiles.map(([k, v, u]) => `<div class="tile"><div class="t-k">${k}</div><div class="t-v">${v}</div><div class="t-u">${u}</div></div>`).join('')}</div>
    <div class="charts">
      <figure><figcaption>Добыча нефти, тыс. т/год</figcaption><div class="chart" id="chOil"></div></figure>
      <figure><figcaption>${term('Обводнённость')}, %</figcaption><div class="chart" id="chWc"></div></figure>
      <figure><figcaption>Накопленный дисконтированный денежный поток, млн ₽</figcaption><div class="chart" id="chCum"></div></figure>
    </div>
    ${stopNote}
    <details class="table-wrap"><summary>Таблица по годам</summary><div class="scroll-x"><table class="yt">
      <tr><th>Год</th><th>Нефть, тыс. т</th><th>Жидкость, тыс. м³</th><th>Обводн., %</th><th>Выручка</th><th>НДПИ</th><th>OPEX</th><th>Штраф факел</th><th>Налог</th><th>Ден. поток</th></tr>
      <tr><td>${START_YEAR}</td><td>–</td><td>–</td><td>–</td><td>–</td><td>–</td><td>–</td><td>–</td><td>–</td><td>${nf(-sim.capex)}</td></tr>
      ${sim.rows.map(r => `<tr><td>${r.year}</td><td>${nf(r.oilT / 1000, 1)}</td><td>${nf(r.liq / 1000, 1)}</td><td>${nf(r.wc * 100)}</td><td>${nf(r.rev + r.npzB)}</td><td>${nf(r.ndpi)}</td><td>${nf(r.opex)}</td><td>${nf(r.flare)}</td><td>${nf(r.tax)}</td><td>${nf(r.cf)}</td></tr>`).join('')}
    </table></div><div class="muted small">Денежные величины в млн ₽.</div></details>
    <div class="muted small center">В рейтинге остаётся лучший результат каждого игрока.</div>`;
  chart($('#chOil'), { data, key: 'oil', kind: 'bar', color: '#d95926', unit: 'тыс. т', label: 'Добыча нефти по годам' });
  chart($('#chWc'), { data, key: 'wc', kind: 'line', color: '#3987e5', unit: '%', label: 'Обводнённость по годам' });
  chart($('#chCum'), { data: cumData, key: 'cum', kind: 'line', color: '#049c8c', unit: 'млн ₽', label: 'Накопленный дисконтированный денежный поток' });
  $('#resBody').scrollTop = 0;
  renderResStatus();
  renderPlayer(true);
  setResultsOpen(true);
  if (app.player) submitResult();
}

function renderResStatus() {
  const el = $('#resStatus'), r = app.result;
  if (!el || !r) return;
  const placeTxt = n => n === 1 ? '🥇 <b>1-е место!</b>' : `<b>${n}-е место</b>`;
  if (r.submitted) {
    el.innerHTML = `<div class="submitted">✔ ${esc(r.rec.player)} в рейтинге${r.idx >= 0 ? `: ${placeTxt(r.idx + 1)} из ${app.scores.length}` : ''}</div>`;
  } else if (r.sending) {
    el.innerHTML = '<div class="muted">Отправляем в рейтинг…</div>';
  } else {
    el.innerHTML = `<div class="place">Это ${placeTxt(r.place)} в рейтинге</div>
      <div class="need-name">✍️ Впишите имя в окне <b>«👤 Игрок»</b> справа вверху — результат сразу попадёт в рейтинг</div>`;
  }
}

async function submitResult() {
  const r = app.result;
  if (!r || r.submitted || r.sending || !app.player) return;
  r.rec.player = app.player;
  r.sending = true;
  renderResStatus();
  const res = await LB.submitScore(r.rec);
  if (!res.ok) toast(`Не удалось отправить онлайн: ${res.error}`);
  await refreshLeaderboard();
  r.sending = false;
  r.submitted = true;
  r.idx = app.scores.findIndex(s => s.player.trim().toLowerCase() === r.rec.player.toLowerCase());
  if (app.result === r) renderResStatus();
}

function setResultsOpen(open) {
  app.resOpen = open && !!app.result;
  const el = $('#results');
  // Вкладка начинается под окном игрока, чтобы оно всегда было видно
  const pb = $('#playerbox').getBoundingClientRect();
  el.style.top = `${Math.round(pb.bottom + 8)}px`;
  el.classList.toggle('open', app.resOpen);
  el.setAttribute('aria-hidden', String(!app.resOpen));
  document.body.classList.toggle('res-open', app.resOpen);
  // Сдвигаем картинку влево, чтобы месторождение было в видимой части
  scene.setShift(app.resOpen && innerWidth > 900 ? el.offsetWidth / 2 : 0);
}

// Колонки панелей — между верхней панелью и палитрой, какой бы высоты они ни были на этом экране
function layoutCols() {
  const top = $('#topbar').getBoundingClientRect().bottom + 8;
  const bottom = $('#palette').getBoundingClientRect().top - 8;
  for (const el of [$('#leftcol'), $('#rightcol')]) {
    el.style.top = `${Math.round(top)}px`;
    el.style.maxHeight = `${Math.max(60, Math.round(bottom - top))}px`;
  }
  if (app.resOpen) setResultsOpen(true);
}
new ResizeObserver(layoutCols).observe($('#topbar'));
new ResizeObserver(layoutCols).observe($('#palette'));

// Передать планшет следующему: чистый проект, пустое активное поле имени
function newPlayer(force = false) {
  if (!force && roundStarted() && !app.npConfirm) {
    app.npConfirm = true;
    renderPlayer(true);
    clearTimeout(newPlayer.t);
    newPlayer.t = setTimeout(() => { app.npConfirm = false; renderPlayer(true); }, 3500);
    return;
  }
  clearTimeout(newPlayer.t);
  app.npConfirm = false;
  closeModal();
  app.result = null;
  setResultsOpen(false);
  app.state = freshState(app.sc);
  app.history = [];
  app.selected = null;
  app.player = '';
  store.set('fieldx_player', '');
  app.fold.player = true;
  disarm();
  changed();
  renderPlayer(true);
  renderLeaderboard();
  scene.resetCamera();
  toast('Новый игрок! Впишите имя справа вверху и перетащите 🛢️ на оранжевое пятно', 5000);
}

// ---------- Модальные окна ----------
function openModal(html, cls = '') {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-back"><div class="modal ${cls}"><button class="icon-btn modal-x" data-act="close-modal" aria-label="Закрыть">✕</button>${html}</div></div>`;
  return root.firstElementChild;
}
function closeModal() { $('#modal-root').innerHTML = ''; }

function showMenu() {
  openModal(`<h2>☰ Меню</h2>
    <div class="menu-list">
      <button class="btn big" data-act="passport">📋 Паспорт месторождения <span class="muted">свойства пласта и нефти, экономика, формулы</span></button>
      <button class="btn big" data-act="params">⚙️ Настройки пласта и нефти <span class="muted">${app.sc.custom ? 'изменены ✎' : 'поменять толщину, проницаемость, вязкость…'}</span></button>
      <button class="btn big" data-act="scenarios">🗺️ Другое месторождение <span class="muted">сейчас: ${esc(app.sc.name)}</span></button>
      <button class="btn big" data-act="home">⌖ Показать весь участок</button>
    </div>
    <label class="toggle"><input type="checkbox" id="chkAuto" ${app.autoPipe ? 'checked' : ''}> Автотрубы: новая скважина сама подключается к ближайшей ДНС/УПН (до 1,5 км)</label>`, 'menu');
  $('#chkAuto').addEventListener('change', e => { app.autoPipe = e.target.checked; store.set('fieldx_autopipe', app.autoPipe); });
}

// ---------- Настройки пласта и флюида ----------
const parRange = (p, r) => [typeof p.min === 'function' ? p.min(r) : p.min, typeof p.max === 'function' ? p.max(r) : p.max];
const parToSlider = (p, v, [a, b]) => p.log ? Math.round(1000 * Math.log(v / a) / Math.log(b / a)) : v;
function parFromSlider(p, s, [a, b]) {
  if (!p.log) return Number(s);
  const v = a * (b / a) ** (s / 1000);
  const mag = 10 ** Math.floor(Math.log10(v) - 1); // две значащие цифры
  return Math.round(v / mag) * mag;
}
const parText = (p, v) => `${nf(v * (p.scale || 1), p.d ?? (p.log && v < 10 ? 1 : 0))}${p.unit ? ' ' + p.unit : ''}`;

function showParams() {
  const base = SCENARIOS.find(s => s.id === app.baseId), sc = app.sc;
  const row = p => {
    const range = parRange(p, base[p.g]), v = sc[p.g][p.k];
    const changedCls = v !== base[p.g][p.k] ? 'changed' : '';
    return `<label class="par ${changedCls}" data-row="${p.k}"><span class="par-n">${esc(p.name)}</span><b id="pv-${p.k}">${parText(p, v)}</b>
      <input type="range" data-par="${p.k}" min="${p.log ? 0 : range[0]}" max="${p.log ? 1000 : range[1]}" step="${p.log ? 1 : p.step}" value="${parToSlider(p, v, range)}"></label>`;
  };
  openModal(`<h2>⚙️ Настройки пласта и нефти</h2>
    <p class="muted">Двигайте ползунки и смотрите, как меняются запасы. С изменёнными параметрами месторождение помечается ✎, а рейтинг для него ведётся отдельно. Скважины остаются на местах.</p>
    <div class="pp-grid">
      <section><h3>Пласт</h3>${PARAMS.filter(p => p.g === 'reservoir').map(row).join('')}</section>
      <section><h3>Нефть (${term('ПВТ', 'PVT')})</h3>${PARAMS.filter(p => p.g === 'pvt').map(row).join('')}</section>
    </div>
    <div id="parPreview" class="par-preview"></div>
    <div class="res-actions">
      <button class="btn big" data-act="params-default">↺ Как было</button>
      <button class="btn primary big" data-act="params-apply">✔ Применить</button>
    </div>`, 'params');
  const m = $('#modal-root .params');
  m.addEventListener('input', e => { if (e.target.dataset.par) paramsPreview(); });
  paramsPreview();
}

function readParams() {
  const base = SCENARIOS.find(s => s.id === app.baseId);
  const ov = { reservoir: {}, pvt: {} };
  for (const p of PARAMS) {
    const el = $(`[data-par="${p.k}"]`);
    if (!el) continue;
    const v = parFromSlider(p, el.value, parRange(p, base[p.g]));
    if (Math.abs(v - base[p.g][p.k]) > 1e-9) ov[p.g][p.k] = v;
  }
  return { base, ov };
}

function paramsPreview() {
  const { base, ov } = readParams();
  for (const p of PARAMS) {
    const v = ov[p.g][p.k] ?? base[p.g][p.k];
    $(`#pv-${p.k}`).textContent = parText(p, v);
    $(`[data-row="${p.k}"]`).classList.toggle('changed', p.k in ov[p.g]);
  }
  const f = buildField({ ...base, reservoir: { ...base.reservoir, ...ov.reservoir }, pvt: { ...base.pvt, ...ov.pvt } });
  const f0 = buildField(base);
  const d = f.stoiipT / f0.stoiipT - 1;
  $('#parPreview').innerHTML = `Геологические запасы: <b>${nf(f.stoiipT / 1e6, 2)} млн т</b>
    ${Math.abs(d) > 0.005 ? `<span class="${d > 0 ? 'up' : 'down'}">(${d > 0 ? '+' : ''}${nf(d * 100)}% к исходным)</span>` : ''}
    · площадь нефтеносности <b>${nf(f.oilAreaKm2, 1)} км²</b> · ср. толщина <b>${nf(f.avgH, 1)} м</b>`;
}

function applyParams(reset = false) {
  const { ov } = readParams();
  if (reset || !Object.keys({ ...ov.reservoir, ...ov.pvt }).length) store.set('fieldx_over_' + app.baseId, null);
  else store.set('fieldx_over_' + app.baseId, ov);
  closeModal();
  loadScenario(app.baseId);
  toast(app.sc.custom ? `Параметры применены: ${app.sc.name}, запасы ${nf(app.field.stoiipT / 1e6, 2)} млн т` : 'Исходные параметры месторождения');
}

function showPassport() {
  const { sc, field: f } = app;
  const r = sc.reservoir, p = sc.pvt, e = sc.econ;
  const t = rows => `<table class="pp">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`;
  openModal(`<h2>📋 Паспорт: ${esc(sc.name)}</h2>
    <p class="muted">${esc(sc.description)} ${esc(sc.tip)}</p>
    <div class="pp-grid">
      <section><h3>Пласт</h3>${t([
        ['Глубина кровли', `${nf(f.topMin)}–${nf(f.topMax)} м`],
        [term('ВНК'), `${nf(r.owc)} м`],
        ['Площадь нефтеносности', `${nf(f.oilAreaKm2, 1)} км²`],
        [term('h', 'Ср. нефтенасыщ. толщина'), `${nf(f.avgH, 1)} м`],
        [term('k', 'Ср. проницаемость'), `${nf(f.avgK)} мД`],
        [term('φ', 'Пористость'), nf(f.avgPhi, 2)],
        [term('So', 'Нефтенасыщенность'), nf(r.soMean, 2)],
        ['Геологические запасы', `${nf(f.stoiipT / 1e6, 2)} млн т`],
        ['Падение дебита без ППД', `${nf(r.decline * 100)}% в год`],
      ])}</section>
      <section><h3>${term('ПВТ', 'PVT-свойства нефти')}</h3>${t([
        [term('μ', 'Вязкость нефти'), `${nf(p.muO, 1)} мПа·с`],
        ['Вязкость воды', `${nf(p.muW, 2)} мПа·с`],
        [term('Bo', 'Объёмный коэффициент'), nf(p.bo, 2)],
        ['Плотность нефти', `${nf(p.rho * 1000)} кг/м³`],
        [term('ГФ', 'Газовый фактор'), `${p.gor} м³/т`],
        [term('Pнас', 'Давление насыщения'), `${nf(p.pb, 1)} МПа`],
        [term('Квыт', 'Коэф. вытеснения'), nf(app.an.Ed, 2)],
      ])}</section>
      <section><h3>Экономика</h3>${t([
        [term('Нетбэк', 'Цена нефти (нетбэк)'), `${nf(e.price)} ₽/т`],
        [term('НДПИ'), `${nf(e.ndpi * 100)}% выручки`],
        ['Налог на прибыль', '20%'],
        [term('Ставка', 'Ставка дисконтирования'), `${nf(e.discount * 100)}%`],
        [term('OPEX', 'Подъём жидкости'), `${nf(e.opexLiq)} ₽/м³`],
        ['Обслуживание скважины', `${e.opexWell} млн ₽/год`],
        ['Штраф за сжигание ПНГ', `${nf(e.flareFine)} ₽/тыс. м³`],
        ['Бюджет на CAPEX', `${nf(sc.budget)} млн ₽`],
      ])}</section>
    </div>
    <details class="formulas"><summary>Как считается (для нефтяников)</summary>
      <ul>
        <li><b>Запасы:</b> в каждой ячейке 100×100 м: N = S·h·φ·So / Bo. Зона дренирования: 450 м от ствола с весом 1 − (d/R)². Перекрытые ячейки делятся между скважинами пропорционально весам (${term('Интерференция', 'интерференция')}).</li>
        <li><b>Дебит:</b> q₀ = 0,12 · (k·h)ₑ / μ, м³/сут жидкости; для ГС множитель 1 + L/300 · min(2; 12/h).</li>
        <li><b>Падение:</b> q(t) = q₀ · [S + (1 − S)·e^(−D·t)], где S — степень поддержки ППД (0…1), D — темп падения.</li>
        <li><b>${term('Характеристика', 'Характеристика вытеснения')}:</b> КИН(τ) = E·(1 − e^(−τ/(E·s))), где E = Квыт·Кохв, Кохв от ${r.edep} (истощение) до ${r.ewf} (заводнение), s = 1 + 0,012(μо/μв − 1) + 1,2·(доля воды в зоне) + штраф за близость нагнетательной.</li>
        <li><b>Сеть:</b> скважина работает, если по трубам ≤ 2,5 км до ДНС/УПН, а оттуда есть путь до УПН и пункта сдачи. Мощности: ДНС ${nf(CATALOG.dns.cap)} м³/сут, УПН ${nf(CATALOG.upn.cap)} м³/сут; при перегрузе добыча ограничивается.</li>
        <li><b>Экономика:</b> ЧДД = −CAPEX + Σ CFₜ/(1 + r)^(t − 0,5); CF = выручка − НДПИ − OPEX − штраф за факел − налог на прибыль (амортизация 10 лет). Отключение скважины при обводнённости 98%, промысла — при отрицательном операционном потоке.</li>
      </ul>
    </details>
    <div class="res-actions"><button class="btn danger" data-act="reset">🗑 Начать проект заново</button></div>`, 'passport');
}

function showHelp() {
  openModal(`<h2>❓ Как играть</h2>
    <div class="howto">
      <div><b>1. Бурите</b><span>Перетащите 🛢️ из нижней панели на оранжевое пятно: там нефть</span></div>
      <div><b>2. Стройте</b><span>Поставьте 🏭 УПН и соедините её трубой 🔗 с флажком 🚩</span></div>
      <div><b>3. Считайте</b><span>Нажмите ▶ «Рассчитать» и получите очки</span></div>
      <div><b>4. Обгоняйте</b><span>Имя в окне «👤 Игрок» — и результат сам попадёт в рейтинг</span></div>
    </div>
    <h2>✋ Жесты</h2>
    <div class="help-grid">
      <div><b>☝️ Палец по карте</b><span>двигать карту (в 3D — вращать)</span></div>
      <div><b>✌️ Два пальца</b><span>приблизить, повернуть</span></div>
      <div><b>Тянуть объект</b><span>переместить, трубы тянутся следом</span></div>
      <div><b>Коснуться объекта</b><span>посмотреть параметры и удалить</span></div>
      <div><b>🔗 Труба</b><span>провести пальцем от объекта к объекту</span></div>
      <div><b>➰ Белый шарик</b><span>длина и поворот горизонтального ствола</span></div>
    </div>
    <h2>📖 Термины</h2>
    <div class="gloss">${GLOSSARY.map(g => `<details><summary>${esc(g.title)}</summary><p>${esc(g.text)}</p></details>`).join('')}</div>`, 'help');
}

function showTerm(key) {
  const g = termByKey(key);
  if (!g) return;
  const pop = $('#termpop');
  pop.innerHTML = `<b>${esc(g.title)}</b><p>${esc(g.text)}</p>`;
  pop.hidden = false;
  clearTimeout(showTerm.t);
  showTerm.t = setTimeout(() => { pop.hidden = true; }, 9000);
}

function showScenarioPicker() {
  openModal(`<h2>Выбор месторождения</h2>
    <div class="scn-grid">${SCENARIOS.map(s => `
      <button class="scn ${s.id === app.sc.id ? 'on' : ''}" data-pick="${s.id}">
        <div class="scn-top"><b>${esc(s.name)}</b><span class="stars">${'★'.repeat(s.difficulty)}${'☆'.repeat(3 - s.difficulty)}</span></div>
        <div class="scn-desc">${esc(s.description)}</div>
        <div class="scn-meta">Бюджет ${nf(s.budget)} млн ₽</div>
      </button>`).join('')}</div>
    <p class="muted small">Проект по каждому месторождению сохраняется в этом браузере.</p>`);
}

// ---------- Мелочи ----------
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), ms);
}
function buzz() { try { navigator.vibrate?.(12); } catch { /* нет вибро */ } }

// ---------- Кнопки (делегирование) ----------
document.addEventListener('click', e => {
  const t = e.target.closest('[data-term]');
  if (t) { e.stopPropagation(); return showTerm(t.dataset.term); }
  if (!e.target.closest('#termpop')) $('#termpop').hidden = true;
  const pick = e.target.closest('[data-pick]');
  if (pick) { closeModal(); if (pick.dataset.pick !== app.baseId) loadScenario(pick.dataset.pick); return; }
  const arm = e.target.closest('[data-arm]');
  if (arm) {
    app.tool = app.tool === arm.dataset.arm ? null : arm.dataset.arm;
    app.pipeFrom = null;
    renderPalette();
    return;
  }
  const layer = e.target.closest('[data-layer]');
  if (layer) {
    app.layer = layer.dataset.layer;
    scene.setLayer(app.layer);
    renderLegend();
    document.querySelectorAll('[data-layer]').forEach(b => b.classList.toggle('on', b === layer));
    return;
  }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  switch (a.dataset.act) {
    case 'close': select(null); break;
    case 'delete': deleteSelected(); break;
    case 'len-': editHoriz(h => { h.len = clamp(h.len - 100, HORIZ.min, HORIZ.max); }); break;
    case 'len+': editHoriz(h => { h.len = clamp(h.len + 100, HORIZ.min, HORIZ.max); }); break;
    case 'rot-': editHoriz(h => { h.angle -= Math.PI / 12; }); break;
    case 'rot+': editHoriz(h => { h.angle += Math.PI / 12; }); break;
    case 'disarm': disarm(); break;
    case 'fold': {
      const k = a.dataset.fold;
      app.fold[k] = !app.fold[k];
      ({ rules: renderRules, player: () => renderPlayer(true), lb: renderLeaderboard, advisor: renderAdvisor })[k]();
      if (app.resOpen) setResultsOpen(true);
      break;
    }
    case 'close-modal': closeModal(); break;
    case 'name-ok': commitName($('#inPlayer').value); break;
    case 'new-player': newPlayer(); break;
    case 'new-player-now': newPlayer(true); break;
    case 'results-toggle': setResultsOpen(!app.resOpen); break;
    case 'params': showParams(); break;
    case 'params-apply': applyParams(); break;
    case 'params-default': applyParams(true); break;
    case 'passport': showPassport(); break;
    case 'scenarios': showScenarioPicker(); break;
    case 'home': closeModal(); scene.resetCamera(); break;
    case 'reset': closeModal(); resetProject(); toast('Проект очищен. Отменить можно кнопкой ↶'); break;
  }
});

$('#btnCalc').addEventListener('click', runCalc);
$('#btnUndo').addEventListener('click', undo);
$('#btnHelp').addEventListener('click', showHelp);
$('#btnMenu').addEventListener('click', showMenu);
$('#btnScenario').addEventListener('click', showScenarioPicker);
$('#btn3d').addEventListener('click', () => {
  app.view3d = !app.view3d;
  scene.set3D(app.view3d);
  $('#btn3d').classList.toggle('on', app.view3d);
  $('#btn3d').textContent = app.view3d ? '🗺️ Карта' : '🧊 3D';
  scene.sync(app.state, app.an, app.selected);
  if (app.view3d) toast('3D-разрез: пласт под землёй, вертикальный масштаб увеличен');
});

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && app.selected) deleteSelected();
  if (e.key === 'z' && (e.ctrlKey || e.metaKey)) undo();
  if (e.key === 'Escape') { disarm(); select(null); closeModal(); }
});
document.addEventListener('gesturestart', e => e.preventDefault());

// ---------- Старт ----------
// Всегда стартуем с «Учебного»: подошёл к планшету — и сразу играешь
renderRules();
loadScenario('training');
setTimeout(() => toast(app.player ? 'Перетащите 🛢️ из нижней панели на оранжевое пятно: там нефть' : 'Впишите имя справа вверху и перетащите 🛢️ на оранжевое пятно', 6000), 600);
window.addEventListener('resize', layoutCols);
if (LB.online) setInterval(refreshLeaderboard, 20000);
