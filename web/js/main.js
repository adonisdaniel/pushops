// Application bootstrap: Telegram handshake, authentication, routing.

import { api, getToken, loginDev, loginWithTelegram, setToken } from './api.js';
import { getState, setState, subscribe } from './store.js';
import { initTelegram, isTelegram, tg } from './tg.js';
import { registerRoute, render as renderRoute, startRouter, setRouteListener } from './router.js';
import { installSyncTriggers, syncPending } from './sync.js';
import { h, toast } from './ui.js';

import { counterView } from './views/counter.js';
import { statsView } from './views/stats.js';
import { friendsView } from './views/friends.js';
import { groupsView, groupDetailView } from './views/groups.js';
import { profileView } from './views/profile.js';
import { onboardingView } from './views/onboarding.js';

const view = document.getElementById('view');
const topbarNick = document.getElementById('topbar-nick');

async function boot() {
  initTelegram();

  try {
    const config = await api.get('/api/config');
    setState({ serverConfig: config });
  } catch {
    setState({ serverConfig: { telegramAuth: false, devMode: false } });
  }

  await ensureSession();

  try {
    const { variants } = await api.get('/api/variants');
    setState({ variants });
  } catch { /* not critical */ }

  registerRoutes();
  startRouter(view);
  setRouteListener(updateTabBar);
  installSyncTriggers();
  void syncPending();

  subscribe(updateNick);

  globalThis.addEventListener('pushops:signed-out', () => {
    setToken('');
    void ensureSession().then(() => renderRoute());
  });
}

async function ensureSession() {
  if (getToken()) {
    try {
      const me = await api.get('/api/me');
      setState({ user: me.user });
      updateNick();
      return;
    } catch {
      setToken('');
    }
  }

  if (isTelegram) {
    try {
      const data = await loginWithTelegram(tg.initData);
      setState({ user: data.user });
      updateNick();
      if (data.isNew) showOnboarding(data.user);
      return;
    } catch (err) {
      console.error(err);
      showFatal('No se ha podido iniciar sesión con Telegram', err.message);
      return;
    }
  }

  // Outside Telegram we fall back to the development login so the app stays
  // usable as a standalone PWA during development.
  if (getState().serverConfig?.devMode) {
    try {
      const data = await loginDev();
      setState({ user: data.user });
      updateNick();
      return;
    } catch (err) {
      console.error(err);
    }
  }
  showFatal('Inicia la app desde Telegram', 'Abre el bot de PushOps y pulsa "Launch app".');
}

function showOnboarding(user) {
  const overlay = h('div', {
    style: {
      position: 'fixed', inset: '0', zIndex: '80', background: 'var(--bg)',
      overflowY: 'auto', padding: '20px', display: 'grid', placeItems: 'center',
    },
  });
  overlay.appendChild(onboardingView(user, () => {
    overlay.remove();
    renderRoute();
  }));
  document.getElementById('modal-root').appendChild(overlay);
}

function showFatal(title, detail) {
  view.replaceChildren(h('div.empty',
    h('div.empty__icon', '🔒'),
    h('div.empty__title', title),
    h('div.empty__hint', detail ?? ''),
  ));
}

function registerRoutes() {
  registerRoute('counter', () => counterView());
  registerRoute('stats', () => statsView());
  registerRoute('friends', () => friendsView());
  registerRoute('groups', () => groupsView());
  registerRoute('group', (route) => groupDetailView(route));
  registerRoute('profile', () => profileView());
}

function updateTabBar(route) {
  const name = route?.name ?? 'counter';
  document.querySelectorAll('.tabbar__item').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.tab === name || (name === 'group' && item.dataset.tab === 'groups'));
  });
}

function updateNick() {
  const user = getState().user;
  if (!user || !topbarNick) return;
  topbarNick.textContent = user.nickname;
  topbarNick.hidden = false;
}

void boot();
