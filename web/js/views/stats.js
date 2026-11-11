// Personal statistics: totals, trends and the history of sets.

import { api } from '../api.js';
import { getState, setState } from '../store.js';
import { h, fmtNumber, fmtDecimal, fmtDuration, fmtRelative, barChart, loading, emptyState } from '../ui.js';

const RANGES = [
  { key: '7', label: '7 días', days: 7 },
  { key: '30', label: '30 días', days: 30 },
  { key: '90', label: '90 días', days: 90 },
  { key: '0', label: 'Todo', days: 0 },
];

let activeRange = '30';

export function statsView() {
  const el = h('div');
  const content = h('div', loading('Cargando tus estadísticas…'));
  el.appendChild(content);

  async function load() {
    const days = RANGES.find((r) => r.key === activeRange)?.days ?? 30;
    const to = Date.now();
    const from = days > 0 ? to - days * 86400000 : 0;

    try {
      const [summary, series, workouts] = await Promise.all([
        api.get(`/api/me/summary?from=${from}&to=${to}`),
        api.get(`/api/me/timeseries?from=${from}&to=${to}&bucket=day`),
        api.get('/api/me/workouts?limit=20'),
      ]);
      setState({ summary: summary.summary, series: series.buckets });
      render(summary, series, workouts);
    } catch (err) {
      content.replaceChildren(emptyState('⚠️', 'No se pudieron cargar tus estadísticas', err.message));
    }
  }

  function render(summary, series, workouts) {
    const s = summary?.summary ?? {};
    const buckets = series?.buckets ?? [];
    const totalValid = buckets.reduce((a, b) => a + b.reps, 0);

    const rangeBar = h('div.segmented',
      RANGES.map((r) => h('button.segmented__item', {
        class: r.key === activeRange ? 'is-active' : '',
        onclick: () => { activeRange = r.key; load(); },
      }, r.label)),
    );

    const chartItems = buckets.slice(-30).map((b) => ({
      label: b.date,
      value: b.reps,
    }));

    content.replaceChildren(
      h('div.view__section', rangeBar),

      h('div.stat-hero',
        h('div.stat-hero__num', fmtNumber(s.validReps ?? 0)),
        h('div.stat-hero__label', `flexiones válidas · últimos ${RANGES.find((r) => r.key === activeRange)?.label.toLowerCase()}`),
        h('div.stat-hero__sub',
          h('span.badge.badge--accent', `${fmtNumber(s.totalPoints ?? 0)} pts`),
          h('span.badge', `${s.workouts ?? 0} series`),
          s.streak ? h('span.badge.badge--warn', `🔥 ${s.streak} días`) : null,
        ),
      ),

      h('div.view__section',
        h('div.tiles',
          h('div.tile', h('div.tile__label', 'Repeticiones'), h('div.tile__value', fmtNumber(s.totalReps ?? 0))),
          h('div.tile', h('div.tile__label', 'Mejor serie'), h('div.tile__value', fmtNumber(s.bestSet ?? 0))),
          h('div.tile', h('div.tile__label', 'Ritmo'), h('div.tile__value', fmtDecimal(s.avgPace ?? 0), h('span.tile__unit', '/min'))),
          h('div.tile', h('div.tile__label', 'Días activos'), h('div.tile__value', fmtNumber(s.activeDays ?? 0))),
        ),
      ),

      h('div.view__section',
        h('div.section-head', h('h2', 'Evolución diaria')),
        chartItems.length
          ? h('div.card',
            barChart(chartItems),
            h('div.flex-between.small.muted', { style: { marginTop: '6px' } },
              h('span', 'Últimos 30 días'),
              h('span', `${fmtNumber(totalValid)} repeticiones`),
            ),
          )
          : h('div.card.card--flat', emptyState('📈', 'Todavía no hay datos', 'Haz tu primera serie para ver la evolución.')),
      ),

      h('div.view__section',
        h('div.section-head', h('h2', 'Historial de series')),
        workouts?.workouts?.length
          ? h('div.list', workouts.workouts.map(workoutRow))
          : h('div.card.card--flat', emptyState('🏋️', 'Sin series todavía', 'Ve al contador y haz tu primera flexión.')),
      ),
    );
  }

  function workoutRow(w) {
    return h('div.row',
      h('div.avatar.avatar--sm', { style: { background: 'var(--surface-2)', color: 'var(--fg-muted)' } },
        w.mode === 'perfil' ? '📐' : '🔽'),
      h('div.row__body',
        h('div.row__title', `${fmtNumber(w.repsValid)} flexiones`),
        h('div.row__sub', `${fmtRelative(w.startedAt)} · ${fmtDuration(w.durationMs)} · ${w.variant}`),
      ),
      h('div.row__value', fmtNumber(w.points), h('small', ' pts')),
    );
  }

  load();
  return { el };
}
