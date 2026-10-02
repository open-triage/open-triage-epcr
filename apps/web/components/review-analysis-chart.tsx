"use client";

import { scaleBand, scaleLinear } from "d3";

/** D3 computes categorical geometry; the table alongside supplies exact values. */
export function ReviewAnalysisChart({ values, title }: {
  values: ReadonlyArray<{ value: string | null; count: number }>;
  title: string;
}) {
  const visible = values.slice(0, 20);
  const width = 720;
  const height = Math.max(100, visible.length * 28 + 20);
  const x = scaleLinear([0, Math.max(1, ...visible.map((item) => item.count))], [0, 430]);
  const y = scaleBand(visible.map((item) => item.value ?? ""), [0, height - 20]).padding(0.18);
  return <svg className="review-volume-chart" role="img" aria-label={title}
    viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
    {visible.map((item) => <g key={item.value ?? "missing"}>
      <text x="278" y={(y(item.value ?? "") ?? 0) + y.bandwidth() / 2 + 4}
        textAnchor="end" fontSize="12" fill="currentColor">
        {(item.value ?? "—").slice(0, 38)}
      </text>
      <rect x="284" y={y(item.value ?? "") ?? 0} width={x(item.count)}
        height={y.bandwidth()} fill="currentColor" opacity="0.72" />
      <text x={290 + x(item.count)} y={(y(item.value ?? "") ?? 0) + y.bandwidth() / 2 + 4}
        fontSize="12" fill="currentColor">{item.count}</text>
    </g>)}
  </svg>;
}
