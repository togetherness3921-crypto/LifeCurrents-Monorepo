import React, { useState, FormEvent, useEffect, useRef, useCallback, useMemo } from 'react';
import ChatMessage from './ChatMessage';
import {
    getGeminiResponse,
    getTitleSuggestion,
    getToolIntent,
    type ApiToolDefinition,
    type ApiToolCall,
    type ApiMessage,
} from '@/services/openRouter';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Send, Square, PlusCircle, Cog, Mic, MicOff, ChevronLeft } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { useChatContext } from '@/hooks/useChat';
import { useSystemInstructions } from '@/hooks/useSystemInstructions';
import SettingsDialog from './SettingsDialog';
import { useMcp } from '@/hooks/useMcp';
import useModelSelection from '@/hooks/useModelSelection';
import { useConversationContext } from '@/hooks/useConversationContext';
import { useGraphHistory } from '@/hooks/graphHistoryProvider';
import { cn } from '@/lib/utils';
import { parseGraphToolResult } from '@/lib/mcp/graphResult';
import { useAudioTranscriptionRecorder } from '@/hooks/useAudioTranscriptionRecorder';
import RecordingStatusBar from './RecordingStatusBar';
import ConnectivityStatusBar from './ConnectivityStatusBar';
import { usePreviewBuilds } from '@/hooks/usePreviewBuilds';
import { Message, ContextActionState } from '@/hooks/chatProviderContext';
import { prepareIntelligentContext, type SummarizeActionDescriptor, type SummarizeActionUpdate } from '@/services/intelligentContext';
import { v4 as uuidv4 } from 'uuid';
import { useSidebar } from './ChatLayout';

const SETTINGS_BADGE_MAX = 99;
const MAX_AGENT_ITERATIONS = 8;

type SerializableToolCall = NonNullable<Message['toolCalls']>[number];

const ensureJsonArguments = (value: SerializableToolCall['arguments']): string => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return '{}';
        }
        try {
            JSON.parse(trimmed);
            return trimmed;
        } catch {
            return JSON.stringify(trimmed);
        }
    }

    try {
        return JSON.stringify(value ?? {});
    } catch {
        return '{}';
    }
};

const normaliseToolResultContent = (toolCall: SerializableToolCall): string => {
    const { response, error, status } = toolCall;

    if (typeof response === 'string') {
        return response;
    }

    if (response !== undefined && response !== null) {
        try {
            return typeof response === 'object' ? JSON.stringify(response) : String(response);
        } catch {
            return String(response);
        }
    }

    if (typeof error === 'string' && error.length > 0) {
        return error.startsWith('Error:') ? error : `Error: ${error}`;
    }

    if (status === 'error') {
        return 'Error: Tool execution failed.';
    }

    return '';
};

const createToolCallId = (messageId: string, toolCall: SerializableToolCall, index: number): string => {
    if (toolCall.id && toolCall.id.trim().length > 0) {
        return toolCall.id;
    }
    return `${messageId}-tool-${index + 1}`;
};

const serialiseMessageHistoryForApi = (history: Message[]): ApiMessage[] => {
    if (!history || history.length === 0) {
        return [];
    }

    const historyMap = new Map(history.map((message) => [message.id, message]));

    // FEATURE 6: Helper function to prepend timestamp to content
    const prependTimestamp = (content: string, createdAt?: Date): string => {
        if (!createdAt) return content;
        const timeStr = createdAt.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
        const dateStr = createdAt.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
        });
        return `[${timeStr} | ${dateStr}] ${content}`;
    };

    return history.flatMap((message) => {
        if (message.role === 'assistant') {
            const toolStates = Array.isArray(message.toolCalls) ? message.toolCalls : [];
            const toolCalls: ApiToolCall[] = [];
            const toolMessages: ApiMessage[] = [];
            const hasSeparateToolMessages = history.some(
                (candidate) => candidate.parentId === message.id && candidate.role === 'tool'
            );

            toolStates.forEach((toolCall, index) => {
                if (!toolCall) return;
                const toolCallId = createToolCallId(message.id, toolCall, index);
                const toolName = toolCall.name && toolCall.name.trim().length > 0 ? toolCall.name : 'tool';
                const argumentsString = ensureJsonArguments(toolCall.arguments);

                toolCalls.push({
                    id: toolCallId,
                    type: 'function',
                    function: {
                        name: toolName,
                        arguments: argumentsString,
                    },
                });

                if (!hasSeparateToolMessages) {
                    const content = normaliseToolResultContent(toolCall);
                    toolMessages.push({
                        role: 'tool',
                        tool_call_id: toolCallId,
                        content,
                    });
                }
            });

            // FEATURE 6: Prepend timestamp to assistant message content
            // For assistant messages with tool calls but no content, keep content empty
            // to avoid confusing the model with timestamp-only content
            const hasContent = message.content && message.content.trim().length > 0;
            const assistantMessage: ApiMessage = {
                role: 'assistant',
                content: hasContent ? prependTimestamp(message.content, message.createdAt) : (message.content ?? ''),
                ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            };

            return [assistantMessage, ...toolMessages];
        }

        if (message.role === 'tool') {
            const parent = message.parentId ? historyMap.get(message.parentId) : undefined;
            let parentToolCallId: string | undefined;

            if (parent?.toolCalls) {
                parentToolCallId = parent.toolCalls.find((toolCall) => toolCall.response === message.content)?.id;

                if (!parentToolCallId && typeof message.content === 'string') {
                    parentToolCallId = parent.toolCalls.find((toolCall) => {
                        if (toolCall.error && message.content) {
                            const normalisedError = toolCall.error.startsWith('Error:')
                                ? toolCall.error
                                : `Error: ${toolCall.error}`;
                            return message.content.includes(normalisedError);
                        }
                        return false;
                    })?.id;
                }

                if (!parentToolCallId) {
                    parentToolCallId = parent.toolCalls[0]?.id;
                }
            }

            const fallbackId = parentToolCallId || (message.parentId ? `${message.parentId}-tool` : `${message.id}-tool`);

            // FEATURE 6: Tool messages don't need timestamps (they're already contextualized by the assistant message)
            return [
                {
                    role: 'tool',
                    tool_call_id: fallbackId,
                    content: message.content ?? '',
                },
            ];
        }

        // FEATURE 6: Prepend timestamp to user and system messages
        return [
            {
                role: message.role,
                content: prependTimestamp(message.content ?? '', message.createdAt),
            },
        ];
    });
};

