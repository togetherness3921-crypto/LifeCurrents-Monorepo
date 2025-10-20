import { Loader2, GitMerge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import type { PreviewBuild, UsePreviewBuildsResult } from '@/hooks/usePreviewBuilds';

const formatCreatedAt = (value: string | null) => {
  if (!value) {
    return 'Creation time unavailable';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Creation time unavailable';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
};

type PreviewBuildsPanelProps = Pick<
  UsePreviewBuildsResult,
  'builds' | 'loading' | 'error' | 'refresh'
>;

const PreviewBuildsPanel = ({
  builds,
  loading,
  error,
  refresh,
}: PreviewBuildsPanelProps) => {
  const { toast } = useToast();

  const handleViewPreview = (build: PreviewBuild) => {
    const rawUrl = build.preview_url ?? '';
    const trimmedUrl = rawUrl.trim().replace(/'+$/, '');

    if (!trimmedUrl) {
      toast({
        variant: 'destructive',
        title: 'Preview unavailable',
        description: 'Could not open the preview URL because it was empty.',
      });
      return;
    }

    try {
      window.location.assign(trimmedUrl);
    } catch (error) {
      console.error('[PreviewBuilds] Failed to navigate to preview URL', error);
      toast({
        variant: 'destructive',
        title: 'Failed to open preview',
        description: error instanceof Error ? error.message : 'Unexpected error when opening preview.',
      });
    }
  };

  const hasBuilds = builds.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <GitMerge className="h-5 w-5" aria-hidden="true" />
          Preview Builds
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void refresh();
          }}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground" aria-live="polite">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          Loading builds…
        </div>
      )}

      {error && !loading && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!loading && !error && !hasBuilds && (
        <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
          No preview builds are available right now.
        </div>
      )}

      {!loading && !error && hasBuilds && (
        <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
          {builds.map((build) => {
            const isCommitted = build.status === 'committed';
            const displayPreviewUrl = (build.preview_url ?? '').trim().replace(/'+$/, '');
            const createdAtLabel = formatCreatedAt(build.created_at ?? null);
            const statusLabel = isCommitted ? 'Committed' : 'Pending review';
            const statusVariant: 'secondary' | 'outline' = isCommitted ? 'secondary' : 'outline';

            return (
              <div
                key={build.id ?? build.pr_number}
                className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-sm transition hover:border-primary/50"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <a
                      href={build.pr_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-primary underline-offset-4 hover:underline"
                    >
                      PR #{build.pr_number}
                    </a>
                    <Badge variant={statusVariant as any}>{statusLabel}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{createdAtLabel}</p>
                  <p className="break-all text-xs text-muted-foreground">
                    {displayPreviewUrl || 'Preview URL unavailable'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => handleViewPreview(build)} disabled={!displayPreviewUrl}>
                    View
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PreviewBuildsPanel;

