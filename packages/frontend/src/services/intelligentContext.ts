import type { ApiMessage } from './openRouter';
import { getGeminiResponse } from './openRouter';
import type { ConversationSummaryRecord, Message, SummaryLevel } from '@/hooks/chatProviderContext';
import type { ToolExecutionResult } from '@/lib/mcp/types';

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
});
const WEEK_RANGE_FORMAT = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' });
const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' });
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });

type SummaryMap = Record<SummaryLevel, Map<string, ConversationSummaryRecord>>;

type ActionStatus = 'pending' | 'running' | 'success' | 'error';

interface ToolMessage {
    id: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    created_at?: string;
}

export interface SummarizeActionDescriptor {
    summaryLevel: SummaryLevel;
    periodStart: Date;
    periodEnd: Date;
    label: string;
}

export interface SummarizeActionUpdate {
    status?: ActionStatus;
    content?: string;
    error?: string;
}

export interface PrepareIntelligentContextOptions {
    conversationId: string;
    branchHeadMessageId: string | null;
    createdByMessageId: string;
    historyChain: Message[];
    callTool: (toolName: string, args: Record<string, unknown>) => Promise<ToolExecutionResult>;
    summaryPrompt: string;
    model: string;
    registerAction: (descriptor: SummarizeActionDescriptor) => string;
    updateAction: (actionId: string, update: SummarizeActionUpdate) => void;
    now?: Date;
    forcedRecentMessageCount: number;
    onSummaryPersisted?: (record: ConversationSummaryRecord) => void;
}

export interface IntelligentContextResult {
    systemMessages: ApiMessage[];
    recentMessages: Message[];
}

const startOfUtcDay = (input: Date): Date => {
    const value = new Date(input);
    value.setUTCHours(0, 0, 0, 0);
    return value;
};

const addUtcDays = (input: Date, amount: number): Date => {
    const value = new Date(input);
    value.setUTCDate(value.getUTCDate() + amount);
    return value;
};

const startOfUtcWeek = (input: Date): Date => {
    const value = startOfUtcDay(input);
    const dayOfWeek = value.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
    return addUtcDays(value, -dayOfWeek);
};

const startOfUtcMonth = (input: Date): Date => {
    const value = startOfUtcDay(input);
    value.setUTCDate(1);
    return value;
};

const addUtcMonths = (input: Date, amount: number): Date => {
    const year = input.getUTCFullYear();
    const month = input.getUTCMonth();
    return startOfUtcMonth(new Date(Date.UTC(year, month + amount, 1)));
};

const toIsoKey = (date: Date): string => date.toISOString();

const isSameInstant = (a: Date, b: Date): boolean => a.getTime() === b.getTime();

const ensureArray = <T>(value: unknown): T[] => {
    if (Array.isArray(value)) {
        return value as T[];
    }
    if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) {
        return (value as { items: unknown[] }).items as T[];
    }
    return [];
};

const parseToolJson = <T>(result: ToolExecutionResult, context: string): T => {
    if (!result) {
        throw new Error(`${context}: Tool returned no result`);
    }
    if (result.isError) {
        throw new Error(`${context}: Tool reported an error`);
    }
    const { content } = result;
    if (content === null || content === undefined) {
        throw new Error(`${context}: Tool response was empty`);
    }
    const payload: unknown =
        typeof content === 'string'
            ? (() => {
                  try {
                      return JSON.parse(content) as unknown;
                  } catch (error) {
                      throw new Error(`${context}: Failed to parse tool response`);
                  }
              })()
            : content;

    if (!payload || (typeof payload !== 'object' && !Array.isArray(payload))) {
        throw new Error(`${context}: Unexpected tool response type`);
    }

    if (typeof payload === 'object' && !Array.isArray(payload)) {
        const envelope = payload as { success?: boolean; error?: { message?: string }; data?: unknown };
        if (envelope.success === false) {
            const message = envelope.error?.message ?? `${context}: Tool reported failure`;
            throw new Error(message);
        }
        if (Object.prototype.hasOwnProperty.call(envelope, 'data')) {
            return envelope.data as T;
        }
    }

    return payload as T;
};

