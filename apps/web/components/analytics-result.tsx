"use client";
import type { AnalyticsResult } from "@open-triage/contracts";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import { useRegionalFormat } from "../app/regional-format";

function wrapChartLabel(label: string, characters: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of label.split(/\s+/)) {
    const letters = Array.from(word);
    for (let start = 0; start < letters.length; start += characters) {
      const part = letters.slice(start, start + characters).join("");
      if (line && line.length + part.length + 1 > characters) { lines.push(line); line = ""; }
      line = line ? `${line} ${part}` : part;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function AnalyticsResultView({ result, language }: { result: AnalyticsResult; language: AgencyLanguage }) {
  const region = useRegionalFormat();
  const t = (key: string, parameters?: Record<string, string | number>) => resolveMessage(language, `analytics.${key}`, parameters);
  const number = (value: number | null) => value === null ? t("unavailableValue") : new Intl.NumberFormat(region ?? language, { maximumFractionDigits: 2 }).format(value);
  const date = (value: string) => new Intl.DateTimeFormat(region ?? language, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  const seriesLabel = (series: AnalyticsResult["series"][number]) => [result.group ? series.groupLabel ?? t("notDocumented") : null,
    (result.metric.configured?.kind === "rule" ? t(`outcome.${result.definition.outcome}`) : series.categoryLabel) ?? (result.metric.kind === "categorical" && result.metric.datatype !== "records" ? t("notDocumented") : null)]
    .filter(Boolean).join(" · ") || (result.metric.datatype === "records" ? t("records") : result.metric.label);
  const unit = result.unit ?? (result.definition.aggregation === "count" ? t("records") : "");
  const cellsByPosition = new Map(result.cells.map((cell) => [JSON.stringify([cell.series, cell.bucket]), cell]));
  const cellAt = (series: string, bucket: string | null) => cellsByPosition.get(JSON.stringify([series, bucket]))!;
  const table = <table><caption>{t("exactValues")}</caption><thead><tr>
    <th>{t("series")}</th>{result.buckets.length > 0 && <th>{t("period")}</th>}<th>{t("value")}{unit && ` (${unit})`}</th>
    <th>{t("count")}</th><th>{t("numerator")}</th><th>{t("denominator")}</th><th>{t("missing")}</th><th>{t("absent")}</th><th>{t("invalid")}</th>{result.metric.configured && <><th>{t("notApplicable")}</th><th>{t("failed")}</th></>}
  </tr></thead><tbody>{result.cells.map((cell) => {
    const series = result.series.find((series) => series.id === cell.series)!;
    const bucket = result.buckets.find((bucket) => bucket.key === cell.bucket);
    return <tr key={`${cell.series}:${cell.bucket}`}><th scope="row">{seriesLabel(series)}</th>
      {result.buckets.length > 0 && <td>{bucket ? `${date(bucket.from)} – ${date(bucket.through)}` : ""}</td>}
      <td>{number(cell.value)}</td><td>{number(cell.count)}</td><td>{number(cell.numerator)}</td><td>{number(cell.denominator)}</td>
      <td>{number(cell.missing)}</td><td>{number(cell.absent)}</td><td>{number(cell.invalid)}</td>{result.metric.configured && <><td>{number(cell.notApplicable ?? 0)}</td><td>{number(cell.failed ?? 0)}</td></>}</tr>;
  })}</tbody></table>;
  if (!result.completeness.total) return <p className="analytics-empty" role="status">{t("empty")}</p>;
  if (result.definition.visualization === "table") return <div className="analytics-table">{table}</div>;
  const left = 65, right = 24, top = 30;
  const bar = result.definition.visualization === "bar";
  const width = Math.max(960, bar ? result.series.length * 160 + left + right : 0);
  const labelLines = bar ? result.series.map((series) => wrapChartLabel(seriesLabel(series),
    Math.floor(((width - left - right) / Math.max(1, result.series.length) - 24) / 7))) : [];
  const bottom = Math.max(70, ...labelLines.map((lines) => lines.length * 16 + 32));
  const height = 350 + bottom;
  const max = Math.max(1, ...result.cells.flatMap((cell) => cell.value === null ? [] : [cell.value]));
  const min = Math.min(0, ...result.cells.flatMap((cell) => cell.value === null ? [] : [cell.value]));
  const y = (value: number) => top + (max - value) / (max - min) * (height - top - bottom);
  const x = (index: number, count: number) => left + (index + 0.5) / Math.max(count, 1) * (width - left - right);
  const color = (index: number) => index === 0 ? "var(--green)" : `hsl(${(index * 137 + 205) % 360} 48% 35%)`;
  const dash = (index: number) => ["", "8 4", "2 4", "10 3 2 3"][index % 4];
  const details = (cell: AnalyticsResult["cells"][number]) => `${number(cell.value)} ${unit}; ${t("count")}: ${cell.count}` +
    (cell.denominator !== null ? `; ${t("numerator")}: ${cell.numerator}; ${t("denominator")}: ${cell.denominator}` : "");
  return <>
    {!bar && <ul className="analytics-legend" aria-label={t("series")}>{result.series.map((series, index) => <li key={series.id}>
      <svg width="28" height="12" aria-hidden="true"><line x1="0" x2="28" y1="6" y2="6" stroke={color(index)} strokeWidth="3" strokeDasharray={dash(index)} /></svg>{seriesLabel(series)}</li>)}</ul>}
    <div className="analytics-chart-scroll" style={{ minHeight: height, flexBasis: height }}><svg className="analytics-chart" style={{ minWidth: width, height }} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="analytics-chart-title analytics-chart-description">
      <title id="analytics-chart-title">{t(`visualization.${result.definition.visualization}`)} · {t(`aggregation.${result.definition.aggregation}`)} · {result.metric.label}</title>
      <desc id="analytics-chart-description">{t("chartDescription", { unit, count: result.series.length })}</desc>
      <text x={left} y="16">{unit}</text>
      {Array.from({ length: 5 }, (_, index) => min + index * (max - min) / 4).map((tick) => <g key={tick}>
        <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="analytics-grid-line" />
        <text x={left - 10} y={y(tick) + 4} textAnchor="end">{number(tick)}</text>
      </g>)}
      {result.definition.visualization === "line" ? result.series.map((series, index) => {
        const cells = result.buckets.map((bucket) => cellAt(series.id, bucket.key));
        let open = false;
        const path = cells.map((cell, position) => {
          if (cell.value === null) { open = false; return ""; }
          const segment = `${open ? "L" : "M"}${x(position, cells.length)},${y(cell.value)}`; open = true; return segment;
        }).join(" ");
        return <g key={series.id}><path d={path} fill="none" stroke={color(index)} strokeWidth="2.5" strokeDasharray={dash(index)} />
          {cells.map((cell, position) => cell.value === null ? null : <circle key={position} cx={x(position, cells.length)} cy={y(cell.value)} r="3.5" fill="white" stroke={color(index)} strokeWidth="2">
            <title>{seriesLabel(series)} · {date(result.buckets[position]!.from)}: {details(cell)}</title></circle>)}</g>;
      }) : result.series.map((series, index) => {
        const cell = cellAt(series.id, null);
        const barWidth = Math.min(65, (width - left - right) / result.series.length * 0.65);
        return <g key={series.id}>{cell.value !== null && <rect x={x(index, result.series.length) - barWidth / 2} y={Math.min(y(0), y(cell.value))}
          width={barWidth} height={Math.max(1, Math.abs(y(cell.value) - y(0)))} fill={color(index)}>
          <title>{seriesLabel(series)}: {details(cell)}</title></rect>}
          <text x={x(index, result.series.length)} y={cell.value === null ? y(0) - 8 : y(Math.max(0, cell.value)) - 8} textAnchor="middle">{number(cell.value)}</text>
          <text className="analytics-bar-label" x={x(index, result.series.length)} y={height - bottom + 23} textAnchor="middle">
            {labelLines[index]!.map((line, row) => <tspan key={row} x={x(index, result.series.length)} dy={row ? 16 : 0}>{line}</tspan>)}
          </text>
        </g>;
      })}
      {result.definition.visualization === "line" && result.buckets.map((bucket, index) => index % Math.max(1, Math.ceil(result.buckets.length / 7)) === 0 || index === result.buckets.length - 1 ?
        <text key={bucket.key} x={x(index, result.buckets.length)} y={height - bottom + 28} textAnchor="middle">{date(bucket.from)}{bucket.through !== bucket.from ? `–${date(bucket.through)}` : ""}</text> : null)}
    </svg></div>
    <div className="analytics-sr-only">{table}</div>
  </>;
}
