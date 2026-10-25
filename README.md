# GaitCam

**Measure gait with one phone camera, right in the browser.**

### ▶ Open the app: **[ts-iowa.github.io/gaitcam](https://ts-iowa.github.io/gaitcam/)**

Works in Safari (iPhone/iPad) and Chrome (Android). No install or account needed. Video is processed **on the phone** and never uploaded.

---

## What it measures

| Parameter | Test | Typical range (healthy adults) |
|---|---|---|
| **Gait speed** | Side walk | Age- and sex-specific (e.g. women 70–79: 0.93–1.38 m/s) |
| **Step length** (left / right) | Side walk | ≈ 0.37–0.47 × height (shorter with age)* |
| **Step height** (peak heel lift) | Side walk | ≈ 0.10–0.18 × height* |
| **Base width** | Walk and turn | 5–14 cm |
| **Steps to turn 180°** | Walk and turn | ≤ 4 steps |

The app also reports cadence, stride length, step time, left/right step symmetry and turn time.

Each result is shown next to its typical range and marked **✓ Typical**, **▼ Below typical** or **▲ Above typical**, so values outside the usual range stand out. Ranges marked * are approximate (see [Reference ranges](#reference-ranges)).

## How to use it

1. Open **[ts-iowa.github.io/gaitcam](https://ts-iowa.github.io/gaitcam/)** on the phone. Optionally tap **Share → Add to Home Screen** to install it; it then works offline.
2. Tap **Start a new assessment** and enter height (required). Age and sex are optional but recommended, because they give age-specific ranges.
3. Record or upload one or both tests. The phone must be **held still** (tripod, or propped on a shelf or chair) at about hip height.
4. Tap **Analyse** and keep the screen open while the video is processed (slower than real time).
5. Review the results, check the skeleton overlay on the video, and export as **CSV**, **JSON** or **Print / PDF**.

### Test 1: Side walk (speed, step length, step height)

- Phone **sideways (landscape)**, 3–4 m from a straight walkway of about 8 m, pointing straight at it.
- Start walking about 2 m before the camera view so the person is at a steady pace while in view.
- **Do 3–4 passes in one recording.** A *pass* is one walk all the way across the view. Walk across, keep going about 2 m past the view, turn around **out of view**, and walk back. Each pass adds 4–6 measured steps and balances the left/right values.

### Test 2: Walk and turn (base width, steps to turn)

- Phone **upright (portrait)** at one end of the walkway, pointing along it.
- Mark a start line about 2 m from the phone and a far marker about 6 m from the phone.
- Walk from the start line to the marker, **turn around (180°)**, and walk back.
- **Optional: repeat for 2–3 turns in one recording.** Turn again at the start line and walk back out. Every turn is measured and averaged.
- Walk toward the middle of the view and keep the whole body, including the feet, in view.

**Tips:** good lighting, only one person in view, fitted clothing (loose trousers or long skirts hide the legs), usual footwear, and no slow-motion video.

## Reference ranges

| Parameter | Typical range used | Source |
|---|---|---|
| Gait speed | Mean for age decade and sex, −0.2 to +0.25 m/s | Bohannon & Andrews, *Physiotherapy* 2011 (meta-analysis of normal walking speed) |
| Gait speed thresholds | < 1.0 m/s: higher fall risk; < 0.8 m/s: limited community walking | Widely used clinical cut-offs |
| Step length | 0.37–0.47 × height (age < 60), 0.33–0.45 (60–79), 0.28–0.42 (80+) | Approximate, from healthy-adult gait data |
| Step height | 0.10–0.18 × height (peak heel lift in swing) | Approximate; limited published data for video |
| Base width | 5–14 cm | ≈ 10 ± 4 cm in community-dwelling adults (*Sci Rep* 2018;8:13193) |
| Steps to turn 180° | ≤ 4 steps | TURN 180 test: > 4 steps prompts balance / fall-risk assessment |
| Step length symmetry | Longer ÷ shorter side ≤ 1.10 | Common symmetry threshold |
| Cadence | 100–125 steps/min | Typical comfortable adult cadence |

Typical ranges describe healthy adults walking at a comfortable speed. A value outside the range is a prompt to look closer, **not a diagnosis**.

## Accuracy and limitations

- Distances are scaled from the entered height using standard body proportions, so expect a few percent error. *Settings → Advanced → Distance calibration* corrects a consistent bias once checked against a measured walkway.
- If only the walk-and-turn test is done, gait speed and step length are shown as **estimates** (they assume a standard 1× lens).
- Steps to turn can be off by one for very tight turns on the spot. Check it on the review video and correct it with the − / + buttons.
- Not yet validated against a clinical reference system (instrumented walkway or motion capture). For research and clinical support only.

## How it works

1. **Pose tracking:** [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) finds 33 body landmarks, including heels and toes, on every video frame, using the phone's GPU.
2. **Cleaning:** landmarks are resampled to a uniform rate, left/right leg label swaps are corrected, and the data is low-pass filtered (6 Hz, zero-phase Butterworth).
3. **Scaling:** the shoulder→hip→knee→ankle chain is ≈ 0.78 × standing height, which converts pixels to metres.
4. **Gait events:**
   - Side view: heel strike and toe-off use the Zeni et al. (2008) method, adapted to video.
   - Front view: a foot is planted when it stops moving in the image. Distance from the camera comes from apparent body size.

## For developers

No build step: plain HTML, CSS and JavaScript modules.

```
index.html          app shell (all screens)
css/app.css         styles (light and dark)
js/main.js          screens, navigation, recording/upload, processing flow
js/pose.js          MediaPipe loading and frame-by-frame video processing
js/camera.js        in-app camera, recording, live framing check
js/series.js        resampling, leg-swap correction, filtering, body scale
js/signal.js        filters, peak finding, statistics
js/gait-side.js     side-walk analysis
js/gait-front.js    walk-and-turn analysis
js/norms.js         reference ranges and flags
js/report.js        results page, charts, review overlay, CSV/JSON export
js/storage.js       settings and history (browser storage only)
sw.js               offline cache
test/               analysis tests on a synthetic walker
dev/serve.ps1       local test server (Windows)
```

- **Run locally:** `powershell -ExecutionPolicy Bypass -File dev/serve.ps1`, then open `http://localhost:8080/`.
- **Analysis tests:** open [ts-iowa.github.io/gaitcam/test](https://ts-iowa.github.io/gaitcam/test/) (or `/test/` locally).
- **Deploy:** push to `main`; GitHub Pages republishes the site within about a minute.

---

*For research and clinical support only. Not a medical device and not a diagnosis.*
