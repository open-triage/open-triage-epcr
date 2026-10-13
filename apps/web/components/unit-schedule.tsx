"use client";
import React,{useCallback,useEffect,useRef,useState} from "react";
import type { ScheduleChangePreview,UnitSchedulePreview,WeeklySchedule } from "@open-triage/contracts";
import { loadUnitSchedule,loadWeeklySchedules,previewUnitSchedule,selectUnitSchedule } from "../app/admin-context";
import { listAccessRemoved } from "../app/list-refresh";
import { confirmDiscardChanges,useUnsavedChanges } from "./unsaved-changes";
export function UnitScheduleEditor({unitId,unitName,csrfToken,canManage,language,onClose}:{unitId:string;unitName:string;csrfToken:string;canManage:boolean;language:string;onClose:()=>void}) {
  const t=useCallback((en:string,se:string)=>language==="sv"?se:en,[language]);
  const [preview,setPreview]=useState<UnitSchedulePreview|null>(null),[schedules,setSchedules]=useState<WeeklySchedule[]>([]);
  const [selected,setSelected]=useState(""),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [changePreview,setChangePreview]=useState<ScheduleChangePreview|null>(null);
  const request=useRef(0);useUnsavedChanges(dirty);
  const load=useCallback(async()=>{const generation=++request.current;setBusy(true);try{const [result,directory]=await Promise.all([loadUnitSchedule(unitId),loadWeeklySchedules()]);
    if(generation!==request.current)return;setPreview(result);setSchedules(directory.items);setError(null);setSelected(result.pending?(result.pending.scheduleId??""):(result.scheduleId??""));setChangePreview(null);setDirty(false);
    }catch(reason){if(generation===request.current){if(listAccessRemoved(reason)){setPreview(null);setSchedules([]);}setError(t("Could not refresh the schedule. Loaded information is retained.","Kunde inte uppdatera schemat. Inläst information behålls."));}}
    finally{if(generation===request.current)setBusy(false);}},[unitId,t]);
  useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)void load();});return()=>{active=false;};},[load]);
  function time(value:string){return new Intl.DateTimeFormat(language,{timeZone:preview!.timeZone,dateStyle:"medium",timeStyle:"long",hourCycle:"h23"}).format(new Date(value));}
  return <section className="admin-configuration agency-settings"><div className="section-heading"><h2>{t("Schedule for","Schema för")} {unitName}</h2></div>
    {error&&<p className="admin-error" role="alert">{error}</p>}
    {preview&&<><p>{t("Agency time zone","Organisationens tidszon")}: {preview.timeZone}</p>
      <p role="status">{preview.state==="missing"?t("No schedule selected — setup incomplete","Inget schema valt — inställningen är ofullständig"):preview.state==="blank"?t("Blank schedule — no scheduled handovers","Tomt schema — inga schemalagda överlämningar"):preview.scheduleName}</p>
      <dl>{preview.activeVersion&&<><dt>{t("Active schedule version","Aktiv schemaversion")}</dt><dd>{preview.activeVersion.revision}</dd></>}
        {preview.nextVersion&&<><dt>{t("Next schedule version","Nästa schemaversion")}</dt><dd>{preview.nextVersion.revision} — <time dateTime={preview.nextVersion.effectiveAt}>{time(preview.nextVersion.effectiveAt)}</time></dd></>}
        {preview.effectiveAt&&!preview.pending&&<><dt>{t("Selection effective at","Valet gäller från")}</dt><dd><time dateTime={preview.effectiveAt}>{time(preview.effectiveAt)}</time></dd></>}
        <dt>{t("Server evaluated at","Serverns utvärderingstid")}</dt><dd>{time(preview.evaluatedAt)}</dd>
        {preview.nextCheckpoint&&<><dt>{t("Next handover","Nästa överlämning")}</dt><dd><time dateTime={preview.nextCheckpoint.at}>{time(preview.nextCheckpoint.at)}</time></dd><dt>{t("Grace starts","Fristen börjar")}</dt><dd>{time(preview.nextCheckpoint.graceStartsAt)}</dd></>}
        {preview.pending&&<><dt>{t("Selection effective at","Valet gäller från")}</dt><dd>{time(preview.pending.effectiveAt)}</dd></>}
      </dl>
      <form onSubmit={async event=>{event.preventDefault();setBusy(true);try{if(!changePreview){setChangePreview(await previewUnitSchedule(csrfToken,unitId,selected||null,preview.selectionRevision));setError(null);}
        else{const result=await selectUnitSchedule(csrfToken,unitId,selected||null,preview.selectionRevision,changePreview.previewToken);setPreview(result as UnitSchedulePreview);setChangePreview(null);setDirty(false);setError(null);}}
        catch{setChangePreview(null);setError(t("Could not save. Refresh if selection changed or a change is pending.","Kunde inte spara. Uppdatera om valet ändrats eller en ändring väntar."));}finally{setBusy(false);}}}>
        <label htmlFor={`unit-selected-schedule-${unitId}`}>{t("Selected schedule","Valt schema")}</label><select id={`unit-selected-schedule-${unitId}`} disabled={!canManage||busy||!!preview.pending} value={selected} onChange={event=>{setSelected(event.target.value);setChangePreview(null);setDirty(true);}}>
          <option value="">{t("No selection (incomplete)","Inget val (ofullständigt)")}</option>{schedules.map(schedule=><option key={schedule.id} value={schedule.id}>{schedule.name}{schedule.versions.at(-1)!.breakpoints.length?"":t(" (blank)"," (tomt)")}</option>)}</select>
        <p>{t("Changes preserve the current shift and take effect at its next handover. First selection starts now; no past handover is invented.","Ändringar bevarar aktuellt pass och börjar gälla vid nästa överlämning. Första valet börjar nu; tidigare överlämningar skapas inte.")}</p>
        {changePreview&&<p role="status">{t("Will become effective at","Börjar gälla")}: <time dateTime={changePreview.effectiveAt}>{time(changePreview.effectiveAt)} ({preview.timeZone})</time></p>}
        <div className="admin-role-editor-actions">{canManage&&<button className="button-primary" type="submit" disabled={busy||!dirty||!!preview.pending}>{changePreview?t("Save selection","Spara val"):t("Preview effective time","Förhandsvisa ikraftträdande")}</button>}
          <button type="button" disabled={busy} onClick={()=>{if(confirmDiscardChanges(dirty))void load();}}>{t("Refresh","Uppdatera")}</button>
          <button type="button" disabled={busy} onClick={()=>{if(confirmDiscardChanges(dirty))onClose();}}>{t("Back to units","Tillbaka till enheter")}</button></div>
      </form></>}
    {!preview&&<button type="button" onClick={onClose}>{t("Back to units","Tillbaka till enheter")}</button>}
  </section>;
}
