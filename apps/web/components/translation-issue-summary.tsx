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
  return <section aria-label={t("admin.translationDiagnostics")}>
    <p role="status">{t("admin.englishMissingEnglish", { english: count("english"), swedish: count("agency") })}</p>
    <label><AdminText messageKey="admin.showWordingIssues" /> <select value={filter} onChange={(event) => onFilter(event.target.value)}>
      <option value="all"><AdminText messageKey="admin.allIssues" /></option><option value="english"><AdminText messageKey="admin.missingEnglish" /></option>
      <option value="agency"><AdminText messageKey="admin.missingSwedish" /></option>
    </select></label>
    {visible.length > 0 && <ul>{visible.slice(0, limit).map((issue, index) => <li key={`${issue.id}:${issue.field}:${issue.kind}:${index}`} onClick={(event) => {
      if (!(event.target as HTMLElement).closest("button, a")) onNavigate(issue);
    }}>
      <span>{issue.id} · {issue.field}: {t(issue.message)}</span>{" "}
      <button type="button" aria-label={`${t("admin.viewDetails")} ${issue.id} · ${issue.field}`} onClick={() => onNavigate(issue)}>{t("admin.viewDetails")}</button>
    </li>)}</ul>}
    {visible.length > limit && <button type="button" onClick={() => setLimit((current) => current + 50)}>{t("admin.showMoreIssues", { count: visible.length - limit })}</button>}
  </section>;
}
