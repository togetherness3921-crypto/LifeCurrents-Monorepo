import { createContext } from 'react';
import type { ConversationContextMode } from './conversationContextProviderContext';

export interface ConversationContextConfig {
    mode: ConversationContextMode;
    customMessageCount: number;
    summaryPrompt: string;
    forcedRecentMessageCount: number;
}

export type SummaryLevel = 'DAY' | 'WEEK' | 'MONTH';

export interface ContextActionState {
    id: string;
    type: 'summarize';
    status: 'pending' | 'running' | 'success' | 'error';
    label: string;
    summaryLevel: SummaryLevel;
    summaryPeriodStart: string;
    summaryPeriodEnd: string;
    content?: string;
    error?: string;
}

export interface ToolCallState {
    id: string;
    name: string;
    arguments: string;
    status: 'pending' | 'running' | 'success' | 'error';
    response?: string;
    error?: string;
}

export interface ConversationSummaryRecord {
    id: string;
    thread_id: string;
    summary_level: SummaryLevel;
    summary_period_start: string;
    content: string;
    created_by_message_id: string;
    created_at?: string;
}

export interface Message {
    id: string;
    parentId: string | null;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    thinking?: string;
    children: string[];
    toolCalls?: ToolCallState[];
    graphDocumentVersionId?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
    threadId?: string;
    contextActions?: ContextActionState[];
    persistedSummaries?: ConversationSummaryRecord[];
}

export interface NewMessageInput {
    parentId: string | null;
    role: Message['role'];
    content: string;
    thinking?: string;
    toolCalls?: ToolCallState[];
    graphDocumentVersionId?: string | null;
}

export type MessageStore = Record<string, Message>;

export interface ChatThread {
    id: string;
    title: string;
    createdAt: Date;
    leafMessageId: string | null;
    selectedChildByMessageId: Record<string, string>;
    rootChildren: string[];
    selectedRootChild?: string;
    selectedModelId: string;
    selectedInstructionId: string | null;
    contextConfig: ConversationContextConfig;
}

export type ThreadSettings = Pick<ChatThread, 'selectedModelId' | 'selectedInstructionId' | 'contextConfig'>;

export interface ChatContextValue {
    threads: ChatThread[];
    messages: MessageStore;
    activeThreadId: string | null;
    drafts: Record<string, string>;

    setActiveThreadId: (id: string | null) => void;
    getThread: (id: string) => ChatThread | undefined;
    createThread: () => string;
    addMessage: (threadId: string, message: NewMessageInput) => Message;
    getMessageChain: (leafId: string | null) => Message[];
    updateMessage: (
        messageId: string,
        updates: Partial<Message> | ((message: Message) => Partial<Message>)
    ) => void;
    selectBranch: (threadId: string | null, parentId: string | null, childId: string) => void;
    updateThreadTitle: (threadId: string, title: string) => void;
    updateDraft: (threadId: string, text: string) => void;
    clearDraft: (threadId: string) => void;
    updateThreadSettings: (threadId: string, settings: Partial<ThreadSettings>) => void;
}

export const ChatContext = createContext<ChatContextValue | undefined>(undefined);
