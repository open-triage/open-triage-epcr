"use client";

import { createContext, useContext, useEffect, useId } from "react";

/** Only explicit-save editors register here; clinical autosave has its own recovery flow. */
export const UnsavedChangesContext = createContext<Set<string> | null>(null);

export function confirmDiscardChanges(dirty: boolean): boolean {
  return !dirty || window.confirm(document.documentElement.lang === "sv"
    ? "Du har osparade ändringar. Lämna och kasta ändringarna? Välj Avbryt för att stanna och spara."
    : "You have unsaved changes. Leave and discard them? Choose Cancel to stay and save.");
}

export function useUnsavedChanges(dirty: boolean) {
  const registry = useContext(UnsavedChangesContext);
  const id = useId();
  useEffect(() => {
    if (!dirty) return;
    registry?.add(id);
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => { registry?.delete(id); window.removeEventListener("beforeunload", warn); };
  }, [dirty, id, registry]);
  return () => confirmDiscardChanges(dirty);
}
