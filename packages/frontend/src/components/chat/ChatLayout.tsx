import React, { useState, createContext, useContext } from 'react';
import ChatSidebar from './ChatSidebar';
import ChatPane from './ChatPane';
import { ChatProvider } from '@/hooks/chatProvider';
import { SystemInstructionsProvider } from '@/hooks/systemInstructionProvider';
import { ModelSelectionProvider } from '@/hooks/modelSelectionProvider';
import { ConversationContextProvider } from '@/hooks/conversationContextProvider';
import { cn } from '@/lib/utils';

interface SidebarContextType {
    isSidebarOpen: boolean;
    setIsSidebarOpen: (open: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export const useSidebar = () => {
    const context = useContext(SidebarContext);
    if (!context) {
        throw new Error('useSidebar must be used within ChatLayout');
    }
    return context;
};

const ChatLayout = () => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    return (
        <ChatProvider>
            <ModelSelectionProvider>
                <SystemInstructionsProvider>
                    <ConversationContextProvider>
                        <SidebarContext.Provider value={{ isSidebarOpen, setIsSidebarOpen }}>
                            <div className="relative flex h-full w-full overflow-hidden bg-background">
                                {/* Sidebar overlay */}
                                <div
                                    className={cn(
                                        'absolute left-0 top-0 z-30 h-full w-[75%] transform rounded-r-3xl bg-card shadow-2xl transition-transform duration-300 ease-in-out',
                                        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
                                    )}
                                >
                                    <ChatSidebar />
                                </div>

                                {/* Backdrop */}
                                {isSidebarOpen && (
                                    <div
                                        className="absolute inset-0 z-20 bg-black/30 transition-opacity duration-300"
                                        onClick={() => setIsSidebarOpen(false)}
                                    />
                                )}

                                {/* Main chat area */}
                                <div className="relative z-10 flex-1">
                                    <ChatPane />
                                </div>
                            </div>
                        </SidebarContext.Provider>
                    </ConversationContextProvider>
                </SystemInstructionsProvider>
            </ModelSelectionProvider>
        </ChatProvider>
    );
};

export default ChatLayout;
