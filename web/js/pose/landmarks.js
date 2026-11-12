// MediaPipe BlazePose landmark indices and the geometry helpers built on them.

export const LM = {
  NOSE: 0,
  LEFT_EYE_INNER: 1, LEFT_EYE: 2, LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4, RIGHT_EYE: 5, RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7, RIGHT_EAR: 8,
  MOUTH_LEFT: 9, MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_PINKY: 17, RIGHT_PINKY: 18,
  LEFT_INDEX: 19, RIGHT_INDEX: 20,
  LEFT_THUMB: 21, RIGHT_THUMB: 22,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29, RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31, RIGHT_FOOT_INDEX: 32,
};

/**
 * Segment pairs used to estimate how close the body is to the camera.
 * Each pair is normalised by its own calibrated length, so the metric stays
 * continuous even when a landmark pair leaves the frame.
 */
export const SCALE_PAIRS = [
  { name: 'shoulders', a: LM.LEFT_SHOULDER, b: LM.RIGHT_SHOULDER },
  { name: 'ears',      a: LM.LEFT_EAR,      b: LM.RIGHT_EAR },
  { name: 'eyes',      a: LM.LEFT_EYE,      b: LM.RIGHT_EYE },
  { name: 'torsoL',    a: LM.LEFT_SHOULDER, b: LM.LEFT_HIP },
  { name: 'torsoR',    a: LM.RIGHT_SHOULDER,b: LM.RIGHT_HIP },
  { name: 'armL',      a: LM.LEFT_SHOULDER, b: LM.LEFT_ELBOW },
  { name: 'armR',      a: LM.RIGHT_SHOULDER,b: LM.RIGHT_ELBOW },
  { name: 'foreL',     a: LM.LEFT_ELBOW,    b: LM.LEFT_WRIST },
  { name: 'foreR',     a: LM.RIGHT_ELBOW,   b: LM.RIGHT_WRIST },
  { name: 'hips',      a: LM.LEFT_HIP,      b: LM.RIGHT_HIP },
];

/** Skeleton connections, used to draw the overlay. */
export const CONNECTIONS = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW], [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW], [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP], [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.LEFT_KNEE], [LM.LEFT_KNEE, LM.LEFT_ANKLE],
  [LM.RIGHT_HIP, LM.RIGHT_KNEE], [LM.RIGHT_KNEE, LM.RIGHT_ANKLE],
  [LM.LEFT_ANKLE, LM.LEFT_HEEL], [LM.LEFT_HEEL, LM.LEFT_FOOT_INDEX],
  [LM.RIGHT_ANKLE, LM.RIGHT_HEEL], [LM.RIGHT_HEEL, LM.RIGHT_FOOT_INDEX],
];

/** Minimum visibility for a landmark to be trusted. */
export const MIN_VISIBILITY = 0.5;

/** Euclidean distance between two landmarks in normalised image coordinates. */
export function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** Angle in degrees at vertex b, formed by the points a-b-c. */
export function angleAt(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const l1 = Math.hypot(v1x, v1y);
  const l2 = Math.hypot(v2x, v2y);
  if (l1 < 1e-6 || l2 < 1e-6) return null;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** True when the landmark exists and is visible enough. */
export function isVisible(lm, min = MIN_VISIBILITY) {
  return !!lm && (lm.visibility ?? 1) >= min;
}

/**
 * Elbow angle for one side. Returns null when the landmarks are not visible.
 * `side` is 'left' or 'right' and refers to the subject's own side.
 */
export function elbowAngle(lms, side) {
  const s = side === 'left'
    ? [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST]
    : [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST];
  const [a, b, c] = s.map((i) => lms[i]);
  if (!isVisible(a) || !isVisible(b) || !isVisible(c)) return null;
  return angleAt(a, b, c);
}

/** Mean of the visible elbow angles, or null. */
export function meanElbowAngle(lms) {
  const left = elbowAngle(lms, 'left');
  const right = elbowAngle(lms, 'right');
  if (left === null && right === null) return null;
  if (left === null) return right;
  if (right === null) return left;
  return (left + right) / 2;
}

/**
 * Anchor point for the progress ring: the centroid of the visible upper body
 * landmarks. Falls back to the hips and then to the nose.
 */
export function bodyAnchor(lms) {
  const groups = [
    [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
    [LM.LEFT_HIP, LM.RIGHT_HIP],
    [LM.NOSE],
  ];
  for (const group of groups) {
    const pts = group.map((i) => lms[i]).filter(isVisible);
    if (pts.length === group.length && pts.length > 0) {
      const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      return { x, y };
    }
  }
  return null;
}

/**
 * Landmarks the detector actually relies on. Everything else (feet, heels,
 * toes) is structurally hidden in a push-up and must not drag the detection
 * confidence down.
 */
export const CORE_LANDMARKS = [
  LM.NOSE,
  LM.LEFT_EYE, LM.RIGHT_EYE,
  LM.LEFT_EAR, LM.RIGHT_EAR,
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_HIP, LM.RIGHT_HIP,
];

/**
 * Confidence of the detection: the mean visibility of the core landmarks that
 * are actually visible. Averaging all 33 landmarks would be meaningless, the
 * feet and hips are hidden in a push-up seen from below.
 *
 * Returns 0 when fewer than three core landmarks are visible.
 */
export function detectionConfidence(lms) {
  const values = [];
  for (const i of CORE_LANDMARKS) {
    const v = lms[i]?.visibility ?? 0;
    if (v >= MIN_VISIBILITY) values.push(v);
  }
  if (values.length < 3) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Average visibility across all landmarks. Only used for diagnostics. */
export function meanVisibility(lms) {
  let sum = 0;
  let n = 0;
  for (const lm of lms) {
    sum += lm.visibility ?? 1;
    n++;
  }
  return n ? sum / n : 0;
}
