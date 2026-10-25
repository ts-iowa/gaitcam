// Small numeric toolkit: gap filling, zero-phase Butterworth filtering,
// derivatives, peak finding and robust statistics. No DOM access, so it can
// be imported by the test page as well as the app.

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Linearly interpolate across NaN gaps; edges hold the nearest value. */
export function fillGaps(x) {
  const n = x.length;
  const y = new Float64Array(n);
  let first = -1;
  for (let i = 0; i < n; i++) if (isNum(x[i])) { first = i; break; }
  if (first < 0) { y.fill(NaN); return y; }
  for (let i = 0; i <= first; i++) y[i] = x[first];
  let prev = first;
  for (let i = first + 1; i < n; i++) {
    if (!isNum(x[i])) continue;
    const span = i - prev;
    for (let j = prev + 1; j < i; j++) y[j] = x[prev] + (x[i] - x[prev]) * (j - prev) / span;
    y[i] = x[i];
    prev = i;
  }
  for (let i = prev + 1; i < n; i++) y[i] = x[prev];
  return y;
}

/** 2nd-order Butterworth low-pass coefficients (bilinear transform). */
function butter2(fc, fs) {
  const K = Math.tan(Math.PI * fc / fs);
  const norm = 1 / (1 + Math.SQRT2 * K + K * K);
  const b0 = K * K * norm;
  return {
    b: [b0, 2 * b0, b0],
    a: [1, 2 * (K * K - 1) * norm, (1 - Math.SQRT2 * K + K * K) * norm],
  };
}

/** Direct-form II transposed filter, initialised to steady state at x[0]. */
function lfilter(b, a, x) {
  const n = x.length;
  const y = new Float64Array(n);
  const x0 = x[0];
  let z2 = (b[2] - a[2]) * x0;
  let z1 = (b[1] - a[1]) * x0 + z2;
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = b[0] * xi + z1;
    z1 = b[1] * xi - a[1] * yi + z2;
    z2 = b[2] * xi - a[2] * yi;
    y[i] = yi;
  }
  return y;
}

/** Zero-phase low-pass filter (forward-backward) with odd reflection padding. */
export function filtfilt(x, fc, fs) {
  const n = x.length;
  if (n < 4 || fc >= fs * 0.475) return Float64Array.from(x);
  const { b, a } = butter2(fc, fs);
  const pad = Math.min(n - 1, Math.max(6, Math.round(1.5 * fs / fc)));
  const ext = new Float64Array(n + 2 * pad);
  for (let i = 0; i < pad; i++) ext[i] = 2 * x[0] - x[pad - i];
  for (let i = 0; i < n; i++) ext[pad + i] = x[i];
  for (let i = 0; i < pad; i++) ext[pad + n + i] = 2 * x[n - 1] - x[n - 2 - i];
  let y = lfilter(b, a, ext).reverse();
  y = lfilter(b, a, y).reverse();
  return y.slice(pad, pad + n);
}

/** filtfilt that tolerates NaN: gaps are bridged for filtering, then restored. */
export function filtfiltNaN(x, fc, fs) {
  const filled = fillGaps(x);
  if (!isNum(filled[0])) return filled;
  const y = filtfilt(filled, fc, fs);
  for (let i = 0; i < x.length; i++) if (!isNum(x[i])) y[i] = NaN;
  return y;
}

/** Central-difference derivative (units per second). */
export function derivative(x, fs) {
  const n = x.length;
  const d = new Float64Array(n).fill(NaN);
  for (let i = 1; i < n - 1; i++) d[i] = (x[i + 1] - x[i - 1]) * fs / 2;
  if (n > 1) { d[0] = (x[1] - x[0]) * fs; d[n - 1] = (x[n - 1] - x[n - 2]) * fs; }
  return d;
}

/**
 * Local maxima of x within [lo, hi] with at least `minProm` prominence and
 * `minDist` samples between kept peaks (taller peaks win).
 */
export function findPeaks(x, { minDist = 1, minProm = 0, lo = 0, hi = x.length - 1 } = {}) {
  const cands = [];
  for (let i = Math.max(lo + 1, 1); i < Math.min(hi, x.length - 1); i++) {
    const v = x[i];
    if (!isNum(v) || !(v > x[i - 1] && v >= x[i + 1])) continue;
    let lmin = v;
    for (let j = i - 1; j >= lo && isNum(x[j]) && x[j] <= v; j--) if (x[j] < lmin) lmin = x[j];
    let rmin = v;
    for (let j = i + 1; j <= hi && isNum(x[j]) && x[j] <= v; j++) if (x[j] < rmin) rmin = x[j];
    const prom = v - Math.max(lmin, rmin);
    if (prom >= minProm) cands.push({ i, v });
  }
  cands.sort((a, b) => b.v - a.v);
  const kept = [];
  for (const c of cands) if (kept.every((k) => Math.abs(k.i - c.i) >= minDist)) kept.push(c);
  return kept.map((k) => k.i).sort((a, b) => a - b);
}

/** Sub-sample peak offset (-0.5..0.5) from a parabola through i-1, i, i+1. */
export function subsample(x, i) {
  if (i <= 0 || i >= x.length - 1) return 0;
  const den = x[i - 1] - 2 * x[i] + x[i + 1];
  if (!isNum(den) || den === 0) return 0;
  return Math.max(-0.5, Math.min(0.5, 0.5 * (x[i - 1] - x[i + 1]) / den));
}

function finite(arr) {
  const out = [];
  for (const v of arr) if (isNum(v)) out.push(v);
  return out;
}

export function mean(arr) {
  const v = finite(arr);
  return v.length ? v.reduce((s, a) => s + a, 0) / v.length : NaN;
}

export function sd(arr) {
  const v = finite(arr);
  if (v.length < 2) return NaN;
  const m = v.reduce((s, a) => s + a, 0) / v.length;
  return Math.sqrt(v.reduce((s, a) => s + (a - m) ** 2, 0) / (v.length - 1));
}

export function percentile(arr, p) {
  const v = finite(arr).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const idx = (v.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

export const median = (arr) => percentile(arr, 0.5);

/** Mean of x over sample indices [a, b] (inclusive, clipped). */
export function meanRange(x, a, b) {
  a = Math.max(0, Math.round(a));
  b = Math.min(x.length - 1, Math.round(b));
  let s = 0, n = 0;
  for (let i = a; i <= b; i++) if (isNum(x[i])) { s += x[i]; n++; }
  return n ? s / n : NaN;
}

/** Centred rolling percentile with window `win` samples. */
export function rollingPercentile(x, win, p) {
  const n = x.length;
  const half = Math.max(1, Math.floor(win / 2));
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = [];
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) if (isNum(x[j])) w.push(x[j]);
    y[i] = w.length ? percentile(w, p) : NaN;
  }
  return y;
}

/** Summary {mean, sd, n} of an array of numbers. */
export function summary(arr) {
  const v = finite(arr);
  return { mean: mean(v), sd: sd(v), n: v.length };
}
