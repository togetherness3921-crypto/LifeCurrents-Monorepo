import { ToolExecutionResult } from './types';

export interface GraphToolPayload {
    result?: any;
    graph_document_version_id?: string | null;
    default_graph_document_version_id?: string | null;
    was_created_now?: boolean;
    [key: string]: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const parseGraphToolResult = (
    result: ToolExecutionResult | null | undefined
): GraphToolPayload => {
    if (!result) {
        return {};
    }

    const payload: GraphToolPayload = {};
    let structured = result.structuredContent;

    if (isRecord(structured)) {
        Object.assign(payload, structured);
    } else if (Array.isArray(structured)) {
        // Some MCP servers may return an array of content items; search for an object payload.
        const firstObject = structured.find((item) => isRecord(item));
        if (firstObject) {
            Object.assign(payload, firstObject);
        }
    }

    if (Object.keys(payload).length === 0) {
        const content = result.content;
        if (typeof content === 'string') {
            try {
                const parsed = JSON.parse(content);
                if (isRecord(parsed)) {
                    Object.assign(payload, parsed);
                }
            } catch {
                // Ignore parse errors; caller can use raw content if needed.
            }
        } else if (isRecord(content)) {
            Object.assign(payload, content);
        }
    }

    return payload;
};

