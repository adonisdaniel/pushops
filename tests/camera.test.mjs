// Tests of the camera geometry and the mirror handling.
//
// The invariant that matters: a landmark must land on the same canvas pixel
// where the camera frame shows that part of the body. If the video frame and
// the landmarks are mirrored differently, the progress ring ends up on the
// wrong side of the body.

import test from 'node:test';
import assert from 'node:assert/strict';

import { coverGeometry, projectPoint } from '../web/js/pose/overlay.js';
import { AudioFeedback } from '../web/js/pose/audio.js';
import { FACING } from '../web/js/pose/camera.js';
import { detectionConfidence, meanVisibility } from '../web/js/pose/landmarks.js';

const CANVAS = { w: 720, h: 1280 };
const VIDEO = { w: 640, h: 480 };

/** Where a video pixel with normalised x ends up on the canvas. */
function videoPixelX(normalisedX, geo, cw, mirror) {
  const x = normalisedX * geo.sw + geo.ox;
  return mirror ? cw - x : x;
}

test('coverGeometry scales the frame to cover the canvas', () => {
  const geo = coverGeometry(CANVAS.w, CANVAS.h, VIDEO.w, VIDEO.h);
  // The video is landscape and the canvas is portrait, so the height matches
  // and the width overflows on both sides.
  assert.ok(geo.sh >= CANVAS.h - 0.001);
  assert.ok(geo.sw > CANVAS.w);
  assert.ok(geo.ox < 0, 'the frame is centred and overflows horizontally');
  // ox = (canvasWidth - scaledWidth) / 2, so the frame stays centred.
  assert.ok(Math.abs((geo.ox * 2) + geo.sw - CANVAS.w) < 1e-6);
  assert.ok(Math.abs((geo.oy * 2) + geo.sh - CANVAS.h) < 1e-6);
});

test('coverGeometry keeps the aspect ratio', () => {
  const geo = coverGeometry(CANVAS.w, CANVAS.h, VIDEO.w, VIDEO.h);
  const expected = VIDEO.w / VIDEO.h;
  assert.ok(Math.abs((geo.sw / geo.sh) - expected) < 1e-6);
});

test('a landmark lands on the same pixel as the body part it marks', () => {
  const geo = coverGeometry(CANVAS.w, CANVAS.h, VIDEO.w, VIDEO.h);

  for (const mirror of [false, true]) {
    for (const u of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const point = projectPoint({ x: u, y: 0.5 }, geo, CANVAS.w, mirror);
      const expected = videoPixelX(u, geo, CANVAS.w, mirror);
      assert.ok(
        Math.abs(point.x - expected) < 1e-6,
        `mirror=${mirror} u=${u}: landmark at ${point.x}, frame at ${expected}`,
      );
    }
  }
});

test('the mirror flips the horizontal axis and leaves the vertical alone', () => {
  const geo = coverGeometry(CANVAS.w, CANVAS.h, VIDEO.w, VIDEO.h);
  const lm = { x: 0.3, y: 0.7 };
  const straight = projectPoint(lm, geo, CANVAS.w, false);
  const mirrored = projectPoint(lm, geo, CANVAS.w, true);

  assert.ok(Math.abs((straight.x + mirrored.x) - CANVAS.w) < 1e-6, 'the x axis is mirrored');
  assert.equal(straight.y, mirrored.y, 'the y axis is untouched');
});

test('the centre of the frame is the same with and without the mirror', () => {
  const geo = coverGeometry(CANVAS.w, CANVAS.h, VIDEO.w, VIDEO.h);
  const straight = projectPoint({ x: 0.5, y: 0.5 }, geo, CANVAS.w, false);
  const mirrored = projectPoint({ x: 0.5, y: 0.5 }, geo, CANVAS.w, true);
  assert.ok(Math.abs(straight.x - mirrored.x) < 1e-6);
});

test('the front camera is the one that gets mirrored', () => {
  assert.equal(FACING.FRONT, 'user');
  assert.equal(FACING.BACK, 'environment');
});

test('the audio feedback is silent and safe without an audio context', () => {
  const audio = new AudioFeedback();
  audio.unlock();          // no AudioContext in Node, must not throw
  audio.play('valid');
  audio.play('invalid');
  audio.play('complete');
  audio.setMuted(true);
  audio.play('valid');
  assert.equal(audio.failed, true);
});

/**
 * Landmarks as MediaPipe returns them for a push-up seen from below: the face
 * and the arms are visible, the legs are hidden by the body itself.
 */
function pushUpLandmarks() {
  const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  const set = (i, v) => { lms[i].visibility = v; };
  // Face, viewed from below and foreshortened.
  for (const i of [0, 1, 2, 3]) set(i, 0.55);
  for (const i of [4, 5, 6]) set(i, 0.52);
  set(7, 0.6); set(8, 0.58);
  set(9, 0.5); set(10, 0.5);
  // Shoulders and arms: what the skeleton is drawn from.
  set(11, 0.93); set(12, 0.92);
  set(13, 0.8); set(14, 0.78);
  set(15, 0.7); set(16, 0.68);
  // Hands and hips.
  for (const i of [17, 18, 19, 20, 21, 22]) set(i, 0.45);
  set(23, 0.28); set(24, 0.24);
  // Legs: structurally hidden.
  set(25, 0.12); set(26, 0.10);
  set(27, 0.06); set(28, 0.05);
  set(29, 0.03); set(30, 0.03);
  set(31, 0.04); set(32, 0.03);
  return lms;
}

test('the confidence ignores the landmarks that are hidden by the body', () => {
  const lms = pushUpLandmarks();

  const old = meanVisibility(lms);
  const conf = detectionConfidence(lms);

  assert.ok(old < 0.5, `the old metric should be low, was ${old}`);
  assert.ok(conf > 0.6, `the new confidence should be high, was ${conf}`);
});

test('the confidence is zero when almost nothing is visible', () => {
  const lms = pushUpLandmarks().map((l) => ({ ...l, visibility: 0.05 }));
  assert.equal(detectionConfidence(lms), 0);
});

test('the confidence is the mean of the visible core landmarks', () => {
  const lms = pushUpLandmarks();
  const visible = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24]
    .map((i) => lms[i].visibility)
    .filter((v) => v >= 0.5);
  const expected = visible.reduce((a, b) => a + b, 0) / visible.length;
  assert.ok(Math.abs(detectionConfidence(lms) - expected) < 1e-9);
});
