import { useEffect, useState } from 'react';
import {
  initializeServiceWorker,
  requestServiceWorkerRefresh,
  subscribeServiceWorker,
} from '@/lib/serviceWorkerManager';

export function useServiceWorkerRefresh() {
  const [state, setState] = useState<'idle' | 'waiting'>('idle');

  useEffect(() => {
    initializeServiceWorker();
    const unsubscribe = subscribeServiceWorker((status) => {
      if (status === 'waiting') {
        setState('waiting');
      } else {
        setState('idle');
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return {
    state,
    refreshNow: requestServiceWorkerRefresh,
  } as const;
}

