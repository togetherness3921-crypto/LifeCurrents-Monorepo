import { ReactNode, useCallback, useMemo } from 'react';
import {
    ConversationContextMode,
    ConversationContextSettingsContext,
    ConversationContextSettingsValue,
} from './conversationContextProviderContext';
import { useChatContext } from './useChat';
import {
    DEFAULT_CONTEXT_CONFIG,
    FORCED_RECENT_MESSAGES_MAX,
    FORCED_RECENT_MESSAGES_MIN,
} from './chatDefaults';

const CUSTOM_MIN = 1;
const CUSTOM_MAX = 200;

const clampCustomCount = (value: number) => {
    if (Number.isNaN(value)) return DEFAULT_CONTEXT_CONFIG.customMessageCount;
    return Math.min(CUSTOM_MAX, Math.max(CUSTOM_MIN, Math.round(value)));
};

const clampForcedCount = (value: number) => {
    if (Number.isNaN(value)) return DEFAULT_CONTEXT_CONFIG.forcedRecentMessages;
    return Math.min(FORCED_RECENT_MESSAGES_MAX, Math.max(FORCED_RECENT_MESSAGES_MIN, Math.round(value)));
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

    const setForcedRecentMessages = useCallback((value: number) => {
        if (!activeThreadId) return;
        updateThreadSettings(activeThreadId, {
            contextConfig: {
                ...contextConfig,
                forcedRecentMessages: clampForcedCount(value),
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
            forcedRecentMessages: contextConfig.forcedRecentMessages,
            setForcedRecentMessages,
            applyContextToMessages,
            transforms,
            summaryPrompt: contextConfig.summaryPrompt,
            setSummaryPrompt,
        }),
        [
            applyContextToMessages,
            contextConfig.customMessageCount,
            contextConfig.forcedRecentMessages,
            contextConfig.mode,
            contextConfig.summaryPrompt,
            setMode,
            setCustomMessageCount,
            setForcedRecentMessages,
            setSummaryPrompt,
            transforms,
        ]
    );

    return (
        <ConversationContextSettingsContext.Provider value={value}>
            {children}
        </ConversationContextSettingsContext.Provider>
    );
};
