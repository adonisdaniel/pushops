// Pose engine wrapper around MediaPipe PoseLandmarker.
//
// The model runs entirely on the device through WebAssembly, so no video frame
// ever leaves the phone. The engine exposes a small surface so a different
// backend (MoveNet, for instance) can be dropped in later.

import { detectionConfidence } from './landmarks.js';

const WASM_PATH = '/static/vendor/mediapipe/wasm';
const MODEL_PATH = '/static/models/pose_landmarker_lite.task';

export class PoseEngine {
  constructor() {
    this.landmarker = null;
    this.delegate = 'GPU';
    this.masksEnabled = false;
    this.ready = false;
    this.lastError = null;
  }

  /** Load the WASM runtime and the model. */
  async init({ onProgress } = {}) {
    if (this.ready) return this;
    onProgress?.('Cargando el motor de pose…');

    const { FilesetResolver, PoseLandmarker } = await import(
      /* @vite-ignore */ '/static/vendor/mediapipe/vision_bundle.mjs'
    );

    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    onProgress?.('Descargando el modelo…');

    const build = async (delegate) => {
      try {
        return await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputSegmentationMasks: this.masksEnabled,
        });
      } catch (err) {
        console.warn(`delegate ${delegate} failed`, err);
        return null;
      }
    };

    let landmarker = await build(this.delegate);
    if (!landmarker) {
      this.delegate = 'CPU';
      landmarker = await build('CPU');
    }
    if (!landmarker) {
      this.lastError = 'no-se-puede-cargar-el-modelo';
      throw new Error('No se ha podido cargar el modelo de pose');
    }

    this.landmarker = landmarker;
    this.ready = true;
    onProgress?.('Motor listo');
    return this;
  }

  /**
   * Detect the pose in a video frame.
   * Returns null when nothing was detected.
   */
  detect(video, timestampMs) {
    if (!this.ready || !video || video.readyState < 2) return null;
    let result;
    try {
      result = this.landmarker.detectForVideo(video, timestampMs);
    } catch (err) {
      console.warn('detect failed', err);
      return null;
    }
    const lms = result?.landmarks?.[0];
    if (!lms || lms.length === 0) return null;

    return {
      landmarks: lms,
      worldLandmarks: result?.worldLandmarks?.[0] ?? null,
      mask: result?.segmentationMasks?.[0] ?? null,
      confidence: detectionConfidence(lms),
      timestamp: timestampMs,
    };
  }

  /** Enable or disable the segmentation mask output (costs performance). */
  setMasksEnabled(enabled) {
    if (this.masksEnabled === enabled) return;
    this.masksEnabled = enabled;
    // MediaPipe only reads this option at creation time.
    if (this.ready) {
      this.ready = false;
      this.landmarker?.close?.();
      this.landmarker = null;
    }
  }

  close() {
    this.ready = false;
    try { this.landmarker?.close?.(); } catch { /* ignore */ }
    this.landmarker = null;
  }
}
