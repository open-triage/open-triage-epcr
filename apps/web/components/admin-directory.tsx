"use client";

import type { AdminAssignableRoleSummary, AdminCapabilityOption, AdminRole, AdminRoleHistory, AdminRoleSummary, AdminSessionSummary, AdminUserSummary, ProvisionAdminUserCommand, ReplaceAdminUserRolesCommand, ResetAdminCredentialCommand, SaveAdminRoleCommand, UpdateAdminUserCommand } from "@open-triage/contracts";
import React, { useEffect, useState, type FormEvent } from "react";
import { createAdminRole, deactivateAdminRole, loadAdminRoleCapabilities, loadAdminRoleHistory, loadAdminRoles,
  loadAdminUserRoleOptions, loadAdminUserSessions, loadAdminUsers, provisionAdminUser, reactivateAdminRole,
  replaceAdminUserRoles, resetAdminUserCredential, revokeAdminUserSession, updateAdminRole, updateAdminUser,
  type AdminUserQuery } from "../app/admin-context";
import { reauthenticateClinicianSession } from "../app/clinician-session";
import { OwnershipTransferPanel } from "./ownership-transfer";

type StateFilter = "active" | "disabled" | "all";

function RoleBadges({ roles, effective = true }: { readonly roles: AdminRoleSummary[]; readonly effective?: boolean }) {
  if (!roles.length) return <span className="admin-muted">No roles</span>;
  return <ul className="admin-role-badges" aria-label="Assigned roles">
    {roles.map((role) => <li key={role.id}>{role.displayName}{!role.active
      ? " (deactivated)" : !effective ? " (retained, ineffective while disabled)" : ""}</li>)}
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
      setError(reason instanceof Error ? reason.message : "Users could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAdminUsers({ state: "active" }).then((page) => {
      setItems(page.items);
      setNextCursor(page.nextCursor);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Users could not be loaded."))
      .finally(() => setLoading(false));
    loadAdminUserRoleOptions().then((result) => setRoleOptions(result.items)).catch(() => setRoleOptions([]));
  }, []);

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
      temporaryPasswordHours: Number(data.get("temporaryPasswordHours")),
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
      setError(reason instanceof Error ? reason.message : "The user could not be created.");
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
      setError(reason instanceof Error ? reason.message : "Sessions could not be loaded.");
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
      setNotice("The selected session was revoked.");
      await refreshSessions(editing.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The session could not be revoked.");
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
      temporaryPasswordHours: Number(data.get("temporaryPasswordHours")),
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
      setError(reason instanceof Error ? reason.message : "The credential could not be reset.");
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
      setError(reason instanceof Error ? reason.message : "The user could not be updated.");
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
      setError(reason instanceof Error ? reason.message : "The role set could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="admin-configuration admin-directory" aria-labelledby="users-heading">
    <div className="section-heading"><h2 id="users-heading">Users</h2>{canCreate && <button type="button"
      aria-expanded={createOpen} aria-controls="create-user-form" onClick={() => setCreateOpen((open) => !open)}>
      {createOpen ? "Cancel creation" : "Create user"}</button>}</div>
    <OwnershipTransferPanel csrfToken={csrfToken} />
    {canCreate && createOpen && <form id="create-user-form" className="admin-user-create" onSubmit={createUser}>
      <fieldset disabled={creating}><legend>New local user</legend>
        <label>Display name<input name="displayName" maxLength={200} required autoComplete="off" /></label>
        <label>Username<input name="username" minLength={3} maxLength={128} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,127}"
          required autoComplete="off" /></label>
        <label>Temporary password<input name="temporaryPassword" type="password" minLength={12} maxLength={1024}
          required autoComplete="new-password" /></label>
        <label>Expires after (hours)<input name="temporaryPasswordHours" type="number" min={1} max={168} step={1}
          defaultValue={72} required /></label>
        <fieldset className="admin-role-selection"><legend>Initial roles</legend>
          {roleOptions.filter((role) => role.active).map((role) => <label key={role.id}>
            <input name="roleIds" type="checkbox" value={role.id}
              disabled={!role.assignmentMutable || role.assignmentRestricted} />{role.displayName}
            {role.assignmentRestricted ? " (assign after creation with reauthentication)" : ""}
          </label>)}
          {!roleOptions.some((role) => role.active) && <p>No assignable roles are available.</p>}
        </fieldset>
        <label className="admin-user-note">Note (optional)<textarea name="note" maxLength={1000} /></label>
        <button type="submit">{creating ? "Creating…" : "Create user"}</button>
      </fieldset>
    </form>}
    {notice && <p className="admin-notice" role="status">{notice}</p>}
    {editing && canManage && editing.id !== currentUserId && <form className="admin-user-create" onSubmit={saveUser}>
      <fieldset disabled={saving}><legend>Manage {editing.displayName}</legend>
        <label>Display name<input name="displayName" defaultValue={editing.displayName} maxLength={200} required autoComplete="off" /></label>
        <label>Username<input name="username" defaultValue={editing.username} minLength={3} maxLength={128}
          pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,127}" required autoComplete="off" /></label>
        <fieldset className="admin-role-selection" disabled={!canAssignRoles || saving}><legend>Complete retained role set</legend>
          {roleOptions.map((role) => <label key={role.id}>
            <input type="checkbox" value={role.id}
              disabled={!role.assignmentMutable || (!role.active && !selectedRoleIds.includes(role.id))}
              checked={selectedRoleIds.includes(role.id)} onChange={(event) => setSelectedRoleIds((current) =>
                event.target.checked ? [...current, role.id] : current.filter((id) => id !== role.id))} />
            {role.displayName}{!role.active ? " (deactivated)" : role.assignmentRestricted ? " (owner only)" : ""}
          </label>)}
          {!editing.active && <p>These roles are retained but ineffective while the user is disabled.</p>}
          <label>Role change note (optional)<textarea value={roleNote} maxLength={1000}
            onChange={(event) => setRoleNote(event.target.value)} /></label>
          {protectedRoleSetChanged && <label>Current password for protected role change
            <input type="password" value={reauthenticationPassword} maxLength={1024}
              autoComplete="current-password" onChange={(event) => setReauthenticationPassword(event.target.value)} />
          </label>}
          <button type="button" onClick={() => void saveRoles()}
            disabled={protectedRoleSetChanged && !reauthenticationPassword}>{saving ? "Saving…" : "Replace role set"}</button>
        </fieldset>
        <label>Status<select name="active" value={desiredActive ? "true" : "false"}
          onChange={(event) => setDesiredActive(event.target.value === "true")}>
          <option value="true">Active</option><option value="false">Disabled</option>
        </select></label>
        {editing.active && !desiredActive && <p>Disabling immediately revokes every active session. Retained roles become ineffective.</p>}
        {!editing.active && desiredActive && <div className="admin-reactivation-review" role="status">
          <strong>Roles restored on reactivation</strong>
          <RoleBadges roles={roleOptions.filter((role) => selectedRoleIds.includes(role.id))} />
          <p>A fresh login will be required. The existing credential will not be reset.</p>
        </div>}
        <label className="admin-user-note">Note (optional)<textarea name="note" maxLength={1000} /></label>
        <div><button type="submit">{saving ? "Saving…" : !editing.active && desiredActive ? "Reactivate user" : "Save user"}</button>{" "}
          <button type="button" onClick={() => setEditing(null)}>Cancel</button></div>
      </fieldset>
    </form>}
    {editing && (canViewSessions || canResetCredentials) && <section className="admin-user-security" aria-labelledby="user-security-heading">
      <div className="section-heading"><h3 id="user-security-heading">Security for {editing.displayName}</h3>
        <button type="button" onClick={() => setEditing(null)}>Close</button></div>
      {canViewSessions && <div><h4>Active sessions</h4>
        <p className="admin-muted">Device labels are coarse. Source IP and geolocation are not shown.</p>
        {securityLoading && !userSessions.length && <p role="status">Loading sessions…</p>}
        {!securityLoading && !userSessions.length && <p>No active sessions.</p>}
        {userSessions.length > 0 && <ul className="admin-session-list">{userSessions.map((session) => <li key={session.id}>
          <div><strong>{session.deviceLabel}</strong>{session.current && <span> Current session</span>}</div>
          <dl><div><dt>Started</dt><dd><time dateTime={session.startedAt}>{new Date(session.startedAt).toLocaleString()}</time></dd></div>
            <div><dt>Last activity</dt><dd><time dateTime={session.lastActivityAt}>{new Date(session.lastActivityAt).toLocaleString()}</time></dd></div>
            <div><dt>Expires</dt><dd><time dateTime={session.expiresAt}>{new Date(session.expiresAt).toLocaleString()}</time></dd></div></dl>
          {canRevokeSessions && <button type="button" disabled={securityLoading} onClick={() => void revokeSession(session)}>
            {session.current ? "Revoke and sign out" : "Revoke session"}</button>}
        </li>)}</ul>}
      </div>}
      {canResetCredentials && editing.id !== currentUserId && <form className="admin-credential-reset" onSubmit={resetCredential}>
        <fieldset disabled={resetting}><legend>Reset credential</legend>
          <p>This does not reactivate the account. Every existing session is revoked transactionally.</p>
          <label>Temporary password<input name="temporaryPassword" type="password" minLength={12} maxLength={1024}
            required autoComplete="new-password" /></label>
          <label>Expires after (hours)<input name="temporaryPasswordHours" type="number" min={1} max={168} step={1}
            defaultValue={72} required /></label>
          <label>Note (optional)<textarea name="note" maxLength={1000} /></label>
          <button type="submit">{resetting ? "Resetting…" : "Reset credential and revoke sessions"}</button>
        </fieldset>
      </form>}
    </section>}
    <form className="admin-directory-filters" role="search" aria-label="Find users" onSubmit={submit}>
      <label>Search<input type="search" name="search" maxLength={100} placeholder="Display name or username" /></label>
      <label>Status<select name="state" defaultValue="active">
        <option value="active">Active</option><option value="disabled">Disabled</option><option value="all">All</option>
      </select></label>
      <label>Role<select name="roleId" defaultValue="">
        <option value="">All roles</option>
        {roleOptions.map((role) => <option key={role.id} value={role.id}>{role.displayName}{!role.active ? " (deactivated)" : ""}</option>)}
      </select></label>
      <button type="submit" disabled={loading}>Apply filters</button>
    </form>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {loading && !items.length && <p role="status">Loading users…</p>}
    {!loading && !error && !items.length && <p role="status">No users match these filters.</p>}
    {items.length > 0 && <div className="admin-table-scroll"><table>
      <caption className="sr-only">Users matching the selected filters</caption>
      <thead><tr><th scope="col">Display name</th><th scope="col">Username</th><th scope="col">Status</th><th scope="col">Roles</th>
        {hasActions && <th scope="col">Actions</th>}</tr></thead>
      <tbody>{items.map((user) => <tr key={user.id}>
        <th scope="row">{user.displayName}</th><td><code>{user.username}</code></td>
        <td>{user.active ? "Active" : "Disabled"}</td><td><RoleBadges roles={user.roles} effective={user.active} /></td>
        <td>{user.active ? "Active" : "Disabled"}</td><td><RoleBadges roles={user.roles} effective={user.active} /></td>
        {hasActions && <td>{user.id === currentUserId && !canViewSessions ? "Current account"
          : <button type="button" onClick={() => beginEdit(user)}>{user.id === currentUserId ? "View sessions" : "Manage"}</button>}</td>}
      </tr>)}</tbody>
    </table></div>}
    {nextCursor && <button type="button" disabled={loading} onClick={() => void load({ ...query, cursor: nextCursor }, true)}>
      {loading ? "Loading…" : "Load more users"}
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
  const rows = capabilityRows(roles, capabilityOptions);
  return <div className="admin-role-matrix-scroll">
    <table className="admin-role-matrix">
      <caption>Capabilities assigned to each role</caption>
      <thead><tr><th scope="col">Capability</th>{roles.map((role) => <th scope="col" key={role.id}>
        <span className="admin-role-column-heading"><strong>{role.displayName}</strong>
          <small>{role.active ? "Active" : "Deactivated"} · {role.protected ? "Protected" : "Custom"}</small>
          <small>Version {role.version} · {role.assigneeCount} assignee{role.assigneeCount === 1 ? "" : "s"}</small>
          {role.description && <small>{role.description}</small>}
        </span>
      </th>)}</tr></thead>
      <tbody>{rows.map((capability) => <tr key={capability.key}>
        <th scope="row"><code>{capability.key}</code><small>{capability.description}</small></th>
        {roles.map((role) => {
          const included = role.capabilities.some(({ key }) => key === capability.key);
          return <td key={role.id} className={included ? "capability-included" : "capability-not-included"}>
            <span className="admin-capability-mark" aria-hidden="true">{included ? "✓" : "—"}</span>
            <span className="sr-only">{included ? "Included" : "Not included"}</span>
          </td>;
        })}
      </tr>)}</tbody>
      <tfoot><tr><th scope="row">Role actions</th>{roles.map((role) => <td key={role.id}>
        <div className="admin-role-matrix-actions">
          <button type="button" onClick={() => onHistory(role.id)}>View history</button>
          {canWrite && !role.protected && role.active && <>
            <button type="button" onClick={() => onEdit(role)}>Edit</button>
            <button type="button" onClick={() => onDeactivate(role)}>Deactivate</button>
          </>}
          {canWrite && !role.protected && !role.active && <button type="button" onClick={() => onReactivate(role)}>
            Reactivate
          </button>}
        </div>
      </td>)}</tr></tfoot>
    </table>
  </div>;
}

