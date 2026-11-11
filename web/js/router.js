// Tiny hash router. Views are plain objects with a render() method that returns
// a DOM node and an optional mount()/unmount() pair.

const routes = new Map();
let current = null;
let onChange = null;

export function registerRoute(name, handler) {
  routes.set(name, handler);
}

export function setRouteListener(fn) {
  onChange = fn;
}

export function currentRoute() {
  return current;
}

function parseHash() {
  const raw = globalThis.location.hash.replace(/^#\/?/, '');
  const [path, queryString] = raw.split('?');
  const segments = path.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryString ?? ''));
  return { name: segments[0] || 'counter', params: segments.slice(1), query };
}

let container = null;

export function startRouter(el) {
  container = el;
  globalThis.addEventListener('hashchange', () => { void render(); });
  void render();
}

export async function render() {
  if (!container) return;
  const route = parseHash();

  if (current?.unmount) {
    try { current.unmount(); } catch (err) { console.error(err); }
  }
  current = null;

  const handler = routes.get(route.name);
  if (!handler) {
    container.replaceChildren(notFound());
    onChange?.(route);
    return;
  }

  try {
    const view = await handler(route);
    current = view ?? null;
    container.replaceChildren(current?.el ?? document.createElement('div'));
    if (current?.mount) current.mount();
  } catch (err) {
    console.error(err);
    container.replaceChildren(errorView(err));
  }
  onChange?.(route);
}

export function navigate(path) {
  const next = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
  if (globalThis.location.hash === next) {
    void render();
  } else {
    globalThis.location.hash = next;
  }
}

function notFound() {
  const el = document.createElement('div');
  el.className = 'empty';
  el.innerHTML = `<div class="empty__icon">🧭</div>
    <div class="empty__title">Ruta no encontrada</div>
    <a class="btn btn--soft" href="#/counter">Ir al contador</a>`;
  return el;
}

function errorView(err) {
  const el = document.createElement('div');
  el.className = 'empty';
  el.innerHTML = `<div class="empty__icon">⚠️</div>
    <div class="empty__title">Algo ha fallado</div>
    <div class="empty__hint"></div>`;
  el.querySelector('.empty__hint').textContent = err?.message ?? 'error desconocido';
  return el;
}
