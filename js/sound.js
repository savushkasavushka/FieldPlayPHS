// Звуки и вибрация: короткие синтезированные сигналы (без файлов). По умолчанию выключены.
let ctx = null;
export const sound = { on: false };

const TONES = {
  place: [[520, 0.06], [780, 0.08]],
  pipe: [[440, 0.05], [660, 0.05]],
  remove: [[420, 0.06], [260, 0.1]],
  error: [[200, 0.12], [160, 0.14]],
  result: [[523, 0.12], [659, 0.12], [784, 0.12], [1046, 0.3]],
};
const VIBRO = { place: 12, pipe: 10, remove: 15, error: [30, 40, 30], result: [20, 60, 40] };

export function sfx(name) {
  if (!sound.on) return;
  try { navigator.vibrate?.(VIBRO[name]); } catch { /* нет вибро */ }
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    let t = ctx.currentTime;
    for (const [f, d] of TONES[name]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = name === 'error' ? 'square' : 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + d + 0.02);
      t += d * 0.85;
    }
  } catch { /* нет звука */ }
}
