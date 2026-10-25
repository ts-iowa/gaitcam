// App controller: screens, navigation, recording/upload, processing and results.

import { loadPose, processVideo, MP_VERSION, delegateInUse } from './pose.js';
import { openCamera, closeCamera, startRecording, checkFraming, keepAwake } from './camera.js';
import { buildSeries } from './series.js';
import { analyzeSide } from './gait-side.js';
import { analyzeFront } from './gait-front.js';
import { renderReport, toCSV, toJSON, drawSkeleton, sideColors, heightText, turnSteps } from './report.js';
import { loadSettings, saveSettings, loadHistory, saveSession, deleteSession } from './storage.js';

const $ = (sel) => document.querySelector(sel);
const APP_VERSION = '1.0.0';

const state = {
  settings: loadSettings(),
  subject: null,
  clips: { side: null, front: null },
  session: null,
  runtime: null,
  modelReady: false,
  current: 'home',
  depth: 0,
  uploadFor: null,
  camera: { test: null, recorder: null, timer: 0, framing: 0, busy: false },
  abort: null,
};

// ---------------- navigation ----------------

function render(name) {
  const prev = state.current;
  if (prev === name) return;
  leave(prev);
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== `screen-${name}`; });
  state.current = name;
  const screen = $(`#screen-${name}`);
  $('#topbar-title').textContent = screen.dataset.title;
  document.querySelector('.topbar').hidden = name === 'camera';
  $('#btn-back').hidden = name === 'home';
  enter(name);
  window.scrollTo(0, 0);
}

function go(name) {
  history.pushState({ s: name }, '');
  state.depth++;
  render(name);
}

function goHome() {
  if (state.depth > 0) {
    const d = state.depth;
    state.depth = 0;
    history.go(-d);
  } else render('home');
}

window.addEventListener('popstate', (e) => {
  state.depth = Math.max(0, state.depth - 1);
  render(e.state?.s || 'home');
});

function leave(name) {
  if (name === 'camera') stopCamera();
  if (name === 'processing') state.abort?.abort();
}

function enter(name) {
  if (name === 'home') renderHistory();
  if (name === 'subject') fillSubjectForm();
  if (name === 'tests') refreshTests();
  if (name === 'camera') startCamera();
  if (name === 'results') showResults();
}

$('#btn-back').addEventListener('click', () => history.back());

// ---------------- toast ----------------

let toastTimer = 0;
function toast(msg, ms = 3500) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------------- model ----------------

function preloadModel() {
  const status = $('#model-status');
  status.textContent = 'Loading pose model…';
  state.modelReady = false;
  loadPose(state.settings.model)
    .then(() => {
      state.modelReady = true;
      status.textContent = `Pose model ready (${state.settings.model}, ${delegateInUse}).`;
    })
    .catch((err) => {
      console.error(err);
      status.textContent = 'Could not load the pose model. Check the internet connection (needed the first time).';
    });
}

// ---------------- home / history ----------------

function renderHistory() {
  const list = loadHistory();
  const ul = $('#history-list');
  ul.innerHTML = '';
  $('#history-empty').hidden = list.length > 0;
  for (const s of list) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    const parts = [];
    if (s.side?.speed?.mean) parts.push(`${s.side.speed.mean.toFixed(2)} m/s`);
    if (s.front?.turn) parts.push(`${turnSteps(s)} turn steps`);
    btn.innerHTML = `<span><span class="h-main"></span><br><span class="h-sub"></span></span><span class="h-del" role="button" aria-label="Delete">✕</span>`;
    btn.querySelector('.h-main').textContent = s.subject.id || 'Unnamed';
    btn.querySelector('.h-sub').textContent = `${new Date(s.date).toLocaleString()}${parts.length ? ' · ' + parts.join(' · ') : ''}`;
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.h-del')) {
        if (confirm('Delete this assessment from this browser?')) { deleteSession(s.id); renderHistory(); }
        return;
      }
      state.session = s;
      state.runtime = null;
      go('results');
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

$('#btn-new').addEventListener('click', () => {
  for (const k of ['side', 'front']) clearClip(k);
  state.session = null;
  state.runtime = null;
  go('subject');
});

// ---------------- subject ----------------

