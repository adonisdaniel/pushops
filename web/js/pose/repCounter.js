// Repetition state machine.
//
// A repetition is a full down-up cycle. It only counts when the body actually
// reached the bottom of the movement, which is what the progress ring shows.
//
// Two detectors are supported and the placement decides which one is used:
//   - depth mode ("suelo"): the body grows in the frame as it approaches the
//     camera. The fill signal drives the state machine. The elbows are seen in
//     extreme foreshortening from under the chest, so the angle is ignored: it
//     used to hijack the state machine and the repetitions never closed.
//   - angle mode ("perfil"): the elbow angle drives the state machine, and the
//     fill signal is used as a secondary sanity check.
//
// "auto" keeps the old behaviour (angle when available) for callers that do
// not know the placement.

import { DEFAULT_THRESHOLDS } from './metrics.js';

export const REP_VALID = 'valid';
export const REP_INVALID = 'invalid';

/**
 * Longest pause that still counts as the beginning of the repetition. Beyond
 * this the user was resting, so the timer starts again from the detection.
 */
const MaxIdleBeforeRepMs = 4000;

export class RepCounter {
  constructor(options = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) };
    this.mode = options.mode ?? 'auto';
    this.onRep = options.onRep ?? (() => {});
    this.onStateChange = options.onStateChange ?? (() => {});

    this.reset();
  }

  reset() {
    this.state = 'idle';        // idle | active
    this.active = false;
    this.maxFill = 0;
    this.minAngle = 180;
    this.tStart = 0;
    this.tExtended = 0;         // last moment the body was in the extended position
    this.repCount = 0;
    this.invalidCount = 0;
    this.lastSignal = null;
    this.angleAvailable = false;
    this._announce();
  }

  _announce() {
    this.onStateChange?.({
      state: this.state,
      reps: this.repCount,
      invalid: this.invalidCount,
      maxFill: this.maxFill,
    });
  }

  /**
   * Which signal drives the movement for this frame. In "suelo" the elbow
   * angle is never used, even if MediaPipe reports it: seen from under the
   * chest it is too foreshortened to be trusted.
   */
  _usesAngle(signal) {
    if (this.mode === 'suelo') return false;
    return !!signal.angleAvailable && signal.elbow !== null;
  }

  /** True when the body is in the extended position (arms straight / far away). */
  _isExtended(signal, useAngle) {
    const th = this.thresholds;
    if (useAngle) return signal.elbow > th.angleExtended;
    return signal.fill < th.fillRelease;
  }

  /** Feed one frame's signals into the machine. Returns a rep event or null. */
  push(signal) {
    this.lastSignal = signal;
    const th = this.thresholds;
    const useAngle = this._usesAngle(signal);

    if (!this.active) {
      // Remember when the body was last extended so the duration of the
      // repetition can be measured from the real start of the movement.
      if (this._isExtended(signal, useAngle)) {
        this.tExtended = signal.timestamp;
      }

      // Either signal can start a descent: relying on both would lose the
      // repetitions when one of them is unavailable or noisy.
      const startedByAngle = useAngle && signal.elbow < th.angleStart;
      const startedByDepth = signal.fill > th.fillStart;
      if (startedByAngle || startedByDepth) {
        this.active = true;
        this.state = 'active';
        this.maxFill = signal.fill;
        this.minAngle = useAngle ? signal.elbow : 180;
        // Start from the last extended frame, but do not credit a long pause.
        const idle = signal.timestamp - this.tExtended;
        this.tStart = idle > MaxIdleBeforeRepMs || this.tExtended === 0
          ? signal.timestamp
          : this.tExtended;
        this._announce();
      }
      return null;
    }

    // Accumulate the extremes of the movement.
    if (signal.fill > this.maxFill) this.maxFill = signal.fill;
    if (useAngle && signal.elbow < this.minAngle) this.minAngle = signal.elbow;

    const duration = signal.timestamp - this.tStart;
    const cameBackUp = useAngle
      ? signal.elbow > th.angleExtended
      : signal.fill < th.fillRelease;

    if (!cameBackUp) return null;
    if (duration < 350) return null;   // too fast to be a real repetition

    const event = this._evaluate({ signal, duration, useAngle });
    this.active = false;
    this.state = 'idle';
    this._announce();
    this.onRep(event);
    return event;
  }

  _evaluate({ signal, duration, useAngle }) {
    const th = this.thresholds;
    const reasons = [];

    if (useAngle) {
      if (this.minAngle > th.angleFlexed) reasons.push('no bajó lo suficiente');
    } else if (this.maxFill < th.fillTarget) {
      reasons.push('no bajó lo suficiente');
    }

    // Secondary check: even with a good angle the body barely moved.
    if (signal.coverage !== null && this.maxFill < th.fillTarget * 0.45) {
      reasons.push('el cuerpo no se acercó a la cámara');
    }

    if (duration < th.minRepMs) reasons.push('demasiado rápido');
    if (duration > th.maxRepMs) reasons.push('demasiado lento');
    if (signal.confidence < th.minConfidence) reasons.push('detección poco fiable');

    const ok = reasons.length === 0;
    const event = {
      ok,
      reasons,
      tMs: signal.timestamp,
      durationMs: duration,
      fillMax: Number(this.maxFill.toFixed(3)),
      elbowMin: useAngle ? Number(this.minAngle.toFixed(1)) : 0,
      conf: Number((signal.confidence ?? 0).toFixed(3)),
      index: this.repCount + this.invalidCount,
    };

    if (ok) this.repCount++;
    else this.invalidCount++;

    this.maxFill = 0;
    this.minAngle = 180;
    return event;
  }

  /** Current counters. */
  get counts() {
    return { valid: this.repCount, invalid: this.invalidCount, total: this.repCount + this.invalidCount };
  }

  /** Snapshot of the repetitions seen so far, for saving the workout. */
  snapshot() {
    return { valid: this.repCount, invalid: this.invalidCount };
  }
}