const normaliseSummaryRecord = (input: unknown): ConversationSummaryRecord | null => {
    if (!input || typeof input !== 'object') {
        return null;
    }
    const record = input as Partial<ConversationSummaryRecord> & Record<string, unknown>;
    if (
        typeof record.summary_level !== 'string' ||
        typeof record.summary_period_start !== 'string' ||
        typeof record.content !== 'string'
    ) {
        return null;
    }
    const id = typeof record.id === 'string' ? record.id : `summary-${record.summary_level}-${record.summary_period_start}`;
    const thread_id =
        typeof record.thread_id === 'string'
            ? record.thread_id
            : typeof (record as { conversation_id?: unknown }).conversation_id === 'string'
              ? (record as { conversation_id: string }).conversation_id
              : '';
    const created_by_message_id =
        typeof record.created_by_message_id === 'string' ? record.created_by_message_id : '';
    return {
        id,
        thread_id,
        summary_level: record.summary_level as SummaryLevel,
        summary_period_start: record.summary_period_start,
        content: record.content,
        created_by_message_id,
        created_at: typeof record.created_at === 'string' ? record.created_at : undefined,
    };
};

const buildEmptySummaryMap = (): SummaryMap => ({
    DAY: new Map(),
    WEEK: new Map(),
    MONTH: new Map(),
});

const ingestSummaries = (map: SummaryMap, summaries: ConversationSummaryRecord[]) => {
    summaries.forEach((summary) => {
        const key = toIsoKey(new Date(summary.summary_period_start));
        const bucket = map[summary.summary_level];
        if (!bucket) return;
        const existing = bucket.get(key);
        if (!existing || !existing.created_at || (summary.created_at && summary.created_at > existing.created_at)) {
            bucket.set(key, summary);
        }
    });
};

const fetchExistingSummaries = async (
    options: PrepareIntelligentContextOptions
): Promise<SummaryMap> => {
    const { conversationId, branchHeadMessageId, callTool } = options;
    const map = buildEmptySummaryMap();
    if (!conversationId || !branchHeadMessageId) {
        return map;
    }
    try {
        const result = await callTool('get_conversation_summaries', {
            conversation_id: conversationId,
            message_id: branchHeadMessageId,
        });
        const parsed = parseToolJson<unknown>(result, 'get_conversation_summaries');
        const summaryPayload = Array.isArray(parsed)
            ? parsed
            : (parsed as { summaries?: unknown[] }).summaries;
        const summaries = ensureArray<unknown>(summaryPayload)
            .map((item) => normaliseSummaryRecord(item))
            .filter((item): item is ConversationSummaryRecord => Boolean(item));
        ingestSummaries(map, summaries);
    } catch (error) {
        console.warn('[IntelligentContext] Failed to fetch summaries:', error);
    }
    return map;
};

const fetchMessagesForPeriod = async (
    options: PrepareIntelligentContextOptions,
    start: Date,
    end: Date
): Promise<ToolMessage[]> => {
    const { conversationId, branchHeadMessageId, callTool } = options;
    if (!conversationId || !branchHeadMessageId) {
        return [];
    }
    const periodStartIso = start.toISOString();
    const periodEndIso = end.toISOString();
    console.log('[IntelligentContext] get_messages_for_period request', {
        table: 'chat_messages',
        threadId: conversationId,
        branchHeadMessageId,
        periodStart: periodStartIso,
        periodEnd: periodEndIso,
    });
    try {
        const result = await callTool('get_messages_for_period', {
            conversation_id: conversationId,
            message_id: branchHeadMessageId,
            period_start: periodStartIso,
            period_end: periodEndIso,
        });
        const parsed = parseToolJson<unknown>(result, 'get_messages_for_period');
        const messages = ensureArray<unknown>(
            Array.isArray(parsed) ? parsed : (parsed as { messages?: unknown[] }).messages
        );
        const toolMessages = messages
            .map((entry) => {
                if (!entry || typeof entry !== 'object') return null;
                const payload = entry as ToolMessage;
                if (typeof payload.role !== 'string' || typeof payload.content !== 'string') {
                    return null;
                }
                return {
                    id: typeof payload.id === 'string' ? payload.id : '',
                    role: payload.role as ToolMessage['role'],
                    content: payload.content,
                    created_at: typeof payload.created_at === 'string' ? payload.created_at : undefined,
                } satisfies ToolMessage;
            })
            .filter((item): item is ToolMessage => Boolean(item));
        const summaryByDate = toolMessages.reduce<Record<string, number>>((acc, message) => {
            if (!message.created_at) return acc;
            try {
                const date = new Date(message.created_at).toISOString().split('T')[0];
                acc[date] = (acc[date] ?? 0) + 1;
            } catch (error) {
                console.warn('[IntelligentContext] Failed to parse created_at for logging', {
                    created_at: message.created_at,
                    error,
                });
            }
            return acc;
        }, {});
        console.log('[IntelligentContext] get_messages_for_period response', {
            table: 'chat_messages',
            threadId: conversationId,
            branchHeadMessageId,
            periodStart: periodStartIso,
            periodEnd: periodEndIso,
            totalMessages: toolMessages.length,
            summaryByDate,
            rawMessages: toolMessages,
        });
        return toolMessages;
    } catch (error) {
        console.error('[IntelligentContext] get_messages_for_period failed', {
            threadId: conversationId,
            branchHeadMessageId,
            periodStart: periodStartIso,
            periodEnd: periodEndIso,
            error,
        });
        console.warn('[IntelligentContext] Failed to fetch messages for period:', error);
        return [];
    }
};

