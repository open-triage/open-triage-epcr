"use client";
import type { NewJobConfirmation } from "@open-triage/contracts";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { resolveMessage } from "../app/localization";

export class NewJobCanceledError extends Error {
  constructor(readonly restoreFocus = true) { super(); }
}
export type ConfirmNewJob = (reminder: NewJobConfirmation) => Promise<string>;
const NewJobConfirmationContext = createContext<ConfirmNewJob>(async () => { throw new NewJobCanceledError(); });
export const useNewJobConfirmation = () => useContext(NewJobConfirmationContext);

/** One shared reminder for assigned and standalone production jobs. No persistent browser acknowledgment. */
export function NewJobConfirmationProvider({ language, onSwitch, children }: {
  language: string; onSwitch: () => void; children: ReactNode;
}) {
  const [reminder, setReminder] = useState<NewJobConfirmation | null>(null);
  const pending = useRef<{ resolve: (token: string) => void; reject: (error: Error) => void } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const t = (key: string, params?: Record<string, string>) => resolveMessage(language, key, params);
  const cancel = (restoreFocus = true) => {
    dialog.current?.close();
    pending.current?.reject(new NewJobCanceledError(restoreFocus)); pending.current = null; setReminder(null);
  };
  useEffect(() => () => { pending.current?.reject(new NewJobCanceledError(false)); pending.current = null; }, []);
  useEffect(() => {
    if (reminder) dialog.current?.showModal();
    else dialog.current?.close();
  }, [reminder]);
  return <NewJobConfirmationContext.Provider value={value => new Promise((resolve, reject) => {
    pending.current?.reject(new NewJobCanceledError());
    pending.current = { resolve, reject }; setReminder(value);
  })}>
    {children}
    <dialog ref={dialog} className="unit-dialog" aria-labelledby="new-job-confirmation-title"
      onCancel={event => { event.preventDefault(); cancel(); }}>
      {reminder && <>
        <div className="note-dialog-heading"><h2 id="new-job-confirmation-title">{t("calls.confirmIdentity")}</h2></div>
        <p>{t("calls.confirmIdentityHelp", { name: reminder.clinicianName, unit: reminder.unit.callSign })}</p>
        <div className="note-dialog-actions">
          <button type="button" className="button-primary" onClick={() => {
            dialog.current?.close();
            pending.current?.resolve(reminder.token); pending.current = null; setReminder(null);
          }}>{t("calls.continueAs", { name: reminder.clinicianName })}</button>
          <button type="button" onClick={() => { cancel(false); onSwitch(); }}>{t("login.switchUser")}</button>
          <button type="button" onClick={() => cancel()}>{t("mobile.dialog.cancel")}</button>
        </div>
      </>}
    </dialog>
  </NewJobConfirmationContext.Provider>;
}
