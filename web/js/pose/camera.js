// Camera session: opens the stream with the constraints that work both in a
// normal browser and inside the Telegram WebView.
//
// The 640x480 constraint matters: WKWebView on iOS frequently renders a black
// video preview when the camera negotiates an unsupported format.

export const VIDEO_CONSTRAINTS = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  frameRate: { ideal: 30, max: 30 },
};

export class CameraSession {
  constructor() {
    this.stream = null;
    this.video = null;
    this.facingMode = 'environment';
    this.error = null;
  }

  /** True when the environment exposes a usable camera API. */
  static supported() {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  /** True when the page is served from a secure context (getUserMedia needs it). */
  static secureContext() {
    return globalThis.isSecureContext === true;
  }

  /**
   * Starts the camera and attaches the stream to the video element.
   * Throws with a Spanish, user-facing message on failure.
   */
  async start(videoEl, { facingMode = 'environment' } = {}) {
    if (!CameraSession.supported()) {
      this.error = 'este navegador no permite usar la cámara';
      throw new Error(this.error);
    }
    if (!CameraSession.secureContext()) {
      this.error = 'la cámara necesita una conexión segura (https)';
      throw new Error(this.error);
    }

    this.facingMode = facingMode;
    const attempts = [
      { video: { ...VIDEO_CONSTRAINTS, facingMode: { ideal: facingMode } }, audio: false },
      { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: true, audio: false },
    ];

    let lastError = null;
    for (const constraints of attempts) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (err) {
        lastError = err;
        // A denied permission will not improve with another constraint set.
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') break;
      }
    }
    if (!this.stream) {
      this.error = describeError(lastError);
      throw new Error(this.error);
    }

    this.video = videoEl;
    videoEl.srcObject = this.stream;
    videoEl.setAttribute('playsinline', '');
    videoEl.setAttribute('autoplay', '');
    videoEl.muted = true;
    await videoEl.play().catch(() => {});

    await new Promise((resolve) => {
      if (videoEl.readyState >= 2) return resolve();
      videoEl.addEventListener('loadeddata', () => resolve(), { once: true });
      setTimeout(resolve, 4000);
    });

    return this;
  }

  stop() {
    try {
      this.stream?.getTracks?.().forEach((track) => track.stop());
    } catch { /* ignore */ }
    this.stream = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
  }
}

function describeError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'has denegado el permiso de la cámara. Actívalo en los ajustes del navegador';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no se ha encontrado ninguna cámara disponible';
    case 'NotReadableError':
      return 'la cámara está siendo usada por otra aplicación';
    default:
      return 'no se ha podido abrir la cámara';
  }
}
