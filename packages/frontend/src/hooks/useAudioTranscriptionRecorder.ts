import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { transcribeAudioChunk } from '@/services/transcription';

type PermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported';

type ChunkStatus = 'queued' | 'uploading' | 'completed' | 'failed';

interface ChunkRecord {
    id: string;
    index: number;
    blob: Blob;
    status: ChunkStatus;
    attempts: number;
    hadError: boolean;
    createdAt: number;
    durationMs: number;
    startOffsetMs: number;
    endOffsetMs: number;
    isFinal: boolean;
    transcript?: string;
    lastError?: string;
    nextRetryAt?: number;
}

interface UseAudioTranscriptionRecorderOptions {
    chunkDurationMs?: number;
    retryDelayMs?: number;
    onFinalTranscript: (transcript: string) => void;
}

interface ConnectivityState {
    issueCount: number;
    queuedCount: number;
    retryInSeconds: number | null;
}

export interface AudioTranscriptionRecorderResult {
    isSupported: boolean;
    permission: PermissionState;
    isRecording: boolean;
    isRecordingBarVisible: boolean;
    isProcessing: boolean;
    analyserNode: AnalyserNode | null;
    recordingDurationMs: number;
    connectivity: ConnectivityState;
    totalChunks: number;
    completedChunks: number;
    statusAnnouncement: string | null;
    error: string | null;
    startRecording: () => Promise<void>;
    stopRecording: () => void;
    toggleRecording: () => void;
    retryPendingChunks: () => void;
}

const DEFAULT_CHUNK_DURATION_MS = 30000; // 30 seconds
const DEFAULT_RETRY_DELAY_MS = 30000;
const MAX_CONCURRENT_UPLOADS = 3;

