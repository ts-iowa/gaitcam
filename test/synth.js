// Synthetic walker for testing the analysis: a 3D stick figure walks a known
// footfall sequence and is projected through a pinhole camera into fake
// BlazePose landmarks (with noise, label glitches and occlusion).
// World: X right, Y up, Z away from the camera. Camera at (0, camH, 0), level.

const smooth = (s) => s * s * (3 - 2 * s);
const lerp = (a, b, s) => a + (b - a) * s;
const lerpAng = (a, b, s) => a + (((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * s;
const dirOf = (h) => [Math.sin(h), Math.cos(h)];
const leftOf = (h) => [-Math.cos(h), Math.sin(h)];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Straight-line footfalls. Returns [{t, foot, x, z, h}] */
export function straightFootfalls({ t0, x0, z0, heading, stepLen, stepTime, n, width, firstFoot = 'L' }) {
  const [dx, dz] = dirOf(heading);
  const [lx, lz] = leftOf(heading);
  const out = [];
  for (let k = 0; k < n; k++) {
    const foot = (k % 2 === 0) === (firstFoot === 'L') ? 'L' : 'R';
    const s = foot === 'L' ? 1 : -1;
    out.push({ t: t0 + k * stepTime, foot, x: x0 + dx * k * stepLen + (lx * s * width) / 2, z: z0 + dz * k * stepLen + (lz * s * width) / 2, h: heading });
  }
  return out;
}

export function simulate(cfg) {
  const { footfalls, fps = 30, t0, t1, W, H, fovLongDeg = 67, camH = 1.0, heightM = 1.75, heelLift = 0.2, noisePx = 1.0, glitchRate = 0.01, flipWhen = null, seed = 1 } = cfg;
  const rand = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const f = Math.max(W, H) / 2 / Math.tan((fovLongDeg * Math.PI) / 360);
  const own = { L: footfalls.filter((p) => p.foot === 'L'), R: footfalls.filter((p) => p.foot === 'R') };
  const l1 = 0.245 * heightM, l2 = 0.246 * heightM;

  // pelvis keyframes: midpoint of each footfall and the previous opposite one
  const pk = [];
  for (let k = 1; k < footfalls.length; k++) {
    const a = footfalls[k - 1], b = footfalls[k];
    pk.push({ t: b.t, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, h: lerpAng(a.h, b.h, 0.5) });
  }
  const pelvisAt = (t) => {
    if (t <= pk[0].t) return pk[0];
    if (t >= pk[pk.length - 1].t) return pk[pk.length - 1];
    let k = 0;
    while (pk[k + 1].t < t) k++;
    const s = (t - pk[k].t) / (pk[k + 1].t - pk[k].t);
    return { x: lerp(pk[k].x, pk[k + 1].x, s), z: lerp(pk[k].z, pk[k + 1].z, s), h: lerpAng(pk[k].h, pk[k + 1].h, s) };
  };

  const footAt = (foot, t) => {
    const list = own[foot];
    let k = -1;
    for (let i = 0; i < list.length; i++) if (list[i].t <= t) k = i;
    if (k < 0) return { ...list[0], lift: 0 };
    const cur = list[k], next = list[k + 1];
    if (!next) return { ...cur, lift: 0 };
    const oppNext = footfalls.find((p) => p.foot !== foot && p.t > cur.t);
    const ds = 0.1 * (next.t - cur.t);
    const to = oppNext ? Math.min(oppNext.t + ds, next.t - 0.1) : cur.t;
    if (t < to) return { ...cur, lift: 0 };
    const s = (t - to) / (next.t - to);
    const ss = smooth(s);
    return { x: lerp(cur.x, next.x, ss), z: lerp(cur.z, next.z, ss), h: lerpAng(cur.h, next.h, ss), lift: heelLift * Math.sin(Math.PI * s) };
  };

  const frames = [];
  for (let t = t0; t <= t1 + 1e-9; t += 1 / fps) {
    const P = pelvisAt(t);
    const [dx, dz] = dirOf(P.h);
    const [lx, lz] = leftOf(P.h);
    const pts = new Array(33);
    const at = (x, y, z) => [x, y, z];
    const off = (side, lat, fwd, y) => at(P.x + lx * side * lat + dx * fwd, y, P.z + lz * side * lat + dz * fwd);
    pts[0] = off(0, 0, 0.1, 0.92 * heightM);
    for (let k = 1; k <= 10; k++) pts[k] = off(k % 2 ? 1 : -1, 0.03 * ((k % 5) + 1) / 5, 0.07, 0.93 * heightM);
    pts[11] = off(1, 0.19, 0.02, 0.818 * heightM);
    pts[12] = off(-1, 0.19, 0.02, 0.818 * heightM);
    const swing = 0.15 * Math.sin((2 * Math.PI * t) / 1.1);
    pts[13] = off(1, 0.21, -swing * 0.5, 0.63 * heightM);
    pts[14] = off(-1, 0.21, swing * 0.5, 0.63 * heightM);
    pts[15] = off(1, 0.21, -swing, 0.48 * heightM);
    pts[16] = off(-1, 0.21, swing, 0.48 * heightM);
    for (let k = 17; k <= 22; k++) pts[k] = pts[k % 2 ? 15 : 16];
    pts[23] = off(1, 0.09, 0, 0.52 * heightM);
    pts[24] = off(-1, 0.09, 0, 0.52 * heightM);
    for (const [foot, side, hip, knee, ank, heel, toe] of [['L', 1, 23, 25, 27, 29, 31], ['R', -1, 24, 26, 28, 30, 32]]) {
      const F = footAt(foot, t);
      const [fx, fz] = dirOf(F.h);
      pts[ank] = at(F.x, 0.08 + F.lift, F.z);
      pts[heel] = at(F.x - fx * 0.06, 0.03 + F.lift, F.z - fz * 0.06);
      pts[toe] = at(F.x + fx * 0.15, 0.02 + F.lift, F.z + fz * 0.15);
      // two-link IK for the knee, bending forward
      const Hp = pts[hip], A = pts[ank];
      const v = [A[0] - Hp[0], A[1] - Hp[1], A[2] - Hp[2]];
      const D = Math.hypot(...v);
      const u = v.map((c) => c / D);
      let n = [fx - u[0] * (fx * u[0] + fz * u[2]), -u[1] * (fx * u[0] + fz * u[2]), fz - u[2] * (fx * u[0] + fz * u[2])];
      const nl = Math.hypot(...n) || 1;
      n = n.map((c) => c / nl);
      const a = D >= l1 + l2 ? l1 : (l1 * l1 - l2 * l2 + D * D) / (2 * D);
      const hh = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      pts[knee] = [0, 1, 2].map((c) => Hp[c] + u[c] * a + n[c] * hh);
    }

    // project
    const lm = new Float32Array(132);
    const sideways = Math.abs(dx) > 0.7;
    let pelvisInView = true;
    for (let k = 0; k < 33; k++) {
      const [X, Y, Zw] = pts[k];
      const x = W / 2 + (f * X) / Zw + gauss() * noisePx;
      const y = H / 2 - (f * (Y - camH)) / Zw + gauss() * noisePx;
      let vis = 0.95;
      if (sideways && k >= 23 && Zw > P.z + 0.02) vis = 0.7;
      if (x < 0 || x > W || y < 0 || y > H) vis = 0.1;
      if ((k === 23 || k === 24) && (x < 0 || x > W)) pelvisInView = false;
      lm[k * 4] = x; lm[k * 4 + 1] = y; lm[k * 4 + 2] = Zw - P.z; lm[k * 4 + 3] = vis;
    }
    // occasional left/right leg label glitches, and systematic flips
    const flip = flipWhen?.(t, P) || false;
    const glitch = rand() < glitchRate;
    if (flip !== glitch) {
      for (let k = 11; k <= 32; k += 2) {
        for (let c = 0; c < 4; c++) {
          const tmp = lm[k * 4 + c]; lm[k * 4 + c] = lm[(k + 1) * 4 + c]; lm[(k + 1) * 4 + c] = tmp;
        }
      }
    }
    frames.push({ t: +t.toFixed(6), lm: pelvisInView ? lm : null });
  }
  return { frames, width: W, height: H, duration: t1 - t0 };
}

/** Side-walk scenario: two passes across the view, one in each direction. */
export function sideScenario({ stepLen = 0.68, stepTime = 0.55, width = 0.1, heelLift = 0.2, fps = 30, seed = 1 } = {}) {
  const z = 3.5;
  const n = Math.round(9 / stepLen);
  const pass1 = straightFootfalls({ t0: 0, x0: -4.5, z0: z, heading: Math.PI / 2, stepLen, stepTime, n, width });
  const tb = pass1[pass1.length - 1].t + 2.5;
  const pass2 = straightFootfalls({ t0: tb, x0: 4.5, z0: z, heading: -Math.PI / 2, stepLen, stepTime, n, width, firstFoot: 'R' });
  const a = simulate({ footfalls: pass1, fps, t0: 0, t1: pass1[pass1.length - 1].t, W: 1280, H: 720, camH: 0.95, heelLift, seed });
  const b = simulate({ footfalls: pass2, fps, t0: tb, t1: pass2[pass2.length - 1].t, W: 1280, H: 720, camH: 0.95, heelLift, seed: seed + 7 });
  // gap between passes: no person in view
  const gap = [];
  for (let t = a.frames[a.frames.length - 1].t + 1 / fps; t < tb; t += 1 / fps) gap.push({ t, lm: null });
  return { raw: { frames: [...a.frames, ...gap, ...b.frames], width: 1280, height: 720 }, expected: { speed: stepLen / stepTime, stepLength: stepLen, stepHeight: heelLift } };
}

/**
 * Repeated walk-and-turn in one recording: away, turn at the far marker,
 * back, turn at the start line, away again. `turns` lists the steps per turn.
 */
export function frontMultiScenario({ turns = [4, 5, 3], stepLen = 0.62, stepTime = 0.55, width = 0.1, xOff = 0.1, fps = 30, seed = 41 } = {}) {
  const all = [];
  let foot = 'L', t = 0, z = 2.2, heading = 0;
  const legSteps = 7;
  for (let leg = 0; leg <= turns.length; leg++) {
    const ff = straightFootfalls({ t0: t, x0: xOff, z0: z, heading, stepLen, stepTime, n: legSteps, width, firstFoot: foot });
    all.push(...ff);
    const last = ff[ff.length - 1];
    foot = last.foot === 'L' ? 'R' : 'L';
    t = last.t;
    if (leg === turns.length) break;
    const dz = heading === 0 ? 1 : -1;
    const cz = last.z + 0.3 * dz;
    for (let k = 1; k <= turns[leg]; k++) {
      const h = heading + (Math.PI * k) / turns[leg];
      const [lx, lz] = leftOf(h);
      const s = foot === 'L' ? 1 : -1;
      t += 0.6;
      all.push({ t, foot, x: xOff + (lx * s * width) / 2, z: cz + (lz * s * width) / 2, h });
      foot = foot === 'L' ? 'R' : 'L';
    }
    heading = heading === 0 ? Math.PI : 0;
    z = cz - stepLen * dz;
    t += stepTime;
  }
  const raw = simulate({ footfalls: all, fps, t0: 0, t1: all[all.length - 1].t + 0.5, W: 720, H: 1280, camH: 1.0, seed, flipWhen: (_t, P) => Math.cos(P.h) > 0.3 });
  return { raw, expected: { baseWidth: width, turns } };
}

/** Walk-and-turn scenario: away from camera, 180° turn in `turnSteps` steps, back. */
export function frontScenario({ stepLen = 0.62, stepTime = 0.55, width = 0.1, turnSteps = 4, xOff = 0.25, fps = 30, flipAway = true, seed = 3 } = {}) {
  const away = straightFootfalls({ t0: 0, x0: xOff, z0: 2.0, heading: 0, stepLen, stepTime, n: 8, width });
  const last = away[away.length - 1];
  const cz = last.z + 0.3;
  const turn = [];
  let foot = last.foot === 'L' ? 'R' : 'L';
  for (let k = 1; k <= turnSteps; k++) {
    const h = (Math.PI * k) / turnSteps;
    const [lx, lz] = leftOf(h);
    const s = foot === 'L' ? 1 : -1;
    turn.push({ t: last.t + k * 0.6, foot, x: xOff + (lx * s * width) / 2, z: cz + (lz * s * width) / 2, h });
    foot = foot === 'L' ? 'R' : 'L';
  }
  const tl = turn[turn.length - 1];
  const back = straightFootfalls({ t0: tl.t + stepTime, x0: xOff, z0: cz - stepLen, heading: Math.PI, stepLen, stepTime, n: 8, width, firstFoot: foot });
  const all = [...away, ...turn, ...back];
  const raw = simulate({
    footfalls: all, fps, t0: 0, t1: back[back.length - 1].t + 0.5, W: 720, H: 1280, camH: 1.0, seed,
    flipWhen: flipAway ? (_t, P) => Math.cos(P.h) > 0.3 : null,
  });
  return { raw, expected: { baseWidth: width, turnSteps, speed: stepLen / stepTime } };
}
