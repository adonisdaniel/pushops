// Camera diagnostic. Answers the three questions that decide the architecture:
//   1. Does the WebView deliver real pixels (or a black frame)?
//   2. Does the pose model detect the body?
//   3. How many frames per second do we get?

import { PoseEngine } from './pose/engine.js';
import { CameraSession, FACING } from './pose/camera.js';
import { maskCoverage } from './pose/metrics.js';
import { elbowAngle } from './pose/landmarks.js';

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const logEl = document.getElementById('log');
const startBtn = document.getElementById('start');

const cells = {
  pixels: document.getElementById('pixels'),
  landmarks: document.getElementById('landmarks'),
  fps: document.getElementById('fps'),
  coverage: document.getElementById('coverage'),
  elbow: document.getElementById('elbow'),
  delegate: document.getElementById('delegate'),
};

function log(msg) {
  const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
  logEl.textContent = `${logEl.textContent}\n[${time}] ${msg}`;
  logEl.scrollTop = logEl.scrollHeight;
  console.log(msg);
}

const tg = globalThis.Telegram?.WebApp;
document.getElementById('env').textContent = tg
  ? `Telegram ${tg.platform} · v${tg.version}`
  : 'Navegador';

log(`userAgent: ${navigator.userAgent}`);
log(`isSecureContext: ${globalThis.isSecureContext}`);
log(`mediaDevices: ${!!navigator.mediaDevices?.getUserMedia}`);

if (!globalThis.isSecureContext) {
  log('AVISO: sin contexto seguro getUserMedia no funcionará.');
}

/** Mean luminance and standard deviation of the frame, to detect black frames. */
function frameStats() {
  const w = 64;
  const h = 48;
  const probe = document.createElement('canvas');
  probe.width = w;
  probe.height = h;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  pctx.drawImage(video, 0, 0, w, h);
  const { data } = pctx.getImageData(0, 0, w, h);
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += lum;
    sumSq += lum * lum;
    n++;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return { mean, stdev: Math.sqrt(variance) };
}

let engine = null;
let camera = null;
let raf = 0;
let lastVideoTime = -1;
let frames = 0;
let fpsSince = performance.now();
let masks = false;
let facing = FACING.FRONT;

async function run() {
  startBtn.disabled = true;
  try {
    camera = new CameraSession();
    await camera.start(video, { facingMode: facing });
    const track = camera.stream.getVideoTracks()[0];
    const settings = track?.getSettings?.() ?? {};
    log(`cámara abierta (${facing === FACING.FRONT ? 'frontal' : 'trasera'}): ${settings.width}x${settings.height} @${settings.frameRate}`);
    log(`stream activo: ${camera.stream.active}, pistas: ${camera.stream.getTracks().length}`);

    engine = new PoseEngine();
    engine.setMasksEnabled(masks);
    await engine.init({
      onProgress: (m) => log(m),
    });
    cells.delegate.textContent = engine.delegate;
    log(`modelo cargado (delegate: ${engine.delegate})`);

    loop();
  } catch (err) {
    log(`ERROR: ${err.message}`);
    startBtn.disabled = false;
  }
}

function loop() {
  raf = requestAnimationFrame(loop);
  if (!engine?.ready || video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const stats = frameStats();
  const black = stats.mean < 3 && stats.stdev < 2;
  cells.pixels.textContent = black ? 'NEGRO' : `${stats.mean.toFixed(0)} ±${stats.stdev.toFixed(0)}`;
  cells.pixels.className = `spike__v ${black ? 'spike__v--bad' : 'spike__v--ok'}`;

  const frame = engine.detect(video, performance.now());
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  if (frame) {
    cells.landmarks.textContent = String(frame.landmarks.length);
    cells.landmarks.className = 'spike__v spike__v--ok';

    const cov = maskCoverage(frame.mask);
    cells.coverage.textContent = cov === null ? 'sin máscara' : `${(cov * 100).toFixed(1)}%`;

    const elbow = elbowAngle(frame.landmarks, 'left') ?? elbowAngle(frame.landmarks, 'right');
    cells.elbow.textContent = elbow === null ? 'no visible' : `${elbow.toFixed(0)}°`;

    ctx.fillStyle = 'rgba(61,220,132,.9)';
    for (const lm of frame.landmarks) {
      if ((lm.visibility ?? 1) < 0.5) continue;
      ctx.beginPath();
      ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    cells.landmarks.textContent = '0';
    cells.landmarks.className = 'spike__v spike__v--bad';
  }

  frames++;
  const now = performance.now();
  if (now - fpsSince >= 1000) {
    const fps = Math.round((frames * 1000) / (now - fpsSince));
    cells.fps.textContent = String(fps);
    cells.fps.className = `spike__v ${fps >= 12 ? 'spike__v--ok' : 'spike__v--bad'}`;
    log(`fps: ${fps} · píxeles: ${stats.mean.toFixed(1)}±${stats.stdev.toFixed(1)} · landmarks: ${frame ? frame.landmarks.length : 0}`);
    frames = 0;
    fpsSince = now;
  }
}

startBtn.addEventListener('click', run);

// Switch between the selfie and the rear camera without reloading.
document.getElementById('toggle-camera').addEventListener('click', async () => {
  facing = facing === FACING.FRONT ? FACING.BACK : FACING.FRONT;
  const label = facing === FACING.FRONT ? 'frontal' : 'trasera';
  log(`cambiando a la cámara ${label}…`);
  try {
    if (camera) {
      await camera.switchTo(video, facing);
    } else {
      camera = new CameraSession();
      await camera.start(video, { facingMode: facing });
    }
    lastVideoTime = -1;
    log(`cámara ${label} lista`);
  } catch (err) {
    log(`ERROR al cambiar de cámara: ${err.message}`);
  }
});

document.getElementById('toggle-masks').addEventListener('click', async () => {
  masks = !masks;
  log(`máscaras: ${masks ? 'activadas' : 'desactivadas'} — recargando el motor`);
  cancelAnimationFrame(raf);
  engine?.close();
  engine = new PoseEngine();
  engine.setMasksEnabled(masks);
  try {
    await engine.init({ onProgress: (m) => log(m) });
    cells.delegate.textContent = engine.delegate;
    lastVideoTime = -1;
    loop();
  } catch (err) {
    log(`ERROR: ${err.message}`);
  }
});
