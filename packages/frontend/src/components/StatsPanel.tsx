import { useMemo } from 'react';
import { format } from 'date-fns';

type StatsPanelProps = {
    history: Record<string, { total_percentage_complete: number; daily_gain: number | null }> | undefined;
    selectedDate: Date;
};

export default function StatsPanel({ history, selectedDate }: StatsPanelProps) {
    const { rollingAverage, selectedGain } = useMemo(() => {
        if (!history) return { rollingAverage: 0, selectedGain: 0 };

        const sortedDates = Object.keys(history).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

        const selectedStart = new Date(selectedDate);
        selectedStart.setHours(0, 0, 0, 0);
        const selectedKey = selectedStart.toISOString().split('T')[0];
        const selectedGain = history[selectedKey]?.daily_gain ?? 0;

        const eligibleDates = sortedDates.filter(date => new Date(date) <= selectedStart).slice(-30);
        const gains = eligibleDates.map(date => history[date].daily_gain).filter(gain => gain !== null && gain > 0) as number[];

        const sum = gains.reduce((acc, gain) => acc + gain, 0);
        const rollingAverage = gains.length > 0 ? sum / gains.length : 0;

        return { rollingAverage, selectedGain };
    }, [history, selectedDate]);

    const selectedLabel = useMemo(() => format(selectedDate, 'MMM d, yyyy'), [selectedDate]);

    return (
        <div className="h-full w-full bg-card text-card-foreground p-2 flex flex-col justify-center gap-2">
            <div className="flex items-start justify-between">
                <div>
                    <h3 className="text-[0.6rem] font-semibold text-muted-foreground uppercase tracking-wider">Selected Day</h3>
                    <p className="text-[0.55rem] text-muted-foreground uppercase tracking-wider">{selectedLabel}</p>
                </div>
                <div className="text-xs font-bold text-primary">
                    {selectedGain >= 0 ? '+' : ''}{selectedGain.toFixed(2)}%
                </div>
            </div>
            <div className="border-t border-border my-1"></div>
            <div className="flex items-baseline justify-between">
                <h3 className="text-[0.6rem] font-semibold text-muted-foreground uppercase tracking-wider">30-Day AVG</h3>
                <div className="text-xs font-bold text-primary/80">
                    {rollingAverage.toFixed(2)}%
                </div>
            </div>
        </div>
    );
}
