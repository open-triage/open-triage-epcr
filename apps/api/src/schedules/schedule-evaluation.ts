import type { ShiftBreakpoint, ShiftCheckpoint, WeeklyScheduleVersion } from "@open-triage/contracts";
const minute = 60_000;
const day = 24 * 60 * minute;
function wallEpoch(format: Intl.DateTimeFormat, instant: number): number {
  const p = Object.fromEntries(format.formatToParts(instant).map(part => [part.type, part.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
}
const formatters = new Map<string, Intl.DateTimeFormat>();
const offsetCache = new Map<string, number[]>();
function formatter(timeZone: string) {
  const existing=formatters.get(timeZone);if(existing)return existing;
  const result=new Intl.DateTimeFormat("en-GB", { timeZone, year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23" });
  if(formatters.size>=128)formatters.clear();formatters.set(timeZone,result);return result;
}
/** Fold uses the earlier instant; a gap advances by its offset change (02:30 -> 03:30). */
export function resolveWallTime(wall: number, timeZone: string): number {
  const format = formatter(timeZone);
  const cacheKey=`${timeZone}/${Math.floor(wall/day)}`;
  let offsets=offsetCache.get(cacheKey);
  if(!offsets){
    const found=new Set<number>(),midnight=Math.floor(wall/day)*day;
    for(let delta=-48;delta<=72;delta+=6){const instant=midnight+delta*60*minute;found.add(wallEpoch(format,instant)-instant);}
    offsets=[...found];if(offsetCache.size>=512)offsetCache.clear();offsetCache.set(cacheKey,offsets);
  }
  const candidates = offsets.map(offset => wall - offset).sort((a,b) => a-b);
  const exact = candidates.filter(candidate => wallEpoch(format,candidate) === wall);
  if (exact.length) return exact[0]!;
  const after = candidates.filter(candidate => wallEpoch(format,candidate) > wall)
    .sort((a,b) => wallEpoch(format,a)-wallEpoch(format,b) || a-b);
  if (!after.length) throw new Error("Cannot resolve schedule wall clock");
  return after[0]!;
}
export function scheduleOccurrences(breakpoints: ShiftBreakpoint[], timeZone: string, now: number): Array<{ at:number; grace:number }> {
  const local = wallEpoch(formatter(timeZone), now);
  const midnight = Math.floor(local / day) * day;
  const result: Array<{ at:number; grace:number }> = [];
  // Eight local days each way cover a weekly event, 24h grace, DST and date-line jumps.
  for (let delta = -8; delta <= 8; delta++) {
    const date = midnight + delta * day;
    const weekday = new Date(date).getUTCDay() || 7;
    for (const point of breakpoints.filter(point => point.weekday === weekday)) {
      const [hours,minutes] = point.time.split(":").map(Number);
      const at = resolveWallTime(date + (hours! * 60 + minutes!) * minute, timeZone);
      result.push({at,grace:at-point.graceMinutes*minute});
    }
  }
  return result.sort((a,b) => a.at-b.at || b.grace-a.grace);
}
export function evaluateSchedule(versions: WeeklyScheduleVersion[], timeZone: string, now: number, selectedAt = -Infinity,
  fallback: ShiftCheckpoint | null = null) {
  const ordered = [...versions].sort((a,b) => Date.parse(a.effectiveAt)-Date.parse(b.effectiveAt));
  const current = ordered.filter(version => Date.parse(version.effectiveAt) <= now).at(-1);
  const events: ShiftCheckpoint[] = [];
  for (let index=0; index<ordered.length; index++) {
    const version=ordered[index]!;
    const start=Math.max(selectedAt,Date.parse(version.effectiveAt));
    const end=index+1<ordered.length ? Date.parse(ordered[index+1]!.effectiveAt) : Infinity;
    for (const event of scheduleOccurrences(version.breakpoints,timeZone,Math.min(now,end-1))) {
      if (event.at >= start && event.at < end) events.push({at:new Date(event.at).toISOString(),graceStartsAt:new Date(event.grace).toISOString(),revision:version.revision});
    }
  }
  events.sort((a,b) => Date.parse(a.at)-Date.parse(b.at) || Date.parse(b.graceStartsAt)-Date.parse(a.graceStartsAt));
  // Coincident gap-normalized events use the shortest grace; exact duplicates are rejected at authoring.
  const distinct = events.filter((event,index) => index===0 || event.at!==events[index-1]!.at);
  return { blank: !!current && current.breakpoints.length===0,
    activeCheckpoint: distinct.filter(event => Date.parse(event.at)<=now).at(-1) ?? fallback,
    nextCheckpoint: distinct.find(event => Date.parse(event.at)>now) ?? null,
    // Retain all overlapping windows. Authentication must satisfy each checkpoint's own window.
    graceCheckpoints: distinct.filter(event => Date.parse(event.at)>now && Date.parse(event.graceStartsAt)<=now) };
}