// Debounce function
function debounce<F extends (...args: any[]) => any>(func: F, waitFor: number) {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    return (...args: Parameters<F>): Promise<ReturnType<F>> =>
        new Promise(resolve => {
            if (timeout) {
                clearTimeout(timeout);
            }

            timeout = setTimeout(() => resolve(func(...args)), waitFor);
        });
}

const ChatPane = () => {
    const { isSidebarOpen, setIsSidebarOpen } = useSidebar();
    const {
        activeThreadId,
        threads,
        getThread,
        addMessage,
        createThread,
        getMessageChain,
        updateMessage,
        selectBranch,
        updateThreadTitle,
        updateDraft,
        clearDraft,
        drafts,
        messages: allMessages // get all messages for parent lookup
    } = useChatContext();

    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
    const [isSettingsDialogOpen, setSettingsDialogOpen] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const { activeInstruction, activeInstructionId } = useSystemInstructions();
    const { tools: availableTools, callTool } = useMcp();
    const { selectedModel, recordModelUsage, getToolIntentCheck } = useModelSelection();
    const { mode, summaryPrompt, applyContextToMessages, transforms, forcedRecentMessages } = useConversationContext();
    const { registerLatestMessage, revertToMessage, applyPatchResult, activeMessageId, isViewingHistorical, syncToThread } = useGraphHistory();

    // BUG FIX 1: Explicitly memoize activeThread, selectedLeafId, and messages to prevent invisible message bug
    // This ensures that the message chain is always recomputed when the underlying state changes,
    // preventing race conditions in long conversations with multiple forks
    const activeThread = useMemo(() =>
        activeThreadId ? threads.find((thread) => thread.id === activeThreadId) : null,
        [activeThreadId, threads]
    );

    const selectedLeafId = useMemo(() =>
        activeThread?.leafMessageId || activeThread?.selectedRootChild || null,
        [activeThread]
    );

    const messages = useMemo(() => {
        if (!selectedLeafId) return [];
        const chain: Message[] = [];
        let currentId: string | null = selectedLeafId;
        const visited = new Set<string>();
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            const message = allMessages[currentId];
            if (!message) break;
            chain.unshift(message);
            currentId = message.parentId;
        }
        return chain;
    }, [selectedLeafId, allMessages]);

    useEffect(() => {
        if (activeThreadId) {
            void syncToThread(messages);
        }
    }, [activeThreadId, syncToThread]);

    useEffect(() => {
        if (messages.length === 0) {
            registerLatestMessage(null, null);
            return;
        }
        const latestAssistant = [...messages]
            .slice()
            .reverse()
            .find((message) => message.role === 'assistant');
        registerLatestMessage(latestAssistant?.id ?? null, latestAssistant?.graphDocumentVersionId ?? null);
    }, [messages, registerLatestMessage]);

    const handleTranscriptAppend = useCallback(
        (transcript: string) => {
            setInput((previous) => {
                const trimmed = previous.replace(/\s+$/, '');
                const separator = trimmed.length > 0 ? (trimmed.endsWith('\n') ? '' : '\n\n') : '';
                const updated = `${trimmed}${separator}${transcript}`;
                if (activeThreadId) {
                    updateDraft(activeThreadId, updated);
                }
                return updated;
            });
            setIsInputExpanded(true);
        },
        [activeThreadId, updateDraft]
    );

    const {
        isSupported: isRecordingSupported,
        permission: microphonePermission,
        isRecording,
        isRecordingBarVisible,
        isProcessing: isRecordingProcessing,
        analyserNode,
        recordingDurationMs,
        connectivity: recordingConnectivity,
        totalChunks: recordedChunks,
        completedChunks: completedRecordedChunks,
        statusAnnouncement,
        error: recordingError,
        startRecording,
        stopRecording,
        toggleRecording,
        retryPendingChunks,
    } = useAudioTranscriptionRecorder({ onFinalTranscript: handleTranscriptAppend });
    const previewBuilds = usePreviewBuilds();
    const hasUnseenBuilds = previewBuilds.unseenCount > 0;
    const settingsBadgeCount = previewBuilds.unseenCount;
    const displaySettingsBadge = settingsBadgeCount > SETTINGS_BADGE_MAX ? `${SETTINGS_BADGE_MAX}+` : settingsBadgeCount.toString();
    const settingsButtonLabel = hasUnseenBuilds
        ? `Open settings (${settingsBadgeCount} unseen build${settingsBadgeCount === 1 ? '' : 's'})`
        : 'Open settings';

    useEffect(() => {
        if (!activeThreadId) {
            setInput('');
            return;
        }
        setInput(drafts[activeThreadId] ?? '');
    }, [activeThreadId, drafts]);

    useEffect(() => {
        const scrollArea = scrollAreaRef.current;
        // Find the actual scrollable viewport (ScrollArea uses Radix UI)
        const viewport = scrollArea?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
        const messageContainer = scrollArea?.querySelector('.flex.flex-col.gap-4');
        
        if (!viewport || !messageContainer) return;

        // Function to scroll to the bottom.
        const scrollToBottom = () => {
            viewport.scrollTo({
                top: viewport.scrollHeight,
                behavior: 'auto',
            });
        };

        // Initial scroll to bottom on load with a slight delay to ensure content is rendered
        setTimeout(() => scrollToBottom(), 50);

        // Use a MutationObserver to scroll whenever new messages are added.
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    scrollToBottom();
                    break;
                }
            }
        });

        observer.observe(messageContainer, { childList: true });

        return () => {
            observer.disconnect();
        };
    }, [messages]);


    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'r') {
                event.preventDefault();
                toggleRecording();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [toggleRecording]);

    const recordingButtonDisabled =
        !isRecordingSupported || microphonePermission === 'denied' || microphonePermission === 'unsupported';
    const recordingTooltip = !isRecordingSupported
        ? 'Recording is not supported in this browser.'
        : microphonePermission === 'denied'
            ? 'Microphone access denied. Enable permissions to record.'
            : microphonePermission === 'unsupported'
                ? 'Recording is unavailable in this browser.'
                : 'Hold Shift + Ctrl/Cmd + R to toggle recording.';




    const submitMessage = async (
        content: string,
        threadId: string,
        parentId: string | null,
        existingUserMessage?: Message
    ) => {
        setIsLoading(true);
        console.log('[ChatPane] submitMessage called with:', { content, threadId, parentId });

        const rawHistoryChain = parentId ? getMessageChain(parentId) : [];
        const systemPrompt = activeInstruction?.content;

        const userMessage = existingUserMessage ?? addMessage(threadId, { role: 'user', content, parentId });
        if (!existingUserMessage) {
            clearDraft(threadId);
            setInput('');
        }

        const assistantMessage = addMessage(threadId, {
            role: 'assistant',
            content: '',
            parentId: userMessage.id, // Always parent the assistant message to the user message
            toolCalls: [],
        });
        setStreamingMessageId(assistantMessage.id);

        const registerSummarizeAction = ({
            summaryLevel,
            periodStart,
            periodEnd,
            label,
        }: SummarizeActionDescriptor) => {
            const actionId = uuidv4();
            updateMessage(assistantMessage.id, (current) => {
                const existingActions = Array.isArray(current.contextActions) ? current.contextActions : [];
                const nextAction: ContextActionState = {
                    id: actionId,
                    type: 'summarize',
                    status: 'pending',
                    label,
                    summaryLevel,
                    summaryPeriodStart: periodStart.toISOString(),
                    summaryPeriodEnd: periodEnd.toISOString(),
                    content: undefined,
                    error: undefined,
                };
                return {
                    contextActions: [...existingActions, nextAction],
                };
            });
            return actionId;
        };

        const updateSummarizeAction = (actionId: string, update: SummarizeActionUpdate) => {
            updateMessage(assistantMessage.id, (current) => {
                const existingActions = Array.isArray(current.contextActions) ? current.contextActions : [];
                const index = existingActions.findIndex((action) => action.id === actionId);
                if (index === -1) {
                    return { contextActions: existingActions };
                }
                const nextActions = [...existingActions];
                nextActions[index] = {
                    ...nextActions[index],
                    ...update,
                };
                return { contextActions: nextActions };
            });
        };

        let historyMessagesForApi: ApiMessage[] = [];
        let transformsForRequest = transforms;

        if (mode === 'intelligent') {
            try {
                // OBJECTIVE 1 FIX: Pass assistantMessage.id so summaries are attached to the assistant message, not the user message
                const intelligentContext = await prepareIntelligentContext({
                    conversationId: threadId,
                    branchHeadMessageId: parentId,
                    createdByMessageId: assistantMessage.id,
                    historyChain: rawHistoryChain,
                    callTool,
                    summaryPrompt,
                    model: selectedModel.id,
                    registerAction: registerSummarizeAction,
                    updateAction: updateSummarizeAction,
                    forcedRecentMessages,
                });
                const recentHistory = serialiseMessageHistoryForApi(intelligentContext.recentMessages);
                historyMessagesForApi = [...intelligentContext.systemMessages, ...recentHistory];
                transformsForRequest = [];
            } catch (contextError) {
                console.error('[ChatPane] Intelligent context preparation failed, falling back to configured history.', contextError);
                const fallbackHistory = applyContextToMessages(rawHistoryChain);
                historyMessagesForApi = serialiseMessageHistoryForApi(fallbackHistory);
            }
        } else {
            const limitedHistory = applyContextToMessages(rawHistoryChain);
            historyMessagesForApi = serialiseMessageHistoryForApi(limitedHistory);
        }

        // FEATURE 7: Inject daily graph context for situational awareness
        let dailyContextMessage: ApiMessage | null = null;
        try {
            const todaysContextResult = await callTool('get_todays_context', {});
            if (todaysContextResult && !todaysContextResult.isError) {
                const contextContent = typeof todaysContextResult.content === 'string'
                    ? todaysContextResult.content
                    : JSON.stringify(todaysContextResult.content, null, 2);
                dailyContextMessage = {
                    role: 'system' as const,
                    content: `Here is the user's current daily context (tasks, goals, and schedule for today):\n\n${contextContent}`,
                };
            }
        } catch (contextError) {
            console.warn('[ChatPane] Failed to fetch daily context, continuing without it.', contextError);
        }

        // FEATURE 6: Prepend timestamp to current user message for consistency with history
        // Use the user message's actual createdAt timestamp, not a new Date()
        const userMessageTimestamp = userMessage.createdAt;
        let timestampedContent = content;
        if (userMessageTimestamp) {
            console.log('[ChatPane] User message createdAt:', userMessageTimestamp.toISOString());
            console.log('[ChatPane] User message createdAt (local):', userMessageTimestamp.toString());
            const timeStr = userMessageTimestamp.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            });
            const dateStr = userMessageTimestamp.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
            });
            console.log('[ChatPane] Formatted timestamp for API:', `[${timeStr} | ${dateStr}]`);
            timestampedContent = `[${timeStr} | ${dateStr}] ${content}`;
        }

        // Combine all system messages into a single message to reduce message count
        const systemContents: string[] = [];
        if (systemPrompt) {
            systemContents.push(systemPrompt);
        }
        if (dailyContextMessage) {
            systemContents.push(dailyContextMessage.content);
        }

        // Extract system messages from historyMessagesForApi and combine them
        const systemMessagesFromHistory = historyMessagesForApi.filter(msg => msg.role === 'system');
        const nonSystemMessagesFromHistory = historyMessagesForApi.filter(msg => msg.role !== 'system');
        systemMessagesFromHistory.forEach(msg => systemContents.push(msg.content));

        const conversationMessages: ApiMessage[] = [
            ...(systemContents.length > 0 ? [{ role: 'system' as const, content: systemContents.join('\n\n---\n\n') }] : []),
            ...nonSystemMessagesFromHistory,
            { role: 'user' as const, content: timestampedContent },
        ];

        const toolDefinitions: ApiToolDefinition[] = availableTools.map((tool) => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
            },
        }));
        console.log('[ChatPane] Sending payload to API:', conversationMessages);
        console.log('[ChatPane][MCP] Available tools:', availableTools);

        let toolsForInitialCall: ApiToolDefinition[] | undefined =
            toolDefinitions.length > 0 ? toolDefinitions : undefined;

        if (toolsForInitialCall && getToolIntentCheck(selectedModel.id)) {
            try {
                const intent = await getToolIntent(content);
                console.log('[ChatPane] Tool intent classification:', intent);
                if (intent === 'CONVERSATION') {
                    toolsForInitialCall = undefined;
                }
            } catch (intentError) {
                console.warn(
                    '[ChatPane] Tool intent classification failed. Falling back to tool-enabled request.',
                    intentError
                );
            }
        }

        let finalizeCalled = false;
        const finalize = () => {
            if (finalizeCalled) return;
            finalizeCalled = true;
            setIsLoading(false);
            setStreamingMessageId(null);
            abortControllerRef.current = null;
        };

        const upsertToolCallState = (
            toolId: string,
            update: {
                name?: string;
                arguments?: string;
                status?: 'pending' | 'running' | 'success' | 'error';
                response?: string;
                error?: string;
            }
        ) => {
            updateMessage(assistantMessage.id, (current) => {
                const toolCalls = [...(current.toolCalls || [])];
                const existingIndex = toolCalls.findIndex((call) => call.id === toolId);

                if (existingIndex >= 0) {
                    const existing = toolCalls[existingIndex];
                    toolCalls[existingIndex] = {
                        ...existing,
                        ...update,
                        id: toolId,
                        name: update.name ?? existing.name,
                        arguments: update.arguments ?? existing.arguments,
                        status: update.status ?? existing.status,
                    };
                } else {
                    toolCalls.push({
                        id: toolId,
                        name: update.name ?? toolId,
                        arguments: update.arguments ?? '{}',
                        status: update.status ?? 'running',
                        response: update.response,
                        error: update.error,
                    });
                }

                return { toolCalls };
            });
        };

        const normaliseArguments = (value: unknown): string => {
            if (typeof value === 'string') {
                return value;
            }
            try {
                return JSON.stringify(value ?? {});
            } catch (stringifyError) {
                console.warn('[ChatPane] Failed to serialise tool arguments', stringifyError);
                return '{}';
            }
        };

        let pendingGraphVersionId: string | null = null;

        try {
            let iteration = 0;

            while (true) {
                if (iteration >= MAX_AGENT_ITERATIONS) {
                    console.warn('[ChatPane] Exceeded maximum agent iterations');
                    updateMessage(assistantMessage.id, {
                        content:
                            'Error: Reached maximum number of tool iterations while handling this request. Please try again with a more specific prompt.',
                    });
                    break;
                }

                iteration += 1;

                const controller = new AbortController();
                abortControllerRef.current = controller;

                const toolsForThisRequest =
                    iteration === 1
                        ? toolsForInitialCall
                        : toolDefinitions.length > 0
                            ? toolDefinitions
                            : undefined;

                const geminiResult = await getGeminiResponse(conversationMessages, {
                    onStream: (update) => {
                        console.log('[ChatPane][Streaming update]', update);
                        updateMessage(assistantMessage.id, () => {
                            const patch: Partial<Message> = {};
                            if (update.content !== undefined) {
                                patch.content = update.content;
                            }
                            if (typeof update.reasoning === 'string') {
                                const trimmed = update.reasoning.trim();
                                if (trimmed.length > 0) {
                                    patch.thinking = update.reasoning;
                                }
                            }
                            return patch;
                        });
                    },
                    signal: controller.signal,
                    tools: toolsForThisRequest,
                    model: selectedModel.id,
                    transforms: transformsForRequest.length > 0 ? transformsForRequest : undefined,
                });

                const rawResponse = geminiResult.raw as { choices?: Array<{ message?: any }> } | null | undefined;

                if (geminiResult.content !== undefined || geminiResult.reasoning !== undefined) {
                    updateMessage(assistantMessage.id, () => {
                        const patch: Partial<Message> = {};
                        if (geminiResult.content !== undefined) {
                            patch.content = geminiResult.content;
                        }
                        if (typeof geminiResult.reasoning === 'string') {
                            const trimmed = geminiResult.reasoning.trim();
                            if (trimmed.length > 0) {
                                patch.thinking = geminiResult.reasoning;
                            }
                        }
                        return patch;
                    });
                }

                if (!rawResponse) {
                    console.warn('[ChatPane] No raw response returned from model; treating as completion.');
                    break;
                }

                const toolCallRequests = Array.isArray(rawResponse.choices?.[0]?.message?.tool_calls)
                    ? (rawResponse.choices![0]!.message!.tool_calls as ApiToolCall[])
                    : [];

                if (!toolCallRequests.length) {
                    console.log('[ChatPane] No tool calls returned; finishing assistant response.');
                    conversationMessages.push({
                        role: 'assistant',
                        content: geminiResult.content ?? '',
                    });
                    break;
                }

                console.log('[ChatPane][MCP] Processing', toolCallRequests.length, 'tool calls');

                const normalisedToolCalls: ApiToolCall[] = toolCallRequests.map((toolCall, index) => {
                    const fallbackId = toolCall.id ?? `tool-${Date.now()}-${index}`;
                    const toolId = toolCall.id ?? fallbackId;
                    const toolName = toolCall.function?.name ?? toolId;
                    const argumentString = normaliseArguments(toolCall.function?.arguments);
                    return {
                        id: toolId,
                        type: 'function',
                        function: {
                            name: toolName,
                            arguments: argumentString,
                        },
                    };
                });

                normalisedToolCalls.forEach((toolCall) => {
                    upsertToolCallState(toolCall.id, {
                        name: toolCall.function.name,
                        arguments: toolCall.function.arguments,
                        status: 'running',
                        response: undefined,
                        error: undefined,
                    });
                });

                conversationMessages.push({
                    role: 'assistant',
                    content: geminiResult.content ?? '',
                    tool_calls: normalisedToolCalls,
                });

                for (const toolCall of normalisedToolCalls) {
                    const toolId = toolCall.id;
                    const toolName = toolCall.function.name;
                    const argumentString = toolCall.function.arguments ?? '{}';

                    let parsedArgs: Record<string, unknown>;
                    try {
                        parsedArgs = argumentString.trim() ? JSON.parse(argumentString) : {};
                    } catch (parseError) {
                        console.error('[ChatPane][MCP] Failed to parse tool arguments for', toolName, parseError);
                        upsertToolCallState(toolId, {
                            status: 'error',
                            error: 'Invalid JSON arguments',
                            response: undefined,
                        });
                        conversationMessages.push({
                            role: 'tool',
                            tool_call_id: toolId,
                            content: 'Error: Invalid JSON arguments',
                        });
                        continue;
                    }

                    try {
                        if (!toolName) {
                            throw new Error('Tool call did not include a tool name.');
                        }

                        const isInstructionTool = toolName === 'get_system_instructions' || toolName === 'update_system_instructions';
                        if (isInstructionTool && activeInstructionId) {
                            parsedArgs.instruction_id = activeInstructionId;
                        }

                        console.log('[ChatPane][MCP] Calling tool', toolName, 'with args', parsedArgs);
                        const toolResult = await callTool(toolName, parsedArgs);
                        console.log('[ChatPane][MCP] Tool result', toolResult);
                        const payload = parseGraphToolResult(toolResult);

                        const toolContent =
                            typeof toolResult?.content === 'string'
                                ? toolResult.content
                                : JSON.stringify(toolResult?.content ?? '', null, 2);

                        if (toolName === 'patch_graph_document') {
                            if (payload?.result) {
                                applyPatchResult({
                                    document: payload.result,
                                    versionId: payload.graph_document_version_id ?? null,
                                    messageId: assistantMessage.id,
                                });
                            } else {
                                console.warn('[ChatPane][MCP] Patch response missing result document');
                            }
                            if (payload?.graph_document_version_id) {
                                pendingGraphVersionId = payload.graph_document_version_id;
                            }
                        }

                        upsertToolCallState(toolId, {
                            status: 'success',
                            response: toolContent,
                            error: undefined,
                        });

                        conversationMessages.push({
                            role: 'tool',
                            tool_call_id: toolId,
                            content: toolContent,
                        });
                    } catch (toolError) {
                        console.error('[ChatPane][MCP] Tool execution failed', toolError);
                        const errorMessage =
                            toolError instanceof Error ? toolError.message : 'Tool call failed';
                        upsertToolCallState(toolId, {
                            status: 'error',
                            error: errorMessage,
                            response: undefined,
                        });
                        conversationMessages.push({
                            role: 'tool',
                            tool_call_id: toolId,
                            content: `Error: ${errorMessage}`,
                        });
                    }
                }
            }

            if (pendingGraphVersionId) {
                updateMessage(assistantMessage.id, { graphDocumentVersionId: pendingGraphVersionId });
            }

            if (activeThread?.rootChildren && activeThread.rootChildren.length <= 1 && activeThread.title === 'New Chat') {
                void (async () => {
                    try {
                        const actingMessages = [
                            ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
                            ...historyMessagesForApi,
                            { role: 'user' as const, content },
                            { role: 'assistant' as const, content: (allMessages[assistantMessage.id]?.content ?? '') },
                        ];
                        const title = await getTitleSuggestion(actingMessages);
                        if (title) {
                            updateThreadTitle(activeThreadId!, title);
                        }
                    } catch (err) {
                        console.warn('Failed to fetch title suggestion:', err);
                    }
                })();
            }
        } catch (error) {
            const errorMessage = `Error: ${error instanceof Error ? error.message : 'An unknown error occurred.'}`;
            updateMessage(assistantMessage.id, { content: errorMessage });
        } finally {
            finalize();
        }
    };
    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        let currentThreadId = activeThreadId;
        if (!currentThreadId) {
            currentThreadId = createThread();
        }

        const userInput = input;
        setInput('');
        setIsInputExpanded(false);

        const currentChain = getMessageChain(activeThread?.leafMessageId || null);
        const parentId = currentChain.length > 0 ? currentChain[currentChain.length - 1].id : null;

        recordModelUsage(selectedModel.id);
        await submitMessage(userInput, currentThreadId, parentId);
    };

    const handleFork = (originalMessageId: string, newContent: string) => {
        if (!activeThreadId) return;

        const originalMessage = allMessages[originalMessageId];
        if (!originalMessage) return;

        // The new message forks from the parent of the original message
        const forkedMessage = addMessage(activeThreadId, {
            role: 'user',
            content: newContent,
            parentId: originalMessage.parentId,
        });

        // Now, submit this new message to get an AI response
        void submitMessage(forkedMessage.content, activeThreadId, forkedMessage.parentId, forkedMessage);
    };

    const handleNavigateBranch = (parentId: string | null, direction: 'prev' | 'next') => {
        if (!activeThreadId || !activeThread) return;

        if (parentId === null) {
            const siblings = activeThread.rootChildren;
            if (!siblings || siblings.length === 0) return;
            const selectedRoot = activeThread.selectedRootChild ?? siblings[siblings.length - 1];
            let index = siblings.indexOf(selectedRoot);
            if (index === -1) index = siblings.length - 1;

            if (direction === 'prev') {
                index = (index - 1 + siblings.length) % siblings.length;
            } else {
                index = (index + 1) % siblings.length;
            }

            const targetChild = siblings[index];
            selectBranch(activeThreadId, null, targetChild);
            return;
        }

        const parentMessage = allMessages[parentId];
        if (!parentMessage || parentMessage.children.length === 0) return;

        const siblings = parentMessage.children;
        const selectedChildId = activeThread.selectedChildByMessageId[parentId] ?? siblings[siblings.length - 1];
        let index = siblings.indexOf(selectedChildId);
        if (index === -1) {
            index = siblings.length - 1;
        }

        if (direction === 'prev') {
            index = (index - 1 + siblings.length) % siblings.length;
        } else {
            index = (index + 1) % siblings.length;
        }

        const targetChild = siblings[index];
        selectBranch(activeThreadId, parentId, targetChild);
    };

    const handleCancel = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    };

    if (!activeThread) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center bg-background">
                <Button onClick={createThread}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    New Chat
                </Button>
            </div>
        );
    }

    return (
        <div className="relative flex h-full flex-col bg-background">
            {/* Chat list button overlay */}
            <button
                type="button"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="absolute left-0 top-0 z-20 rounded-br-xl bg-card/50 p-1.5 shadow-md transition-all hover:bg-card hover:shadow-lg border-r-2 border-b-2 border-border"
                aria-label="Toggle chat list"
            >
                <ChevronLeft className="h-3 w-3 text-foreground" />
            </button>

            <ScrollArea
                className="flex-1 min-h-0 relative -mt-1"
                ref={scrollAreaRef}
            >
                {/* Gradient fade at top - extended to cover resize handle */}
                <div className="absolute -top-2 left-0 right-0 h-8 bg-gradient-to-b from-background via-background/80 to-transparent pointer-events-none z-10" />
                <div className="flex flex-col gap-4 pt-9 px-2 md:px-4">
                    {messages.map((msg) => {
                        let branchInfo;
                        if (msg.parentId) {
                            const parentMessage = allMessages[msg.parentId];
                            if (parentMessage && parentMessage.children.length > 1) {
                                const siblings = parentMessage.children;
                                const index = siblings.indexOf(msg.id);
                                branchInfo = {
                                    index: index >= 0 ? index : 0,
                                    total: siblings.length,
                                    onPrev: () => handleNavigateBranch(msg.parentId!, 'prev'),
                                    onNext: () => handleNavigateBranch(msg.parentId!, 'next'),
                                };
                            }
                        } else if (activeThread?.rootChildren && activeThread.rootChildren.length > 1) {
                            const siblings = activeThread.rootChildren;
                            const index = siblings.indexOf(msg.id);
                            branchInfo = {
                                index: index >= 0 ? index : 0,
                                total: siblings.length,
                                onPrev: () => handleNavigateBranch(null, 'prev'),
                                onNext: () => handleNavigateBranch(null, 'next'),
                            };
                        }

                        return (
                            <ChatMessage
                                key={msg.id}
                                message={msg}
                                onSave={handleFork}
                                isStreaming={msg.id === streamingMessageId}
                                branchInfo={branchInfo}
                                onActivate={() => {
                                    void revertToMessage(msg);
                                }}
                                isActiveSnapshot={activeMessageId === msg.id}
                                isHistoricalView={isViewingHistorical}
                            />
                        );
                    })}
                </div>
            </ScrollArea>
            <div className="flex flex-col">
                <ConnectivityStatusBar
                    issueCount={recordingConnectivity.issueCount}
                    queuedCount={recordingConnectivity.queuedCount}
                    retryInSeconds={recordingConnectivity.retryInSeconds}
                    onRetry={retryPendingChunks}
                />
                <RecordingStatusBar
                    visible={isRecordingBarVisible || isRecordingProcessing}
                    isRecording={isRecording}
                    isProcessing={isRecordingProcessing}
                    durationMs={recordingDurationMs}
                    analyser={analyserNode}
                    completedChunks={completedRecordedChunks}
                    totalChunks={recordedChunks}
                    onStop={stopRecording}
                />
            </div>
            <div
                className="sticky bottom-0 left-0 right-0 z-10 rounded-t-3xl border-t-2 border-t-accent/40 bg-card shadow-lg"
            >
                <div className="relative flex w-full flex-col">
                    {/* Floating button group */}
                    <div className="absolute -top-[52px] right-0 z-20 flex items-center gap-0.5 rounded-tl-2xl bg-card/50 p-1 shadow-md border-l-2 border-t-2 border-border">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setSettingsDialogOpen(true)}
                            className={cn('relative h-8 w-8 rounded-full p-0 bg-transparent', hasUnseenBuilds ? 'border-primary text-primary' : '')}
                            title={settingsButtonLabel}
                            aria-label={settingsButtonLabel}
                        >
                            <Cog className="h-4 w-4" />
                            {hasUnseenBuilds && (
                                <span className="pointer-events-none absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[0.6rem] font-semibold leading-none text-destructive-foreground">
                                    {displaySettingsBadge}
                                </span>
                            )}
                        </Button>
                        <Button
                            type="button"
                            onClick={toggleRecording}
                            variant={isRecording ? 'destructive' : 'ghost'}
                            className="h-8 w-8 rounded-full p-0 bg-transparent"
                            title={recordingTooltip}
                            aria-label={
                                isRecording
                                    ? 'Stop recording audio'
                                    : isRecordingProcessing
                                        ? 'Audio transcription in progress'
                                        : 'Start recording audio'
                            }
                            aria-pressed={isRecording}
                            disabled={recordingButtonDisabled || isRecording || isRecordingProcessing}
                        >
                            {recordingButtonDisabled ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        </Button>
                        {isLoading ? (
                            <Button type="button" onClick={handleCancel} variant="destructive" className="h-8 w-8 rounded-full p-0">
                                <Square className="h-4 w-4" />
                            </Button>
                        ) : (
                            <Button
                                type="submit"
                                disabled={!input.trim()}
                                className={cn(
                                    "h-8 w-8 rounded-full p-0 transition-all duration-300 ease-in-out",
                                    input.trim()
                                        ? "bg-blue-500 hover:bg-blue-600"
                                        : "bg-secondary hover:bg-secondary/80"
                                )}
                                onClick={(e) => {
                                    e.preventDefault();
                                    formRef.current?.requestSubmit();
                                }}
                            >
                                <Send className={cn(
                                    "h-4 w-4 transition-transform duration-300 ease-in-out",
                                    input.trim() ? "rotate-[-90deg]" : "rotate-0"
                                )} />
                            </Button>
                        )}
                    </div>
                    <form
                        ref={formRef}
                        onSubmit={handleSubmit}
                        className="relative z-10 flex w-full flex-col p-2"
                    >
                        <Textarea
                            value={input}
                            onChange={(e) => {
                                let threadId = activeThreadId;
                                if (!threadId) {
                                    threadId = createThread();
                                }
                                const value = e.target.value;
                                setInput(value);
                                if (threadId) {
                                    updateDraft(threadId, value);
                                }
                            }}
                            placeholder="Reply to Claude..."
                            disabled={isLoading}
                            rows={1}
                            className={cn(
                                'min-h-[44px] max-h-[160px] w-full resize-none rounded-2xl border-0 bg-muted text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-scrollbar]:hidden'
                            )}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault();
                                    formRef.current?.requestSubmit();
                                }
                            }}
                        />
                    </form>
                    {(microphonePermission === 'denied' || microphonePermission === 'unsupported' || recordingError) && (
                        <p className="mt-2 text-xs text-destructive">
                            {recordingError ||
                                (microphonePermission === 'unsupported'
                                    ? 'Recording is not supported in this browser.'
                                    : 'Microphone access is blocked. Update browser settings to enable recording.')}
                        </p>
                    )}
                    <div className="sr-only" aria-live="polite">
                        {statusAnnouncement || ''}
                    </div>
                </div>
            </div>
            <SettingsDialog open={isSettingsDialogOpen} onOpenChange={setSettingsDialogOpen} previewBuilds={previewBuilds} />
        </div>
    );
};

export default ChatPane;
