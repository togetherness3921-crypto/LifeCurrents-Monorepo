import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { getNodeColor, hexToRgba } from '@/lib/colorUtils';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';

type CalendarPanelProps = {
    nodesById: Record<string, any>;
    startOfDay: Date;
    endOfDay: Date;
    now: Date;
    onZoomToNode: (id: string) => void;
    currentDate: Date;
    onPreviousDay: () => void;
    onNextDay: () => void;
    onSelectDate: (date: Date | undefined) => void;
    onGoToToday: () => void;
    dateLabel: string;
    isToday: boolean;
};

function minutesSinceStartOfDay(d: Date, startOfDay: Date) {
    return Math.max(0, Math.floor((d.getTime() - startOfDay.getTime()) / 60000));
}

export default function DailyCalendarPanel({
    nodesById,
    startOfDay,
    endOfDay,
    now,
    onZoomToNode,
    currentDate,
    onPreviousDay,
    onNextDay,
    onSelectDate,
    onGoToToday,
    dateLabel,
    isToday,
}: CalendarPanelProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const hasAutoScrolled = useRef(false);
    const userInteracted = useRef(false);
    const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

    const items = useMemo(() => {
        const result: Array<{ id: string; label: string; start: Date; end: Date; color: string; status?: string }> = [];
        for (const [id, n] of Object.entries(nodesById || {})) {
            const ns: any = n;
            if (!ns?.scheduled_start) continue;
            const scheduledStart = new Date(ns.scheduled_start);
            if (Number.isNaN(scheduledStart.getTime())) continue;
            const scheduledEnd = ns?.scheduled_end ? new Date(ns.scheduled_end) : new Date(ns.scheduled_start);
            if (Number.isNaN(scheduledEnd.getTime())) continue;
            const intersects = scheduledStart <= endOfDay && scheduledEnd >= startOfDay;
            if (!intersects) continue;
            const clampedStart = scheduledStart < startOfDay ? startOfDay : scheduledStart;
            let clampedEnd = scheduledEnd > endOfDay ? endOfDay : scheduledEnd;
            if (clampedEnd.getTime() <= clampedStart.getTime()) {
                clampedEnd = new Date(clampedStart.getTime() + 30 * 60000);
                if (clampedEnd > endOfDay) {
                    clampedEnd = endOfDay;
                }
            }
            result.push({
                id,
                label: ns.label || id,
                start: clampedStart,
                end: clampedEnd,
                color: getNodeColor(ns?.color),
                status: ns?.status,
            });
        }
        return result.sort((a, b) => a.start.getTime() - b.start.getTime());
    }, [nodesById, startOfDay, endOfDay]);

    const totalMinutes = 24 * 60;
    const pxPerMinute = 1; // 1px per minute => ~1440px total height
    const heightPx = totalMinutes * pxPerMinute;
    const nowOffset = minutesSinceStartOfDay(now, startOfDay) * pxPerMinute;

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const handleInteraction = () => {
            userInteracted.current = true;
        };

        el.addEventListener('wheel', handleInteraction, { passive: true });
        el.addEventListener('touchstart', handleInteraction, { passive: true });
        el.addEventListener('mousedown', handleInteraction, { passive: true });
        el.addEventListener('scroll', handleInteraction, { passive: true });

        return () => {
            el.removeEventListener('wheel', handleInteraction);
            el.removeEventListener('touchstart', handleInteraction);
            el.removeEventListener('mousedown', handleInteraction);
            el.removeEventListener('scroll', handleInteraction);
        };
    }, []);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || userInteracted.current || !isToday) return;

        const timeout = window.setTimeout(() => {
            const currentEl = containerRef.current;
            if (!currentEl || userInteracted.current || !isToday) return;
            const target = Math.max(0, nowOffset - currentEl.clientHeight / 2);
            currentEl.scrollTo({ top: target, behavior: hasAutoScrolled.current ? 'smooth' : 'auto' });
            hasAutoScrolled.current = true;
        }, hasAutoScrolled.current ? 0 : 300);

        return () => window.clearTimeout(timeout);
    }, [nowOffset, isToday]);

    useEffect(() => {
        if (!isToday) {
            hasAutoScrolled.current = false;
        }
    }, [isToday]);

    const hourLabel = (i: number) => {
        const hour12 = ((i + 11) % 12) + 1; // 0->12, 1->1, ..., 12->12, 13->1
        return String(hour12);
    };

    return (
        <div className="h-full w-full flex flex-col bg-card text-card-foreground border-l border-border">
            <div className="px-2 py-1 border-b border-border flex items-center justify-between" style={{ backgroundColor: '#ffd700' }}>
                <span className="font-semibold text-[0.6rem] text-red-600 uppercase tracking-wider">Calendar</span>
                <div className="flex items-center gap-1">
                    <Button
                        type="button"
                        onClick={onPreviousDay}
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="Previous day"
                    >
                        <ChevronLeft className="h-3 w-3" />
                    </Button>
                    <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-[10px] font-medium gap-1"
                                aria-label="Select date"
                            >
                                <CalendarIcon className="h-3 w-3" />
                                {dateLabel}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="p-0" sideOffset={6}>
                            <Calendar
                                mode="single"
                                selected={currentDate}
                                onSelect={(date) => {
                                    onSelectDate(date);
                                    if (date) {
                                        setIsDatePickerOpen(false);
                                    }
                                }}
                                initialFocus
                            />
                        </PopoverContent>
                    </Popover>
                    <Button
                        type="button"
                        onClick={onNextDay}
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="Next day"
                    >
                        <ChevronRight className="h-3 w-3" />
                    </Button>
                    <Button
                        type="button"
                        onClick={onGoToToday}
                        variant="outline"
                        size="sm"
                        className="ml-1 h-7 px-2 text-[10px] font-medium"
                        aria-label="Go to today"
                        disabled={isToday}
                    >
                        Today
                    </Button>
                </div>
            </div>
            <div ref={containerRef} className="flex-1 overflow-auto relative">
                {/* Timeline container */}
                <div className="relative mx-2" style={{ height: heightPx }}>
                    {/* Hour markers */}
                    {Array.from({ length: 25 }).map((_, i) => (
                        <div key={i} className="absolute left-0 right-0 border-t border-border text-[10px] text-muted-foreground"
                            style={{ top: i * 60 * pxPerMinute }}>
                            <span className="absolute left-0 -translate-x-0 text-[10px]">{hourLabel(i)}</span>
                        </div>
                    ))}

                    {/* Current time line */}
                    {isToday && (
                        <div className="absolute left-0 right-0" style={{ top: nowOffset }}>
                            <div className="h-px bg-red-500" />
                        </div>
                    )}

                    {/* Event bubbles */}
                    {items.map((it) => {
                        const startMin = minutesSinceStartOfDay(it.start, startOfDay);
                        const endMin = minutesSinceStartOfDay(it.end, startOfDay);
                        const top = startMin * pxPerMinute;
                        const height = Math.max(10, (endMin - startMin) * pxPerMinute);
                        const status = it.status;
                        const isCompleted = status === 'completed' || status === 'complete';
                        const baseColor = it.color;
                        const backgroundColor = hexToRgba(baseColor, isCompleted ? 0.45 : 0.28);
                        const borderColor = hexToRgba(baseColor, 0.7);
                        return (
                            <button
                                key={it.id}
                                type="button"
                                className={cn(
                                    'absolute left-0 right-0 rounded-sm border p-1 text-left text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background shadow-sm'
                                )}
                                style={{ top, height, backgroundColor, borderColor }}
                                onClick={() => onZoomToNode(it.id)}
                            >
                                <div className="font-medium text-foreground truncate">{it.label}</div>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
