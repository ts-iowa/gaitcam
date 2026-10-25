// MediaPipe Pose Landmarker wrapper: model loading and frame-by-frame
// processing of a recorded or uploaded video, entirely on the device.

export const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL = (name) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${name}/float16/1/pose_landmarker_${name}.task`;

let vision = null;
let mp = null;
let landmarker = null;
let loadedModel = null;
let loading = null;
let lastTs = 0;
export let delegateInUse = null;

/** Load (or reuse) the pose model. `model` is 'lite' | 'full' | 'heavy'. */
export function loadPose(model = 'full') {
  if (landmarker && loadedModel === model) return Promise.resolve(landmarker);
  if (loading && loading.model === model) return loading.promise;
  const promise = (async () => {
    mp ??= await import(`${MP_BASE}/vision_bundle.mjs`);
    vision ??= await mp.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    if (landmarker) { landmarker.close(); landmarker = null; }
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL(model), delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
    try {
      landmarker = await mp.PoseLandmarker.createFromOptions(vision, opts('GPU'));
      delegateInUse = 'GPU';
    } catch (err) {
      console.warn('GPU delegate unavailable, using CPU', err);
      landmarker = await mp.PoseLandmarker.createFromOptions(vision, opts('CPU'));
      delegateInUse = 'CPU';
    }
    loadedModel = model;
    return landmarker;
  })();
  loading = { model, promise };
  promise.catch(() => { loading = null; });
  return promise;
}

/** Run detection on one image source. Timestamps must strictly increase. */
export function detect(source, tMs) {
  const ts = Math.max(lastTs + 1, Math.round(tMs));
  lastTs = ts;
  const res = landmarker.detectForVideo(source, ts);
  return res?.landmarks?.[0] || null;
}

/** Pack normalised landmarks into [x_px, y_px, z, visibility] × 33. */
function pack(lms, w, h) {
  if (!lms) return null;
  const out = new Float32Array(33 * 4);
  for (let k = 0; k < 33; k++) {
    const p = lms[k];
    out[k * 4] = p.x * w;
    out[k * 4 + 1] = p.y * h;
    out[k * 4 + 2] = p.z;
    out[k * 4 + 3] = p.visibility ?? 1;
  }
  return out;
}

/**
 * Process every frame of a video.
 * @param video  an HTMLVideoElement already in the DOM with `src` set
 * @param opts   { onFrame(t, lmPacked, w, h), onProgress(fraction), signal, durationHint }
 * @returns {frames, width, height, duration}
 */
export async function processVideo(video, { onFrame, onProgress, signal, durationHint, maxSide = 1280 } = {}) {
  await waitFor(video, 'loadedmetadata', () => video.readyState >= 1);
  let duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) duration = await probeDuration(video, durationHint);
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) throw new Error('Could not read this video. Try recording in the app or a different file.');
  const k = Math.min(1, maxSide / Math.max(vw, vh));
  const w = Math.round(vw * k), h = Math.round(vh * k);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });

  // Separate videos get separated timestamps so the tracker starts fresh.
  const offset = lastTs + 10000;
  const frames = [];
  const handle = (t) => {
    ctx.drawImage(video, 0, 0, w, h);
    const lm = pack(detect(canvas, offset + t * 1000), w, h);
    frames.push({ t, lm });
    onFrame?.(t, lm, w, h);
    onProgress?.(Math.min(1, t / duration));
  };

  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    await processByPlayback(video, handle, signal);
  } else {
    await processBySeeking(video, handle, duration, signal);
  }
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  return { frames, width: w, height: h, duration };
}

/**
 * Play the video slowly and analyse each presented frame. The playback rate
 * adapts so that processing keeps up and few frames are skipped.
 */
function processByPlayback(video, handle, signal) {
  return new Promise((resolve, reject) => {
    let lastMedia = -1;
    let procMs = 60;
    let frameDt = 1 / 30;
    const diffs = [];
    let count = 0;
    let finished = false;
    const finish = (err) => {
      if (finished) return;
      finished = true;
      video.pause();
      video.removeEventListener('ended', onEnded);
      err ? reject(err) : resolve();
    };
    const onEnded = () => finish();
    const onFrameCb = (_now, meta) => {
      if (finished) return;
      if (signal?.aborted) return finish();
      const t = meta.mediaTime;
      if (t > lastMedia) {
        const t0 = performance.now();
        try { handle(t); } catch (err) { return finish(err); }
        const dtp = performance.now() - t0;
        procMs = procMs * 0.8 + dtp * 0.2;
        if (lastMedia >= 0) {
          diffs.push(t - lastMedia);
          if (diffs.length > 40) diffs.shift();
          const sorted = diffs.slice().sort((a, b) => a - b);
          frameDt = Math.max(1 / 120, sorted[Math.floor(sorted.length * 0.1)]);
        }
        lastMedia = t;
        if (++count % 8 === 0) {
          const rate = Math.max(0.0625, Math.min(1, (frameDt * 1000) / (procMs * 1.4 + 8)));
          if (Math.abs(rate - video.playbackRate) / video.playbackRate > 0.15) video.playbackRate = rate;
        }
      }
      video.requestVideoFrameCallback(onFrameCb);
    };
    video.addEventListener('ended', onEnded);
    video.muted = true;
    video.currentTime = 0;
    video.playbackRate = 0.25;
    video.requestVideoFrameCallback(onFrameCb);
    video.play().catch(finish);
  });
}

/** Fallback for browsers without requestVideoFrameCallback: seek at 30 Hz. */
async function processBySeeking(video, handle, duration, signal) {
  const dt = 1 / 30;
  for (let t = 0; t < duration; t += dt) {
    if (signal?.aborted) return;
    video.currentTime = t;
    await waitFor(video, 'seeked');
    handle(t);
  }
}

function waitFor(el, event, already = () => false) {
  if (already()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error('This video format cannot be played in this browser.')); };
    const cleanup = () => { el.removeEventListener(event, ok); el.removeEventListener('error', bad); };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}

/** WebM files from MediaRecorder often report Infinity duration. */
async function probeDuration(video, hint) {
  if (hint) return hint;
  video.currentTime = 1e7;
  await waitFor(video, 'durationchange', () => Number.isFinite(video.duration));
  const d = video.duration;
  video.currentTime = 0;
  return Number.isFinite(d) ? d : 30;
}
