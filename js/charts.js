// Лёгкие SVG-графики с подсказкой при наведении/касании.

function niceStep(range, count) {
  const raw = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

const nf = v => Number(v).toLocaleString('ru-RU', { maximumFractionDigits: Math.abs(v) < 10 && v !== 0 ? 1 : 0 });

// opt: { data:[{year, ...}], key, kind:'bar'|'line', color, unit, label }
export function chart(el, opt) {
  const { data, key, kind = 'bar', color, unit = '', label = '', width = 560 } = opt;
  const W = width, H = 210, m = { l: 56, r: 14, t: 14, b: 28 };
  const vals = data.map(d => d[key]).filter(v => v != null);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (hi - lo < 1e-9) hi = lo + 1;
  const step = niceStep(hi - lo, 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const iw = W - m.l - m.r, ih = H - m.t - m.b, n = data.length, bw = iw / n;
  const X = i => m.l + bw * (i + 0.5);
  const Y = v => m.t + ih * (1 - (v - lo) / (hi - lo));

  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="${label}">`;
  for (let v = lo; v <= hi + step * 1e-6; v += step) {
    const y = Y(v).toFixed(1);
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" class="${Math.abs(v) < step * 1e-6 ? 'ch-base' : 'ch-grid'}"/>`;
    s += `<text x="${m.l - 8}" y="${y}" class="ch-tick" text-anchor="end" dominant-baseline="middle">${nf(v)}</text>`;
  }
  data.forEach((d, i) => {
    if (i % 5 === 0 || i === n - 1) s += `<text x="${X(i).toFixed(1)}" y="${H - 8}" class="ch-tick" text-anchor="middle">${d.year}</text>`;
  });

  if (kind === 'bar') {
    const w = bw * 0.68, y0 = Y(0);
    data.forEach((d, i) => {
      const v = d[key];
      if (v == null || Math.abs(Y(v) - y0) < 0.5) return;
      const x = X(i) - w / 2, y1 = Y(v), up = v >= 0;
      const r = Math.min(4, w / 2, Math.abs(y1 - y0) / 2);
      const path = up
        ? `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`
        : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`;
      s += `<path d="${path}" fill="${color}" class="ch-bar" data-i="${i}"/>`;
    });
  } else {
    const pts = data.map((d, i) => (d[key] == null ? null : `${X(i).toFixed(1)},${Y(d[key]).toFixed(1)}`)).filter(Boolean).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  s += `<line class="ch-cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>`;
  s += `<circle class="ch-dot" r="5" fill="${color}" visibility="hidden"/>`;
  s += `<rect class="ch-hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>`;
  s += `</svg><div class="ch-tip" hidden></div>`;
  el.innerHTML = s;

  const svg = el.querySelector('svg'), tip = el.querySelector('.ch-tip');
  const cross = svg.querySelector('.ch-cross'), dot = svg.querySelector('.ch-dot');
  const bars = [...svg.querySelectorAll('.ch-bar')];
  const show = e => {
    const r = svg.getBoundingClientRect();
    const sx = (e.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(n - 1, Math.floor((sx - m.l) / bw)));
    const d = data[i];
    if (d[key] == null) return hide();
    const cx = X(i), cy = Y(d[key]);
    if (kind === 'line') {
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
    } else {
      bars.forEach(b => b.classList.toggle('dim', +b.dataset.i !== i));
    }
    tip.hidden = false;
    tip.innerHTML = `<b>${d.year}</b><span>${nf(d[key])} ${unit}</span>`;
    const px = cx / W * r.width, py = cy / H * r.height;
    tip.style.left = `${Math.min(r.width - 120, Math.max(0, px - 60))}px`;
    tip.style.top = `${Math.max(0, py - 52)}px`;
  };
  const hide = () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    bars.forEach(b => b.classList.remove('dim'));
  };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
}
