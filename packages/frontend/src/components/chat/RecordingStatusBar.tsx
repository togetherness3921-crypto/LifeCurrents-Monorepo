import { Loader2, Square } from 'lucide-react';
import { Button } from '../ui/button';
import RecordingWaveform from './RecordingWaveform';

interface RecordingStatusBarProps {
    visible: boolean;
    isRecording: boolean;
    isProcessing: boolean;
    durationMs: number;
    analyser: AnalyserNode | null;
    completedChunks: number;
    totalChunks: number;
    onStop: () => void;
}

const formatDuration = (durationMs: number) => {
    const totalSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60)
        .toString()
        .padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
};

const RecordingStatusBar: React.FC<RecordingStatusBarProps> = ({
    visible,
    isRecording,
    isProcessing,
    durationMs,
    analyser,
    completedChunks,
    totalChunks,
    onStop,
}) => {
    if (!visible) return null;

    const statusLabel = isRecording
        ? 'Recording in progress'
        : isProcessing
        ? 'Processing audio'
        : 'Recording ready';

    const progressLabel = totalChunks > 0 ? `${completedChunks}/${totalChunks} chunks` : '0/0 chunks';

    return (
        <div className="mb-2 flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
            <div className="flex w-full flex-col gap-1">
                <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide">
                    <span>{statusLabel}</span>
                    <span className="font-semibold">{formatDuration(durationMs)}</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="min-w-[120px] text-xs text-primary/70">{progressLabel}</div>
                    <div className="h-10 flex-1 overflow-hidden rounded">
                        {isRecording ? (
                            <RecordingWaveform analyser={analyser} isActive={isRecording} />
                        ) : (
                            <div className="flex h-full items-center justify-center bg-primary/10 text-xs text-primary/70">
                                {isProcessing ? 'Processing final chunk…' : 'Recording paused'}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {isRecording ? (
                <Button
                    type="button"
                    onClick={onStop}
                    variant="destructive"
                    size="sm"
                    className="h-9 px-3"
                    aria-label="Stop recording"
                >
                    <Square className="mr-2 h-4 w-4" /> Stop
                </Button>
            ) : isProcessing ? (
                <div className="flex items-center gap-2 text-xs text-primary/70" aria-live="polite">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Finalizing transcription…</span>
                </div>
            ) : null}
        </div>
    );
};

export default RecordingStatusBar;

