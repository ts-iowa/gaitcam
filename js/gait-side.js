// Side-walk test (camera perpendicular to the walkway).
// Measures gait speed, step length and step height (heel / toe clearance).
//
// Gait events use the Zeni et al. (2008) method adapted to 2D video:
// heel strike = heel most anterior relative to the pelvis,
// toe off = toe most posterior relative to the pelvis.

import { isNum, filtfiltNaN, derivative, findPeaks, subsample, meanRange, median, mean, summary } from './signal.js';
import { BODY_FRAC, bodyLengthPx, midSeries, runs } from './series.js';

const TRACKS = {
  L: { heel: 29, toe: 31, ankle: 27, knee: 25 },
  R: { heel: 30, toe: 32, ankle: 28, knee: 26 },
};
const KEY = [11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

export function analyzeSide(S, subject, settings = {}) {
  const { fs, N, X, Y, V, width: W, height: H } = S;
  const Hm = (subject.heightCm / 100) * ((settings.scaleAdj || 100) / 100);
  const Lmid = bodyLengthPx(S, 'mean');
  const px2m = new Float64Array(N);
  for (let i = 0; i < N; i++) px2m[i] = (BODY_FRAC * Hm) / Lmid[i];

  const pelX = midSeries(S, 23, 24, 'X');
  const pelXs = filtfiltNaN(pelX, 1.0, fs);
  const vPx = derivative(pelXs, fs);
  const vel = new Float64Array(N);
  for (let i = 0; i < N; i++) vel[i] = vPx[i] * px2m[i];

  const margin = 0.015 * W;
  const inFrame = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    inFrame[i] = isNum(px2m[i]) && KEY.every((k) => {
      const x = X[k][i], y = Y[k][i];
      return isNum(x) && x > margin && x < W - margin && y > 0 && y < H * 0.995;
    }) ? 1 : 0;
  }

  const minSeg = Math.round(1.0 * fs);
  const segs = runs(N, (i) => (inFrame[i] && Math.abs(vel[i]) > 0.15 ? Math.sign(vel[i]) : 0), minSeg);

  const passes = [];
  const steps = [];
  const strides = [];
  const swings = [];
  const events = [];

  for (const seg of segs) {
    const dir = seg.key; // +1: moving toward image right
    const { start: s, end: e } = seg;
    const Lmed = median(Array.from(S.L.subarray(s, e + 1)));

    // Which leg is nearer the camera? The far leg is partly hidden, so the
    // model reports lower visibility for it. Walking toward image-right
    // shows the person's right side (unless the video is mirrored).
    const vis = (tr) => mean([tr.heel, tr.toe, tr.ankle, tr.knee].flatMap((k) => Array.from(V[k].subarray(s, e + 1))));
    const visL = vis(TRACKS.L), visR = vis(TRACKS.R);
    let anatNear = dir > 0 ? 'R' : 'L';
    if (settings.mirrored) anatNear = anatNear === 'R' ? 'L' : 'R';
    let sideOf = { L: 'L', R: 'R' };
    if (Math.abs(visL - visR) >= 0.03) {
      const nearTrack = visL > visR ? 'L' : 'R';
      if (nearTrack !== anatNear) sideOf = { L: 'R', R: 'L' };
    }

    const segEvents = [];
    for (const tk of ['L', 'R']) {
      const tr = TRACKS[tk];
      const relHeel = new Float64Array(N).fill(NaN);
      const relToe = new Float64Array(N).fill(NaN);
      for (let i = s; i <= e; i++) {
        relHeel[i] = dir * (X[tr.heel][i] - pelX[i]);
        relToe[i] = -dir * (X[tr.toe][i] - pelX[i]);
      }
      const opts = { minDist: Math.round(0.4 * fs), minProm: 0.08 * Lmed, lo: s, hi: e };
      for (const i of findPeaks(relHeel, opts)) {
        if (i < s + 2 || i > e - 2) continue;
        segEvents.push({ type: 'HS', track: tk, side: sideOf[tk], i, t: S.t[i] + subsample(relHeel, i) / fs });
      }
      for (const i of findPeaks(relToe, opts)) {
        if (i < s + 2 || i > e - 2) continue;
        segEvents.push({ type: 'TO', track: tk, side: sideOf[tk], i, t: S.t[i] + subsample(relToe, i) / fs });
      }
    }
    segEvents.sort((a, b) => a.t - b.t);
    events.push(...segEvents);

    const hs = segEvents.filter((ev) => ev.type === 'HS');
    const footfallX = (ev) => meanRange(X[TRACKS[ev.track].heel], ev.i, Math.min(e, ev.i + Math.round(0.1 * fs)));

    // Steps: consecutive heel strikes of opposite feet.
    for (let k = 1; k < hs.length; k++) {
      const a = hs[k - 1], b = hs[k];
      if (a.track === b.track) continue;
      const dt = b.t - a.t;
      if (dt < 0.2 || dt > 1.6) continue;
      const scale = (px2m[a.i] + px2m[b.i]) / 2;
      const len = dir * (footfallX(b) - footfallX(a)) * scale;
      if (!(len > 0.05 && len < 0.75 * Hm)) continue;
      steps.push({ t: b.t, side: b.side, length: len, time: dt, pass: passes.length });
    }
    // Strides: consecutive heel strikes of the same foot.
    for (const tk of ['L', 'R']) {
      const own = hs.filter((ev) => ev.track === tk);
      for (let k = 1; k < own.length; k++) {
        const a = own[k - 1], b = own[k];
        const dt = b.t - a.t;
        if (dt < 0.5 || dt > 3) continue;
        const len = dir * (footfallX(b) - footfallX(a)) * (px2m[a.i] + px2m[b.i]) / 2;
        if (len > 0.1 && len < 1.5 * Hm) strides.push({ t: b.t, side: b.side, length: len, time: dt });
      }
    }
    // Step height: peak heel and toe lift during each swing (toe off → heel strike).
    for (const to of segEvents.filter((ev) => ev.type === 'TO')) {
      const next = hs.find((ev) => ev.track === to.track && ev.t > to.t);
      if (!next || next.t - to.t < 0.15 || next.t - to.t > 1.2) continue;
      const tr = TRACKS[to.track];
      // Floor level: lowest image position of heel / toe just after landing
      // (the detected heel strike can precede full contact by a frame or two).
      const floorHeel = maxRange(Y[tr.heel], next.i, Math.min(e, next.i + Math.round(0.2 * fs)));
      const floorToe = maxRange(Y[tr.toe], Math.min(e, next.i + Math.round(0.05 * fs)), Math.min(e, next.i + Math.round(0.35 * fs)));
      let heel = -Infinity, toe = -Infinity;
      for (let i = to.i; i <= next.i; i++) {
        const sc = px2m[i];
        heel = Math.max(heel, (floorHeel - Y[tr.heel][i]) * sc);
        toe = Math.max(toe, (floorToe - Y[tr.toe][i]) * sc);
      }
      if (isNum(heel) && heel > 0 && heel < 0.5 * Hm) {
        swings.push({ t: to.t, side: to.side, heel, toe: isNum(toe) ? Math.max(0, toe) : NaN, near: to.side === anatNear, pass: passes.length });
      }
    }

    // Gait speed over whole steps (first to last heel strike) to cancel the
    // within-stride speed oscillation.
    let speed = NaN, duration = (e - s) / fs;
    if (hs.length >= 2) {
      const a = hs[0], b = hs[hs.length - 1];
      duration = b.t - a.t;
      const sc = mean(Array.from(px2m.subarray(a.i, b.i + 1)));
      speed = Math.abs(pelX[b.i] - pelX[a.i]) * sc / duration;
    } else {
      speed = mean(Array.from(vel.subarray(s, e + 1)).map(Math.abs));
    }
    passes.push({ start: S.t[s], end: S.t[e], dir, nearSide: anatNear, speed, duration, heelStrikes: hs.length });
  }

  const usable = passes.filter((p) => isNum(p.speed) && p.duration > 0.4);
  const wsum = usable.reduce((acc, p) => acc + p.duration, 0);
  const speed = wsum ? usable.reduce((acc, p) => acc + p.speed * p.duration, 0) / wsum : NaN;

  const bySide = (arr, side, key, filter = () => true) => summary(arr.filter((x) => x.side === side && filter(x)).map((x) => x[key]));
  // Prefer the near foot (fully visible) for clearance; fall back to all swings.
  const clearance = (side, key) => {
    const near = swings.filter((x) => x.side === side && x.near);
    return summary((near.length >= 2 ? near : swings.filter((x) => x.side === side)).map((x) => x[key]));
  };
  const heelL = clearance('L', 'heel'), heelR = clearance('R', 'heel');
  const toeL = clearance('L', 'toe'), toeR = clearance('R', 'toe');

  const stepTimes = steps.map((x) => x.time);
  const warnings = [];
  if (!passes.length) warnings.push('No walking pass was found. The person must cross the camera view with the whole body visible.');
  if (steps.length && steps.length < 6) warnings.push(`Only ${steps.length} steps were measured. Record 2–3 passes for more reliable results.`);
  if (!passes.some((p) => p.dir > 0) || !passes.some((p) => p.dir < 0)) {
    if (passes.length) warnings.push('Only one walking direction was recorded, so one leg was always on the far side of the camera. Walk across and back for balanced left/right values.');
  }
  if (S.frameRate < 24) warnings.push(`Low effective frame rate (${S.frameRate.toFixed(0)} fps). Timing precision is reduced.`);

  return {
    view: 'side',
    speed: { mean: speed, sd: summary(usable.map((p) => p.speed)).sd, n: usable.length },
    stepLength: { ...summary(steps.map((x) => x.length)), L: bySide(steps, 'L', 'length'), R: bySide(steps, 'R', 'length') },
    strideLength: summary(strides.map((x) => x.length)),
    stepHeight: { heel: combine(heelL, heelR), heelL, heelR, toe: combine(toeL, toeR), toeL, toeR },
    cadence: stepTimes.length ? 60 / mean(stepTimes) : NaN,
    stepTime: summary(stepTimes),
    passes,
    steps,
    swings,
    events: events.map(({ type, side, track, t }) => ({ type, side, track, t })),
    quality: { fps: S.frameRate, detected: S.detectedFrames / Math.max(1, S.totalFrames), legSwaps: S.legSwaps },
    warnings,
  };
}

function maxRange(x, a, b) {
  let m = NaN;
  for (let i = a; i <= b; i++) if (isNum(x[i]) && !(x[i] <= m)) m = x[i];
  return m;
}

/** Average of the two sides' means (equal weight), with pooled n. */
function combine(a, b) {
  const means = [a.mean, b.mean].filter(isNum);
  return { mean: means.length ? means.reduce((s, v) => s + v, 0) / means.length : NaN, n: a.n + b.n };
}
