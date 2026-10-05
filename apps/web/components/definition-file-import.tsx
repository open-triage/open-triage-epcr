"use client";

import React, { useEffect, useEffectEvent, useId, useState } from "react";
import { loadCanonicalFiles, type CanonicalFile } from "../app/admin-context";
import { useAdminError, useAdminText } from "../app/admin-localization";

export function DefinitionFileImport({ kind, busy, hasDraft, enabled = true, onImport }: {
  readonly kind: "catalog" | "form" | "validation";
  readonly enabled?: boolean;
  readonly busy: boolean;
  readonly hasDraft: boolean;
  readonly onImport: (file: string) => Promise<void>;
}) {
  const t = useAdminText();
  const adminError = useAdminError();
  const id = useId();
  const [settledKind, setSettledKind] = useState("");
  const [retry, setRetry] = useState(0);
  const loading = settledKind !== kind;
  const [files, setFiles] = useState<CanonicalFile[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const file = files.find((entry) => entry.file === selected);

  const showError = useEffectEvent((reason: unknown) => setError(adminError(reason, "admin.definitionFilesUnavailable")));
  useEffect(() => {
    if (!enabled || hasDraft) return;
    const controller = new AbortController();
    void loadCanonicalFiles(kind, controller.signal).then((items) => {
      if (controller.signal.aborted) return;
      setFiles(items); setError("");
      setSelected((previous) => items.some((entry) => entry.file === previous) ? previous
        : items.find((entry) => entry.compatible && !entry.error)?.file ?? items[0]?.file ?? "");
    }).catch((reason) => { if (!controller.signal.aborted) showError(reason); })
      .finally(() => { if (!controller.signal.aborted) setSettledKind(kind); });
    return () => controller.abort();
  }, [enabled, hasDraft, kind, retry]);

  function refresh() {
    setSettledKind(""); setError(""); setRetry((value) => value + 1);
  }

  // An existing draft prevents importing; do not scan and parse definition files
  // until importing becomes available again.
  if (hasDraft) return <p role="status">{t("admin.definitionImportDraft")}</p>;

  return <div className="definition-file-import">
    <div id={id}>
      <div className="authoring-version-row definition-file-import-row">
        <label htmlFor={`${id}-file`}>{t("admin.definitionFile")}</label>
        <select id={`${id}-file`} value={selected} disabled={!enabled || busy || loading || files.length === 0}
          onChange={(event) => setSelected(event.target.value)}>
          {files.length === 0 && <option value="">{t(loading ? "admin.loadingDefinitionFiles" : "admin.noDefinitionFiles")}</option>}
          {files.map((entry) => <option key={entry.file} value={entry.file}>{entry.file}</option>)}
        </select>
        <button type="button" className="button-primary"
          disabled={!enabled || busy || loading || !file?.compatible || !!file.error}
          onClick={() => { if (file) void onImport(file.file); }}>{t("admin.importSelectedDefinition")}</button>
        <button type="button" disabled={!enabled || busy || loading} onClick={() => void refresh()}>{t("admin.refreshDefinitionFiles")}</button>
      </div>
      {file && (!file.compatible || file.error) && <p role="alert">{t("admin.definitionFileIncompatible")}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  </div>;
}
