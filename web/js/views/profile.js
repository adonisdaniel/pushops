// Profile: nickname, body weight, variant, detector tuning and session.

import { api } from '../api.js';
import { getState, setSettings, setState } from '../store.js';
import { h, fmtNumber, avatar, loading, toast, promptModal, confirmModal, openModal } from '../ui.js';
import { hapticSelect } from '../tg.js';
import { DEFAULT_THRESHOLDS } from '../pose/metrics.js';

export function profileView() {
  const el = h('div');
  const content = h('div', loading());
  el.appendChild(content);

  async function load() {
    try {
      const me = await api.get('/api/me');
      setState({ user: me.user });
      render(me.user, me.weightStale);
    } catch (err) {
      content.replaceChildren(h('div.empty', h('div.empty__icon', '⚠️'), h('div.empty__hint', err.message)));
    }
  }

  function render(user, weightStale) {
    const state = getState();
    const thresholds = { ...DEFAULT_THRESHOLDS, ...(state.settings.thresholds ?? {}) };

    content.replaceChildren(
      h('div.view__section',
        h('div.card',
          h('div.flex',
            avatar(user, 'lg'),
            h('div.grow',
              h('div.card__title', { style: { fontSize: '18px' } }, user.nickname),
              h('div.card__sub', user.tgUsername ? `@${user.tgUsername}` : 'Miembro de PushOps'),
              h('div', { style: { marginTop: '6px', display: 'flex', gap: '6px', flexWrap: 'wrap' } },
                h('span.badge', `Nivel ${user.trustLevel}`),
                h('span.badge', `${fmtNumber(user.weightKg)} kg`),
              ),
            ),
          ),
          h('div.divider'),
          h('div', { style: { display: 'flex', gap: '8px' } },
            h('button.btn.btn--ghost.grow', { onclick: changeNickname }, 'Cambiar nickname'),
            h('button.btn.btn--ghost.grow', { onclick: changeWeight }, 'Cambiar peso'),
          ),
          weightStale
            ? h('div.field__hint', { style: { marginTop: '10px', color: 'var(--warn)' } },
              'Confirma tu peso para aparecer en el ranking global de puntos.')
            : null,
        ),
      ),

      h('div.view__section',
        h('div.section-head', h('h2', 'Tipo de flexión')),
        h('div.card',
          h('div.field',
            h('label.field__label', 'Variante'),
            variantPicker(user.nickname),
          ),
        ),
      ),

      h('div.view__section',
        h('div.section-head', h('h2', 'Contador')),
        h('div.card',
          h('div.field',
            h('label.field__label', 'Posición de la cámara'),
            modePicker(),
          ),
          h('button.btn.btn--ghost.btn--block', { onclick: openTuner }, 'Ajustar sensibilidad del contador'),
        ),
      ),

      h('div.view__section',
        h('div.section-head', h('h2', 'Cuenta')),
        h('div.list',
          h('div.row',
            h('div.row__body', h('div.row__title', 'Cerrar sesión')),
            h('button.btn.btn--sm.btn--danger', { onclick: signOut }, 'Salir'),
          ),
        ),
      ),
    );
  }

  function variantPicker(current) {
    const list = [
      ['standard', 'Estándar'], ['wide', 'Anchas'], ['diamond', 'Diamante'],
      ['pike', 'Pike'], ['knees', 'Rodillas'], ['decline', 'Pies elevados'],
      ['archer', 'Archer'], ['one_arm', 'Una mano'], ['hspu', 'HSPU'],
    ];
    const wrap = h('div.segmented', { style: { gridAutoFlow: 'row', gridTemplateColumns: 'repeat(3, 1fr)' } });
    for (const [key, label] of list) {
      wrap.appendChild(h('button.segmented__item', {
        class: key === (getState().settings.variant ?? 'standard') ? 'is-active' : '',
        onclick: (e) => {
          [...e.currentTarget.parentElement.children].forEach((c) => c.classList.remove('is-active'));
          e.currentTarget.classList.add('is-active');
          setSettings({ variant: key });
          hapticSelect();
        },
      }, label));
    }
    void current;
    return wrap;
  }

  function modePicker() {
    const wrap = h('div.segmented');
    for (const [key, label] of [['suelo', 'Bajo el cuerpo'], ['perfil', 'Al lado']]) {
      wrap.appendChild(h('button.segmented__item', {
        class: key === (getState().settings.mode ?? 'suelo') ? 'is-active' : '',
        onclick: (e) => {
          [...e.currentTarget.parentElement.children].forEach((c) => c.classList.remove('is-active'));
          e.currentTarget.classList.add('is-active');
          setSettings({ mode: key, calibration: null });
          hapticSelect();
        },
      }, label));
    }
    return wrap;
  }

  function openTuner() {
    const current = { ...DEFAULT_THRESHOLDS, ...(getState().settings.thresholds ?? {}) };
    const content = h('div');
    content.append(
      h('h3.card__title', { style: { fontSize: '18px', marginBottom: '4px' } }, 'Sensibilidad'),
      h('p.card__sub', { style: { marginBottom: '14px' } },
        'Si cuenta flexiones que no haces, sube la exigencia. Si se le escapan, bájala.'),
    );

    const rows = [
      ['fillTarget', 'Exigencia de profundidad', 0.3, 0.95, 0.01, (v) => v.toFixed(2)],
      ['angleFlexed', 'Ángulo de flexión (°)', 60, 130, 1, (v) => `${v}°`],
      ['angleExtended', 'Ángulo de extensión (°)', 140, 178, 1, (v) => `${v}°`],
      ['targetRatio', 'Ratio de acercamiento', 1.4, 3.5, 0.1, (v) => `${v.toFixed(1)}×`],
      ['minRepMs', 'Duración mínima (ms)', 400, 2000, 50, (v) => `${v} ms`],
    ];

    const values = { ...current };
    for (const [key, label, min, max, step, format] of rows) {
      const output = h('span.badge.badge--accent', format(values[key]));
      const input = h('input', {
        type: 'range', min, max, step, value: values[key],
        style: { width: '100%' },
        oninput: (e) => {
          values[key] = Number(e.target.value);
          output.textContent = format(values[key]);
        },
      });
      content.appendChild(h('div.field',
        h('div.flex-between', h('label.field__label', label), output),
        input,
      ));
    }

    const { close } = openModal(content);
    content.appendChild(h('button.btn.btn--block', {
      style: { marginTop: '10px' },
      onclick: () => {
        setSettings({ thresholds: values });
        close();
        toast('Sensibilidad guardada', 'ok');
      },
    }, 'Guardar'));
  }

  async function changeNickname() {
    const value = await promptModal({
      title: 'Cambiar nickname',
      label: 'Tu nickname público',
      value: getState().user?.nickname ?? '',
      hint: '3–24 caracteres. Debe ser único.',
      confirmText: 'Guardar',
    });
    if (!value) return;
    try {
      await api.patch('/api/me', { nickname: value });
      toast('Nickname actualizado', 'ok');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function changeWeight() {
    const value = await promptModal({
      title: 'Peso corporal',
      label: 'Peso en kg',
      value: String(getState().user?.weightKg ?? 70),
      hint: 'Se usa para puntuar: los puntos normalizan según el peso.',
      confirmText: 'Guardar',
    });
    if (!value) return;
    const weight = Number(value.replace(',', '.'));
    if (!Number.isFinite(weight) || weight < 25 || weight > 250) {
      toast('Introduce un peso entre 25 y 250 kg', 'error');
      return;
    }
    try {
      await api.patch('/api/me', { weightKg: weight });
      toast('Peso actualizado', 'ok');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function signOut() {
    const ok = await confirmModal({
      title: 'Cerrar sesión',
      message: 'Se borrará la sesión de este dispositivo. Tus datos quedan guardados.',
      confirmText: 'Salir',
      danger: true,
    });
    if (!ok) return;
    localStorage.removeItem('pushops.token');
    location.reload();
  }

  load();
  return { el };
}
