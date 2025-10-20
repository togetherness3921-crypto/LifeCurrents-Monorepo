import { Handle, Position } from '@xyflow/react';
import { CheckSquare, Trash2, Sparkles, Check } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { getNodeColor, hexToRgba } from '@/lib/colorUtils';
import { useEffect, useRef } from 'react';

interface ValidationNodeData {
  label: string;
  isActive?: boolean;
  status?: string;
  onDelete?: () => void;
  onComplete?: () => void;
  onMeasure?: (width: number, height: number) => void;
  isHighlighted?: boolean;
  color?: string;
}

export function ValidationNode({ data }: { data: ValidationNodeData }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const baseColor = getNodeColor(data.color);
  const cardStyle = {
    borderColor: baseColor,
    backgroundColor: hexToRgba(baseColor, 0.15),
  } as const;
  const iconStyle = {
    backgroundColor: hexToRgba(baseColor, 0.25),
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
            className="h-3 w-3 border-2"
            style={{ backgroundColor: baseColor, borderColor: baseColor }}
          />

          <div
            className={cn(
              'min-w-[200px] rounded-2xl border p-4 text-foreground shadow-sm transition-all duration-500',
              data.status === 'in-progress' && 'ring-1 ring-status-in-progress/30',
              data.status === 'completed' && 'border-status-complete/50 bg-status-complete/5',
              data.isHighlighted && 'ring-2 ring-primary/40'
            )}
            style={cardStyle}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full" style={iconStyle}>
                <CheckSquare className="h-5 w-5" />
              </div>
              <span className="flex-1 text-sm font-semibold leading-tight">{data.label}</span>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors duration-200 hover:bg-primary hover:text-primary-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onComplete?.();
                }}
                aria-label={data.status === 'completed' ? 'Mark validation incomplete' : 'Mark validation complete'}
                style={{ backgroundColor: hexToRgba(baseColor, 0.25), borderColor: baseColor }}
              >
                <div className="relative">
                  <Sparkles className="absolute -top-1 -right-1 h-3 w-3 text-accent" aria-hidden />
                  <Check className="h-4 w-4" />
                </div>
              </button>
            </div>
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

export default ValidationNode;