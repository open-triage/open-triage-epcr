"use client";

import { useAgencyTimeZone } from "../app/agency-time-zone";
import { useRegionalFormat } from "../app/regional-format";

/** Display instants in the agency clock, falling back to the browser clock. */
export function useLocalDateTime(language?: string) {
  const zone = useAgencyTimeZone();
  const region = useRegionalFormat();
  return (value: string, options?: Intl.DateTimeFormatOptions) => {
    if (!value.includes("T") || !Number.isFinite(Date.parse(value))) return value;
    return new Date(value).toLocaleString(region ?? language, { ...options, ...(zone ? { timeZone: zone } : {}) });
  };
}

export function LocalDateTime({ value, language, options }: {
  readonly value: string;
  readonly language?: string;
  readonly options?: Intl.DateTimeFormatOptions;
}) {
  return useLocalDateTime(language)(value, options);
}

/** Localize offset-qualified instants in imported clinical display text. */
export function LocalDateTimeText({ value, language }: { readonly value: string; readonly language?: string }) {
  const format = useLocalDateTime(language);
  return value.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g,
    (timestamp) => format(timestamp));
}
