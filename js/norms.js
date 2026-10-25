// Reference ("typical") ranges for healthy adults, used to flag values that
// fall outside the usual range. These are descriptive comparisons, not a
// diagnosis. Ranges marked approximate rest on limited published data.

import { isNum } from './signal.js';

// Comfortable gait speed (m/s) by decade and sex.
// Bohannon RW, Williams Andrews A. Normal walking speed: a descriptive meta-analysis.
// Physiotherapy 2011;97:182-189.
const SPEED = [
  { lo: 20, hi: 29, M: 1.36, F: 1.34 },
  { lo: 30, hi: 39, M: 1.43, F: 1.34 },
  { lo: 40, hi: 49, M: 1.43, F: 1.39 },
  { lo: 50, hi: 59, M: 1.43, F: 1.31 },
  { lo: 60, hi: 69, M: 1.34, F: 1.24 },
  { lo: 70, hi: 79, M: 1.26, F: 1.13 },
  { lo: 80, hi: 120, M: 0.97, F: 0.94 },
];

export const SOURCES = {
  speed: 'Bohannon & Williams Andrews 2011, normal walking speed meta-analysis (age- and sex-specific means; typical range ≈ mean −0.2 to +0.25 m/s).',
  speedRisk: 'Below 1.0 m/s is linked to higher risk of falls and other adverse outcomes; below 0.8 m/s is typical of limited community walking.',
  stepLength: 'Approximate: healthy adult step length ≈ 0.37–0.47 × height, shorter with age.',
  stepHeight: 'Approximate: peak heel lift in swing ≈ 0.10–0.18 × height in healthy adults at comfortable speed (limited published data for video).',
  baseWidth: 'Step width ≈ 10 ± 4 cm in community-dwelling adults (e.g. Sci Rep 2018;8:13193). Typical range used: 5–14 cm.',
  turnSteps: 'TURN 180 test: more than 4 steps to turn 180° is a common trigger for further balance / fall-risk assessment.',
  symmetry: 'Left/right step length usually differs by less than 10%.',
  cadence: 'Comfortable cadence in adults is usually about 100–125 steps/min.',
};

const sexLabel = (sex) => (sex === 'M' ? 'men' : sex === 'F' ? 'women' : 'adults');

/**
 * Reference ranges for a subject {heightCm, age?, sex?: 'F'|'M'|''}.
 * Each range: {lo, hi, unit:'m'|'m/s'|'steps'|..., label, approx?}.
 */
export function referenceRanges(subject) {
  const H = subject.heightCm / 100;
  const age = Number(subject.age);
  const hasAge = isNum(age) && age >= 18;
  const sex = subject.sex === 'M' || subject.sex === 'F' ? subject.sex : '';
  const ranges = {};

  // Gait speed
  if (hasAge) {
    const row = SPEED.find((r) => age >= r.lo && age <= r.hi) || (age < 20 ? SPEED[0] : SPEED[SPEED.length - 1]);
    const m = sex ? row[sex] : (row.M + row.F) / 2;
    ranges.speed = { lo: m - 0.2, hi: m + 0.25, mean: m, label: `${sexLabel(sex)} ${row.lo}–${row.hi === 120 ? '99' : row.hi}`, source: 'speed' };
  } else {
    ranges.speed = { lo: 1.0, hi: 1.6, label: 'adults (enter age for an age-specific range)', source: 'speed' };
  }

  // Step length, scaled by height, with an age adjustment.
  const [kLo, kHi] = !hasAge ? [0.33, 0.47] : age < 60 ? [0.37, 0.47] : age < 80 ? [0.33, 0.45] : [0.28, 0.42];
  ranges.stepLength = { lo: kLo * H, hi: kHi * H, label: `for height${hasAge ? ` and age ${age}` : ''}`, approx: true, source: 'stepLength' };
  ranges.strideLength = { lo: 2 * kLo * H, hi: 2 * kHi * H, label: 'twice step length', approx: true, source: 'stepLength' };

  ranges.stepHeight = { lo: 0.1 * H, hi: 0.18 * H, label: 'for height', approx: true, source: 'stepHeight' };
  ranges.baseWidth = { lo: 0.05, hi: 0.14, label: 'adults', source: 'baseWidth' };
  ranges.turnSteps = { lo: 1, hi: 4, label: 'adults', source: 'turnSteps' };
  ranges.cadence = { lo: 100, hi: 125, label: 'adults', source: 'cadence' };
  ranges.stepSymmetry = { lo: 1, hi: 1.1, label: 'longer ÷ shorter side', source: 'symmetry' };
  return ranges;
}

/** 'low' | 'normal' | 'high' | null (no value or no range). */
export function classify(value, range) {
  if (!isNum(value) || !range) return null;
  if (isNum(range.lo) && value < range.lo) return 'low';
  if (isNum(range.hi) && value > range.hi) return 'high';
  return 'normal';
}