const createSummaryRecord = async (
    options: PrepareIntelligentContextOptions,
    summaryMap: SummaryMap,
    level: SummaryLevel,
    periodStart: Date,
    content: string
): Promise<ConversationSummaryRecord | null> => {
    const { conversationId, createdByMessageId, callTool } = options;
    try {
        const payload = await callTool('create_conversation_summary', {
            conversation_id: conversationId,
            summary_level: level,
            summary_period_start: periodStart.toISOString(),
            content,
            created_by_message_id: createdByMessageId,
        });
        const parsed = parseToolJson<unknown>(payload, 'create_conversation_summary');
        const summaryInput =
            parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'summary' in parsed
                ? (parsed as { summary: unknown }).summary
                : parsed;
        const record = normaliseSummaryRecord(summaryInput) ?? {
            id: `local-${level}-${periodStart.toISOString()}`,
            thread_id: conversationId,
            summary_level: level,
            summary_period_start: periodStart.toISOString(),
            content,
            created_by_message_id: createdByMessageId,
            created_at: new Date().toISOString(),
        };
        const key = toIsoKey(new Date(record.summary_period_start));
        summaryMap[level].set(key, record);
        options.onSummaryPersisted?.(record);
        return record;
    } catch (error) {
        console.warn('[IntelligentContext] Failed to create summary:', error);
        return null;
    }
};

const formatMessageTranscript = (messages: ToolMessage[]): string => {
    if (!messages || messages.length === 0) {
        return 'No conversation occurred during this period.';
    }
    const sorted = [...messages].sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        return aTime - bTime;
    });
    return sorted
        .map((message) => {
            const timestamp = message.created_at ? TIME_FORMAT.format(new Date(message.created_at)) : '—';
            const role = message.role.toUpperCase();
            return `[${timestamp}] ${role}: ${message.content}`;
        })
        .join('\n');
};

const generateSummaryText = async (
    options: PrepareIntelligentContextOptions,
    level: SummaryLevel,
    label: string,
    sourceText: string
): Promise<string> => {
    const prompt = options.summaryPrompt?.trim();
    const systemPrompt = prompt.length > 0 ? prompt : 'Summarize the provided conversation context.';
    const { content } = await getGeminiResponse(
        [
            { role: 'system', content: systemPrompt },
            {
                role: 'user',
                content: `Summarize the following ${level.toLowerCase()} context (${label}). Focus on factual events, decisions, and next actions.\n\n${sourceText}`,
            },
        ],
        { model: options.model, stream: false }
    );
    return content?.trim() ?? '';
};

const formatDateRange = (start: Date, endExclusive: Date): string => {
    const inclusiveEnd = addUtcDays(endExclusive, -1);
    const sameYear = start.getUTCFullYear() === inclusiveEnd.getUTCFullYear();
    const sameMonth = sameYear && start.getUTCMonth() === inclusiveEnd.getUTCMonth();
    if (sameMonth) {
        return `${WEEK_RANGE_FORMAT.format(start)} – ${WEEK_RANGE_FORMAT.format(inclusiveEnd)}, ${start.getUTCFullYear()}`;
    }
    if (sameYear) {
        return `${WEEK_RANGE_FORMAT.format(start)} – ${WEEK_RANGE_FORMAT.format(inclusiveEnd)}, ${start.getUTCFullYear()}`;
    }
    return `${DATE_FORMAT.format(start)} – ${DATE_FORMAT.format(inclusiveEnd)}`;
};

