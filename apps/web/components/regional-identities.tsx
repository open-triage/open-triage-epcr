"use client";
import type { AdminAssignableRoleSummary, AdminRegionalIdentitySummary, AdminUserSummary } from "@open-triage/contracts";
import { useEffect, useRef, useState } from "react";
import { resolveMessage } from "../app/localization";
import { useAdminError } from "../app/admin-localization";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
import { platformRequestError } from "../app/platform-errors";
import { authenticationInstallationGeneration, assertAuthenticationInstallationGeneration, InstallationContextChangedError } from "../app/installation-transition-generation";
import { loadAdminUsers, loadAdminUserRoleOptions } from "../app/admin-context";
import { reauthenticateClinicianSession } from "../app/clinician-session";
import { PersonalAuthenticationField, usePasswordAuthentication } from "./personal-authentication";
import { useUnsavedChanges } from "./unsaved-changes";

/** The Users Manage action owns review; no second directory or account is created. */
export function RegionalIdentityManagement({ identity, language, csrfToken, canManage, canApprove,
  onComplete, onDirtyChange, onBusyChange }: {
  identity: AdminRegionalIdentitySummary; language: string; csrfToken: string; canManage: boolean; canApprove: boolean;
  onComplete: (result: AdminRegionalIdentitySummary, action: "approve" | "link" | "deny") => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = (key: string) => resolveMessage(language, key);
  const adminError = useAdminError(), needsPassword = usePasswordAuthentication();
  const initialName = (identity.displayName ?? "").slice(0, 200);
  const [mode, setMode] = useState<"approve" | "link" | "deny">(canApprove ? "approve" : "link");
  const [displayName, setDisplayName] = useState(initialName), [roleIds, setRoleIds] = useState<string[]>([]);
  const [roleOptions, setRoleOptions] = useState<AdminAssignableRoleSummary[]>([]), [rolesLoaded, setRolesLoaded] = useState(false);
  const [users, setUsers] = useState<AdminUserSummary[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState(""), [userId, setUserId] = useState("");
  const [providerSource, setProviderSource] = useState(identity.reviewProviders?.some(p => p.source === "active") ? "active" : "draft");
  const [password, setPassword] = useState(""), [note, setNote] = useState(""), [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0), userRequest = useRef(0);
  const dirty = displayName !== initialName || !!roleIds.length || !!userId || !!password || !!note;
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
      .catch(reason => { if (current(saved) && active) setError(adminError(reason, "admin.regionalIdentityRolesLoadFailed")); });
    return()=>{active=false;};
  }, [canApprove, adminError]); // eslint-disable-line react-hooks/exhaustive-deps
  async function loadUsers(page?: string) {
    const saved = stamp(), revision = ++userRequest.current;
    setBusy(true);
    try {
      const result = await loadAdminUsers({ state: "active", search, cursor: page, limit: 25 });
      if (!current(saved) || revision !== userRequest.current) return;
      setUsers(result.items.filter(user => !user.owner && !user.superadmin && !user.regionalIdentity));
      setCursor(result.nextCursor); setError("");
    } catch (reason) { if (current(saved)) setError(adminError(reason, "admin.regionalIdentityCouldNotLoadUsersPreviously")); }
    finally { if (current(saved) && revision === userRequest.current) setBusy(false); }
  }
  const provider = identity.reviewProviders?.find(p => p.source === providerSource);
  const valid = mode === "deny" ? identity.status !== "denied" : !!provider && (mode === "link" ? !!userId : rolesLoaded && !!displayName.trim());
  return <>
    <p>{t("admin.regionalIdentityAValidatedRegionalIdentityRemains")}</p>
    <dl className="admin-regional-identity-details">
      <div><dt>{t("admin.status")}</dt><dd>{t(identity.status === "denied" ? "admin.regionalIdentityDenied" : "admin.regionalIdentityPending")}</dd></div>
      <div><dt>{t("admin.regionalIdentityIssuer")}</dt><dd>{identity.issuer}</dd></div>
      <div><dt>{t("admin.regionalIdentitySubject")}</dt><dd>{identity.subject}</dd></div>
      <div><dt>{t("admin.regionalIdentityProfileHints")}</dt><dd>{identity.displayName ?? t("admin.regionalIdentityNoDisplayName")} / {identity.email ?? t("admin.regionalIdentityNoEmail")}</dd></div>
    </dl>
    {identity.status === "denied" && <p>{t("admin.regionalIdentityDeniedHelp")}</p>}
    {!canManage ? <p>{t("admin.regionalIdentityUserManagementAndAuthenticationWrite")}</p> : <>
      <nav className="form-actions" aria-label={t("admin.regionalIdentityReviewAction")}>
        {canApprove && <button type="button" aria-pressed={mode === "approve"} disabled={busy} onClick={() => setMode("approve")}>{t("admin.regionalIdentityChooseApproval")}</button>}
        <button type="button" aria-pressed={mode === "link"} disabled={busy} onClick={() => { setMode("link"); if (!users.length) void loadUsers(); }}>{t("admin.regionalIdentityChooseLink")}</button>
        <button type="button" aria-pressed={mode === "deny"} disabled={busy || identity.status === "denied"} onClick={() => setMode("deny")}>{t("admin.regionalIdentityDeny")}</button>
      </nav>
      <form className="admin-user-create admin-user-management-form" onSubmit={async event => {
        event.preventDefault(); if (busy || !valid || needsPassword && !password) return;
        const saved = stamp(); setBusy(true); setError("");
        try {
          await reauthenticateClinicianSession(password, csrfToken);
          if (!current(saved)) throw new InstallationContextChangedError();
          setPassword("");
          const url = apiRequestUrl(`/api/admin/authentication/identities/${identity.id}/${mode}`);
          if (!url) throw new Error(t("admin.regionalIdentityApiRequired"));
          const command = { expectedReviewRevision: identity.reviewRevision, ...(mode === "deny" ? { note } : {
            providerSource, expectedProviderRevision: provider!.revision, ...(mode === "link" ? { userId } : { displayName, roleIds, note })
          }) };
          const response = await fetch(url, browserRequestInit({ method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(command) }));
          if (!response.ok) throw await platformRequestError(response);
          const result = await response.json() as AdminRegionalIdentitySummary;
          if (!current(saved)) throw new InstallationContextChangedError();
          onDirtyChange(false); onComplete(result, mode);
        } catch (reason) { if (current(saved)) { setPassword(""); setError(adminError(reason, "admin.regionalIdentityReviewFailed")); } }
        finally { if (current(saved)) setBusy(false); }
      }}>
        <fieldset disabled={busy}>
          <legend>{t(mode === "deny" ? "admin.regionalIdentityDeny" : mode === "link" ? "admin.regionalIdentityChooseLink" : "admin.regionalIdentityChooseApproval")}</legend>
          {mode === "approve" ? <>
            <p>{t("admin.regionalIdentityApprovalHelp")}</p>
            <label>{t("admin.displayName")}<input required maxLength={200} value={displayName} onChange={e => setDisplayName(e.target.value)} autoComplete="off" /></label>
            <fieldset className="admin-role-selection"><legend>{t("admin.completeRetainedRole")}</legend>
              {roleOptions.map(role => <label key={role.id}><input type="checkbox" checked={roleIds.includes(role.id)} disabled={!role.active || !role.assignmentMutable}
                onChange={e => setRoleIds(ids => e.target.checked ? [...ids, role.id] : ids.filter(id => id !== role.id))} />{role.displayName}</label>)}
            </fieldset><p>{t("admin.regionalIdentityEmptyRoles")}</p>
          </> : mode === "link" ? <>
            <label>{t("admin.regionalIdentityFindExistingUser")}<input type="search" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} /></label>
            <div className="form-actions"><button type="button" onClick={() => void loadUsers()}>{t("admin.regionalIdentitySearchUsers")}</button><button type="button" disabled={!cursor} onClick={() => cursor && void loadUsers(cursor)}>{t("admin.regionalIdentityMoreUsers")}</button></div>
            <label>{t("admin.regionalIdentityExistingApplicationUser")}<select required value={userId} onChange={e => setUserId(e.target.value)}><option value="">{t("admin.regionalIdentityChooseExplicitly")}</option>
              {userId && !users.some(u => u.id === userId) && <option value={userId}>{userId}</option>}
              {users.map(user => <option key={user.id} value={user.id}>{user.displayName} ({user.username ?? t("admin.ssoOnly")})</option>)}
            </select></label><p>{t("admin.regionalIdentityConfirmThisIsTheSame")}</p>
          </> : <p>{t("admin.regionalIdentityDenyHelp")}</p>}
          {mode !== "deny" && <><label>{t("admin.regionalIdentityReviewProvider")}<select required value={providerSource} onChange={e => setProviderSource(e.target.value)}>
            {identity.reviewProviders?.map(p => <option key={p.source} value={p.source}>{t(p.source === "active" ? "admin.regionalIdentityActiveProvider" : "admin.regionalIdentityDraftProvider")} — {t("admin.regionalIdentityRevision")} {p.revision}</option>)}
          </select></label>{providerSource === "draft" && <p>{t("admin.regionalIdentityDraftProvider")}</p>}{!provider && <p role="status">{t("admin.regionalIdentityProviderUnavailable")}</p>}</>}
          {mode !== "link" && <label>{t("admin.noteOptional")}<textarea maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label>}
          <PersonalAuthenticationField language={language} value={password} onChange={setPassword} label={t("admin.regionalIdentityReviewPassword")} />
          {error && <p role="alert" className="admin-error">{error}</p>}
          <div className="form-actions admin-management-actions"><button className={mode === "deny" ? "button-danger" : "button-primary"} type="submit" disabled={busy || !valid || needsPassword && !password}>
            {t(mode === "deny" ? "admin.regionalIdentityDeny" : mode === "link" ? "admin.regionalIdentityLinkExistingUser" : "admin.regionalIdentityApproveNew")}
          </button></div>
        </fieldset>
      </form>
    </>}
  </>;
}
