"use client";

import { AdminText, useAdminError, useAdminText } from "../app/admin-localization";

import type { OwnershipTransferState } from "@open-triage/contracts";
import React, { useEffect, useState, type FormEvent } from "react";
import { acceptOwnershipTransfer, cancelOwnershipTransfer, initiateOwnershipTransfer, loadOwnershipTransfer } from "../app/admin-context";
import { reauthenticateClinicianSession } from "../app/clinician-session";

const statusText: Record<NonNullable<OwnershipTransferState["transfer"]>["status"], string> = {
  pending: "Awaiting nominee acceptance", accepted: "Accepted", cancelled: "Cancelled",
  expired: "Expired after 72 hours", ineligible: "Cancelled because eligibility changed"
};

export function OwnershipTransferPanel({ csrfToken = "" }: { readonly csrfToken?: string }) {
  const t = useAdminText();
  const adminError = useAdminError();
  const [state, setState] = useState<OwnershipTransferState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadOwnershipTransfer().then(setState).catch((reason: unknown) =>
    setError(adminError(reason, "admin.ownershipStatusCould"))); }, [adminError]);

  async function initiate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setError(null); setNotice(null);
    try {
      await reauthenticateClinicianSession(String(data.get("currentPassword") ?? ""), csrfToken);
      setState(await initiateOwnershipTransfer(csrfToken, { nomineeUserId: String(data.get("nomineeUserId") ?? ""),
        note: String(data.get("note") ?? "") || undefined }));
      form.reset(); setNotice(t("admin.ownershipNominationSent"));
    } catch (reason) { setError(adminError(reason, "admin.ownershipTransferCouldNotBeInitiated")); }
    finally { setBusy(false); }
  }

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(null); setNotice(null);
    try {
      await reauthenticateClinicianSession(String(data.get("currentPassword") ?? ""), csrfToken);
      setState(await acceptOwnershipTransfer(csrfToken));
      setNotice(t("admin.ownershipTransferredThe"));
    } catch (reason) { setError(adminError(reason, "admin.ownershipTransferCouldNotBeAccepted")); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!window.confirm(t("admin.cancelThisPending"))) return;
    setBusy(true); setError(null); setNotice(null);
    try { setState(await cancelOwnershipTransfer(csrfToken)); setNotice(t("admin.ownershipTransferCancelled")); }
    catch (reason) { setError(adminError(reason, "admin.ownershipTransferCouldNotBeCancelled")); }
    finally { setBusy(false); }
  }

  return <section className="admin-ownership-transfer" aria-labelledby="ownership-transfer-heading">
    <div className="section-heading"><h3 id="ownership-transfer-heading"><AdminText messageKey="admin.installationOwnership" /></h3></div>
    {!state && !error && <p role="status"><AdminText messageKey="admin.loadingOwnershipStatus" /></p>}
    {error && <p className="admin-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {state && <><p><AdminText messageKey="admin.currentOwner" /> <strong>{state.owner.displayName}</strong></p>
      {state.transfer && <div className="admin-transfer-status">
        <p><strong>{t(statusText[state.transfer.status])}</strong>: {state.transfer.nominee.displayName}</p>
        <p><AdminText messageKey="admin.initiated" /> <time dateTime={state.transfer.initiatedAt}>{new Date(state.transfer.initiatedAt).toLocaleString()}</time>.
          {state.transfer.status === "pending" && <> <AdminText messageKey="admin.expires" /> <time dateTime={state.transfer.expiresAt}>{new Date(state.transfer.expiresAt).toLocaleString()}</time>.</>}</p>
        {state.transfer.resolutionReason && state.transfer.status !== "pending" && <p>{t("admin.reasonReason", { reason: state.transfer.resolutionReason.replaceAll("_", " ") })}</p>}
      </div>}
      {state.currentUserIsOwner && state.transfer?.status !== "pending" && <form onSubmit={initiate}>
        <fieldset disabled={busy || !state.eligibleNominees.length}><legend><AdminText messageKey="admin.nominateASuccessor" /></legend>
          <p><AdminText messageKey="admin.ownershipNomineeRequirements" /></p>
          <label><AdminText messageKey="admin.administrator" /><select name="nomineeUserId" required defaultValue=""><option value="" disabled><AdminText messageKey="admin.selectAnAdministrator" /></option>
            {state.eligibleNominees.map((user) => <option value={user.id} key={user.id}>{user.displayName}</option>)}</select></label>
          <label><AdminText messageKey="admin.currentPassword" /><input name="currentPassword" type="password" required autoComplete="current-password" /></label>
          <label><AdminText messageKey="admin.noteOptional" /><textarea name="note" maxLength={1000} /></label>
          <button type="submit">{busy ? "Nominating…" : "Nominate successor"}</button>
          {!state.eligibleNominees.length && <p role="status"><AdminText messageKey="admin.noOtherActive" /></p>}
        </fieldset></form>}
      {state.currentUserIsNominee && state.transfer?.status === "pending" && <form onSubmit={accept}>
        <fieldset disabled={busy}><legend><AdminText messageKey="admin.acceptOwnership" /></legend>
          <p><AdminText messageKey="admin.acceptanceAtomicallyMoves" /></p>
          <label><AdminText messageKey="admin.currentPassword" /><input name="currentPassword" type="password" required autoComplete="current-password" /></label>
          <button type="submit">{busy ? "Accepting…" : t("admin.acceptOwnership")}</button>
        </fieldset></form>}
      {state.transfer?.status === "pending" && (state.currentUserIsOwner || state.currentUserIsNominee) &&
        <button type="button" disabled={busy} onClick={() => void cancel()}><AdminText messageKey="admin.cancelOwnershipTransfer" /></button>}
    </>}
  </section>;
}
