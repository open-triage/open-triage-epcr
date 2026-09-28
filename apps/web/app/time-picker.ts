import { clinicalInstantParts } from "./agency-time-zone";

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

export function localClinicalDate(date = new Date(), zone: string | null = null): string {
  if (zone) return clinicalInstantParts(date, zone)?.date ?? "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function adjustClinicalDate(value: string, delta: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = year && month && day ? new Date(year, month - 1, day) : new Date();
  date.setDate(date.getDate() + delta);
  return localClinicalDate(date);
}

export function formatClinicalDate(value: string, region?: "en-US" | "sv-SE" | null): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year!, month! - 1, day);
  return new Intl.DateTimeFormat(region ?? undefined, { month: "short", day: "numeric" }).format(date);
}