const getRelativeLabel = (level: SummaryLevel, start: Date, endExclusive: Date, now: Date): string => {
    const todayStart = startOfUtcDay(now);
    const yesterdayStart = addUtcDays(todayStart, -1);
    const lastWeekStart = addUtcDays(startOfUtcWeek(now), -7);
    const lastMonthStart = addUtcMonths(startOfUtcMonth(now), -1);

    if (level === 'DAY') {
        if (isSameInstant(start, yesterdayStart)) {
            return `Yesterday (${DATE_FORMAT.format(start)})`;
        }
        return DATE_FORMAT.format(start);
    }

    if (level === 'WEEK') {
        if (isSameInstant(start, lastWeekStart)) {
            return `Last Week (${formatDateRange(start, endExclusive)})`;
        }
        return `Week of ${formatDateRange(start, endExclusive)}`;
    }

    if (level === 'MONTH') {
        if (isSameInstant(start, lastMonthStart)) {
            return `Last Month (${MONTH_YEAR_FORMAT.format(start)})`;
        }
        return MONTH_YEAR_FORMAT.format(start);
    }

    return DATE_FORMAT.format(start);
};

const ensureDaySummaries = async (
    options: PrepareIntelligentContextOptions,
    summaryMap: SummaryMap,
    candidateDays: Date[],
    now: Date
) => {
    const sorted = candidateDays
        .map((date) => startOfUtcDay(date))
        .sort((a, b) => a.getTime() - b.getTime());
    for (const periodStart of sorted) {
        const key = toIsoKey(periodStart);
        if (summaryMap.DAY.has(key)) continue;
        const periodEnd = addUtcDays(periodStart, 1);
        const label = getRelativeLabel('DAY', periodStart, periodEnd, now);
        const actionId = options.registerAction({
            summaryLevel: 'DAY',
            periodStart,
            periodEnd,
            label,
        });
        options.updateAction(actionId, { status: 'running' });
        try {
            const messages = await fetchMessagesForPeriod(options, periodStart, periodEnd);
            const transcript = formatMessageTranscript(messages);
            const summaryText =
                messages.length === 0
                    ? `No conversation occurred on ${DATE_FORMAT.format(periodStart)}.`
                    : await generateSummaryText(options, 'DAY', label, transcript);
            const record = await createSummaryRecord(options, summaryMap, 'DAY', periodStart, summaryText);
            if (record) {
                options.updateAction(actionId, { status: 'success', content: summaryText });
            } else {
                options.updateAction(actionId, {
                    status: 'error',
                    error: 'Failed to store day summary.',
                });
            }
        } catch (error) {
            options.updateAction(actionId, {
                status: 'error',
                error: error instanceof Error ? error.message : 'Failed to generate day summary.',
            });
        }
    }
};

const ensureWeekSummaries = async (
    options: PrepareIntelligentContextOptions,
    summaryMap: SummaryMap,
    now: Date
) => {
    const currentWeekStart = startOfUtcWeek(now);
    const groupedByWeek = new Map<string, ConversationSummaryRecord[]>();
    summaryMap.DAY.forEach((summary) => {
        const start = startOfUtcWeek(new Date(summary.summary_period_start));
        const key = toIsoKey(start);
        if (!groupedByWeek.has(key)) {
            groupedByWeek.set(key, []);
        }
        groupedByWeek.get(key)!.push(summary);
    });
    for (const [weekKey, daySummaries] of groupedByWeek.entries()) {
        const weekStart = new Date(weekKey);
        if (weekStart.getTime() >= currentWeekStart.getTime()) {
            continue;
        }
        if (summaryMap.WEEK.has(weekKey)) {
            continue;
        }
        const sortedDays = daySummaries.sort(
            (a, b) => new Date(a.summary_period_start).getTime() - new Date(b.summary_period_start).getTime()
        );
        const periodEnd = addUtcDays(weekStart, 7);
        const label = getRelativeLabel('WEEK', weekStart, periodEnd, now);
        const actionId = options.registerAction({
            summaryLevel: 'WEEK',
            periodStart: weekStart,
            periodEnd,
            label,
        });
        options.updateAction(actionId, { status: 'running' });
        try {
            const sourceText = sortedDays
                .map((daySummary) => {
                    const dayLabel = DATE_FORMAT.format(new Date(daySummary.summary_period_start));
                    return `${dayLabel}:\n${daySummary.content}`;
                })
                .join('\n\n');
            if (sourceText.trim().length === 0) {
                options.updateAction(actionId, {
                    status: 'error',
                    error: 'Not enough information to summarize the week.',
                });
                continue;
            }
            const summaryText = await generateSummaryText(options, 'WEEK', label, sourceText);
            const record = await createSummaryRecord(options, summaryMap, 'WEEK', weekStart, summaryText);
            if (record) {
                options.updateAction(actionId, { status: 'success', content: summaryText });
            } else {
                options.updateAction(actionId, {
                    status: 'error',
                    error: 'Failed to store week summary.',
                });
            }
        } catch (error) {
            options.updateAction(actionId, {
                status: 'error',
                error: error instanceof Error ? error.message : 'Failed to generate week summary.',
            });
        }
    }
};

