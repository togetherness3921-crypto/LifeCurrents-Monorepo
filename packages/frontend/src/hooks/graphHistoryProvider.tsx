import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Message } from './chatProviderContext';
import { useMcp } from './useMcp';
import { useToast } from './use-toast';
import { graphDocumentChannel } from '@/state/graphDocumentChannel';
import { parseGraphToolResult } from '@/lib/mcp/graphResult';
import {
    countHierarchicalNodes,
    flattenHierarchicalNodes,
    type HierarchicalGraphNode,
} from '@/lib/graph/flattenHierarchicalNodes';

interface ApplyPatchArgs {
    document: any;
    versionId?: string | null;
    messageId?: string;
}

interface GraphHistoryContextValue {
    currentVersionId: string | null;
    latestVersionId: string | null;
    defaultVersionId: string | null;
    activeMessageId: string | null;
    latestMessageId: string | null;
    isViewingHistorical: boolean;
    isReverting: boolean;
    syncToThread: (messages: Message[]) => Promise<void>;
    registerLatestMessage: (messageId: string | null, versionId: string | null) => void;
    revertToMessage: (message: Message) => Promise<void>;
    returnToLatest: () => Promise<void>;
    applyPatchResult: (args: ApplyPatchArgs) => void;
}

const GraphHistoryContext = createContext<GraphHistoryContextValue | undefined>(undefined);

const getStringOrNull = (value: unknown): string | null => {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value;
    }
    return null;
};

const prepareGraphDocumentForUi = (
    document: any,
    context: string
): Record<string, unknown> | null => {
    if (!document || typeof document !== 'object') {
        console.log(`[GraphHistory] Flatten skipped for ${context}: document missing or invalid.`);
        return null;
    }

    const nodes = (document as { nodes?: Record<string, HierarchicalGraphNode> | null }).nodes;
    if (!nodes || typeof nodes !== 'object') {
        console.log(`[GraphHistory] Flatten skipped for ${context}: no nodes to process.`);
        return { ...(document as Record<string, unknown>) };
    }

    const beforeCount = countHierarchicalNodes(nodes);
    const flattenedNodes = flattenHierarchicalNodes(nodes);
    const afterCount = Object.keys(flattenedNodes).length;

    console.log(
        `[GraphHistory] Flattened graph document for ${context}: before=${beforeCount}, after=${afterCount}`
    );

    return {
        ...(document as Record<string, unknown>),
        nodes: flattenedNodes,
    };
};

