"use client";
import React,{useCallback,useEffect,useRef,useState} from "react";
import type { ScheduleChangePreview, ShiftBreakpoint, WeeklySchedule } from "@open-triage/contracts";
import { loadWeeklySchedules,previewWeeklySchedule,saveWeeklySchedule } from "../app/admin-context";
import { listAccessRemoved } from "../app/list-refresh";
import { confirmDiscardChanges,useUnsavedChanges } from "./unsaved-changes";
import { activateListRow } from "./list-row-action";
import { useAvailableHeight } from "./use-available-height";
export function SchedulesPanel({csrfToken,canManage,language}:{csrfToken:string;canManage:boolean;language:string}) {
  const sv=language==="sv";const t=useCallback((en:string,se:string)=>sv?se:en,[sv]);
  const weekdays=sv?["Måndag","Tisdag","Onsdag","Torsdag","Fredag","Lördag","Söndag"]:["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const [items,setItems]=useState<WeeklySchedule[]>([]);
  const [editor,setEditor]=useState<{id:string|null;name:string;revision?:number;breakpoints:ShiftBreakpoint[]}|null>(null);
  const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [changePreview,setChangePreview]=useState<ScheduleChangePreview|null>(null);
  const generation=useRef(0),trigger=useRef<HTMLButtonElement|null>(null);
  const table=useAvailableHeight<HTMLDivElement>(100);
  useUnsavedChanges(dirty);
  const load=useCallback(async()=>{const request=++generation.current;setBusy(true);try{const rows=await loadWeeklySchedules();if(request===generation.current){setItems(rows.items);setError(null);}}
    catch(reason){if(request===generation.current){if(listAccessRemoved(reason)){setItems([]);setEditor(null);}setError(t("Schedules could not be refreshed. Loaded results are retained.","Scheman kunde inte uppdateras. Inlästa resultat behålls."));}}
    finally{if(request===generation.current)setBusy(false);}},[t]);
  useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)void load();});return()=>{active=false;};},[load]);
  function close(saved=false){if(!saved&&!confirmDiscardChanges(dirty))return;setChangePreview(null);setEditor(null);setDirty(false);requestAnimationFrame(()=>document.getElementById(trigger.current?.id??"")?.focus());}
  if(editor) return <section className="admin-configuration agency-settings admin-directory schedule-editor"><div className="section-heading"><h2>{editor.id?t("Edit schedule","Redigera schema"):t("Create schedule","Skapa schema")}</h2></div>
    <form onSubmit={async event=>{event.preventDefault();setBusy(true);try{const body={name:editor.name,breakpoints:editor.breakpoints,...(editor.id?{expectedRevision:editor.revision}:{})};
      if(!changePreview){setChangePreview(await previewWeeklySchedule(csrfToken,editor.id,body));setError(null);}
      else{await saveWeeklySchedule(csrfToken,editor.id,{...body,previewToken:changePreview.previewToken});close(true);await load();}}
      catch{setChangePreview(null);setError(t("Could not save. Check duplicate times, grace bounds and the 500-schedule group limit; reload if a change is pending or the schedule changed.","Kunde inte spara. Kontrollera dubbla tider, fristgränser och gruppens gräns på 500 scheman. Uppdatera om en ändring väntar eller schemat ändrats."));}finally{setBusy(false);}}}>
      <label>{t("Schedule name","Schemanamn")}<input disabled={busy} autoFocus required maxLength={100} value={editor.name} onChange={event=>{setChangePreview(null);setDirty(true);setEditor({...editor,name:event.target.value});}}/></label>
      <p>{t("No breakpoints creates a deliberate blank schedule. Empty weekdays continue the previous shift. Changes become effective at the existing next handover; the server returns the effective time.","Utan brytpunkter skapas ett avsiktligt tomt schema. Tomma veckodagar fortsätter föregående pass. Ändringar börjar gälla vid nästa befintliga överlämning. Servern visar ikraftträdandet.")}</p>
      <p>{t("Times use each unit’s agency time zone. A repeated daylight-saving time uses its first occurrence; a skipped time advances by the clock change. Grace is 0–1440 minutes before the breakpoint. Overlapping grace windows retain each handover’s own requirement.","Tider använder enhetens organisations tidszon. Upprepad tid använder första förekomsten; överhoppad tid flyttas fram med klockändringen. Fristen är 0–1440 minuter före brytpunkten. Överlappande frister behåller varje överlämnings krav.")}</p>
      <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>{t("Weekday","Veckodag")}</th><th>{t("Time","Tid")}</th><th>{t("Grace (minutes)","Frist (minuter)")}</th><th>{t("Actions","Åtgärder")}</th></tr></thead><tbody>
        {editor.breakpoints.map((point,index)=>{function update(change:Partial<ShiftBreakpoint>){setChangePreview(null);setDirty(true);setEditor({...editor!,breakpoints:editor!.breakpoints.map((old,i)=>i===index?{...old,...change}:old)});}
          return <tr key={index}><td><select disabled={busy} aria-label={`${t("Weekday","Veckodag")} ${index+1}`} value={point.weekday} onChange={event=>update({weekday:Number(event.target.value)})}>{weekdays.map((name,i)=><option key={name} value={i+1}>{name}</option>)}</select></td>
            <td><input disabled={busy} aria-label={`${t("Time","Tid")} ${index+1}`} type="time" required step={60} value={point.time} onChange={event=>update({time:event.target.value})}/></td>
            <td><input disabled={busy} aria-label={`${t("Grace (minutes)","Frist (minuter)")} ${index+1}`} type="number" required min={0} max={1440} step={1} value={point.graceMinutes} onChange={event=>update({graceMinutes:Number(event.target.value)})}/></td>
            <td><button type="button" disabled={busy} className="button-destructive" onClick={()=>{setChangePreview(null);setDirty(true);setEditor({...editor,breakpoints:editor.breakpoints.filter((_,i)=>i!==index)});}}>{t("Remove","Ta bort")} {index+1}</button></td></tr>;})}
      </tbody></table></div>
      <button type="button" disabled={busy||editor.breakpoints.length>=168} onClick={()=>{setChangePreview(null);setDirty(true);setEditor({...editor,breakpoints:[...editor.breakpoints,{weekday:1,time:"",graceMinutes:0}]});}}>{t("Add breakpoint","Lägg till brytpunkt")}</button>
      {error&&<p className="admin-error" role="alert">{error}</p>}
      {changePreview&&<p role="status">{t("Will become effective at","Börjar gälla")}: <time dateTime={changePreview.effectiveAt}>{new Date(changePreview.effectiveAt).toLocaleString(language,{timeZone:"UTC",timeZoneName:"short",second:"2-digit",year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</time></p>}
      <div className="admin-role-editor-actions"><button className="button-primary" type="submit" disabled={busy}>{changePreview?t("Save","Spara"):t("Preview effective time","Förhandsvisa ikraftträdande")}</button><button type="button" disabled={busy} onClick={()=>close()}>{t("Cancel","Avbryt")}</button></div>
    </form></section>;
  return <section className="admin-configuration admin-directory schedules-directory"><div className="section-heading"><h2>{t("Shift schedules","Passcheman")}</h2>{canManage&&<button id="schedule-create" className="button-primary" type="button" onClick={event=>{trigger.current=event.currentTarget;setEditor({id:null,name:"",breakpoints:[]});setChangePreview(null);setDirty(false);}}>{t("Create schedule","Skapa schema")}</button>}</div>
    <p>{t("Named schedules are shared within this agency group (up to 500 schedules). Select a schedule separately for each unit.","Namngivna scheman delas inom organisationsgruppen (högst 500 scheman). Välj ett schema separat för varje enhet.")}</p>
    {error&&<p className="admin-error" role="alert">{error}</p>}<button type="button" disabled={busy} onClick={()=>void load()}>{t("Refresh","Uppdatera")}</button>
    <div className="admin-table-scroll" ref={table}><table className="admin-table"><thead><tr><th>{t("Name","Namn")}</th><th>{t("Breakpoints","Brytpunkter")}</th><th>{t("Effective at","Gäller från")}</th><th>{t("Actions","Åtgärder")}</th></tr></thead><tbody>{items.map(schedule=>{const version=schedule.versions.at(-1)!;return <tr key={schedule.id} className="admin-directory-row" onClick={event=>canManage&&activateListRow(event)}>
      <td>{schedule.name}</td><td>{version.breakpoints.length||t("Blank schedule","Tomt schema")}</td><td><time dateTime={version.effectiveAt}>{new Date(version.effectiveAt).toLocaleString(language,{timeZone:"UTC",timeZoneName:"short"})}</time></td><td>{canManage&&<button id={`schedule-edit-${schedule.id}`} type="button" data-list-row-action onClick={event=>{trigger.current=event.currentTarget;setEditor({...schedule,breakpoints:version.breakpoints});setChangePreview(null);setDirty(false);}}>{t("Edit","Redigera")} {schedule.name}</button>}</td></tr>;})}</tbody></table></div></section>;
}
