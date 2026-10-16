import { registerSW } from 'virtual:pwa-register';

declare const __APP_BUILD_ID__: string;

const UPDATED_SESSION_KEY = 'brandforge:pwa-updated';
const UPDATE_INTERVAL_MS = 60 * 1000;

let registered = false;

function rememberActivatedUpdate(): void {
  try {
    sessionStorage.setItem(UPDATED_SESSION_KEY, '1');
  } catch {
    // Storage can be unavailable in privacy modes. The update still applies.
  }
}

export function consumePwaUpdatedNotice(): boolean {
  try {
    const updated = sessionStorage.getItem(UPDATED_SESSION_KEY) === '1';
    if (updated) sessionStorage.removeItem(UPDATED_SESSION_KEY);
    return updated;
  } catch {
    return false;
  }
}

export function registerPwaUpdates(): void {
  document.documentElement.dataset.build = __APP_BUILD_ID__;
  if (registered || !('serviceWorker' in navigator)) return;
  registered = true;

  // A controller already present means a later controllerchange is an app
  // update, not the initial PWA installation. registerSW(autoUpdate) reloads
  // after activation; this marker lets the new bundle explain that reload.
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', rememberActivatedUpdate, { once: true });
  }

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      const checkForUpdate = () => {
        if (!navigator.onLine) return;
        void registration.update().catch(() => {
          // A failed background check should not interrupt the current app.
        });
      };

      window.setInterval(checkForUpdate, UPDATE_INTERVAL_MS);
      window.addEventListener('focus', checkForUpdate);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
    },
    onRegisterError(error) {
      console.warn('PWA update registration failed', error);
    },
  });
}
