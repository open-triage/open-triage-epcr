"use client";

import { scaleBand, scaleLinear } from "d3";

/** D3 computes categorical geometry; the table alongside supplies exact values. */
export function ReviewAnalysisChart({ values, title }: {
  values: ReadonlyArray<{ value: string | null; count: number }>;
  title: string;
}) {
  const width = 720;
  const labels = values.map((item) => (item.value ?? "—").match(/.{1,34}(?:\s|$)|.{1,34}/g)?.map((line) => line.trim()) ?? ["—"]);
  const rowHeight = Math.max(32, ...labels.map((lines) => lines.length * 16 + 8));
  const height = Math.max(100, values.length * rowHeight + 20);
  const x = scaleLinear([0, Math.max(1, ...values.map((item) => item.count))], [0, 380]);
  const y = scaleBand(values.map((_, index) => index), [0, height - 20]).padding(0.18);
  return <div className="review-chart-scroll" tabIndex={0} role="region" aria-label={title}><svg className="review-volume-chart" role="img" aria-label={title}
    viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
    {values.map((item, index) => <g key={index}>
      <text x="278" y={(y(index) ?? 0) + y.bandwidth() / 2 + 4}
        textAnchor="end" fontSize="14" fill="currentColor">
        {labels[index]!.map((label, line) => <tspan key={line} x="278"
          y={(y(index) ?? 0) + y.bandwidth() / 2 - (labels[index]!.length - 1) * 8 + line * 16 + 4}>{label}{line < labels[index]!.length - 1 ? " " : ""}</tspan>)}
      </text>
      <rect x="284" y={y(index) ?? 0} width={x(item.count)}
        height={y.bandwidth()} fill="currentColor" opacity="0.72" />
      <text x={290 + x(item.count)} y={(y(index) ?? 0) + y.bandwidth() / 2 + 4}
        fontSize="14" fill="currentColor">{item.count}</text>
    </g>)}
  </svg></div>;
}
