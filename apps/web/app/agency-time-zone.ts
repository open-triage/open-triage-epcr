"use client";

import { createContext, useContext } from "react";

/** Null keeps the browser clock used by installations without an agency zone. */
export const AgencyTimeZoneContext = createContext<string | null>(null);
export function useAgencyTimeZone(): string | null { return useContext(AgencyTimeZoneContext); }

export function isNamedTimeZone(value: string): boolean {
  if (!/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z_+-]+)+)$/.test(value)) return false;
  try { return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone !== undefined; }
  catch { return false; }
}

function parts(instant: Date, zone: string): { date: string; time: string } {
  const fields = new Intl.DateTimeFormat("en-CA", { timeZone: zone, calendar: "gregory", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(instant);
  const get = (type: string) => fields.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export function clinicalInstantParts(value: string | Date, zone: string | null): { date: string; time: string; offset: string } | undefined {
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime())) return undefined;
  if (!zone) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const minutes = -instant.getTimezoneOffset();
    return { date: `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`,
      time: `${pad(instant.getHours())}:${pad(instant.getMinutes())}`,
      offset: `${minutes < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}` };
  }
  const wall = parts(instant, zone);
  const wallUtc = Date.parse(`${wall.date}T${wall.time}:00Z`);
  const minutes = Math.round((wallUtc - Math.floor(instant.getTime() / 60000) * 60000) / 60000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { ...wall, offset: `${minutes < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}` };
}

/** Every matching instant, ordered earliest first. Two matches mean a DST overlap. */
export function clinicalWallTimeCandidates(date: string, time: string, zone: string | null): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return [];
  const base = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0, 10) !== date) return [];
  if (!zone) {
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    const local = new Date(year!, month! - 1, day!, hour!, minute!);
    if (local.getFullYear() !== year || local.getMonth() + 1 !== month || local.getDate() !== day || local.getHours() !== hour || local.getMinutes() !== minute) return [];
    const candidates = [local.toISOString()];
    // Check the adjacent offset so a repeated local hour is explicit as well.
    for (const delta of [-3600000, 3600000, -7200000, 7200000]) {
      const adjacent = new Date(local.getTime() + delta);
      if (adjacent.getFullYear() === year && adjacent.getMonth() + 1 === month && adjacent.getDate() === day && adjacent.getHours() === hour && adjacent.getMinutes() === minute) candidates.push(adjacent.toISOString());
    }
    return [...new Set(candidates)].sort();
  }
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const probe = new Date(base + hours * 3600000);
    const wall = parts(probe, zone);
    offsets.add(Math.round((Date.parse(`${wall.date}T${wall.time}:00Z`) - probe.getTime()) / 60000));
  }
  return [...offsets].map((offset) => new Date(base - offset * 60000))
    .filter((instant) => { const wall = parts(instant, zone); return wall.date === date && wall.time === time; })
    .map((instant) => instant.toISOString()).sort();
}

export function clinicalWallTimeInput(date: string, time: string, zone: string | null, selected?: string): string {
  const candidates = clinicalWallTimeCandidates(date, time, zone);
  if (!candidates.length) throw new RangeError("This local time does not exist. Choose another time.");
  if (candidates.length > 1 && !selected) throw new RangeError("This local time occurs twice. Choose the first or second occurrence.");
  if (selected && !candidates.includes(selected)) throw new RangeError("Choose a valid occurrence of this local time.");
  return (selected ?? candidates[0]!).replace("Z", "+00:00");
}
