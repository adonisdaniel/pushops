// DOM helpers, formatters, toasts, modals and the small chart primitives.

/** Hyperscript: h('div.card', {onclick}, child, ...) */
export function h(spec, props = null, ...children) {
  const [tagPart, ...classes] = String(spec).split('.');
  const tag = tagPart || 'div';
  const node = document.createElement(tag);
  if (classes.length) node.className = classes.join(' ');

  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = `${node.className} ${value}`.trim();
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') node.innerHTML = value;
    else if (key in node && key !== 'list' && typeof value !== 'object') node[key] = value;
    else node.setAttribute(key, value);
  }
  append(node, children);
  return node;
}

function append(parent, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/**
 * Replaces the children of a node, discarding the empty ones.
 *
 * `replaceChildren` turns a null into the literal text "null", which used to
 * leave two stray "null" on the friends screen and one on the profile.
 */
export function fill(node, ...children) {
  const list = children
    .flat(4)
    .filter((child) => child !== null && child !== undefined && child !== false);
  node.replaceChildren(...list);
  return node;
}

/** Parse an HTML string into a node. */
export function el(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

/* ------------------------------ formatters ------------------------------ */

export function fmtNumber(n) {
  return new Intl.NumberFormat('es-ES').format(Math.round(n ?? 0));
}

export function fmtDecimal(n, digits = 1) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: digits }).format(n ?? 0);
}

export function fmtDuration(ms) {
  const total = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  } catch { return ''; }
}

export function fmtDateTime(iso) {
  try {
    return new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

export function fmtRelative(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `hace ${d} d`;
  return fmtDate(iso);
}

/** Local YYYY-MM-DD for the user's timezone. */
export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* -------------------------------- toasts -------------------------------- */

export function toast(message, kind = '') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = h('div.toast', { class: kind ? `toast--${kind}` : '' }, message);
  host.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s, transform .25s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 260);
  }, kind === 'error' ? 4200 : 2600);
}

/* -------------------------------- modals -------------------------------- */

export function openModal(content, { onClose } = {}) {
  const root = document.getElementById('modal-root');
  const backdrop = h('div.modal-backdrop', {
    onclick: (e) => { if (e.target === backdrop) close(); },
  });
  const modal = h('div.modal');
  modal.appendChild(content);
  backdrop.appendChild(modal);
  root.appendChild(backdrop);
  document.body.style.overflow = 'hidden';

  function close() {
    backdrop.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    onClose?.();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);
  return { close, modal, backdrop };
}

export function confirmModal({ title, message, confirmText = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    // A promise settles once: the value has to be decided before closing the
    // modal, because closing it triggers onClose.
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const content = h('div');
    content.appendChild(h('h3.card__title', { style: { fontSize: '18px', marginBottom: '6px' } }, title));
    content.appendChild(h('p.card__sub', { style: { marginBottom: '18px' } }, message));
    const actions = h('div', { style: { display: 'flex', gap: '10px' } });
    const { close } = openModal(content, { onClose: () => settle(false) });
    actions.append(
      h('button.btn.btn--ghost.grow', { onclick: () => { settle(false); close(); } }, 'Cancelar'),
      h('button.btn.grow', {
        class: danger ? 'btn--danger' : '',
        onclick: () => { settle(true); close(); },
      }, confirmText),
    );
    content.appendChild(actions);
  });
}

export function promptModal({ title, label, value = '', placeholder = '', hint = '', confirmText = 'Guardar' }) {
  return new Promise((resolve) => {
    // Same rule as confirmModal: the value is settled before the modal closes,
    // otherwise onClose resolves the promise with null and the value is lost.
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const input = h('input.input', { type: 'text', value, placeholder, autocomplete: 'off' });
    const error = h('div.field__error', { hidden: true });
    const content = h('div');
    content.append(
      h('h3.card__title', { style: { fontSize: '18px', marginBottom: '14px' } }, title),
      h('div.field',
        h('label.field__label', label),
        input,
        error,
        hint ? h('div.field__hint', hint) : null,
      ),
    );
    const { close } = openModal(content, { onClose: () => settle(null) });
    const actions = h('div', { style: { display: 'flex', gap: '10px' } });
    actions.append(
      h('button.btn.btn--ghost.grow', { onclick: () => { settle(null); close(); } }, 'Cancelar'),
      h('button.btn.grow', {
        onclick: () => {
          const v = input.value.trim();
          if (!v) {
            error.textContent = 'escribe algo';
            error.hidden = false;
            input.focus();
            return;
          }
          settle(v);
          close();
        },
      }, confirmText),
    );
    content.appendChild(actions);
    setTimeout(() => input.focus(), 60);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') actions.querySelector('.btn:last-child').click();
    });
  });
}

/* -------------------------------- charts -------------------------------- */

/**
 * Bar chart from an array of {label, value}.
 * Returns an SVG element.
 */
export function barChart(items, { height = 140, color = 'var(--accent)' } = {}) {
  const width = 320;
  const pad = 4;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'chart');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  if (!items.length) return svg;
  const max = Math.max(...items.map((i) => i.value), 1);
  const slot = (width - pad * 2) / items.length;
  const barW = Math.max(2, slot * 0.62);

  items.forEach((item, i) => {
    const hgt = Math.max(2, ((height - 16) * item.value) / max);
    const x = pad + i * slot + (slot - barW) / 2;
    const y = height - 10 - hgt;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'chart__bar');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(barW));
    rect.setAttribute('height', String(hgt));
    rect.setAttribute('rx', '2.5');
    rect.setAttribute('fill', item.color ?? color);
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${item.label}: ${item.value}`;
    rect.appendChild(title);
    svg.appendChild(rect);
  });
  return svg;
}

/** Compact line chart for a series of numbers. */
export function sparkline(values, { width = 320, height = 34, color = 'var(--accent)' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  if (!values.length) return svg;

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(1, max - min);
  const step = values.length > 1 ? width / (values.length - 1) : width;

  const pts = values.map((v, i) => {
    const x = i * step;
    const y = height - 3 - ((v - min) / span) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  path.setAttribute('points', pts.join(' '));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);
  return svg;
}

/** Round avatar built from the user's photo or the initials of their nickname. */
export function avatar(user, size = '') {
  const initials = (user?.nickname ?? '?')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  const node = h('div.avatar', { class: size ? `avatar--${size}` : '' });
  if (user?.photoUrl) {
    const img = h('img', { src: user.photoUrl, alt: '', loading: 'lazy' });
    node.appendChild(img);
  } else {
    node.textContent = initials || '?';
  }
  return node;
}

/** Loading placeholder. */
export function loading(label = 'Cargando…') {
  return h('div.loading', h('div.spinner'), h('div', label));
}

/** Empty state placeholder. */
export function emptyState(icon, title, hint, action) {
  return h('div.empty',
    h('div.empty__icon', icon),
    h('div.empty__title', title),
    hint ? h('div.empty__hint', hint) : null,
    action ?? null,
  );
}
