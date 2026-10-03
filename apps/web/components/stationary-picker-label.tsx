"use client";

import React, { useState } from "react";

/** Picker titles expose help on hover, focus, or tap, including in read-only fieldsets. */
export function StationaryPickerLegend({ label, tooltipId, tooltip }: {
  readonly label: React.ReactNode;
  readonly tooltipId: string;
  readonly tooltip: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return <legend className="stationary-picker-label">
    <span id={`${tooltipId}-label`} tabIndex={0} aria-describedby={open ? tooltipId : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={(event) => { if (document.activeElement !== event.currentTarget) setOpen(false); }}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onClick={() => setOpen(true)} onKeyDown={(event) => {
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      }}>{label}</span>
    <small className="stationary-element-tooltip" id={tooltipId} role="tooltip" hidden={!open}>{tooltip}</small>
  </legend>;
}
