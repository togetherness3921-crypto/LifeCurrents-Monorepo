import React from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '@/lib/utils';

interface FullScreenModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
}

const FullScreenModal: React.FC<FullScreenModalProps> = ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border p-4">
                <h2 className="text-lg font-semibold text-foreground">{title}</h2>
                <Button
                    onClick={onClose}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    aria-label="Close"
                >
                    <X className="h-5 w-5" />
                </Button>
            </div>

            {/* Content */}
            <ScrollArea className="flex-1">
                <div className="p-6">
                    {children}
                </div>
            </ScrollArea>
        </div>
    );
};

export default FullScreenModal;

