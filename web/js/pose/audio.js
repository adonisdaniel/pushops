// Audio feedback for the repetitions.
//
// In the "suelo" mode the phone lies on the floor, not in your hand, so the
// vibration of the haptic feedback is imperceptible. The sound is the only
// channel that actually tells you that a repetition counted.
//
// Everything is synthesised with WebAudio: no files to download and no latency.

const TONES = {
  valid: { frequency: 880, durationMs: 70, gain: 0.16, type: 'triangle' },
  invalid: { frequency: 210, durationMs: 140, gain: 0.13, type: 'sawtooth' },
  start: { frequency: 520, durationMs: 90, gain: 0.12, type: 'sine' },
  complete: { frequency: 660, durationMs: 110, gain: 0.16, type: 'triangle', delayMs: 0 },
  completeUp: { frequency: 990, durationMs: 180, gain: 0.16, type: 'triangle', delayMs: 120 },
};

export class AudioFeedback {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 1;
    this.failed = false;
  }

  /**
   * Unlocks the audio context. Browsers only allow it after a user gesture,
   * so this must be called from a click handler.
   */
  unlock() {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!Ctor) {
          this.failed = true;
          return;
        }
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch {
      this.failed = true;
    }
  }

  setMuted(muted) {
    this.muted = !!muted;
  }

  /** Plays one of the predefined tones. Silently does nothing when muted. */
  play(name) {
    if (this.muted || !this.ctx) return;
    const tone = TONES[name];
    if (!tone) return;
    try {
      this.tone(tone.frequency, tone.durationMs, tone.gain, tone.type, tone.delayMs ?? 0);
    } catch { /* ignore */ }
  }

  tone(frequency, durationMs, gain = 0.15, type = 'sine', delayMs = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime + delayMs / 1000;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);

    // Short attack and release so the beep is crisp and does not click.
    const peak = Math.max(0.0001, gain * this.volume);
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.02);
  }
}
