import { ReactNode, useCallback, useMemo } from 'react';
import {
    ConversationContextMode,
    ConversationContextSettingsContext,
    ConversationContextSettingsValue,
} from './conversationContextProviderContext';
import { useChatContext } from './useChat';
import { DEFAULT_CONTEXT_CONFIG } from './chatDefaults';

const CUSTOM_MIN = 1;
const CUSTOM_MAX = 200;

const clampCustomCount = (value: number) => {
    if (Number.isNaN(value)) return DEFAULT_CONTEXT_CONFIG.customMessageCount;
    return Math.min(CUSTOM_MAX, Math.max(CUSTOM_MIN, Math.round(value)));
};

export const ConversationContextProvider = ({ children }: { children: ReactNode }) => {
    const { activeThreadId, getThread, updateThreadSettings } = useChatContext();
    const activeThread = useMemo(
        () => (activeThreadId ? getThread(activeThreadId) ?? null : null),
        [activeThreadId, getThread]
    );
    const contextConfig = activeThread?.contextConfig ?? DEFAULT_CONTEXT_CONFIG;

    const setMode = useCallback((nextMode: ConversationContextMode) => {
        if (!activeThreadId) return;
        updateThreadSettings(activeThreadId, {
            contextConfig: {
                ...contextConfig,
                mode: nextMode,
            },
        });
    }, [activeThreadId, contextConfig, updateThreadSettings]);

    const setCustomMessageCount = useCallback((value: number) => {
        if (!activeThreadId) return;
        updateThreadSettings(activeThreadId, {
            contextConfig: {
                ...contextConfig,
                customMessageCount: clampCustomCount(value),
            },
        });
    }, [activeThreadId, contextConfig, updateThreadSettings]);

    const setSummaryPrompt = useCallback(
        (prompt: string) => {
            if (!activeThreadId) return;
            updateThreadSettings(activeThreadId, {
                contextConfig: {
                    ...contextConfig,
                    summaryPrompt: prompt,
                },
            });
        },
        [activeThreadId, contextConfig, updateThreadSettings]
    );

    const setForcedRecentMessages = useCallback(
        (count: number) => {
            if (!activeThreadId) return;
            const clamped = Math.min(100, Math.max(0, Math.round(count)));
            updateThreadSettings(activeThreadId, {
                contextConfig: {
                    ...contextConfig,
                    forcedRecentMessages: clamped,
                },
            });
        },
        [activeThreadId, contextConfig, updateThreadSettings]
    );

    const applyContextToMessages = useCallback<ConversationContextSettingsValue['applyContextToMessages']>(
        (messages) => {
            if (!messages || messages.length === 0) {
                return [];
            }

            if (contextConfig.mode === 'all-middle-out' || contextConfig.mode === 'intelligent') {
                return [...messages];
            }

            const limit = clampCustomCount(contextConfig.customMessageCount);
            if (limit >= messages.length) {
                return [...messages];
            }
            return messages.slice(messages.length - limit);
        },
        [contextConfig.customMessageCount, contextConfig.mode]
    );

    const transforms = useMemo(
        () => (contextConfig.mode === 'all-middle-out' ? ['middle-out'] : []),
        [contextConfig.mode]
    );

    const value = useMemo<ConversationContextSettingsValue>(
        () => ({
            mode: contextConfig.mode,
            setMode,
            customMessageCount: contextConfig.customMessageCount,
            setCustomMessageCount,
            applyContextToMessages,
            transforms,
            summaryPrompt: contextConfig.summaryPrompt,
            setSummaryPrompt,
            forcedRecentMessages: contextConfig.forcedRecentMessages ?? 0,
            setForcedRecentMessages,
        }),
        [
            applyContextToMessages,
            contextConfig.customMessageCount,
            contextConfig.mode,
            contextConfig.summaryPrompt,
            contextConfig.forcedRecentMessages,
            setMode,
            setCustomMessageCount,
            setSummaryPrompt,
            setForcedRecentMessages,
            transforms,
        ]
    );

    return (
        <ConversationContextSettingsContext.Provider value={value}>
            {children}
        </ConversationContextSettingsContext.Provider>
    );
};
