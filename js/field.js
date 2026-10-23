// Генерация сеточной модели пласта (40×40 ячеек по 100 м) из параметров сценария.
// Модель детерминирована (seed), поэтому у всех игроков одно и то же месторождение.

export const GRID_N = 40;
export const CELL_M = 100;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Гладкий шум: случайная грубая сетка coarse×coarse с плавной интерполяцией.
function makeNoise(rng, n, coarse) {
  const size = coarse + 2;
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rng() * 2 - 1;
  return (i, j) => {
    const x = (i / n) * coarse, y = (j / n) * coarse;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    let fx = x - x0, fy = y - y0;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const v = (a, b) => g[a * size + b];
    const l = v(x0, y0) * (1 - fy) + v(x0, y0 + 1) * fy;
    const r = v(x0 + 1, y0) * (1 - fy) + v(x0 + 1, y0 + 1) * fy;
    return l * (1 - fx) + r * fx;
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function buildField(sc) {
  const N = GRID_N, r = sc.reservoir, rng = mulberry32(sc.seed);
  const nA = makeNoise(rng, N, 4), nB = makeNoise(rng, N, 10);
  const nK = makeNoise(rng, N, 5), nK2 = makeNoise(rng, N, 12);
  const top = new Float32Array(N * N), h = new Float32Array(N * N);
  const k = new Float32Array(N * N), phi = new Float32Array(N * N);
  const so = new Float32Array(N * N), oil = new Float32Array(N * N);

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const id = j * N + i;
      const xk = (i + 0.5) * CELL_M / 1000, yk = (j + 0.5) * CELL_M / 1000;
      let dome = 0;
      for (const d of r.domes) {
        dome += d.amp * Math.exp(-((xk - d.x) ** 2 / (2 * d.sx ** 2) + (yk - d.y) ** 2 / (2 * d.sy ** 2)));
      }
      const a = nA(i, j), b = nB(i, j);
      const t = r.baseTop - dome + r.topNoise * (0.7 * a + 0.3 * b);
      const column = Math.max(0, r.owc - t);
      const ntg = clamp(0.8 + 0.25 * b, 0.45, 1);
      const gross = r.hGross * (0.85 + 0.3 * (0.5 + 0.5 * a));
      let hh = Math.min(gross, column) * ntg;
      if (hh < 0.3) hh = 0;
      const kn = 0.7 * nK(i, j) + 0.3 * nK2(i, j);
      top[id] = t;
      h[id] = hh;
      k[id] = r.kMean * Math.exp(r.kVar * kn);
      phi[id] = clamp(r.phiMean + 0.035 * kn, 0.08, 0.3);
      so[id] = hh > 0 ? r.soMean * (column < 4 ? 0.8 : 1) : 0;
      oil[id] = CELL_M * CELL_M * hh * phi[id] * so[id] / sc.pvt.bo; // м³ в поверхностных условиях
    }
  }

  let stoiipM3 = 0, oilCells = 0, topMin = Infinity, topMax = -Infinity, hMax = 0;
  let kMin = Infinity, kMax = 0, phiSum = 0, kSum = 0, hSum = 0;
  for (let id = 0; id < N * N; id++) {
    stoiipM3 += oil[id];
    topMin = Math.min(topMin, top[id]);
    topMax = Math.max(topMax, top[id]);
    if (h[id] > 0) {
      oilCells++;
      hMax = Math.max(hMax, h[id]);
      kMin = Math.min(kMin, k[id]);
      kMax = Math.max(kMax, k[id]);
      phiSum += phi[id]; kSum += k[id]; hSum += h[id];
    }
  }

  return {
    N, cell: CELL_M, top, h, k, phi, so, oil,
    topMin, topMax, hMax, kMin, kMax,
    stoiipM3, stoiipT: stoiipM3 * sc.pvt.rho,
    oilAreaKm2: oilCells * CELL_M * CELL_M / 1e6,
    avgH: oilCells ? hSum / oilCells : 0,
    avgK: oilCells ? kSum / oilCells : 0,
    avgPhi: oilCells ? phiSum / oilCells : 0,
  };
}

// Индекс ячейки по мировым координатам (1 ед. = 100 м, центр участка в 0,0), −1 — вне участка.
export function cellAt(field, x, z) {
  const i = Math.floor(x + field.N / 2), j = Math.floor(z + field.N / 2);
  if (i < 0 || j < 0 || i >= field.N || j >= field.N) return -1;
  return j * field.N + i;
}