const safeRandomId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `chunk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const pickMimeType = () => {
    if (typeof window === 'undefined') return undefined;
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/webm',
        'audio/mp4',
    ];
    return candidates.find((type) =>
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)
    );
};

export function useAudioTranscriptionRecorder(
    options: UseAudioTranscriptionRecorderOptions
): AudioTranscriptionRecorderResult {
    const {
        chunkDurationMs = DEFAULT_CHUNK_DURATION_MS,
        retryDelayMs = DEFAULT_RETRY_DELAY_MS,
        onFinalTranscript,
    } = options;

    const [permission, setPermission] = useState<PermissionState>('prompt');
    const [isRecording, setIsRecording] = useState(false);
    const [isRecordingBarVisible, setRecordingBarVisible] = useState(false);
    const [statusAnnouncement, setStatusAnnouncement] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
    const [chunks, setChunks] = useState<ChunkRecord[]>([]);
    const [recordingDurationMs, setRecordingDurationMs] = useState(0);
    const [retryInSeconds, setRetryInSeconds] = useState<number | null>(null);
    const [isAwaitingFinal, setIsAwaitingFinal] = useState(false);
    const [isFinalChunkPending, setIsFinalChunkPending] = useState(false);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const chunkIndexRef = useRef(0);
    const startTimestampRef = useRef<number | null>(null);
    const stopTimestampRef = useRef<number | null>(null);
    const awaitingFinalTranscriptRef = useRef(false);
    const finalisedRef = useRef(false);
    const retryTimeoutsRef = useRef<Map<string, number>>(new Map());
    const activeUploadsRef = useRef<Set<string>>(new Set());
    const sessionIdRef = useRef<string>('');
    const chunkStartTimestampRef = useRef<number | null>(null);
    const isRecordingRef = useRef(false);
    const chunkStopTimeoutRef = useRef<number | null>(null);
    const pendingChunkInfoRef = useRef<{ isFinal: boolean; shouldRestart: boolean }>({
        isFinal: false,
        shouldRestart: false,
    });

    const metricsRef = useRef({
        sessions: 0,
        totalRecordingDurationMs: 0,
        chunkCount: 0,
        totalTranscriptionSeconds: 0,
        retryCount: 0,
        failureCount: 0,
    });

    const isSupported = useMemo(() => {
        return (
            typeof window !== 'undefined' &&
            typeof navigator !== 'undefined' &&
            !!navigator.mediaDevices &&
            typeof MediaRecorder !== 'undefined'
        );
    }, []);

    useEffect(() => {
        if (typeof navigator === 'undefined' || !('permissions' in navigator)) {
            return;
        }

        let statusRef: PermissionStatus | null = null;
        const handler = () => {
            if (statusRef) {
                setPermission(statusRef.state as PermissionState);
            }
        };

        navigator.permissions
            // @ts-expect-error Microphone is not yet typed in lib.dom
            .query({ name: 'microphone' })
            .then((status: PermissionStatus) => {
                statusRef = status;
                setPermission(status.state as PermissionState);
                status.addEventListener('change', handler);
            })
            .catch(() => {
                setPermission((prev) => (prev === 'prompt' ? 'unsupported' : prev));
            });

        return () => {
            if (statusRef) {
                statusRef.removeEventListener('change', handler);
            }
        };
    }, []);

    const clearRetryTimeout = useCallback((chunkId: string) => {
        const timeoutId = retryTimeoutsRef.current.get(chunkId);
        if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
            retryTimeoutsRef.current.delete(chunkId);
        }
    }, []);

    const clearChunkStopTimeout = useCallback(() => {
        if (chunkStopTimeoutRef.current !== null) {
            window.clearTimeout(chunkStopTimeoutRef.current);
            chunkStopTimeoutRef.current = null;
        }
    }, []);

    const stopRecorderForChunk = useCallback(
        ({ isFinal, shouldRestart }: { isFinal: boolean; shouldRestart: boolean }) => {
            const recorder = mediaRecorderRef.current;
            pendingChunkInfoRef.current = { isFinal, shouldRestart };

            if (!recorder || recorder.state !== 'recording') {
                return;
            }

            try {
                recorder.stop();
            } catch (err) {
                console.error('[AudioRecorder] Failed to stop recorder for chunk', err);
                pendingChunkInfoRef.current = { isFinal: false, shouldRestart: false };
            }
        },
        []
    );

    const scheduleChunkStop = useCallback(() => {
        clearChunkStopTimeout();
        chunkStopTimeoutRef.current = window.setTimeout(() => {
            stopRecorderForChunk({ isFinal: false, shouldRestart: true });
        }, chunkDurationMs);
    }, [chunkDurationMs, clearChunkStopTimeout, stopRecorderForChunk]);

    const scheduleRetry = useCallback(
        (chunkId: string, delayMs: number) => {
            clearRetryTimeout(chunkId);
            const timeoutId = window.setTimeout(() => {
                retryTimeoutsRef.current.delete(chunkId);
                setChunks((current) =>
                    current.map((chunk) =>
                        chunk.id === chunkId
                            ? {
                                ...chunk,
                                status: 'queued',
                                nextRetryAt: undefined,
                            }
                            : chunk
                    )
                );
            }, delayMs);
            retryTimeoutsRef.current.set(chunkId, timeoutId);
        },
        [clearRetryTimeout]
    );

    const resetSessionMetrics = useCallback(() => {
        metricsRef.current.chunkCount = 0;
        metricsRef.current.totalTranscriptionSeconds = 0;
        metricsRef.current.retryCount = 0;
        metricsRef.current.failureCount = 0;
    }, []);

    const teardownMedia = useCallback(() => {
        mediaRecorderRef.current = null;
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close().catch(() => undefined);
            audioContextRef.current = null;
        }
        setAnalyserNode(null);
    }, []);

    const updateRetryCountdown = useCallback((records: ChunkRecord[]) => {
        const failing = records.filter((chunk) => chunk.hadError && chunk.status !== 'completed');
        if (failing.length === 0) {
            setRetryInSeconds(null);
            return;
        }
        const nextRetry = failing
            .map((chunk) => chunk.nextRetryAt ?? Date.now())
            .reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
        if (!Number.isFinite(nextRetry)) {
            setRetryInSeconds(null);
            return;
        }
        const update = () => {
            const diffMs = nextRetry - Date.now();
            setRetryInSeconds(diffMs > 0 ? Math.ceil(diffMs / 1000) : 0);
        };
        update();
    }, []);

    const setChunksAndUpdate = useCallback(
        (updater: (previous: ChunkRecord[]) => ChunkRecord[]) => {
            setChunks((previous) => {
                const updated = updater(previous);
                updateRetryCountdown(updated);
                return updated;
            });
        },
        [updateRetryCountdown]
    );

    const clearAllRetryTimeouts = useCallback(() => {
        retryTimeoutsRef.current.forEach((timeoutId, chunkId) => {
            window.clearTimeout(timeoutId);
            retryTimeoutsRef.current.delete(chunkId);
        });
    }, []);

    const finalizeSession = useCallback(
        ({
            orderedChunks = [],
            transcript,
            reason,
        }: {
            orderedChunks?: ChunkRecord[];
            transcript?: string;
            reason?: 'no-audio' | 'error';
        } = {}) => {
            if (finalisedRef.current) {
                return;
            }

            finalisedRef.current = true;
            awaitingFinalTranscriptRef.current = false;
            setIsAwaitingFinal(false);
            setIsFinalChunkPending(false);

            const stopTime = stopTimestampRef.current ?? Date.now();
            const startTime = startTimestampRef.current ?? stopTime;
            const sessionDuration = Math.max(0, stopTime - startTime);
            metricsRef.current.totalRecordingDurationMs += sessionDuration;

            console.log('[AudioTelemetry] Session complete', {
                sessionId: sessionIdRef.current,
                sessionDurationMs: sessionDuration,
                chunks: orderedChunks.length,
                totalChunkTranscriptionSeconds: metricsRef.current.totalTranscriptionSeconds,
                retries: metricsRef.current.retryCount,
                failures: metricsRef.current.failureCount,
                sessionsStarted: metricsRef.current.sessions,
            });

            const normalisedTranscript = transcript?.replace(/\s+/g, ' ').trim();
            if (typeof normalisedTranscript === 'string') {
                if (normalisedTranscript.length > 0) {
                    onFinalTranscript(normalisedTranscript);
                    setStatusAnnouncement('Transcription ready and added to input.');
                } else {
                    setStatusAnnouncement('Recording stopped with no audio captured.');
                }
            } else if (reason === 'no-audio') {
                setStatusAnnouncement('Recording stopped with no audio captured.');
            } else if (reason === 'error') {
                setStatusAnnouncement('Recording stopped due to an error.');
            }

            setIsRecording(false);
            setRecordingBarVisible(false);
            setChunksAndUpdate(() => []);
            clearAllRetryTimeouts();
            activeUploadsRef.current.clear();
            chunkStartTimestampRef.current = null;
            clearChunkStopTimeout();
            pendingChunkInfoRef.current = { isFinal: false, shouldRestart: false };
            isRecordingRef.current = false;
            sessionIdRef.current = '';
            chunkIndexRef.current = 0;
            startTimestampRef.current = null;
            stopTimestampRef.current = null;
            teardownMedia();
        },
        [
            clearAllRetryTimeouts,
            clearChunkStopTimeout,
            onFinalTranscript,
            setChunksAndUpdate,
            teardownMedia,
        ]
    );

    const beginChunkRecording = useCallback(
        (startTime?: number) => {
            const recorder = mediaRecorderRef.current;
            if (!recorder || recorder.state !== 'inactive') {
                return;
            }

            try {
                const chunkStart = startTime ?? Date.now();
                chunkStartTimestampRef.current = chunkStart;
                pendingChunkInfoRef.current = { isFinal: false, shouldRestart: false };
                recorder.start();
                scheduleChunkStop();
            } catch (err) {
                console.error('[AudioRecorder] Failed to start recorder', err);
                setError('Unable to continue audio recording.');
                setStatusAnnouncement('Recording stopped due to an error.');
                finalizeSession({ reason: 'error' });
            }
        },
        [finalizeSession, scheduleChunkStop]
    );

    const processQueue = useCallback(
        (records: ChunkRecord[]) => {
            if (records.length === 0) return;
            const availableSlots = MAX_CONCURRENT_UPLOADS - activeUploadsRef.current.size;
            if (availableSlots <= 0) return;

            const now = Date.now();
            const candidates = records.filter((chunk) => {
                if (activeUploadsRef.current.has(chunk.id)) {
                    return false;
                }
                if (chunk.status === 'queued') {
                    return true;
                }
                if (chunk.status === 'failed' && chunk.nextRetryAt && chunk.nextRetryAt <= now) {
                    return true;
                }
                return false;
            });

            if (candidates.length === 0) {
                return;
            }

            candidates.slice(0, availableSlots).forEach((chunk) => {
                activeUploadsRef.current.add(chunk.id);
                setChunksAndUpdate((current) =>
                    current.map((record) =>
                        record.id === chunk.id
                            ? {
                                ...record,
                                status: 'uploading',
                                attempts: record.attempts + 1,
                                nextRetryAt: undefined,
                                lastError: undefined,
                            }
                            : record
                    )
                );

                const uploadStartedAt = performance.now();

                // Improved logging before the request
                console.log('[AudioRecorder] Uploading chunk', {
                    id: chunk.id,
                    index: chunk.index,
                    blobSize: chunk.blob.size,
                    blobType: chunk.blob.type,
                    durationMs: chunk.durationMs,
                });

                transcribeAudioChunk(chunk.blob, `${chunk.id}.webm`, {
                    chunkIndex: chunk.index,
                    sessionId: sessionIdRef.current,
                    durationMs: chunk.durationMs,
                    startOffsetMs: chunk.startOffsetMs,
                    endOffsetMs: chunk.endOffsetMs,
                    isFinalChunk: chunk.isFinal,
                })
                    .then((result) => {
                        const transcriptionSeconds = (performance.now() - uploadStartedAt) / 1000;
                        metricsRef.current.chunkCount += 1;
                        metricsRef.current.totalTranscriptionSeconds += transcriptionSeconds;
                        setChunksAndUpdate((current) =>
                            current.map((record) =>
                                record.id === chunk.id
                                    ? {
                                        ...record,
                                        status: 'completed',
                                        transcript: result.text,
                                        hadError: record.hadError,
                                        lastError: undefined,
                                    }
                                    : record
                            )
                        );
                    })
                    .catch((err: Error) => {
                        metricsRef.current.failureCount += 1;
                        console.error('[AudioRecorder] Chunk transcription failed', {
                            chunkId: chunk.id,
                            chunkIndex: chunk.index,
                            error: err.message,
                            responseError: (err as any).responseError,
                        });

                        const nextRetryAt = Date.now() + retryDelayMs;
                        setStatusAnnouncement(`Audio chunk failed to transcribe. Retrying in ${Math.round(retryDelayMs / 1000)}s.`);

                        setChunksAndUpdate((current) =>
                            current.map((record) =>
                                record.id === chunk.id
                                    ? {
                                        ...record,
                                        status: 'failed',
                                        lastError: err.message,
                                        nextRetryAt,
                                        hadError: true,
                                    }
                                    : record
                            )
                        );
                        scheduleRetry(chunk.id, retryDelayMs);
                    })
                    .finally(() => {
                        activeUploadsRef.current.delete(chunk.id);
                    });
            });
        },
        [retryDelayMs, scheduleRetry, setChunksAndUpdate]
    );

    useEffect(() => {
        processQueue(chunks);
    }, [chunks, processQueue]);

    useEffect(() => {
        const timeoutSnapshot = retryTimeoutsRef.current;
        return () => {
            const timeouts = Array.from(timeoutSnapshot.values());
            timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
            timeoutSnapshot.clear();
            clearChunkStopTimeout();
            teardownMedia();
        };
    }, [clearChunkStopTimeout, teardownMedia]);

    useEffect(() => {
        if (!isRecording) {
            return;
        }
        const intervalId = window.setInterval(() => {
            if (startTimestampRef.current) {
                setRecordingDurationMs(Date.now() - startTimestampRef.current);
            }
        }, 250);

        return () => window.clearInterval(intervalId);
    }, [isRecording]);

    useEffect(() => {
        if (!awaitingFinalTranscriptRef.current || finalisedRef.current) {
            return;
        }

        if (isFinalChunkPending) {
            return;
        }

        const pending = chunks.some((chunk) => chunk.status !== 'completed');
        if (pending) {
            return;
        }

        const ordered = [...chunks].sort((a, b) => a.index - b.index);
        const transcript = ordered.map((chunk) => chunk.transcript ?? '').join(' ');

        finalizeSession({ orderedChunks: ordered, transcript });
    }, [chunks, finalizeSession, isFinalChunkPending]);

    const startRecording = useCallback(async () => {
        if (!isSupported) {
            setError('Audio recording is not supported in this browser.');
            setPermission('unsupported');
            return;
        }
        if (isRecording) {
            return;
        }

        try {
            setError(null);
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            setPermission('granted');
            sessionIdRef.current = safeRandomId();
            metricsRef.current.sessions += 1;
            resetSessionMetrics();
            startTimestampRef.current = Date.now();
            stopTimestampRef.current = null;
            setRecordingDurationMs(0);
            chunkIndexRef.current = 0;
            awaitingFinalTranscriptRef.current = false;
            finalisedRef.current = false;
            setChunksAndUpdate(() => []);
            setRecordingBarVisible(true);
            setStatusAnnouncement('Recording started.');
            setIsAwaitingFinal(false);
            setIsFinalChunkPending(false);

            streamRef.current = stream;

            const context = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = context;
            const source = context.createMediaStreamSource(stream);
            const analyser = context.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);
            setAnalyserNode(analyser);

            const mimeType = pickMimeType();
            const recorder = new MediaRecorder(stream, { mimeType });
            mediaRecorderRef.current = recorder;

            chunkStartTimestampRef.current = startTimestampRef.current ?? Date.now();
            pendingChunkInfoRef.current = { isFinal: false, shouldRestart: false };
            clearChunkStopTimeout();

            recorder.ondataavailable = (event) => {
                const { isFinal: isFinalChunk } = pendingChunkInfoRef.current;

                if (!event.data || event.data.size === 0) {
                    if (isFinalChunk) {
                        setIsFinalChunkPending(false);
                    }
                    return;
                }

                const chunkId = `${sessionIdRef.current}-${chunkIndexRef.current}`;
                const now = Date.now();
                const recordingStart = startTimestampRef.current ?? now;
                const chunkStart = chunkStartTimestampRef.current ?? recordingStart;
                const durationMs = Math.max(1, now - chunkStart);
                const startOffsetMs = Math.max(0, chunkStart - recordingStart);
                const endOffsetMs = Math.max(startOffsetMs + durationMs, now - recordingStart);

                setChunksAndUpdate((prev) => [
                    ...prev,
                    {
                        id: chunkId,
                        index: chunkIndexRef.current,
                        blob: event.data,
                        status: 'queued',
                        attempts: 0,
                        durationMs,
                        startOffsetMs,
                        endOffsetMs,
                        isFinal: isFinalChunk,
                        hadError: false,
                        createdAt: now,
                    },
                ]);

                chunkIndexRef.current += 1;
                chunkStartTimestampRef.current = null;

                if (isFinalChunk) {
                    setIsFinalChunkPending(false);
                }
            };

            recorder.onstop = () => {
                const { isFinal, shouldRestart } = pendingChunkInfoRef.current;
                const shouldResume = shouldRestart && !isFinal && isRecordingRef.current;
                if (!shouldResume) {
                    clearChunkStopTimeout();
                }
                if (shouldResume) {
                    beginChunkRecording();
                }
                if (!shouldResume) {
                    pendingChunkInfoRef.current = { isFinal: false, shouldRestart: false };
                }
            };

            recorder.onerror = (event) => {
                const error = (event as { error?: DOMException }).error;
                console.error('[AudioRecorder] MediaRecorder error', error ?? event);
                setError(error?.message ?? 'An unexpected audio recording error occurred.');
                setStatusAnnouncement('Recording stopped due to an error.');
                finalizeSession({ reason: 'error' });
            };

            isRecordingRef.current = true;
            setIsRecording(true);
            beginChunkRecording(startTimestampRef.current ?? Date.now());
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unable to start audio recording.';
            console.error('[AudioRecorder] Failed to start recording', err);
            setError(message);
            setPermission('denied');
            setStatusAnnouncement('Microphone permission denied or unavailable.');
        }
    }, [
        beginChunkRecording,
        clearChunkStopTimeout,
        finalizeSession,
        isRecording,
        isSupported,
        resetSessionMetrics,
        setChunksAndUpdate,
    ]);

    const stopRecording = useCallback(() => {
        const recorder = mediaRecorderRef.current;
        if (!recorder) {
            return;
        }
        if (recorder.state === 'inactive' && !isRecordingRef.current) {
            return;
        }
        stopTimestampRef.current = Date.now();
        if (startTimestampRef.current) {
            setRecordingDurationMs(stopTimestampRef.current - startTimestampRef.current);
        }
        isRecordingRef.current = false;
        setIsRecording(false);
        awaitingFinalTranscriptRef.current = true;
        setIsAwaitingFinal(true);
        setIsFinalChunkPending(true);
        setChunksAndUpdate((current) => [...current]);
        setStatusAnnouncement('Processing final audio chunk…');
        clearChunkStopTimeout();
        if (recorder.state === 'recording') {
            stopRecorderForChunk({ isFinal: true, shouldRestart: false });
        } else {
            pendingChunkInfoRef.current = { isFinal: true, shouldRestart: false };
            setIsFinalChunkPending(false);
        }
    }, [clearChunkStopTimeout, setChunksAndUpdate, stopRecorderForChunk]);

    const toggleRecording = useCallback(() => {
        if (isRecording) {
            stopRecording();
        } else {
            void startRecording();
        }
    }, [isRecording, startRecording, stopRecording]);

    const retryPendingChunks = useCallback(() => {
        metricsRef.current.retryCount += 1;
        setChunksAndUpdate((current) =>
            current.map((chunk) => {
                if (chunk.hadError && chunk.status !== 'completed') {
                    clearRetryTimeout(chunk.id);
                    return {
                        ...chunk,
                        status: 'queued',
                        nextRetryAt: undefined,
                    };
                }
                return chunk;
            })
        );
        setStatusAnnouncement('Retrying queued audio chunks now.');
    }, [clearRetryTimeout, setChunksAndUpdate]);

    const completedChunks = useMemo(() => chunks.filter((chunk) => chunk.status === 'completed').length, [chunks]);
    const totalChunks = chunks.length;
    const connectivity = useMemo<ConnectivityState>(() => {
        const issueChunks = chunks.filter((chunk) => chunk.hadError && chunk.status !== 'completed');
        const queuedCount = issueChunks.filter((chunk) => chunk.status !== 'uploading').length;
        return {
            issueCount: issueChunks.length,
            queuedCount,
            retryInSeconds,
        };
    }, [chunks, retryInSeconds]);

    const isProcessing = useMemo(() => {
        if (isRecording) return false;
        if (isAwaitingFinal) return true;
        if (totalChunks === 0) return false;
        return completedChunks < totalChunks;
    }, [completedChunks, isAwaitingFinal, isRecording, totalChunks]);

    return {
        isSupported,
        permission,
        isRecording,
        isRecordingBarVisible,
        isProcessing,
        analyserNode,
        recordingDurationMs,
        connectivity,
        totalChunks,
        completedChunks,
        statusAnnouncement,
        error,
        startRecording,
        stopRecording,
        toggleRecording,
        retryPendingChunks,
    };
}

