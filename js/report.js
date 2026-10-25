// Results report: metric cards, charts, tables, video review overlay and
// CSV / JSON export.

import { isNum } from './signal.js';

// ---------- formatting ----------

export function makeFormat(units) {
  const imperial = units === 'imperial';
  return {
    speed(v) {
      if (!isNum(v)) return { v: '–', u: '' };
      return imperial ? { v: (v * 3.28084).toFixed(2), u: 'ft/s' } : { v: v.toFixed(2), u: 'm/s' };
    },
    /** lengths given in metres; shown in cm or inches */
    len(v, digits = 1) {
      if (!isNum(v)) return { v: '–', u: '' };
      return imperial ? { v: (v * 39.3701).toFixed(1), u: 'in' } : { v: (v * 100).toFixed(digits), u: 'cm' };
    },
    /** longer distances in m or ft */
    dist(v) {
      if (!isNum(v)) return { v: '–', u: '' };
      return imperial ? { v: (v * 3.28084).toFixed(1), u: 'ft' } : { v: v.toFixed(2), u: 'm' };
    },
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const txt = (f) => `${f.v}${f.u ? ' ' + f.u : ''}`;
const pm = (fmtFn, s) => (isNum(s?.sd) ? ` ± ${fmtFn(s.sd).v}` : '');

export function heightText(cm, units) {
  if (!isNum(cm)) return '';
  if (units !== 'imperial') return `${cm} cm`;
  const inches = cm / 2.54;
  const ft = Math.floor(inches / 12);
  return `${ft} ft ${(inches - ft * 12).toFixed(1)} in`;
}

/** Turn steps after any manual correction. */
export const turnSteps = (session) => session.turnOverride ?? session.front?.turn?.steps;

// ---------- report ----------

export function renderReport(root, session, settings, { onAdjustTurn, runtime } = {}) {
  const f = makeFormat(settings.units);
  const side = session.side && !session.side.error ? session.side : null;
  const front = session.front && !session.front.error ? session.front : null;
  const date = new Date(session.date);

  const cards = [];
  // Gait speed
  if (side && isNum(side.speed.mean)) {
    const s = f.speed(side.speed.mean);
    cards.push(card('Gait speed', s, `${side.speed.n} pass${side.speed.n === 1 ? '' : 'es'}${pm(f.speed, side.speed)}`));
  } else if (front && isNum(front.speedEst.mean)) {
    cards.push(card('Gait speed', f.speed(front.speedEst.mean), 'From walk-and-turn test', true));
  } else cards.push(na('Gait speed', 'Needs the side-walk test'));

  // Step length
  if (side && isNum(side.stepLength.mean)) {
    const sl = side.stepLength;
    cards.push(card('Step length', f.len(sl.mean, 0), `${lr(f.len(sl.L.mean, 0), f.len(sl.R.mean, 0))}<div>${sl.n} steps${pm((v) => f.len(v, 0), sl)}</div>`));
  } else if (front && isNum(front.stepLengthEst)) {
    cards.push(card('Step length', f.len(front.stepLengthEst, 0), 'From walk-and-turn test', true));
  } else cards.push(na('Step length', 'Needs the side-walk test'));

  // Step height
  if (side && isNum(side.stepHeight.heel.mean)) {
    const sh = side.stepHeight;
    cards.push(card('Step height', f.len(sh.heel.mean), `Peak heel lift in swing${lr(f.len(sh.heelL.mean), f.len(sh.heelR.mean))}<div>Peak toe lift ${txt(f.len(sh.toe.mean))}</div>`));
  } else cards.push(na('Step height', 'Needs the side-walk test'));

  // Base width
  if (front && isNum(front.baseWidth.mean)) {
    const bw = front.baseWidth;
    cards.push(card('Base width', f.len(bw.mean), `${bw.n} steps${pm(f.len, bw)}`));
  } else cards.push(na('Base width', 'Needs the walk-and-turn test'));

  // Steps to turn
  if (front?.turn) {
    const n = turnSteps(session);
    const adjusted = session.turnOverride != null && session.turnOverride !== front.turn.steps;
    cards.push(`<div class="metric wide">
      <span class="metric-label">Steps to turn 180°</span>
      <span class="metric-value">${n}<small>steps</small></span>
      <span class="metric-sub">Turn time ${front.turn.time.toFixed(1)} s${adjusted ? ` · adjusted (detected ${front.turn.steps})` : ''}</span>
      <div class="adjust no-print"><button class="btn" data-adj="-1" aria-label="One fewer step">−</button><button class="btn" data-adj="1" aria-label="One more step">+</button><span class="muted small">correct after checking the video</span></div>
    </div>`);
  } else cards.push(na('Steps to turn 180°', front ? 'No turn found in the video' : 'Needs the walk-and-turn test'));

  const warnings = [...(side?.warnings || []), ...(front?.warnings || [])];
  for (const [name, r] of [['Side walk', session.side], ['Walk and turn', session.front]]) {
    if (r?.error) warnings.unshift(`${name}: ${r.error}`);
  }

  root.innerHTML = `
    <div class="report-head">
      <h2>Gait assessment${session.subject.id ? ` · ${esc(session.subject.id)}` : ''}</h2>
      <p class="muted small">${esc(date.toLocaleString())} · Height ${esc(heightText(session.subject.heightCm, settings.units))}${session.subject.notes ? ` · ${esc(session.subject.notes)}` : ''}</p>
    </div>
    <div class="metrics">${cards.join('')}</div>
    ${warnings.length ? `<div class="card notes"><h3>Check these</h3><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    ${runtime && (runtime.side || runtime.front) ? reviewSection(runtime) : ''}
    ${side ? sideSection(side, f) : ''}
    ${front ? frontSection(front, f, session) : ''}
    ${moreSection(side, front, f)}
    <p class="muted small">Distances are scaled from the entered body height and are estimates. Values marked "estimate" use an assumed camera lens.</p>
  `;

  root.querySelectorAll('[data-adj]').forEach((b) => b.addEventListener('click', () => {
    const next = Math.max(0, turnSteps(session) + Number(b.dataset.adj));
    onAdjustTurn?.(next);
  }));
  if (runtime) wireReview(root, runtime, session);
}

function card(label, val, sub, estimate = false) {
  return `<div class="metric">
    <span class="metric-label">${label}${estimate ? ' <span class="est">estimate</span>' : ''}</span>
    <span class="metric-value">${val.v}<small>${val.u}</small></span>
    <span class="metric-sub">${sub}</span>
  </div>`;
}
function na(label, msg) {
  return `<div class="metric na"><span class="metric-label">${label}</span><span class="metric-value">Not measured</span><span class="metric-sub">${msg}</span></div>`;
}
function lr(l, r) {
  return `<div class="lr"><span class="l">L ${txt(l)}</span><span class="r">R ${txt(r)}</span></div>`;
}

// ---------- sections ----------

function sideSection(side, f) {
  const stepRows = side.steps.map((s, i) => `<tr><td>${i + 1}</td><td>${s.side}</td><td class="num">${s.t.toFixed(2)}</td><td class="num">${txt(f.len(s.length, 0))}</td><td class="num">${s.time.toFixed(2)} s</td></tr>`).join('');
  const swingRows = side.swings.map((s, i) => `<tr><td>${i + 1}</td><td>${s.side}${s.near ? '' : ' (far side)'}</td><td class="num">${s.t.toFixed(2)}</td><td class="num">${txt(f.len(s.heel))}</td><td class="num">${txt(f.len(s.toe))}</td></tr>`).join('');
  return `
    <div class="card">
      <h3>Step length, step by step</h3>
      ${side.steps.length ? stepChart(side.steps, f) : '<p class="muted">No steps measured.</p>'}
      <div class="chart-legend"><span class="lr"><span class="l">Left foot</span><span class="r">Right foot</span></span><span>Dashed line: mean</span></div>
      <details class="howto"><summary>Step table (${side.steps.length})</summary>
        <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Foot</th><th class="num">Time (s)</th><th class="num">Length</th><th class="num">Step time</th></tr></thead><tbody>${stepRows}</tbody></table></div>
      </details>
      <details class="howto"><summary>Step height table (${side.swings.length})</summary>
        <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Foot</th><th class="num">Time (s)</th><th class="num">Heel lift</th><th class="num">Toe lift</th></tr></thead><tbody>${swingRows}</tbody></table></div>
        <p class="muted small">The foot farther from the camera is partly hidden; the summary uses the near foot when there are enough near-side swings.</p>
      </details>
    </div>`;
}

function frontSection(front, f, session) {
  const widthRows = front.widths.map((w, i) => `<tr><td>${i + 1}</td><td>${w.side}</td><td>${w.dir}</td><td class="num">${w.t.toFixed(2)}</td><td class="num">${txt(f.len(w.width))}</td></tr>`).join('');
  return `
    <div class="card">
      <h3>Walk and turn timeline</h3>
      ${turnChart(front, f, session)}
      <div class="chart-legend"><span>Line: distance from camera</span><span class="lr"><span class="l">Left foot contact</span><span class="r">Right foot contact</span></span><span>Shaded: turn</span></div>
      <details class="howto"><summary>Base width table (${front.widths.length})</summary>
        <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Foot</th><th>Direction</th><th class="num">Time (s)</th><th class="num">Width</th></tr></thead><tbody>${widthRows}</tbody></table></div>
        <p class="muted small">Base width is the side-to-side distance between the two ankles at each foot contact, while both feet are on the ground.</p>
      </details>
    </div>`;
}

function moreSection(side, front, f) {
  const rows = [];
  if (side) {
    rows.push(['Cadence', isNum(side.cadence) ? `${side.cadence.toFixed(0)} steps/min` : '–']);
    rows.push(['Stride length', `${txt(f.len(side.strideLength.mean, 0))}${pm((v) => f.len(v, 0), side.strideLength)}`]);
    rows.push(['Step time', isNum(side.stepTime.mean) ? `${side.stepTime.mean.toFixed(2)} ± ${(side.stepTime.sd || 0).toFixed(2)} s` : '–']);
    rows.push(['Side-walk passes analysed', `${side.passes.length}`]);
    rows.push(['Side-walk video', `${side.quality.fps.toFixed(0)} fps · person found in ${(side.quality.detected * 100).toFixed(0)}% of frames`]);
  }
  if (front) {
    if (isNum(front.cadence)) rows.push(['Cadence (walk and turn)', `${front.cadence.toFixed(0)} steps/min`]);
    if (front.turn) rows.push(['Turn distance from camera', txt(f.dist(front.turn.distance))]);
    rows.push(['Walk-and-turn video', `${front.quality.fps.toFixed(0)} fps · person found in ${(front.quality.detected * 100).toFixed(0)}% of frames`]);
  }
  if (!rows.length) return '';
  return `<div class="card"><h3>Additional measures</h3><div class="table-wrap"><table class="data"><tbody>${rows.map(([k, v]) => `<tr><th>${k}</th><td class="num">${v}</td></tr>`).join('')}</tbody></table></div></div>`;
}

// ---------- charts (inline SVG) ----------

function stepChart(steps, f) {
  const W = 400, H = 190, pl = 34, pr = 10, pt = 24, pb = 26;
  const vals = steps.map((s) => Number(f.len(s.length, 1).v));
  const max = Math.max(...vals) * 1.15, min = 0;
  const x = (i) => pl + (steps.length === 1 ? (W - pl - pr) / 2 : (i * (W - pl - pr)) / (steps.length - 1));
  const y = (v) => pt + (1 - (v - min) / (max - min)) * (H - pt - pb);
  const ticks = niceTicks(min, max, 4);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const unit = f.len(1).u;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Step length for each step">
    ${ticks.map((t) => `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-label" x="${pl - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
    <text class="axis-label" x="4" y="12">${unit}</text>
    <line class="mean-line" x1="${pl}" x2="${W - pr}" y1="${y(mean)}" y2="${y(mean)}"/>
    ${steps.map((s, i) => `<circle class="dot-${s.side.toLowerCase()}" cx="${x(i)}" cy="${y(vals[i])}" r="5"><title>Step ${i + 1} (${s.side}): ${vals[i]} ${unit}</title></circle>`).join('')}
    <text class="axis-label" x="${(W + pl) / 2}" y="${H - 6}" text-anchor="middle">step number →</text>
  </svg>`;
}

function turnChart(front, f, session) {
  const W = 400, H = 220, pl = 34, pr = 10, pt = 24, pb = 56;
  const tr = front.trace;
  if (tr.length < 2) return '<p class="muted">Not enough data for a timeline.</p>';
  const t0 = tr[0][0], t1 = tr[tr.length - 1][0];
  const dists = tr.map((p) => Number(f.dist(p[1]).v));
  const max = Math.max(...dists) * 1.1;
  const x = (t) => pl + ((t - t0) / (t1 - t0)) * (W - pl - pr);
  const y = (v) => pt + (1 - v / max) * (H - pt - pb);
  const ticks = niceTicks(0, max, 4);
  const path = tr.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(dists[i]).toFixed(1)}`).join('');
  const rowL = H - pb + 18, rowR = H - pb + 32;
  const turn = front.turn;
  const tticks = niceTicks(0, t1 - t0, 6);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Distance from camera over time with foot contacts and the turn">
    ${turn ? `<rect class="turn-band" x="${x(turn.start)}" y="${pt}" width="${Math.max(2, x(turn.end) - x(turn.start))}" height="${H - pt - pb + 40}"/>
      <text class="label" x="${(x(turn.start) + x(turn.end)) / 2}" y="${H - pb - 6}" text-anchor="middle">turn: ${turnSteps(session)} steps</text>` : ''}
    ${ticks.map((t) => `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-label" x="${pl - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
    <text class="axis-label" x="4" y="12">${f.dist(1).u}</text>
    <path class="line" d="${path}"/>
    <text class="axis-label" x="${pl - 6}" y="${rowL + 4}" text-anchor="end">L</text>
    <text class="axis-label" x="${pl - 6}" y="${rowR + 4}" text-anchor="end">R</text>
    ${front.contacts.map((c) => { const yy = c.side === 'L' ? rowL : rowR; return `<line class="tick-${c.side.toLowerCase()}" x1="${x(c.t)}" x2="${x(c.t)}" y1="${yy - 5}" y2="${yy + 5}"><title>${c.side} contact at ${c.t.toFixed(2)} s</title></line>`; }).join('')}
    ${tticks.map((t) => `<text class="axis-label" x="${x(t0 + t)}" y="${H - 4}" text-anchor="middle">${t}s</text>`).join('')}
  </svg>`;
}

function niceTicks(min, max, count) {
  const span = max - min;
  if (!(span > 0)) return [min];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

// ---------- video review with skeleton overlay ----------

const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32]];
const LEFT = new Set([11, 13, 15, 23, 25, 27, 29, 31]);

export function drawSkeleton(ctx, getPt, colors) {
  ctx.lineWidth = Math.max(2, ctx.canvas.width / 320);
  for (const [a, b] of BONES) {
    const pa = getPt(a), pb = getPt(b);
    if (!pa || !pb) continue;
    ctx.strokeStyle = LEFT.has(a) && LEFT.has(b) ? colors.l : !LEFT.has(a) && !LEFT.has(b) ? colors.r : colors.c;
    ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
  }
  for (let k = 11; k <= 32; k++) {
    if (k > 16 && k < 23) continue;
    const p = getPt(k);
    if (!p) continue;
    ctx.fillStyle = LEFT.has(k) ? colors.l : colors.r;
    ctx.beginPath(); ctx.arc(p[0], p[1], ctx.lineWidth * 1.4, 0, Math.PI * 2); ctx.fill();
  }
}

export function sideColors() {
  const cs = getComputedStyle(document.documentElement);
  return { l: cs.getPropertyValue('--side-l').trim() || '#2a78d6', r: cs.getPropertyValue('--side-r').trim() || '#eb6834', c: '#ffffff' };
}

function reviewSection(runtime) {
  const tabs = ['side', 'front'].filter((k) => runtime[k]);
  return `<div class="card review-card">
    <h3>Review video</h3>
    <p class="muted small">Play or scrub to check the tracked skeleton and the detected foot contacts (rings).</p>
    ${tabs.length > 1 ? `<div class="tabs" role="tablist">${tabs.map((k, i) => `<button class="btn" role="tab" data-tab="${k}" aria-selected="${i === 0}">${k === 'side' ? 'Side walk' : 'Walk and turn'}</button>`).join('')}</div>` : ''}
    <div class="review" id="review-box"><video id="review-video" playsinline muted controls></video><canvas id="review-canvas"></canvas></div>
    <p class="small muted" id="review-caption"></p>
  </div>`;
}

function wireReview(root, runtime, session) {
  const video = root.querySelector('#review-video');
  if (!video) return;
  const canvas = root.querySelector('#review-canvas');
  const box = root.querySelector('#review-box');
  const caption = root.querySelector('#review-caption');
  const ctx = canvas.getContext('2d');
  const colors = sideColors();
  let current = null;
  let raf = 0;

  const select = (key) => {
    current = { key, ...runtime[key], analysis: session[key] };
    const { S } = current;
    canvas.width = S.width; canvas.height = S.height;
    box.style.aspectRatio = `${S.width} / ${S.height}`;
    box.style.width = `min(100%, calc(60vh * ${S.width / S.height}))`;
    box.style.margin = '0 auto';
    video.src = current.url;
    root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === key)));
    draw();
  };

  const contactsFor = (a) => {
    if (!a || a.error) return [];
    if (a.view === 'side') return a.events.filter((e) => e.type === 'HS');
    return a.contacts;
  };

  const draw = () => {
    if (!current) return;
    const { S, analysis } = current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t = video.currentTime;
    const i = Math.round((t - S.t[0]) * S.fs);
    let text = '';
    if (i >= 0 && i < S.N) {
      const pt = (k) => (isNum(S.X[k][i]) ? [S.X[k][i], S.Y[k][i]] : null);
      drawSkeleton(ctx, pt, colors);
      for (const c of contactsFor(analysis)) {
        if (Math.abs(c.t - t) > 0.15) continue;
        const k = (c.track ?? c.side) === 'L' ? 29 : 30; // track = landmark label in S
        const ci = Math.round((c.t - S.t[0]) * S.fs);
        if (ci < 0 || ci >= S.N || !isNum(S.X[k][ci])) continue;
        ctx.strokeStyle = c.side === 'L' ? colors.l : colors.r;
        ctx.lineWidth = Math.max(3, canvas.width / 200);
        ctx.beginPath(); ctx.arc(S.X[k][ci], S.Y[k][ci], canvas.width / 40, 0, Math.PI * 2); ctx.stroke();
      }
      const turn = analysis?.turn;
      if (turn && t >= turn.start && t <= turn.end) {
        const done = turn.contacts.filter((c) => c.t <= t).length;
        text = `Turning: step ${done} of ${turn.steps}`;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        const fs = Math.round(canvas.width / 22);
        ctx.font = `600 ${fs}px system-ui, sans-serif`;
        ctx.fillRect(0, 0, canvas.width, fs * 1.8);
        ctx.fillStyle = '#fff';
        ctx.fillText(text, fs * 0.5, fs * 1.25);
      }
    }
    caption.textContent = `${t.toFixed(2)} s${text ? ' · ' + text : ''}`;
  };

  const loop = () => { draw(); if (!video.paused) raf = requestAnimationFrame(loop); };
  video.addEventListener('play', () => { cancelAnimationFrame(raf); loop(); });
  video.addEventListener('seeked', draw);
  video.addEventListener('timeupdate', () => { if (video.paused) draw(); });
  video.addEventListener('loadeddata', draw);
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => select(b.dataset.tab)));
  select(runtime.side ? 'side' : 'front');
}