export const GraphHistoryProvider = ({ children }: { children: ReactNode }) => {
    const { callTool } = useMcp();
    const { toast } = useToast();

    const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
    const [latestVersionId, setLatestVersionId] = useState<string | null>(null);
    const [defaultVersionId, setDefaultVersionId] = useState<string | null>(null);
    const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
    const [latestMessageId, setLatestMessageId] = useState<string | null>(null);
    const [isViewingHistorical, setIsViewingHistorical] = useState(false);
    const [isReverting, setIsReverting] = useState(false);

    const latestVersionIdRef = useRef<string | null>(null);
    const defaultVersionIdRef = useRef<string | null>(null);
    const latestMessageIdRef = useRef<string | null>(null);
    const viewingHistoricalRef = useRef(false);

    useEffect(() => {
        latestVersionIdRef.current = latestVersionId;
    }, [latestVersionId]);

    useEffect(() => {
        defaultVersionIdRef.current = defaultVersionId;
    }, [defaultVersionId]);

    useEffect(() => {
        latestMessageIdRef.current = latestMessageId;
    }, [latestMessageId]);

    useEffect(() => {
        viewingHistoricalRef.current = isViewingHistorical;
    }, [isViewingHistorical]);

    // This effect syncs the active message to the latest, but ONLY when not in historical view.
    useEffect(() => {
        if (!isViewingHistorical) {
            setActiveMessageId(latestMessageId);
            setCurrentVersionId(latestVersionId);
        }
    }, [isViewingHistorical, latestMessageId, latestVersionId]);

    const ensureDefaultVersionId = useCallback(async (): Promise<string | null> => {
        if (defaultVersionIdRef.current) {
            return defaultVersionIdRef.current;
        }

        try {
            const result = await callTool('get_or_create_default_graph_version', {});
            const payload = parseGraphToolResult(result);
            const defaultId = getStringOrNull(payload.default_graph_document_version_id);
            if (defaultId) {
                setDefaultVersionId(defaultId);
                console.log('[GraphHistory] Resolved default graph version id', defaultId);
                return defaultId;
            }
            return null;
        } catch (error) {
            console.error('[GraphHistory] Failed to resolve default graph version id', error);
            toast({
                title: 'Unable to load default graph version',
                description: 'The graph could not be restored to its baseline state. Please try again.',
                variant: 'destructive',
            });
            return null;
        }
    }, [callTool, toast]);

    const applyPayloadToState = useCallback(
        (payload: any, fallbackVersionId: string | null, source: 'patch' | 'revert' | 'latest', messageId?: string | null) => {
            const nextVersionId = getStringOrNull(payload?.graph_document_version_id) ?? fallbackVersionId;
            if (payload?.result) {
                const preparedDocument = prepareGraphDocumentForUi(payload.result, source);
                if (preparedDocument) {
                    graphDocumentChannel.emit({ document: preparedDocument, versionId: nextVersionId, source });
                }
            }
            if (nextVersionId) {
                setCurrentVersionId(nextVersionId);
            }
            if (messageId) {
                setActiveMessageId(messageId);
            }
        },
        []
    );

    const revertToVersion = useCallback(
        async (versionId: string, options: { messageId?: string; treatAsLatest?: boolean } = {}) => {
            try {
                setIsReverting(true);
                const result = await callTool('set_graph_document_to_version', { version_id: versionId });
                const payload = parseGraphToolResult(result);
                const appliedVersionId = getStringOrNull(payload.graph_document_version_id) ?? versionId;

                applyPayloadToState(payload, appliedVersionId, options.treatAsLatest ? 'latest' : 'revert', options.messageId);
                if (!payload?.result) {
                    console.warn('[GraphHistory] Tool response did not include a result document for version', appliedVersionId);
                }

                if (!options.treatAsLatest) {
                    setIsViewingHistorical(
                        Boolean(latestMessageIdRef.current && options.messageId && options.messageId !== latestMessageIdRef.current) ||
                        Boolean(latestVersionIdRef.current && appliedVersionId !== latestVersionIdRef.current)
                    );
                } else {
                    setIsViewingHistorical(false);
                }

                console.log('[GraphHistory] Reverted graph to version', appliedVersionId, 'messageId:', options.messageId);
            } catch (error) {
                console.error('[GraphHistory] Failed to revert graph', error);
                toast({
                    title: 'Unable to load snapshot',
                    description: 'The requested graph snapshot could not be loaded. Please try again.',
                    variant: 'destructive',
                });
            } finally {
                setIsReverting(false);
            }
        },
        [applyPayloadToState, callTool, toast]
    );

    const syncToThread = useCallback(
        async (messages: Message[]) => {
            if (messages.length === 0) {
                const defaultId = await ensureDefaultVersionId();
                if (defaultId) {
                    await revertToVersion(defaultId, { treatAsLatest: true });
                }
                return;
            }
            const latestMessage = messages[messages.length - 1];
            await revertToVersion(latestMessage.graphDocumentVersionId ?? await ensureDefaultVersionId() ?? '', {
                messageId: latestMessage.id,
                treatAsLatest: true,
            });
        },
        [ensureDefaultVersionId, revertToVersion]
    );

    const revertToMessage = useCallback(
        async (message: Message) => {
            console.log('[GraphHistory] Message activated for graph view', {
                messageId: message.id,
                versionId: message.graphDocumentVersionId ?? 'default',
            });

            if (isReverting) return;

            let targetVersionId = message.graphDocumentVersionId ?? null;
            if (!targetVersionId) {
                targetVersionId = await ensureDefaultVersionId();
                if (!targetVersionId) {
                    toast({
                        title: 'Graph snapshot unavailable',
                        description: 'The baseline graph version could not be determined.',
                        variant: 'destructive',
                    });
                    return;
                }
            }

            if (targetVersionId === latestVersionIdRef.current && message.id === latestMessageIdRef.current && !viewingHistoricalRef.current) {
                // Already on latest state and not in historical view.
                return;
            }

            await revertToVersion(targetVersionId, { messageId: message.id });
        },
        [ensureDefaultVersionId, isReverting, revertToVersion, toast]
    );

    const returnToLatest = useCallback(async () => {
        if (isReverting) return;
        let targetVersionId = latestVersionIdRef.current;
        if (!targetVersionId) {
            targetVersionId = await ensureDefaultVersionId();
            if (!targetVersionId) {
                toast({
                    title: 'Latest graph unavailable',
                    description: 'The application could not determine the latest graph snapshot.',
                    variant: 'destructive',
                });
                return;
            }
        }

        await revertToVersion(targetVersionId, { messageId: latestMessageIdRef.current ?? undefined, treatAsLatest: true });
        if (latestMessageIdRef.current) {
            setActiveMessageId(latestMessageIdRef.current);
        }
    }, [ensureDefaultVersionId, isReverting, revertToVersion, toast]);

    const registerLatestMessage = useCallback(
        (messageId: string | null, versionId: string | null) => {
            if (messageId) {
                setLatestMessageId(messageId);
            }
            if (versionId) {
                if (versionId !== latestVersionIdRef.current) {
                    console.log('[GraphHistory] Updated latest graph version id', versionId);
                }
                setLatestVersionId(versionId);
            }
        },
        []
    );

    const applyPatchResult = useCallback(
        ({ document, versionId, messageId }: ApplyPatchArgs) => {
            if (!document) {
                return;
            }

            if (versionId) {
                console.log('[GraphHistory] Patch produced graph_document_version_id', versionId);
            }

            const preparedDocument = prepareGraphDocumentForUi(document, 'patch');
            if (preparedDocument) {
                graphDocumentChannel.emit({ document: preparedDocument, versionId: versionId ?? null, source: 'patch' });
            }

            if (versionId) {
                setLatestVersionId(versionId);
                setCurrentVersionId(versionId);
            }

            if (messageId) {
                setActiveMessageId(messageId);
                setLatestMessageId(messageId);
            }

            setIsViewingHistorical(false);
        },
        []
    );

    const value = useMemo<GraphHistoryContextValue>(
        () => ({
            currentVersionId,
            latestVersionId,
            defaultVersionId,
            activeMessageId,
            latestMessageId,
            isViewingHistorical,
            isReverting,
            syncToThread,
            registerLatestMessage,
            revertToMessage,
            returnToLatest,
            applyPatchResult,
        }),
        [
            activeMessageId,
            applyPatchResult,
            currentVersionId,
            defaultVersionId,
            isReverting,
            isViewingHistorical,
            latestMessageId,
            latestVersionId,
            registerLatestMessage,
            returnToLatest,
            revertToMessage,
            syncToThread,
        ]
    );

    return <GraphHistoryContext.Provider value={value}>{children}</GraphHistoryContext.Provider>;
};

export const useGraphHistory = (): GraphHistoryContextValue => {
    const context = useContext(GraphHistoryContext);
    if (!context) {
        throw new Error('useGraphHistory must be used within a GraphHistoryProvider');
    }
    return context;
};