const ensureMonthSummaries = async (
    options: PrepareIntelligentContextOptions,
    summaryMap: SummaryMap,
    now: Date
) => {
    const currentMonthStart = startOfUtcMonth(now);
    const groupedByMonth = new Map<string, ConversationSummaryRecord[]>();
    summaryMap.WEEK.forEach((summary) => {
        const monthStart = startOfUtcMonth(new Date(summary.summary_period_start));
        const key = toIsoKey(monthStart);
        if (!groupedByMonth.has(key)) {
            groupedByMonth.set(key, []);
        }
        groupedByMonth.get(key)!.push(summary);
    });
    for (const [monthKey, weekSummaries] of groupedByMonth.entries()) {
        const monthStart = new Date(monthKey);
        if (monthStart.getTime() >= currentMonthStart.getTime()) {
            continue;
        }
        if (summaryMap.MONTH.has(monthKey)) {
            continue;
        }
        const sortedWeeks = weekSummaries.sort(
            (a, b) => new Date(a.summary_period_start).getTime() - new Date(b.summary_period_start).getTime()
        );
        const periodEnd = addUtcMonths(monthStart, 1);
        const label = getRelativeLabel('MONTH', monthStart, periodEnd, now);
        const actionId = options.registerAction({
            summaryLevel: 'MONTH',
            periodStart: monthStart,
            periodEnd,
            label,
        });
        options.updateAction(actionId, { status: 'running' });
        try {
            const sourceText = sortedWeeks
                .map((weekSummary) => {
                    const weekStart = new Date(weekSummary.summary_period_start);
                    const weekLabel = formatDateRange(weekStart, addUtcDays(weekStart, 7));
                    return `${weekLabel}:\n${weekSummary.content}`;
                })
                .join('\n\n');
            if (sourceText.trim().length === 0) {
                options.updateAction(actionId, {
                    status: 'error',
                    error: 'Not enough information to summarize the month.',
                });
                continue;
            }
            const summaryText = await generateSummaryText(options, 'MONTH', label, sourceText);
            const record = await createSummaryRecord(options, summaryMap, 'MONTH', monthStart, summaryText);
            if (record) {
                options.updateAction(actionId, { status: 'success', content: summaryText });
            } else {
                options.updateAction(actionId, {
                    status: 'error',
                    error: 'Failed to store month summary.',
                });
            }
        } catch (error) {
            options.updateAction(actionId, {
                status: 'error',
                error: error instanceof Error ? error.message : 'Failed to generate month summary.',
            });
        }
    }
};

