"use client";

import { useState } from "react";
import { AdminText, useAdminText } from "../app/admin-localization";
import type { TranslationIssue } from "../app/translation-diagnostics";

export function TranslationIssueSummary({ issues, filter, onFilter, onNavigate }: {
  readonly issues: ReadonlyArray<TranslationIssue>;
  readonly filter: string;
  readonly onFilter: (filter: string) => void;
  readonly onNavigate: (issue: TranslationIssue) => void;
}) {
  const t = useAdminText();
  const [limit, setLimit] = useState(50);
  const visible = filter === "all" ? issues : issues.filter((issue) => issue.kind === filter);
  const count = (kind: TranslationIssue["kind"]) => issues.filter((issue) => issue.kind === kind).length;
  return <section aria-label={t("Translation diagnostics")}>
    <p role="status">{t("{english} missing English; {swedish} missing Swedish; {review} needing review. Warnings do not block publication.", { english: count("english"), swedish: count("agency"), review: count("review") })}</p>
    <label><AdminText english="Show wording issues" /> <select value={filter} onChange={(event) => onFilter(event.target.value)}>
      <option value="all"><AdminText english="All issues" /></option><option value="english"><AdminText english="Missing English" /></option>
      <option value="agency"><AdminText english="Missing Swedish" /></option><option value="review"><AdminText english="Needs review" /></option>
    </select></label>
    {visible.length > 0 && <ul>{visible.slice(0, limit).map((issue, index) => <li key={`${issue.id}:${issue.field}:${issue.kind}:${index}`}>
      <button type="button" onClick={() => onNavigate(issue)}>{issue.id} · {issue.field}: {t(issue.message)}</button>
    </li>)}</ul>}
    {visible.length > limit && <button type="button" onClick={() => setLimit((current) => current + 50)}>{t("Show more issues ({count} remaining)", { count: visible.length - limit })}</button>}
  </section>;
}
