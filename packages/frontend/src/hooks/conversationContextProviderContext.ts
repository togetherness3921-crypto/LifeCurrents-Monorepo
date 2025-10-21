import { createContext } from 'react';

export type ConversationContextMode = 'all-middle-out' | 'custom' | 'intelligent';

export interface ConversationContextSettingsValue {
    mode: ConversationContextMode;
    setMode: (mode: ConversationContextMode) => void;
    customMessageCount: number;
    setCustomMessageCount: (count: number) => void;
    applyContextToMessages: <T>(messages: T[]) => T[];
    transforms: string[];
    summaryPrompt: string;
    setSummaryPrompt: (prompt: string) => void;
    forcedRecentMessages: number;
    setForcedRecentMessages: (count: number) => void;
}

export const ConversationContextSettingsContext = createContext<ConversationContextSettingsValue | undefined>(undefined);
