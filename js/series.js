// Turns raw per-frame pose landmarks into clean, uniformly sampled time
// series: resampling, left/right leg-swap correction, low-pass filtering,
// and a per-frame body-size estimate used to convert pixels to metres.

import { isNum, filtfiltNaN, median, rollingPercentile } from './signal.js';

/** BlazePose landmark indices used by the analysis. */
export const LM = {
  nose: 0,
  lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28,
  lHeel: 29, rHeel: 30, lToe: 31, rToe: 32,
};

const LEG_PAIRS = [[25, 26], [27, 28], [29, 30], [31, 32]];

/**
 * Shoulder-to-ankle chain length as a fraction of standing height.
 * (Shoulder ≈ 0.818·H, ankle ≈ 0.039·H in standard anthropometric tables;
 * the segment sum shoulder→hip→knee→ankle telescopes to their difference.)
 */
export const BODY_FRAC = 0.78;

/**
 * @param raw {frames:[{t, lm:Float32Array(132)|null}], width, height}
 *        lm holds [x_px, y_px, z, visibility] for each of 33 landmarks.
 */
export function buildSeries(raw, { minVis = 0.3, maxGapS = 0.3, fc = 6 } = {}) {
  const frames = raw.frames.filter((f) => f.lm);
  if (frames.length < 15) throw new Error('A person was detected in too few frames. Check that the whole body is visible.');

  const dts = [];
  for (let i = 1; i < frames.length; i++) {
    const d = frames[i].t - frames[i - 1].t;
    if (d > 0) dts.push(d);
  }
  const dtMin = Math.max(1 / 120, percentile10(dts));
  const fs = Math.min(60, Math.max(15, Math.round(1 / dtMin)));
  const t0 = frames[0].t;
  const N = Math.floor((frames[frames.length - 1].t - t0) * fs) + 1;
  const t = new Float64Array(N);
  for (let i = 0; i < N; i++) t[i] = t0 + i / fs;

  const X = [], Y = [], V = [];
  for (let k = 0; k < 33; k++) {
    const xs = new Float64Array(N).fill(NaN);
    const ys = new Float64Array(N).fill(NaN);
    const vs = new Float64Array(N).fill(NaN);
    let j = 0;
    let jv = 0;
    const valid = frames.filter((f) => f.lm[k * 4 + 3] >= minVis);
    for (let i = 0; i < N; i++) {
      const ti = t[i];
      // visibility: interpolate over all frames
      while (jv < frames.length - 2 && frames[jv + 1].t <= ti) jv++;
      vs[i] = lerpAt(frames[jv].t, frames[jv].lm[k * 4 + 3], frames[Math.min(jv + 1, frames.length - 1)].t, frames[Math.min(jv + 1, frames.length - 1)].lm[k * 4 + 3], ti);
      if (!valid.length) continue;
      while (j < valid.length - 2 && valid[j + 1].t <= ti) j++;
      const a = valid[j];
      const b = valid[Math.min(j + 1, valid.length - 1)];
      if (ti < a.t - 1e-6 || ti > b.t + 1e-6) {
        if (Math.abs(ti - a.t) < 0.5 / fs) { xs[i] = a.lm[k * 4]; ys[i] = a.lm[k * 4 + 1]; }
        continue;
      }
      if (b.t - a.t > maxGapS) continue;
      xs[i] = lerpAt(a.t, a.lm[k * 4], b.t, b.lm[k * 4], ti);
      ys[i] = lerpAt(a.t, a.lm[k * 4 + 1], b.t, b.lm[k * 4 + 1], ti);
    }
    X.push(xs); Y.push(ys); V.push(vs);
  }

  const S = { fs, N, t, X, Y, V, width: raw.width, height: raw.height, frameRate: 1 / dtMin, detectedFrames: frames.length, totalFrames: raw.frames.length };
  S.legSwaps = fixLegSwaps(S);
  for (let k = 0; k < 33; k++) {
    S.X[k] = filtfiltNaN(S.X[k], fc, fs);
    S.Y[k] = filtfiltNaN(S.Y[k], fc, fs);
  }
  S.L = bodyLengthPx(S);
  return S;
}

function percentile10(arr) {
  const v = arr.slice().sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length * 0.1)] : 1 / 30;
}

function lerpAt(ta, va, tb, vb, t) {
  if (tb === ta) return va;
  return va + (vb - va) * (t - ta) / (tb - ta);
}

const dist = (S, a, b, i) => Math.hypot(S.X[a][i] - S.X[b][i], S.Y[a][i] - S.Y[b][i]);

/**
 * Pose models sometimes swap the left and right leg labels for a few frames
 * (especially in side views). Keep each leg on a continuous track by
 * comparing every frame with a constant-velocity prediction from the
 * previous two frames, then align the tracks with the model's majority label.
 */
