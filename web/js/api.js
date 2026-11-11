// API client. Attaches the session token, refreshes it on 401 and normalises
// server errors into a consistent shape.

const TOKEN_KEY = 'pushops.token';

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

let token = localStorage.getItem(TOKEN_KEY) ?? '';

export function getToken() { return token; }

export function setToken(next) {
  token = next ?? '';
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(method, path, body, { retry = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'sin conexión con el servidor');
  }

  if (res.status === 204) return null;

  let payload = null;
  const text = await res.text();
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  }

  if (!res.ok) {
    if (res.status === 401 && retry) {
      setToken('');
      window.dispatchEvent(new CustomEvent('pushops:signed-out'));
    }
    const message = payload?.error || `error ${res.status}`;
    throw new ApiError(res.status, message, payload);
  }
  return payload;
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body, opts) => request('POST', path, body ?? {}, opts),
  patch: (path, body, opts) => request('PATCH', path, body ?? {}, opts),
  del: (path, opts) => request('DELETE', path, undefined, opts),
};

/** Sign in with the Telegram initData payload. */
export async function loginWithTelegram(initData) {
  const data = await api.post('/api/auth/telegram', { initData });
  setToken(data.token);
  return data;
}

/** Development-only sign in, used when the app runs outside Telegram. */
export async function loginDev(tgId, nickname) {
  const data = await api.post('/api/auth/dev', { tgId, nickname });
  setToken(data.token);
  return data;
}
