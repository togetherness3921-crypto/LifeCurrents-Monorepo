import { createContext } from 'react';

export type ConversationContextMode = 'last-8' | 'all-middle-out' | 'custom' | 'intelligent';

export interface ConversationContextSettingsValue {
    mode: ConversationContextMode;
    setMode: (mode: ConversationContextMode) => void;
    customMessageCount: number;
    setCustomMessageCount: (count: number) => void;
    applyContextToMessages: <T>(messages: T[]) => T[];
    transforms: string[];
    summaryPrompt: string;
    setSummaryPrompt: (prompt: string) => void;
}

export const ConversationContextSettingsContext = createContext<ConversationContextSettingsValue | undefined>(undefined);
