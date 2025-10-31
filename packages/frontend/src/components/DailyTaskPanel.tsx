import { useMemo } from 'react';
import { getNodeColor, hexToRgba } from '@/lib/colorUtils';

type TaskPanelProps = {
    nodesById: Record<string, any>;
    onToggleComplete: (id: string) => void;
    onZoomToNode: (id: string) => void;
    startOfDay: Date;
    endOfDay: Date;
};

function isWithinDay(iso?: string, start?: Date, end?: Date) {
    if (!iso || !start || !end) return false;
    const t = new Date(iso).getTime();
    return t >= start.getTime() && t <= end.getTime();
}

function intersectsDayRange(startIso?: string, endIso?: string, start?: Date, end?: Date) {
    if (!startIso || !start || !end) return false;
    const startTime = new Date(startIso);
    if (Number.isNaN(startTime.getTime())) return false;
    const endTime = endIso ? new Date(endIso) : startTime;
    if (Number.isNaN(endTime.getTime())) return false;
    return startTime <= end && endTime >= start;
}

export default function DailyTaskPanel({ nodesById, onToggleComplete, onZoomToNode, startOfDay, endOfDay }: TaskPanelProps) {
    const { inProgressToday, completedToday } = useMemo(() => {
        const all = Object.entries(nodesById || {});
        const inProg = all.filter(([, n]) => {
            const node: any = n;
            if (node?.status !== 'in-progress') return false;
            return intersectsDayRange(node?.scheduled_start, node?.scheduled_end, startOfDay, endOfDay);
        });
        const completed = all.filter(([, n]) => {
            const node: any = n;
            if (node?.status !== 'completed') return false;
            return isWithinDay(node?.completed_at, startOfDay, endOfDay);
        });
        return {
            inProgressToday: inProg.map(([id, n]) => ({
                id,
                label: (n as any)?.label || id,
                color: getNodeColor((n as any)?.color),
            })),
            completedToday: completed.map(([id, n]) => ({
                id,
                label: (n as any)?.label || id,
                color: getNodeColor((n as any)?.color),
            })),
        };
    }, [nodesById, startOfDay, endOfDay]);

    return (
        <div className="h-full w-full flex flex-col bg-card text-card-foreground border-l border-border">
            <div className="px-2 py-3 border-b border-border font-bold text-[0.65rem] text-center text-blue-400 uppercase tracking-[0.15em] bg-gradient-to-r from-transparent via-blue-500/5 to-transparent animate-in fade-in-50 duration-500">In Progress</div>
            <div className="flex-1 overflow-auto p-3">
                {inProgressToday.length > 0 && (
                    <ul className="space-y-2">
                        {inProgressToday.map((t) => (
                            <li
                                key={t.id}
                                className="flex items-center gap-2 rounded-md border border-border/40 bg-card/40 px-2 py-1 text-[0.6rem]"
                                style={{
                                    borderLeftWidth: '4px',
                                    borderLeftColor: t.color,
                                    backgroundColor: hexToRgba(t.color, 0.18),
                                }}
                            >
                                <input
                                    aria-label={`Complete ${t.label}`}
                                    type="checkbox"
                                    className="h-4 w-4"
                                    onChange={() => onToggleComplete(t.id)}
                                />
                                <span
                                    aria-hidden
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: t.color }}
                                />
                                <button
                                    className="flex-1 text-left leading-4 hover:underline"
                                    onClick={() => onZoomToNode(t.id)}
                                >
                                    {t.label}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <div className="px-2 py-3 border-t border-border font-bold text-[0.65rem] text-center text-blue-400 uppercase tracking-[0.15em] bg-gradient-to-r from-transparent via-blue-500/5 to-transparent animate-in fade-in-50 duration-500">Completed</div>
            <div className="max-h-[40%] overflow-auto p-3">
                {completedToday.length > 0 && (
                    <ul className="space-y-2">
                        {completedToday.map((t) => (
                            <li
                                key={t.id}
                                className="flex items-center gap-2 rounded-md border border-border/40 bg-card/40 px-2 py-1 text-[0.6rem] opacity-80"
                                style={{
                                    borderLeftWidth: '4px',
                                    borderLeftColor: t.color,
                                    backgroundColor: hexToRgba(t.color, 0.12),
                                }}
                            >
                                <input type="checkbox" className="h-4 w-4" checked readOnly />
                                <span
                                    aria-hidden
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: t.color }}
                                />
                                <button
                                    className="flex-1 text-left leading-4 hover:underline"
                                    onClick={() => onZoomToNode(t.id)}
                                >
                                    {t.label}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
