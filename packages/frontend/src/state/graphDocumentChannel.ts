import { GraphDocumentUpdate } from './types';

type Listener = (update: GraphDocumentUpdate) => void;

const listeners = new Set<Listener>();

export const graphDocumentChannel = {
    emit(update: GraphDocumentUpdate) {
        listeners.forEach((listener) => {
            try {
                listener(update);
            } catch (error) {
                console.error('[GraphDocumentChannel] Listener error', error);
            }
        });
    },
    subscribe(listener: Listener) {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },
};