function fixLegSwaps(S) {
  const { N, X, Y } = S;
  const legLen = [];
  for (let i = 0; i < N; i += 3) {
    const d = dist(S, 23, 27, i);
    if (isNum(d)) legLen.push(d);
  }
  const scale = median(legLen) || 100;
  const swapped = new Uint8Array(N);
  let count = 0;
  const ok = (i) => LEG_PAIRS.every(([l, r]) => isNum(X[l][i]) && isNum(X[r][i]));
  for (let i = 2; i < N; i++) {
    if (!ok(i) || !ok(i - 1) || !ok(i - 2)) continue;
    // When the feet overlap in the image the prediction cannot tell them
    // apart; keep the model's own labels for that frame.
    const localLeg = (dist(S, 23, 27, i - 1) + dist(S, 24, 28, i - 1)) / 2;
    if (dist(S, 27, 28, i - 1) < 0.12 * (localLeg || scale)) continue;
    let keep = 0, swap = 0;
    for (const [l, r] of LEG_PAIRS) {
      const plx = 2 * X[l][i - 1] - X[l][i - 2], ply = 2 * Y[l][i - 1] - Y[l][i - 2];
      const prx = 2 * X[r][i - 1] - X[r][i - 2], pry = 2 * Y[r][i - 1] - Y[r][i - 2];
      keep += Math.hypot(X[l][i] - plx, Y[l][i] - ply) + Math.hypot(X[r][i] - prx, Y[r][i] - pry);
      swap += Math.hypot(X[r][i] - plx, Y[r][i] - ply) + Math.hypot(X[l][i] - prx, Y[l][i] - pry);
    }
    if (swap < 0.5 * keep && keep - swap > 0.15 * (localLeg || scale)) {
      swapLegs(S, i, i);
      swapped[i] = 1;
    }
    // propagate: a frame is "swapped" relative to raw if we swapped it, but
    // later frames are compared with the corrected history, so a label flip
    // that persists is corrected frame by frame.
    if (swapped[i]) count++;
  }
  // Track continuity can lock onto the wrong identity if the first frames
  // were mislabelled: align with the majority of the model's labels.
  if (count > N / 2) {
    for (let i = 0; i < N; i++) swapped[i] = swapped[i] ? 0 : 1;
    swapLegs(S, 0, N - 1);
  }
  return swapped.reduce((s, v) => s + v, 0);
}

function swapLegs(S, a, b) {
  for (const [l, r] of LEG_PAIRS) {
    for (const arr of [S.X, S.Y, S.V]) {
      for (let i = a; i <= b; i++) {
        const tmp = arr[l][i]; arr[l][i] = arr[r][i]; arr[r][i] = tmp;
      }
    }
  }
}

/**
 * Per-frame body size in pixels from the two shoulder→hip→knee→ankle chains,
 * smoothed with a rolling 70th percentile (robust to brief tracking errors).
 * mode 'max': the longer chain (front views, where a swinging leg is
 * foreshortened). mode 'mean': the average of both chains, which sits at the
 * depth of the body midline (side views, where one side is nearer the camera);
 * falls back to the longer chain when the two disagree by more than 15%.
 */
export function bodyLengthPx(S, mode = 'max') {
  const raw = new Float64Array(S.N).fill(NaN);
  for (let i = 0; i < S.N; i++) {
    const lens = [];
    for (const [sh, hip, knee, ank] of [[11, 23, 25, 27], [12, 24, 26, 28]]) {
      const len = dist(S, sh, hip, i) + dist(S, hip, knee, i) + dist(S, knee, ank, i);
      if (isNum(len)) lens.push(len);
    }
    if (!lens.length) continue;
    const mx = Math.max(...lens);
    raw[i] = mode === 'mean' && lens.length === 2 && Math.min(...lens) > 0.85 * mx ? (lens[0] + lens[1]) / 2 : mx;
  }
  return rollingPercentile(raw, Math.round(0.8 * S.fs), 0.7);
}

/** Midpoint series of two landmarks. */
export function midSeries(S, a, b, axis = 'X') {
  const A = S[axis][a], B = S[axis][b];
  const out = new Float64Array(S.N);
  for (let i = 0; i < S.N; i++) out[i] = (A[i] + B[i]) / 2;
  return out;
}

/** Mean of several landmarks per frame (skipping missing ones). */
export function meanSeries(S, idxs, axis = 'X') {
  const out = new Float64Array(S.N).fill(NaN);
  for (let i = 0; i < S.N; i++) {
    let s = 0, n = 0;
    for (const k of idxs) { const v = S[axis][k][i]; if (isNum(v)) { s += v; n++; } }
    if (n) out[i] = s / n;
  }
  return out;
}

/** Contiguous runs where pred(i) returns the same non-zero key. */
export function runs(N, keyAt, minLen = 1) {
  const out = [];
  let start = -1, key = 0;
  for (let i = 0; i <= N; i++) {
    const k = i < N ? keyAt(i) : 0;
    if (k !== key) {
      if (key !== 0 && i - start >= minLen) out.push({ start, end: i - 1, key });
      start = i; key = k;
    }
  }
  return out;
}
