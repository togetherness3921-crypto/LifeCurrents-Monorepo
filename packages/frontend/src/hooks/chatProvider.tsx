import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '@/integrations/supabase/client';
import {
  ChatContext,
  ChatThread,
  ChatContextValue,
  Message,
  MessageStore,
  NewMessageInput,
  ThreadSettings,
} from './chatProviderContext';
import { submitSupabaseOperation, flushSupabaseQueue } from '@/services/supabaseQueue';
import { DEFAULT_CONTEXT_CONFIG, DEFAULT_MODEL_ID } from './chatDefaults';
import { useMcp } from './useMcp';

const LEGACY_THREADS_KEY = 'chat_threads';
const LEGACY_MESSAGES_KEY = 'chat_messages';

type SupabaseThreadRow = {
  id: string;
  title: string | null;
  metadata: any;
  created_at: string | null;
  updated_at: string | null;
  selected_model_id: string | null;
  selected_instruction_id: string | null;
  context_config: any;
};

type SupabaseMessageRow = {
  id: string;
  thread_id: string;
  parent_id: string | null;
  role: string;
  content: string | null;
  thinking: string | null;
  tool_calls: any;
  created_at: string | null;
  updated_at: string | null;
  graph_document_version_id: string | null;
};

type SupabaseDraftRow = {
  thread_id: string;
  draft_text: string | null;
  updated_at: string | null;
};

type LegacyThread = {
  id: string;
  title: string;
  leafMessageId: string | null;
  createdAt: string;
  selectedChildByMessageId: Record<string, string>;
  rootChildren: string[];
  selectedRootChild?: string;
};

type LegacyMessage = {
  id: string;
  parentId: string | null;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  children?: string[];
  toolCalls?: any[];
};

const nowIso = () => new Date().toISOString();

const CONTEXT_MIN = 1;
const CONTEXT_MAX = 200;
const VALID_CONTEXT_MODES = new Set(['all-middle-out', 'custom', 'intelligent']);

const clampCustomMessageCount = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_CONTEXT_CONFIG.customMessageCount;
  }
  return Math.min(CONTEXT_MAX, Math.max(CONTEXT_MIN, Math.round(numeric)));
};

const sanitizeModelId = (value: unknown): string => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return DEFAULT_MODEL_ID;
};

const sanitizeInstructionId = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return null;
};

const sanitizeContextConfig = (input: unknown): ChatThread['contextConfig'] => {
  const base = { ...DEFAULT_CONTEXT_CONFIG };
  let candidate = input;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      candidate = null;
    }
  }
  if (!candidate || typeof candidate !== 'object') {
    return base;
  }
  const maybeMode = (candidate as { mode?: unknown }).mode;
  if (VALID_CONTEXT_MODES.has(maybeMode as string)) {
    base.mode = maybeMode as ChatThread['contextConfig']['mode'];
  }
  if ('customMessageCount' in (candidate as Record<string, unknown>)) {
    base.customMessageCount = clampCustomMessageCount(
      (candidate as { customMessageCount?: unknown }).customMessageCount
    );
  }
  if (typeof (candidate as { summaryPrompt?: unknown }).summaryPrompt === 'string') {
    const promptValue = String((candidate as { summaryPrompt: unknown }).summaryPrompt).trim();
    base.summaryPrompt = promptValue.length > 0 ? promptValue : DEFAULT_CONTEXT_CONFIG.summaryPrompt;
  }
  if ('forcedRecentCount' in (candidate as Record<string, unknown>)) {
    const value = (candidate as { forcedRecentCount?: unknown }).forcedRecentCount;
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) {
      base.forcedRecentCount = Math.min(6, Math.max(0, Math.round(numeric)));
    }
  }
  return base;
};

const createThreadSettings = (input?: Partial<ThreadSettings> | null): ThreadSettings => ({
  selectedModelId: sanitizeModelId(input?.selectedModelId),
  selectedInstructionId: sanitizeInstructionId(
    input && Object.prototype.hasOwnProperty.call(input, 'selectedInstructionId')
      ? input.selectedInstructionId
      : input?.selectedInstructionId
  ),
  contextConfig: sanitizeContextConfig(input?.contextConfig),
});

