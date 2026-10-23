// Рейтинг: Supabase REST, если настроен в config.js, иначе localStorage.
import { CONFIG } from './config.js';

const LS_KEY = 'fieldx_scores_v1';
export const online = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);

const headers = () => ({
  apikey: CONFIG.SUPABASE_ANON_KEY,
  Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
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
      const url = `${CONFIG.SUPABASE_URL}/rest/v1/scores?select=player,npv,oil_kt,kin,wells,created_at&scenario=eq.${encodeURIComponent(scenario)}&order=npv.desc&limit=1000`;
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

export async function submitScore(rec) {
  const row = { ...rec, created_at: new Date().toISOString() };
  try {
    const all = localAll();
    all.push(row);
    localStorage.setItem(LS_KEY, JSON.stringify(all.slice(-500)));
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
