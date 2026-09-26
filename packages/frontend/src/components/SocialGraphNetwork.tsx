'use client';

import * as React from 'react';
import { Maximize2, Minus, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SocialGraphNode {
  id: string;
  label: string;
  volume?: number;
  category?: string;
  reputation?: number;
  summary?: string;
}

export interface SocialGraphEdge {
  source: string;
  target: string;
  agreement: 'co-back' | 'counter-back';
  weight?: number;
}

export interface SocialGraphNetworkProps {
  nodes: SocialGraphNode[];
  edges: SocialGraphEdge[];
  height?: number;
  className?: string;
  onNodeSelect?: (node: SocialGraphNode) => void;
}

interface PositionedNode extends SocialGraphNode {
  x: number;
  y: number;
  radius: number;
}

function layout(nodes: SocialGraphNode[], width: number, height: number): PositionedNode[] {
  const maxVolume = Math.max(1, ...nodes.map((node) => node.volume || 0));
  return nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, nodes.length) - Math.PI / 2;
    const orbit = Math.min(width, height) * (0.22 + (index % 3) * 0.08);
    return {
      ...node,
      x: width / 2 + Math.cos(angle) * orbit,
      y: height / 2 + Math.sin(angle) * orbit,
      radius: 7 + Math.sqrt((node.volume || 0) / maxVolume) * 12,
    };
  });
}

export function SocialGraphNetwork({ nodes, edges, height = 420, className, onNodeSelect }: SocialGraphNetworkProps) {
  const width = 640;
  const positioned = React.useMemo(() => layout(nodes, width, height), [height, nodes]);
  const byId = React.useMemo(() => new Map(positioned.map((node) => [node.id, node])), [positioned]);
  const [scale, setScale] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = React.useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [selected, setSelected] = React.useState<SocialGraphNode | null>(null);

  const selectNode = (node: SocialGraphNode) => {
    setSelected(node);
    onNodeSelect?.(node);
  };

  return (
    <section className={cn('relative overflow-hidden rounded-xl border border-border bg-card', className)} aria-label="Backer social graph">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <span>{nodes.length} participants · {edges.length} relationships</span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Zoom out" onClick={() => setScale((value) => Math.max(0.6, value - 0.1))} className="rounded p-1 hover:bg-secondary"><Minus className="h-3.5 w-3.5" /></button>
          <span className="min-w-10 text-center">{Math.round(scale * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => setScale((value) => Math.min(1.8, value + 0.1))} className="rounded p-1 hover:bg-secondary"><Plus className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label="Reset graph view" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }} className="rounded p-1 hover:bg-secondary"><Maximize2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Interactive network of backers and counter-backers"
        className="touch-none select-none"
        onPointerDown={(event) => setDragStart({ x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y })}
        onPointerMove={(event) => {
          if (!dragStart) return;
          setOffset({ x: dragStart.ox + event.clientX - dragStart.x, y: dragStart.oy + event.clientY - dragStart.y });
        }}
        onPointerUp={() => setDragStart(null)}
        onPointerLeave={() => setDragStart(null)}
      >
        <g transform={`translate(${offset.x} ${offset.y}) translate(${width * (1 - scale) / 2} ${height * (1 - scale) / 2}) scale(${scale})`}>
          {edges.map((edge, index) => {
            const source = byId.get(edge.source);
            const target = byId.get(edge.target);
            if (!source || !target) return null;
            return <line key={`${edge.source}-${edge.target}-${index}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={edge.agreement === 'co-back' ? '#22c55e' : '#ef4444'} strokeOpacity={0.35 + Math.min(0.45, (edge.weight || 1) / 10)} strokeWidth={1 + Math.min(3, (edge.weight || 1) / 2)} />;
          })}
          {positioned.map((node) => (
            <g key={node.id} role="button" tabIndex={0} aria-label={`${node.label}, ${node.reputation || 0} reputation`} onClick={(event) => { event.stopPropagation(); selectNode(node); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node); } }} className="cursor-pointer">
              <circle cx={node.x} cy={node.y} r={node.radius + 5} fill="transparent" />
              <circle cx={node.x} cy={node.y} r={node.radius} fill={node.reputation && node.reputation > 80 ? '#a855f7' : '#38bdf8'} stroke="#0f172a" strokeWidth={2} />
              <text x={node.x} y={node.y + node.radius + 14} textAnchor="middle" fontSize="10" fill="currentColor" className="text-muted-foreground">{node.label}</text>
            </g>
          ))}
        </g>
      </svg>
      {selected ? (
        <div className="absolute bottom-3 left-3 max-w-xs rounded-lg border border-border bg-background/95 p-3 text-xs shadow-xl">
          <div className="flex items-start justify-between gap-3"><p className="font-semibold">{selected.label}</p><button type="button" aria-label="Close node details" onClick={() => setSelected(null)}><X className="h-3.5 w-3.5" /></button></div>
          <p className="mt-1 text-muted-foreground">{selected.summary || `${selected.category || 'Participant'} · ${selected.volume || 0} volume`}</p>
        </div>
      ) : null}
    </section>
  );
}

export default SocialGraphNetwork;
