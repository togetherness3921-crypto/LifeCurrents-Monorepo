// This component will render a single chat message bubble
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Message } from '@/hooks/chatProviderContext';
import { Button } from '../ui/button';
import { Pencil, Save, X, ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react';
import { Textarea } from '../ui/textarea';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from '../ui/badge';
import ToolCallDetails from './ToolCallDetails';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import FullScreenModal from './FullScreenModal';
import useCopyAsMarkdown from '@nkzw/copy-as-markdown';

interface ChatMessageProps {
    message: Message;
    isStreaming?: boolean;
    onSave: (messageId: string, newContent: string) => void;
    branchInfo?: {
        index: number;
        total: number;
        onPrev: () => void;
        onNext: () => void;
    };
    onActivate?: (message: Message) => void;
    isActiveSnapshot?: boolean;
    isHistoricalView?: boolean;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message, isStreaming, onSave, branchInfo, onActivate, isActiveSnapshot, isHistoricalView }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState('');
    const [isThinkingModalOpen, setIsThinkingModalOpen] = useState(false);
    const [openToolCallIndex, setOpenToolCallIndex] = useState<number | null>(null);
    const [openContextActionId, setOpenContextActionId] = useState<string | null>(null);
    const [openDaySummaryId, setOpenDaySummaryId] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [bubbleMaxWidth, setBubbleMaxWidth] = useState<number | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const bubbleRef = useRef<HTMLDivElement>(null);

    // Configure copy-as-markdown to use GFM-style formatting (matches remarkGfm)
    // This converts HTML back to markdown when users copy rendered content
    const setMarkdownRef = useCopyAsMarkdown({
        bulletListMarker: '-',  // Use '-' for unordered lists (GFM standard)
        headingStyle: 'atx',    // Use '##' style headers
        codeBlockStyle: 'fenced', // Use ``` for code blocks
    });

    const handleActivation = useCallback(() => {
        if (!onActivate) return;
        onActivate(message);
    }, [message, onActivate]);

    const handleContainerClick = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (!onActivate || isEditing) return;
            const element = event.target as HTMLElement | null;
            if (element && element.closest('button, textarea, input, a, [data-graph-interactive]')) {
                return;
            }
            handleActivation();
        },
        [handleActivation, isEditing, onActivate]
    );

    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
            if (!onActivate || isEditing) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleActivation();
            }
        },
        [handleActivation, isEditing, onActivate]
    );

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(message.content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            console.error('Failed to copy:', error);
        }
    };

    const containerClasses = cn('flex w-full max-w-full overflow-hidden', message.role === 'user' ? 'justify-start' : 'justify-start');
    const bubbleClasses = cn(
        'relative w-full max-w-full rounded-lg px-4 py-3 transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 break-words overflow-wrap-anywhere',
        message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-transparent text-foreground border border-border',
        onActivate ? 'cursor-pointer focus-visible:ring-primary/60 focus-visible:ring-offset-background' : '',
        isActiveSnapshot ? 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background' : ''
    );

    const ariaLabel = onActivate
        ? `${message.role === 'user' ? 'User' : 'Assistant'} message. ${message.graphDocumentVersionId ? 'Activate to view the graph snapshot generated after this message.' : 'Activate to view the baseline graph snapshot for this message.'}`
        : undefined;
    const isPressed = onActivate ? Boolean(isHistoricalView && isActiveSnapshot) : undefined;

    // When edit mode is activated, initialize editText with the current message content
    useEffect(() => {
        if (isEditing) {
            setEditText(message.content);
        }
    }, [isEditing, message.content]);

    // Dynamic width calculation using ResizeObserver
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const calculateBubbleWidth = () => {
            const containerWidth = container.offsetWidth;
            // Account for ScrollArea padding: px-2 (8px) on mobile, px-4 (16px) on md+
            const scrollAreaPadding = window.innerWidth >= 768 ? 32 : 16; // 2x padding value (left + right)
            const safetyMargin = -5; // Negative safety margin to extend bubbles slightly beyond calculated width
            const availableWidth = containerWidth - scrollAreaPadding - safetyMargin;

            setBubbleMaxWidth(availableWidth);
        };

        // Calculate on mount
        calculateBubbleWidth();

        // Watch for container size changes
        const resizeObserver = new ResizeObserver(() => {
            calculateBubbleWidth();
        });

        resizeObserver.observe(container);

        // Also listen for window resize and orientation change
        const handleResize = () => {
            calculateBubbleWidth();
        };

        window.addEventListener('resize', handleResize);
        window.addEventListener('orientationchange', handleResize);

        // Cleanup
        return () => {
            resizeObserver.disconnect();
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('orientationchange', handleResize);
        };
    }, []);

    const handleSave = () => {
        onSave(message.id, editText);
        setIsEditing(false);
    };

    const handleCancel = () => {
        setEditText('');
        setIsEditing(false);
    };

    if (isEditing) {
        return (
            <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="w-[75%] space-y-2">
                    <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="w-full"
                    />
                    <div className="flex justify-end gap-2">
                        <Button onClick={handleCancel} variant="ghost" size="sm">
                            <X className="mr-1 h-4 w-4" /> Cancel
                        </Button>
                        <Button onClick={handleSave} size="sm">
                            <Save className="mr-1 h-4 w-4" /> Save & Submit
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    const isUser = message.role === 'user';

    return (
        <div className={containerClasses} ref={containerRef}>
            <div
                ref={bubbleRef}
                className={bubbleClasses}
                style={bubbleMaxWidth ? { maxWidth: `${bubbleMaxWidth}px` } : undefined}
                role={onActivate ? 'button' : undefined}
                tabIndex={onActivate ? 0 : undefined}
                onClick={handleContainerClick}
                onKeyDown={handleKeyDown}
                aria-pressed={isPressed}
                aria-label={ariaLabel}
            >
                {(isStreaming || (message.thinking && message.thinking.trim().length > 0)) && (
                    <div data-graph-interactive="true">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsThinkingModalOpen(true);
                            }}
                            className="w-full mb-2 rounded-md border border-muted-foreground/20 bg-background/80 px-3 py-2 text-left transition-colors hover:bg-background"
                        >
                                    <div className="flex items-center gap-2">
                                        <Badge variant="secondary" className="uppercase tracking-wide text-[0.75em]">Thinking</Badge>
                                <span className="text-muted-foreground text-[0.875em]">View reasoning</span>
                                    </div>
                        </button>
                        <FullScreenModal
                            isOpen={isThinkingModalOpen}
                            onClose={() => setIsThinkingModalOpen(false)}
                            title="Thinking Process"
                        >
                            <div className="whitespace-pre-wrap text-foreground">
                                    {message.thinking?.trim().length ? message.thinking : 'The model is generating a response...'}
                            </div>
                        </FullScreenModal>
                    </div>
                )}
                {message.contextActions && message.contextActions.length > 0 && (
                    <div className="space-y-3 mb-3" data-graph-interactive="true">
                        {message.contextActions.map((action) => (
                            <div key={action.id}>
                                <button
                                    onClick={() => setOpenContextActionId(action.id)}
                                    className="w-full rounded-md border border-muted-foreground/20 bg-background/80 px-3 py-2 hover:bg-background transition-colors"
                                >
                                        <div className="flex w-full flex-col gap-1 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                                            <div className="flex items-center gap-2">
                                                <Badge variant="secondary" className="uppercase tracking-wide text-[0.75em]">
                                                    Summarize
                                                </Badge>
                                                <span className="text-muted-foreground text-[0.875em]">
                                                    {action.label}
                                                </span>
                                            </div>
                                            <span className="text-[0.75em] text-muted-foreground">
                                                {action.status === 'running'
                                                    ? 'Generating summary…'
                                                    : action.status === 'error'
                                                        ? 'Failed'
                                                        : action.status === 'success'
                                                            ? 'Ready'
                                                            : 'Queued'}
                                            </span>
                                        </div>
                                </button>
                                <FullScreenModal
                                    isOpen={openContextActionId === action.id}
                                    onClose={() => setOpenContextActionId(null)}
                                    title={action.label}
                                >
                                    <div className="whitespace-pre-wrap text-foreground">
                                        {action.status === 'error'
                                            ? (action.error && action.error.trim().length > 0
                                                ? action.error
                                                : 'The system could not create this summary. Conversation history was used instead.')
                                            : action.content && action.content.trim().length > 0
                                                ? action.content
                                                : 'Summary is being prepared…'}
                                    </div>
                                </FullScreenModal>
                            </div>
                        ))}
                    </div>
                )}
                {message.persistedSummaries && message.persistedSummaries.length > 0 && (
                    <div className="space-y-3 mb-3" data-graph-interactive="true">
                        {message.persistedSummaries.map((summary) => {
                            const startDate = new Date(summary.summary_period_start);
                            let dateDisplay: string;

                            if (summary.summary_level === 'DAY') {
                                // DAY: Just show the single date
                                dateDisplay = startDate.toLocaleDateString(undefined, {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                });
                            } else if (summary.summary_level === 'WEEK') {
                                // WEEK: Show start date - end date (7 days later)
                                const endDate = new Date(startDate);
                                endDate.setUTCDate(endDate.getUTCDate() + 6); // Last day of the week
                                const startStr = startDate.toLocaleDateString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                });
                                const endStr = endDate.toLocaleDateString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                });
                                dateDisplay = `${startStr} – ${endStr}`;
                            } else {
                                // MONTH: Show start date - end date (last day of month)
                                const endDate = new Date(startDate);
                                endDate.setUTCMonth(endDate.getUTCMonth() + 1);
                                endDate.setUTCDate(endDate.getUTCDate() - 1); // Last day of the month
                                const startStr = startDate.toLocaleDateString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                });
                                const endStr = endDate.toLocaleDateString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                });
                                dateDisplay = `${startStr} – ${endStr}`;
                            }

                            return (
                                <div key={summary.id}>
                                    <button
                                        onClick={() => setOpenDaySummaryId(summary.id)}
                                        className="w-full rounded-md border border-muted-foreground/20 bg-background/80 px-3 py-2 hover:bg-background transition-colors"
                                    >
                                            <div className="flex w-full flex-col gap-1 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                                                <div className="flex items-center gap-2">
                                                    <Badge variant="secondary" className="uppercase tracking-wide text-[0.75em]">
                                                        {summary.summary_level}
                                                    </Badge>
                                                    <span className="text-muted-foreground text-[0.875em]">
                                                        {dateDisplay}
                                                    </span>
                                                </div>
                                            </div>
                                    </button>
                                    <FullScreenModal
                                        isOpen={openDaySummaryId === summary.id}
                                        onClose={() => setOpenDaySummaryId(null)}
                                        title={`${summary.summary_level} Summary: ${dateDisplay}`}
                                    >
                                        <div className="whitespace-pre-wrap text-foreground">
                                            {summary.content}
                                        </div>
                                    </FullScreenModal>
                                </div>
                            );
                        })}
                    </div>
                )}
                {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="space-y-3 mb-3" data-graph-interactive="true">
                        {message.toolCalls.map((call, index) => (
                            <div key={call.id || index}>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenToolCallIndex(index);
                                    }}
                                    className="w-full rounded-md border border-muted-foreground/20 bg-background/80 px-3 py-2 text-left transition-colors hover:bg-background"
                                >
                                        <div className="flex items-center gap-2">
                                            <Badge variant="secondary" className="uppercase tracking-wide text-[0.75em]">Tool</Badge>
                                            <span className="text-muted-foreground">{call.name || 'Tool call'}</span>
                                        </div>
                                </button>
                                <FullScreenModal
                                    isOpen={openToolCallIndex === index}
                                    onClose={() => setOpenToolCallIndex(null)}
                                    title={`Tool: ${call.name || 'Tool call'}`}
                                >
                                        <ToolCallDetails call={call} />
                                </FullScreenModal>
                            </div>
                        ))}
                    </div>
                )}
                <div
                    ref={setMarkdownRef}
                    className={cn(
                        "prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-muted/50 prose-pre:text-foreground",
                        message.role === 'assistant' ? "prose-base md:prose-lg" : "prose-sm"
                    )}
                    style={message.role === 'assistant' ? { 
                        fontFamily: 'Georgia, serif',
                        WebkitFontSmoothing: 'antialiased',
                        MozOsxFontSmoothing: 'grayscale',
                        textRendering: 'optimizeLegibility'
                    } : undefined}
                >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.content}
                    </ReactMarkdown>
                </div>

                {message.createdAt && (
                    <div className="mt-2 text-[0.7rem] text-muted-foreground/60">
                        {message.createdAt.toLocaleString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                        })}
                    </div>
                )}

                <div className="absolute bottom-0 left-1 flex translate-y-1/2 items-center gap-0.5 rounded-md bg-muted p-0.5 text-xs text-foreground/70 shadow-sm">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={handleCopy}
                        title={copied ? "Copied!" : "Copy message"}
                    >
                        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                    {branchInfo && (
                        <>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    branchInfo.onPrev();
                                }}
                                data-graph-interactive="true"
                            >
                                <ChevronLeft className="h-3 w-3" />
                            </Button>
                            <span className="px-1 font-mono text-[0.6rem]">{branchInfo.index + 1}/{branchInfo.total}</span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    branchInfo.onNext();
                                }}
                                data-graph-interactive="true"
                            >
                                <ChevronRight className="h-3 w-3" />
                            </Button>
                        </>
                    )}
                    <Button
                        onClick={(event) => {
                            event.stopPropagation();
                            setIsEditing(true);
                        }}
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 p-0"
                        data-graph-interactive="true"
                    >
                        <Pencil className="h-3 w-3" />
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default ChatMessage;
