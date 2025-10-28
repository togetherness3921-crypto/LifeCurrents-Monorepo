// This component will render a single chat message bubble
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState('');
    const contentRef = useRef<HTMLDivElement>(null);

    // Helper function to extract list markdown
    const extractListMarkdown = useCallback((
        fullMarkdown: string,
        selectedText: string,
        isOrdered: boolean
    ): string => {
        // Split markdown into lines
        const lines = fullMarkdown.split('\n');

        // Find lines that match list syntax and contain selected text words
        const selectedWords = selectedText.split(/\s+/).filter(w => w.length > 2);
        const listLines: string[] = [];

        const listPattern = isOrdered ? /^\d+\.\s+/ : /^[-*+]\s+/;

        for (const line of lines) {
            if (listPattern.test(line)) {
                // Check if this line contains any of the selected words
                const lineText = line.replace(listPattern, '').trim();
                if (selectedWords.some(word => lineText.includes(word))) {
                    listLines.push(line);
                }
            }
        }

        // If we found matching list lines, return them
        if (listLines.length > 0) {
            return listLines.join('\n');
        }

        // Fallback: try to reconstruct list from selected text
        const textLines = selectedText.split('\n').filter(l => l.trim());
        if (isOrdered) {
            return textLines.map((line, i) => `${i + 1}. ${line.trim()}`).join('\n');
        } else {
            return textLines.map(line => `- ${line.trim()}`).join('\n');
        }
    }, []);

    // Helper function to extract markdown from selection
    const extractMarkdownForSelection = useCallback((
        fullMarkdown: string,
        selectedText: string,
        selection: Selection
    ): string | null => {
        // If selection is very small or empty, return null to use default behavior
        if (selectedText.trim().length < 2) {
            return null;
        }

        // STRATEGY 1: If selecting entire or most of message, return full markdown
        if (selectedText.length / fullMarkdown.length > 0.8) {
            return fullMarkdown;
        }

        // STRATEGY 2: Detect if selection includes list items
        const selectedNode = selection.anchorNode;
        if (selectedNode) {
            // Check if selection is within a list
            let listElement = selectedNode.parentElement;
            while (listElement && listElement !== contentRef.current) {
                if (listElement.tagName === 'UL' || listElement.tagName === 'OL') {
                    // Extract list items from markdown
                    return extractListMarkdown(fullMarkdown, selectedText, listElement.tagName === 'OL');
                }
                listElement = listElement.parentElement;
            }
        }

        // STRATEGY 3: Search for selected text in markdown and return with context
        const escapedText = selectedText.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Check for bold syntax
        const boldPattern = new RegExp(`\\*\\*[^*]*${escapedText}[^*]*\\*\\*`, 'i');
        const boldMatch = fullMarkdown.match(boldPattern);
        if (boldMatch) {
            return boldMatch[0];
        }

        // Check for italic syntax
        const italicPattern = new RegExp(`\\*[^*]*${escapedText}[^*]*\\*`, 'i');
        const italicMatch = fullMarkdown.match(italicPattern);
        if (italicMatch) {
            return italicMatch[0];
        }

        // Check for heading
        const headingPattern = new RegExp(`^#+\\s+.*${escapedText}.*$`, 'mi');
        const headingMatch = fullMarkdown.match(headingPattern);
        if (headingMatch) {
            return headingMatch[0];
        }

        // Check for code blocks
        const codeBlockPattern = new RegExp(`\`\`\`[\\s\\S]*?${escapedText}[\\s\\S]*?\`\`\``, 'i');
        const codeBlockMatch = fullMarkdown.match(codeBlockPattern);
        if (codeBlockMatch) {
            return codeBlockMatch[0];
        }

        // Check for inline code
        const inlineCodePattern = new RegExp(`\`[^\`]*${escapedText}[^\`]*\``, 'i');
        const inlineCodeMatch = fullMarkdown.match(inlineCodePattern);
        if (inlineCodeMatch) {
            return inlineCodeMatch[0];
        }

        // FALLBACK: Return null to use default copy behavior
        return null;
    }, [extractListMarkdown]);

    // Copy event handler
    const handleCopy = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
        const selection = window.getSelection();

        // If no selection or selection is collapsed, use default behavior
        if (!selection || selection.isCollapsed) {
            return;
        }

        // Get the selected text
        const selectedText = selection.toString();

        // Try to extract markdown from the message content based on selected text
        const markdown = extractMarkdownForSelection(message.content, selectedText, selection);

        if (markdown) {
            event.clipboardData?.setData('text/plain', markdown);
            event.preventDefault();
        }
        // If markdown extraction fails, allow default copy behavior
    }, [message.content, extractMarkdownForSelection]);

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
                                <Accordion type="single" collapsible key={summary.id} className="w-full">
                                    <AccordionItem
                                        value={`persisted-summary-${summary.id}`}
                                        className="rounded-md border border-muted-foreground/20 bg-background/80"
                                    >
                                        <AccordionTrigger className="px-3 py-2 font-medium">
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
                                        </AccordionTrigger>
                                        <AccordionContent className="px-3 pb-3 text-[0.875em] whitespace-pre-wrap">
                                            {summary.content}
                                        </AccordionContent>
                                    </AccordionItem>
                                </Accordion>
                            );
                        })}
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
                <div ref={contentRef} onCopy={handleCopy} className="markdown-content">
                    <ReactMarkdown
                        className="prose prose-invert max-w-none prose-pre:bg-muted prose-pre:text-foreground"
                        remarkPlugins={[remarkGfm]}
                    >
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
