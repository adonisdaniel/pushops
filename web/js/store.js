// Application state plus an IndexedDB backed offline queue for finished sets.
// The phone lies on the floor during a workout, so losing signal mid-set must
// never lose the data.

const state = {
  user: null,
  serverConfig: null,
  variants: [],
  settings: loadSettings(),
  summary: null,
  series: [],
  friends: [],
  incoming: [],
  groups: [],
};

const listeners = new Set();

function loadSettings() {
  const defaults = {
    mode: 'suelo',            // 'suelo' | 'perfil'
    variant: 'standard',
    calibration: null,        // last calibration payload
    thresholds: null,         // user-tuned detector thresholds
    manualCount: false,
  };
  try {
    const raw = localStorage.getItem('pushops.settings');
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

export function getState() { return state; }

export function setState(patch) {
  Object.assign(state, patch);
  notify();
}

export function setSettings(patch) {
  Object.assign(state.settings, patch);
  try {
    localStorage.setItem('pushops.settings', JSON.stringify(state.settings));
  } catch { /* private mode */ }
  notify();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try { fn(state); } catch (err) { console.error(err); }
  }
}

/* ------------------------------------------------------------------ */
/* Offline queue                                                       */
/* ------------------------------------------------------------------ */

const DB_NAME = 'pushops';
const DB_VERSION = 1;
const STORE = 'pendingWorkouts';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'clientId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const result = fn(store);
      tx.oncomplete = () => resolve(result?.result ?? result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Queue a finished set locally so it survives a dropped connection. */
export async function queueWorkout(payload) {
  const clientId = payload.clientId ?? `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record = { ...payload, clientId, queuedAt: Date.now() };
  try {
    await withStore('readwrite', (store) => store.put(record));
  } catch (err) {
    console.warn('could not queue workout', err);
  }
  return record;
}

export async function pendingWorkouts() {
  try {
    const db = await openDB();
    const items = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return items;
  } catch {
    return [];
  }
}

export async function removePendingWorkout(clientId) {
  try {
    await withStore('readwrite', (store) => store.delete(clientId));
  } catch { /* ignore */ }
}

export async function pendingCount() {
  const items = await pendingWorkouts();
  return items.length;
}
