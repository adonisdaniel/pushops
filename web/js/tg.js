// Thin wrapper around the Telegram Mini App API. Everything is optional: when the
// app runs in a normal browser the wrapper degrades to no-ops so the same SPA can
// be used as a standalone PWA.

const raw = globalThis.Telegram?.WebApp ?? null;

export const tg = {
  raw,
  available: !!raw,
  platform: raw?.platform ?? 'browser',
  version: raw?.version ?? '0',
  initData: raw?.initData ?? '',
  initDataUnsafe: raw?.initDataUnsafe ?? null,
  colorScheme: raw?.colorScheme ?? 'dark',
};

export const isTelegram = tg.available && !!tg.initData;

/** Initialise the WebApp: theme, viewport, and the initial ready() handshake. */
export function initTelegram() {
  if (!tg.available) {
    document.body.dataset.telegram = 'false';
    document.body.dataset.colorScheme = prefersLight() ? 'light' : 'dark';
    return;
  }
  document.body.dataset.telegram = 'true';
  document.body.dataset.colorScheme = tg.colorScheme;
  applyThemeParams();
  tg.raw.ready();
  tg.raw.expand();
  tg.raw.onEvent?.('themeChanged', () => {
    document.body.dataset.colorScheme = tg.raw.colorScheme;
    applyThemeParams();
  });
  tg.raw.onEvent?.('viewportChanged', () => {
    document.documentElement.style.setProperty('--tg-viewport-height', `${tg.raw.viewportHeight}px`);
  });
  // Keep the header transparent in fullscreen so the camera can bleed to the top.
  try {
    tg.raw.setHeaderColor?.('secondary_bg_color');
    tg.raw.setBackgroundColor?.('bg_color');
  } catch { /* older clients */ }
}

function prefersLight() {
  return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ?? false;
}

/** Copy Telegram's theme colours into our own CSS custom properties. */
function applyThemeParams() {
  const params = tg.raw?.themeParams;
  if (!params) return;
  const map = {
    '--tg-theme-bg-color': params.bg_color,
    '--tg-theme-text-color': params.text_color,
    '--tg-theme-hint-color': params.hint_color,
    '--tg-theme-link-color': params.link_color,
    '--tg-theme-button-color': params.button_color,
    '--tg-theme-button-text-color': params.button_text_color,
    '--tg-theme-secondary-bg-color': params.secondary_bg_color,
    '--tg-theme-section-bg-color': params.section_bg_color,
    '--tg-theme-header-bg-color': params.header_bg_color,
    '--tg-theme-accent-text-color': params.accent_text_color,
  };
  const root = document.documentElement.style;
  for (const [prop, value] of Object.entries(map)) {
    if (value) root.setProperty(prop, value);
  }
}

/** Haptic feedback. `style` is one of light, medium, heavy, rigid, soft. */
export function haptic(style = 'medium') {
  try {
    tg.raw?.HapticFeedback?.impactOccurred(style);
  } catch { /* unsupported */ }
}

/** A short success/error notification pattern. */
export function hapticNotify(kind = 'success') {
  try {
    tg.raw?.HapticFeedback?.notificationOccurred(kind);
  } catch { /* unsupported */ }
}

/** Selection tick, used when picking a mode or a variant. */
export function hapticSelect() {
  try {
    tg.raw?.HapticFeedback?.selectionChanged();
  } catch { /* unsupported */ }
}

/** Ask Telegram for fullscreen (camera view). */
export function requestFullscreen() {
  try { tg.raw?.requestFullscreen?.(); } catch { /* unsupported */ }
}

export function lockOrientation() {
  try { tg.raw?.lockOrientation?.(); } catch { /* unsupported */ }
}

export function unlockOrientation() {
  try { tg.raw?.unlockOrientation?.(); } catch { /* unsupported */ }
}

/** Show the Telegram back button while a sub-view is open. */
export function showBackButton(handler) {
  if (!tg.raw?.BackButton) return;
  tg.raw.BackButton.show();
  tg.raw.BackButton.onClick(handler);
}

export function hideBackButton() {
  try { tg.raw?.BackButton?.hide(); } catch { /* unsupported */ }
}

/** Open a Telegram link (profile, chat, share). */
export function openTelegramLink(url) {
  if (tg.available) {
    try { tg.raw.openTelegramLink(url); return; } catch { /* fall through */ }
  }
  globalThis.open?.(url, '_blank', 'noopener');
}

/** Share to a Telegram story. */
export function shareToStory(mediaUrl) {
  if (!tg.available) return false;
  try { tg.raw.shareToStory?.(mediaUrl); return true; } catch { return false; }
}

/** Native confirm dialog with a browser fallback. */
export function confirmAction(message, title = '') {
  if (tg.available && tg.raw?.showConfirm) {
    return new Promise((resolve) => {
      tg.raw.showConfirm(message, (ok) => resolve(!!ok));
    });
  }
  return Promise.resolve(globalThis.confirm?.(message) ?? false);
}

/** Native alert with a browser fallback. */
export function alertAction(message, title = '') {
  if (tg.available && tg.raw?.showAlert) {
    return new Promise((resolve) => {
      tg.raw.showAlert(message, () => resolve());
    });
  }
  globalThis.alert?.(message);
  return Promise.resolve();
}

/** User info from initData (unverified — the server validates the signature). */
export function telegramUser() {
  return tg.initDataUnsafe?.user ?? null;
}

/** Device performance hints from the Telegram user agent. */
export function deviceInfo() {
  const ua = navigator.userAgent;
  const platform = tg.platform;
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  return { platform, isAndroid, isIOS, ua };
}