function fillSubjectForm() {
  const imperial = state.settings.units === 'imperial';
  $('#height-metric').hidden = imperial;
  $('#height-imperial').hidden = !imperial;
  $('#subject-error').hidden = true;
  const cm = state.subject?.heightCm;
  if (cm) {
    $('#height-cm').value = cm;
    const inches = cm / 2.54;
    $('#height-ft').value = Math.floor(inches / 12);
    $('#height-in').value = (inches - Math.floor(inches / 12) * 12).toFixed(1);
  }
}

$('#subject-form').addEventListener('submit', (e) => {
  e.preventDefault();
  let cm;
  if (state.settings.units === 'imperial') {
    const ft = Number($('#height-ft').value), inch = Number($('#height-in').value || 0);
    cm = Math.round((ft * 12 + inch) * 2.54 * 10) / 10;
  } else cm = Number($('#height-cm').value);
  if (!(cm >= 80 && cm <= 230)) {
    const err = $('#subject-error');
    err.textContent = 'Enter a height between 80 and 230 cm (2 ft 8 in – 7 ft 6 in).';
    err.hidden = false;
    return;
  }
  state.subject = { heightCm: cm, id: $('#subject-id').value.trim(), notes: $('#subject-notes').value.trim() };
  go('tests');
});

// ---------------- tests ----------------

function refreshTests() {
  for (const k of ['side', 'front']) {
    const cardEl = $(`#test-${k}`);
    const clip = state.clips[k];
    const badge = cardEl.querySelector('[data-role="status"]');
    const preview = cardEl.querySelector('[data-role="preview"]');
    badge.textContent = clip ? `Video ready${clip.duration ? ` · ${fmtDur(clip.duration)}` : ''}` : 'Not recorded';
    badge.classList.toggle('ready', !!clip);
    cardEl.querySelector('[data-action="clear"]').hidden = !clip;
    cardEl.querySelector('[data-action="record"]').textContent = clip ? 'Record again' : 'Record';
    preview.hidden = !clip;
    if (clip && preview.dataset.url !== clip.url) { preview.src = clip.url; preview.dataset.url = clip.url; }
  }
  $('#btn-analyze').disabled = !(state.clips.side || state.clips.front);
}

function fmtDur(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

function setClip(test, blob, source, duration) {
  clearClip(test);
  state.clips[test] = { blob, url: URL.createObjectURL(blob), source, duration };
  if (!duration) {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.src = state.clips[test].url;
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && state.clips[test]) { state.clips[test].duration = v.duration; refreshTests(); }
    };
  }
  refreshTests();
}

function clearClip(test) {
  const clip = state.clips[test];
  if (!clip) return;
  // Keep URLs alive if the current results' review player still uses them.
  if (!state.runtime || state.runtime[test]?.url !== clip.url) URL.revokeObjectURL(clip.url);
  state.clips[test] = null;
}

document.querySelectorAll('.test-card').forEach((cardEl) => {
  const test = cardEl.dataset.test;
  cardEl.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'record') { state.camera.test = test; go('camera'); }
    if (action === 'upload') { state.uploadFor = test; $('#file-input').value = ''; $('#file-input').click(); }
    if (action === 'clear') { clearClip(test); refreshTests(); }
  });
});

$('#file-input').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file || !state.uploadFor) return;
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v|3gp)$/i.test(file.name)) {
    toast('Please choose a video file.');
    return;
  }
  setClip(state.uploadFor, file, 'upload');
});

$('#btn-analyze').addEventListener('click', () => {
  go('processing');
  runAnalysis();
});

// ---------------- camera ----------------

