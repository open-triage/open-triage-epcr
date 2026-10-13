import { UnprocessableEntityException } from "@nestjs/common";
import type { SaveWeeklySchedule, ShiftBreakpoint } from "@open-triage/contracts";
export function validateSchedule(input: unknown, editing: boolean): SaveWeeklySchedule {
  const invalid=()=>new UnprocessableEntityException("Invalid weekly schedule: unique weekday/time, grace 0–1440 minutes, at most 168 breakpoints");
  if (!input || typeof input!=="object" || Array.isArray(input)) throw invalid();
  const value=input as Record<string,unknown>;
  if (Object.keys(value).some(key=>!["name","breakpoints","previewToken",...(editing?["expectedRevision"]:[])].includes(key)) ||
    (value.previewToken!==undefined && (typeof value.previewToken!=="string" || value.previewToken.length>16000)) ||
    typeof value.name!=="string" || !value.name.trim() || value.name.length>100 || /[\u0000-\u001f\u007f]/u.test(value.name) ||
    !Array.isArray(value.breakpoints) || value.breakpoints.length>168 ||
    (editing && (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision)<1))) throw invalid();
  const seen=new Set<string>();
  for (const item of value.breakpoints) {
    if (!item || typeof item!=="object" || Array.isArray(item)) throw invalid();
    const point=item as ShiftBreakpoint;
    if (Object.keys(point).some(key=>!["weekday","time","graceMinutes"].includes(key)) || !Number.isInteger(point.weekday) || point.weekday<1 || point.weekday>7 ||
      typeof point.time!=="string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(point.time) || !Number.isInteger(point.graceMinutes) || point.graceMinutes<0 || point.graceMinutes>1440) throw invalid();
    const key=`${point.weekday}/${point.time}`;if(seen.has(key)) throw invalid();seen.add(key);
  }
  return {name:value.name.trim(),breakpoints:[...value.breakpoints as ShiftBreakpoint[]].sort((a,b)=>a.weekday-b.weekday || a.time.localeCompare(b.time)),
    ...(editing?{expectedRevision:Number(value.expectedRevision)}:{})};
}
