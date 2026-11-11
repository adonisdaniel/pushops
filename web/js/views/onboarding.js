// First run: show the nickname the server assigned and let the user tune it.

import { api } from '../api.js';
import { setState } from '../store.js';
import { hapticNotify } from '../tg.js';
import { h, toast, promptModal } from '../ui.js';

export function onboardingView(user, onDone) {
  const el = h('div.onboard');

  const nicknameValue = h('span', user.nickname);

  el.append(
    h('div.onboard__logo',
      h('svg', { viewBox: '0 0 24 24', width: '38', height: '38', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
        h('path', { d: 'M6.5 6.5v11' }), h('path', { d: 'M17.5 6.5v11' }),
        h('path', { d: 'M3 9v6' }), h('path', { d: 'M21 9v6' }),
        h('path', { d: 'M6.5 12h11' }),
      ),
    ),
    h('h1.onboard__title', 'Bienvenido a PushOps'),
    h('p.onboard__text', 'Te hemos asignado un nickname. Puedes quedártelo o cambiarlo cuando quieras.'),
    h('div.onboard__nick', nicknameValue),
    h('button.btn.btn--ghost.btn--block', {
      style: { maxWidth: '330px', margin: '0 auto' },
      onclick: async () => {
        const value = await promptModal({
          title: 'Elige tu nickname',
          label: 'Nickname público',
          value: user.nickname,
          hint: '3–24 caracteres, único en toda la comunidad.',
          confirmText: 'Guardar',
        });
        if (!value) return;
        try {
          const data = await api.patch('/api/me', { nickname: value });
          setState({ user: data.user });
          nicknameValue.textContent = data.user.nickname;
          toast('Nickname actualizado', 'ok');
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    }, 'Cambiar nickname'),
    h('div', { style: { width: '100%', maxWidth: '330px', margin: '0 auto' } },
      h('button.btn.btn--block', {
        onclick: async () => {
          const value = await promptModal({
            title: 'Tu peso',
            label: 'Peso corporal en kg',
            value: String(user.weightKg ?? 70),
            hint: 'Opcional. Los puntos se normalizan con el peso para que la comparación sea justa.',
            confirmText: 'Guardar',
          });
          if (!value) return;
          const weight = Number(value.replace(',', '.'));
          if (!Number.isFinite(weight) || weight < 25 || weight > 250) {
            toast('Introduce un peso entre 25 y 250 kg', 'error');
            return;
          }
          try {
            const data = await api.patch('/api/me', { weightKg: weight });
            setState({ user: data.user });
            toast('Peso guardado', 'ok');
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      }, 'Ahora o más tarde: indicar mi peso'),
    ),
    h('button.btn.btn--block', {
      style: { maxWidth: '330px', margin: '0 auto', background: 'transparent', color: 'var(--fg)' },
      onclick: () => {
        hapticNotify('success');
        onDone?.();
      },
    }, 'Empezar a contar flexiones →'),
  );

  return { el };
}
