import { Handle, Position } from '@xyflow/react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Trash2 } from 'lucide-react';
import { Clock, CheckCircle, AlertCircle, XCircle, Sparkles, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getNodeColor, hexToRgba } from '@/lib/colorUtils';
import { useEffect, useRef } from 'react';

interface ObjectiveNodeData {
  label: string;
  status: 'not-started' | 'in-progress' | 'blocked' | 'complete' | 'completed' | 'pending';
  subObjectives?: Array<{ id: string; label: string; status?: string }>;
  children?: Array<{ id: string; label: string; status?: string; color?: string }>;
  onDelete?: () => void;
  onComplete?: () => void;
  onMeasure?: (width: number, height: number) => void;
  isHighlighted?: boolean;
  color?: string;
}

const statusIcons = {
  'not-started': Clock,
  pending: Clock,
  'in-progress': AlertCircle,
  'blocked': XCircle,
  'complete': CheckCircle,
  'completed': CheckCircle,
};

const statusColors = {
  'not-started': 'text-status-not-started',
  pending: 'text-status-not-started',
  'in-progress': 'text-status-in-progress',
  'blocked': 'text-status-blocked',
  'complete': 'text-status-complete',
  'completed': 'text-status-complete',
};

const statusBadgeStyles: Record<ObjectiveNodeData['status'], string> = {
  'not-started': 'border-border bg-muted/40 text-status-not-started',
  pending: 'border-border bg-muted/40 text-status-not-started',
  'in-progress': 'border-status-in-progress/40 bg-status-in-progress/10 text-status-in-progress',
  'blocked': 'border-status-blocked/40 bg-status-blocked/10 text-status-blocked',
  'complete': 'border-status-complete/40 bg-status-complete/10 text-status-complete',
  'completed': 'border-status-complete/40 bg-status-complete/10 text-status-complete',
};

