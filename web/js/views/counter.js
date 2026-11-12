// The counter view: camera, calibration, live detection and the progress ring.

import { api } from '../api.js';
import { getState, setSettings, queueWorkout } from '../store.js';
import { haptic, hapticNotify, hapticSelect, requestFullscreen, lockOrientation, unlockOrientation, isTelegram } from '../tg.js';
import { fill, fmtDuration, fmtNumber, h, localDate, openModal, toast } from '../ui.js';
import { CameraSession, FACING } from '../pose/camera.js';
import { Overlay } from '../pose/overlay.js';
import { AudioFeedback } from '../pose/audio.js';
import { PoseEngine } from '../pose/engine.js';
import { calibrate, isCalibrationValid } from '../pose/calibrate.js';
import { computeSignals, createFilters, DEFAULT_THRESHOLDS } from '../pose/metrics.js';
import { RepCounter } from '../pose/repCounter.js';

const MODE_INFO = {
  suelo: {
    title: 'Teléfono bajo el cuerpo',
    text: 'Coloca el teléfono en el suelo, justo debajo del pecho. El círculo se llenará a medida que te acerques.',
    steps: [
      ['Tumba el teléfono en el suelo', 'bajo el pecho, con la pantalla hacia arriba'],
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

/** How many times the calibration is retried while the user gets in position. */
const MAX_CALIBRATION_ATTEMPTS = 20;

/** Rounds to three decimals, so the payload stays tidy and comparable. */
function round3(v) {
  return Math.round((v ?? 0) * 1000) / 1000;
}

/** Human readable labels for the camera picker. */
const CAMERA_INFO = {
  [FACING.FRONT]: {
    label: 'Frontal',
    hint: 'Con el teléfono pantalla arriba, es la cámara que mira hacia tu cuerpo.',
  },
  [FACING.BACK]: {
    label: 'Trasera',
    hint: 'Con el teléfono pantalla abajo, es la cámara que mira hacia tu cuerpo.',
  },
};

export function counterView() {
  const state = getState();
  // The mode is read from the settings on every use: it can change while the
  // view is alive, so it must not be captured once and forgotten.
  const modeOf = () => state.settings.mode ?? 'suelo';
  let mode = modeOf();

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
  let audio = new AudioFeedback();
  let rafId = 0;
  let counter = null;
  let filters = createFilters();
  let calib = state.settings.calibration;
  let running = false;
  let rendering = false;
  let startedAt = 0;
  let lastVideoTime = -1;
  let reps = [];
  let frameTimes = [];
  let lastFrameAt = 0;
  let switching = false;
  let calibrating = false;
  // Diagnostics of the current set, shown in the report.
  let totalFrames = 0;
  let poseFrames = 0;
  let confSum = 0;
  let maxFill = 0;
  let minElbow = 0;

  /** The camera to open for the current placement. */
  function currentFacing() {
    return state.settings.camera?.[mode] ?? (mode === 'suelo' ? FACING.FRONT : FACING.BACK);
  }

  function setFacing(facing) {
    const cameraSettings = { ...(state.settings.camera ?? {}), [mode]: facing };
    setSettings({ camera: cameraSettings });
  }

  /* ------------------------------- rendering ------------------------------ */

  function renderGuide() {
    const info = MODE_INFO[mode];
    const facing = currentFacing();
    root.classList.add('counter--guide');
    showChrome(true);
    fill(root, 
      h('div.guide',
        h('div.guide__art', guideArt(mode, facing)),
        h('h2.guide__title', info.title),
        h('p.guide__text', info.text),
        h('div.guide__steps', info.steps.map(([t, d], i) => h('div.guide__step',
          h('span.guide__num', String(i + 1)),
          h('div', h('b', t), ' — ', d),
        ))),

        h('div.field', { style: { width: '100%', maxWidth: '330px', margin: '4px auto 0' } },
          h('label.field__label', 'Cámara'),
          h('div.segmented',
            [FACING.FRONT, FACING.BACK].map((value) => h('button.segmented__item', {
              class: value === facing ? 'is-active' : '',
              onclick: () => {
                setFacing(value);
                hapticSelect();
                renderGuide();
              },
            }, CAMERA_INFO[value].label)),
          ),
          h('div.field__hint', CAMERA_INFO[facing].hint),
        ),

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
    fill(root, stage, bar);
    fill(stage, video, canvas, ringHost, hud, repsBox);
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
    const muted = getState().settings.muted;
    fill(hud, 
      h('div.counter__pill', h('span.counter__dot.counter__dot--live'), mode === 'suelo' ? 'Modo suelo' : 'Modo lateral'),
      h('div.counter__hud-right',
        h('div.counter__pill', { id: 'fps-pill' }, '— fps'),
        h('button.counter__icon', {
          onclick: () => void switchCamera(),
          title: 'Cambiar de cámara',
          'aria-label': 'Cambiar de cámara',
        }, '🔄'),
        h('button.counter__icon', {
          onclick: () => toggleMute(),
          title: muted ? 'Activar el sonido' : 'Silenciar',
          'aria-label': muted ? 'Activar el sonido' : 'Silenciar',
        }, muted ? '🔇' : '🔊'),
      ),
    );
  }

  function toggleMute() {
    const muted = !getState().settings.muted;
    setSettings({ muted });
    audio.setMuted(muted);
    renderHud();
    if (!muted) audio.play('start');
  }

  /**
   * Opens the other camera and recalibrates: the selfie and the rear camera
   * have a different field of view, so the previous reference is meaningless.
   */
  async function switchCamera() {
    if (switching || !camera) return;
    switching = true;
    const next = camera.isFrontFacing() ? FACING.BACK : FACING.FRONT;
    setFacing(next);
    hapticSelect();
    try {
      toast('Abriendo la otra cámara…');
      await camera.switchTo(video, next);
      lastVideoTime = -1;
      filters = createFilters();
      await runCalibration('Cámara cambiada: recalibrando');
      counter?.reset();
      renderHud();
      toast(`Ahora usas la cámara ${CAMERA_INFO[next].label.toLowerCase()}`, 'ok');
    } catch (err) {
      console.error(err);
      toast(err.message ?? 'No se ha podido cambiar de cámara', 'error');
    } finally {
      switching = false;
    }
  }

  function renderBar() {
    fill(bar, 
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
    mode = next;
    calib = null;
    // The engine has to be rebuilt: the segmentation mask is only enabled in
    // the "suelo" mode and the camera choice depends on the placement.
    if (engine) {
      engine.close();
      engine = null;
    }
    renderGuide();
  }

  async function startFlow() {
    try {
      // The click that starts the camera also unlocks the audio context.
      audio.unlock();
      audio.setMuted(getState().settings.muted);

      // Fullscreen only exists inside Telegram.
      if (isTelegram) requestFullscreen();
      lockOrientation();
      renderLive();

      camera = new CameraSession();
      await camera.start(video, { facingMode: currentFacing() });

      engine = new PoseEngine();
      // The depth signal relies on the segmentation mask in "suelo" mode.
      engine.setMasksEnabled(mode === 'suelo');
      await engine.init({ onProgress: (msg) => toast(msg) });

      overlay = new Overlay(canvas, ringHost, video);
      filters = createFilters();

      // The preview has to be on screen before the calibration: this is
      // exactly when the user needs to see where the camera is pointing.
      rendering = true;
      lastFrameAt = performance.now();
      loop();

      if (!isCalibrationValid(calib) || calib.mode !== mode) {
        await runCalibration();
      }
      beginCounting();
    } catch (err) {
      console.error(err);
      stopEverything();
      renderError(err.message ?? 'No se ha podido iniciar la cámara');
    }
  }

  function renderError(message) {
    fill(root, 
      h('div.guide',
        h('div.guide__art', guideArt(mode, currentFacing())),
        h('h2.guide__title', 'No podemos usar la cámara'),
        h('p.guide__text', message),
        h('p.guide__text', 'Alternativas: abre la app en tu navegador (Chrome o Safari) o usa el contador manual desde el perfil.'),
        h('button.btn.btn--block', { style: { maxWidth: '330px' }, onclick: () => renderGuide() }, 'Volver'),
      ),
    );
  }

  async function runCalibration(message = 'Posición de partida: brazos estirados') {
    const overlayNode = h('div.counter__calib',
      h('div',
        h('div.counter__calibNum', '3'),
        h('div.counter__calibText', message),
      ),
    );
    stage.appendChild(overlayNode);
    const numNode = overlayNode.querySelector('.counter__calibNum');
    const textNode = overlayNode.querySelector('.counter__calibText');
    calibrating = true;

    try {
      for (let attempt = 1; attempt <= MAX_CALIBRATION_ATTEMPTS; attempt++) {
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
            onTick: (secondsLeft) => {
              numNode.textContent = String(Math.max(1, secondsLeft));
            },
          });
          calib = result;
          setSettings({ calibration: result });
          return;
        } catch (err) {
          // The body is not in frame yet: keep waiting instead of giving up.
          if (err?.code !== 'NO_POSE_DETECTED') throw err;
          textNode.textContent = 'No te veo todavía: colócate en posición';
          numNode.textContent = '...';
          await new Promise((r) => setTimeout(r, 800));
        }
      }
      throw new Error('No he podido detectar tu cuerpo. Comprueba que la cámara apunta hacia ti y que hay luz suficiente.');
    } finally {
      overlayNode.remove();
      calibrating = false;
    }
  }

  async function recalibrate() {
    if (!engine) return;
    try {
      await runCalibration('Recalibrando: brazos estirados');
      filters = createFilters();
      counter?.reset();
      toast('Calibración actualizada');
    } catch (err) {
      toast(err.message ?? 'No se ha podido calibrar', 'error');
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
          audio.play('valid');
          updateRepsBox();
        } else {
          haptic('light');
          audio.play('invalid');
          toast(event.reasons?.[0] ?? 'repetición no válida');
        }
      },
      onStateChange: () => updateRepsBox(),
    });
    lastFrameAt = performance.now();
    audio.play('start');
  }

  function loop() {
    if (!rendering) return;
    rafId = requestAnimationFrame(loop);

    const ts = performance.now();
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const frame = engine.detect(video, ts);
      let signal = null;

      if (frame) {
        frame.video = video;
        signal = computeSignals(frame, calib, {
          thresholds: { ...DEFAULT_THRESHOLDS, ...(getState().settings.thresholds ?? {}) },
          ...filters,
        });
        // No repetition is counted while the reference is being measured.
        if (!calibrating) counter?.push(signal);

        totalFrames++;
        poseFrames++;
        confSum += signal.confidence ?? 0;
        if (signal.fill > maxFill) maxFill = signal.fill;
        if (signal.angleAvailable && (minElbow === 0 || signal.elbow < minElbow)) {
          minElbow = signal.elbow;
        }

        const dt = ts - lastFrameAt;
        lastFrameAt = ts;
        frameTimes.push(dt);
        if (frameTimes.length > 30) frameTimes.shift();
      } else {
        totalFrames++;
      }

      // The preview is painted even without a pose, so the user can frame
      // themselves while the detector looks for them.
      overlay?.draw(frame, signal, { mirror: camera?.isFrontFacing() });
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
    fill(repsBox, 
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
    audio.play('complete');
    const outcome = await persist(elapsed, counts);
    showResult(elapsed, counts, outcome);
  }

  function stopEverything() {
    running = false;
    rendering = false;
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
    const fps = Math.round(frameTimes.length
      ? 1000 / (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length)
      : 0);
    const avgConf = poseFrames ? confSum / poseFrames : 0;

    const payload = {
      clientId: `w_${startedAt}_${counts.valid}_${counts.invalid}`,
      variant: getState().settings.variant ?? 'standard',
      mode,
      startedAt,
      endedAt: Date.now(),
      localDate: localDate(),
      reps: reps.map((r) => ({
        // Whole numbers on purpose: the server decodes these as integers.
        tMs: Math.round(r.tMs),
        durationMs: Math.round(r.durationMs),
        fillMax: round3(r.fillMax),
        elbowMin: round3(r.elbowMin),
        ok: !!r.ok,
        conf: round3(r.conf),
      })),
      meta: {
        fps,
        engine: 'mediapipe-lite',
        thresholds: { ...DEFAULT_THRESHOLDS, ...(getState().settings.thresholds ?? {}) },
        calibrated: !!calib,
        frames: totalFrames,
        poseFrames,
        avgConf: round3(avgConf),
        maxFill: round3(maxFill),
        minElbow: round3(minElbow),
      },
    };

    const diagnostics = {
      at: Date.now(),
      fps,
      frames: totalFrames,
      poseFrames,
      avgConf: round3(avgConf),
      maxFill: round3(maxFill),
      minElbow: round3(minElbow),
      valid: counts.valid,
      invalid: counts.invalid,
      mode,
      camera: currentFacing(),
    };

    try {
      const res = await api.post('/api/workouts', payload);
      setSettings({ lastSession: { ...diagnostics, saved: true } });
      return { saved: true, response: res, diagnostics };
    } catch (err) {
      console.warn('workout not stored', err);
      // Only a network failure or a server error is worth retrying: a 4xx will
      // be rejected again for ever.
      const retryable = err.status === 0 || err.status >= 500;
      if (retryable) {
        await queueWorkout(payload);
        setSettings({ lastSession: { ...diagnostics, saved: false, queued: true } });
        return {
          saved: false,
          queued: true,
          diagnostics,
          message: 'Sin conexión con el servidor. La serie se guarda en el dispositivo y se subirá sola.',
        };
      }
      setSettings({ lastSession: { ...diagnostics, saved: false, queued: false, error: err.message } });
      return {
        saved: false,
        queued: false,
        diagnostics,
        message: `El servidor rechazó la serie: ${err.message}`,
      };
    }
  }

  function showResult(elapsed, counts, outcome) {
    const content = h('div');
    content.append(
      h('div.result__big',
        h('div.result__bigNum', String(counts.valid)),
        h('div.card__sub', counts.invalid > 0
          ? `${counts.invalid} repeticiones incompletas`
          : '¡Serie perfecta!'),
      ),
    );

    // The outcome of the upload, always visible.
    if (outcome) {
      content.appendChild(h('div.result__status', {
        class: outcome.saved ? 'result__status--ok' : 'result__status--warn',
      }, outcome.saved
        ? 'Guardada en el servidor'
        : (outcome.message ?? 'No se ha podido guardar la serie')));
    }
    if (counts.valid === 0) {
      content.appendChild(h('p.card__sub', { style: { textAlign: 'center' } },
        'No he detectado ninguna flexión válida. Revisa la colocación del móvil o baja la exigencia en Perfil → Sensibilidad.'));
    }

    const { close } = openModal(content, { onClose: () => { location.hash = '#/stats'; } });

    const summary = h('div.result__grid');
    content.append(summary);
    content.append(diagnosticsBlock(outcome?.diagnostics));
    content.append(
      h('button.btn.btn--block', {
        onclick: async () => {
          close();
          location.hash = '#/stats';
        },
      }, 'Ver mis estadísticas'),
    );

    // /api/me/summary only answers GET: posting here answered 405 and the
    // summary of the modal never loaded.
    api.get('/api/me/summary').then((data) => {
      fill(summary, 
        h('div.tile', h('div.tile__label', 'Duración'), h('div.tile__value', fmtDuration(elapsed))),
        h('div.tile', h('div.tile__label', 'Ritmo'), h('div.tile__value',
          fmtNumber((counts.valid / Math.max(1, elapsed / 60000)) * 10) / 10, h('span.tile__unit', 'rep/min'))),
        h('div.tile', h('div.tile__label', 'Puntos'), h('div.tile__value',
          fmtNumber(data?.summary?.totalPoints ?? 0))),
        h('div.tile', h('div.tile__label', 'Total'), h('div.tile__value',
          fmtNumber(data?.summary?.totalReps ?? 0))),
      );
    }).catch(() => {
      fill(summary, 
        h('div.tile', h('div.tile__label', 'Duración'), h('div.tile__value', fmtDuration(elapsed))),
      );
    });

    hapticNotify('success');
  }

  /** The numbers of the last set, so a failed upload can be diagnosed. */
  function diagnosticsBlock(diag) {
    if (!diag) return null;
    const rows = [
      ['fps', `${diag.fps}`],
      ['frames con pose', `${diag.poseFrames} de ${diag.frames}`],
      ['confianza media', fmtNumber(diag.avgConf * 100) + ' %'],
      ['profundidad máx.', fmtNumber(diag.maxFill * 100) + ' %'],
      ['ángulo mín. codo', diag.minElbow ? `${Math.round(diag.minElbow)}°` : 'n/d'],
    ];
    return h('details.result__diag',
      h('summary', 'Diagnóstico de la serie'),
      h('div.result__diagRows', rows.map(([k, v]) => h('div.result__diagRow',
        h('span', k),
        h('b', v),
      ))),
    );
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

/**
 * Placement diagram, side view: the phone lies on the floor and the person is
 * in the plank position. The cone shows what the camera sees, which is the
 * thing the old drawing did not communicate at all.
 *
 * @param {string} mode   'suelo' | 'perfil'
 * @param {string} facing 'user' | 'environment'
 */
function guideArt(mode, facing = FACING.FRONT) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 160 110');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.color = 'var(--accent)';

  const add = (tag, attrs) => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.appendChild(node);
    return node;
  };

  const suelo = mode === 'suelo';

  // The floor.
  add('path', { d: 'M8 96 H152', opacity: '.22', 'stroke-width': '2' });

  // The person, in plank, seen from the side and facing left. In the lateral
  // mode the body is shifted to the right so the phone has its own space.
  const dx = suelo ? 0 : 18;
  add('circle', { cx: 44 + dx, cy: '30', r: '10' });
  add('path', { d: `M${52 + dx} 37 L${94 + dx} 52` });          // back
  add('path', { d: `M${52 + dx} 37 L${42 + dx} 62 L${34 + dx} 96` }); // arm
  add('path', { d: `M${94 + dx} 52 L${112 + dx} 74 L${126 + dx} 96` }); // leg

  if (suelo) {
    // The phone lies right under the chest, with the lens on the upper face.
    add('path', {
      d: 'M66 88 L50 46 L82 46 Z',
      fill: 'currentColor', 'fill-opacity': '.13', stroke: 'none',
    });
    add('path', { d: 'M66 88 L50 46 M66 88 L82 46', opacity: '.3', 'stroke-width': '1.6' });
    add('rect', { x: '50', y: '88', width: '32', height: '9', rx: '2.5', fill: 'var(--bg)' });
    add('circle', { cx: '66', cy: '87', r: '3', fill: 'currentColor', stroke: 'none' });
    // The screen is the visible face when the selfie camera is used.
    if (facing === FACING.FRONT) {
      add('path', { d: 'M55 91 H71', opacity: '.45', 'stroke-width': '1.6' });
    }
  } else {
    // The phone lies on the floor at one side, aimed at the whole body.
    add('path', {
      d: 'M26 92 L74 34 L74 72 Z',
      fill: 'currentColor', 'fill-opacity': '.13', stroke: 'none',
    });
    add('path', { d: 'M26 92 L74 34 M26 92 L74 72', opacity: '.3', 'stroke-width': '1.6' });
    add('rect', { x: '4', y: '87', width: '22', height: '9', rx: '2.5', fill: 'var(--bg)' });
    add('circle', { cx: '26', cy: '91', r: '3', fill: 'currentColor', stroke: 'none' });
    if (facing === FACING.FRONT) {
      add('path', { d: 'M8 90 H16', opacity: '.45', 'stroke-width': '1.6' });
    }
  }

  return svg;
}
