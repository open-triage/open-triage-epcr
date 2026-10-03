"use client";

import React, { useCallback, useEffect, useId, useState } from "react";
import { loadCanonicalFiles, type CanonicalFile } from "../app/admin-context";
import { useAdminError, useAdminText } from "../app/admin-localization";

export function DefinitionFileImport({ kind, busy, hasDraft, onImport }: {
  readonly kind: "catalog" | "form" | "validation";
  readonly busy: boolean;
  readonly hasDraft: boolean;
  readonly onImport: (file: string) => Promise<void>;
}) {
  const t = useAdminText();
  const adminError = useAdminError();
  const id = useId();
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<CanonicalFile[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const file = files.find((entry) => entry.file === selected);

  const loadFiles = useCallback(() => {
    return loadCanonicalFiles(kind).then((items) => {
      setFiles(items);
      setSelected((previous) => items.some((entry) => entry.file === previous) ? previous
        : items.find((entry) => entry.compatible && !entry.error)?.file ?? items[0]?.file ?? "");
    }).catch((reason) => { setError(adminError(reason, "admin.definitionFilesUnavailable")); })
      .finally(() => { setLoading(false); });
  }, [kind, adminError]);

  useEffect(() => { void loadFiles(); }, [loadFiles]);

  function refresh() {
    setLoading(true); setError("");
    void loadFiles();
  }

  return <div className="definition-file-import">
    <div id={id}>
      <div className="authoring-version-row definition-file-import-row">
        <label htmlFor={`${id}-file`}>{t("admin.definitionFile")}</label>
        <select id={`${id}-file`} value={selected} disabled={busy || loading || files.length === 0}
          onChange={(event) => setSelected(event.target.value)}>
          {files.length === 0 && <option value="">{t(loading ? "admin.loadingDefinitionFiles" : "admin.noDefinitionFiles")}</option>}
          {files.map((entry) => <option key={entry.file} value={entry.file}>{entry.file}</option>)}
        </select>
        <button type="button" className="button-primary"
          disabled={busy || loading || hasDraft || !file?.compatible || !!file.error}
          onClick={() => { if (file) void onImport(file.file); }}>{t("admin.importSelectedDefinition")}</button>
        <button type="button" disabled={busy || loading} onClick={() => void refresh()}>{t("admin.refreshDefinitionFiles")}</button>
      </div>
      {hasDraft && <p role="status">{t("admin.definitionImportDraft")}</p>}
      {file && (!file.compatible || file.error) && <p role="alert">{t("admin.definitionFileIncompatible")}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  </div>;
}
