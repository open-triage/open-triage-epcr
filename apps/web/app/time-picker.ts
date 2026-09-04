export function parseClinicalTime(value: string): { hours: number; minutes: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (match) return { hours: Number(match[1]), minutes: Number(match[2]) };
  const now = new Date();
  return { hours: now.getHours(), minutes: now.getMinutes() };
}

export function adjustClockPart(value: number, delta: number, limit: number): number {
  return ((value + delta) % limit + limit) % limit;
}

export function repeatDelay(elapsedMs: number): number {
  if (elapsedMs < 450) return 340;
  if (elapsedMs < 1_100) return 190;
  if (elapsedMs < 1_900) return 105;
  return 55;
}

export function formatClinicalTime(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export type ClinicalDateTimeParts = {
  readonly date: string;
  readonly time: string;
};

/** Returns editable minute precision while retaining the canonical value separately. */
export function clinicalDateTimeParts(value: string, fallback = new Date()): ClinicalDateTimeParts {
  const match = /^(\d{4}-\d{2}-\d{2})T([0-2]\d:[0-5]\d)/.exec(value);
  return match
    ? { date: match[1]!, time: match[2]! }
    : { date: localClinicalDate(fallback), time: formatClinicalTime(fallback.getHours(), fallback.getMinutes()) };
}

function localOffset(date: string, time: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const offset = -new Date(year!, month! - 1, day!, hours!, minutes!).getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const absolute = Math.abs(offset);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

/** Rebuilds an offset-aware timestamp, preserving existing seconds/fraction and offset metadata. */
export function composeClinicalDateTime(date: string, time: string, previous = ""): string {
  const existing = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})$/.exec(previous);
  return `${date}T${time}${existing?.[1] ?? ":00"}${existing?.[2] ?? localOffset(date, time)}`;
}

export function localClinicalDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function adjustClinicalDate(value: string, delta: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = year && month && day ? new Date(year, month - 1, day) : new Date();
  date.setDate(date.getDate() + delta);
  return localClinicalDate(date);
}

export function formatClinicalDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year!, month! - 1, day);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}