const buildSystemMessages = (
    summaryMap: SummaryMap,
    now: Date
): { systemMessages: ApiMessage[]; yesterdaySummary?: ConversationSummaryRecord | null } => {
    const systemMessages: ApiMessage[] = [];
    const todayStart = startOfUtcDay(now);
    const yesterdayStart = addUtcDays(todayStart, -1);
    const currentWeekStart = startOfUtcWeek(now);
    const currentMonthStart = startOfUtcMonth(now);

    const monthSummaries = Array.from(summaryMap.MONTH.values())
        .map((summary) => ({ summary, start: new Date(summary.summary_period_start) }))
        .filter(({ start }) => start.getTime() < currentMonthStart.getTime())
        .sort((a, b) => a.start.getTime() - b.start.getTime());
    monthSummaries.forEach(({ summary, start }) => {
        const periodEnd = addUtcMonths(start, 1);
        const label = getRelativeLabel('MONTH', start, periodEnd, now);
        systemMessages.push({
            role: 'system',
            content: `[MONTH SUMMARY | ${label}]\n${summary.content}`,
        });
    });

    const weekSummaries = Array.from(summaryMap.WEEK.values())
        .map((summary) => ({ summary, start: new Date(summary.summary_period_start) }))
        .filter(({ start }) => start.getTime() >= currentMonthStart.getTime() && start.getTime() < currentWeekStart.getTime())
        .sort((a, b) => a.start.getTime() - b.start.getTime());
    weekSummaries.forEach(({ summary, start }) => {
        const periodEnd = addUtcDays(start, 7);
        const label = getRelativeLabel('WEEK', start, periodEnd, now);
        systemMessages.push({
            role: 'system',
            content: `[WEEK SUMMARY | ${label}]\n${summary.content}`,
        });
    });

    const yesterdayKey = toIsoKey(yesterdayStart);
    const yesterdaySummary = summaryMap.DAY.get(yesterdayKey) ?? null;

    const daySummaries = Array.from(summaryMap.DAY.values())
        .map((summary) => ({ summary, start: new Date(summary.summary_period_start) }))
        .filter(({ start }) => {
            const time = start.getTime();
            // Get summaries from the current week, but exclude today and yesterday
            return time >= currentWeekStart.getTime() && time < yesterdayStart.getTime();
        })
        .sort((a, b) => a.start.getTime() - b.start.getTime());

    daySummaries.forEach(({ summary, start }) => {
        const periodEnd = addUtcDays(start, 1);
        const label = getRelativeLabel('DAY', start, periodEnd, now);
        systemMessages.push({
            role: 'system',
            content: `[DAY SUMMARY | ${label}]\n${summary.content}`,
        });
    });

    if (yesterdaySummary) {
        const start = new Date(yesterdaySummary.summary_period_start);
        const label = getRelativeLabel('DAY', start, addUtcDays(start, 1), now);
        systemMessages.push({
            role: 'system',
            content: `[DAY SUMMARY | ${label}]\n${yesterdaySummary.content}`,
        });
    }

    return { systemMessages, yesterdaySummary };
};

const filterRecentMessages = (history: Message[], now: Date, forcedCount: number): Message[] => {
    if (!history || history.length === 0) {
        return [];
    }
    const todayStart = startOfUtcDay(now);
    const recentIds = new Set<string>();
    history.forEach((message) => {
        if (message.createdAt && message.createdAt >= todayStart) {
            recentIds.add(message.id);
        }
    });
    const clampedCount = Math.min(6, Math.max(0, Math.round(forcedCount ?? 0)));
    if (clampedCount > 0) {
        const forcedTail = history.slice(Math.max(0, history.length - clampedCount));
        forcedTail.forEach((message) => recentIds.add(message.id));
    }
    if (recentIds.size === history.length) {
        return [...history];
    }
    return history.filter((message) => recentIds.has(message.id));
};

export const prepareIntelligentContext = async (
    options: PrepareIntelligentContextOptions
): Promise<IntelligentContextResult> => {
    const now = options.now ?? new Date();
    const historyChain = options.historyChain ?? [];
    const forcedTailCount = Math.min(6, Math.max(0, Math.round(options.forcedRecentMessageCount ?? 0)));

    if (!options.branchHeadMessageId) {
        return {
            systemMessages: [],
            recentMessages: filterRecentMessages(historyChain, now, forcedTailCount),
        };
    }

    const summaryMap = await fetchExistingSummaries(options);

    const todayStart = startOfUtcDay(now);
    const candidateDays = new Set<string>();
    historyChain.forEach((message) => {
        if (!message.createdAt) return;
        if (message.createdAt >= todayStart) return;
        const dayStart = startOfUtcDay(message.createdAt);
        candidateDays.add(toIsoKey(dayStart));
    });
    // Always consider yesterday to satisfy the contract.
    candidateDays.add(toIsoKey(addUtcDays(todayStart, -1)));

    await ensureDaySummaries(
        options,
        summaryMap,
        Array.from(candidateDays).map((key) => new Date(key)),
        now
    );
    await ensureWeekSummaries(options, summaryMap, now);
    await ensureMonthSummaries(options, summaryMap, now);

    const { systemMessages } = buildSystemMessages(summaryMap, now);

    return {
        systemMessages,
        recentMessages: filterRecentMessages(historyChain, now, forcedTailCount),
    };
};

