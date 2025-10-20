import { Button } from '../ui/button';

interface ConnectivityStatusBarProps {
    issueCount: number;
    queuedCount: number;
    retryInSeconds: number | null;
    onRetry: () => void;
}

const ConnectivityStatusBar: React.FC<ConnectivityStatusBarProps> = ({ issueCount, queuedCount, retryInSeconds, onRetry }) => {
    if (issueCount === 0) {
        return null;
    }

    return (
        <div
            className="mb-2 flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            role="status"
            aria-live="polite"
        >
            <div className="flex flex-col">
                <span className="font-semibold">Connectivity issues</span>
                <span>
                    {issueCount} chunk{issueCount === 1 ? '' : 's'} affected
                    {queuedCount > 0
                        ? ` • ${queuedCount} waiting`
                        : typeof retryInSeconds === 'number'
                        ? ` • Retrying in ${retryInSeconds}s`
                        : ' • Retrying now'}
                </span>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={onRetry} className="border-destructive text-destructive hover:bg-destructive/10">
                Retry now
            </Button>
        </div>
    );
};

export default ConnectivityStatusBar;

