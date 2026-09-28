"use client";

import { useState } from "react";
import type { TranslationIssue } from "../app/translation-diagnostics";

export function TranslationIssueSummary({ issues, filter, onFilter, onNavigate }: {
  readonly issues: ReadonlyArray<TranslationIssue>;
  readonly filter: string;
  readonly onFilter: (filter: string) => void;
  readonly onNavigate: (issue: TranslationIssue) => void;
}) {
  const [limit, setLimit] = useState(50);
  const visible = filter === "all" ? issues : issues.filter((issue) => issue.kind === filter);
  const count = (kind: TranslationIssue["kind"]) => issues.filter((issue) => issue.kind === kind).length;
  return <section aria-label="Translation diagnostics">
    <p role="status">{count("english")} missing English; {count("agency")} missing Swedish; {count("review")} needing review. Warnings do not block publication.</p>
    <label>Show wording issues <select value={filter} onChange={(event) => onFilter(event.target.value)}>
      <option value="all">All issues</option><option value="english">Missing English</option>
      <option value="agency">Missing Swedish</option><option value="review">Needs review</option>
    </select></label>
    {visible.length > 0 && <ul>{visible.slice(0, limit).map((issue, index) => <li key={`${issue.id}:${issue.field}:${issue.kind}:${index}`}>
      <button type="button" onClick={() => onNavigate(issue)}>{issue.id} · {issue.field}: {issue.message}</button>
    </li>)}</ul>}
    {visible.length > limit && <button type="button" onClick={() => setLimit((current) => current + 50)}>Show more issues ({visible.length - limit} remaining)</button>}
  </section>;
}
