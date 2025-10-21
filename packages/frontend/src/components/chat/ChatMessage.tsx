// This component will render a single chat message bubble
import React, { useState, useEffect, useCallback } from 'react';
import { Message } from '@/hooks/chatProviderContext';
import { Button } from '../ui/button';
import { Pencil, Save, X, ChevronLeft, ChevronRight } from 'lucide-react';
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
    console.log('[ChatMessage] Rendering message:', { // LOG 8: Component render check
        id: message.id,
        content: message.content.length > 50 ? message.content.substring(0, 50) + '...' : message.content,
        isStreaming,
    });

    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState('');

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

    const containerClasses = cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start');
    const bubbleClasses = cn(
        'relative max-w-[87.5%] rounded-lg px-4 py-3 transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
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
        <div className={containerClasses}>
            <div
                className={bubbleClasses}
                role={onActivate ? 'button' : undefined}
                tabIndex={onActivate ? 0 : undefined}
                onClick={handleContainerClick}
                onKeyDown={handleKeyDown}
                aria-pressed={isPressed}
                aria-label={ariaLabel}
            >
                {(isStreaming || (message.thinking && message.thinking.trim().length > 0)) && (
                    <div data-graph-interactive="true">
                        <Accordion type="single" collapsible className="w-full mb-2">
                            <AccordionItem value="thinking" className="rounded-md border border-muted-foreground/20 bg-background/80">
                                <AccordionTrigger className="px-3 py-2 font-medium text-[0.875em]">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="secondary" className="uppercase tracking-wide text-[0.75em]">Thinking</Badge>
                                        <span className="text-muted-foreground">View reasoning</span>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="px-3 pb-3 text-[0.875em] whitespace-pre-wrap">
                                    {message.thinking?.trim().length ? message.thinking : 'The model is generating a response...'}
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    </div>
                )}
                {message.persistedSummaries && message.persistedSummaries.length > 0 && (
                    <div className="space-y-3 mb-3" data-graph-interactive="true">
                        {message.persistedSummaries.map((summary) => (
                            <Accordion type="single" collapsible key={summary.id} className="w-full">
                                <AccordionItem
                                    value={`summary-${summary.id}`}
                                    className="rounded-md border border-muted-foreground/20 bg-background/80"
                                >
                                    <AccordionTrigger className="px-3 py-2 font-medium">
                                        <div className="flex w-full flex-col gap-1 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                                            <div className="flex items-center gap-2">
                                                <Badge variant="secondary" className="uppercase tracking-wide text-[0.75em]">
                                                    {summary.summary_level}
                                                </Badge>
                                                <span className="text-muted-foreground text-[0.875em]">
                                                    {new Date(summary.summary_period_start).toLocaleDateString()}
                                                </span>
                                            </div>
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="px-3 pb-3 text-[0.875em] whitespace-pre-wrap">
                                        {summary.content}
                                    </AccordionContent>
                                </AccordionItem>
                            </Accordion>
                        ))}
                    </div>
                )}
                {message.contextActions && message.contextActions.length > 0 && (
                    <div className="space-y-3 mb-3" data-graph-interactive="true">
                        {message.contextActions.map((action) => (
                            <Accordion type="single" collapsible key={action.id} className="w-full">
                                <AccordionItem
                                    value={`context-${action.id}`}
                                    className="rounded-md border border-muted-foreground/20 bg-background/80"
                                >
                                    <AccordionTrigger className="px-3 py-2 font-medium">
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
                                    </AccordionTrigger>
                                    <AccordionContent className="px-3 pb-3 text-[0.875em] whitespace-pre-wrap">
                                        {action.status === 'error'
                                            ? (action.error && action.error.trim().length > 0
                                                ? action.error
                                                : 'The system could not create this summary. Conversation history was used instead.')
                                            : action.content && action.content.trim().length > 0
                                                ? action.content
                                                : 'Summary is being prepared…'}
                                    </AccordionContent>
                                </AccordionItem>
                            </Accordion>
                        ))}
                    </div>
                )}
                {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="space-y-3 mb-3" data-graph-interactive="true">
                        {message.toolCalls.map((call, index) => (
                            <Accordion type="single" collapsible key={call.id || index} className="w-full">
                                <AccordionItem value={`tool-${call.id || index}`} className="rounded-md border border-muted-foreground/20 bg-background/80">
                                    <AccordionTrigger className="px-3 py-2 font-medium">
                                        <div className="flex items-center gap-2">
                                            <Badge variant="secondary" className="uppercase tracking-wide text-[0.75em]">Tool</Badge>
                                            <span className="text-muted-foreground">{call.name || 'Tool call'}</span>
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="px-3 pb-3 text-muted-foreground">
                                        <ToolCallDetails call={call} />
                                    </AccordionContent>
                                </AccordionItem>
                            </Accordion>
                        ))}
                    </div>
                )}
                <p className="whitespace-pre-wrap">{message.content}</p>

                {message.createdAt && (
                    <div className="mt-2 text-[0.65rem] text-muted-foreground/60">
                        {message.createdAt.toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                        })}
                    </div>
                )}

                <div className="absolute bottom-0 right-1 flex translate-y-1/2 items-center gap-0.5 rounded-md bg-muted p-0.5 text-xs text-foreground/70 shadow-sm">
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