const buildThreadMetadata = (thread: ChatThread) => ({
  leafMessageId: thread.leafMessageId,
  selectedChildByMessageId: thread.selectedChildByMessageId,
  rootChildren: thread.rootChildren,
  selectedRootChild: thread.selectedRootChild ?? null,
});

const buildThreadUpsertPayload = (thread: ChatThread) => ({
  id: thread.id,
  title: thread.title,
  metadata: buildThreadMetadata(thread),
  selected_model_id: thread.selectedModelId,
  selected_instruction_id: thread.selectedInstructionId,
  context_config: thread.contextConfig,
  created_at: thread.createdAt.toISOString(),
  updated_at: nowIso(),
});

const convertToolCalls = (input: any): Message['toolCalls'] => {
  if (!Array.isArray(input)) return undefined;
  return input
    .map((item) => {
      if (!item) return null;
      return {
        id: String(item.id ?? uuidv4()),
        name: String(item.name ?? item.function?.name ?? 'tool'),
        arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
        status: (item.status ?? 'success') as Message['toolCalls'][number]['status'],
        response: item.response,
        error: item.error,
      };
    })
    .filter(Boolean) as Message['toolCalls'];
};

const sanitiseThreadState = (
  threadId: string,
  messageStore: MessageStore,
  metadata: any
): Pick<ChatThread, 'leafMessageId' | 'selectedChildByMessageId' | 'rootChildren' | 'selectedRootChild'> => {
  const selectedChildByMessageId: Record<string, string> = {};
  const rawSelected = (metadata?.selectedChildByMessageId || {}) as Record<string, string>;
  for (const [parentId, childId] of Object.entries(rawSelected)) {
    if (messageStore[parentId] && messageStore[childId]) {
      selectedChildByMessageId[parentId] = childId;
    }
  }

  const allRootMessages = Object.values(messageStore)
    .filter((message) => message.parentId === null && message.threadId === threadId)
    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
    .map((message) => message.id);

  const rootChildren = Array.isArray(metadata?.rootChildren)
    ? (metadata.rootChildren as string[]).filter((id: string) => allRootMessages.includes(id))
    : allRootMessages;

  const selectedRootChild = metadata?.selectedRootChild && messageStore[metadata.selectedRootChild]
    ? metadata.selectedRootChild
    : rootChildren[rootChildren.length - 1];

  let leafMessageId: string | null = metadata?.leafMessageId && messageStore[metadata.leafMessageId]
    ? metadata.leafMessageId
    : null;

  const traverseForLeaf = () => {
    let current = selectedRootChild ?? rootChildren[rootChildren.length - 1];
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const currentMessage = messageStore[current];
      if (!currentMessage || currentMessage.children.length === 0) {
        return current;
      }
      const preferredChild = selectedChildByMessageId[current]
        || currentMessage.children[currentMessage.children.length - 1];
      if (!preferredChild || !messageStore[preferredChild]) {
        return current;
      }
      current = preferredChild;
    }
    return current ?? null;
  };

  if (!leafMessageId) {
    leafMessageId = traverseForLeaf();
  }

  return {
    leafMessageId: leafMessageId ?? null,
    selectedChildByMessageId,
    rootChildren,
    selectedRootChild,
  };
};

const mapRowToThreadSettings = (row: SupabaseThreadRow): ThreadSettings =>
  createThreadSettings({
    selectedModelId: row.selected_model_id,
    selectedInstructionId: row.selected_instruction_id,
    contextConfig: row.context_config,
  });

const parseMessageRows = (rows: SupabaseMessageRow[]): MessageStore => {
  const store: MessageStore = {};
  rows.forEach((row) => {
    const createdAt = row.created_at ? new Date(row.created_at) : undefined;
    const updatedAt = row.updated_at ? new Date(row.updated_at) : createdAt;
    const baseMessage: Message = {
      id: row.id,
      parentId: row.parent_id,
      role: (row.role ?? 'assistant') as Message['role'],
      content: row.content ?? '',
      thinking: row.thinking ?? undefined,
      children: [],
      toolCalls: convertToolCalls(row.tool_calls),
      graphDocumentVersionId: row.graph_document_version_id ?? null,
      createdAt,
      updatedAt,
      threadId: row.thread_id,
      contextActions: [],
    };
    store[row.id] = baseMessage;
  });

  rows.forEach((row) => {
    if (row.parent_id && store[row.parent_id]) {
      store[row.parent_id].children.push(row.id);
    }
  });

  Object.values(store).forEach((message) => {
    message.children = message.children.sort((a, b) => {
      const aDate = store[a]?.createdAt?.getTime() ?? 0;
      const bDate = store[b]?.createdAt?.getTime() ?? 0;
      return aDate - bDate;
    });
  });

  return store;
};

