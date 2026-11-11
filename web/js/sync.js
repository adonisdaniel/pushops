// Syncs the offline queue of finished workouts to the server.

import { api } from './api.js';
import { pendingWorkouts, removePendingWorkout } from './store.js';

let running = false;

/**
 * Pushes every queued workout to the server.
 * Stops at the first failure so the order is preserved.
 */
export async function syncPending() {
  if (running) return { synced: 0, failed: 0, pending: 0 };
  running = true;
  let synced = 0;
  let failed = 0;
  try {
    const items = await pendingWorkouts();
    for (const item of items) {
      const { clientId, queuedAt, ...payload } = item;
      try {
        await api.post('/api/workouts', payload);
        await removePendingWorkout(clientId);
        synced++;
      } catch (err) {
        failed++;
        // A network or server error will not fix itself on the next item.
        if (err?.status === 0 || (err?.status >= 500)) break;
        // A validation error is permanent: drop it so the queue does not jam.
        if (err?.status === 400 || err?.status === 422) {
          await removePendingWorkout(clientId);
          continue;
        }
        break;
      }
    }
  } finally {
    running = false;
  }
  const pending = (await pendingWorkouts()).length;
  return { synced, failed, pending };
}

/** Registers the automatic sync triggers. */
export function installSyncTriggers() {
  globalThis.addEventListener('online', () => { void syncPending(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncPending();
  });
  setInterval(() => { void syncPending(); }, 60_000);
}
