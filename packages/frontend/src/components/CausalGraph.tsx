import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../custom-styles.css';

import { ObjectiveNode } from './nodes/ObjectiveNode';
import { Button } from './ui/button';
import { RefreshCw, Loader2, ArrowLeft, Calendar as CalendarIcon } from 'lucide-react';
import { useGraphData } from '@/hooks/useGraphData';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './ui/resizable';
import DailyTaskPanel from './DailyTaskPanel';
import DailyCalendarPanel from './DailyCalendarPanel';
import { useTodayTime } from '@/hooks/useTodayTime';
import ProgressGraphPanel from './ProgressGraphPanel';
import StatsPanel from './StatsPanel';
import ChatLayout from './chat/ChatLayout';
import { useToast } from '@/hooks/use-toast';
import { GraphHistoryProvider, useGraphHistory } from '@/hooks/graphHistoryProvider';
import { fetchLayoutBorders, persistLayoutBorders } from '@/services/layoutPersistence';
import { cn } from '@/lib/utils';
import { format, addDays } from 'date-fns';
import { startOfUtcDay, endOfUtcDay, addUtcDays } from '@/services/intelligentContext';

const DEFAULT_TOP_LAYOUT = [70, 15, 15] as const;
const DEFAULT_MAIN_VERTICAL_LAYOUT = [65, 15, 20] as const;
const DEFAULT_PROGRESS_LAYOUT = [75, 25] as const;

const MIN_PANEL = 5;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const computeThreePanelLayout = (
  defaults: readonly number[],
  first?: number,
  second?: number
): number[] => {
  if (typeof first !== 'number' || typeof second !== 'number') {
    return [...defaults];
  }
  const firstClamped = clamp(first, MIN_PANEL, 100 - MIN_PANEL * 2);
  const secondClamped = clamp(second, firstClamped + MIN_PANEL, 100 - MIN_PANEL);
  const layout = [
    firstClamped,
    Math.max(MIN_PANEL, secondClamped - firstClamped),
    Math.max(MIN_PANEL, 100 - secondClamped),
  ];
  const total = layout.reduce((sum, value) => sum + value, 0);
  return layout.map((value) => (value / total) * 100);
};

const computeTwoPanelLayout = (defaults: readonly number[], first?: number): number[] => {
  if (typeof first !== 'number') {
    return [...defaults];
  }
  const firstClamped = clamp(first, MIN_PANEL, 100 - MIN_PANEL);
  return [firstClamped, 100 - firstClamped];
};

const nodeTypes = {
  objectiveNode: ObjectiveNode,
};

