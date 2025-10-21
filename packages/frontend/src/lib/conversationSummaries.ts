import type { ConversationSummaryRecord, SummaryLevel } from '@/hooks/chatProviderContext';

const SUMMARY_LEVEL_PRIORITY: Record<SummaryLevel, number> = {
    DAY: 0,
    WEEK: 1,
    MONTH: 2,
};

const summaryKey = (summary: ConversationSummaryRecord): string => {
    try {
        const periodIso = new Date(summary.summary_period_start).toISOString();
        return `${summary.summary_level}-${periodIso}`;
    } catch {
        return `${summary.summary_level}-${summary.summary_period_start}`;
    }
};

export const sortConversationSummaries = (
    summaries: ConversationSummaryRecord[]
): ConversationSummaryRecord[] =>
    [...summaries].sort((a, b) => {
        const levelDelta = SUMMARY_LEVEL_PRIORITY[a.summary_level] - SUMMARY_LEVEL_PRIORITY[b.summary_level];
        if (levelDelta !== 0) {
            return levelDelta;
        }
        const periodDelta = new Date(a.summary_period_start).getTime() - new Date(b.summary_period_start).getTime();
        if (!Number.isNaN(periodDelta) && periodDelta !== 0) {
            return periodDelta;
        }
        return a.id.localeCompare(b.id);
    });

export const mergeConversationSummaries = (
    existing: ConversationSummaryRecord[] | undefined,
    additions: ConversationSummaryRecord | ConversationSummaryRecord[]
): ConversationSummaryRecord[] => {
    const map = new Map<string, ConversationSummaryRecord>();
    (existing ?? []).forEach((summary) => {
        map.set(summaryKey(summary), summary);
    });

    const records = Array.isArray(additions) ? additions : [additions];
    records.forEach((summary) => {
        const key = summaryKey(summary);
        const current = map.get(key);
        if (!current) {
            map.set(key, summary);
            return;
        }
        const currentCreated = current.created_at ?? '';
        const nextCreated = summary.created_at ?? '';
        if (nextCreated > currentCreated) {
            map.set(key, summary);
        }
    });

    return sortConversationSummaries(Array.from(map.values()));
};
