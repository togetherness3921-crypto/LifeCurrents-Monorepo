type ServiceWorkerState = 'waiting' | 'activated';

type Listener = (state: ServiceWorkerState) => void;

let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;
let waitingWorker: ServiceWorker | null = null;
let pendingReload = false;
const listeners = new Set<Listener>();

const notify = (state: ServiceWorkerState) => {
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.error('[serviceWorkerManager] Listener error', error);
    }
  });
};

const handleRegistration = (registration: ServiceWorkerRegistration) => {
  if (registration.waiting) {
    waitingWorker = registration.waiting;
    notify('waiting');
  }

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) {
      return;
    }

    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') {
        if (navigator.serviceWorker.controller) {
          waitingWorker = registration.waiting;
          notify('waiting');
        } else {
          notify('activated');
        }
      }
    });
  });
};

const ensureControllerListener = () => {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    waitingWorker = null;
    notify('activated');
    if (pendingReload) {
      pendingReload = false;
      window.location.reload();
    }
  });
};

export const initializeServiceWorker = () => {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  if (registrationPromise) {
    return;
  }

  ensureControllerListener();

  registrationPromise = navigator.serviceWorker
    .register('/sw.js')
    .then((registration) => {
      handleRegistration(registration);
      return registration;
    })
    .catch((error) => {
      console.error('[serviceWorkerManager] Registration failed', error);
      registrationPromise = null;
      throw error;
    });
};

export const subscribeServiceWorker = (listener: Listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const requestServiceWorkerRefresh = () => {
  if (!('serviceWorker' in navigator)) {
    window.location.reload();
    return;
  }

  if (!registrationPromise) {
    initializeServiceWorker();
  }

  navigator.serviceWorker.ready
    .then((registration) => {
      const waiting = registration.waiting || waitingWorker;
      if (waiting) {
        pendingReload = true;
        waiting.postMessage({ type: 'SKIP_WAITING' });
        return;
      }

      pendingReload = true;
      registration
        .update()
        .then(() => {
          if (registration.waiting) {
            waitingWorker = registration.waiting;
            registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
          } else {
            pendingReload = false;
            window.location.reload();
          }
        })
        .catch((error) => {
          console.error('[serviceWorkerManager] Registration update failed', error);
          pendingReload = false;
          window.location.reload();
        });
    })
    .catch((error) => {
      console.error('[serviceWorkerManager] navigator.serviceWorker.ready rejected', error);
      window.location.reload();
    });
};

