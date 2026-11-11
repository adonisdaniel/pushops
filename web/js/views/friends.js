// Friends: requests, list and the head-to-head comparison.

import { api } from '../api.js';
import { h, fmtNumber, fmtDecimal, avatar, loading, emptyState, toast, promptModal, confirmModal } from '../ui.js';

const METRICS = [
  { key: 'points', label: 'Puntos' },
  { key: 'reps', label: 'Flexiones' },
  { key: 'pace', label: 'Ritmo' },
  { key: 'best_set', label: 'Mejor serie' },
  { key: 'streak', label: 'Racha' },
];

export function friendsView() {
  const el = h('div');
  const content = h('div', loading());
  el.appendChild(content);

  async function load() {
    try {
      const data = await api.get('/api/friends');
      render(data);
    } catch (err) {
      content.replaceChildren(emptyState('⚠️', 'No se pudieron cargar tus amigos', err.message));
    }
  }

  function render({ friends = [], incoming = [] } = {}) {
    const friendList = friends ?? [];
    const incomingList = incoming ?? [];
    content.replaceChildren(
      h('div.view__section',
        h('button.btn.btn--block', { onclick: addFriend }, 'Añadir amigo'),
      ),

      incomingList.length
        ? h('div.view__section',
          h('div.section-head', h('h2', 'Solicitudes pendientes')),
          h('div.list', incomingList.map((f) => h('div.row',
            avatar(f),
            h('div.row__body',
              h('div.row__title', f.nickname),
              h('div.row__sub', `te ha enviado una solicitud${f.tgUsername ? ` · @${f.tgUsername}` : ''}`),
            ),
            h('div', { style: { display: 'flex', gap: '6px' } },
              h('button.btn.btn--sm', {
                onclick: async () => {
                  try {
                    await api.post(`/api/friends/requests/${f.id}/respond`, { accept: true });
                    toast('Ahora sois amigos', 'ok');
                    load();
                  } catch (err) { toast(err.message, 'error'); }
                },
              }, 'Aceptar'),
              h('button.btn.btn--sm.btn--ghost', {
                onclick: async () => {
                  try {
                    await api.post(`/api/friends/requests/${f.id}/respond`, { accept: false });
                    load();
                  } catch (err) { toast(err.message, 'error'); }
                },
              }, 'Rechazar'),
            ),
          ))),
        )
        : null,

      h('div.view__section',
        h('div.section-head', h('h2', `Tus amigos (${friendList.length})`)),
        friendList.length
          ? h('div.list', friendList.map(friendRow))
          : h('div.card.card--flat', emptyState('👥', 'Aún no tienes amigos', 'Busca a alguien por su nickname y compite con él.')),
      ),

      friendList.length > 1 ? compareSection(friendList) : null,
    );
  }

  function friendRow(f) {
    return h('div.row',
      avatar(f),
      h('div.row__body',
        h('div.row__title', f.nickname),
        h('div.row__sub', f.tgUsername ? `@${f.tgUsername}` : 'Amigo'),
      ),
      h('button.btn.btn--sm.btn--ghost', {
        onclick: async (e) => {
          e.stopPropagation();
          const ok = await confirmModal({
            title: 'Eliminar amigo',
            message: `¿Seguro que quieres quitar a ${f.nickname} de tu lista?`,
            confirmText: 'Eliminar',
            danger: true,
          });
          if (!ok) return;
          try {
            await api.del(`/api/friends/${f.id}`);
            toast('Amigo eliminado');
            load();
          } catch (err) { toast(err.message, 'error'); }
        },
      }, 'Quitar'),
    );
  }

  function compareSection(friends) {
    const ids = friends.map((f) => f.userId).join(',');
    const wrap = h('div.view__section', { id: 'comparativa' },
      h('div.section-head', h('h2', 'Comparativa')),
      h('div.card', loading('Comparando…')),
    );

    const metricBar = h('div.segmented',
      METRICS.slice(0, 3).map((m) => h('button.segmented__item', {
        class: m.key === 'points' ? 'is-active' : '',
        onclick: async (e) => {
          [...e.currentTarget.parentElement.children].forEach((c) => c.classList.remove('is-active'));
          e.currentTarget.classList.add('is-active');
          await loadCompare(m.key);
        },
      }, m.label)),
    );

    async function loadCompare(metric = 'points') {
      const body = wrap.querySelector('.card');
      body.replaceChildren(loading('Comparando…'));
      try {
        const data = await api.get(`/api/friends/compare?ids=${ids}&metric=${metric}`);
        const entries = data.entries ?? [];
        if (!entries.length) {
          body.replaceChildren(emptyState('📊', 'Nada que comparar', 'Haced una serie cada uno.'));
          return;
        }
        const max = Math.max(...entries.map((e) => e.value), 1);
        body.replaceChildren(
          h('div', { style: { marginBottom: '14px' } }, metricBar),
          h('div.list', entries.map((e) => h('div.row',
            h('span.rank', { class: e.rank <= 3 ? `rank--${e.rank}` : '' }, String(e.rank)),
            avatar(e, 'sm'),
            h('div.row__body',
              h('div.row__title', e.nickname, e.isMe ? h('span.badge.badge--accent', { style: { marginLeft: '6px' } }, 'tú') : null),
              h('div.bar', { style: { marginTop: '5px' } },
                h('div.bar__fill', { style: { width: `${(e.value / max) * 100}%` } })),
            ),
            h('div.row__value', fmtDecimal(e.value, 0)),
          ))),
        );
      } catch (err) {
        body.replaceChildren(emptyState('⚠️', 'No se pudo comparar', err.message));
      }
    }
    void loadCompare();
    return wrap;
  }

  async function addFriend() {
    const query = await promptModal({
      title: 'Añadir amigo',
      label: 'Nickname o usuario de Telegram',
      placeholder: 'Tigre Veloz',
      hint: 'Busca por el nickname de PushOps o por su @usuario de Telegram.',
      confirmText: 'Buscar',
    });
    if (!query) return;

    try {
      const results = await api.get(`/api/users/search?q=${encodeURIComponent(query)}`);
      const users = results.users ?? [];
      if (!users.length) {
        toast('No hay nadie con ese nombre', 'error');
        return;
      }
      const target = users[0];
      const ok = await confirmModal({
        title: 'Enviar solicitud',
        message: `¿Enviar una solicitud de amistad a ${target.nickname}?`,
        confirmText: 'Enviar',
      });
      if (!ok) return;
      await api.post('/api/friends/requests', { query: target.nickname });
      toast('Solicitud enviada', 'ok');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  load();
  return { el };
}
