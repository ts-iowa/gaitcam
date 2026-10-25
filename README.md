# GaitCam

A phone web app that measures gait from a single phone camera. It runs entirely in the browser on the phone (iOS Safari, Android Chrome); video is never uploaded.

**Measured parameters**

| Parameter | Test | How |
|---|---|---|
| Gait speed | Side walk | Pelvis displacement between the first and last heel strike of each pass ÷ time |
| Step length (L / R) | Side walk | Distance between consecutive heel-contact positions of opposite feet |
| Step height (L / R) | Side walk | Peak heel lift above floor level during swing (peak toe lift also reported) |
| Base width | Walk and turn | Side-to-side distance between the ankles at each foot contact (double support), corrected for depth |
| Steps to turn 180° | Walk and turn | Foot contacts between deceleration into and acceleration out of the turn; turn time also reported |

It also reports cadence, stride length, step time, per-step tables, a step-length chart, a walk-and-turn timeline, and a review video with the tracked skeleton and detected foot contacts. Steps to turn can be corrected by hand after watching the review video.

## How it works

1. **Pose tracking:** [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) (33 landmarks, including heel and toe) runs on the phone's GPU. The video is played back slowly and every frame is analysed; the playback rate adapts to the phone's speed.
2. **Cleaning:** landmarks are resampled to a uniform rate, left/right leg label swaps are corrected, and the data is low-pass filtered (6 Hz zero-phase Butterworth).
3. **Scaling:** pixels are converted to metres using the entered body height. The shoulder→hip→knee→ankle chain is ≈ 0.78 × standing height.
4. **Gait events:**
   - Side view: heel strike and toe-off use the Zeni et al. (2008) method (heel most forward / toe most backward relative to the pelvis).
   - Front view: a foot is planted when it stops moving in the image. Distance from the camera comes from apparent body size (pinhole model).

## Project layout

```
index.html            app shell (all screens)
css/app.css           styles (light + dark)
js/main.js            screens, navigation, recording/upload, processing flow
js/pose.js            MediaPipe loading and frame-by-frame video processing
js/camera.js          in-app camera, recording, live framing check
js/series.js          resampling, leg-swap fix, filtering, body-size scale
js/signal.js          filters, peaks, statistics
js/gait-side.js       side-walk analysis (speed, step length, step height)
js/gait-front.js      walk-and-turn analysis (base width, steps to turn)
js/report.js          results page, charts, review overlay, CSV/JSON export
js/storage.js         settings and history (localStorage)
sw.js                 offline cache (service worker)
test/index.html       analysis tests on a synthetic walker (open in a browser)
dev/serve.ps1         local static server for testing on Windows
```

There is no build step. All files are static.

## Publish on GitHub Pages

1. Create a GitHub repository and push this folder's contents to it (the `.claude/` and `dev/` folders are optional).
2. In the repository, open **Settings → Pages**, set **Source** to *Deploy from a branch*, pick `main` and `/ (root)`, and save.
3. After a minute the app is live at `https://<username>.github.io/<repository>/`. Open that link on the phone.
4. Optional: in the phone browser, use **Add to Home Screen** to install it like an app (works offline after the first load).

Camera access requires HTTPS, which GitHub Pages provides. The `.nojekyll` file stops GitHub from processing the files.

## Test locally

```bash
powershell -ExecutionPolicy Bypass -File dev/serve.ps1
```

Then open `http://localhost:8080/` (app) or `http://localhost:8080/test/` (analysis tests) on this computer. Phones on your network cannot use the camera over plain HTTP, so test on phones through the GitHub Pages URL.

## Recording tips

- Keep the phone **still** (tripod or propped up) at about hip height and level.
- **Side walk:** phone in landscape, 3–4 m from the walkway; start and stop 2 m outside the view; walk across and back 2–3 times.
- **Walk and turn:** phone upright at one end of the walkway; start 2 m in front of it, walk to a marker about 6 m away, turn around, and walk back.
- Whole body in view, one person, good light, fitted clothing.
- Do not use slow-motion videos (their timing is stretched).

## Limitations

- Distances depend on the entered height and on a fixed body proportion. Expect a few percent error. *Settings → Advanced → Distance calibration* can correct a systematic bias once checked against a measured walkway.
- Gait speed and step length shown on the walk-and-turn test alone are estimates that assume a standard 1× lens.
- Steps-to-turn can be off by one for very tight turns on the spot. Check it on the review video and adjust.
- Not validated against a clinical reference system yet. For research and clinical support only, not diagnosis.
