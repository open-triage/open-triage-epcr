"use client";
import type { AdminAssignableRoleSummary, AdminExternalIdentitySummary, AdminUserSummary } from "@open-triage/contracts";
import { useEffect, useRef, useState } from "react";
import { resolveMessage } from "../app/localization";
import { useAdminError } from "../app/admin-localization";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { platformRequestError } from "../app/platform-errors";
import { authenticationInstallationGeneration, assertAuthenticationInstallationGeneration, InstallationContextChangedError } from "../app/installation-transition-generation";
import { loadAdminUsers, loadAdminUserRoleOptions } from "../app/admin-context";
import { useUnsavedChanges } from "./unsaved-changes";

/** The Users Manage action owns review; no second directory or account is created. */
export function ExternalIdentityManagement({ identity, language, csrfToken, canManage, canApprove,
  onComplete, onDirtyChange, onBusyChange }: {
  identity: AdminExternalIdentitySummary; language: string; csrfToken: string; canManage: boolean; canApprove: boolean;
  onComplete: (result: AdminExternalIdentitySummary, action: "approve" | "link" | "deny") => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = (key: string) => resolveMessage(language, key);
  const adminError = useAdminError();
  const initialName = (identity.displayName ?? "").slice(0, 200);
  const [mode, setMode] = useState<"approve" | "link" | "deny">(canApprove ? "approve" : "link");
  const [displayName, setDisplayName] = useState(initialName), [roleIds, setRoleIds] = useState<string[]>([]);
  const [roleOptions, setRoleOptions] = useState<AdminAssignableRoleSummary[]>([]), [rolesLoaded, setRolesLoaded] = useState(false);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [userId, setUserId] = useState("");
  const [providerSource, setProviderSource] = useState(identity.reviewProviders?.some(p => p.source === "active") ? "active" : "draft");
  const [note, setNote] = useState(""), [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0), userRequest = useRef(0);
  const dirty = displayName !== initialName || !!roleIds.length || !!userId || !!note;
  useUnsavedChanges(dirty);
  useEffect(() => { onBusyChange(busy); }, [busy,onBusyChange]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { epoch.current++; userRequest.current++; onDirtyChange(false); onBusyChange(false); }, [onDirtyChange,onBusyChange]);
  const stamp = () => ({ epoch: epoch.current, generation: authenticationInstallationGeneration() });
  const current = (saved: ReturnType<typeof stamp>) => {
    if (saved.epoch !== epoch.current) return false;
    try { assertAuthenticationInstallationGeneration(saved.generation); return true; } catch { return false; }
  };
  useEffect(() => {
    if (!canApprove) return;
    const saved = stamp(); let active=true;
    loadAdminUserRoleOptions().then(value => { if (current(saved) && active) { setRoleOptions(value.items); setRolesLoaded(true); } })
      .catch(reason => { if (current(saved) && active) setError(adminError(reason, "admin.externalIdentityRolesLoadFailed")); });
    return()=>{active=false;};
  }, [canApprove, adminError]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mode === "link" && canManage) void loadUsers();
  }, [mode, canManage]); // eslint-disable-line react-hooks/exhaustive-deps
  async function loadUsers() {
    const saved = stamp(), revision = ++userRequest.current;
    setBusy(true);
    try {
      const eligible: AdminUserSummary[] = [];
      let cursor: string | undefined;
      do {
        const result = await loadAdminUsers({ state: "active", cursor, limit: 100 });
        if (!current(saved) || revision !== userRequest.current) return;
        eligible.push(...result.items.filter(user => !user.owner && !user.superadmin && !user.externalIdentity));
        cursor = result.nextCursor ?? undefined;
      } while (cursor);
      setUsers(eligible); setError("");
    } catch (reason) { if (current(saved)) setError(adminError(reason, "admin.externalIdentityCouldNotLoadUsersPreviously")); }
    finally { if (current(saved) && revision === userRequest.current) setBusy(false); }
  }
  const provider = identity.reviewProviders?.find(p => p.source === providerSource);
  const valid = mode === "deny" ? identity.status !== "denied" : !!provider && (mode === "link" ? !!userId : rolesLoaded && !!displayName.trim());
  return <>
    <p>{t("admin.externalIdentityPendingHelp")}</p>
    <dl className="admin-external-identity-details">
      <div><dt>{t("admin.status")}</dt><dd>{t(identity.status === "denied" ? "admin.externalIdentityDenied" : "admin.externalIdentityPending")}</dd></div>
      <div><dt>{t("admin.externalIdentityIssuer")}</dt><dd>{identity.issuer}</dd></div>
      <div><dt>{t("admin.externalIdentitySubject")}</dt><dd>{identity.subject}</dd></div>
      <div><dt>{t("admin.ssoUsername")}</dt><dd>{identity.username??t("admin.ssoUsernameUnavailable")}</dd></div>
      <div><dt>{t("admin.externalIdentityProfileHints")}</dt><dd>{identity.displayName ?? t("admin.externalIdentityNoDisplayName")} / {identity.email ?? t("admin.externalIdentityNoEmail")}</dd></div>
    </dl>
    {identity.status === "denied" && <p>{t("admin.externalIdentityDeniedHelp")}</p>}
    {!canManage ? <p>{t("admin.externalIdentityUserManagementAndAuthenticationWrite")}</p> : <>
      <nav className="form-actions" aria-label={t("admin.externalIdentityReviewAction")}>
        {canApprove && <button type="button" aria-pressed={mode === "approve"} disabled={busy} onClick={() => setMode("approve")}>{t("admin.externalIdentityChooseApproval")}</button>}
        <button type="button" aria-pressed={mode === "link"} disabled={busy} onClick={() => { if (mode === "link") void loadUsers(); else setMode("link"); }}>{t("admin.externalIdentityChooseLink")}</button>
        <button type="button" aria-pressed={mode === "deny"} disabled={busy || identity.status === "denied"} onClick={() => setMode("deny")}>{t("admin.externalIdentityDeny")}</button>
      </nav>
      <form className="admin-user-create admin-user-management-form" onSubmit={async event => {
        event.preventDefault(); if (busy || !valid) return;
        const saved = stamp(); setBusy(true); setError("");
        try {
          if (!current(saved)) throw new InstallationContextChangedError();

          const url = apiRequestUrl(`/api/admin/authentication/identities/${identity.id}/${mode}`);
          if (!url) throw new Error(t("admin.externalIdentityApiRequired"));
          const command = { expectedReviewRevision: identity.reviewRevision, ...(mode === "deny" ? { note } : {
            providerSource, expectedProviderRevision: provider!.revision, ...(mode === "link" ? { userId } : { displayName, roleIds, note })
          }) };
          const response = await fetch(url, browserRequestInit({ method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(command) }));
          if (!response.ok) throw await platformRequestError(response);
          const result = await response.json() as AdminExternalIdentitySummary;
          if (!current(saved)) throw new InstallationContextChangedError();
          onDirtyChange(false); onComplete(result, mode);
        } catch (reason) { if (current(saved)) {  setError(adminError(reason, "admin.externalIdentityReviewFailed")); } }
        finally { if (current(saved)) setBusy(false); }
      }}>
        <fieldset disabled={busy}>
          <legend>{t(mode === "deny" ? "admin.externalIdentityDeny" : mode === "link" ? "admin.externalIdentityChooseLink" : "admin.externalIdentityChooseApproval")}</legend>
          {mode === "approve" ? <>
            <label>{t("admin.displayName")}<input required maxLength={200} value={displayName} onChange={e => setDisplayName(e.target.value)} autoComplete="off" /></label>
            <fieldset className="admin-role-selection"><legend>{t("admin.completeRetainedRole")}</legend>
              {roleOptions.map(role => <label key={role.id}><input type="checkbox" checked={roleIds.includes(role.id)} disabled={!role.active || !role.assignmentMutable}
                onChange={e => setRoleIds(ids => e.target.checked ? [...ids, role.id] : ids.filter(id => id !== role.id))} />{role.displayName}</label>)}
            </fieldset>
          </> : mode === "link" ? <>
            <label>{t("admin.externalIdentityExistingApplicationUser")}<select required value={userId} onChange={e => setUserId(e.target.value)}><option value="">{t("admin.externalIdentityChooseExplicitly")}</option>
              {userId && !users.some(u => u.id === userId) && <option value={userId}>{userId}</option>}
              {users.map(user => <option key={user.id} value={user.id}>{user.displayName} ({user.username ?? user.ssoUsername ?? t("admin.ssoOnly")})</option>)}
            </select></label><p>{t("admin.externalIdentityConfirmThisIsTheSame")}</p>
          </> : <p>{t("admin.externalIdentityDenyHelp")}</p>}
          {mode !== "deny" && <><label>{t("admin.externalIdentityReviewProvider")}<select required value={providerSource} onChange={e => setProviderSource(e.target.value)}>
            {identity.reviewProviders?.map(p => <option key={p.source} value={p.source}>{t(p.source === "active" ? "admin.externalIdentityActiveProvider" : "admin.externalIdentityDraftProvider")} — {t("admin.externalIdentityRevision")} {p.revision}</option>)}
          </select></label>{providerSource === "draft" && <p>{t("admin.externalIdentityDraftProvider")}</p>}{!provider && <p role="status">{t("admin.externalIdentityProviderUnavailable")}</p>}</>}
          {mode !== "link" && <label>{t("admin.noteOptional")}<textarea maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label>}
          {error && <p role="alert" className="admin-error">{error}</p>}
          <div className="form-actions admin-management-actions"><button className={mode === "deny" ? "button-danger" : "button-primary"} type="submit" disabled={busy || !valid}>
            {t(mode === "deny" ? "admin.externalIdentityDeny" : mode === "link" ? "admin.externalIdentityLinkExistingUser" : "admin.externalIdentityApproveNew")}
          </button></div>
        </fieldset>
      </form>
    </>}
  </>;
}
