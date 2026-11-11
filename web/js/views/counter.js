// The counter view: camera, calibration, live detection and the progress ring.

import { api } from '../api.js';
import { getState, setSettings, queueWorkout } from '../store.js';
import { haptic, hapticNotify, hapticSelect, requestFullscreen, lockOrientation, unlockOrientation } from '../tg.js';
import { h, toast, fmtDuration, fmtNumber, openModal, localDate } from '../ui.js';
import { CameraSession } from '../pose/camera.js';
import { Overlay } from '../pose/overlay.js';
import { PoseEngine } from '../pose/engine.js';
import { calibrate, isCalibrationValid } from '../pose/calibrate.js';
import { computeSignals, createFilters, DEFAULT_THRESHOLDS } from '../pose/metrics.js';
import { RepCounter } from '../pose/repCounter.js';

const MODE_INFO = {
  suelo: {
    title: 'Teléfono bajo el cuerpo',
    text: 'Coloca el teléfono en el suelo, justo debajo del pecho, con la cámara mirando hacia arriba. El círculo se llenará a medida que te acerques.',
    steps: [
      ['Tumba el teléfono en el suelo', 'con la cámara hacia arriba, bajo el pecho'],
      ['Colócate en posición de flexión', 'la cara y el pecho quedan sobre el teléfono'],
      ['Mantén los brazos estirados', 'para que el contador capture la referencia'],
    ],
  },
  perfil: {
    title: 'Teléfono al lado',
    text: 'Coloca el teléfono en el suelo a un metro de ti, de perfil. Se te verá el cuerpo entero y el contador usará el ángulo del codo.',
    steps: [
      ['Apoya el teléfono en el suelo', 'a un metro de ti, de perfil'],
      ['Deja visible el cuerpo entero', 'de la cabeza a los pies'],
      ['Mantén los brazos estirados', 'para que el contador capture la referencia'],
    ],
  },
};

