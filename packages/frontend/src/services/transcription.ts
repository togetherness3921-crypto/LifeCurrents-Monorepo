export interface TranscriptionChunkResponse {
    text: string;
    confidence?: number;
}

export interface TranscriptionRequestMetadata {
    chunkIndex: number;
    totalChunks?: number;
    sessionId?: string;
    durationMs?: number;
    startOffsetMs?: number;
    endOffsetMs?: number;
    isFinalChunk?: boolean;
}

import { WORKER_BASE_URL } from '@/lib/config';

const DEFAULT_ENDPOINT = `${WORKER_BASE_URL}/api/transcribe`;

const toFormData = (blob: Blob, filename: string, metadata?: TranscriptionRequestMetadata) => {
    const formData = new FormData();
    formData.append('file', blob, filename);
    if (metadata) {
        formData.append('metadata', JSON.stringify(metadata));
    }
    return formData;
};

export async function transcribeAudioChunk(
    blob: Blob,
    filename: string,
    metadata?: TranscriptionRequestMetadata,
    signal?: AbortSignal
): Promise<TranscriptionChunkResponse> {
    const endpoint = import.meta.env.VITE_TRANSCRIPTION_ENDPOINT ?? DEFAULT_ENDPOINT;
    const response = await fetch(endpoint, {
        method: 'POST',
        body: toFormData(blob, filename, metadata),
        signal,
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Transcription request failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as Partial<TranscriptionChunkResponse> | null;
    if (!data || typeof data.text !== 'string') {
        throw new Error('Transcription response did not include text.');
    }

    return {
        text: data.text,
        confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
    };
}

