"use client";

import { createContext, useContext } from "react";

export type RegionalFormat = "en-US" | "sv-SE" | null;

/** Null preserves the formatting used before an agency selected a region. */
export const RegionalFormatContext = createContext<RegionalFormat>(null);
export function useRegionalFormat(): RegionalFormat { return useContext(RegionalFormatContext); }

export function formatClinicalDate(value: string | Date, region: RegionalFormat, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(region ?? "en-US", options ?? {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date);
}

export function formatClinicalNumber(value: number, region: RegionalFormat): string {
  return region ? new Intl.NumberFormat(region).format(value) : value.toLocaleString();
}

/** A decimal separator is accepted in either form; grouping and mixed punctuation are not. */
export function canonicalDecimal(input: string): string | null {
  const trimmed = input.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(trimmed)) return null;
  const canonical = trimmed.replace(",", ".");
  return Number.isFinite(Number(canonical)) ? canonical : null;
}

export function displayDecimal(value: string, region: RegionalFormat): string {
  return region === "sv-SE" ? value.replace(".", ",") : value;
}