export function counterView() {
  const state = getState();
  const mode = state.settings.mode ?? 'suelo';

  const stage = h('div.counter__stage');
  const video = h('video.counter__video', { playsinline: '', muted: '', autoplay: '' });
  const canvas = h('canvas.counter__canvas');
  const ringHost = h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } });
  const hud = h('div.counter__hud');
  const repsBox = h('div.counter__reps');
  const bar = h('div.counter__bar');

  const root = h('div.counter', stage, bar);

  let camera = null;
  let engine = null;
  let overlay = null;
  let rafId = 0;
  let counter = null;
  let filters = createFilters();
  let calib = state.settings.calibration;
  let running = false;
  let startedAt = 0;
  let lastVideoTime = -1;
  let reps = [];
  let frameTimes = [];
  let lastFrameAt = 0;

  /* ------------------------------- rendering ------------------------------ */

  function renderGuide() {
    const info = MODE_INFO[mode];
    root.classList.add('counter--guide');
    showChrome(true);
    root.replaceChildren(
      h('div.guide',
        h('div.guide__art', guideArt(mode)),
        h('h2.guide__title', info.title),
        h('p.guide__text', info.text),
        h('div.guide__steps', info.steps.map(([t, d], i) => h('div.guide__step',
          h('span.guide__num', String(i + 1)),
          h('div', h('b', t), ' — ', d),
        ))),
        h('div', { style: { display: 'flex', gap: '8px', width: '100%', maxWidth: '330px' } },
          h('button.btn.btn--ghost.grow', {
            onclick: () => { void switchMode(mode === 'suelo' ? 'perfil' : 'suelo'); },
          }, mode === 'suelo' ? 'Ver modo lateral' : 'Ver modo bajo el cuerpo'),
        ),
        h('button.btn.btn--block', { style: { maxWidth: '330px' }, onclick: () => void startFlow() },
          'Activar la cámara'),
        !CameraSession.secureContext()
          ? h('p.small.muted.center', 'La cámara necesita una conexión segura (https).')
          : null,
      ),
    );
  }

  function renderLive() {
    root.classList.remove('counter--guide');
    showChrome(false);
    root.replaceChildren(stage, bar);
    stage.replaceChildren(video, canvas, ringHost, hud, repsBox);
    renderHud();
    renderBar();
  }

  /** The chrome (top bar and tab bar) is hidden only while the camera is live. */
  function showChrome(visible) {
    const topbar = document.getElementById('topbar');
    const tabbar = document.getElementById('tabbar');
    if (visible) {
      topbar?.removeAttribute('hidden');
      tabbar?.removeAttribute('hidden');
    } else {
      topbar?.setAttribute('hidden', '');
      tabbar?.setAttribute('hidden', '');
    }
  }

  function renderHud() {
    hud.replaceChildren(
      h('div.counter__pill', h('span.counter__dot.counter__dot--live'), mode === 'suelo' ? 'Modo suelo' : 'Modo lateral'),
      h('div.counter__pill', { id: 'fps-pill' }, '— fps'),
    );
  }

  function renderBar() {
    bar.replaceChildren(
      h('button.counter__btn.counter__btn--stop', { onclick: () => void stop() }, 'Terminar serie'),
      h('div.counter__subrow',
        h('button.btn.btn--sm', { onclick: () => void recalibrate() }, 'Recalibrar'),
        h('button.btn.btn--sm', { onclick: () => void switchMode(mode === 'suelo' ? 'perfil' : 'suelo') }, 'Cambiar modo'),
      ),
    );
  }

  /* --------------------------------- flow -------------------------------- */

  async function switchMode(next) {
    hapticSelect();
    setSettings({ mode: next, calibration: null });
    calib = null;
    renderGuide();
  }

  async function startFlow() {
    try {
      requestFullscreen();
      lockOrientation();
      renderLive();

      camera = new CameraSession();
      await camera.start(video, { facingMode: 'environment' });

      engine = new PoseEngine();
      // The depth signal relies on the segmentation mask in "suelo" mode.
      engine.setMasksEnabled(mode === 'suelo');
      await engine.init({ onProgress: (msg) => toast(msg) });

      overlay = new Overlay(canvas, ringHost);
      filters = createFilters();

      if (!isCalibrationValid(calib) || calib.mode !== mode) {
        await runCalibration();
      }
      await beginCounting();
    } catch (err) {
      console.error(err);
      stopEverything();
      renderError(err.message ?? 'No se ha podido iniciar la cámara');
    }
  }

  function renderError(message) {
    root.replaceChildren(
      h('div.guide',
        h('div.guide__art', guideArt(mode)),
        h('h2.guide__title', 'No podemos usar la cámara'),
        h('p.guide__text', message),
        h('p.guide__text', 'Alternativas: abre la app en tu navegador (Chrome o Safari) o usa el contador manual desde el perfil.'),
        h('button.btn.btn--block', { style: { maxWidth: '330px' }, onclick: () => renderGuide() }, 'Volver'),
      ),
    );
  }

  async function runCalibration() {
    const overlayNode = h('div.counter__calib',
      h('div',
        h('div.counter__calibNum', '3'),
        h('div.counter__calibText', 'Posición de partida: brazos estirados'),
      ),
    );
    stage.appendChild(overlayNode);
    const numNode = overlayNode.querySelector('.counter__calibNum');

    try {
      const result = await calibrate({
        detect: () => {
          const ts = performance.now();
          if (video.readyState < 2 || video.currentTime === lastVideoTime) return null;
          lastVideoTime = video.currentTime;
          const frame = engine.detect(video, ts);
          if (frame) frame.video = video;
          return frame;
        },
        durationMs: 3000,
        mode,
        onTick: (secondsLeft, stats) => {
          numNode.textContent = String(Math.max(1, secondsLeft));
          if (stats?.coverage) {
            numNode.textContent = String(Math.max(1, secondsLeft));
          }
        },
      });
      calib = result;
      setSettings({ calibration: result });
    } catch (err) {
      overlayNode.remove();
      throw err;
    }
    overlayNode.remove();
  }

  async function recalibrate() {
    if (!engine) return;
    const overlayNode = h('div.counter__calib',
      h('div',
        h('div.counter__calibNum', '3'),
        h('div.counter__calibText', 'Recalibrando: brazos estirados'),
      ),
    );
    stage.appendChild(overlayNode);
    try {
      const result = await calibrate({
        detect: () => {
          const ts = performance.now();
          if (video.readyState < 2 || video.currentTime === lastVideoTime) return null;
          lastVideoTime = video.currentTime;
          const frame = engine.detect(video, ts);
          if (frame) frame.video = video;
          return frame;
        },
        durationMs: 3000,
        mode,
      });
      calib = result;
      setSettings({ calibration: result });
      filters = createFilters();
      counter?.reset();
      toast('Calibración actualizada');
    } catch (err) {
      toast(err.message ?? 'No se ha podido calibrar', 'error');
    } finally {
      overlayNode.remove();
    }
  }

  function beginCounting() {
    running = true;
    startedAt = Date.now();
    reps = [];
    frameTimes = [];
    counter = new RepCounter({
      thresholds: { ...DEFAULT_THRESHOLDS, ...(getState().settings.thresholds ?? {}) },
      onRep: (event) => {
        reps.push(event);
        if (event.ok) {
          haptic('medium');
          updateRepsBox();
        } else {
          haptic('light');
          toast(event.reasons?.[0] ?? 'repetición no válida');
        }
      },
      onStateChange: () => updateRepsBox(),
    });
    lastFrameAt = performance.now();
    loop();
  }

  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);

    const ts = performance.now();
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const frame = engine.detect(video, ts);
      if (frame) {
        frame.video = video;
        const signal = computeSignals(frame, calib, {
          thresholds: { ...DEFAULT_THRESHOLDS, ...(getState().settings.thresholds ?? {}) },
          ...filters,
        });
        overlay?.draw(frame, signal);
        counter?.push(signal);

        const dt = ts - lastFrameAt;
        lastFrameAt = ts;
        frameTimes.push(dt);
        if (frameTimes.length > 30) frameTimes.shift();
      }
    }
    updateFps();
  }

  function updateFps() {
    const pill = hud.querySelector('#fps-pill');
    if (!pill || frameTimes.length < 5) return;
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    const fps = Math.round(1000 / Math.max(1, avg));
    pill.textContent = `${fps} fps`;
    pill.className = fps < 8 ? 'counter__pill counter__pill--warn' : 'counter__pill';
  }

  function updateRepsBox() {
    if (!counter) return;
    const counts = counter.counts;
    const elapsed = running ? Date.now() - startedAt : 0;
    repsBox.replaceChildren(
      h('div.counter__num', String(counts.valid)),
      h('div.counter__meta',
        counts.invalid > 0 ? h('span', h('b', String(counts.invalid)), ' incompletas · ') : null,
        `${fmtDuration(elapsed)} · ${elapsed > 0 ? (counts.valid / (elapsed / 60000)).toFixed(1) : '0.0'} rep/min`,
      ),
    );
  }

  async function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    const elapsed = Date.now() - startedAt;
    const counts = counter?.counts ?? { valid: 0, invalid: 0 };
    stopEverything();

    if (counts.valid === 0 && counts.invalid === 0) {
      renderGuide();
      return;
    }
    await persist(elapsed, counts);
    showResult(elapsed, counts);
  }

  function stopEverything() {
    running = false;
    cancelAnimationFrame(rafId);
    camera?.stop();
    camera = null;
    engine?.close();
    engine = null;
    overlay?.destroy();
    overlay = null;
    unlockOrientation();
  }

  async function persist(elapsed, counts) {
    const payload = {
      clientId: `w_${startedAt}_${counts.valid}_${counts.invalid}`,
      variant: getState().settings.variant ?? 'standard',
      mode,
      startedAt,
      endedAt: Date.now(),
      localDate: localDate(),
      reps: reps.map((r) => ({
        tMs: r.tMs,
        durationMs: r.durationMs,
        fillMax: r.fillMax,
        elbowMin: r.elbowMin,
        ok: r.ok,
        conf: r.conf,
      })),
      meta: {
        fps: Math.round(frameTimes.length
          ? 1000 / (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length)
          : 0),
        engine: 'mediapipe-lite',
        thresholds: { ...DEFAULT_THRESHOLDS, ...(getState().settings.thresholds ?? {}) },
        calibrated: !!calib,
      },
    };

    try {
      return await api.post('/api/workouts', payload);
    } catch (err) {
      console.warn('workout queued for later', err);
      await queueWorkout(payload);
      toast('Guardada en el dispositivo. Se subirá al recuperar la conexión.');
      return null;
    }
  }

  function showResult(elapsed, counts) {
    const content = h('div');
    content.append(
      h('div.result__big',
        h('div.result__bigNum', String(counts.valid)),
        h('div.card__sub', counts.invalid > 0
          ? `${counts.invalid} repeticiones incompletas`
          : '¡Serie perfecta!'),
      ),
    );
    const { close } = openModal(content, { onClose: () => { location.hash = '#/stats'; } });

    const summary = h('div.result__grid');
    content.append(summary);
    content.append(
      h('button.btn.btn--block', {
        onclick: async () => {
          close();
          location.hash = '#/stats';
        },
      }, 'Ver mis estadísticas'),
    );

    api.post('/api/me/summary').then((data) => {
      summary.replaceChildren(
        h('div.tile', h('div.tile__label', 'Duración'), h('div.tile__value', fmtDuration(elapsed))),
        h('div.tile', h('div.tile__label', 'Ritmo'), h('div.tile__value',
          fmtNumber((counts.valid / Math.max(1, elapsed / 60000)) * 10) / 10, h('span.tile__unit', 'rep/min'))),
        h('div.tile', h('div.tile__label', 'Puntos'), h('div.tile__value',
          fmtNumber(data?.summary?.totalPoints ?? 0))),
        h('div.tile', h('div.tile__label', 'Total'), h('div.tile__value',
          fmtNumber(data?.summary?.totalReps ?? 0))),
      );
    }).catch(() => {
      summary.replaceChildren(
        h('div.tile', h('div.tile__label', 'Duración'), h('div.tile__value', fmtDuration(elapsed))),
      );
    });

    hapticNotify('success');
  }

  /* -------------------------------- mount -------------------------------- */

  renderGuide();

  return {
    el: root,
    mount() {
      document.body.classList.add('view-counter');
    },
    unmount() {
      stopEverything();
      document.body.classList.remove('view-counter');
      showChrome(true);
    },
  };
}

