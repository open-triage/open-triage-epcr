"use client";

import type { AdminCapabilityOption, AdminRole, AdminRoleSummary, AdminUserSummary, ProvisionAdminUserCommand, SaveAdminRoleCommand } from "@open-triage/contracts";
import { useEffect, useState, type FormEvent } from "react";
import { createAdminRole, loadAdminRoleCapabilities, loadAdminRoles, loadAdminUserRoleOptions,
  loadAdminUsers, provisionAdminUser, updateAdminRole, type AdminUserQuery } from "../app/admin-context";

type StateFilter = "active" | "disabled" | "all";

function RoleBadges({ roles }: { readonly roles: AdminRoleSummary[] }) {
  if (!roles.length) return <span className="admin-muted">No roles</span>;
  return <ul className="admin-role-badges" aria-label="Assigned roles">
    {roles.map((role) => <li key={role.id}>{role.displayName}{!role.active && " (deactivated)"}</li>)}
  </ul>;
}

export function UsersPanel({ canCreate = false, csrfToken = "" }: {
  readonly canCreate?: boolean;
  readonly csrfToken?: string;
}) {
  const [items, setItems] = useState<AdminUserSummary[]>([]);
  const [roleOptions, setRoleOptions] = useState<AdminRoleSummary[]>([]);
  const [query, setQuery] = useState<AdminUserQuery>({ state: "active" });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  return <section className="admin-configuration admin-directory" aria-labelledby="users-heading">
    <div className="section-heading"><h2 id="users-heading">Users</h2>{canCreate && <button type="button"
      aria-expanded={createOpen} aria-controls="create-user-form" onClick={() => setCreateOpen((open) => !open)}>
      {createOpen ? "Cancel creation" : "Create user"}</button>}</div>
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
            <input name="roleIds" type="checkbox" value={role.id} />{role.displayName}
          </label>)}
          {!roleOptions.some((role) => role.active) && <p>No assignable roles are available.</p>}
        </fieldset>
        <label className="admin-user-note">Note (optional)<textarea name="note" maxLength={1000} /></label>
        <button type="submit">{creating ? "Creating…" : "Create user"}</button>
      </fieldset>
    </form>}
    {notice && <p className="admin-notice" role="status">{notice}</p>}
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
      <thead><tr><th scope="col">Display name</th><th scope="col">Username</th><th scope="col">Status</th><th scope="col">Roles</th></tr></thead>
      <tbody>{items.map((user) => <tr key={user.id}>
        <th scope="row">{user.displayName}</th><td><code>{user.username}</code></td>
        <td>{user.active ? "Active" : "Disabled"}</td><td><RoleBadges roles={user.roles} /></td>
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
    if (canWrite) loadAdminRoleCapabilities().then((result) => setCapabilityOptions(result.items))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Capabilities could not be loaded."));
  }, [canWrite]);

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
      const saved = editorRole ? await updateAdminRole(csrfToken, editorRole.id, command)
        : await createAdminRole(csrfToken, command);
      setItems((current) => [...current.filter(({ id }) => id !== saved.id), saved]
        .sort((left, right) => left.displayName.localeCompare(right.displayName)));
      setEditorRole(undefined);
    } catch (reason) {
      setError(`${reason instanceof Error ? reason.message : "The role could not be saved."} Reload the role list before retrying if another administrator changed it.`);
    } finally {
      setSaving(false);
    }
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
      <fieldset disabled={saving}><legend>{editorRole ? `Edit ${editorRole.displayName}` : "Create custom role"}</legend>
        <p className="admin-muted">Saving activates a new immutable version immediately for every current assignee.</p>
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
        <div className="admin-role-editor-actions"><button type="submit" disabled={saving || findings.length > 0}>{saving ? "Saving…" : "Save and activate"}</button>
          <button type="button" onClick={() => setEditorRole(undefined)}>Cancel</button></div>
      </fieldset>
    </form>}
    {items.length > 0 && <div className="admin-role-cards">{items.map((role) => <article key={role.id} className="admin-role-card">
      <header><h3>{role.displayName}</h3><span>{role.active ? "Active" : "Deactivated"}</span></header>
      {role.description && <p>{role.description}</p>}
      <dl><div><dt>Type</dt><dd>{role.protected ? "Protected" : "Custom"}</dd></div>
        <div><dt>Version</dt><dd>{role.version}</dd></div><div><dt>Assignees</dt><dd>{role.assigneeCount}</dd></div></dl>
      <h4>Capabilities</h4>
      {role.capabilities.length ? <ul>{role.capabilities.map((capability) => <li key={capability.key}>
        <code>{capability.key}</code><span>{capability.description}</span>
      </li>)}</ul> : <p className="admin-muted">No capabilities</p>}
      {canWrite && !role.protected && role.active && <button type="button" onClick={() => begin(role)}>Edit custom role</button>}
    </article>)}</div>}
  </section>;
}
