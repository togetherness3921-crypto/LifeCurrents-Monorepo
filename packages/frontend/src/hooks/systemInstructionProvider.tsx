import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { SystemInstruction, SystemInstructionsContext, SystemInstructionsContextValue } from './systemInstructionProviderContext';
import { useChatContext } from './useChat';

type InstructionRow = Database['public']['Tables']['system_instructions']['Row'];

type FetchOptions = {
  showLoading?: boolean;
};

const mapRowToInstruction = (row: InstructionRow): SystemInstruction => ({
  id: row.id,
  title: row.title ?? 'Untitled instruction',
  content: row.content ?? '',
  updatedAt: row.updated_at ?? row.created_at,
});

const normalizeTitle = (title: string) => title.trim() || 'Untitled instruction';

export const SystemInstructionsProvider = ({ children }: { children: ReactNode }) => {
  const { activeThreadId, getThread, updateThreadSettings } = useChatContext();
  const [instructions, setInstructions] = useState<SystemInstruction[]>([]);
  const [defaultInstructionId, setDefaultInstructionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const activeThread = useMemo(
    () => (activeThreadId ? getThread(activeThreadId) ?? null : null),
    [activeThreadId, getThread]
  );
  const threadInstructionId = activeThread?.selectedInstructionId ?? null;
  const activeInstructionId = useMemo(
    () => threadInstructionId ?? defaultInstructionId,
    [defaultInstructionId, threadInstructionId]
  );

  const ensureDefaultInstruction = useCallback(async (): Promise<InstructionRow | null> => {
    try {
      const { data, error } = await supabase
        .from('system_instructions')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (data) return data;

      // If no instructions exist, create a default one
      const { data: inserted, error: insertError } = await supabase
        .from('system_instructions')
        .insert({
          title: 'Primary Instruction',
          content: '# New Instruction\nThis is a default instruction.',
          is_active: true,
        })
        .select('*')
        .single();

      if (insertError) throw insertError;
      return inserted;
    } catch (err) {
      console.error("Error ensuring default instruction:", err);
      return null;
    }
  }, []);

  const fetchInstructions = useCallback(async ({ showLoading = true }: FetchOptions = {}) => {
    if (showLoading) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('system_instructions')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      let rows = data || [];
      if (rows.length === 0) {
        const fallback = await ensureDefaultInstruction();
        if (fallback) rows = [fallback];
      }

      // Set active to first one if none is marked active
      if (rows.length > 0 && !rows.some(r => r.is_active)) {
        rows[0].is_active = true;
      }

      const newInstructions = rows.map(mapRowToInstruction);
      setInstructions(newInstructions);

      const active = rows.find(r => r.is_active);
      setDefaultInstructionId(active?.id || null);

    } catch (err) {
      console.error("Error fetching instructions:", err);
      setInstructions([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [ensureDefaultInstruction]);

  useEffect(() => {
    fetchInstructions();
  }, [fetchInstructions]);

  useEffect(() => {
    if (activeThread && !activeThread.selectedInstructionId && defaultInstructionId) {
      updateThreadSettings(activeThread.id, { selectedInstructionId: defaultInstructionId });
    }
  }, [activeThread, defaultInstructionId, updateThreadSettings]);

  useEffect(() => {
    if (!activeThreadId || !threadInstructionId) {
      return;
    }
    if (loading || instructions.length === 0) {
      return;
    }
    const exists = instructions.some((instruction) => instruction.id === threadInstructionId);
    if (!exists) {
      updateThreadSettings(activeThreadId, { selectedInstructionId: null });
    }
  }, [activeThreadId, instructions, threadInstructionId, updateThreadSettings, loading]);

  useEffect(() => {
    const channel = supabase
      .channel('system_instructions_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_instructions' },
        () => fetchInstructions({ showLoading: false })
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchInstructions]);

  const applyActivation = useCallback(async (id: string) => {
    // Deactivate all others
    await supabase.from('system_instructions').update({ is_active: false }).neq('id', id);
    // Activate the one
    await supabase.from('system_instructions').update({ is_active: true }).eq('id', id);
    setDefaultInstructionId(id);
  }, []);

  const createInstruction = useCallback(async (title: string, content: string, options?: { activate?: boolean }) => {
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('system_instructions')
        .insert({ title: normalizeTitle(title), content })
        .select('*')
        .single();
      if (error) throw error;

      if (options?.activate && data) {
        await applyActivation(data.id);
      }
      await fetchInstructions({ showLoading: false });
      return data?.id || null;
    } catch (err) {
      console.error("Error creating instruction:", err);
      return null;
    } finally {
      setSaving(false);
    }
  }, [applyActivation, fetchInstructions]);

  const updateInstruction = useCallback(async (id: string, title: string, content: string, options?: { activate?: boolean }) => {
    setSaving(true);
    try {
      await supabase
        .from('system_instructions')
        .update({ title: normalizeTitle(title), content, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (options?.activate) {
        await applyActivation(id);
      }
      await fetchInstructions({ showLoading: false });
    } catch (err) {
      console.error("Error updating instruction:", err);
    } finally {
      setSaving(false);
    }
  }, [applyActivation, fetchInstructions]);

  const deleteInstruction = useCallback(async (id: string) => {
    setSaving(true);
    try {
      await supabase.from('system_instructions').delete().eq('id', id);
      await fetchInstructions({ showLoading: false });
    } catch (err) {
      console.error("Error deleting instruction:", err);
    } finally {
      setSaving(false);
    }
  }, [fetchInstructions]);

  const setActiveInstruction = useCallback(
    async (id: string) => {
      if (activeThreadId) {
        updateThreadSettings(activeThreadId, { selectedInstructionId: id });
      } else {
        setDefaultInstructionId(id);
      }
    },
    [activeThreadId, updateThreadSettings]
  );

  const overwriteActiveInstruction = useCallback(async (content: string) => {
    if (!activeInstructionId) return;
    const current = instructions.find(i => i.id === activeInstructionId);
    if (!current) return;
    await updateInstruction(activeInstructionId, current.title, content, { activate: true });
  }, [activeInstructionId, instructions, updateInstruction]);

  const activeInstruction = useMemo(() => instructions.find(i => i.id === activeInstructionId) || null, [instructions, activeInstructionId]);

  const contextValue = useMemo<SystemInstructionsContextValue>(() => ({
    instructions,
    activeInstructionId,
    activeInstruction,
    loading,
    saving,
    getUsageScore: () => 0,
    recordInstructionUsage: () => { },
    createInstruction,
    updateInstruction,
    deleteInstruction,
    setActiveInstruction,
    overwriteActiveInstruction,
    refreshActiveFromSupabase: fetchInstructions,
  }), [
    instructions,
    activeInstructionId,
    activeInstruction,
    loading,
    saving,
    createInstruction,
    updateInstruction,
    deleteInstruction,
    setActiveInstruction,
    overwriteActiveInstruction,
    fetchInstructions,
  ]);

  return (
    <SystemInstructionsContext.Provider value={contextValue}>
      {children}
    </SystemInstructionsContext.Provider>
  );
};