/** Simple line-art illustration of the phone placement for each mode. */
function guideArt(mode) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.color = 'var(--accent)';

  const add = (tag, attrs) => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.appendChild(node);
    return node;
  };

  if (mode === 'suelo') {
    // Person seen from below, phone on the floor.
    add('rect', { x: '44', y: '96', width: '32', height: '9', rx: '2.5' });
    add('circle', { cx: '60', cy: '24', r: '11' });
    add('path', { d: 'M60 35 L60 56' });
    add('path', { d: 'M60 40 L38 52 M60 40 L82 52' });
    add('path', { d: 'M38 52 L44 92 M82 52 L76 92' });
    add('circle', { cx: '60', cy: '100', r: '13', opacity: '.45' });
  } else {
    // Person in profile with the phone on the floor at the side.
    add('circle', { cx: '40', cy: '26', r: '10' });
    add('path', { d: 'M44 34 L70 52 L68 78' });
    add('path', { d: 'M44 36 L58 58 M46 40 L34 60' });
    add('path', { d: 'M68 78 L82 96 M46 40 L38 96' });
    add('rect', { x: '88', y: '92', width: '22', height: '8', rx: '2.5' });
    add('path', { d: 'M92 88 L92 76 M100 88 L100 76', opacity: '.5' });
  }
  return svg;
}