async function startCamera() {
  const test = state.camera.test;
  const video = $('#camera-video');
  const pill = $('#framing-pill');
  $('#camera-guide').className = `camera-guide ${test}`;
  $('#camera-hint').textContent = test === 'side'
    ? 'Hold the phone sideways (landscape). Walkway runs across the view.'
    : 'Hold the phone upright. Walkway runs straight away from the camera.';
  $('#btn-rec').classList.remove('recording');
  $('#rec-timer').hidden = true;
  pill.hidden = false;
  pill.className = 'pill';
  pill.textContent = 'Starting camera…';
  try {
    await openCamera(video);
  } catch (err) {
    console.error(err);
    const denied = err?.name === 'NotAllowedError';
    toast(denied ? 'Camera permission was denied. Allow camera access in the browser settings, or use "Upload video".' : (err.message || 'Could not open the camera.'), 6000);
    history.back();
    return;
  }
  pill.textContent = state.modelReady ? 'Checking framing…' : 'Camera ready';
  clearInterval(state.camera.framing);
  state.camera.framing = setInterval(() => {
    if (state.camera.recorder || !state.modelReady || state.camera.busy || video.readyState < 2) return;
    state.camera.busy = true;
    try {
      const r = checkFraming(video, test);
      pill.textContent = r.message;
      pill.classList.toggle('ok', r.ok);
    } catch (err) {
      console.warn(err);
    } finally {
      state.camera.busy = false;
    }
  }, 350);
}

function stopCamera() {
  clearInterval(state.camera.framing);
  clearInterval(state.camera.timer);
  state.camera.recorder = null;
  closeCamera($('#camera-video'));
  keepAwake(false);
}

$('#btn-rec').addEventListener('click', async () => {
  const btn = $('#btn-rec');
  if (!state.camera.recorder) {
    try {
      state.camera.recorder = startRecording();
    } catch (err) {
      toast(err.message, 5000);
      return;
    }
    keepAwake(true);
    btn.classList.add('recording');
    btn.setAttribute('aria-label', 'Stop recording');
    $('#framing-pill').hidden = true;
    const timer = $('#rec-timer');
    timer.hidden = false;
    const t0 = Date.now();
    timer.textContent = '● 0:00';
    state.camera.timer = setInterval(() => { timer.textContent = `● ${fmtDur((Date.now() - t0) / 1000)}`; }, 500);
  } else {
    const rec = state.camera.recorder;
    state.camera.recorder = null;
    clearInterval(state.camera.timer);
    const { blob, duration } = await rec.stop();
    if (duration < 2 || blob.size < 1000) {
      toast('Recording too short. Try again.');
      btn.classList.remove('recording');
      $('#rec-timer').hidden = true;
      $('#framing-pill').hidden = false;
      return;
    }
    setClip(state.camera.test, blob, 'camera', duration);
    history.back();
  }
});

$('#btn-cam-cancel').addEventListener('click', () => history.back());

// ---------------- processing ----------------

async function runAnalysis() {
  const ac = new AbortController();
  state.abort = ac;
  const tests = ['side', 'front'].filter((k) => state.clips[k]);
  const bar = $('#proc-bar'), detail = $('#proc-detail'), title = $('#proc-title');
  const video = $('#proc-video'), overlay = $('#proc-overlay'), stage = $('#proc-stage');
  const octx = overlay.getContext('2d');
  const colors = sideColors();
  bar.style.width = '0%';
  stage.hidden = true;
  keepAwake(true);

  const results = {};
  const runtime = {};
  try {
    title.textContent = 'Loading pose model…';
    detail.textContent = 'First use downloads the model (about 10 MB). It is cached for offline use afterwards.';
    await loadPose(state.settings.model);
    state.modelReady = true;
    for (let ti = 0; ti < tests.length; ti++) {
      const test = tests[ti];
      const clip = state.clips[test];
      title.textContent = `Analysing ${test === 'side' ? 'side walk' : 'walk and turn'} (${ti + 1} of ${tests.length})`;
      detail.textContent = 'Tracking body landmarks…';
      video.src = clip.url;
      stage.hidden = false;
      let frames = 0;
      try {
        const raw = await processVideo(video, {
          signal: ac.signal,
          durationHint: clip.duration,
          onFrame: (t, lm, w, h) => {
            frames++;
            if (overlay.width !== w || overlay.height !== h) {
              overlay.width = w; overlay.height = h;
              stage.style.aspectRatio = `${w} / ${h}`;
              stage.style.width = `min(100%, calc(50vh * ${w / h}))`;
              stage.style.marginInline = 'auto';
            }
            octx.clearRect(0, 0, w, h);
            if (lm) drawSkeleton(octx, (k) => (lm[k * 4 + 3] > 0.3 ? [lm[k * 4], lm[k * 4 + 1]] : null), colors);
          },
          onProgress: (p) => {
            bar.style.width = `${(((ti + p) / tests.length) * 100).toFixed(1)}%`;
            detail.textContent = `Tracking body landmarks… ${Math.round(p * 100)}% (${frames} frames)`;
          },
        });
        detail.textContent = 'Calculating gait parameters…';
        await new Promise((r) => setTimeout(r, 30));
        const S = buildSeries(raw);
        results[test] = test === 'side'
          ? analyzeSide(S, state.subject, state.settings)
          : analyzeFront(S, state.subject, state.settings, results.side && !results.side.error ? results.side : null);
        runtime[test] = { S, url: clip.url };
      } catch (err) {
        if (err.name === 'AbortError' || ac.signal.aborted) throw err;
        console.error(err);
        results[test] = { error: err.message || String(err) };
      }
    }
  } catch (err) {
    keepAwake(false);
    video.removeAttribute('src');
    if (err.name === 'AbortError' || ac.signal.aborted) return;
    console.error(err);
    title.textContent = 'Analysis failed';
    detail.textContent = err.message || String(err);
    return;
  }
  keepAwake(false);
  video.pause();
  video.removeAttribute('src');
  video.load();

  state.session = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    date: new Date().toISOString(),
    appVersion: APP_VERSION,
    subject: state.subject,
    settings: { fovDeg: state.settings.fovDeg, scaleAdj: state.settings.scaleAdj, model: state.settings.model, mirrored: state.settings.mirrored },
    side: results.side || null,
    front: results.front || null,
    turnOverride: null,
  };
  state.runtime = runtime;
  if (!saveSession(state.session)) toast('Could not save to history (browser storage is full or disabled).');
  // Replace the processing entry so "back" from results returns to the tests.
  history.replaceState({ s: 'results' }, '');
  render('results');
}

