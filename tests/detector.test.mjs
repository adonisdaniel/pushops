// Tests of the detection core. They run without a browser or a phone:
//   node --test tests/
//
// The synthetic frames mimic what MediaPipe returns for a body that starts
// extended, comes down towards the camera and goes back up.

import test from 'node:test';
import assert from 'node:assert/strict';

import { angleAt, bodyAnchor, dist, elbowAngle, meanElbowAngle } from '../web/js/pose/landmarks.js';
import { computeSignals, createFilters, DEFAULT_THRESHOLDS, maskCoverage } from '../web/js/pose/metrics.js';
import { RepCounter } from '../web/js/pose/repCounter.js';

const LM = {
  NOSE: 0, LEFT_EYE: 2, RIGHT_EYE: 5, LEFT_EAR: 7, RIGHT_EAR: 8,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12, LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16, LEFT_HIP: 23, RIGHT_HIP: 24,
};

/** Builds a landmark array where every point is visible by default. */
function makeLandmarks(overrides = {}) {
  const lms = [];
  for (let i = 0; i < 33; i++) {
    lms.push({ x: 0.5, y: 0.5, z: 0, visibility: 1 });
  }
  const set = (i, x, y) => { lms[i] = { x, y, z: 0, visibility: 1 }; };
  set(LM.NOSE, 0.5, 0.2);
  set(LM.LEFT_EYE, 0.47, 0.2);
  set(LM.RIGHT_EYE, 0.53, 0.2);
  set(LM.LEFT_EAR, 0.45, 0.2);
  set(LM.RIGHT_EAR, 0.55, 0.2);
  set(LM.LEFT_SHOULDER, 0.4, 0.5);
  set(LM.RIGHT_SHOULDER, 0.6, 0.5);
  set(LM.LEFT_ELBOW, 0.4, 0.6);
  set(LM.RIGHT_ELBOW, 0.6, 0.6);
  set(LM.LEFT_WRIST, 0.4, 0.7);
  set(LM.RIGHT_WRIST, 0.6, 0.7);
  set(LM.LEFT_HIP, 0.42, 0.7);
  set(LM.RIGHT_HIP, 0.58, 0.7);
  for (const [i, value] of Object.entries(overrides)) {
    lms[Number(i)] = { ...lms[Number(i)], ...value };
  }
  return lms;
}

/* ----------------------------- landmarks ----------------------------- */

test('angleAt computes the elbow angle of a straight arm', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 1, y: 0 };
  const c = { x: 2, y: 0 };
  assert.equal(Math.round(angleAt(a, b, c)), 180);
});

test('angleAt computes a right angle', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 1, y: 0 };
  const c = { x: 1, y: 1 };
  assert.equal(Math.round(angleAt(a, b, c)), 90);
});

test('elbowAngle returns null when the arm is not visible', () => {
  const lms = makeLandmarks({ [LM.LEFT_WRIST]: { visibility: 0.1 } });
  assert.equal(elbowAngle(lms, 'left'), null);
});

test('meanElbowAngle falls back to the visible side', () => {
  const lms = makeLandmarks({ [LM.RIGHT_WRIST]: { visibility: 0.1 } });
  const angle = meanElbowAngle(lms);
  assert.ok(angle !== null);
});

test('bodyAnchor prefers the shoulders', () => {
  const anchor = bodyAnchor(makeLandmarks());
  assert.equal(anchor.x, 0.5);
  assert.equal(anchor.y, 0.5);
});

