// Per-frame signal extraction: how close is the body to the camera, how bent
// are the elbows, and how confident are we in the detection.

import { SCALE_PAIRS, bodyAnchor, dist, elbowAngle, isVisible, meanElbowAngle } from './landmarks.js';

/** Tunable detector thresholds. Stored per user so they can be adjusted live. */
export const DEFAULT_THRESHOLDS = {
  // Depth / fill
  targetRatio: 1.7,     // how much bigger the body must look to count as "bottom"
  fillStart: 0.12,      // fill above this starts a descent
  fillTarget: 0.72,     // fill above this means the body reached the bottom
  fillRelease: 0.42,    // fill below this means the body is extended again
  minCoverage: 0.03,    // below this the body is not really visible
  // Elbow geometry
  angleExtended: 155,   // deg: arms straight
  angleFlexed: 95,      // deg: deep enough at the bottom
  angleStart: 140,      // deg: leaving the extended position
  // Timing
  minRepMs: 900,
  maxRepMs: 15000,
  minConfidence: 0.5,
};

/** Exponential moving average, used to tame the noise of the detection. */
export class Ema {
  constructor(alpha = 0.35, initial = null) {
    this.alpha = alpha;
    this.value = initial;
  }
  push(v) {
    if (v === null || Number.isNaN(v)) return this.value;
    this.value = this.value === null ? v : this.value + this.alpha * (v - this.value);
    return this.value;
  }
  reset() { this.value = null; }
}

/**
 * Fraction of the frame covered by the body plus the centroid of the mask.
 * The mask is scanned with a stride to keep the cost low. The centroid is a
 * fallback anchor: in the "suelo" mode the shoulders leave the frame at the
 * bottom of the movement, just when the ring is needed the most.
 */
export function maskStats(mask) {
  if (!mask) return null;
  let data = null;
  try {
    data = mask.getAsFloat32Array?.();
  } catch { data = null; }
  if (!data) {
    try {
      data = mask.getAsUint8Array?.();
    } catch { data = null; }
  }
  if (!data || !data.length) return null;

  const stride = 2;
  let hits = 0;
  let samples = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < mask.height; y += stride) {
    for (let x = 0; x < mask.width; x += stride) {
      const v = data[y * mask.width + x];
      samples++;
      if (v > 0.5) {
        hits++;
        sumX += x;
        sumY += y;
      }
    }
  }
  if (!samples) return null;

  return {
    coverage: hits / samples,
    centroid: hits
      ? { x: (sumX / hits) / mask.width, y: (sumY / hits) / mask.height }
      : null,
  };
}

/** Fraction of the frame covered by the body, read from the segmentation mask. */
export function maskCoverage(mask) {
  return maskStats(mask)?.coverage ?? null;
}

/**
 * Normalised scale of the body: the largest ratio between a visible landmark
 * pair's current length and the length captured during calibration.
 */
export function scaleNorm(lms, calib) {
  if (!calib?.lengths) return null;
  let best = null;
  for (const pair of SCALE_PAIRS) {
    const a = lms[pair.a];
    const b = lms[pair.b];
    if (!isVisible(a) || !isVisible(b)) continue;
    const ref = calib.lengths[pair.name];
    if (!ref || ref < 1e-4) continue;
    const ratio = dist(a, b) / ref;
    if (best === null || ratio > best) best = ratio;
  }
  return best;
}

/**
 * Computes the full signal set for one frame.
 *
 * @param {object} frame   result of PoseEngine.detect()
 * @param {object} calib   calibration payload
 * @param {object} opts    thresholds, placement mode and the ema filters
 */
export function computeSignals(frame, calib, opts) {
  const th = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const lms = frame.landmarks;
  const depthMode = opts.mode === 'suelo';

  const stats = maskStats(frame.mask);
  const coverage = stats?.coverage ?? null;
  const smoothCoverage = opts.coverageEma.push(coverage);

  const scale = scaleNorm(lms, calib);
  const smoothScale = opts.scaleEma.push(scale);

  const angle = meanElbowAngle(lms);
  const smoothAngle = opts.angleEma.push(angle);
  const elbow = elbowAngle(lms, 'left') ?? elbowAngle(lms, 'right');

  // How much bigger does the body look compared to the calibrated position?
  const coverageRatio = smoothCoverage !== null && calib?.coverageRef > 0
    ? smoothCoverage / calib.coverageRef
    : null;
  // In "suelo" the body ends up so close that the shoulders leave the frame and
  // the landmark scale collapses right at the bottom. The segmentation mask
  // keeps growing, so it is the primary signal there and the scale is only the
  // fallback. In the lateral mode the old "biggest ratio wins" still applies.
  const rawRatio = depthMode
    ? coverageRatio ?? smoothScale ?? 1
    : Math.max(coverageRatio ?? 0, smoothScale ?? 0, 1);
  const fill = clamp01((rawRatio - 1) / (th.targetRatio - 1));
  // 0 at the extended position, 1 when the ring is completely full.
  const progress = clamp01(fill / (th.fillTarget || 1));

  const anchor = bodyAnchor(lms) ?? (depthMode ? stats?.centroid ?? null : null);
  const conf = frame.confidence ?? 0;
  const visible = (smoothCoverage ?? 0) >= th.minCoverage || (smoothScale ?? 0) > 1.02;

  return {
    fill,
    progress,
    rawRatio,
    coverage: smoothCoverage,
    scale: smoothScale,
    coverageRatio,
    elbow: smoothAngle,
    elbowRaw: elbow,
    angleAvailable: smoothAngle !== null,
    anchor,
    confidence: conf,
    visible,
    timestamp: frame.timestamp,
  };
}

export function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Creates a fresh set of smoothing filters. */
export function createFilters() {
  return {
    coverageEma: new Ema(0.3),
    scaleEma: new Ema(0.3),
    angleEma: new Ema(0.4),
  };
}