function CausalGraphContent() {
  const { now: nowRealtime } = useTodayTime(60000);
  const todayStart = useMemo(() => startOfUtcDay(nowRealtime), [nowRealtime]);
  const [viewedDate, setViewedDate] = useState<Date>(() => startOfUtcDay(new Date()));
  useEffect(() => {
    setViewedDate((prev) => {
      const prevKey = startOfUtcDay(prev).getTime();
      const todayKey = todayStart.getTime();
      if (prevKey === todayKey) {
        return todayStart;
      }
      return prev;
    });
  }, [todayStart]);
  const startOfDay = useMemo(() => startOfUtcDay(viewedDate), [viewedDate]);
  const endOfDay = useMemo(() => endOfUtcDay(viewedDate), [viewedDate]);
  const {
    nodes: graphNodes,
    edges: graphEdges,
    loading,
    activeGraphId,
    viewportState,
    docData,
    layoutReady,
    measuredNodes,

    updateNodeCompletion,
    setNodeStatus,
    setActiveGraphId,
    updateViewportState,
    deleteNode,
    addRelationship,
    calculateAutoLayout,
    handleNodeMeasure,
    filterToSelectedDay,
    toggleFilterToSelectedDay,
    nodesById,
  } = useGraphData(startOfDay, endOfDay);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const reactFlowInstance = useRef<ReactFlowInstance<any, any> | null>(null);
  const pendingAutoFitRef = useRef(false);
  const fitCancelledRef = useRef(false);
  const targetFitGraphIdRef = useRef<string | null>(null);
  const prevMainViewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const restoreOnBackRef = useRef(false);
  const previousLayoutReadyRef = useRef(layoutReady);
  const goToToday = useCallback(() => {
    setViewedDate(todayStart);
  }, [todayStart]);
  const goToPreviousDay = useCallback(() => {
    setViewedDate(prev => addUtcDays(startOfUtcDay(prev), -1));
  }, []);
  const goToNextDay = useCallback(() => {
    setViewedDate(prev => addUtcDays(startOfUtcDay(prev), 1));
  }, []);
  const handleSelectDate = useCallback((date: Date | undefined) => {
    if (!date) return;
    setViewedDate(startOfUtcDay(date));
  }, []);
  const formattedViewedDate = useMemo(() => format(viewedDate, 'MMM d, yyyy'), [viewedDate]);
  const isViewingToday = startOfDay.getTime() === todayStart.getTime();
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const { toast } = useToast();
  const { isReverting, returnToLatest } = useGraphHistory();
  const handleReturnToLatest = useCallback(() => {
    returnToLatest();
  }, [returnToLatest]);

  const [topLayout, setTopLayout] = useState<number[] | null>(null);
  const [mainVerticalLayoutState, setMainVerticalLayoutState] = useState<number[] | null>(null);
  const [progressLayoutState, setProgressLayoutState] = useState<number[] | null>(null);
  const [layoutLoaded, setLayoutLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const loadLayouts = async () => {
      const borders = await fetchLayoutBorders();
      const top = computeThreePanelLayout(
        DEFAULT_TOP_LAYOUT,
        borders['top-horizontal-1']?.position,
        borders['top-horizontal-2']?.position
      );
      const vertical = computeThreePanelLayout(
        DEFAULT_MAIN_VERTICAL_LAYOUT,
        borders['main-vertical-1']?.position,
        borders['main-vertical-2']?.position
      );
      const progress = computeTwoPanelLayout(
        DEFAULT_PROGRESS_LAYOUT,
        borders['progress-horizontal-1']?.position
      );
      const missingBorders: Array<{ borderId: string; axis: 'x' | 'y'; position: number }> = [];
      if (!borders['top-horizontal-1']) {
        missingBorders.push({ borderId: 'top-horizontal-1', axis: 'x' as const, position: top[0] });
      }
      if (!borders['top-horizontal-2']) {
        missingBorders.push({ borderId: 'top-horizontal-2', axis: 'x' as const, position: top[0] + top[1] });
      }
      if (!borders['main-vertical-1']) {
        missingBorders.push({ borderId: 'main-vertical-1', axis: 'y' as const, position: vertical[0] });
      }
      if (!borders['main-vertical-2']) {
        missingBorders.push({ borderId: 'main-vertical-2', axis: 'y' as const, position: vertical[0] + vertical[1] });
      }
      if (!borders['progress-horizontal-1']) {
        missingBorders.push({ borderId: 'progress-horizontal-1', axis: 'x' as const, position: progress[0] });
      }
      if (missingBorders.length > 0) {
        void persistLayoutBorders(missingBorders);
      }
      if (isMounted) {
        setTopLayout(top);
        setMainVerticalLayoutState(vertical);
        setProgressLayoutState(progress);
        setLayoutLoaded(true);
      }
    };
    void loadLayouts();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (layoutReady) {
      const timer = setTimeout(() => {
        if (reactFlowInstance.current) {
          reactFlowInstance.current.fitView({ duration: 800, padding: 0.1 });
        }
      }, 1000); // 1-second delay
      return () => clearTimeout(timer);
    }
  }, [layoutReady]);

  const onConnect = useCallback(
    (params: Connection) => {
      const { source, target } = params;
      if (source && target) {
        addRelationship(source, target);
        setEdges((eds) => addEdge(params, eds));
      }
    },
    [setEdges, addRelationship]
  );

  // Manual positioning disabled - auto-layout handles all positioning

  // Note: toggleNodeExpansion removed as expansion is no longer needed

  const onNodeComplete = useCallback((nodeId: string) => {
    updateNodeCompletion(nodeId);

    // Find next node using parent relationships and pan to it
    if (docData?.nodesById) {
      const nextNode = Object.values(docData.nodesById).find(node => (node.parents || []).includes(nodeId));
      const nextNodeId = nextNode?.id;

      if (nextNodeId) {
        // Pan to next node after a short delay
        setTimeout(() => {
          if (reactFlowInstance.current) {
            const nextNode = reactFlowInstance.current.getNode(nextNodeId);
            if (nextNode) {
              reactFlowInstance.current.fitView({
                nodes: [nextNode],
                duration: 800,
                padding: 0.3,
              });
            }
          }
        }, 100);
      }
    }
  }, [updateNodeCompletion, docData]);

  // Save viewport changes
  const onMove = useCallback((event: any, viewport: any) => {
    //
  }, []);

  useEffect(() => {
    setNodes(graphNodes);
    setEdges(graphEdges);
  }, [graphNodes, graphEdges, setNodes, setEdges]);

  useEffect(() => {
    const wasReady = previousLayoutReadyRef.current;
    previousLayoutReadyRef.current = layoutReady;

    if (!layoutReady || !reactFlowInstance.current) {
      return;
    }

    if (!wasReady && nodes.length > 0) {
      if (!pendingAutoFitRef.current || targetFitGraphIdRef.current !== activeGraphId) {
        targetFitGraphIdRef.current = activeGraphId;
        pendingAutoFitRef.current = true;
      }
    }
  }, [layoutReady, nodes.length, activeGraphId]);

  useEffect(() => () => {
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
  }, []);

  const handleTopLayoutChange = useCallback(
    (sizes: number[]) => {
      setTopLayout(sizes);
      void persistLayoutBorders([
        { borderId: 'top-horizontal-1', axis: 'x' as const, position: sizes[0] },
        { borderId: 'top-horizontal-2', axis: 'x' as const, position: sizes[0] + sizes[1] },
      ]);
    },
    []
  );

  const handleMainVerticalLayoutChange = useCallback(
    (sizes: number[]) => {
      setMainVerticalLayoutState(sizes);
      void persistLayoutBorders([
        { borderId: 'main-vertical-1', axis: 'y' as const, position: sizes[0] },
        { borderId: 'main-vertical-2', axis: 'y' as const, position: sizes[0] + sizes[1] },
      ]);
    },
    []
  );

  const handleProgressLayoutChange = useCallback(
    (sizes: number[]) => {
      setProgressLayoutState(sizes);
      void persistLayoutBorders([
        { borderId: 'progress-horizontal-1', axis: 'x' as const, position: sizes[0] },
      ]);
    },
    []
  );

  const containerIds = useMemo(() => {
    const ids = new Set<string>();
    Object.values((docData?.nodes || {}) as Record<string, any>).forEach((node: any) => {
      const graphId = node?.graph;
      if (graphId && graphId !== 'main') {
        ids.add(graphId);
      }
    });
    return ids;
  }, [docData?.nodes]);

  const triggerHighlight = useCallback((nodeId: string) => {
    setHighlightedNodeId(nodeId);
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedNodeId((current) => (current === nodeId ? null : current));
      highlightTimerRef.current = null;
    }, 1800);
  }, []);

  const onNodeClick = useCallback((_: any, node: any) => {
    const isContainer = containerIds.has(node.id);
    if (!isContainer) return;

    if (reactFlowInstance.current) {
      const inst = reactFlowInstance.current as any;
      if (activeGraphId === 'main' && typeof inst.getViewport === 'function') {
        prevMainViewportRef.current = inst.getViewport();
      }
      const rfNode = inst.getNode(node.id);
      if (rfNode) {
        inst.fitView({ nodes: [rfNode], duration: 500, padding: 0.2 });
      }
    }

    targetFitGraphIdRef.current = node.id;
    pendingAutoFitRef.current = true;

    setTimeout(() => {
      setActiveGraphId(node.id);
    }, 520);
  }, [containerIds, setActiveGraphId, activeGraphId]);

  const handleAutoFit = useCallback(() => {
    if (reactFlowInstance.current) {
      reactFlowInstance.current.fitView({ duration: 800, padding: 0.1 });
    }
  }, []);

  // After nodes/edges update (graph mounted), do an automatic fit view or restore
  useEffect(() => {
    if (!pendingAutoFitRef.current || !reactFlowInstance.current) return;
    fitCancelledRef.current = false;

    const tryFit = () => {
      if (fitCancelledRef.current || !reactFlowInstance.current) return;

      const targetGraph = targetFitGraphIdRef.current;
      if (!targetGraph) {
        pendingAutoFitRef.current = false;
        restoreOnBackRef.current = false;
        return;
      }

      if (activeGraphId !== targetGraph) {
        // Wait for graph to switch
        setTimeout(tryFit, 80);
        return;
      }

      const instance = reactFlowInstance.current;

      // If returning to main and we have a saved viewport, restore immediately
      if (activeGraphId === 'main' && restoreOnBackRef.current && prevMainViewportRef.current) {
        instance.setViewport(prevMainViewportRef.current);
        pendingAutoFitRef.current = false;
        targetFitGraphIdRef.current = null;
        restoreOnBackRef.current = false;
        return;
      }

      const rfNodes = instance.getNodes();
      const currentIds = new Set(nodes.map(n => n.id));
      const subgraphNodes = rfNodes.filter(n => currentIds.has(n.id));

      const ready = subgraphNodes.length > 0;

      if (ready) {
        instance.fitView({ nodes: subgraphNodes as any, duration: 600, padding: 0.2 });
        pendingAutoFitRef.current = false;
        targetFitGraphIdRef.current = null;
        restoreOnBackRef.current = false;
      } else {
        setTimeout(tryFit, 120);
      }
    };

    // small delay to allow DOM mount before first attempt
    const t = setTimeout(tryFit, 80);
    return () => {
      fitCancelledRef.current = true;
      clearTimeout(t);
    };
  }, [nodes, edges, activeGraphId, layoutReady]);

  // Compute sub-objectives (children whose graph equals this node.id) and pass into ObjectiveNode as props
  const nodesWithActions = nodes.map((node) => {
    const isHighlighted = node.id === highlightedNodeId;
    let subObjectives: Array<{ id: string; label: string; status?: string }> | undefined = undefined;
    const subs = Object.entries(nodesById || {})
      .filter(([, n]) => ((n as any)?.graph || 'main') === node.id)
      .map(([id, n]) => ({ id, label: (n as any)?.label || id, status: (n as any)?.status || 'not-started' }));
    if (subs.length > 0) subObjectives = subs;
    return {
      ...node,
      data: {
        ...node.data,
        isHighlighted,
        subObjectives,
        onDelete: () => deleteNode(node.id),
        onComplete: () => onNodeComplete(node.id),
        onMeasure: (width: number, height: number) => handleNodeMeasure(node.id, width, height),
      },
    };
  });

  // Task panel actions
  const onToggleComplete = useCallback((id: string) => setNodeStatus(id, 'completed'), [setNodeStatus]);
  const onZoomToNode = useCallback(
    (id: string) => {
      if (!reactFlowInstance.current) return;
      const node = reactFlowInstance.current.getNode(id);
      if (node) {
        reactFlowInstance.current.fitView({ nodes: [node], duration: 800, padding: 0.3 });
        triggerHighlight(id);
      } else {
        toast({
          title: 'Node not found',
          description: 'The selected item is not available in the current graph view.',
        });
      }
    },
    [toast, triggerHighlight]
  );

  if (loading || !layoutLoaded) {
    return (
      <div className="w-full h-[100dvh] bg-graph-background flex items-center justify-center">
        <div className="flex items-center gap-2 text-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>Loading graph...</span>
        </div>
      </div>
    );
  }

  const resolvedTopLayout = topLayout ?? [...DEFAULT_TOP_LAYOUT];
  const resolvedMainVerticalLayout = mainVerticalLayoutState ?? [...DEFAULT_MAIN_VERTICAL_LAYOUT];
  const resolvedProgressLayout = progressLayoutState ?? [...DEFAULT_PROGRESS_LAYOUT];

  return (
    <div className="relative h-[100dvh] w-full bg-graph-background">
      <ResizablePanelGroup
        direction="vertical"
        className="h-full w-full"
        onLayout={handleMainVerticalLayoutChange}
      >
        <ResizablePanel defaultSize={resolvedMainVerticalLayout[0]}>
          <ResizablePanelGroup direction="horizontal" onLayout={handleTopLayoutChange} className="h-full">
            {/* Left: Main graph */}
            <ResizablePanel defaultSize={resolvedTopLayout[0]} minSize={40} className="relative">
              <ReactFlow
                nodes={nodesWithActions}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={onNodeClick}
                nodesDraggable={false}
                onMove={onMove}
                nodeTypes={nodeTypes}
                onInit={(instance) => {
                  reactFlowInstance.current = instance;
                  // Restore viewport state after initialization
                  setTimeout(() => {
                    if (viewportState && (viewportState.x !== 0 || viewportState.y !== 0 || viewportState.zoom !== 1)) {
                      instance.setViewport(viewportState);
                    }
                  }, 100);
                }}
                fitView={!(viewportState.x !== 0 || viewportState.y !== 0 || viewportState.zoom !== 1)}
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.01}
                maxZoom={4}
                defaultEdgeOptions={{
                  animated: true,
                  style: { stroke: 'hsl(var(--graph-edge))', strokeWidth: 2 },
                }}
              >
                <Controls
                  className="bg-card/30 border-border text-foreground p-1 [&>button]:w-10 [&>button]:h-10 [&>button]:rounded-md [&>button]:bg-transparent [&>button]:border-border [&>button:hover]:border-accent [&>button:hover]:text-accent scale-50 md:scale-75 lg:scale-100 origin-bottom-left !left-0 !bottom-0 !m-0 shadow-md rounded-tr-2xl border-2 border-l-0 border-b-0 border-t-border border-r-border"
                  showZoom={false}
                  showFitView={true}
                  showInteractive={false}
                >
                  <Button
                    onClick={toggleFilterToSelectedDay}
                    variant="outline"
                    size="icon"
                    aria-pressed={filterToSelectedDay}
                    title={
                      filterToSelectedDay
                        ? 'Filtering nodes to the selected day'
                        : 'Showing all scheduled nodes'
                    }
                    className={cn(
                      'bg-background border-border',
                      filterToSelectedDay && 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
                    )}
                  >
                    <CalendarIcon className="w-3 h-3" />
                  </Button>
                  <Button
                    onClick={() => {
                      if (activeGraphId !== 'main') {
                        console.log('[Graph] Back to main requested');
                        targetFitGraphIdRef.current = 'main';
                        restoreOnBackRef.current = true;
                        pendingAutoFitRef.current = true;
                        setActiveGraphId('main');
                      }
                    }}
                    variant="outline"
                    size="icon"
                    className="bg-background border-border"
                    disabled={activeGraphId === 'main'}
                  >
                    <ArrowLeft className="w-3 h-3" />
                  </Button>
                  <Button
                    onClick={() => {
                      // Force cache bypass and fresh reload
                      if ('caches' in window) {
                        caches.keys().then(names => {
                          names.forEach(name => caches.delete(name));
                        });
                      }
                      // Cache-busting reload
                      window.location.href = window.location.href + '?_t=' + Date.now();
                    }}
                    variant="outline"
                    size="icon"
                    className="bg-background border-border"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </Button>
                </Controls>
                <Background
                  color="hsl(var(--graph-grid))"
                  gap={20}
                  size={1}
                  className="bg-graph-background"
                />
              </ReactFlow>
            </ResizablePanel>
            <ResizableHandle withHandle />

            {/* Middle: Daily task checklist */}
            <ResizablePanel defaultSize={resolvedTopLayout[1]} minSize={10} className="relative">
              <DailyTaskPanel
                nodesById={nodesById}
                onToggleComplete={onToggleComplete}
                onZoomToNode={onZoomToNode}
                startOfDay={startOfDay}
                endOfDay={endOfDay}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />

            {/* Right: Daily calendar view */}
            <ResizablePanel defaultSize={resolvedTopLayout[2]} minSize={10} className="relative">
              <DailyCalendarPanel
                nodesById={nodesById}
                startOfDay={startOfDay}
                endOfDay={endOfDay}
                now={nowRealtime}
                onZoomToNode={onZoomToNode}
                currentDate={viewedDate}
                onPreviousDay={goToPreviousDay}
                onNextDay={goToNextDay}
                onSelectDate={handleSelectDate}
                onGoToToday={goToToday}
                dateLabel={formattedViewedDate}
                isToday={isViewingToday}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={resolvedMainVerticalLayout[1]} minSize={10}>
          <ResizablePanelGroup direction="horizontal" className="h-full" onLayout={handleProgressLayoutChange}>
            <ResizablePanel defaultSize={resolvedProgressLayout[0]} minSize={30}>
              <ProgressGraphPanel
                history={docData?.historical_progress}
                primaryNodeColor={nodesById?.main?.color}
                selectedDate={viewedDate}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={resolvedProgressLayout[1]} minSize={20}>
              <StatsPanel history={docData?.historical_progress} selectedDate={viewedDate} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={resolvedMainVerticalLayout[2]} minSize={10}>
          <ChatLayout />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

export default function CausalGraph() {
  return (
    <GraphHistoryProvider>
      <CausalGraphContent />
    </GraphHistoryProvider>
  );
}