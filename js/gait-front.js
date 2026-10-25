// Walk-and-turn test (camera at the end of the walkway, looking along it).
// The person walks away from the camera, turns 180° and walks back.
// Measures base width (step width), number of steps to turn and turn time,
// plus approximate gait speed / step length when no side test is available.
//
// Distance from the camera is estimated from apparent body size with a
// pinhole model: Z = f · bodyLength_m / bodyLength_px.

import { isNum, filtfiltNaN, derivative, meanRange, median, mean, summary } from './signal.js';
import { BODY_FRAC, meanSeries, runs } from './series.js';

const FEET = {
  L: { pts: [27, 29, 31], ankle: 27 },
  R: { pts: [28, 30, 32], ankle: 28 },
};

export function analyzeFront(S, subject, settings = {}, sideResult = null) {
  const { fs, N, X, width: W, height: H } = S;
  const Hm = (subject.heightCm / 100) * ((settings.scaleAdj || 100) / 100);
  const bodyM = BODY_FRAC * Hm;
  const fovLong = ((settings.fovDeg || 67) * Math.PI) / 180;
  const fpx = Math.max(W, H) / 2 / Math.tan(fovLong / 2);
  const cx = W / 2;

  const Z = new Float64Array(N);
  for (let i = 0; i < N; i++) Z[i] = (fpx * bodyM) / S.L[i];
  const Zs = filtfiltNaN(Z, 0.8, fs);
  const vz = derivative(Zs, fs);

  // --- foot contacts: a planted foot is stationary in the image -----------
  const state = {};
  const contacts = [];
  for (const side of ['L', 'R']) {
    const fx = meanSeries(S, FEET[side].pts, 'X');
    const fy = meanSeries(S, FEET[side].pts, 'Y');
    const dx = derivative(fx, fs), dy = derivative(fy, fs);
    const speedN = new Float64Array(N);
    for (let i = 0; i < N; i++) speedN[i] = Math.hypot(dx[i], dy[i]) / S.L[i];
    const st = footStates(speedN, fs);
    // Ignore "swings" that barely move the foot (tracking jitter, weight shifts).
    for (const r of runs(N, (i) => (st[i] === 1 ? 1 : 0), 1)) {
      const a = Math.max(0, r.start - 1), b = Math.min(N - 1, r.end + 1);
      const disp = Math.hypot(fx[b] - fx[a], fy[b] - fy[a]) / S.L[r.start];
      let peak = 0;
      for (let i = r.start; i <= r.end; i++) if (speedN[i] > peak) peak = speedN[i];
      if (!(disp >= 0.03 || peak >= 0.35)) for (let i = r.start; i <= r.end; i++) st[i] = 0;
    }
    // A brief pause with the foot still up in the air (top of a mostly
    // vertical lift) is not a landing: compare with the previous stance level.
    const stRuns = runs(N, (i) => st[i] + 2, 1);
    for (let k = 2; k < stRuns.length; k++) {
      const r = stRuns[k];
      if (r.key !== 2 || r.end - r.start + 1 > 0.2 * fs || stRuns[k - 1].key !== 3 || stRuns[k - 2].key !== 2) continue;
      const ref = median(Array.from(fy.subarray(stRuns[k - 2].start, stRuns[k - 2].end + 1)));
      let top = Infinity;
      for (let i = r.start; i <= r.end; i++) top = Math.min(top, fy[i]);
      if (ref - top > 0.025 * S.L[r.start]) for (let i = r.start; i <= r.end; i++) st[i] = 1;
    }
    state[side] = st;
    for (let i = 1; i < N; i++) if (st[i] === 0 && st[i - 1] === 1) contacts.push({ side, i, t: S.t[i] });
  }
  contacts.sort((a, b) => a.t - b.t);

  // --- walking phases (away / toward) and the turn ------------------------
  const minRun = Math.round(0.8 * fs);
  const phases = runs(N, (i) => (isNum(vz[i]) ? (vz[i] > 0.25 ? 1 : vz[i] < -0.25 ? -1 : 0) : 0), minRun)
    .map((r) => ({ ...r, dir: r.key > 0 ? 'away' : 'toward' }));

  let turn = null;
  // Usually away → turn → toward; toward → turn → away is handled too.
  for (let k = 0; k < phases.length - 1 && !turn; k++) {
    const first = phases[k];
    const second = phases.slice(k + 1).find((p) => p.dir !== first.dir);
    if (!second) continue;
    const sgn = first.dir === 'away' ? 1 : -1;
    const lo = Math.max(0, first.end - Math.round(fs)), hi = Math.min(N - 1, second.start + Math.round(fs));
    let iMax = lo;
    for (let i = lo; i <= hi; i++) if (sgn * Zs[i] > sgn * Zs[iMax]) iMax = i;
    const v1 = sgn * median(Array.from(vz.subarray(first.start, first.end + 1)));
    const v2 = -sgn * median(Array.from(vz.subarray(second.start, second.end + 1)));
    let i1 = iMax, i2 = iMax;
    // Turn = from when walking speed has dropped to half of steady speed
    // until it is back above half in the new direction.
    while (i1 > first.start && !(sgn * vz[i1] >= 0.5 * v1)) i1--;
    while (i2 < second.end && !(-sgn * vz[i2] >= 0.5 * v2)) i2++;
    // Confirm a real rotation: shoulders appear narrowest when side-on.
    const sw = (i) => Math.abs(X[11][i] - X[12][i]) / S.L[i];
    const swBase = median([...range(first.start, first.end), ...range(second.start, second.end)].map(sw));
    let swMin = Infinity;
    for (let i = Math.max(0, i1 - Math.round(0.5 * fs)); i <= Math.min(N - 1, i2 + Math.round(0.5 * fs)); i++) {
      const v = sw(i);
      if (isNum(v)) swMin = Math.min(swMin, v);
    }
    // Two "landings" within 0.12 s are one step seen twice (left/right
    // labels can swap while the feet overlap during a turn in place).
    const turnContacts = [];
    for (const c of contacts) {
      if (c.i < i1 || c.i > i2) continue;
      const prev = turnContacts[turnContacts.length - 1];
      if (prev && c.t - prev.t < 0.12) continue;
      turnContacts.push(c);
    }
    turn = {
      start: S.t[i1],
      end: S.t[i2],
      time: (i2 - i1) / fs,
      steps: turnContacts.length,
      contacts: turnContacts.map(({ side, t }) => ({ side, t })),
      distance: Zs[iMax],
      confident: swMin < 0.65 * swBase,
    };
  }

  // --- base width ----------------------------------------------------------
  // At each heel contact during straight walking the other foot is still
  // planted (double support). Convert both ankle positions to lateral
  // ground coordinates, placing the feet half a step in front of / behind
  // the body. The step is the body's progress since the other foot landed.
  const stepGuess = sideResult?.stepLength?.mean || 0.4 * Hm;
  const straight = (i) => phases.some((p) => i >= p.start && i <= p.end) &&
    !(turn && S.t[i] >= turn.start - 0.3 && S.t[i] <= turn.end + 0.3);
  const widths = [];
  for (const c of contacts) {
    if (!straight(c.i)) continue;
    const other = c.side === 'L' ? 'R' : 'L';
    if (state[other][c.i] !== 0) continue;
    const ph = phases.find((p) => c.i >= p.start && c.i <= p.end);
    const s = ph.dir === 'away' ? 1 : -1;
    const Zb = Zs[c.i];
    const prev = contacts.filter((o) => o.side === other && o.t < c.t && c.t - o.t < 1.5).pop();
    const dz = prev ? Math.abs(Zb - Zs[prev.i]) : NaN;
    const step = dz > 0.1 && dz < 0.6 * Hm ? dz : stepGuess;
    const zA = Zb + (s * step) / 2, zB = Zb - (s * step) / 2;
    const w2 = Math.round(0.08 * fs);
    const xA = (meanRange(X[FEET[c.side].ankle], c.i, c.i + w2) - cx) * zA / fpx;
    const xB = (meanRange(X[FEET[other].ankle], c.i, c.i + w2) - cx) * zB / fpx;
    const w = Math.abs(xA - xB);
    if (isNum(w) && w < 0.6) widths.push({ t: c.t, side: c.side, width: w, dir: ph.dir });
  }

  // --- approximate speed / cadence from the straight phases ---------------
  const phaseStats = [];
  for (const p of phases) {
    const cs = contacts.filter((c) => c.i >= p.start && c.i <= p.end && straight(c.i));
    if (cs.length < 3) continue;
    const a = cs[0], b = cs[cs.length - 1];
    const dt = b.t - a.t;
    phaseStats.push({ dir: p.dir, speed: Math.abs(Zs[b.i] - Zs[a.i]) / dt, cadence: (60 * (cs.length - 1)) / dt, duration: dt });
  }
  const wsum = phaseStats.reduce((s, p) => s + p.duration, 0);
  const speedEst = wsum ? phaseStats.reduce((s, p) => s + p.speed * p.duration, 0) / wsum : NaN;
  const cadence = wsum ? phaseStats.reduce((s, p) => s + p.cadence * p.duration, 0) / wsum : NaN;

  // Downsampled distance trace for the timeline chart.
  const step = Math.max(1, Math.round(fs / 10));
  const trace = [];
  for (let i = 0; i < N; i += step) if (isNum(Zs[i])) trace.push([+S.t[i].toFixed(3), +Zs[i].toFixed(3)]);

  const warnings = [];
  if (!phases.length) warnings.push('No walking toward or away from the camera was found.');
  if (!turn) warnings.push('No turn was found. Walk away from the camera, turn around and walk back, keeping the whole body in view.');
  else if (!turn.confident) warnings.push('The turn was detected from the walking direction only (the side-on body view was not clearly seen). Check the steps-to-turn count on the video.');
  if (widths.length && widths.length < 4) warnings.push(`Base width is based on only ${widths.length} steps.`);

  return {
    view: 'front',
    baseWidth: summary(widths.map((w) => w.width)),
    widths,
    turn,
    speedEst: { mean: speedEst, n: phaseStats.length },
    cadence,
    stepLengthEst: isNum(speedEst) && isNum(cadence) ? speedEst / (cadence / 60) : NaN,
    contacts: contacts.map(({ side, t }) => ({ side, t })),
    phases: phases.map((p) => ({ dir: p.dir, start: S.t[p.start], end: S.t[p.end] })),
    trace,
    quality: { fps: S.frameRate, detected: S.detectedFrames / Math.max(1, S.totalFrames), legSwaps: S.legSwaps, meanDistance: mean(Array.from(Zs)) },
    warnings,
  };
}

/**
 * Per-sample foot state from normalised image speed (body lengths / s):
 * 1 = moving (swing), 0 = planted (stance), -1 = unknown. Uses hysteresis
 * and removes runs shorter than 80 ms.
 */
function footStates(speedN, fs) {
  const N = speedN.length;
  const vOn = 0.2, vOff = 0.1;
  const st = new Int8Array(N);
  let s = -1;
  for (let i = 0; i < N; i++) {
    const v = speedN[i];
    if (!isNum(v)) { st[i] = -1; s = -1; continue; }
    if (s === -1) s = v > vOn ? 1 : 0;
    else if (s === 0 && v > vOn) s = 1;
    else if (s === 1 && v < vOff) s = 0;
    st[i] = s;
  }
  const minLen = Math.max(2, Math.round(0.08 * fs));
  for (const r of runs(N, (i) => st[i] + 2, 1)) {
    const len = r.end - r.start + 1;
    if (r.key === 1 || len >= minLen || r.start === 0) continue;
    const prev = st[r.start - 1];
    if (prev === -1) continue;
    for (let i = r.start; i <= r.end; i++) st[i] = prev;
  }
  return st;
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}