$('#btn-proc-cancel').addEventListener('click', () => history.back());

// ---------------- results ----------------

function showResults() {
  if (!state.session) { goHome(); return; }
  renderReport($('#report'), state.session, state.settings, {
    runtime: state.runtime,
    onAdjustTurn: (n) => {
      state.session.turnOverride = n === state.session.front?.turn?.steps ? null : n;
      saveSession(state.session);
      showResults();
    },
  });
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const file = new File([blob], name, { type });
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: name }).catch(() => {});
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function baseName() {
  const s = state.session;
  const id = (s.subject.id || 'gait').replace(/[^\w-]+/g, '_').slice(0, 40);
  return `${id}_${s.date.slice(0, 16).replace(/[:T]/g, '-')}`;
}

$('#btn-export-csv').addEventListener('click', () => download(`${baseName()}.csv`, toCSV(state.session, state.settings), 'text/csv'));
$('#btn-export-json').addEventListener('click', () => download(`${baseName()}.json`, toJSON(state.session, state.runtime), 'application/json'));
$('#btn-print').addEventListener('click', () => window.print());
$('#btn-done').addEventListener('click', () => goHome());

// ---------------- settings ----------------

const dlg = $('#settings-dialog');
$('#btn-settings').addEventListener('click', () => {
  const s = state.settings;
  $('#set-units').value = s.units;
  $('#set-model').value = s.model;
  $('#set-fov').value = s.fovDeg;
  $('#set-scale').value = s.scaleAdj;
  $('#set-mirrored').checked = !!s.mirrored;
  $('#about-line').textContent = `GaitCam ${APP_VERSION} · MediaPipe Tasks Vision ${MP_VERSION}`;
  dlg.showModal();
});
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'save') return;
  const prevModel = state.settings.model;
  const num = (v, lo, hi, d) => (Number(v) >= lo && Number(v) <= hi ? Number(v) : d);
  state.settings = {
    units: $('#set-units').value,
    model: $('#set-model').value,
    fovDeg: num($('#set-fov').value, 30, 120, 67),
    scaleAdj: num($('#set-scale').value, 80, 120, 100),
    mirrored: $('#set-mirrored').checked,
  };
  saveSettings(state.settings);
  if (state.settings.model !== prevModel) preloadModel();
  if (state.current === 'subject') fillSubjectForm();
  if (state.current === 'results') showResults();
  toast('Settings saved');
});

// ---------------- boot ----------------

history.replaceState({ s: 'home' }, '');
renderHistory();
preloadModel();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered', err));
}
window.gaitcam = { state, heightText };
