// This service will handle API calls to OpenRouter

const OPEN_ROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY;
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODELS_API_URL = "https://openrouter.ai/api/v1/models";

export interface ApiToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export type ApiMessage =
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string; tool_calls?: ApiToolCall[] }
    | { role: 'tool'; tool_call_id: string; content: string };

export interface ApiToolDefinition {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
    };
}

export interface ToolCallDelta {
    id: string;
    name?: string;
    arguments?: string;
    index?: number;
    status: 'start' | 'arguments' | 'finish';
}

interface StreamCallbacks {
    onStream?: (update: { content?: string; reasoning?: string; toolCall?: ToolCallDelta }) => void;
    signal?: AbortSignal;
    stream?: boolean;
}

export interface GeminiResponse {
    content: string;
    reasoning?: string;
    raw: unknown;
}

export interface ModelInfo {
    id: string;
    name: string;
    description?: string;
}

export type ToolIntent = 'TOOL' | 'CONVERSATION';

export const getAvailableModels = async (): Promise<ModelInfo[]> => {
    if (!OPEN_ROUTER_API_KEY) {
        throw new Error("VITE_OPENROUTER_API_KEY is not set in .env file");
    }

    const response = await fetch(MODELS_API_URL, {
        headers: {
            Authorization: `Bearer ${OPEN_ROUTER_API_KEY}`,
        },
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    const data = await response.json();
    const models = data?.data;

    if (!Array.isArray(models)) {
        return [];
    }

    return models.map((model) => ({
        id: model?.id,
        name: model?.name ?? model?.id,
        description: model?.description,
    })).filter((model) => typeof model.id === 'string' && model.id.length > 0);
};

const extractMessageContent = (content: unknown): string => {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map((item) => {
                if (typeof item === 'string') return item;
                if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
                    return item.text;
                }
                return '';
            })
            .join(' ');
    }
    if (content && typeof content === 'object' && 'text' in content && typeof (content as { text?: unknown }).text === 'string') {
        return (content as { text: string }).text;
    }
    return '';
};

export const getToolIntent = async (userQuery: string): Promise<ToolIntent> => {
    if (!OPEN_ROUTER_API_KEY) {
        throw new Error("VITE_OPENROUTER_API_KEY is not set in .env file");
    }

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${OPEN_ROUTER_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'google/gemini-2.5-pro-flash',
                stream: false,
                messages: [
                    {
                        role: 'system',
                        content:
                            'You are an expert at classifying user intent. The user has access to specialized tools for interacting with a personal knowledge graph. Your only job is to determine if the user\'s query requires one of these specialized tools or if it is a general conversational query. Respond with ONLY the single word `TOOL` if a specialized tool is needed, or the single word `CONVERSATION` if it is a general knowledge question, statement, or command.',
                    },
                    { role: 'user', content: userQuery },
                ],
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Failed to classify intent: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const data = await response.json();
        const choice = data?.choices?.[0];
        const content = extractMessageContent(choice?.message?.content);
        const normalized = content?.trim().toUpperCase();

        if (normalized === 'TOOL' || normalized === 'CONVERSATION') {
            return normalized;
        }

        console.warn('[OpenRouter] Unexpected tool intent response:', content);
        return 'TOOL';
    } catch (error) {
        console.warn('[OpenRouter] Tool intent classification failed, defaulting to TOOL mode.', error);
        return 'TOOL';
    }
};

