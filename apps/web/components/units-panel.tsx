"use client";
import { UnitInstallations } from "./unit-installations";
import { UnitScheduleEditor } from "./unit-schedule";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { OperationalUnitSummary } from "@open-triage/contracts";
import { loadOperationalUnits, saveOperationalUnit } from "../app/admin-context";
import { listAccessRemoved } from "../app/list-refresh";
import { useAvailableHeight } from "./use-available-height";
import { activateListRow } from "./list-row-action";
import { confirmDiscardChanges, useUnsavedChanges } from "./unsaved-changes";

export function UnitsPanel({ csrfToken, canManage, language }: { csrfToken: string; canManage: boolean; language: string }) {
  const sv = language === "sv";
  const text = useCallback((en: string, sw: string) => sv ? sw : en, [sv]);
  const [scheduleUnit,setScheduleUnit] = useState<OperationalUnitSummary | null>(null);
  const [items,setItems] = useState<OperationalUnitSummary[]>([]);
  const [cursor,setCursor] = useState<string | null>(null);
  const [currentCursor,setCurrentCursor] = useState<string | undefined>();
  const [editor,setEditor] = useState<{ id: string | null; name: string; callSign: string; active: boolean; revision?: number } | null>(null);
  const [dirty,setDirty] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const request = useRef(0);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (editor && !dialog.current?.open) dialog.current?.showModal(); }, [editor]);
  const table = useAvailableHeight<HTMLDivElement>(100);
  useUnsavedChanges(dirty);
  const load = useCallback(async (page?: string) => {
    const version = ++request.current;
    setBusy(true);
    try {
      const result = await loadOperationalUnits(page);
      if (version !== request.current) return;
      setItems(result.items);setCursor(result.nextCursor);setCurrentCursor(page);setError(null);
    } catch (reason) {
      if (version !== request.current) return;
      if (listAccessRemoved(reason)) { setItems([]);setEditor(null); }
      setError(text("Units could not be refreshed. Previously loaded results are retained.","Enheterna kunde inte uppdateras. Tidigare resultat behålls."));
    } finally { if (version === request.current) setBusy(false); }
  }, [text]);
  useEffect(() => { let active = true;void Promise.resolve().then(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  function close(saved = false) {
    if (!saved && !confirmDiscardChanges(dirty)) return;
    setEditor(null);setDirty(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  if (scheduleUnit) return <UnitScheduleEditor unitId={scheduleUnit.id} unitName={scheduleUnit.name} csrfToken={csrfToken} canManage={canManage} language={language} onClose={() => { setScheduleUnit(null);requestAnimationFrame(() => document.getElementById(trigger.current?.id??"")?.focus()); }} />;
  return <section className="admin-directory" aria-labelledby="units-heading">
    <div className="section-heading"><h2 id="units-heading">{text("Units","Enheter")}</h2>
      {canManage && <button className="button-primary" type="button" onClick={event => {
        if (!confirmDiscardChanges(dirty)) return;
        trigger.current=event.currentTarget;setDirty(false);setEditor({ id:null,name:"",callSign:"",active:true });
      }}>{text("Create unit","Skapa enhet")}</button>}</div>
    <p>{text("An operational identity belongs to this agency. Replacing a vehicle keeps its unit. Reports use the agency’s published configuration.","En operativ identitet tillhör denna organisation. Enheten behålls när ett fordon byts ut. Rapporter använder organisationens publicerade konfiguration.")}</p>
    {error && <p className="admin-error" role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={() => void load(currentCursor)}>{text("Refresh","Uppdatera")}</button>
    <div className="admin-table-scroll" ref={table}><table className="admin-table"><thead><tr>
      <th>{text("Name","Namn")}</th><th>{text("Call sign","Anropssignal")}</th><th>{text("Status","Status")}</th><th>{text("Actions","Åtgärder")}</th>
    </tr></thead><tbody>{items.map(unit => {
      const edit = () => { if (!confirmDiscardChanges(dirty)) return; setDirty(false);setEditor({ ...unit }); };
      return <tr key={unit.id} onClick={event => canManage && activateListRow(event)} className="admin-directory-row">
        <td>{unit.name}</td><td>{unit.callSign}</td><td>{unit.active ? text("Active","Aktiv") : text("Inactive","Inaktiv")}</td>
        <td>{canManage && <button data-list-row-action type="button" onClick={event => { trigger.current=event.currentTarget;edit(); }}>{text("Edit","Redigera")} {unit.name}</button>} <button id={`unit-schedule-${unit.id}`} type="button" onClick={event => { trigger.current=event.currentTarget;setScheduleUnit(unit); }}>{text("Schedule","Schema")} {unit.name}</button>{canManage&&unit.active&&<UnitInstallations unitId={unit.id} unitName={unit.name} csrfToken={csrfToken} language={language}/>}</td>
      </tr>;
    })}</tbody></table></div>
    <div className="admin-role-editor-actions"><button type="button" disabled={busy || !currentCursor} onClick={() => void load()}>{text("First page","Första sidan")}</button>
      <button type="button" disabled={busy || !cursor} onClick={() => cursor && void load(cursor)}>{text("Next page","Nästa sida")}</button></div>
    {editor && <dialog ref={dialog} className="unit-dialog" aria-labelledby="unit-editor-heading" onCancel={event => { event.preventDefault();close(); }}>
      <h3 id="unit-editor-heading">{editor.id ? text("Edit unit","Redigera enhet") : text("Create unit","Skapa enhet")}</h3>
      <form onSubmit={async event => {
        event.preventDefault();setBusy(true);
        try {
          await saveOperationalUnit(csrfToken,editor.id,{ name:editor.name,callSign:editor.callSign,active:editor.active,
            ...(editor.id ? { expectedRevision:editor.revision } : {}) });
          close(true);await load(currentCursor);
        } catch { setError(text("Could not save. Check the call sign is unique in this agency and refresh if the unit changed.","Kunde inte spara. Kontrollera att anropssignalen är unik i organisationen och uppdatera om enheten ändrats.")); }
        finally { setBusy(false); }
      }}>
        <label>{text("Name","Namn")}<input autoFocus required maxLength={100} value={editor.name} onChange={event => { setDirty(true);setEditor({ ...editor,name:event.target.value }); }} /></label>
        <label>{text("Call sign","Anropssignal")}<input required maxLength={40} value={editor.callSign} onChange={event => { setDirty(true);setEditor({ ...editor,callSign:event.target.value }); }} /></label>
        <label><input type="checkbox" checked={editor.active} onChange={event => { setDirty(true);setEditor({ ...editor,active:event.target.checked }); }} />{text("Active","Aktiv")}</label>
        <p>{text("Deactivation preserves past reports and associations. Inactive call signs remain reserved.","Inaktivering bevarar tidigare rapporter och kopplingar. Inaktiva anropssignaler förblir reserverade.")}</p>
        {error && <p role="alert" className="admin-error">{error}</p>}
        <div className="admin-role-editor-actions"><button type="submit" disabled={busy}>{text("Save","Spara")}</button><button type="button" disabled={busy} onClick={() => close()}>{text("Cancel","Avbryt")}</button></div>
      </form></dialog>}
  </section>;
}
