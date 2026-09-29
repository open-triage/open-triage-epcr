"use client";

import { AdminText, useAdminCapabilityText, useAdminError, useAdminText } from "../app/admin-localization";

import type { AdminAssignableRoleSummary, AdminCapabilityOption, AdminRole, AdminRoleHistory, AdminRoleSummary, AdminSessionSummary, AdminUserSummary, ProvisionAdminUserCommand, ReplaceAdminUserRolesCommand, ResetAdminCredentialCommand, SaveAdminRoleCommand, UpdateAdminUserCommand } from "@open-triage/contracts";
import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { createAdminRole, deactivateAdminRole, loadAdminRoleCapabilities, loadAdminRoleHistory, loadAdminRoles,
  loadAdminUserRoleOptions, loadAdminUserSessions, loadAdminUsers, provisionAdminUser, reactivateAdminRole,
  replaceAdminUserRoles, resetAdminUserCredential, revokeAdminUserSession, updateAdminRole, updateAdminUser,
  type AdminUserQuery } from "../app/admin-context";
import { reauthenticateClinicianSession } from "../app/clinician-session";
import { selectedInstallationSettings } from "../app/installation-settings";
import { OwnershipTransferPanel } from "./ownership-transfer";

type StateFilter = "active" | "disabled" | "all";
const temporaryPasswordHours = selectedInstallationSettings().authentication.temporaryPasswordHours;

function RoleBadges({ roles, effective = true, owner = false }: {
  readonly roles: AdminRoleSummary[]; readonly effective?: boolean; readonly owner?: boolean;
}) {
  const t = useAdminText();
  if (!roles.length && !owner) return <span className="admin-muted"><AdminText messageKey="admin.noRoles" /></span>;
  return <ul className="admin-role-badges" aria-label={t("admin.assignedRoles")}>
    {owner && <li className="admin-owner-role"><AdminText messageKey="admin.owner" /></li>}
    {roles.map((role) => <li key={role.id}>{role.displayName}{!role.active
      ? t("admin.deactivated2") : !effective ? t("admin.retainedIneffectiveWhile") : ""}</li>)}
  </ul>;
}

