import type { ConversationContextConfig } from './chatProviderContext';

export const DEFAULT_SUMMARY_PROMPT = `You are LifeCurrents' memory summarizer. Capture the essential facts, decisions, open questions, and commitments from the provided conversation context. Focus on actionable items and references to graph objectives. Keep the summary concise and organized.`;

export const DEFAULT_MODEL_ID = 'google/gemini-2.5-pro';

export const DEFAULT_CONTEXT_CONFIG: ConversationContextConfig = {
    mode: 'all-middle-out',
    customMessageCount: 20,
    summaryPrompt: DEFAULT_SUMMARY_PROMPT,
    forcedRecentMessages: 20, // Keep last 20 messages regardless of date for compression
};
