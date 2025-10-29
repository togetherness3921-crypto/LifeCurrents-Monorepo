import React, { useState, useEffect } from 'react';
import ChatSidebar from './ChatSidebar';
import ChatPane from './ChatPane';
import { ChatProvider } from '@/hooks/chatProvider';
import { SystemInstructionsProvider } from '@/hooks/systemInstructionProvider';
import { ModelSelectionProvider } from '@/hooks/modelSelectionProvider';
import { ConversationContextProvider } from '@/hooks/conversationContextProvider';
import { cn } from '@/lib/utils';

const ChatLayout = () => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    // Add Escape key handler to close sidebar
    useEffect(() => {
        if (!isSidebarOpen) return;

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsSidebarOpen(false);
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isSidebarOpen]);

    return (
        <ChatProvider>
            <ModelSelectionProvider>
                <SystemInstructionsProvider>
                    <ConversationContextProvider>
                        <div className="relative h-full w-full overflow-hidden bg-background">
                            {/* Chat pane - ALWAYS full width */}
                            <div className="w-full h-full">
                                <ChatPane
                                    isSidebarOpen={isSidebarOpen}
                                    onToggleSidebar={() => setIsSidebarOpen(prev => !prev)}
                                />
                            </div>

                            {/* Sidebar - OVERLAY positioned */}
                            <div
                                className={cn(
                                    'absolute left-0 top-0 h-full z-30 transition-transform duration-300 ease-in-out',
                                    'w-[75%] max-w-[400px]',
                                    isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
                                )}
                            >
                                <div className="h-full w-full overflow-hidden border-r bg-card text-card-foreground shadow-lg">
                                    <ChatSidebar />
                                </div>
                            </div>

                            {/* Backdrop/Click-to-close area */}
                            {isSidebarOpen && (
                                <div
                                    className="absolute inset-0 z-[25]"
                                    onClick={() => setIsSidebarOpen(false)}
                                    aria-label="Close sidebar"
                                />
                            )}
                        </div>
                    </ConversationContextProvider>
                </SystemInstructionsProvider>
            </ModelSelectionProvider>
        </ChatProvider>
    );
};

export default ChatLayout;
