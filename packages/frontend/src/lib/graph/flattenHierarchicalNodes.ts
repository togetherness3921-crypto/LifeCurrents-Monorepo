export interface HierarchicalGraphNode {
    children?: Record<string, HierarchicalGraphNode> | null;
    [key: string]: unknown;
}

export type FlatGraphNode = Omit<HierarchicalGraphNode, 'children'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const toRecord = (value: unknown): Record<string, HierarchicalGraphNode> | null => {
    if (!isRecord(value)) {
        return null;
    }
    return value as Record<string, HierarchicalGraphNode>;
};

/**
 * Flattens a hierarchical node map (with nested `children`) into a flat record keyed by node id.
 *
 * The function performs a depth-first traversal, preserves the first encountered instance of each node,
 * and strips the `children` property from the returned nodes. The original input objects are never mutated.
 */
export const flattenHierarchicalNodes = (
    nodes: Record<string, HierarchicalGraphNode> | null | undefined
): Record<string, FlatGraphNode> => {
    if (!nodes) {
        return {};
    }

    const flatNodes: Record<string, FlatGraphNode> = {};
    const visited = new Set<string>();
    const stack: Array<[string, HierarchicalGraphNode]> = Object.entries(nodes);

    while (stack.length > 0) {
        const [nodeId, node] = stack.pop()!;
        if (typeof nodeId !== 'string' || nodeId.length === 0) {
            continue;
        }
        if (!isRecord(node)) {
            continue;
        }

        const { children, ...rest } = node;
        const nodeWithoutChildren: FlatGraphNode = { ...rest };

        if (visited.has(nodeId)) {
            const existing = flatNodes[nodeId];
            if (existing && JSON.stringify(existing) !== JSON.stringify(nodeWithoutChildren)) {
                console.warn(
                    `[GraphFlatten] Duplicate node id '${nodeId}' encountered with differing content. Keeping first instance.`
                );
            }
            continue;
        }

        visited.add(nodeId);
        flatNodes[nodeId] = nodeWithoutChildren;

        const childRecord = toRecord(children);
        if (childRecord) {
            for (const entry of Object.entries(childRecord)) {
                stack.push(entry);
            }
        }
    }

    return flatNodes;
};

/**
 * Counts the number of unique nodes present within a hierarchical node map.
 */
export const countHierarchicalNodes = (nodes: Record<string, HierarchicalGraphNode> | null | undefined): number => {
    if (!nodes) {
        return 0;
    }

    let count = 0;
    const visited = new Set<string>();
    const stack: Array<[string, HierarchicalGraphNode]> = Object.entries(nodes);

    while (stack.length > 0) {
        const [nodeId, node] = stack.pop()!;
        if (typeof nodeId !== 'string' || nodeId.length === 0) {
            continue;
        }
        if (!isRecord(node) || visited.has(nodeId)) {
            continue;
        }

        visited.add(nodeId);
        count += 1;

        const childRecord = toRecord(node.children);
        if (childRecord) {
            for (const entry of Object.entries(childRecord)) {
                stack.push(entry);
            }
        }
    }

    return count;
};
