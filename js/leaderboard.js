// Рейтинг: Supabase REST, если настроен в config.js, иначе localStorage.
import { CONFIG } from './config.js';

const LS_KEY = 'fieldx_scores_v1';
export const online = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);

// Старый ключ anon — это JWT (eyJ…), его же передаём как Bearer. Новый publishable (sb_publishable_…) — только в apikey.
const headers = () => ({
  apikey: CONFIG.SUPABASE_ANON_KEY,
  ...(CONFIG.SUPABASE_ANON_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}` } : {}),
  'Content-Type': 'application/json',
});

function localAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
}

function bestPerPlayer(rows) {
  const best = new Map();
  for (const r of rows) {
    const k = r.player.trim().toLowerCase();
    if (!best.has(k) || r.npv > best.get(k).npv) best.set(k, r);
  }
  return [...best.values()].sort((a, b) => b.npv - a.npv);
}

export let lastError = null;

export async function fetchScores(scenario) {
  if (online) {
    try {
      const url = `${CONFIG.SUPABASE_URL}/rest/v1/scores?select=id,player,npv,oil_kt,kin,wells,created_at&scenario=eq.${encodeURIComponent(scenario)}&order=npv.desc&limit=1000`;
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      lastError = null;
      return bestPerPlayer(await res.json());
    } catch (e) {
      lastError = e.message;
    }
  }
  return bestPerPlayer(localAll().filter(r => r.scenario === scenario));
}

// Расстановка объектов из записи рейтинга: онлайн — отдельным запросом по id, локально — прямо в записи
export async function fetchProject(row) {
  if (row.project) return row.project;
  if (!online || row.id == null) return null;
  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/scores?select=project&id=eq.${encodeURIComponent(row.id)}`, { headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json())[0]?.project || null;
}

export async function submitScore(rec) {
  const row = { ...rec, created_at: new Date().toISOString() };
  try {
    const all = localAll();
    all.push(row);
    localStorage.setItem(LS_KEY, JSON.stringify(all.slice(-200)));
  } catch { /* хранилище недоступно */ }
  if (!online) return { ok: true, online: false };
  try {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/scores`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify(rec),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, online: true };
  } catch (e) {
    lastError = e.message;
    return { ok: false, online: true, error: e.message };
  }
}

// Очистка рейтинга: пароль проверяет сама база (функция clear_scores), в коде сайта его нет
export async function clearScores(pin) {
  if (online) {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/clear_scores`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ pin }),
    });
    if (!res.ok) return { ok: false, error: res.status === 400 || res.status === 401 || res.status === 403 ? 'Неверный пароль' : `HTTP ${res.status}` };
  }
  try { localStorage.removeItem(LS_KEY); } catch { /* хранилище недоступно */ }
  return { ok: true };
}