const legacyMessagesToSupabase = (
  legacyMessages: Record<string, LegacyMessage>,
  messageIds: string[],
  threadId: string
): SupabaseMessageRow[] => {
  const rows: SupabaseMessageRow[] = [];
  messageIds.forEach((messageId) => {
    const message = legacyMessages[messageId];
    if (!message) return;
    rows.push({
      id: message.id,
      thread_id: threadId,
      parent_id: message.parentId,
      role: message.role,
      content: message.content,
      thinking: message.thinking ?? null,
      tool_calls: message.toolCalls ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
      graph_document_version_id: null,
    });
  });
  return rows;
};

const gatherThreadMessageIds = (
  thread: LegacyThread,
  messages: Record<string, LegacyMessage>
): string[] => {
  const result = new Set<string>();
  const queue = [...(thread.rootChildren ?? [])];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || result.has(current)) continue;
    result.add(current);
    const message = messages[current];
    if (message?.children && Array.isArray(message.children)) {
      for (const child of message.children) {
        if (child && !result.has(child)) {
          queue.push(child);
        }
      }
    }
  }
  if (thread.leafMessageId) {
    result.add(thread.leafMessageId);
  }
  return Array.from(result);
};

const toChatThread = (
  row: SupabaseThreadRow,
  messageStore: MessageStore
): ChatThread => {
  const metadata = row.metadata ?? {};
  const sanitised = sanitiseThreadState(row.id, messageStore, metadata);
  const settings = mapRowToThreadSettings(row);
  return {
    id: row.id,
    title: row.title ?? 'New Chat',
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
    leafMessageId: sanitised.leafMessageId,
    selectedChildByMessageId: sanitised.selectedChildByMessageId,
    rootChildren: sanitised.rootChildren,
    selectedRootChild: sanitised.selectedRootChild ?? undefined,
    selectedModelId: settings.selectedModelId,
    selectedInstructionId: settings.selectedInstructionId,
    contextConfig: settings.contextConfig,
  };
};

