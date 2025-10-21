export type SummaryLevel = 'DAY' | 'WEEK' | 'MONTH';

export interface ConversationSummaryRecord {
    id: string;
    thread_id: string;
    summary_level: SummaryLevel;
    summary_period_start: string;
    content: string;
    created_by_message_id: string;
    created_at?: string;
}
