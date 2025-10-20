import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Node, Edge } from '@xyflow/react';
import { computePositions } from '@/services/layoutEngine';
import { getNodeBoxWidth, getNodeBoxHeight } from '@/services/nodeRenderConfig';
import { initTextMeasurer } from '@/services/textMeasure';
import { useTodayTime } from './useTodayTime';
import { graphDocumentChannel } from '@/state/graphDocumentChannel';
import { startOfDay as startOfDayFn, endOfDay as endOfDayFn } from 'date-fns';

type GraphStatus = 'not-started' | 'in-progress' | 'completed' | 'complete' | 'blocked' | string;

interface HierarchyNode extends Record<string, any> {
  id: string;
  type: string;
  label: string;
  status: GraphStatus;
  parents: string[];
  graph: string;
  children: HierarchyNode[];
}

interface NormalizedGraphDocument {
  roots: HierarchyNode[];
  nodesById: Record<string, HierarchyNode>;
  viewport?: { x: number; y: number; zoom: number };
  historical_progress?: Record<string, any>;
  metadata?: Record<string, any>;
}

const ensureGraphId = (value: unknown): string => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return 'main';
};

const deepCopy = <T>(value: T): T => {
  if (value === undefined || value === null) {
    return value;
  }
  try {
    if (typeof (globalThis as any).structuredClone === 'function') {
      return (globalThis as any).structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
};

const normalizeNode = (id: string, node: any): HierarchyNode => {
  const {
    children,
    id: _ignored,
    parents,
    graph,
    type,
    label,
    status,
    ...rest
  } = node || {};

  return {
    id,
    type: typeof type === 'string' ? type : 'objectiveNode',
    label: typeof label === 'string' ? label : id,
    status: (typeof status === 'string' ? status : 'not-started') as GraphStatus,
    parents: Array.isArray(parents) ? parents.map(String) : [],
    graph: ensureGraphId(graph),
    children: [],
    ...rest,
  };
};

const cloneHierarchyNodes = (nodes: any[], index: Record<string, HierarchyNode>): HierarchyNode[] => {
  const result: HierarchyNode[] = [];
  (nodes ?? []).forEach((node) => {
    if (!node) return;
    const rawId = node.id ?? node?.data?.id;
    if (rawId === undefined || rawId === null) return;
    const id = String(rawId);
    const normalized = normalizeNode(id, node);
    const cloned: HierarchyNode = {
      ...normalized,
      parents: [...normalized.parents],
      children: [],
    };
    index[id] = cloned;
    const childArray = Array.isArray(node.children) ? node.children : [];
    cloned.children = cloneHierarchyNodes(childArray, index);
    result.push(cloned);
  });
  return result;
};

const buildHierarchyFromFlat = (nodes: Record<string, any>): NormalizedGraphDocument => {
  const index: Record<string, HierarchyNode> = {};
  Object.entries(nodes ?? {}).forEach(([id, value]) => {
    const normalized = normalizeNode(id, value);
    index[id] = {
      ...normalized,
      parents: [...normalized.parents],
      children: [],
    };
  });

  const roots: HierarchyNode[] = [];
  Object.values(index).forEach((node) => {
    const graphId = ensureGraphId(node.graph);
    if (graphId === 'main' || !index[graphId]) {
      roots.push(node);
    } else {
      index[graphId].children.push(node);
    }
  });

  return {
    roots,
    nodesById: index,
  };
};

const normalizeGraphDocument = (document: any): NormalizedGraphDocument => {
  if (!document) {
    return { roots: [], nodesById: {}, metadata: {} };
  }

  const {
    nodes,
    hierarchy,
    roots,
    children,
    viewport,
    historical_progress,
    nodesById: _ignoredNodesById,
    metadata: existingMetadata,
    ...metadata
  } = document;

  const nodeIndex: Record<string, HierarchyNode> = {};
  let rootNodes: HierarchyNode[] = [];

  if (Array.isArray(hierarchy)) {
    rootNodes = cloneHierarchyNodes(hierarchy, nodeIndex);
  } else if (Array.isArray(roots)) {
    rootNodes = cloneHierarchyNodes(roots, nodeIndex);
  } else if (Array.isArray(children)) {
    rootNodes = cloneHierarchyNodes(children, nodeIndex);
  } else if (Array.isArray(nodes)) {
    rootNodes = cloneHierarchyNodes(nodes, nodeIndex);
  } else if (nodes && typeof nodes === 'object') {
    // New logic: Check if the object is already hierarchical (i.e., top-level keys have children)
    const topLevelNodes = Object.entries(nodes as Record<string, any>);
    const isHierarchical = topLevelNodes.some(
      ([_id, node]) => node && typeof node === 'object' && 'children' in node
    );

    if (isHierarchical) {
      // It's already nested, we need to clone it properly.
      // We can't use cloneHierarchyNodes directly as it expects an array.
      const tempRoots: HierarchyNode[] = [];
      topLevelNodes.forEach(([id, nodeData]) => {
        const normalized = normalizeNode(id, nodeData);
        nodeIndex[id] = normalized;

        const cloneWithChildren = (n: any, nId: string): HierarchyNode => {
          const clonedNode = normalizeNode(nId, n);
          nodeIndex[nId] = clonedNode;
          if (n.children && typeof n.children === 'object') {
            clonedNode.children = Object.entries(n.children).map(([childId, childNode]) =>
              cloneWithChildren(childNode, childId)
            );
          }
          return clonedNode;
        };
        tempRoots.push(cloneWithChildren(nodeData, id));
      });
      rootNodes = tempRoots;
    } else {
      // It's a flat map, build the hierarchy as before.
      const flatResult = buildHierarchyFromFlat(nodes as Record<string, any>);
      rootNodes = flatResult.roots;
      Object.assign(nodeIndex, flatResult.nodesById);
    }
  } else {
    rootNodes = [];
  }

  const mergedMetadata: Record<string, any> = {};
  if (existingMetadata && typeof existingMetadata === 'object' && !Array.isArray(existingMetadata)) {
    Object.entries(existingMetadata).forEach(([key, value]) => {
      if (key !== 'nodesById' && key !== 'roots') {
        mergedMetadata[key] = value;
      }
    });
  }
  Object.entries(metadata).forEach(([key, value]) => {
    if (key !== 'nodesById' && key !== 'roots') {
      mergedMetadata[key] = value;
    }
  });

  return {
    roots: rootNodes,
    nodesById: nodeIndex,
    viewport: viewport
      ? {
        x: Number((viewport as any).x ?? 0),
        y: Number((viewport as any).y ?? 0),
        zoom: Number((viewport as any).zoom ?? 1),
      }
      : undefined,
    historical_progress: historical_progress ? deepCopy(historical_progress) : undefined,
    metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
  };
};

const filterHierarchy = (
  nodes: HierarchyNode[],
  predicate: (node: HierarchyNode) => boolean
): HierarchyNode[] => {
  const result: HierarchyNode[] = [];
  nodes.forEach((node) => {
    const filteredChildren = filterHierarchy(node.children ?? [], predicate);
    const includeSelf = predicate(node);
    if (includeSelf || filteredChildren.length > 0) {
      result.push({ ...node, children: filteredChildren });
    }
  });
  return result;
};

const findNodeInHierarchy = (nodes: HierarchyNode[], targetId: string): HierarchyNode | null => {
  for (const node of nodes) {
    if (node.id === targetId) {
      return node;
    }
    const childResult = findNodeInHierarchy(node.children ?? [], targetId);
    if (childResult) {
      return childResult;
    }
  }
  return null;
};

const collectNodesForGraph = (
  roots: HierarchyNode[],
  activeGraphId: string
): HierarchyNode[] => {
  if (activeGraphId === 'main') {
    return roots;
  }
  const target = findNodeInHierarchy(roots, activeGraphId);
  return target ? target.children : [];
};

const cloneGraphDocument = (doc: NormalizedGraphDocument): NormalizedGraphDocument => {
  const nodeIndex: Record<string, HierarchyNode> = {};
  const cloneNode = (node: HierarchyNode): HierarchyNode => {
    const clonedChildren = node.children.map(cloneNode);
    const clonedNode: HierarchyNode = {
      ...node,
      parents: [...node.parents],
      children: clonedChildren,
    };
    nodeIndex[node.id] = clonedNode;
    return clonedNode;
  };

  const roots = doc.roots.map(cloneNode);

  return {
    roots,
    nodesById: nodeIndex,
    viewport: doc.viewport ? { ...doc.viewport } : undefined,
    historical_progress: doc.historical_progress ? deepCopy(doc.historical_progress) : undefined,
    metadata: doc.metadata ? deepCopy(doc.metadata) : undefined,
  };
};

const serializeGraphDocument = (doc: NormalizedGraphDocument): any => {
  const nodes: Record<string, any> = {};
  const stack = [...doc.roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const { children, id, parents, graph, ...rest } = node;
    nodes[id] = {
      ...rest,
      parents: [...parents],
      graph,
    };
    if (children?.length) {
      stack.push(...children);
    }
  }

  const serialized: Record<string, any> = {
    nodes,
  };

  if (doc.viewport) {
    serialized.viewport = { ...doc.viewport };
  }
  if (doc.historical_progress) {
    serialized.historical_progress = doc.historical_progress;
  }
  if (doc.metadata) {
    Object.assign(serialized, doc.metadata);
  }

  return serialized;
};

const buildHierarchyMap = (nodesData: any, completedNodeIds: Set<string> = new Set()) => {
  const logPrefix = '[LayoutEngine/buildHierarchyMap]';
  console.log(`${logPrefix} Running for ${Object.keys(nodesData).length} nodes.`);

  const levels: { [level: number]: string[] } = {};
  const nodeToLevel: { [nodeId: string]: number } = {};
  const nodeIdsInCurrentGraph = new Set(Object.keys(nodesData));

  // This iterative approach correctly finds the longest path to each node,
  // ensuring that siblings with different length paths leading to them are still
  // placed in the correct, furthest column. This calculates levels from R-to-L.
  const rightToLeftLevels: { [nodeId: string]: number } = {};
  let changedInPass = true;
  let iterations = 0;
  const maxIterations = Object.keys(nodesData).length + 5; // Safety break

  while (changedInPass && iterations < maxIterations) {
    changedInPass = false;
    Object.keys(nodesData).forEach(nodeId => {
      const parents = (nodesData[nodeId]?.parents || []).filter((pId: string) => nodeIdsInCurrentGraph.has(pId));

      let maxParentLevel = -1;
      // A node's level is 0 if it has no parents in the current graph.
      // Otherwise, it's 1 + the maximum level of its parents.
      if (parents.length > 0) {
        parents.forEach((pId: string) => {
          if (rightToLeftLevels[pId] !== undefined) {
            maxParentLevel = Math.max(maxParentLevel, rightToLeftLevels[pId]);
          }
        });
      }

      const newLevel = maxParentLevel + 1;
      if (rightToLeftLevels[nodeId] !== newLevel) {
        rightToLeftLevels[nodeId] = newLevel;
        changedInPass = true;
      }
    });
    iterations++;
  }

  // Now, we invert the R-to-L levels to get the correct L-to-R layout.
  const maxLevel = Math.max(0, ...Object.values(rightToLeftLevels));
  Object.entries(rightToLeftLevels).forEach(([nodeId, rtlLevel]) => {
    const finalLevel = maxLevel - rtlLevel;
    nodeToLevel[nodeId] = finalLevel;
    if (!levels[finalLevel]) levels[finalLevel] = [];
    levels[finalLevel].push(nodeId);
  });

  // Filter out columns that only contain completed nodes for counting purposes
  const activeLevels = Object.entries(levels).filter(([, nodeIds]) =>
    !nodeIds.every(id => completedNodeIds.has(id))
  );

  console.log(`${logPrefix} Final Levels (raw):`, levels);
  console.log(`${logPrefix} Active Column Count: ${activeLevels.length}`);

  return { levels, nodeToLevel, activeColumnCount: activeLevels.length };
};

export function useGraphData(selectedStartOfDay?: Date, selectedEndOfDay?: Date) {
  const { dayKey, startOfDay, endOfDay } = useTodayTime();
  const effectiveStartOfDay = selectedStartOfDay ?? startOfDay;
  const effectiveEndOfDay = selectedEndOfDay ?? endOfDay;
  const [docData, setDocData] = useState<NormalizedGraphDocument | null>(null);
  const [activeGraphId, setActiveGraphId] = useState<string>('main');
  const [loading, setLoading] = useState(true);
  const [viewportState, setViewportState] = useState({ x: 0, y: 0, zoom: 1 });
  const [positions, setPositions] = useState<Record<string, { x: number, y: number }>>({});
  const [filterToSelectedDay, setFilterToSelectedDay] = useState(true);

  const toggleFilterToSelectedDay = useCallback(() => {
    setFilterToSelectedDay((prev) => !prev);
  }, []);

  const filteredHierarchy = useMemo(() => {
    if (!docData) {
      return [] as HierarchyNode[];
    }
    if (!filterToSelectedDay) {
      return docData.roots;
    }
    const startMs = effectiveStartOfDay.getTime();
    const endMs = effectiveEndOfDay.getTime();
    return filterHierarchy(docData.roots, (node) => {
      const scheduledStart = node?.scheduled_start;
      if (!scheduledStart) return true;
      const scheduledStartMs = Date.parse(scheduledStart);
      if (Number.isNaN(scheduledStartMs)) return true;
      return scheduledStartMs >= startMs && scheduledStartMs <= endMs;
    });
  }, [docData, filterToSelectedDay, effectiveStartOfDay, effectiveEndOfDay]);

  const effectiveStartMs = effectiveStartOfDay.getTime();
  const effectiveEndMs = effectiveEndOfDay.getTime();

  const activeNodesRef = useRef<Record<string, HierarchyNode>>({});

  const { nodes, edges } = useMemo(() => {
    if (!docData) {
      activeNodesRef.current = {};
      return { nodes: [], edges: [] };
    }

    const hierarchyForView = filteredHierarchy.length > 0 || filterToSelectedDay
      ? filteredHierarchy
      : docData.roots;
    const graphNodes = collectNodesForGraph(hierarchyForView, activeGraphId);

    if (!graphNodes || graphNodes.length === 0) {
      activeNodesRef.current = {};
      return { nodes: [], edges: [] };
    }

    const activeMap: Record<string, HierarchyNode> = {};
    graphNodes.forEach((node) => {
      activeMap[node.id] = node;
    });
    activeNodesRef.current = activeMap;

    const transformedNodes: Node[] = graphNodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: positions[node.id] || { x: 0, y: 0 },
      data: {
        label: node.label,
        status: node.status || 'not-started',
        parents: node.parents || [],
        graph: node.graph || 'main',
        color: node.color,
        children: (node.children || []).map((child) => ({
          id: child.id,
          label: child.label,
          status: child.status,
          color: child.color,
        })),
      },
    }));

    const nodeIdsInGraph = new Set(graphNodes.map(node => node.id));
    const transformedEdges: Edge[] = graphNodes
      .flatMap((node) =>
        (node.parents || []).map((parentId: string, idx: number) => ({
          id: `${node.id}-${parentId}-${idx}`,
          source: node.id,
          target: parentId,
          animated: true,
          style: {},
        }))
      )
      .filter((edge) => nodeIdsInGraph.has(edge.source) && nodeIdsInGraph.has(edge.target));

    console.log(`[LayoutEngine] Rendering graph '${activeGraphId}' with ${transformedNodes.length} nodes.`);
    return { nodes: transformedNodes, edges: transformedEdges };
  }, [docData, filteredHierarchy, filterToSelectedDay, activeGraphId, positions]);


  const [measuredNodes, setMeasuredNodes] = useState<{ [id: string]: { width: number; height: number } }>({});
  const [isFirstLayoutDone, setIsFirstLayoutDone] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const localOperationsRef = useRef(new Set<string>());
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const layoutRecalcTimerRef = useRef<any>(null);
  const didPostMeasureLayoutRef = useRef<boolean>(false);
  const measuredNodesRef = useRef(measuredNodes);
  const stabilizationTimerRef = useRef<any>(null);
  const lastStableSnapshotRef = useRef<{ [id: string]: { width: number; height: number } } | null>(null);

  const fetchGraphData = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch the single graph document
      const { data: docRow, error: docError } = await (supabase as any)
        .from('graph_documents')
        .select('data')
        .eq('id', 'main')
        .maybeSingle();

      if (docError) throw docError;
      const data = (docRow?.data as any) || {};
      const normalized = normalizeGraphDocument(data);
      setDocData(normalized);

      console.log('[Graph] Initial fetch complete. Active graph:', activeGraphId);

      const vp = normalized.viewport || { x: 0, y: 0, zoom: 1 };
      setViewportState({ x: Number(vp.x ?? 0), y: Number(vp.y ?? 0), zoom: Number(vp.zoom ?? 1) });
    } catch (error) {
      console.error('Error fetching graph data:', error);
    } finally {
      setLoading(false);
    }
  }, [activeGraphId]);
  const getActiveNodesData = useCallback(() => {
    return activeNodesRef.current || {};
  }, []);

  // The buildGraphForActiveId function is now replaced by the useMemo hook.

  const updateNodePosition = async (_nodeId: string, _x: number, _y: number) => {
    // No-op: positions are now 100% auto-calculated
    return;
  };

  const calculateHistory = (nodes: Record<string, any>) => {
    const parentToChildrenMap: Record<string, string[]> = {};
    Object.entries(nodes).forEach(([id, node]: [string, any]) => {
      if (node.parents) {
        node.parents.forEach((pId: string) => {
          if (!parentToChildrenMap[pId]) parentToChildrenMap[pId] = [];
          parentToChildrenMap[pId].push(id);
        });
      }
    });

    const endNodes = Object.keys(nodes).filter(id => !parentToChildrenMap[id] || parentToChildrenMap[id].length === 0);
    if (endNodes.length === 0) {
      console.warn("No end nodes found, cannot calculate absolute percentages.");
      return {};
    }
    const finalGoalValue = endNodes.reduce((sum, id) => sum + (nodes[id].percentage_of_parent || 100), 0);

    const memoAbs = new Map<string, number>();
    const getAbsolutePercentage = (nodeId: string): number => {
      if (memoAbs.has(nodeId)) return memoAbs.get(nodeId)!;

      let total = 0;
      if (endNodes.includes(nodeId)) {
        total = (nodes[nodeId].percentage_of_parent || 0) / finalGoalValue * 100;
      } else {
        const children = parentToChildrenMap[nodeId] || [];
        children.forEach(childId => {
          const nodePerc = nodes[nodeId].percentage_of_parent || 0;
          total += (getAbsolutePercentage(childId) * nodePerc) / 100;
        });
      }

      memoAbs.set(nodeId, total);
      return total;
    };

    const history: Record<string, any> = {};
    const completedNodeMap: Record<string, string[]> = {};
    const allCompletedNodes = Object.entries(nodes).filter(([, n]: [string, any]) => n.status === 'completed' && n.completed_at);

    allCompletedNodes.forEach(([id, node]: [string, any]) => {
      const dateKey = new Date(node.completed_at).toISOString().split('T')[0];
      if (!completedNodeMap[dateKey]) completedNodeMap[dateKey] = [];
      completedNodeMap[dateKey].push(id);
    });

    const sortedDates = Object.keys(completedNodeMap).sort();
    let cumulativeCompletedSet = new Set<string>();
    let lastTotal = 0;

    if (sortedDates.length > 0) {
      const firstDate = new Date(sortedDates[0]);
      let currentDate = new Date(firstDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      while (currentDate <= today) {
        const dateKey = currentDate.toISOString().split('T')[0];
        const nodesCompletedThisDay = completedNodeMap[dateKey] || [];
        nodesCompletedThisDay.forEach(id => cumulativeCompletedSet.add(id));

        const newTotal = Array.from(cumulativeCompletedSet).reduce((sum, id) => sum + getAbsolutePercentage(id), 0);

        history[dateKey] = {
          completed_nodes: nodesCompletedThisDay,
          total_percentage_complete: newTotal,
          daily_gain: newTotal - lastTotal,
        };

        lastTotal = newTotal;
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }
    return history;
  }

  const setNodeStatus = async (nodeId: string, targetStatus: 'not-started' | 'in-progress' | 'completed') => {
    if (!docData) return;
    try {
      const operationId = `set-status-${nodeId}-${Date.now()}`;
      localOperationsRef.current.add(operationId);

      const nextDoc = cloneGraphDocument(docData);
      const nodeMap = nextDoc.nodesById;

      if (!nodeMap[nodeId]) {
        throw new Error(`Node ${nodeId} not found in document`);
      }

      const nodesToUpdate: Record<string, any> = {};

      if (targetStatus === 'completed') {
        const parentToChildrenMap: Record<string, string[]> = {};
        Object.values(nodeMap).forEach((node) => {
          (node.parents || []).forEach((parentId: string) => {
            if (!parentToChildrenMap[parentId]) parentToChildrenMap[parentId] = [];
            parentToChildrenMap[parentId].push(node.id);
          });
        });

        const nodesToComplete = new Set<string>();
        const queue: string[] = [nodeId];

        while (queue.length > 0) {
          const currentId = queue.shift()!;
          const currentNode = nodeMap[currentId];
          if (!currentNode) continue;
          if (nodesToComplete.has(currentId) || currentNode.status === 'completed') {
            continue;
          }
          nodesToComplete.add(currentId);
          const children = parentToChildrenMap[currentId];
          if (children && Array.isArray(children)) {
            children.forEach((childId: string) => queue.push(childId));
          }
        }

        const completedAt = new Date().toISOString();
        nodesToComplete.forEach((id) => {
          nodesToUpdate[id] = { status: 'completed', completed_at: completedAt };
        });
      } else {
        nodesToUpdate[nodeId] = { status: targetStatus };
        if (nodeMap[nodeId]?.completed_at) {
          nodesToUpdate[nodeId].completed_at = null;
        }
      }

      Object.entries(nodesToUpdate).forEach(([id, updates]) => {
        const node = nodeMap[id];
        if (!node) return;
        Object.assign(node, updates);
        if (updates.completed_at === null) {
          delete node.completed_at;
        }
      });

      nextDoc.historical_progress = calculateHistory(nodeMap as Record<string, any>);

      setDocData(nextDoc);

      await calculateAutoLayout();

      const serialized = serializeGraphDocument(nextDoc);
      const { error } = await (supabase as any)
        .from('graph_documents')
        .update({ data: serialized })
        .eq('id', 'main');
      if (error) throw error;

      setTimeout(() => {
        localOperationsRef.current.delete(operationId);
      }, 1000);
    } catch (error) {
      console.error('Error setting node status:', error);
    }
  };

  const updateNodeCompletion = async (nodeId: string) => {
    try {
      // Determine new status from current doc using three-state model
      const current = docData?.nodesById?.[nodeId]?.status;
      let newStatus: 'not-started' | 'in-progress' | 'completed';
      if (current === 'in-progress') {
        newStatus = 'completed';
      } else if (current === 'completed' || current === 'complete') {
        newStatus = 'not-started';
      } else {
        newStatus = 'in-progress';
      }

      // Delegate the actual update to setNodeStatus to ensure cascading logic is applied
      await setNodeStatus(nodeId, newStatus);
    } catch (error) {
      console.error('Error updating node completion:', error);
    }
  };

  const deleteNode = async (nodeId: string) => {
    if (!docData) return;
    try {
      const nextDoc = cloneGraphDocument(docData);
      const nodeMap = nextDoc.nodesById;
      if (!nodeMap[nodeId]) {
        throw new Error(`Node ${nodeId} not found in document`);
      }

      const parentToChildrenMap: Record<string, string[]> = {};
      Object.values(nodeMap).forEach((node) => {
        (node.parents || []).forEach((parentId: string) => {
          if (!parentToChildrenMap[parentId]) parentToChildrenMap[parentId] = [];
          parentToChildrenMap[parentId].push(node.id);
        });
      });

      const nodesToDelete = new Set<string>();
      const queue: string[] = [nodeId];
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (nodesToDelete.has(currentId)) continue;
        nodesToDelete.add(currentId);
        const children = parentToChildrenMap[currentId] || [];
        children.forEach((childId) => queue.push(childId));
      }

      nodesToDelete.forEach((id) => {
        delete nodeMap[id];
      });

      const pruneChildren = (nodes: HierarchyNode[]): HierarchyNode[] => {
        return nodes
          .filter((node) => !nodesToDelete.has(node.id))
          .map((node) => {
            node.children = pruneChildren(node.children);
            return node;
          });
      };

      nextDoc.roots = pruneChildren(nextDoc.roots);

      Object.values(nodeMap).forEach((node) => {
        node.parents = (node.parents || []).filter((parentId: string) => !nodesToDelete.has(parentId));
      });

      setDocData(nextDoc);

      const serialized = serializeGraphDocument(nextDoc);
      const { error } = await (supabase as any)
        .from('graph_documents')
        .update({ data: serialized })
        .eq('id', 'main');
      if (error) throw error;

      await calculateAutoLayout();
    } catch (error) {
      console.error('Error deleting node:', error);
    }
  };

  // Deprecated: active node removed. Keep a no-op for compatibility.
  const updateActiveNode = async (_nodeId: string | null) => {
    setActiveNodeId(null);
    return;
  };

  const updateViewportState = async (x: number, y: number, zoom: number) => {
    if (!docData) return;
    try {
      const newViewportState = { x, y, zoom };
      setViewportState(newViewportState);
      console.log('[Viewport] updateViewportState', newViewportState);

      const nextDoc: NormalizedGraphDocument = {
        ...docData,
        viewport: { x, y, zoom },
      };
      setDocData(nextDoc);

      const serialized = serializeGraphDocument(nextDoc);
      const { error } = await (supabase as any)
        .from('graph_documents')
        .update({ data: serialized })
        .eq('id', 'main');

      if (error) throw error;
    } catch (error) {
      console.error('Error updating viewport state:', error);
    }
  };

  // Auto-layout configuration
  const GAP_DISTANCE = 150; // Fixed gap between slice edges (right edge of previous, left edge of next)
  const VERTICAL_NODE_SPACING = 120;
  const MEASUREMENT_EPSILON = 0.5; // flow units (~px in flow coords)
  const MAX_SANE_WIDTH = 500; // ignore pre-fit oversized mobile measurements
  const MAX_SANE_HEIGHT = 300;

  // Estimators using canvas-based measurement and config
  const getNodeWidth = useCallback((nodeId: string, label: string) => {
    const nodeType = (docData?.nodesById?.[nodeId]?.type) || 'objectiveNode';
    return getNodeBoxWidth(nodeType, label || '');
  }, [docData?.nodesById]);
  const getNodeHeight = useCallback((nodeId: string) => {
    const measuredH = measuredNodes[nodeId]?.height;
    if (typeof measuredH === 'number' && measuredH > 0) return measuredH;
    const nodeType = (docData?.nodesById?.[nodeId]?.type) || 'objectiveNode';
    return getNodeBoxHeight(nodeType);
  }, [docData?.nodesById, measuredNodes]);

  // Keep a ref to measuredNodes for timers/RAF checks
  useEffect(() => {
    measuredNodesRef.current = measuredNodes;
  }, [measuredNodes]);

  // buildHierarchyMap moved to module scope

  const calculateSlicePositions = (levels: { [level: number]: string[] }, nodesData: any) => {
    const slices: { [level: number]: { leftmost: number; rightmost: number; midpoint: number; width: number } } = {};

    // Determine slice widths (max node width per slice)
    const sortedLevels = Object.keys(levels).map(Number).sort((a, b) => a - b);
    const sliceWidths: { [level: number]: number } = {};
    for (const level of sortedLevels) {
      const nodeIds = levels[level];
      let maxWidth = 0;
      nodeIds.forEach(nodeId => {
        const width = getNodeWidth(nodeId, nodesData[nodeId].label);
        maxWidth = Math.max(maxWidth, width);
      });
      sliceWidths[level] = maxWidth;
    }

    // Calculate slice midpoints using the required formula:
    // nextMid = prevMid + (prevWidth/2) + GAP_DISTANCE + (nextWidth/2)
    sortedLevels.forEach((level, index) => {
      const width = sliceWidths[level] || 0;
      let midpoint = 0;
      if (index === 0) {
        // Anchor first slice midpoint at 0 for determinism
        midpoint = 0;
      } else {
        const prevLevel = sortedLevels[index - 1];
        const prev = slices[prevLevel];
        const prevWidth = sliceWidths[prevLevel] || 0;
        midpoint = prev.midpoint + (prevWidth / 2) + GAP_DISTANCE + (width / 2);
      }
      const leftmost = midpoint - (width / 2);
      const rightmost = leftmost + width;
      slices[level] = { leftmost, rightmost, midpoint, width };
      console.log(`Slice ${level}: midpoint=${midpoint}, width=${width}, leftmost=${leftmost}, rightmost=${rightmost}`);
    });

    return slices;
  };

  const findDensestColumn = (levels: { [level: number]: string[] }) => {
    let maxCount = 0;
    let densestLevel = 0;

    Object.entries(levels).forEach(([level, nodes]) => {
      if (nodes.length > maxCount) {
        maxCount = nodes.length;
        densestLevel = parseInt(level);
      }
    });

    return densestLevel;
  };

  const calculateAutoLayout = useCallback(async () => {
    const activeNodesData = getActiveNodesData();
    if (!activeNodesData || Object.keys(activeNodesData).length === 0) {
      console.log('No nodes data available for auto-layout');
      return;
    }

    // First, build hierarchy for all active nodes to identify completed levels
    const fullHierarchy = buildHierarchyMap(activeNodesData);
    const completedLevelNumbers = Object.entries(fullHierarchy.levels)
      .filter(([_, nodeIds]) =>
        nodeIds.every(id => activeNodesData[id]?.status === 'completed')
      )
      .map(([level]) => parseInt(level));

    const nodesData = activeNodesData;
    console.log('Calculating auto-layout for nodes:', Object.keys(nodesData));
    const activeIds = Object.keys(nodesData);
    console.log('Measured nodes (subset of active graph):', Object.fromEntries(Object.entries(measuredNodes).filter(([id]) => activeIds.includes(id))));

    const { levels, nodeToLevel } = buildHierarchyMap(nodesData);
    console.log('Hierarchy levels:', levels);
    console.log('Node to level mapping:', nodeToLevel);

    const newPositions = computePositions({
      nodesData,
      levels,
      nodeToLevel,
      getNodeWidth,
      getNodeHeight,
      gapDistance: GAP_DISTANCE,
      verticalSpacing: VERTICAL_NODE_SPACING,
    });
    console.log('[Layout] Positions computed (top-left):', newPositions);

    setPositions(newPositions);

    // Step 5: Update database (but don't store positions since auto-layout handles them)
    // We can remove position storage since auto-layout calculates them
    console.log('Auto-layout calculation complete');
    setLayoutReady(true);
  }, [getActiveNodesData, measuredNodes, GAP_DISTANCE, VERTICAL_NODE_SPACING, getNodeWidth, getNodeHeight]);

  const calculateAndRecordHistoricalProgress = useCallback(async () => {
    if (!docData) return;
    const newHistory = calculateHistory(docData.nodesById as Record<string, any>);

    if (JSON.stringify(newHistory) !== JSON.stringify(docData.historical_progress || {})) {
      const nextDoc: NormalizedGraphDocument = { ...docData, historical_progress: newHistory };
      setDocData(nextDoc);
      const serialized = serializeGraphDocument(nextDoc);
      await supabase.from('graph_documents').update({ data: serialized }).eq('id', 'main');
    }
  }, [docData]);

  const addRelationship = async (sourceId: string, targetId: string) => {
    if (!docData) return;
    try {
      const operationId = `edge-${sourceId}-${targetId}-${Date.now()}`;
      console.log('Starting addRelationship operation:', operationId);
      localOperationsRef.current.add(operationId);

      const nextDoc = cloneGraphDocument(docData);
      const nodeMap = nextDoc.nodesById;
      const targetNode = nodeMap[targetId];
      if (!targetNode) {
        throw new Error(`Target node ${targetId} not found`);
      }

      if (!(targetNode.parents || []).includes(sourceId)) {
        targetNode.parents = [...(targetNode.parents || []), sourceId];
        setDocData(nextDoc);

        const serialized = serializeGraphDocument(nextDoc);
        const { error } = await (supabase as any)
          .from('graph_documents')
          .update({ data: serialized })
          .eq('id', 'main');
        if (error) throw error;

        await calculateAutoLayout();
      }

      setTimeout(() => {
        console.log('Removing operation from tracking:', operationId);
        localOperationsRef.current.delete(operationId);
      }, 2000);
    } catch (error) {
      console.error('Error adding relationship:', error);
    }
  };

  useEffect(() => {
    console.log('useGraphData useEffect running');
    initTextMeasurer();
    fetchGraphData().then(() => {
      // Intentionally not awaiting this background task
      calculateAndRecordHistoricalProgress();
    });

    // Realtime: listen for changes to graph_documents id 'main'
    const channel = (supabase as any)
      .channel('graph_documents_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'graph_documents', filter: 'id=eq.main' }, (payload: any) => {
        try {
          // Skip handling if this client just wrote
          if (localOperationsRef.current.size > 0) return;
          const next = payload?.new?.data;
          if (next) {
            const normalized = normalizeGraphDocument(next);
            setDocData(normalized);
            if (normalized.viewport) {
              setViewportState({
                x: Number(normalized.viewport.x ?? 0),
                y: Number(normalized.viewport.y ?? 0),
                zoom: Number(normalized.viewport.zoom ?? 1),
              });
            }
            // buildGraphForActiveId(next, activeGraphId); // useMemo handles this
            setLayoutReady(false);
            setIsFirstLayoutDone(false);
            // Compute layout after short microtask
            setTimeout(() => {
              try { calculateAutoLayout(); } catch (e) { console.error('Realtime layout error', e); }
            }, 0);
          }
        } catch (e) {
          console.error('Realtime change handling error', e);
        }
      })
      .subscribe();

    return () => {
      try { (supabase as any).removeChannel(channel); } catch { }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsubscribe = graphDocumentChannel.subscribe((update) => {
      if (!update?.document) return;
      console.log('[GraphData] Applying external graph update from', update.source, update.versionId);
      setDocData(normalizeGraphDocument(update.document));
      setLayoutReady(false);
      setIsFirstLayoutDone(false);
      setTimeout(() => {
        try { calculateAutoLayout(); } catch (error) { console.error('[GraphData] External layout error', error); }
      }, 0);
    });
    return () => {
      unsubscribe();
    };
  }, [calculateAutoLayout]);

  useEffect(() => {
    if (!docData) return;

    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(new Date().setDate(new Date().getDate() - 1)).toISOString().split('T')[0];
    const nodesToPatch: Record<string, any> = {};

    let needsUpdate = false;
    Object.entries(docData.nodesById).forEach(([id, node]: [string, any]) => {
      // Rule 1: Yesterday's incomplete tasks get reset
      if (node.scheduled_start?.startsWith(yesterday) && node.status === 'in-progress') {
        nodesToPatch[id] = { ...node, status: 'not-started' };
        needsUpdate = true;
      }
      // Rule 2: Today's scheduled tasks get started
      if (node.scheduled_start?.startsWith(today) && node.status === 'not-started') {
        nodesToPatch[id] = { ...node, status: 'in-progress' };
        needsUpdate = true;
      }
    });

    if (needsUpdate) {
      const nextDoc = cloneGraphDocument(docData);
      Object.entries(nodesToPatch).forEach(([id, updates]) => {
        if (nextDoc.nodesById[id]) {
          Object.assign(nextDoc.nodesById[id], updates);
        }
      });
      setDocData(nextDoc);
      const serialized = serializeGraphDocument(nextDoc);
      supabase.from('graph_documents').update({ data: serialized }).eq('id', 'main').then(({ error }) => {
        if (error) console.error("Error in midnight update:", error);
      });
    }
  }, [dayKey, docData]); // Triggered by the useTodayTime hook

  // Handle node measurements from React Flow
  const handleNodeMeasure = (nodeId: string, width: number, height: number) => {
    // Retain for optional debugging; no-op for layout
    return;
  };

  // Reset first layout flag when data changes significantly
  useEffect(() => {
    if (docData?.nodesById) {
      const nodeIds = Object.keys(docData.nodesById);
      const measuredIds = Object.keys(measuredNodes);
      const hasUnmeasuredNodes = nodeIds.some(id => !measuredIds.includes(id));

      if (hasUnmeasuredNodes) {
        setIsFirstLayoutDone(false);
        setLayoutReady(false);
        didPostMeasureLayoutRef.current = false;
        lastStableSnapshotRef.current = null;
        if (stabilizationTimerRef.current) {
          clearTimeout(stabilizationTimerRef.current);
          stabilizationTimerRef.current = null;
        }
      }
    }
  }, [docData?.nodesById, measuredNodes]);

  // Rebuild graph whenever activeGraphId changes
  useEffect(() => {
    if (docData) {
      console.log('[Graph] activeGraphId changed to', activeGraphId, '- rebuilding graph');
      setLayoutReady(false);
      setIsFirstLayoutDone(false);
      didPostMeasureLayoutRef.current = false;
      lastStableSnapshotRef.current = null;
      if (stabilizationTimerRef.current) {
        clearTimeout(stabilizationTimerRef.current);
        stabilizationTimerRef.current = null;
      }
      setTimeout(() => {
        try {
          console.log('[Layout] Seeding initial layout for graph', activeGraphId);
          calculateAutoLayout();
        } catch (e) {
          console.error('[Layout] Seed layout error', e);
        }
      }, 0);
    }
  }, [activeGraphId, docData, calculateAutoLayout]);

  // This can likely be simplified or removed as well, relying on docData changes.
  useEffect(() => {
    if (!docData) return;
    const nodesData = getActiveNodesData();
    if (Object.keys(nodesData).length === 0) return;
    console.log('[Layout] Immediate layout for graph', activeGraphId);
    calculateAutoLayout();
    setIsFirstLayoutDone(true);
    setLayoutReady(true);
  }, [
    activeGraphId,
    docData,
    filterToSelectedDay,
    effectiveStartMs,
    effectiveEndMs,
    calculateAutoLayout,
    getActiveNodesData,
  ]);


  return {
    nodes,
    edges,
    loading,
    activeNodeId,
    activeGraphId,
    viewportState,
    docData,
    layoutReady,
    measuredNodes,
    nodesById: docData?.nodesById || {},

    updateNodePosition,
    updateNodeCompletion,
    setNodeStatus,
    updateActiveNode,
    setActiveGraphId,
    updateViewportState,
    deleteNode,
    addRelationship,
    calculateAutoLayout,
    refetch: fetchGraphData,
    handleNodeMeasure,
    filterToSelectedDay,
    toggleFilterToSelectedDay,
  };
}



