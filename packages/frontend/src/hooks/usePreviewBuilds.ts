import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type PreviewBuild = Database['public']['Tables']['preview_builds']['Row'];

type PreviewBuildStatus = PreviewBuild['status'];

type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE';

type PreviewBuildsState = {
  builds: PreviewBuild[];
  loading: boolean;
  error: string | null;
};

const getSortValue = (build: PreviewBuild) => {
  if (build.created_at) {
    const parsed = Date.parse(build.created_at);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return build.pr_number;
};

const sortBuilds = (list: PreviewBuild[]) =>
  [...list].sort((a, b) => getSortValue(b) - getSortValue(a));

const getBuildKey = (build: PreviewBuild) => build.id ?? String(build.pr_number);

export const usePreviewBuilds = () => {
  const [state, setState] = useState<PreviewBuildsState>({
    builds: [],
    loading: true,
    error: null,
  });

  const fetchBuilds = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const { data, error } = await supabase
        .from('preview_builds')
        .select('*')
        .order('created_at', { ascending: false })
        .order('pr_number', { ascending: false });

      if (error) {
        throw error;
      }

      setState((prev) => ({
        ...prev,
        builds: sortBuilds(data ?? []),
        loading: false,
        error: null,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        builds: [],
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load preview builds',
      }));
    }
  }, []);

  useEffect(() => {
    fetchBuilds().catch((error) => {
      console.error('Failed to load preview builds:', error);
    });
  }, [fetchBuilds]);

  useEffect(() => {
    const channel = (supabase as any)
      .channel('preview_builds_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'preview_builds' }, (payload: any) => {
        setState((prev) => {
          const eventType = (payload?.eventType || payload?.event) as RealtimeEvent | undefined;
          const next = [...prev.builds];

          if (eventType === 'DELETE' && payload?.old) {
            const key = getBuildKey(payload.old as PreviewBuild);
            return {
              ...prev,
              builds: next.filter((build) => getBuildKey(build) !== key),
            };
          }

          if ((eventType === 'INSERT' || eventType === 'UPDATE') && payload?.new) {
            const newRow = payload.new as PreviewBuild;
            const key = getBuildKey(newRow);
            const filtered = next.filter((build) => getBuildKey(build) !== key);
            filtered.unshift(newRow);
            return {
              ...prev,
              builds: sortBuilds(filtered),
            };
          }

          return prev;
        });
      })
      .subscribe();

    return () => {
      try {
        (supabase as any).removeChannel(channel);
      } catch (error) {
        console.error('Failed to remove preview_builds channel', error);
      }
    };
  }, []);

  const unseenCount = useMemo(
    () => state.builds.filter((build) => !build.is_seen).length,
    [state.builds],
  );

  const syncIsSeen = useCallback(
    async (predicate: (query: any) => any) => {
      const query = (supabase as any).from('preview_builds').update({ is_seen: true });
      const { error } = await predicate(query);
      if (error) {
        await fetchBuilds();
        throw error;
      }
    },
    [fetchBuilds],
  );

  const markAllSeen = useCallback(async () => {
    let shouldSync = false;
    setState((prev) => {
      const hasUnseen = prev.builds.some((build) => !build.is_seen);
      if (!hasUnseen) {
        return prev;
      }
      shouldSync = true;
      return {
        ...prev,
        builds: prev.builds.map((build) => (build.is_seen ? build : { ...build, is_seen: true })),
      };
    });

    if (!shouldSync) {
      return;
    }

    await syncIsSeen((query) => query.eq('is_seen', false));
  }, [syncIsSeen]);

  const refresh = useCallback(() => fetchBuilds(), [fetchBuilds]);

  return {
    builds: state.builds,
    loading: state.loading,
    error: state.error,
    unseenCount,
    markAllSeen,
    refresh,
  };
};

type UsePreviewBuildsResult = ReturnType<typeof usePreviewBuilds>;

export type { PreviewBuild, PreviewBuildStatus, UsePreviewBuildsResult };