export function ObjectiveNode({ data }: { data: ObjectiveNodeData }) {
  const StatusIcon = statusIcons[data.status];
  const nodeRef = useRef<HTMLDivElement>(null);
  const showStatusLabel = data.status && data.status !== 'not-started';
  const baseColor = getNodeColor(data.color);
  const hasCustomColor = Boolean(data.color);
  const backgroundAlpha = hasCustomColor ? 0.55 : 0.18;
  const headerAlpha = hasCustomColor ? 0.75 : 0.28;
  const headerBorderAlpha = hasCustomColor ? 0.9 : 0.45;
  const statusAlpha = hasCustomColor ? 0.65 : 0.35;
  const statusBorderAlpha = hasCustomColor ? 0.9 : 0.6;
  const subListAlpha = hasCustomColor ? 0.35 : 0.12;

  const cardStyle = {
    borderColor: hexToRgba(baseColor, hasCustomColor ? 0.8 : 1),
    backgroundColor: hexToRgba(baseColor, backgroundAlpha),
  } as const;
  const headerStyle = {
    backgroundColor: hexToRgba(baseColor, headerAlpha),
    borderColor: hexToRgba(baseColor, headerBorderAlpha),
  } as const;
  const statusAccentStyle = {
    backgroundColor: hexToRgba(baseColor, statusAlpha),
    borderColor: hexToRgba(baseColor, statusBorderAlpha),
  } as const;

  // Measure node dimensions after render
  useEffect(() => {
    if (nodeRef.current && data.onMeasure) {
      const resizeObserver = new ResizeObserver(() => {
        if (!nodeRef.current || !data.onMeasure) return;
        const rect = nodeRef.current.getBoundingClientRect();
        // Debounce via rAF to coalesce mobile layout thrash
        requestAnimationFrame(() => data.onMeasure!(rect.width, rect.height));
      });

      resizeObserver.observe(nodeRef.current);

      // Initial measurement
      const rect = nodeRef.current.getBoundingClientRect();
      requestAnimationFrame(() => data.onMeasure!(rect.width, rect.height));

      return () => resizeObserver.disconnect();
    }
  }, [data.onMeasure]);

  const isCompleted = data.status === 'completed' || data.status === 'complete';
  const isInProgress = data.status === 'in-progress';
  const childObjectives = Array.isArray(data.children) && data.children.length > 0
    ? data.children
    : Array.isArray(data.subObjectives)
      ? data.subObjectives
      : [];

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          ref={nodeRef}
          className={cn(
            'relative transition-transform duration-500',
            data.isHighlighted && 'scale-[1.02]'
          )}
        >

          <Handle
            type="target"
            position={Position.Left}
            className="h-3 w-3 border-2"
            style={{ backgroundColor: baseColor, borderColor: baseColor }}
          />

          <div
            className={cn(
              'min-w-[220px] max-w-[320px] rounded-2xl border shadow-sm transition-all duration-500',
              isInProgress && 'ring-1 ring-status-in-progress/30',
              isCompleted && 'border-status-complete/50 bg-status-complete/5',
              data.isHighlighted && 'ring-2 ring-primary/40'
            )}
            style={cardStyle}
          >
            {/* Header */}
            <div className="flex items-start gap-3 rounded-t-2xl border-b px-4 py-3" style={headerStyle}>
              <div
                className={cn('flex h-9 w-9 items-center justify-center rounded-full border', statusBadgeStyles[data.status])}
                style={statusAccentStyle}
              >
                <StatusIcon className={cn('h-4 w-4', statusColors[data.status])} />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-base leading-tight">{data.label}</div>
                {showStatusLabel && (
                  <div className={cn('text-xs font-medium uppercase tracking-wide', statusColors[data.status])}>
                    {data.status.replace('-', ' ')}
                  </div>
                )}
              </div>
              <button
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card transition-colors duration-200 hover:bg-primary hover:text-primary-foreground',
                  isCompleted && 'bg-status-complete text-primary-foreground hover:bg-status-complete hover:text-primary-foreground'
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  data.onComplete?.();
                }}
                aria-label={isCompleted ? 'Mark objective incomplete' : 'Mark objective complete'}
                style={
                  isCompleted
                    ? { backgroundColor: hexToRgba(baseColor, 0.55), borderColor: baseColor }
                    : { backgroundColor: hexToRgba(baseColor, 0.25), borderColor: baseColor }
                }
              >
                <div className="relative">
                  <Sparkles className="absolute -top-1 -right-1 h-3 w-3 text-accent" aria-hidden />
                  <Check className="h-4 w-4" />
                </div>
              </button>
            </div>

            {/* Content: static sub-objectives list */}
            {childObjectives.length > 0 && (
              <div
                className="space-y-2 rounded-b-2xl px-4 pb-4 pt-3"
                style={{ backgroundColor: hexToRgba(baseColor, subListAlpha) }}
              >
                <ul className="space-y-2">
                  {childObjectives.map((item) => {
                    const subStatus = (item.status as any) || 'not-started';
                    const subCompleted = subStatus === 'completed' || subStatus === 'complete';
                    const subInProgress = subStatus === 'in-progress';
                    return (
                      <li
                        key={item.id}
                        className={cn(
                          'relative flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                          subCompleted
                            ? 'border-status-complete/30 bg-status-complete/10 text-status-complete'
                            : 'border-border/60 text-foreground/80',
                          subInProgress && 'border-status-in-progress/40 bg-status-in-progress/10 text-status-in-progress'
                        )}
                        style={{
                          borderColor: hexToRgba(baseColor, subCompleted ? 0.55 : 0.4),
                          backgroundColor: hexToRgba(baseColor, subCompleted ? 0.2 : subInProgress ? 0.22 : 0.1),
                        }}
                      >
                        {subInProgress && (
                          <span
                            className="pointer-events-none absolute inset-0 rounded-md bg-primary/10 animate-highlight-pulse"
                            aria-hidden
                          />
                        )}
                        <span className="relative z-[1] inline-flex items-center gap-2">
                          {subCompleted ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : subInProgress ? (
                            <Sparkles className="h-3.5 w-3.5" />
                          ) : null}
                          <span className={cn('relative z-[1]', subInProgress && 'animate-highlight-text')}>
                            {item.label}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          <Handle
            type="source"
            position={Position.Right}
            className="h-3 w-3 border-2"
            style={{ backgroundColor: baseColor, borderColor: baseColor }}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={data.onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="w-4 h-4 mr-2" />
          Delete Node
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default ObjectiveNode;