export function UsersPanel({ canCreate = false, canManage = false, canAssignRoles = false,
  canViewSessions = false, canRevokeSessions = false, canResetCredentials = false,
  currentUserId = "", csrfToken = "" }: {
  readonly canCreate?: boolean;
  readonly canManage?: boolean;
  readonly canAssignRoles?: boolean;
  readonly canViewSessions?: boolean;
  readonly canRevokeSessions?: boolean;
  readonly canResetCredentials?: boolean;
  readonly currentUserId?: string;
  readonly csrfToken?: string;
}) {
  const t = useAdminText();
  const adminError = useAdminError();
  const [items, setItems] = useState<AdminUserSummary[]>([]);
  const [roleOptions, setRoleOptions] = useState<AdminAssignableRoleSummary[]>([]);
  const [query, setQuery] = useState<AdminUserQuery>({ state: "active" });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUserSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [desiredActive, setDesiredActive] = useState(false);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [roleNote, setRoleNote] = useState("");
  const [reauthenticationPassword, setReauthenticationPassword] = useState("");
  const [userSessions, setUserSessions] = useState<AdminSessionSummary[]>([]);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const hasActions = canManage || canViewSessions || canResetCredentials;

  async function load(selected: AdminUserQuery, append = false) {
    setLoading(true);
    setError(null);
    try {
      const page = await loadAdminUsers(selected);
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setError(adminError(reason, "admin.usersCouldNot"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAdminUsers({ state: "active" }).then((page) => {
      setItems(page.items);
      setNextCursor(page.nextCursor);
    }).catch((reason: unknown) => setError(adminError(reason, "admin.usersCouldNot")))
      .finally(() => setLoading(false));
    loadAdminUserRoleOptions().then((result) => setRoleOptions(result.items)).catch(() => setRoleOptions([]));
  }, [adminError]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const selected: AdminUserQuery = {
      search: String(data.get("search") ?? ""),
      state: String(data.get("state") ?? "active") as StateFilter,
      roleId: String(data.get("roleId") ?? "")
    };
    setQuery(selected);
    void load(selected);
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const command: ProvisionAdminUserCommand = {
      username: String(data.get("username") ?? ""),
      displayName: String(data.get("displayName") ?? ""),
      temporaryPassword: String(data.get("temporaryPassword") ?? ""),
      temporaryPasswordHours,
      roleIds: data.getAll("roleIds").map(String),
      note: String(data.get("note") ?? "") || undefined
    };
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const created = await provisionAdminUser(csrfToken, command);
      form.reset();
      setCreateOpen(false);
      setNotice(`${created.displayName} was created. Their temporary password expires ${new Date(created.temporaryPasswordExpiresAt).toLocaleString()}.`);
      await load(query);
    } catch (reason) {
      setError(adminError(reason, "admin.userCreationFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function refreshSessions(userId: string) {
    if (!canViewSessions) return;
    setSecurityLoading(true);
    try {
      setUserSessions((await loadAdminUserSessions(userId)).items);
    } catch (reason) {
      setError(adminError(reason, "admin.sessionsCouldNot"));
    } finally {
      setSecurityLoading(false);
    }
  }

  function beginEdit(user: AdminUserSummary) {
    setEditing(user);
    setDesiredActive(user.active);
    setSelectedRoleIds(user.roles.map((role) => role.id));
    setRoleNote("");
    setReauthenticationPassword("");
    setError(null);
    setNotice(null);
    setUserSessions([]);
    void refreshSessions(user.id);
  }

  async function revokeSession(session: AdminSessionSummary) {
    if (!editing) return;
    const warning = session.owner
      ? "This is an installation owner session. Confirm that you want to revoke it."
      : session.current ? "This is your current session. Revoking it will sign you out. Continue?"
        : "Revoke this session?";
    if (!window.confirm(warning)) return;
    setSecurityLoading(true);
    setError(null);
    try {
      const result = await revokeAdminUserSession(csrfToken, editing.id, session.id, session.owner);
      if (result.currentSessionRevoked) {
        window.location.reload();
        return;
      }
      setNotice(t("admin.selectedSessionRevoked"));
      await refreshSessions(editing.id);
    } catch (reason) {
      setError(adminError(reason, "admin.sessionRevocationFailed"));
    } finally {
      setSecurityLoading(false);
    }
  }

  async function resetCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const command: ResetAdminCredentialCommand = { expectedRevision: editing.revision,
      temporaryPassword: String(data.get("temporaryPassword") ?? ""),
      temporaryPasswordHours,
      note: String(data.get("note") ?? "") || undefined };
    if (!window.confirm(`Reset ${editing.displayName}'s credential and revoke every session?`)) return;
    setResetting(true);
    setError(null);
    try {
      const reset = await resetAdminUserCredential(csrfToken, editing.id, command);
      form.reset();
      setEditing((current) => current ? { ...current, revision: reset.revision } : current);
      setUserSessions([]);
      setNotice(`${editing.displayName}'s temporary credential expires ${new Date(reset.temporaryPasswordExpiresAt).toLocaleString()}. ${reset.sessionsRevoked} session${reset.sessionsRevoked === 1 ? " was" : "s were"} revoked. Account status was not changed.`);
      await load(query);
    } catch (reason) {
      setError(adminError(reason, "admin.credentialResetFailed"));
    } finally {
      setResetting(false);
    }
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const active = data.get("active") === "true";
    const command: UpdateAdminUserCommand = {
      expectedRevision: editing.revision,
      username: String(data.get("username") ?? ""),
      displayName: String(data.get("displayName") ?? ""),
      active,
      note: String(data.get("note") ?? "") || undefined
    };
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateAdminUser(csrfToken, editing.id, command);
      setEditing(null);
      setNotice(updated.restoredRoles.length
        ? `${updated.displayName} was reactivated. Roles restored: ${updated.restoredRoles.map((role) => role.displayName).join(", ") || "none"}. A fresh login is required; the credential was not reset.`
        : !updated.active
          ? `${updated.displayName} was disabled and ${updated.sessionsRevoked} active session${updated.sessionsRevoked === 1 ? " was" : "s were"} revoked. Roles are retained but ineffective.`
          : `${updated.displayName} was updated.`);
      await load(query);
    } catch (reason) {
      setError(adminError(reason, "admin.userUpdateFailed"));
    } finally {
      setSaving(false);
    }
  }

  const protectedRoleSetChanged = Boolean(editing && roleOptions.some((role) => role.assignmentRestricted &&
    (selectedRoleIds.includes(role.id) !== editing.roles.some((assigned) => assigned.id === role.id))));

  async function saveRoles() {
    if (!editing || !canAssignRoles) return;
    const command: ReplaceAdminUserRolesCommand = { expectedRevision: editing.revision,
      roleIds: selectedRoleIds, note: roleNote || undefined };
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (protectedRoleSetChanged) {
        await reauthenticateClinicianSession(reauthenticationPassword, csrfToken);
      }
      const updated = await replaceAdminUserRoles(csrfToken, editing.id, command);
      setEditing(updated);
      setSelectedRoleIds(updated.roles.map((role) => role.id));
      setRoleNote("");
      setReauthenticationPassword("");
      setNotice(`Roles updated for ${updated.displayName}. Added: ${updated.addedRoles.map((role) => role.displayName).join(", ") || "none"}; removed: ${updated.removedRoles.map((role) => role.displayName).join(", ") || "none"}.${updated.active ? "" : " Roles remain ineffective until reactivation."}`);
      await load(query);
    } catch (reason) {
      setError(adminError(reason, "admin.roleSetUpdateFailed"));
    } finally {
      setSaving(false);
    }
  }

  return <section className="admin-configuration admin-directory" aria-labelledby="users-heading">
    <div className="section-heading"><h2 id="users-heading"><AdminText messageKey="admin.users" /></h2>{canCreate && <button type="button"
      aria-expanded={createOpen} aria-controls="create-user-form" onClick={() => setCreateOpen((open) => !open)}>
      {createOpen ? t("admin.cancelCreation") : t("admin.createUser")}</button>}</div>
    {canCreate && createOpen && <form id="create-user-form" className="admin-user-create" onSubmit={createUser}>
      <fieldset disabled={creating}><legend><AdminText messageKey="admin.newLocalUser" /></legend>
        <label><AdminText messageKey="admin.displayName" /><input name="displayName" maxLength={200} required autoComplete="off" /></label>
        <label><AdminText messageKey="admin.username" /><input name="username" minLength={3} maxLength={128} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,127}"
          required autoComplete="off" /></label>
        <label><AdminText messageKey="admin.temporaryPassword" /><input name="temporaryPassword" type="password" minLength={12} maxLength={1024}
          required autoComplete="new-password" /></label>
        <p className="admin-muted">{t("admin.temporaryAccessExpires", { hours: temporaryPasswordHours })}</p>
        <fieldset className="admin-role-selection"><legend><AdminText messageKey="admin.initialRoles" /></legend>
          {roleOptions.filter((role) => role.active).map((role) => <label key={role.id}>
            <input name="roleIds" type="checkbox" value={role.id}
              disabled={!role.assignmentMutable} />{role.displayName}
            {role.assignmentRestricted ? t("admin.ownerOnly") : ""}
          </label>)}
          {!roleOptions.some((role) => role.active) && <p><AdminText messageKey="admin.noAssignableRoles" /></p>}
        </fieldset>
        <label className="admin-user-note"><AdminText messageKey="admin.noteOptional" /><textarea name="note" maxLength={1000} /></label>
        <button type="submit">{creating ? t("admin.creating") : t("admin.createUser")}</button>
      </fieldset>
    </form>}
    {notice && <p className="admin-notice" role="status">{notice}</p>}
    {editing && <section key={editing.id} className="admin-user-management"
      aria-labelledby={`manage-user-${editing.id}`}>
      <div className="section-heading"><h3 id={`manage-user-${editing.id}`}>{t("admin.manageName", { name: editing.displayName })}</h3>
        <button type="button" onClick={() => setEditing(null)}><AdminText messageKey="admin.close" /></button></div>
    {canManage && editing.id !== currentUserId && <form className="admin-user-create admin-user-management-form" onSubmit={saveUser}>
      <fieldset disabled={saving}><legend><AdminText messageKey="admin.identityAndAccess" /></legend>
        <label><AdminText messageKey="admin.displayName" /><input name="displayName" defaultValue={editing.displayName} maxLength={200} required autoComplete="off" /></label>
        <label><AdminText messageKey="admin.username" /><input name="username" defaultValue={editing.username} minLength={3} maxLength={128}
          pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,127}" required autoComplete="off" /></label>
        <fieldset className="admin-role-selection" disabled={!canAssignRoles || saving}><legend><AdminText messageKey="admin.completeRetainedRole" /></legend>
          {roleOptions.map((role) => <label key={role.id}>
            <input type="checkbox" value={role.id}
              disabled={!role.assignmentMutable || (!role.active && !selectedRoleIds.includes(role.id))}
              checked={selectedRoleIds.includes(role.id)} onChange={(event) => setSelectedRoleIds((current) =>
                event.target.checked ? [...current, role.id] : current.filter((id) => id !== role.id))} />
            {role.displayName}{!role.active ? t("admin.deactivated2") : role.assignmentRestricted ? t("admin.ownerOnly") : ""}
          </label>)}
          {!editing.active && <p><AdminText messageKey="admin.retainedRolesIneffectiveWhenDisabled" /></p>}
          <label><AdminText messageKey="admin.roleChangeNote" /><textarea value={roleNote} maxLength={1000}
            onChange={(event) => setRoleNote(event.target.value)} /></label>
          {protectedRoleSetChanged && <label><AdminText messageKey="admin.currentPasswordFor" />
            <input type="password" value={reauthenticationPassword} maxLength={1024}
              autoComplete="current-password" onChange={(event) => setReauthenticationPassword(event.target.value)} />
          </label>}
          <button type="button" onClick={() => void saveRoles()}
            disabled={protectedRoleSetChanged && !reauthenticationPassword}>{saving ? t("admin.saving") : t("admin.replaceRoleSet")}</button>
        </fieldset>
        <label><AdminText messageKey="admin.status" /><select name="active" value={desiredActive ? "true" : "false"}
          onChange={(event) => setDesiredActive(event.target.value === "true")}>
          <option value="true"><AdminText messageKey="admin.active" /></option><option value="false"><AdminText messageKey="admin.disabled" /></option>
        </select></label>
        {editing.active && !desiredActive && <p><AdminText messageKey="admin.disablingImmediatelyRevokes" /></p>}
        {!editing.active && desiredActive && <div className="admin-reactivation-review" role="status">
          <strong><AdminText messageKey="admin.rolesRestoredOn" /></strong>
          <RoleBadges roles={roleOptions.filter((role) => selectedRoleIds.includes(role.id))} />
          <p><AdminText messageKey="admin.freshLoginRequiredAfterReactivation" /></p>
        </div>}
        <label className="admin-user-note"><AdminText messageKey="admin.noteOptional" /><textarea name="note" maxLength={1000} /></label>
        <div><button type="submit">{saving ? t("admin.saving") : !editing.active && desiredActive ? t("admin.reactivateUser") : t("admin.saveUser")}</button>{" "}
          <button type="button" onClick={() => setEditing(null)}><AdminText messageKey="admin.cancel" /></button></div>
      </fieldset>
    </form>}
    {(canViewSessions || canResetCredentials || editing.owner) && <div className="admin-user-security">
      {editing.owner && <OwnershipTransferPanel csrfToken={csrfToken} />}
      {canViewSessions && <div><h4><AdminText messageKey="admin.activeSessions" /></h4>
        <p className="admin-muted"><AdminText messageKey="admin.deviceLabelsAre" /></p>
        {securityLoading && !userSessions.length && <p role="status"><AdminText messageKey="admin.loadingSessions" /></p>}
        {!securityLoading && !userSessions.length && <p><AdminText messageKey="admin.noActiveSessions" /></p>}
        {userSessions.length > 0 && <ul className="admin-session-list">{userSessions.map((session) => <li key={session.id}>
          <div><strong>{session.deviceLabel}</strong>{session.current && <span> <AdminText messageKey="admin.currentSession" /></span>}</div>
          <dl><div><dt><AdminText messageKey="admin.started" /></dt><dd><time dateTime={session.startedAt}>{new Date(session.startedAt).toLocaleString()}</time></dd></div>
            <div><dt><AdminText messageKey="admin.lastActivity" /></dt><dd><time dateTime={session.lastActivityAt}>{new Date(session.lastActivityAt).toLocaleString()}</time></dd></div>
            <div><dt><AdminText messageKey="admin.expires" /></dt><dd><time dateTime={session.expiresAt}>{new Date(session.expiresAt).toLocaleString()}</time></dd></div></dl>
          {canRevokeSessions && <button type="button" disabled={securityLoading} onClick={() => void revokeSession(session)}>
            {session.current ? t("admin.revokeAndSign") : t("admin.revokeSession")}</button>}
        </li>)}</ul>}
      </div>}
      {canResetCredentials && editing.id !== currentUserId && <form className="admin-credential-reset" onSubmit={resetCredential}>
        <fieldset disabled={resetting}><legend><AdminText messageKey="admin.resetCredential" /></legend>
          <p><AdminText messageKey="admin.credentialResetDoesNotReactivate" /></p>
          <label><AdminText messageKey="admin.temporaryPassword" /><input name="temporaryPassword" type="password" minLength={12} maxLength={1024}
            required autoComplete="new-password" /></label>
          <p className="admin-muted">{t("admin.temporaryAccessExpires", { hours: temporaryPasswordHours })}</p>
          <label><AdminText messageKey="admin.noteOptional" /><textarea name="note" maxLength={1000} /></label>
          <button type="submit">{resetting ? t("admin.resetting") : t("admin.resetCredentialAnd")}</button>
        </fieldset>
      </form>}
    </div>}
    </section>}
    <form className="admin-directory-filters" role="search" aria-label={t("admin.findUsers")} onSubmit={submit}>
      <label><AdminText messageKey="admin.search" /><input type="search" name="search" maxLength={100} placeholder={t("admin.displayNameOr")} /></label>
      <label><AdminText messageKey="admin.status" /><select name="state" defaultValue="active">
        <option value="active"><AdminText messageKey="admin.active" /></option><option value="disabled"><AdminText messageKey="admin.disabled" /></option><option value="all"><AdminText messageKey="admin.all" /></option>
      </select></label>
      <label><AdminText messageKey="admin.role" /><select name="roleId" defaultValue="">
        <option value=""><AdminText messageKey="admin.allRoles" /></option>
        {roleOptions.map((role) => <option key={role.id} value={role.id}>{role.displayName}{!role.active ? t("admin.deactivated2") : ""}</option>)}
      </select></label>
      <button type="submit" disabled={loading}><AdminText messageKey="admin.applyFilters" /></button>
    </form>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {loading && !items.length && <p role="status"><AdminText messageKey="admin.loadingUsers" /></p>}
    {!loading && !error && !items.length && <p role="status"><AdminText messageKey="admin.noUsersMatchFilters" /></p>}
    {items.length > 0 && <div className="admin-table-scroll"><table>
      <caption className="sr-only"><AdminText messageKey="admin.usersMatchingThe" /></caption>
      <thead><tr><th scope="col"><AdminText messageKey="admin.displayName" /></th><th scope="col"><AdminText messageKey="admin.username" /></th><th scope="col"><AdminText messageKey="admin.status" /></th><th scope="col"><AdminText messageKey="admin.roles" /></th>
        {hasActions && <th scope="col"><AdminText messageKey="admin.actions" /></th>}</tr></thead>
      <tbody>{items.map((user) => <tr key={user.id}>
        <th scope="row">{user.displayName}</th><td><code>{user.username}</code></td>
        <td>{user.active ? t("admin.active") : t("admin.disabled")}</td><td><RoleBadges roles={user.roles} effective={user.active}
          owner={user.owner} /></td>
        {hasActions && <td>{user.id === currentUserId && !canViewSessions && !user.owner ? t("admin.currentAccount")
          : <button type="button" onClick={() => beginEdit(user)}><AdminText messageKey="admin.manage" /></button>}</td>}
      </tr>)}</tbody>
    </table></div>}
    {nextCursor && <button type="button" disabled={loading} onClick={() => void load({ ...query, cursor: nextCursor }, true)}>
      {loading ? t("admin.loading") : t("admin.loadMoreUsers")}
    </button>}
  </section>;
}