export const getGeminiResponse = async (
    messages: ApiMessage[],
    {
        onStream,
        signal,
        tools,
        model,
        transforms,
        stream = true,
    }: StreamCallbacks & { tools?: ApiToolDefinition[]; model: string; transforms?: string[] }
): Promise<GeminiResponse> => {
    if (!OPEN_ROUTER_API_KEY) {
        throw new Error("VITE_OPENROUTER_API_KEY is not set in .env file");
    }

    const makeRequest = async () => {
        const payload: Record<string, unknown> = {
            model,
            messages,
            stream,
            reasoning: {
                effort: 'high',
                enabled: true,
            },
        };

        if (tools) {
            payload.tools = tools;
        }

        if (transforms && transforms.length > 0) {
            payload.transforms = transforms;
        }

        return fetch(API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPEN_ROUTER_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal,
        });
    };

    try {
        const response = await makeRequest();

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        if (!stream) {
            const data = await response.json();
            const finalMessage = data?.choices?.[0]?.message;
            const finalContent = extractMessageContent(finalMessage?.content);
            const finalReasoning = extractMessageContent(finalMessage?.reasoning);

            if (onStream) {
                if (finalContent) {
                    onStream({ content: finalContent });
                }
                if (finalReasoning) {
                    onStream({ reasoning: finalReasoning });
                }
            }

            return {
                content: finalContent,
                reasoning: finalReasoning,
                raw: data,
            };
        }

        if (!response.body) {
            const errorBody = await response.text();
            throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = "";
        let reasoningBuffer = "";
        let rawResponse: any = null;
        let encounteredStreamedToolCall = false;
        let stopStreaming = false;
        let streamBuffer = '';

        while (!stopStreaming) {
            const { done, value } = await reader.read();
            if (done) break;

            if (!value) {
                continue;
            }

            const chunk = decoder.decode(value, { stream: true });
            streamBuffer += chunk;
            const lines = streamBuffer.split('\n');
            streamBuffer = lines.pop() ?? '';
            for (const line of lines.filter(Boolean)) {
                const jsonStr = line.replace('data: ', '');
                if (jsonStr === '[DONE]') {
                    stopStreaming = true;
                    break;
                }
                try {
                    const parsed = JSON.parse(jsonStr);
                    rawResponse = parsed; // This will be the last chunk
                    const delta = parsed.choices?.[0]?.delta;
                    const content = delta?.content;
                    const reasoning = delta?.reasoning;
                    const toolCallDeltas = delta?.tool_calls;

                    if (content) {
                        fullResponse += content;
                        onStream?.({ content: fullResponse });
                    }
                    if (reasoning) {
                        reasoningBuffer += reasoning;
                        onStream?.({ reasoning: reasoningBuffer });
                    }
                    if (toolCallDeltas && Array.isArray(toolCallDeltas) && toolCallDeltas.length > 0) {
                        encounteredStreamedToolCall = true;
                        stopStreaming = true;
                        break;
                    }
                } catch (e) {
                    console.error("Error parsing stream chunk:", e);
                }
            }
        }

        if (encounteredStreamedToolCall) {
            try {
                await reader.cancel();
            } catch (cancelError) {
                console.warn('Failed to cancel streaming reader after detecting tool call:', cancelError);
            }

            return await getGeminiResponse(messages, {
                onStream,
                signal,
                tools,
                model,
                transforms,
                stream: false,
            });
        }

        return { content: fullResponse, reasoning: reasoningBuffer, raw: rawResponse };

    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            console.warn('Streaming request aborted by user.');
            return { content: '', reasoning: '', raw: null };
        }
        console.error("Error fetching from OpenRouter:", error);
        throw error;
    }
};

export const getTitleSuggestion = async (messages: ApiMessage[]): Promise<string | null> => {
    if (!OPEN_ROUTER_API_KEY) {
        throw new Error("VITE_OPENROUTER_API_KEY is not set in .env file");
    }

    const conversationText = messages
        .map((m) => `${m.role.toUpperCase()}: ${'content' in m ? m.content : ''}`)
        .join('\n');

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPEN_ROUTER_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: "google/gemini-2.5-pro",
                messages: [
                    {
                        role: 'system',
                        content:
                            'You are a helpful assistant that generates concise, descriptive titles (max 6 words) for chat conversations. Respond with only the title.',
                    },
                    {
                        role: 'user',
                        content: `Conversation:\n${conversationText}\n\nProvide only the title.`,
                    },
                ],
                stream: false,
                reasoning: {
                    effort: 'high',
                    enabled: true,
                },
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const data = await response.json();
        const title = data.choices?.[0]?.message?.content?.trim();
        if (!title) return null;
        return title.length > 60 ? title.slice(0, 57) + '...' : title;
    } catch (error) {
        console.error('Title suggestion failed:', error);
        return null;
    }
};
