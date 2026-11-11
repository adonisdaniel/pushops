// Groups: create, join by invite code and per-group leaderboards.

import { api } from '../api.js';
import { h, fmtNumber, fmtDecimal, avatar, loading, emptyState, toast, promptModal, confirmModal } from '../ui.js';

export function groupsView() {
  const el = h('div');
  const content = h('div', loading());
  el.appendChild(content);

  async function load() {
    try {
      const data = await api.get('/api/groups');
      render(data.groups ?? []);
    } catch (err) {
      content.replaceChildren(emptyState('⚠️', 'No se pudieron cargar tus grupos', err.message));
    }
  }

  function render(groups) {
    content.replaceChildren(
      h('div.view__section',
        h('div', { style: { display: 'flex', gap: '8px' } },
          h('button.btn.grow', { onclick: createGroup }, 'Crear grupo'),
          h('button.btn.btn--ghost.grow', { onclick: joinGroup }, 'Unirme con un código'),
        ),
      ),

      groups.length
        ? h('div.view__section', h('div.list', groups.map(groupRow)))
        : h('div.view__section', h('div.card.card--flat', emptyState(
          '🏆', 'Todavía no hay grupos',
          'Crea uno e invita a tus amigos con el código de invitación.'))),
    );
  }

  function groupRow(g) {
    return h('div.row.row--tap', {
      onclick: () => { location.hash = `#/groups/${g.id}`; },
    },
    h('div.avatar.avatar--sm', { style: { background: 'var(--surface-2)', color: 'var(--fg)' } }, '🏆'),
    h('div.row__body',
      h('div.row__title', g.name),
      h('div.row__sub', `${g.memberCount ?? 0} miembros · ${g.inviteCode}`),
    ),
    g.role === 'owner' ? h('span.badge.badge--accent', 'dueño') : null,
    );
  }

  async function createGroup() {
    const name = await promptModal({
      title: 'Nuevo grupo',
      label: 'Nombre del grupo',
      placeholder: 'Los del Muelle',
      hint: 'Recibirás un código para invitar a tus amigos.',
      confirmText: 'Crear',
    });
    if (!name) return;
    try {
      const data = await api.post('/api/groups', { name, isPrivate: true });
      toast('Grupo creado. Invita a tus amigos con el código.', 'ok');
      location.hash = `#/groups/${data.group.id}`;
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function joinGroup() {
    const code = await promptModal({
      title: 'Unirme a un grupo',
      label: 'Código de invitación',
      placeholder: 'K7Q-M2P',
      confirmText: 'Unirme',
    });
    if (!code) return;
    try {
      const data = await api.post('/api/groups/join', { code });
      toast(`Te has unido a ${data.group.name}`, 'ok');
      location.hash = `#/groups/${data.group.id}`;
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  load();
  return { el };
}

/** Detail view of a single group with its leaderboard and totals. */
export function groupDetailView(route) {
  const el = h('div');
  const content = h('div', loading());
  el.appendChild(content);
  const groupId = route.params[0];

  async function load() {
    try {
      const [group, stats, board] = await Promise.all([
        api.get(`/api/groups/${groupId}`),
        api.get(`/api/groups/${groupId}/stats`),
        api.get(`/api/groups/${groupId}/leaderboard?metric=points`),
      ]);
      render(group.group, stats, board.entries ?? []);
    } catch (err) {
      content.replaceChildren(emptyState('⚠️', 'No se pudo cargar el grupo', err.message));
    }
  }

  function render(group, stats, entries) {
    const totals = stats.totals ?? {};
    const members = stats.members ?? [];
    const max = Math.max(...members.map((m) => m.value), 1);

    content.replaceChildren(
      h('div.view__section',
        h('div.card',
          h('div.flex-between',
            h('div',
              h('div.card__title', { style: { fontSize: '19px' } }, group.name),
              h('div.card__sub', `${group.memberCount} miembros · ${group.role === 'owner' ? 'dueño' : 'miembro'}`),
            ),
            h('button.btn.btn--sm.btn--soft', {
              onclick: async () => {
                try {
                  await navigator.clipboard.writeText(group.inviteCode);
                  toast('Código copiado', 'ok');
                } catch { toast(group.inviteCode); }
              },
            }, group.inviteCode),
          ),
          h('div.divider'),
          h('div.tiles.tiles--3',
            h('div.tile', h('div.tile__label', 'Total'), h('div.tile__value', fmtNumber(totals.totalReps ?? 0))),
            h('div.tile', h('div.tile__label', 'Puntos'), h('div.tile__value', fmtNumber(totals.totalPoints ?? 0))),
            h('div.tile', h('div.tile__label', 'Media/día'), h('div.tile__value', fmtDecimal(totals.avgPerDay ?? 0))),
          ),
        ),
      ),

      h('div.view__section',
        h('div.section-head', h('h2', 'Ranking del grupo')),
        entries.length
          ? h('div.list', entries.map((e) => h('div.row',
            h('span.rank', { class: e.rank <= 3 ? `rank--${e.rank}` : '' }, String(e.rank)),
            avatar(e, 'sm'),
            h('div.row__body',
              h('div.row__title', e.nickname, e.isMe ? h('span.badge.badge--accent', { style: { marginLeft: '6px' } }, 'tú') : null),
              h('div.bar', { style: { marginTop: '5px' } },
                h('div.bar__fill', { style: { width: `${(e.value / max) * 100}%` } })),
            ),
            h('div.row__value', fmtNumber(e.value), h('small', ' pts')),
          )))
          : h('div.card.card--flat', emptyState('📊', 'Sin datos todavía', 'Haced una serie cada uno.')),
      ),

      h('div.view__section',
        h('button.btn.btn--danger.btn--block', {
          onclick: async () => {
            const ok = await confirmModal({
              title: 'Salir del grupo',
              message: `¿Quieres salir de ${group.name}?`,
              confirmText: 'Salir',
              danger: true,
            });
            if (!ok) return;
            try {
              await api.post(`/api/groups/${groupId}/leave`);
              location.hash = '#/groups';
            } catch (err) { toast(err.message, 'error'); }
          },
        }, 'Salir del grupo'),
      ),
    );
  }

  load();
  return { el };
}
