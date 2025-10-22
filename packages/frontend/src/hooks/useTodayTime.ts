import { useEffect, useMemo, useRef, useState } from 'react';
import { startOfUtcDay, endOfUtcDay } from '@/services/intelligentContext';

function toDayKey(d: Date): string {
    // Use the custom day boundary (5 AM Central) for day key calculation
    const dayStart = startOfUtcDay(d);
    const y = dayStart.getUTCFullYear();
    const m = String(dayStart.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dayStart.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function useTodayTime(tickMs: number = 60000) {
    const [now, setNow] = useState<Date>(new Date());
    const prevDayKeyRef = useRef<string>(toDayKey(new Date()));
    const [dayKey, setDayKey] = useState<string>(prevDayKeyRef.current);

    useEffect(() => {
        const update = () => {
            const current = new Date();
            setNow(current);
            const currentKey = toDayKey(current);
            if (currentKey !== prevDayKeyRef.current) {
                prevDayKeyRef.current = currentKey;
                setDayKey(currentKey);
            }
        };
        update();
        const id = setInterval(update, tickMs);
        return () => clearInterval(id);
    }, [tickMs]);

    const { startOfDay, endOfDay } = useMemo(() => {
        // Use custom day boundary (5 AM Central) instead of local midnight
        const sod = startOfUtcDay(now);
        const eod = endOfUtcDay(now);
        return { startOfDay: sod, endOfDay: eod };
    }, [now]);

    return { now, dayKey, startOfDay, endOfDay } as const;
}
