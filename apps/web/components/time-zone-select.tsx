"use client";

import React from "react";
import { resolveMessage, type AgencyLanguage } from "../app/localization";

export function timeZoneOptions(current: string | null = null): string[] {
  return [...new Set(["UTC", ...Intl.supportedValuesOf("timeZone"), ...(current ? [current] : [])])].sort();
}

export function TimeZoneSelect({ id, value, language, onChange }: {
  readonly id: string; readonly value: string | null; readonly language: AgencyLanguage;
  readonly onChange: (value: string | null) => void;
}) {
  return <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
    <option value="">{resolveMessage(language, "admin.useDeviceTime")}</option>
    {timeZoneOptions(value).map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
  </select>;
}