// ---------- export ----------

export function toCSV(session, settings) {
  const side = session.side && !session.side.error ? session.side : null;
  const front = session.front && !session.front.error ? session.front : null;
  const rows = [['section', 'parameter', 'value', 'sd', 'n', 'unit', 'note']];
  const r = (...a) => rows.push(a.map((v) => (isNum(v) ? +v.toFixed(4) : v ?? '')));
  r('subject', 'id', session.subject.id || '');
  r('subject', 'height', session.subject.heightCm, '', '', 'cm');
  r('subject', 'date', new Date(session.date).toISOString());
  if (side) {
    r('summary', 'gait_speed', side.speed.mean, side.speed.sd, side.speed.n, 'm/s', 'side walk');
    r('summary', 'step_length', side.stepLength.mean, side.stepLength.sd, side.stepLength.n, 'm');
    r('summary', 'step_length_left', side.stepLength.L.mean, side.stepLength.L.sd, side.stepLength.L.n, 'm');
    r('summary', 'step_length_right', side.stepLength.R.mean, side.stepLength.R.sd, side.stepLength.R.n, 'm');
    r('summary', 'step_height_heel', side.stepHeight.heel.mean, '', side.stepHeight.heel.n, 'm', 'peak heel lift in swing');
    r('summary', 'step_height_heel_left', side.stepHeight.heelL.mean, side.stepHeight.heelL.sd, side.stepHeight.heelL.n, 'm');
    r('summary', 'step_height_heel_right', side.stepHeight.heelR.mean, side.stepHeight.heelR.sd, side.stepHeight.heelR.n, 'm');
    r('summary', 'step_height_toe', side.stepHeight.toe.mean, '', side.stepHeight.toe.n, 'm', 'peak toe lift in swing');
    r('summary', 'stride_length', side.strideLength.mean, side.strideLength.sd, side.strideLength.n, 'm');
    r('summary', 'cadence', side.cadence, '', '', 'steps/min');
  }
  if (front) {
    r('summary', 'base_width', front.baseWidth.mean, front.baseWidth.sd, front.baseWidth.n, 'm');
    if (front.turn) {
      r('summary', 'steps_to_turn', turnSteps(session), '', '', 'steps', session.turnOverride != null ? `manually adjusted (detected ${front.turn.steps})` : '');
      r('summary', 'turn_time', front.turn.time, '', '', 's');
    }
    if (!side) {
      r('summary', 'gait_speed_estimate', front.speedEst.mean, '', front.speedEst.n, 'm/s', 'walk-and-turn; assumes lens field of view');
      r('summary', 'step_length_estimate', front.stepLengthEst, '', '', 'm', 'walk-and-turn; assumes lens field of view');
    }
  }
  side?.steps.forEach((s, i) => r('step', `step_${i + 1}_${s.side}`, s.length, '', '', 'm', `t=${s.t.toFixed(3)}s step_time=${s.time.toFixed(3)}s`));
  side?.swings.forEach((s, i) => r('swing', `swing_${i + 1}_${s.side}`, s.heel, '', '', 'm', `heel lift; toe=${isNum(s.toe) ? s.toe.toFixed(3) : ''}; t=${s.t.toFixed(3)}s${s.near ? '' : '; far side'}`));
  front?.widths.forEach((w, i) => r('base_width', `contact_${i + 1}_${w.side}`, w.width, '', '', 'm', `t=${w.t.toFixed(3)}s ${w.dir}`));
  return rows.map((row) => row.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');
}

/** Session plus key landmark tracks (for re-analysis or troubleshooting). */
export function toJSON(session, runtime) {
  const out = { app: 'GaitCam', version: 1, session };
  if (runtime) {
    out.tracks = {};
    const keep = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
    for (const k of ['side', 'front']) {
      const S = runtime[k]?.S;
      if (!S) continue;
      const round = (arr) => Array.from(arr, (v) => (isNum(v) ? Math.round(v * 10) / 10 : null));
      out.tracks[k] = {
        fs: S.fs, t0: S.t[0], width: S.width, height: S.height,
        landmarks: Object.fromEntries(keep.map((i) => [i, { x: round(S.X[i]), y: round(S.Y[i]) }])),
      };
    }
  }
  return JSON.stringify(out);
}
