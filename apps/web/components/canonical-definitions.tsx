"use client";

import { useEffect, useState } from "react";
import { exportCanonicalFile, importCanonicalFile, loadCanonicalFiles, type CanonicalFile } from "../app/admin-context";

export function CanonicalDefinitions({ kind, csrfToken, canPublish, selectedId, hasDraft }: {
  kind: "catalog" | "form" | "validation"; csrfToken: string; canPublish: boolean; selectedId: string; hasDraft: boolean;
}) {
  const [files, setFiles] = useState<CanonicalFile[]>([]);
  const [json, setJson] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try { setFiles(await loadCanonicalFiles(kind)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not discover canonical files"); }
  }
  useEffect(() => {
    let current = true;
    loadCanonicalFiles(kind).then((items) => { if (current) setFiles(items); })
      .catch((error: unknown) => { if (current) setMessage(error instanceof Error ? error.message : "Could not discover canonical files"); });
    return () => { current = false; };
  }, [kind]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "Canonical operation failed"); }
    finally { setBusy(false); }
  }
  async function install(content: unknown) {
    await importCanonicalFile(csrfToken, kind, content);
    window.location.reload();
  }
  return <details>
    <summary>Canonical JSON files</summary>
    <p>Import a published version from JSON. Publish or discard your draft first. Activation is a separate step.</p>
    <button type="button" disabled={busy} onClick={() => void refresh()}>Refresh files</button>
    <ul>{files.map((entry) => <li key={entry.file}>
      {entry.package ? `${entry.package.name ?? entry.file}${entry.package.version ? ` · source v${entry.package.version}` : ""}` : entry.file}
      {entry.installed && " — Installed"}
      {entry.error ? ` — ${entry.error}` : !entry.compatible ? " — Install the required catalog first" : ""}
      {entry.package && <button type="button" disabled={busy || !canPublish || hasDraft || !entry.compatible}
        onClick={() => void run(() => install(entry.package))}>Import published version</button>}
    </li>)}</ul>
    <label>Canonical JSON<textarea value={json} onChange={(event) => setJson(event.target.value)} rows={6} /></label>
    <button type="button" disabled={busy || !canPublish || hasDraft || !json.trim()}
      onClick={() => void run(() => install(JSON.parse(json)))}>Import pasted JSON</button>
    <button type="button" disabled={busy || !selectedId}
      onClick={() => void run(async () => {
        setJson(JSON.stringify(await exportCanonicalFile(csrfToken, kind, selectedId), null, 2));
        setMessage("Canonical file saved. You can copy the JSON above.");
        await refresh();
      })}>Export selected published version</button>
    {message && <p role="status">{message}</p>}
  </details>;
}
