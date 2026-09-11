"use client";

import type { OwnershipTransferState } from "@open-triage/contracts";
import React, { useEffect, useState, type FormEvent } from "react";
import { acceptOwnershipTransfer, cancelOwnershipTransfer, initiateOwnershipTransfer, loadOwnershipTransfer } from "../app/admin-context";
import { reauthenticateClinicianSession } from "../app/clinician-session";

const statusText: Record<NonNullable<OwnershipTransferState["transfer"]>["status"], string> = {
  pending: "Awaiting nominee acceptance", accepted: "Accepted", cancelled: "Cancelled",
  expired: "Expired after 72 hours", ineligible: "Cancelled because eligibility changed"
};

export function OwnershipTransferPanel({ csrfToken = "" }: { readonly csrfToken?: string }) {
  const [state, setState] = useState<OwnershipTransferState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadOwnershipTransfer().then(setState).catch((reason: unknown) =>
    setError(reason instanceof Error ? reason.message : "Ownership status could not be loaded.")); }, []);

  async function initiate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setError(null); setNotice(null);
    try {
      await reauthenticateClinicianSession(String(data.get("currentPassword") ?? ""), csrfToken);
      setState(await initiateOwnershipTransfer(csrfToken, { nomineeUserId: String(data.get("nomineeUserId") ?? ""),
        note: String(data.get("note") ?? "") || undefined }));
      form.reset(); setNotice("The nomination was sent. Ownership remains unchanged until acceptance.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ownership transfer could not be initiated."); }
    finally { setBusy(false); }
  }

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(null); setNotice(null);
    try {
      await reauthenticateClinicianSession(String(data.get("currentPassword") ?? ""), csrfToken);
      setState(await acceptOwnershipTransfer(csrfToken));
      setNotice("Ownership transferred. The former owner remains an Administrator.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ownership transfer could not be accepted."); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!window.confirm("Cancel this pending ownership transfer?")) return;
    setBusy(true); setError(null); setNotice(null);
    try { setState(await cancelOwnershipTransfer(csrfToken)); setNotice("The ownership transfer was cancelled."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Ownership transfer could not be cancelled."); }
    finally { setBusy(false); }
  }

  return <section className="admin-ownership-transfer" aria-labelledby="ownership-transfer-heading">
    <div className="section-heading"><h3 id="ownership-transfer-heading">Installation ownership</h3></div>
    {!state && !error && <p role="status">Loading ownership status…</p>}
    {error && <p className="admin-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {state && <><p>Current owner: <strong>{state.owner.displayName}</strong></p>
      {state.transfer && <div className="admin-transfer-status">
        <p><strong>{statusText[state.transfer.status]}</strong>: {state.transfer.nominee.displayName}</p>
        <p>Initiated <time dateTime={state.transfer.initiatedAt}>{new Date(state.transfer.initiatedAt).toLocaleString()}</time>.
          {state.transfer.status === "pending" && <> Expires <time dateTime={state.transfer.expiresAt}>{new Date(state.transfer.expiresAt).toLocaleString()}</time>.</>}</p>
        {state.transfer.resolutionReason && state.transfer.status !== "pending" && <p>Reason: {state.transfer.resolutionReason.replaceAll("_", " ")}</p>}
      </div>}
      {state.currentUserIsOwner && state.transfer?.status !== "pending" && <form onSubmit={initiate}>
        <fieldset disabled={busy || !state.eligibleNominees.length}><legend>Nominate a successor</legend>
          <p>The nominee must be an active Administrator and must accept independently within 72 hours.</p>
          <label>Administrator<select name="nomineeUserId" required defaultValue=""><option value="" disabled>Select an Administrator</option>
            {state.eligibleNominees.map((user) => <option value={user.id} key={user.id}>{user.displayName}</option>)}</select></label>
          <label>Current password<input name="currentPassword" type="password" required autoComplete="current-password" /></label>
          <label>Note (optional)<textarea name="note" maxLength={1000} /></label>
          <button type="submit">{busy ? "Nominating…" : "Nominate successor"}</button>
          {!state.eligibleNominees.length && <p role="status">No other active Administrators are eligible.</p>}
        </fieldset></form>}
      {state.currentUserIsNominee && state.transfer?.status === "pending" && <form onSubmit={accept}>
        <fieldset disabled={busy}><legend>Accept ownership</legend>
          <p>Acceptance atomically moves ownership. The current owner keeps their Administrator role.</p>
          <label>Current password<input name="currentPassword" type="password" required autoComplete="current-password" /></label>
          <button type="submit">{busy ? "Accepting…" : "Accept ownership"}</button>
        </fieldset></form>}
      {state.transfer?.status === "pending" && (state.currentUserIsOwner || state.currentUserIsNominee) &&
        <button type="button" disabled={busy} onClick={() => void cancel()}>Cancel ownership transfer</button>}
    </>}
  </section>;
}
