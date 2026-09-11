"use client";

import type { AdminRole, AdminRoleSummary, AdminUserSummary } from "@open-triage/contracts";
import { useEffect, useState, type FormEvent } from "react";
import {
  loadAdminRoles, loadAdminUserRoleOptions, loadAdminUsers, type AdminUserQuery
} from "../app/admin-context";

type StateFilter = "active" | "disabled" | "all";

function RoleBadges({ roles }: { readonly roles: AdminRoleSummary[] }) {
  if (!roles.length) return <span className="admin-muted">No roles</span>;
  return <ul className="admin-role-badges" aria-label="Assigned roles">
    {roles.map((role) => <li key={role.id}>{role.displayName}{!role.active && " (deactivated)"}</li>)}
  </ul>;
}

export function UsersPanel() {
  const [items, setItems] = useState<AdminUserSummary[]>([]);
  const [roleOptions, setRoleOptions] = useState<AdminRoleSummary[]>([]);
  const [query, setQuery] = useState<AdminUserQuery>({ state: "active" });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return <section className="admin-configuration admin-directory" aria-labelledby="users-heading">
    <div className="section-heading"><h2 id="users-heading">Users</h2></div>
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

export function RolesPanel() {
  const [items, setItems] = useState<AdminRole[]>([]);
  const [selectedState, setSelectedState] = useState<StateFilter>("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  return <section className="admin-configuration admin-directory" aria-labelledby="roles-heading">
    <div className="section-heading"><h2 id="roles-heading">Roles</h2></div>
    <label className="admin-role-state">Status<select value={selectedState} onChange={(event) => {
      const next = event.target.value as StateFilter;
      setSelectedState(next);
      load(next);
    }}><option value="active">Active</option><option value="disabled">Deactivated</option><option value="all">All</option></select></label>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {loading && !items.length && <p role="status">Loading roles…</p>}
    {!loading && !error && !items.length && <p role="status">No roles match this filter.</p>}
    {items.length > 0 && <div className="admin-role-cards">{items.map((role) => <article key={role.id} className="admin-role-card">
      <header><h3>{role.displayName}</h3><span>{role.active ? "Active" : "Deactivated"}</span></header>
      {role.description && <p>{role.description}</p>}
      <dl><div><dt>Type</dt><dd>{role.protected ? "Protected" : "Custom"}</dd></div>
        <div><dt>Version</dt><dd>{role.version}</dd></div><div><dt>Assignees</dt><dd>{role.assigneeCount}</dd></div></dl>
      <h4>Capabilities</h4>
      {role.capabilities.length ? <ul>{role.capabilities.map((capability) => <li key={capability.key}>
        <code>{capability.key}</code><span>{capability.description}</span>
      </li>)}</ul> : <p className="admin-muted">No capabilities</p>}
    </article>)}</div>}
  </section>;
}
