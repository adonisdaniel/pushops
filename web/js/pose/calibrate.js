// Calibration: capture the reference geometry while the user holds the
// extended position. Every later frame is compared against this reference.

import { SCALE_PAIRS, dist, isVisible, meanElbowAngle } from './landmarks.js';
import { maskCoverage } from './metrics.js';

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Runs the calibration countdown.
 *
 * @param {object}   opts
 * @param {function} opts.detect   () => frame | null
 * @param {number}   opts.durationMs
 * @param {string}   opts.mode
 * @param {function} opts.onTick    (secondsLeft, stats) => void
 */
export async function calibrate({ detect, durationMs = 3000, mode = 'suelo', onTick }) {
  const start = performance.now();
  const lengths = Object.fromEntries(SCALE_PAIRS.map((p) => [p.name, []]));
  const coverages = [];
  const angles = [];
  let last = performance.now();

  return new Promise((resolve, reject) => {
    function tick() {
      const now = performance.now();
      const elapsed = now - start;
      const remaining = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));

      const frame = detect();
      if (frame?.landmarks) {
        const lms = frame.landmarks;
        for (const pair of SCALE_PAIRS) {
          const a = lms[pair.a];
          const b = lms[pair.b];
          if (isVisible(a) && isVisible(b)) {
            lengths[pair.name].push(dist(a, b));
          }
        }
        const cov = maskCoverage(frame.mask);
        if (cov !== null) coverages.push(cov);
        const angle = meanElbowAngle(lms);
        if (angle !== null) angles.push(angle);
      }

      onTick?.(remaining, {
        samples: coverages.length,
        coverage: coverages.length ? median(coverages) : null,
        elbow: angles.length ? median(angles) : null,
      });

      if (elapsed >= durationMs) {
        const result = buildCalibration({ lengths, coverages, angles, mode, startedAt: start });
        if (!result) {
          reject(new Error('No se ha podido detectar el cuerpo. Coloca el teléfono en su sitio e inténtalo de nuevo.'));
          return;
        }
        resolve(result);
        return;
      }
      last = now;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

function buildCalibration({ lengths, coverages, angles, mode, startedAt }) {
  const refLengths = {};
  for (const [name, samples] of Object.entries(lengths)) {
    const m = median(samples);
    if (m !== null && m > 1e-3) refLengths[name] = m;
  }
  const coverageRef = median(coverages);
  const elbowRef = median(angles);

  if (!Object.keys(refLengths).length && coverageRef === null) {
    return null;
  }

  return {
    version: 1,
    mode,
    createdAt: Date.now(),
    elapsedMs: Math.round(performance.now() - startedAt),
    lengths: refLengths,
    coverageRef: coverageRef ?? 0,
    elbowRef: elbowRef ?? 0,
    // A reference angle lets the detector adapt to people with different
    // shoulder anatomy: the extended position is whatever it measured here.
    angleExtended: elbowRef && elbowRef > 120 ? Math.min(175, elbowRef + 8) : null,
  };
}

/** Sanity check on a stored calibration: is it still usable? */
export function isCalibrationValid(calib) {
  if (!calib || calib.version !== 1) return false;
  const hasLengths = calib.lengths && Object.keys(calib.lengths).length > 0;
  const hasCoverage = typeof calib.coverageRef === 'number' && calib.coverageRef > 0.005;
  return hasLengths || hasCoverage;
}