test('dist measures the distance between two points', () => {
  assert.equal(dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

/* ------------------------------ metrics ------------------------------ */

test('maskCoverage measures the fraction of covered pixels', () => {
  const mask = {
    width: 4,
    height: 4,
    getAsFloat32Array: () => new Float32Array([
      1, 1, 0, 0,
      1, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]),
  };
  const coverage = maskCoverage(mask);
  assert.ok(coverage > 0 && coverage < 1, `coverage was ${coverage}`);
});

test('maskCoverage returns null without a mask', () => {
  assert.equal(maskCoverage(null), null);
});

test('computeSignals turns a bigger body into a higher fill', () => {
  const calib = { lengths: { shoulders: 0.2 }, coverageRef: 0.2 };
  const filters = createFilters();

  const far = {
    landmarks: makeLandmarks(),
    confidence: 0.9,
    timestamp: 0,
    mask: { width: 2, height: 2, getAsFloat32Array: () => new Float32Array([0, 0, 0, 0]) },
  };
  const near = {
    landmarks: makeLandmarks({
      [LM.LEFT_SHOULDER]: { x: 0.3 },
      [LM.RIGHT_SHOULDER]: { x: 0.7 },
    }),
    confidence: 0.9,
    timestamp: 100,
    mask: { width: 2, height: 2, getAsFloat32Array: () => new Float32Array([1, 1, 1, 1]) },
  };

  const s1 = computeSignals(far, calib, { thresholds: DEFAULT_THRESHOLDS, ...filters });
  const s2 = computeSignals(near, calib, { thresholds: DEFAULT_THRESHOLDS, ...filters });

  assert.ok(s1.fill < 0.2, `fill at the top was ${s1.fill}`);
  assert.ok(s2.fill > s1.fill, `fill at the bottom was ${s2.fill}`);
  assert.ok(s2.fill <= 1);
});

/* --------------------------- rep counter ---------------------------- */

function signal({ fill = 0, elbow = null, t = 0, conf = 0.9 }) {
  return {
    fill,
    elbow,
    elbowRaw: elbow,
    angleAvailable: elbow !== null,
    coverage: 0.2,
    confidence: conf,
    visible: true,
    timestamp: t,
  };
}

test('a full down-up cycle counts as a valid repetition', () => {
  const reps = [];
  const counter = new RepCounter({ onRep: (e) => reps.push(e) });

  // Extended, then descending, then at the bottom, then back up.
  counter.push(signal({ fill: 0.05, elbow: 168, t: 0 }));
  counter.push(signal({ fill: 0.3, elbow: 140, t: 500 }));
  counter.push(signal({ fill: 0.8, elbow: 60, t: 1200 }));
  counter.push(signal({ fill: 0.6, elbow: 90, t: 1800 }));
  counter.push(signal({ fill: 0.05, elbow: 168, t: 2400 }));

  assert.equal(reps.length, 1, 'expected exactly one repetition');
  assert.equal(reps[0].ok, true, `repetition rejected: ${reps[0].reasons}`);
  assert.equal(counter.counts.valid, 1);
});

test('a shallow repetition is rejected', () => {
  const reps = [];
  const counter = new RepCounter({ onRep: (e) => reps.push(e) });

  counter.push(signal({ fill: 0.05, elbow: 168, t: 0 }));
  counter.push(signal({ fill: 0.2, elbow: 150, t: 500 }));
  counter.push(signal({ fill: 0.3, elbow: 140, t: 1200 }));
  counter.push(signal({ fill: 0.05, elbow: 168, t: 2000 }));

  assert.equal(reps.length, 1);
  assert.equal(reps[0].ok, false);
  assert.ok(reps[0].reasons.length > 0);
  assert.equal(counter.counts.invalid, 1);
});

test('depth mode counts a repetition without elbow angles', () => {
  const reps = [];
  const counter = new RepCounter({ onRep: (e) => reps.push(e) });

  counter.push(signal({ fill: 0.02, t: 0 }));
  counter.push(signal({ fill: 0.4, t: 600 }));
  counter.push(signal({ fill: 0.9, t: 1400 }));
  counter.push(signal({ fill: 0.5, t: 2000 }));
  counter.push(signal({ fill: 0.03, t: 2600 }));

  assert.equal(reps.length, 1);
  assert.equal(reps[0].ok, true, `repetition rejected: ${reps[0].reasons}`);
});

test('a repetition that is too fast is rejected', () => {
  const reps = [];
  const counter = new RepCounter({ onRep: (e) => reps.push(e) });

  counter.push(signal({ fill: 0.05, elbow: 168, t: 0 }));
  counter.push(signal({ fill: 0.85, elbow: 60, t: 300 }));
  counter.push(signal({ fill: 0.05, elbow: 168, t: 700 }));

  assert.equal(reps.length, 1);
  assert.equal(reps[0].ok, false);
  assert.ok(reps[0].reasons.includes('demasiado rápido'));
});

test('several repetitions in a row are counted one by one', () => {
  const reps = [];
  const counter = new RepCounter({ onRep: (e) => reps.push(e) });

  let t = 0;
  for (let i = 0; i < 5; i++) {
    counter.push(signal({ fill: 0.05, elbow: 168, t }));
    t += 300;
    counter.push(signal({ fill: 0.4, elbow: 130, t }));
    t += 500;
    counter.push(signal({ fill: 0.9, elbow: 60, t }));
    t += 500;
    counter.push(signal({ fill: 0.4, elbow: 120, t }));
    t += 500;
    counter.push(signal({ fill: 0.05, elbow: 168, t }));
    t += 300;
  }

  assert.equal(reps.length, 5, `counted ${reps.length} repetitions instead of 5`);
  assert.equal(counter.counts.valid, 5);
});

test('holding the bottom position does not count extra repetitions', () => {
  const reps = [];
  const counter = new RepCounter({ onRep: (e) => reps.push(e) });

  counter.push(signal({ fill: 0.05, elbow: 168, t: 0 }));
  counter.push(signal({ fill: 0.85, elbow: 60, t: 600 }));
  counter.push(signal({ fill: 0.85, elbow: 58, t: 1500 }));
  counter.push(signal({ fill: 0.84, elbow: 60, t: 2500 }));
  counter.push(signal({ fill: 0.05, elbow: 168, t: 3200 }));

  assert.equal(reps.length, 1);
});

test('the counters survive a reset', () => {
  const counter = new RepCounter();
  counter.push(signal({ fill: 0.05, elbow: 168, t: 0 }));
  counter.push(signal({ fill: 0.9, elbow: 60, t: 600 }));
  counter.push(signal({ fill: 0.05, elbow: 168, t: 1700 }));
  assert.equal(counter.counts.valid, 1);

  counter.reset();
  assert.equal(counter.counts.valid, 0);
  assert.equal(counter.counts.invalid, 0);
});