export const ChatProvider = ({ children }: { children: ReactNode }) => {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [messages, setMessages] = useState<MessageStore>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const { callTool } = useMcp();

  const threadPersistTimers = useRef<Record<string, number>>({});
  const pendingThreadPayloads = useRef<Record<string, ReturnType<typeof buildThreadUpsertPayload>>>({});
  const messagePersistTimers = useRef<Record<string, number>>({});
  const pendingMessagePayloads = useRef<Record<string, Message>>({});
  const draftPersistTimers = useRef<Record<string, number>>({});
  const pendingDraftValues = useRef<Record<string, string>>({});

  const scheduleThreadPersist = useCallback((thread: ChatThread) => {
    const payload = buildThreadUpsertPayload(thread);
    pendingThreadPayloads.current[thread.id] = payload;
    if (threadPersistTimers.current[thread.id]) {
      window.clearTimeout(threadPersistTimers.current[thread.id]);
    }
    threadPersistTimers.current[thread.id] = window.setTimeout(() => {
      const pending = pendingThreadPayloads.current[thread.id];
      if (!pending) return;
      void submitSupabaseOperation('chat.upsert_thread', pending);
      delete pendingThreadPayloads.current[thread.id];
      delete threadPersistTimers.current[thread.id];
    }, 400);
  }, []);

  const persistThreadImmediately = useCallback((thread: ChatThread) => {
    if (threadPersistTimers.current[thread.id]) {
      window.clearTimeout(threadPersistTimers.current[thread.id]);
      delete threadPersistTimers.current[thread.id];
    }
    delete pendingThreadPayloads.current[thread.id];
    const payload = buildThreadUpsertPayload(thread);
    void submitSupabaseOperation('chat.upsert_thread', payload);
  }, []);

  const scheduleMessagePersist = useCallback((message: Message) => {
    pendingMessagePayloads.current[message.id] = message;
    if (messagePersistTimers.current[message.id]) {
      window.clearTimeout(messagePersistTimers.current[message.id]);
    }
    messagePersistTimers.current[message.id] = window.setTimeout(() => {
      const payload = pendingMessagePayloads.current[message.id];
      if (!payload) return;
      const updateFields: Record<string, unknown> = {
        content: payload.content,
        thinking: payload.thinking ?? null,
        tool_calls: payload.toolCalls && payload.toolCalls.length > 0 ? payload.toolCalls : null,
        graph_document_version_id: payload.graphDocumentVersionId ?? null,
        updated_at: nowIso(),
      };
      void submitSupabaseOperation('chat.update_message', { id: payload.id, fields: updateFields });
      delete pendingMessagePayloads.current[message.id];
      delete messagePersistTimers.current[message.id];
    }, 600);
  }, []);

  const scheduleDraftPersist = useCallback((threadId: string, text: string) => {
    pendingDraftValues.current[threadId] = text;
    if (draftPersistTimers.current[threadId]) {
      window.clearTimeout(draftPersistTimers.current[threadId]);
    }
    draftPersistTimers.current[threadId] = window.setTimeout(() => {
      const value = pendingDraftValues.current[threadId] ?? '';
      if (value.trim().length === 0) {
        void submitSupabaseOperation('chat.delete_draft', { thread_id: threadId });
      } else {
        void submitSupabaseOperation('chat.upsert_draft', {
          thread_id: threadId,
          draft_text: value,
          updated_at: nowIso(),
        });
      }
      delete pendingDraftValues.current[threadId];
      delete draftPersistTimers.current[threadId];
    }, 400);
  }, []);

  const migrateLegacyData = useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      const legacyThreadsRaw = window.localStorage.getItem(LEGACY_THREADS_KEY);
      const legacyMessagesRaw = window.localStorage.getItem(LEGACY_MESSAGES_KEY);
      if (!legacyThreadsRaw || !legacyMessagesRaw) return;

      const parsedThreads: LegacyThread[] = JSON.parse(legacyThreadsRaw);
      const parsedMessages: Record<string, LegacyMessage> = JSON.parse(legacyMessagesRaw);

      if (!Array.isArray(parsedThreads) || parsedThreads.length === 0) return;

      for (const legacyThread of parsedThreads) {
        await submitSupabaseOperation('chat.upsert_thread', {
          id: legacyThread.id,
          title: legacyThread.title,
          metadata: {
            leafMessageId: legacyThread.leafMessageId,
            selectedChildByMessageId: legacyThread.selectedChildByMessageId,
            rootChildren: legacyThread.rootChildren,
            selectedRootChild: legacyThread.selectedRootChild ?? null,
          },
          created_at: legacyThread.createdAt,
          updated_at: nowIso(),
        });
        const messageIds = gatherThreadMessageIds(legacyThread, parsedMessages);
        const messageRows = legacyMessagesToSupabase(parsedMessages, messageIds, legacyThread.id);
        for (const row of messageRows) {
          await submitSupabaseOperation('chat.upsert_message', row);
        }
      }

      window.localStorage.removeItem(LEGACY_THREADS_KEY);
      window.localStorage.removeItem(LEGACY_MESSAGES_KEY);
    } catch (error) {
      console.warn('[ChatProvider] Legacy migration failed', error);
    }
  }, []);

  useEffect(() => {
    void flushSupabaseQueue();
  }, []);

  useEffect(() => {
    let isCancelled = false;
    const load = async () => {
      try {
        const { data: threadRows, error: threadError } = await supabase
          .from('chat_threads')
          .select('*')
          .order('created_at', { ascending: true });

        if (threadError) throw threadError;

        if (!threadRows || threadRows.length === 0) {
          await migrateLegacyData();
        }

        const { data: refreshedThreads, error: refreshedError } = await supabase
          .from('chat_threads')
          .select('*')
          .order('created_at', { ascending: true });
        if (refreshedError) throw refreshedError;

        const { data: messageRows, error: messageError } = await supabase
          .from('chat_messages')
          .select('*');
        if (messageError) throw messageError;

        const { data: draftRows, error: draftError } = await supabase
          .from('chat_drafts')
          .select('*');
        if (draftError) throw draftError;

        // Fetch conversation summaries for all threads
        const { data: summaryRows, error: summaryError } = await supabase
          .from('conversation_summaries')
          .select('*');
        if (summaryError) {
          console.warn('[ChatProvider] Failed to load conversation summaries', summaryError);
        }

        const { data: lastActiveThread, error: lastActiveThreadError } = await supabase
          .from('user_settings')
          .select('value')
          .eq('key', 'last_active_thread_id')
          .single();
        if (lastActiveThreadError && lastActiveThreadError.code !== 'PGRST116') {
          console.warn('[ChatProvider] Failed to load last active thread', lastActiveThreadError);
        }

        const messageStore = parseMessageRows((messageRows ?? []) as SupabaseMessageRow[]);

        // Associate summaries with messages by created_by_message_id
        if (summaryRows && summaryRows.length > 0) {
          summaryRows.forEach((summaryRow) => {
            const messageId = summaryRow.created_by_message_id;
            if (messageId && messageStore[messageId]) {
              if (!messageStore[messageId].persistedSummaries) {
                messageStore[messageId].persistedSummaries = [];
              }
              messageStore[messageId].persistedSummaries!.push({
                id: summaryRow.id,
                thread_id: summaryRow.thread_id,
                summary_level: summaryRow.summary_level as 'DAY' | 'WEEK' | 'MONTH',
                summary_period_start: summaryRow.summary_period_start,
                content: summaryRow.content,
                created_by_message_id: summaryRow.created_by_message_id,
                created_at: summaryRow.created_at,
              });
            }
          });
        }

        const parsedThreads = (refreshedThreads ?? []).map((row) =>
          toChatThread(row as SupabaseThreadRow, messageStore)
        );

        const draftsMap = (draftRows ?? []).reduce((acc, row) => {
          const draft = row as SupabaseDraftRow;
          acc[draft.thread_id] = draft.draft_text ?? '';
          return acc;
        }, {} as Record<string, string>);

        if (!isCancelled) {
          setMessages(messageStore);
          setThreads(parsedThreads);
          setDrafts(draftsMap);
          setIsLoaded(true);
          setActiveThreadId((current) => {
            const lastActiveId = lastActiveThread?.value;
            if (lastActiveId && parsedThreads.some((thread) => thread.id === lastActiveId)) {
              return lastActiveId;
            }
            if (current && parsedThreads.some((thread) => thread.id === current)) {
              return current;
            }
            const mostRecent = parsedThreads.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))[0]?.id ?? null;
            return mostRecent;
          });
        }
      } catch (error) {
        console.error('[ChatProvider] Failed to load chat data', error);
        if (!isCancelled) {
          setThreads([]);
          setMessages({});
          setDrafts({});
          setIsLoaded(true);
        }
      }
    };

    void load();

    return () => {
      isCancelled = true;
    };
  }, [migrateLegacyData]);

  useEffect(() => {
    if (activeThreadId) {
      void callTool('set_user_setting', { key: 'last_active_thread_id', value: activeThreadId });
    }
  }, [activeThreadId, callTool]);

  useEffect(() => {
    const threadTimers = threadPersistTimers.current;
    const messageTimers = messagePersistTimers.current;
    const draftTimers = draftPersistTimers.current;
    return () => {
      Object.values(threadTimers).forEach((timer) => window.clearTimeout(timer));
      Object.values(messageTimers).forEach((timer) => window.clearTimeout(timer));
      Object.values(draftTimers).forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const getThread = useCallback((id: string) => threads.find((thread) => thread.id === id), [threads]);

  const getMessageChain = useCallback(
    (leafId: string | null): Message[] => {
      if (!leafId) return [];
      const chain: Message[] = [];
      let currentId: string | null = leafId;
      const visited = new Set<string>();
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const message = messages[currentId];
        if (!message) break;
        chain.unshift(message);
        currentId = message.parentId;
      }
      return chain;
    },
    [messages]
  );

  const persistThreadState = useCallback(
    (thread: ChatThread) => {
      persistThreadImmediately(thread);
    },
    [persistThreadImmediately]
  );

  const updateThreadState = useCallback(
    (threadId: string, updater: (thread: ChatThread) => ChatThread): ChatThread | null => {
      let updatedThread: ChatThread | null = null;
      setThreads((previous) =>
        previous.map((thread) => {
          if (thread.id !== threadId) return thread;
          const next = updater(thread);
          updatedThread = next;
          return next;
        })
      );
      return updatedThread;
    },
    []
  );

  const createThread = useCallback(() => {
    const id = uuidv4();
    const now = new Date();
    const source = activeThreadId ? getThread(activeThreadId) : null;
    const settings = createThreadSettings(
      source
        ? {
          selectedModelId: source.selectedModelId,
          selectedInstructionId: source.selectedInstructionId,
          contextConfig: source.contextConfig,
        }
        : null
    );

    const newThread: ChatThread = {
      id,
      title: 'New Chat',
      leafMessageId: null,
      createdAt: now,
      selectedChildByMessageId: {},
      rootChildren: [],
      selectedRootChild: undefined,
      selectedModelId: settings.selectedModelId,
      selectedInstructionId: settings.selectedInstructionId,
      contextConfig: settings.contextConfig,
    };

    setThreads((previous) => [...previous, newThread]);
    setActiveThreadId(id);
    persistThreadImmediately(newThread);
    return id;
  }, [activeThreadId, getThread, persistThreadImmediately]);

  const addMessage = useCallback(
    (threadId: string, messageData: NewMessageInput): Message => {
      const id = uuidv4();
      const createdAt = new Date();
      const newMessage: Message = {
        id,
        parentId: messageData.parentId,
        role: messageData.role,
        content: messageData.content,
        thinking: messageData.thinking,
        children: [],
        toolCalls: messageData.toolCalls ? [...messageData.toolCalls] : [],
        graphDocumentVersionId: messageData.graphDocumentVersionId ?? null,
        createdAt,
        updatedAt: createdAt,
        threadId,
        contextActions: [],
      };

      // Perform both state updates in a single synchronous block to prevent race conditions
      setMessages((previous) => {
        const updated: MessageStore = { ...previous, [id]: newMessage };
        if (messageData.parentId && updated[messageData.parentId]) {
          const parent = updated[messageData.parentId];
          updated[messageData.parentId] = {
            ...parent,
            children: [...parent.children, id],
          };
        }
        return updated;
      });

      setThreads((previous) =>
        previous.map((thread) => {
          if (thread.id !== threadId) return thread;

          const selectedChildByMessageId = { ...thread.selectedChildByMessageId };
          let rootChildren = [...thread.rootChildren];
          let selectedRootChild = thread.selectedRootChild;

          if (messageData.parentId) {
            selectedChildByMessageId[messageData.parentId] = id;
          } else {
            rootChildren = [...rootChildren, id];
            selectedRootChild = id;
          }

          const updatedThread: ChatThread = {
            ...thread,
            leafMessageId: id,
            selectedChildByMessageId,
            rootChildren,
            selectedRootChild,
          };
          // Persist thread state immediately to ensure consistency
          persistThreadState(updatedThread);
          return updatedThread;
        })
      );

      const newRow: SupabaseMessageRow = {
        id,
        thread_id: threadId,
        parent_id: messageData.parentId,
        role: messageData.role,
        content: messageData.content,
        thinking: messageData.thinking ?? null,
        tool_calls: newMessage.toolCalls && newMessage.toolCalls.length > 0 ? newMessage.toolCalls : null,
        graph_document_version_id: messageData.graphDocumentVersionId ?? null,
        created_at: createdAt.toISOString(),
        updated_at: createdAt.toISOString(),
      };
      void submitSupabaseOperation('chat.add_message', { row: newRow });

      return newMessage;
    },
    [persistThreadState]
  );

  const updateMessage = useCallback(
    (messageId: string, updates: Partial<Message> | ((message: Message) => Partial<Message>)) => {
      setMessages((previous) => {
        const current = previous[messageId];
        if (!current) return previous;
        const applied = typeof updates === 'function' ? updates(current) : updates;
        const next: Message = {
          ...current,
          ...applied,
          updatedAt: new Date(),
        };
        const updatedStore: MessageStore = { ...previous, [messageId]: next };
        scheduleMessagePersist(next);
        return updatedStore;
      });
    },
    [scheduleMessagePersist]
  );

  const selectBranch = useCallback(
    (threadId: string | null, parentId: string | null, childId: string) => {
      if (!threadId) return;
      const updatedThread = updateThreadState(threadId, (thread) => {
        const selectedChildByMessageId = { ...thread.selectedChildByMessageId };
        let selectedRootChild = thread.selectedRootChild;

        if (parentId) {
          selectedChildByMessageId[parentId] = childId;
        } else {
          selectedRootChild = childId;
        }

        let nextLeaf: string | undefined | null = childId;
        const visited = new Set<string>();

        while (nextLeaf && !visited.has(nextLeaf)) {
          visited.add(nextLeaf);
          const message = messages[nextLeaf];
          if (!message || message.children.length === 0) break;
          const selectedChild = selectedChildByMessageId[nextLeaf] ?? message.children[message.children.length - 1];
          if (!selectedChild) break;
          selectedChildByMessageId[nextLeaf] = selectedChild;
          nextLeaf = selectedChild;
        }

        return {
          ...thread,
          selectedChildByMessageId,
          selectedRootChild,
          leafMessageId: nextLeaf || childId,
        };
      });

      if (updatedThread) {
        persistThreadState(updatedThread);
      }
    },
    [messages, persistThreadState, updateThreadState]
  );

  const updateThreadTitle = useCallback(
    (threadId: string, title: string) => {
      const updatedThread = updateThreadState(threadId, (thread) => ({
        ...thread,
        title,
      }));
      if (updatedThread) {
        persistThreadState(updatedThread);
      }
    },
    [persistThreadState, updateThreadState]
  );

  const updateDraft = useCallback(
    (threadId: string, text: string) => {
      setDrafts((previous) => ({ ...previous, [threadId]: text }));
      scheduleDraftPersist(threadId, text);
    },
    [scheduleDraftPersist]
  );

  const clearDraft = useCallback((threadId: string) => {
    setDrafts((previous) => {
      const updated = { ...previous };
      delete updated[threadId];
      return updated;
    });
    if (draftPersistTimers.current[threadId]) {
      window.clearTimeout(draftPersistTimers.current[threadId]);
      delete draftPersistTimers.current[threadId];
    }
    delete pendingDraftValues.current[threadId];
    void submitSupabaseOperation('chat.delete_draft', { thread_id: threadId });
  }, []);

  const updateThreadSettings = useCallback(
    (threadId: string, settings: Partial<ThreadSettings>) => {
      const updatedThread = updateThreadState(threadId, (thread) => {
        const merged: Partial<ThreadSettings> = {
          selectedModelId: thread.selectedModelId,
          selectedInstructionId: thread.selectedInstructionId,
          contextConfig: thread.contextConfig,
        };

        if (Object.prototype.hasOwnProperty.call(settings, 'selectedModelId')) {
          merged.selectedModelId = settings.selectedModelId;
        }

        if (Object.prototype.hasOwnProperty.call(settings, 'selectedInstructionId')) {
          merged.selectedInstructionId = settings.selectedInstructionId ?? null;
        }

        if (Object.prototype.hasOwnProperty.call(settings, 'contextConfig')) {
          merged.contextConfig = settings.contextConfig ?? null;
        }

        const normalised = createThreadSettings(merged);
        return {
          ...thread,
          ...normalised,
        };
      });

      if (updatedThread) {
        scheduleThreadPersist(updatedThread);
      }
    },
    [scheduleThreadPersist, updateThreadState]
  );

  const value: ChatContextValue = useMemo(
    () => ({
      threads,
      messages,
      drafts,
      activeThreadId,
      setActiveThreadId,
      getThread,
      createThread,
      addMessage,
      getMessageChain,
      updateMessage,
      selectBranch,
      updateThreadTitle,
      updateDraft,
      clearDraft,
      updateThreadSettings,
    }),
    [
      threads,
      messages,
      drafts,
      activeThreadId,
      getThread,
      createThread,
      addMessage,
      getMessageChain,
      updateMessage,
      selectBranch,
      updateThreadTitle,
      updateDraft,
      clearDraft,
      updateThreadSettings,
    ]
  );

  if (!isLoaded) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading chats...</div>;
  }

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