type RoleDraft = { displayName: string; description: string; capabilityKeys: string[]; note: string };

export function roleDraftFindings(draft: RoleDraft, options: AdminCapabilityOption[]): string[] {
  const findings: string[] = [];
  const normalizedName = draft.displayName.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!normalizedName) findings.push("Enter a role name.");
  if (normalizedName.length > 100) findings.push("Role name must be 100 characters or fewer.");
  if (draft.description.normalize("NFC").trim().length > 500) findings.push("Description must be 500 characters or fewer.");
  if (draft.note.normalize("NFC").trim().length > 500) findings.push("Change note must be 500 characters or fewer.");
  if (!draft.capabilityKeys.length) findings.push("Select at least one capability.");
  const selected = new Set(draft.capabilityKeys);
  const catalog = new Map(options.map((option) => [option.key, option]));
  for (const key of draft.capabilityKeys) for (const prerequisite of catalog.get(key)?.prerequisites ?? []) {
    if (!selected.has(prerequisite)) findings.push(`${key} requires ${prerequisite}.`);
  }
  return findings;
}

function capabilityRows(roles: AdminRole[], options: AdminCapabilityOption[]): Array<{ key: string; description: string }> {
  const rows = new Map<string, { key: string; description: string }>();
  for (const option of options) rows.set(option.key, { key: option.key, description: option.description });
  for (const role of roles) for (const capability of role.capabilities) {
    if (!rows.has(capability.key)) rows.set(capability.key, capability);
  }
  return [...rows.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export function RoleCapabilityMatrix({ roles, capabilityOptions, canWrite, onHistory, onEdit, onDeactivate,
  onReactivate }: {
  readonly roles: AdminRole[];
  readonly capabilityOptions: AdminCapabilityOption[];
  readonly canWrite: boolean;
  readonly onHistory: (roleId: string) => void;
  readonly onEdit: (role: AdminRole) => void;
  readonly onDeactivate: (role: AdminRole) => void;
  readonly onReactivate: (role: AdminRole) => void;
}) {
  const t = useAdminText();
  const capabilityText = useAdminCapabilityText();
  const rows = capabilityRows(roles, capabilityOptions);
  return <div className="admin-role-matrix-scroll">
    <table className="admin-role-matrix">
      <caption><AdminText messageKey="admin.capabilitiesAssignedTo" /></caption>
      <thead><tr><th scope="col"><AdminText messageKey="admin.capability" /></th>{roles.map((role) => <th scope="col" key={role.id}>
        <span className="admin-role-column-heading" title={`${role.active ? t("admin.active") : t("admin.deactivated")} · ${role.protected ? t("admin.protected2") : t("admin.custom2")} · Version ${role.version} · ${role.assigneeCount} assignee${role.assigneeCount === 1 ? "" : "s"}${role.description ? ` · ${role.description}` : ""}`}>
          <strong>{role.displayName}</strong><span className="sr-only">. {role.active ? t("admin.active") : t("admin.deactivated")}, {role.protected ? t("admin.protected") : t("admin.custom")}, {t("admin.versionVersionCount", { version: role.version, count: role.assigneeCount })}{role.description ? `. ${role.description}` : ""}</span>
        </span>
      </th>)}</tr></thead>
      <tbody>{rows.map((capability) => <tr key={capability.key}>
        <th scope="row" title={capabilityText(capability.key, capability.description)}><code>{capability.key}</code><span className="sr-only">. {capabilityText(capability.key, capability.description)}</span></th>
        {roles.map((role) => {
          const included = role.capabilities.some(({ key }) => key === capability.key);
          return <td key={role.id} className={included ? "capability-included" : "capability-not-included"}>
            <span className="admin-capability-mark" aria-hidden="true">{included ? "✓" : "—"}</span>
            <span className="sr-only">{included ? t("admin.included") : t("admin.notIncluded")}</span>
          </td>;
        })}
      </tr>)}</tbody>
      <tfoot><tr><th scope="row"><AdminText messageKey="admin.roleActions" /></th>{roles.map((role) => <td key={role.id}>
        <div className="admin-role-matrix-actions">
          <button type="button" onClick={() => onHistory(role.id)}><AdminText messageKey="admin.history" /></button>
          {canWrite && !role.protected && role.active && <>
            <button type="button" onClick={() => onEdit(role)}><AdminText messageKey="admin.edit" /></button>
            <button type="button" onClick={() => onDeactivate(role)}><AdminText messageKey="admin.deactivate" /></button>
          </>}
          {canWrite && !role.protected && !role.active && <button type="button" onClick={() => onReactivate(role)}>
            <AdminText messageKey="admin.reactivate" />
          </button>}
        </div>
      </td>)}</tr></tfoot>
    </table>
  </div>;
}

export function RolesPanel({ csrfToken = "", capabilities: actorCapabilities = [] }: {
  readonly csrfToken?: string; readonly capabilities?: string[];
}) {
  const t = useAdminText();
  const capabilityText = useAdminCapabilityText();
  const adminError = useAdminError();
  const [items, setItems] = useState<AdminRole[]>([]);
  const [capabilityOptions, setCapabilityOptions] = useState<AdminCapabilityOption[]>([]);
  const [selectedState, setSelectedState] = useState<StateFilter>("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorRole, setEditorRole] = useState<AdminRole | null | undefined>(undefined);
  const [draft, setDraft] = useState<RoleDraft>({ displayName: "", description: "", capabilityKeys: [], note: "" });
  const [saving, setSaving] = useState(false);
  const [retiringRole, setRetiringRole] = useState<AdminRole | null>(null);
  const [retirementNote, setRetirementNote] = useState("");
  const [history, setHistory] = useState<AdminRoleHistory | null>(null);
  const canWrite = actorCapabilities.includes("roles:write");
  const interactionRevision = useRef(0);

  function closeInteractions() {
    interactionRevision.current += 1;
    setEditorRole(undefined);
    setRetiringRole(null);
    setRetirementNote("");
    setHistory(null);
  }

  function load(state: StateFilter) {
    setLoading(true);
    setError(null);
    loadAdminRoles(state).then((result) => setItems(result.items)).catch((reason: unknown) =>
      setError(adminError(reason, "admin.rolesCouldNot")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadAdminRoles("active").then((result) => setItems(result.items))
      .catch((reason: unknown) => setError(adminError(reason, "admin.rolesCouldNot")))
      .finally(() => setLoading(false));
    loadAdminRoleCapabilities().then((result) => setCapabilityOptions(result.items))
      .catch((reason: unknown) => setError(adminError(reason, "admin.capabilitiesCouldNot")));
  }, [adminError]);

  function begin(role: AdminRole | null) {
    closeInteractions();
    setError(null);
    setEditorRole(role);
    setDraft(role ? { displayName: role.displayName, description: role.description ?? "",
      capabilityKeys: role.capabilities.map(({ key }) => key), note: "" }
      : { displayName: "", description: "", capabilityKeys: [], note: "" });
  }

  function toggle(option: AdminCapabilityOption, checked: boolean) {
    if (!option.mutable) return;
    setDraft((current) => ({ ...current, capabilityKeys: checked
      ? [...new Set([...current.capabilityKeys, option.key, ...option.prerequisites])].sort()
      : current.capabilityKeys.filter((key) => key !== option.key) }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const findings = roleDraftFindings(draft, capabilityOptions);
    if (findings.length) return;
    setSaving(true);
    setError(null);
    const command: SaveAdminRoleCommand = { displayName: draft.displayName, description: draft.description || null,
      capabilityKeys: draft.capabilityKeys, note: draft.note || null,
      ...(editorRole ? { expectedVersion: editorRole.version } : {}) };
    try {
      const saved = editorRole ? (editorRole.active
        ? await updateAdminRole(csrfToken, editorRole.id, command)
        : await reactivateAdminRole(csrfToken, editorRole.id, command))
        : await createAdminRole(csrfToken, command);
      setItems((current) => editorRole && !editorRole.active && selectedState === "disabled"
        ? current.filter(({ id }) => id !== saved.id)
        : [...current.filter(({ id }) => id !== saved.id), saved]
          .sort((left, right) => left.displayName.localeCompare(right.displayName)));
      setEditorRole(undefined);
    } catch (reason) {
      setError(`${adminError(reason, "admin.roleSaveFailed")} Reload the role list before retrying if another administrator changed it.`);
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    if (!retiringRole) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await deactivateAdminRole(csrfToken, retiringRole.id, retiringRole.version, retirementNote);
      setItems((current) => selectedState === "active" ? current.filter(({ id }) => id !== saved.id)
        : current.map((role) => role.id === saved.id ? saved : role));
      setRetiringRole(null);
      setRetirementNote("");
    } catch (reason) {
      setError(`${adminError(reason, "admin.roleDeactivationFailed")} Reload the role list before retrying if another administrator changed it.`);
    } finally {
      setSaving(false);
    }
  }

  async function showHistory(roleId: string) {
    closeInteractions();
    const revision = interactionRevision.current;
    setError(null);
    try {
      const loadedHistory = await loadAdminRoleHistory(roleId);
      if (revision === interactionRevision.current) setHistory(loadedHistory);
    }
    catch (reason) { setError(adminError(reason, "admin.roleHistoryCould")); }
  }

  const findings = roleDraftFindings(draft, capabilityOptions);

  return <section className="admin-configuration admin-directory" aria-labelledby="roles-heading">
    <div className="section-heading"><h2 id="roles-heading"><AdminText messageKey="admin.roles" /></h2>
      {canWrite && editorRole === undefined && <button type="button" onClick={() => begin(null)}><AdminText messageKey="admin.createCustomRole" /></button>}
    </div>
    <label className="admin-role-state"><AdminText messageKey="admin.status" /><select value={selectedState} onChange={(event) => {
      const next = event.target.value as StateFilter;
      closeInteractions();
      setSelectedState(next);
      load(next);
    }}><option value="active"><AdminText messageKey="admin.active" /></option><option value="disabled"><AdminText messageKey="admin.deactivated" /></option><option value="all"><AdminText messageKey="admin.all" /></option></select></label>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {loading && !items.length && <p role="status"><AdminText messageKey="admin.loadingRoles" /></p>}
    {!loading && !error && !items.length && <p role="status"><AdminText messageKey="admin.noRolesMatch" /></p>}
    {editorRole !== undefined && <form className="admin-role-editor" onSubmit={(event) => void save(event)}>
      <fieldset disabled={saving}><legend>{editorRole
        ? `${editorRole.active ? t("admin.edit") : t("admin.reactivate")} ${editorRole.displayName}` : t("admin.createCustomRole")}</legend>
        <p className="admin-muted">{editorRole && !editorRole.active
          ? t("admin.reactivationCreatesA")
          : t("admin.savingActivatesA")}</p>
        <label><AdminText messageKey="admin.roleName" /><input value={draft.displayName} maxLength={100} required onChange={(event) =>
          setDraft((current) => ({ ...current, displayName: event.target.value }))} /></label>
        <label><AdminText messageKey="admin.description" /> <small><AdminText messageKey="admin.optional" /></small><textarea value={draft.description} maxLength={500} onChange={(event) =>
          setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
        <fieldset className="admin-capability-options"><legend><AdminText messageKey="admin.capabilities" /></legend>
          {capabilityOptions.map((option) => <label key={option.key}>
            <input type="checkbox" checked={draft.capabilityKeys.includes(option.key)} disabled={!option.mutable}
              onChange={(event) => toggle(option, event.target.checked)} />
            <span><code>{option.key}</code> — {capabilityText(option.key, option.description)}
              {option.prerequisites.length > 0 && <small>{t("admin.requiresKeys", { keys: option.prerequisites.join(", ") })}</small>}
              {!option.mutable && <small><AdminText messageKey="admin.capabilityNotGrantedToActor" /></small>}</span>
          </label>)}
        </fieldset>
        <label><AdminText messageKey="admin.changeNote" /> <small><AdminText messageKey="admin.optionalRecordedInThe" /></small><textarea value={draft.note} maxLength={500}
          onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} /></label>
        {findings.length > 0 && <div className="validation-box error-box" role="alert"><strong><AdminText messageKey="admin.resolveBeforeSaving" /></strong>
          <ul>{findings.map((finding) => <li key={finding}>{finding}</li>)}</ul></div>}
        <div className="admin-role-editor-actions"><button type="submit" disabled={saving || findings.length > 0}>{saving ? t("admin.saving")
          : editorRole && !editorRole.active ? t("admin.createVersionAnd") : t("admin.saveAndActivate")}</button>
          <button type="button" onClick={() => setEditorRole(undefined)}><AdminText messageKey="admin.cancel" /></button></div>
      </fieldset>
    </form>}
    {retiringRole && <form className="admin-role-editor" onSubmit={(event) => { event.preventDefault(); void deactivate(); }}>
      <fieldset disabled={saving}><legend>{t("admin.deactivateName", { name: retiringRole.displayName })}</legend>
        <p>{t("admin.assignmentsEndImmediately", { count: retiringRole.assigneeCount })}</p>
        <label><AdminText messageKey="admin.retirementNote" /> <small><AdminText messageKey="admin.optionalRecordedInHistory" /></small><textarea maxLength={500}
          value={retirementNote} onChange={(event) => setRetirementNote(event.target.value)} /></label>
        <div className="admin-role-editor-actions"><button type="submit">{saving ? t("admin.deactivating") : t("admin.confirmDeactivation")}</button>
          <button type="button" onClick={() => setRetiringRole(null)}><AdminText messageKey="admin.cancel" /></button></div>
      </fieldset>
    </form>}
    {history && <section className="admin-role-editor" aria-labelledby="role-history-heading">
      <div className="section-heading"><h3 id="role-history-heading"><AdminText messageKey="admin.roleHistory" /></h3>
        <button type="button" onClick={() => setHistory(null)}><AdminText messageKey="admin.closeHistory" /></button></div>
      <p className="admin-muted"><AdminText messageKey="admin.stableRoleID" /> <code>{history.roleId}</code>. <AdminText messageKey="admin.personnelNamesAnd" /></p>
      <h4><AdminText messageKey="admin.immutableVersions" /></h4><ol>{history.versions.map((version) => <li key={version.id}>
        <strong>{t("admin.versionVersionName", { version: version.version, name: version.displayName })}</strong> — {version.capabilityKeys.join(", ")}
        {version.note && <small> {t("admin.noteNote", { note: version.note })}</small>}
      </li>)}</ol>
      <h4><AdminText messageKey="admin.assignmentIntervals" /></h4>{history.assignments.length ? <ul>{history.assignments.map((assignment) =>
        <li key={assignment.id}><code>{assignment.userId}</code>: <time dateTime={assignment.assignedAt}>
          {new Date(assignment.assignedAt).toLocaleString()}</time> – {assignment.endedAt
          ? <time dateTime={assignment.endedAt}>{new Date(assignment.endedAt).toLocaleString()}</time> : t("admin.current")}</li>)}</ul>
        : <p className="admin-muted"><AdminText messageKey="admin.noAssignmentHistory" /></p>}
      <h4><AdminText messageKey="admin.lifecycleEvents" /></h4><ol>{history.events.map((event) => <li key={event.id}>
        <code>{event.action}</code> <AdminText messageKey="admin.at" /> <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
        {event.note && <small> {t("admin.noteNote", { note: event.note })}</small>}
      </li>)}</ol>
    </section>}
    {items.length > 0 && <RoleCapabilityMatrix roles={items} capabilityOptions={capabilityOptions} canWrite={canWrite}
      onHistory={(roleId) => void showHistory(roleId)} onEdit={begin}
      onDeactivate={(role) => { closeInteractions(); setRetiringRole(role); }} onReactivate={begin} />}
  </section>;
}
