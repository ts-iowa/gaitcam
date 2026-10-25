// In-app camera: rear-camera preview, recording with MediaRecorder, and a
// lightweight live framing check (is the whole body in view?).

import { detect } from './pose.js';

let stream = null;

export async function openCamera(videoEl) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera access is not available in this browser. Use "Upload video" instead.');
  }
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 60, max: 60 },
    },
  });
  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.playsInline = true;
  await videoEl.play();
  const s = stream.getVideoTracks()[0]?.getSettings?.() || {};
  return { width: s.width, height: s.height, frameRate: s.frameRate };
}

export function closeCamera(videoEl) {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (videoEl) videoEl.srcObject = null;
}

function pickMime() {
  const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

/** Start recording; returns { stop(): Promise<{blob, duration}> }. */
export function startRecording() {
  if (!stream) throw new Error('Camera is not open.');
  if (!window.MediaRecorder) throw new Error('Recording is not supported in this browser. Use "Upload video" instead.');
  const mimeType = pickMime();
  const rec = new MediaRecorder(stream, { ...(mimeType && { mimeType }), videoBitsPerSecond: 10_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const started = performance.now();
  rec.start(1000);
  return {
    stop: () => new Promise((resolve) => {
      rec.onstop = () => resolve({
        blob: new Blob(chunks, { type: rec.mimeType || mimeType || 'video/mp4' }),
        duration: (performance.now() - started) / 1000,
      });
      rec.stop();
    }),
  };
}

/**
 * Check framing on one preview frame. Returns { ok, message }.
 * Requires the pose model to be loaded.
 */
export function checkFraming(videoEl, test) {
  const lms = detect(videoEl, performance.now());
  if (!lms) return { ok: false, message: 'No person detected' };
  const need = { head: [0], shoulders: [11, 12], hips: [23, 24], knees: [25, 26], feet: [27, 28, 29, 30, 31, 32] };
  const inView = (p) => p.visibility > 0.5 && p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.99;
  for (const [part, idx] of Object.entries(need)) {
    if (!idx.some((k) => inView(lms[k]))) {
      if (part === 'feet') return { ok: false, message: 'Feet not in view: tilt down or move the phone back' };
      if (part === 'head') return { ok: false, message: 'Head not in view: tilt up or move the phone back' };
      return { ok: false, message: `Whole body not in view (${part})` };
    }
  }
  const ys = lms.map((p) => p.y);
  const frac = Math.max(...ys) - Math.min(...ys);
  if (test === 'side' && frac < 0.35) return { ok: true, message: 'Whole body visible. Person looks small: move the phone closer if you can' };
  return { ok: true, message: 'Whole body visible ✓' };
}

/** Keep the screen awake while recording or processing (where supported). */
let wakeLock = null;
export async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* not supported or denied */ }
}
