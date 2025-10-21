import type { ToolCallCompressionSummary, ToolCallState } from '@/hooks/chatProviderContext';

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

type ParsedArguments = Record<string, unknown> | JsonValue;

const ensureSentence = (input: string): string => {
    const trimmed = input.trim();
    if (!trimmed) {
        return '';
    }
    return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
};

const capitalize = (input: string): string => {
    if (!input) {
        return input;
    }
    return input[0].toUpperCase() + input.slice(1);
};

const pluralize = (count: number, singular: string, plural?: string): string => {
    if (count === 1) {
        return singular;
    }
    if (plural) {
        return plural;
    }
    return `${singular}s`;
};

const safeParseArguments = (rawArguments: ToolCallState['arguments']): ParsedArguments | undefined => {
    if (typeof rawArguments !== 'string') {
        return undefined;
    }
    const trimmed = rawArguments.trim();
    if (!trimmed) {
        return undefined;
    }
    try {
        return JSON.parse(trimmed) as ParsedArguments;
    } catch {
        return undefined;
    }
};

const summarisePatchGraphDocument = (
    toolCall: ToolCallState,
    status: ToolCallCompressionSummary['status'],
    parsedArgs: ParsedArguments | undefined
): string => {
    const patches = Array.isArray((parsedArgs as Record<string, unknown> | undefined)?.patches)
        ? ((parsedArgs as Record<string, unknown>).patches as unknown[])
        : [];

    let nodeAdds = 0;
    let nodeRemovals = 0;
    let nodeFieldChanges = 0;
    let otherChanges = 0;

    patches.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
            otherChanges += 1;
            return;
        }
        const patch = entry as { op?: unknown; path?: unknown };
        const op = typeof patch.op === 'string' ? patch.op.toLowerCase() : 'unknown';
        const path = typeof patch.path === 'string' ? patch.path : '';
        const isNodePath = path.startsWith('/nodes/');
        const isNodeRoot = /^\/nodes\/[\w-]+$/.test(path);

        if (op === 'add' && isNodeRoot) {
            nodeAdds += 1;
            return;
        }
        if (op === 'remove' && isNodeRoot) {
            nodeRemovals += 1;
            return;
        }
        if (isNodePath && ['add', 'remove', 'replace', 'move', 'copy'].includes(op)) {
            nodeFieldChanges += 1;
            return;
        }
        if (['test', 'unknown'].includes(op)) {
            return;
        }
        otherChanges += 1;
    });

    const detailParts: string[] = [];
    if (nodeAdds > 0) {
        detailParts.push(`added ${nodeAdds} ${pluralize(nodeAdds, 'node')}`);
    }
    if (nodeRemovals > 0) {
        detailParts.push(`removed ${nodeRemovals} ${pluralize(nodeRemovals, 'node')}`);
    }
    if (nodeFieldChanges > 0) {
        detailParts.push(`updated ${nodeFieldChanges} node field${nodeFieldChanges === 1 ? '' : 's'}`);
    }
    if (otherChanges > 0) {
        detailParts.push(`applied ${otherChanges} other change${otherChanges === 1 ? '' : 's'}`);
    }

    if (detailParts.length === 0 && patches.length > 0) {
        const changeWord = pluralize(patches.length, 'change');
        detailParts.push(`queued ${patches.length} ${changeWord}`);
    }

    let base: string;
    switch (status) {
        case 'error': {
            const errorText = typeof toolCall.error === 'string' && toolCall.error.trim().length > 0
                ? toolCall.error.trim()
                : 'Graph patch failed';
            base = errorText.startsWith('Graph patch failed') ? errorText : `Graph patch failed: ${errorText}`;
            break;
        }
        case 'running':
            base = 'Graph patch in progress';
            break;
        case 'pending':
            base = 'Graph patch requested';
            break;
        default:
            base = 'Graph patched successfully';
            break;
    }

    let detailSentence = '';
    if (detailParts.length > 0) {
        const [first, ...rest] = detailParts;
        const formatted = [capitalize(first), ...rest];
        detailSentence = `${formatted.join(', ')}.`;
    } else if (status === 'success') {
        detailSentence = 'No structural changes were recorded.';
    }

    const baseSentence = ensureSentence(base);
    return detailSentence ? `${baseSentence} ${detailSentence}` : baseSentence;
};

const summariseGenericTool = (
    toolName: string,
    status: ToolCallCompressionSummary['status'],
    parsedArgs: ParsedArguments | undefined,
    error?: string
): string => {
    let base: string;
    switch (status) {
        case 'error': {
            const errorText = error && error.trim().length > 0 ? error.trim() : 'Tool execution failed';
            base = errorText.startsWith(toolName) ? errorText : `${toolName} failed: ${errorText}`;
            break;
        }
        case 'running':
            base = `${toolName} is in progress`;
            break;
        case 'pending':
            base = `${toolName} was requested`;
            break;
        default:
            base = `${toolName} completed successfully`;
            break;
    }

    let argumentSummary = '';
    if (parsedArgs && typeof parsedArgs === 'object' && !Array.isArray(parsedArgs)) {
        const keys = Object.keys(parsedArgs);
        if (keys.length > 0) {
            const preview = keys.slice(0, 5).join(', ');
            const suffix = keys.length > 5 ? ', …' : '';
            argumentSummary = `Arguments: ${preview}${suffix}`;
        }
    }

    const sentences = [ensureSentence(base)];
    if (argumentSummary) {
        sentences.push(ensureSentence(argumentSummary));
    }
    return sentences.join(' ');
};

export const generateToolCallCompressionSummary = (
    toolCall: ToolCallState
): ToolCallCompressionSummary | null => {
    if (!toolCall) {
        return null;
    }

    const toolName = toolCall.name && toolCall.name.trim().length > 0 ? toolCall.name.trim() : 'tool';
    const status = (toolCall.status ?? 'success') as ToolCallCompressionSummary['status'];
    const parsedArgs = safeParseArguments(toolCall.arguments);

    let outcome: string;
    if (toolName === 'patch_graph_document') {
        outcome = summarisePatchGraphDocument(toolCall, status, parsedArgs);
    } else {
        outcome = summariseGenericTool(toolName, status, parsedArgs, toolCall.error ?? undefined);
    }

    return {
        status,
        outcome,
        tool: toolName,
    };
};
