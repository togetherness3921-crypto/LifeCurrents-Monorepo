import { Handle, Position } from '@xyflow/react';
import { Target, Trash2, Sparkles, Check } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { getNodeColor, hexToRgba } from '@/lib/colorUtils';
import { useEffect, useRef } from 'react';

interface GoalNodeData {
  label: string;
  isActive?: boolean;
  status?: string;
  onDelete?: () => void;
  onComplete?: () => void;
  onMeasure?: (width: number, height: number) => void;
  isHighlighted?: boolean;
  color?: string;
}

export function GoalNode({ data }: { data: GoalNodeData }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const baseColor = getNodeColor(data.color);
  const cardStyle = {
    borderColor: baseColor,
    backgroundColor: hexToRgba(baseColor, 0.18),
  } as const;
  const iconStyle = {
    backgroundColor: hexToRgba(baseColor, 0.3),
    color: baseColor,
  } as const;

  // Measure node dimensions after render
  useEffect(() => {
    if (nodeRef.current && data.onMeasure) {
      const resizeObserver = new ResizeObserver(() => {
        if (!nodeRef.current || !data.onMeasure) return;
        const rect = nodeRef.current.getBoundingClientRect();
        requestAnimationFrame(() => data.onMeasure!(rect.width, rect.height));
      });

      resizeObserver.observe(nodeRef.current);

      // Initial measurement
      const rect = nodeRef.current.getBoundingClientRect();
      requestAnimationFrame(() => data.onMeasure!(rect.width, rect.height));

      return () => resizeObserver.disconnect();
    }
  }, [data.onMeasure]);

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          ref={nodeRef}
          className={cn('relative transition-transform duration-500', data.isHighlighted && 'scale-[1.02]')}
        >

          <Handle
            type="target"
            position={Position.Left}
            className="h-4 w-4 border-2"
            style={{ backgroundColor: baseColor, borderColor: baseColor }}
          />

          <div
            className={cn(
              'relative flex h-36 w-36 flex-col items-center justify-center rounded-full border-2 text-foreground shadow-sm transition-all duration-500',
              data.status === 'in-progress' && 'ring-1 ring-status-in-progress/30',
              data.status === 'completed' && 'border-status-complete/50 bg-status-complete/10',
              data.isHighlighted && 'ring-2 ring-primary/40'
            )}
            style={cardStyle}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full" style={iconStyle}>
              <Target className="h-6 w-6" />
            </div>
            <div className="mt-3 text-center text-sm font-semibold leading-tight">{data.label}</div>
            <button
              className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors duration-200 hover:bg-primary hover:text-primary-foreground"
              onClick={(e) => {
                e.stopPropagation();
                data.onComplete?.();
              }}
              aria-label={data.status === 'completed' ? 'Mark goal incomplete' : 'Mark goal complete'}
              style={{ backgroundColor: hexToRgba(baseColor, 0.3), borderColor: baseColor }}
            >
              <div className="relative">
                <Sparkles className="absolute -top-1 -right-1 h-3 w-3 text-accent" aria-hidden />
                <Check className="h-4 w-4" />
              </div>
            </button>
          </div>
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

export default GoalNode;