export function RolesPanel({ csrfToken = "", capabilities: actorCapabilities = [] }: {
  readonly csrfToken?: string; readonly capabilities?: string[];
}) {
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

  function load(state: StateFilter) {
    setLoading(true);
    setError(null);
    loadAdminRoles(state).then((result) => setItems(result.items)).catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : "Roles could not be loaded."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadAdminRoles("active").then((result) => setItems(result.items))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Roles could not be loaded."))
      .finally(() => setLoading(false));
    loadAdminRoleCapabilities().then((result) => setCapabilityOptions(result.items))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Capabilities could not be loaded."));
  }, []);

  function begin(role: AdminRole | null) {
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
      setError(`${reason instanceof Error ? reason.message : "The role could not be saved."} Reload the role list before retrying if another administrator changed it.`);
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
      setError(`${reason instanceof Error ? reason.message : "The role could not be deactivated."} Reload the role list before retrying if another administrator changed it.`);
    } finally {
      setSaving(false);
    }
  }

  async function showHistory(roleId: string) {
    setError(null);
    try { setHistory(await loadAdminRoleHistory(roleId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Role history could not be loaded."); }
  }

  const findings = roleDraftFindings(draft, capabilityOptions);

  return <section className="admin-configuration admin-directory" aria-labelledby="roles-heading">
    <div className="section-heading"><h2 id="roles-heading">Roles</h2>
      {canWrite && editorRole === undefined && <button type="button" onClick={() => begin(null)}>Create custom role</button>}
    </div>
    <label className="admin-role-state">Status<select value={selectedState} onChange={(event) => {
      const next = event.target.value as StateFilter;
      setSelectedState(next);
      load(next);
    }}><option value="active">Active</option><option value="disabled">Deactivated</option><option value="all">All</option></select></label>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {loading && !items.length && <p role="status">Loading roles…</p>}
    {!loading && !error && !items.length && <p role="status">No roles match this filter.</p>}
    {editorRole !== undefined && <form className="admin-role-editor" onSubmit={(event) => void save(event)}>
      <fieldset disabled={saving}><legend>{editorRole
        ? `${editorRole.active ? "Edit" : "Reactivate"} ${editorRole.displayName}` : "Create custom role"}</legend>
        <p className="admin-muted">{editorRole && !editorRole.active
          ? "Reactivation creates a new immutable version and restores no former assignments."
          : "Saving activates a new immutable version immediately for every current assignee."}</p>
        <label>Role name<input value={draft.displayName} maxLength={100} required onChange={(event) =>
          setDraft((current) => ({ ...current, displayName: event.target.value }))} /></label>
        <label>Description <small>(optional)</small><textarea value={draft.description} maxLength={500} onChange={(event) =>
          setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
        <fieldset className="admin-capability-options"><legend>Capabilities</legend>
          {capabilityOptions.map((option) => <label key={option.key}>
            <input type="checkbox" checked={draft.capabilityKeys.includes(option.key)} disabled={!option.mutable}
              onChange={(event) => toggle(option, event.target.checked)} />
            <span><code>{option.key}</code> — {option.description}
              {option.prerequisites.length > 0 && <small>Requires {option.prerequisites.join(", ")}</small>}
              {!option.mutable && <small>You cannot change this capability because it is not granted to you.</small>}</span>
          </label>)}
        </fieldset>
        <label>Change note <small>(optional, recorded in the audit event)</small><textarea value={draft.note} maxLength={500}
          onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} /></label>
        {findings.length > 0 && <div className="validation-box error-box" role="alert"><strong>Resolve before saving</strong>
          <ul>{findings.map((finding) => <li key={finding}>{finding}</li>)}</ul></div>}
        <div className="admin-role-editor-actions"><button type="submit" disabled={saving || findings.length > 0}>{saving ? "Saving…"
          : editorRole && !editorRole.active ? "Create version and reactivate" : "Save and activate"}</button>
          <button type="button" onClick={() => setEditorRole(undefined)}>Cancel</button></div>
      </fieldset>
    </form>}
    {retiringRole && <form className="admin-role-editor" onSubmit={(event) => { event.preventDefault(); void deactivate(); }}>
      <fieldset disabled={saving}><legend>Deactivate {retiringRole.displayName}</legend>
        <p>This immediately ends {retiringRole.assigneeCount} current assignment{retiringRole.assigneeCount === 1 ? "" : "s"}.
          Reactivation will not restore them.</p>
        <label>Retirement note <small>(optional, recorded in history)</small><textarea maxLength={500}
          value={retirementNote} onChange={(event) => setRetirementNote(event.target.value)} /></label>
        <div className="admin-role-editor-actions"><button type="submit">{saving ? "Deactivating…" : "Confirm deactivation"}</button>
          <button type="button" onClick={() => setRetiringRole(null)}>Cancel</button></div>
      </fieldset>
    </form>}
    {history && <section className="admin-role-editor" aria-labelledby="role-history-heading">
      <div className="section-heading"><h3 id="role-history-heading">Role history</h3>
        <button type="button" onClick={() => setHistory(null)}>Close history</button></div>
      <p className="admin-muted">Stable role ID: <code>{history.roleId}</code>. Personnel names and credentials are not included.</p>
      <h4>Immutable versions</h4><ol>{history.versions.map((version) => <li key={version.id}>
        <strong>Version {version.version}: {version.displayName}</strong> — {version.capabilityKeys.join(", ")}
        {version.note && <small> Note: {version.note}</small>}
      </li>)}</ol>
      <h4>Assignment intervals</h4>{history.assignments.length ? <ul>{history.assignments.map((assignment) =>
        <li key={assignment.id}><code>{assignment.userId}</code>: {assignment.assignedAt} – {assignment.endedAt ?? "current"}</li>)}</ul>
        : <p className="admin-muted">No assignment history.</p>}
      <h4>Lifecycle events</h4><ol>{history.events.map((event) => <li key={event.id}>
        <code>{event.action}</code> at {event.occurredAt}{event.note && <small> Note: {event.note}</small>}
      </li>)}</ol>
    </section>}
    {items.length > 0 && <RoleCapabilityMatrix roles={items} capabilityOptions={capabilityOptions} canWrite={canWrite}
      onHistory={(roleId) => void showHistory(roleId)} onEdit={begin}
      onDeactivate={(role) => { setRetiringRole(role); setRetirementNote(""); }} onReactivate={begin} />}
  </section>;
}
