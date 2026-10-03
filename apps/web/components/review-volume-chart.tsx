"use client";

import { line, scaleLinear, scaleUtc } from "d3";

/** D3 owns the geometry; React owns the accessible SVG and exact-value table. */
export function ReviewVolumeChart({ points, title }: {
  points: ReadonlyArray<{ date: string; count: number }>;
  title: string;
}) {
  const width = 720;
  const height = 240;
  const left = 46;
  const right = width - 16;
  const top = 16;
  const bottom = height - 32;
  const first = new Date(`${points[0]?.date ?? "2000-01-01"}T00:00:00Z`);
  const last = new Date(`${points.at(-1)?.date ?? "2000-01-02"}T00:00:00Z`);
  const x = scaleUtc([first, first.getTime() === last.getTime() ?
    new Date(last.getTime() + 86400000) : last], [left, right]);
  const y = scaleLinear([0, Math.max(1, ...points.map((point) => point.count))], [bottom, top]).nice();
  const path = line<{ date: string; count: number }>()
    .x((point) => x(new Date(`${point.date}T00:00:00Z`)))
    .y((point) => y(point.count))(points);

  return <div className="review-chart-scroll" tabIndex={0} role="region" aria-label={title}><svg className="review-volume-chart" role="img" aria-label={title}
    viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
    {y.ticks(4).map((tick) => <g key={tick}>
      <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke="currentColor" opacity="0.18" />
      <text x={left - 8} y={y(tick) + 4} textAnchor="end" fontSize="12" fill="currentColor">{tick}</text>
    </g>)}
    <path d={path ?? ""} fill="none" stroke="currentColor" strokeWidth="3" />
    {points.length <= 35 && points.map((point) => <circle key={point.date}
      cx={x(new Date(`${point.date}T00:00:00Z`))} cy={y(point.count)} r="3" fill="currentColor" />)}
    <text x={left} y={height - 6} fontSize="12" fill="currentColor">{points[0]?.date}</text>
    <text x={right} y={height - 6} textAnchor="end" fontSize="12" fill="currentColor">{points.at(-1)?.date}</text>
  </svg></div>;
}
