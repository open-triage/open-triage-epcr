import { clinicalInstantParts, clinicalWallTimeInput } from "./agency-time-zone";

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function localParts(instant: Date): { date: string; time: string; offset: string } {
  const minutes = -instant.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return {
    date: `${instant.getFullYear()}-${twoDigits(instant.getMonth() + 1)}-${twoDigits(instant.getDate())}`,
    time: `${twoDigits(instant.getHours())}:${twoDigits(instant.getMinutes())}`,
    offset: `${sign}${twoDigits(Math.floor(absolute / 60))}:${twoDigits(absolute % 60)}`,
  };
}

/** Show an authenticated NEMSIS instant in the browser's local clock, not its stored offset's clock. */
export function localStationaryDateTimeParts(value: string, zone: string | null = null): { date: string; time: string; offset: string } | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return undefined;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? (zone ? clinicalInstantParts(instant, zone) : localParts(instant)) : undefined;
}

/** Resolve the selected wall clock in the browser's zone and persist the instant in UTC. */
export function stationaryLocalDateTimeInput(date: string, time: string, zone: string | null = null, selected?: string): string {
  if (zone || selected) return clinicalWallTimeInput(date, time, zone, selected);
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!dateMatch || !timeMatch) throw new TypeError("A valid local date and time are required");
  const instant = new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]),
    Number(timeMatch[1]), Number(timeMatch[2]));
  // A nonexistent wall clock during the spring DST jump is normalized to the
  // next real local time rather than saved as an impossible local timestamp.
  return instant.toISOString().replace("Z", "+00:00");
}
