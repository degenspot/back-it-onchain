'use client';

import * as React from 'react';
import {
  computeRadarPoints,
  toPolygonString,
  type RadarAxis,
} from '../lib/analytics-utils';

export interface ReputationRadarProps {
  axes: RadarAxis[];
  comparisonAxes?: RadarAxis[];
  size?: number;
  className?: string;
}

export function ReputationRadar({ axes, comparisonAxes, size = 260, className }: ReputationRadarProps) {
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const radius = size / 2;
  const center = { x: radius, y: radius };
  const points = computeRadarPoints(axes, radius * 0.72, center);
  const comparisonPoints = comparisonAxes ? computeRadarPoints(comparisonAxes, radius * 0.72, center) : [];
  const labelPoints = computeRadarPoints(axes.map((axis) => ({ ...axis, value: 100 })), radius * 0.92, center);
  const rings = [0.25, 0.5, 0.75, 1];
  const activeAxis = activeIndex === null ? null : axes[activeIndex];

  return (
    <div className={className} style={{ position: 'relative', width: size, maxWidth: '100%' }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        height="auto"
        role="img"
        aria-label="Interactive reputation radar"
        data-testid="reputation-radar"
      >
        {rings.map((ring) => (
          <circle key={ring} cx={center.x} cy={center.y} r={radius * 0.72 * ring} fill="none" stroke="currentColor" className="text-border" />
        ))}
        {axes.map((axis, index) => (
          <line key={`spoke-${axis.label}`} x1={center.x} y1={center.y} x2={labelPoints[index].x} y2={labelPoints[index].y} stroke="currentColor" className="text-border" />
        ))}
        {comparisonPoints.length > 0 ? <polygon points={toPolygonString(comparisonPoints)} fill="rgba(168,85,247,0.12)" stroke="rgb(168,85,247)" strokeWidth={2} strokeDasharray="5 4" data-testid="radar-comparison-polygon" /> : null}
        <polygon points={toPolygonString(points)} fill="rgba(56,189,248,0.25)" stroke="rgb(56,189,248)" strokeWidth={2} data-testid="radar-polygon" />
        {points.map((point, index) => (
          <circle
            key={`point-${axes[index].label}`}
            cx={point.x}
            cy={point.y}
            r={activeIndex === index ? 5 : 3}
            fill="rgb(56,189,248)"
            onMouseEnter={() => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
            onFocus={() => setActiveIndex(index)}
            onBlur={() => setActiveIndex(null)}
            tabIndex={0}
            aria-label={`${axes[index].label}: ${Math.round(axes[index].value)} out of 100`}
          />
        ))}
        {axes.map((axis, index) => (
          <text key={axis.label} x={labelPoints[index].x} y={labelPoints[index].y} fontSize={10} fill="currentColor" className="text-muted-foreground" textAnchor="middle" dominantBaseline="middle">
            {axis.label}
          </text>
        ))}
      </svg>
      {activeAxis ? (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card px-3 py-2 text-center text-xs shadow-lg" role="status">
          <p className="font-semibold">{activeAxis.label}</p>
          <p>{Math.round(activeAxis.value)} / 100</p>
        </div>
      ) : null}
    </div>
  );
}

export default ReputationRadar;
