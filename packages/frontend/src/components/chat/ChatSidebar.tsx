import React, { useMemo } from 'react';
import { useChatContext } from '@/hooks/useChat';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '@/lib/utils';
import { PlusCircle } from 'lucide-react';

const ChatSidebar = () => {
    const { threads, activeThreadId, createThread, setActiveThreadId, messages } = useChatContext();

    const sortedThreads = useMemo(() => {
        if (!threads) return [];
        return [...threads].sort((a, b) => {
            const aLeaf = a.leafMessageId ? messages[a.leafMessageId] : null;
            const bLeaf = b.leafMessageId ? messages[b.leafMessageId] : null;

            // Use the updatedAt of the leaf message, fallback to thread's createdAt.
            const aTime = aLeaf?.updatedAt?.getTime() ?? new Date(a.createdAt).getTime();
            const bTime = bLeaf?.updatedAt?.getTime() ?? new Date(b.createdAt).getTime();

            return bTime - aTime;
        });
    }, [threads, messages]);

    return (
        <div className="flex h-full flex-col bg-card p-2 text-card-foreground">
            <div className="flex items-center justify-center p-2">
                <Button
                    onClick={createThread}
                    className="h-10 w-10 rounded-full p-0"
                    variant="secondary"
                    title="Start a new chat"
                >
                    <PlusCircle className="h-4 w-4" />
                </Button>
            </div>
            <ScrollArea className="flex-1">
                <div className="flex flex-col gap-2 p-4">
                    {sortedThreads.map((thread) => (
                        <button
                            key={thread.id}
                            type="button"
                            onClick={() => setActiveThreadId(thread.id)}
                            className={cn(
                                'cursor-pointer rounded-md p-2 text-sm text-left hover:bg-muted',
                                activeThreadId === thread.id && 'bg-primary text-primary-foreground hover:bg-primary/90'
                            )}
                        >
                            <p className="truncate">{thread.title}</p>
                        </button>
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
};

export default ChatSidebar;
