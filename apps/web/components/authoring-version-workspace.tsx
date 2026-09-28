"use client";

import { AdminText, useAdminText } from "../app/admin-localization";

import type { AuthoringVersionOption } from "@open-triage/contracts";
import React from "react";

export function AuthoringVersionWorkspace({ title, versions, selectedId, onSelect, draftName, onDraftNameChange,
  onCreateDraft, canWrite, busy, hasDraft, canCreateWithoutSource = false, children }: {
  readonly title: string;
  readonly versions: readonly AuthoringVersionOption[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  readonly draftName: string;
  readonly onDraftNameChange: (name: string) => void;
  readonly onCreateDraft: () => void;
  readonly canWrite: boolean;
  readonly busy: boolean;
  readonly hasDraft: boolean;
  readonly canCreateWithoutSource?: boolean;
  readonly children?: React.ReactNode;
}) {
  const t = useAdminText();
  const selected = versions.find(({ id }) => id === selectedId);
  return <section className="authoring-version-workspace" aria-label={`${t(title)} ${t("admin.versions")}`}>
    <div className="authoring-version-row">
      <label htmlFor={`${title.replaceAll(" ", "-").toLowerCase()}-source-version`}><AdminText messageKey="admin.version2" /></label>
      <select id={`${title.replaceAll(" ", "-").toLowerCase()}-source-version`} value={selectedId}
        onChange={(event) => onSelect(event.target.value)} disabled={versions.length === 0}>
        {versions.length === 0 && <option value=""><AdminText messageKey="admin.noPublishedVersions" /></option>}
        {versions.map((version) => <option key={version.id} value={version.id}>
          {version.displayName} · v{version.version}{version.status === "active" ? ` · ${t("admin.active")}` : ""}
        </option>)}
      </select>
      {selected && <span className="authoring-version-state">{t(selected.status === "active" ? "Active" : "Published")}</span>}
    </div>
    {canWrite && !hasDraft && (selected || canCreateWithoutSource) && <div className="authoring-version-row">
      <label htmlFor={`${title.replaceAll(" ", "-").toLowerCase()}-draft-name`}><AdminText messageKey="admin.newDraft" /></label>
      <input id={`${title.replaceAll(" ", "-").toLowerCase()}-draft-name`} maxLength={120}
        placeholder={t("admin.titleVersionName", { title: t(title) })} value={draftName} onChange={(event) => onDraftNameChange(event.target.value)} />
      <button type="button" disabled={busy || !draftName.trim()} onClick={onCreateDraft}>
        {t(selected ? "Create draft from selected" : "Create draft")}</button>
    </div>}
    {hasDraft && <p role="status"><AdminText messageKey="admin.draftInProgress" /></p>}
    {children}
  </section>;
}

export function AuthoringLifecycleAction({ title, kind, note, onNoteChange, onSubmit, disabled = false,
  detail, buttonLabel }: {
  readonly title: string;
  readonly kind: "publish" | "activate";
  readonly note: string;
  readonly onNoteChange: (note: string) => void;
  readonly onSubmit: () => void;
  readonly disabled?: boolean;
  readonly detail?: string;
  readonly buttonLabel?: string;
}) {
  const t = useAdminText();
  const id = `${title.replaceAll(" ", "-").toLowerCase()}-${kind}-note`;
  return <section className="authoring-lifecycle-action" aria-label={`${t(kind === "publish" ? "Publish" : "Activate")} ${t(title)}`}>
    {detail && <p>{t(detail)}</p>}
    <div className="authoring-version-row"><label htmlFor={id}>{t(kind === "publish" ? "Publication note" : "Activation note")}</label>
      <textarea id={id} value={note} onChange={(event) => onNoteChange(event.target.value)} />
      <button type="button" disabled={disabled || !note.trim()} onClick={onSubmit}>
        {t(buttonLabel ?? (kind === "publish" ? "Publish version" : "Activate version"))}
      </button>
    </div>
  </section>;
}
