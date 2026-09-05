import React from "react";

/** Shared through-border picker label with help that appears only over the label. */
export function StationaryPickerLegend({ label, tooltipId, tooltip }: {
  readonly label: React.ReactNode;
  readonly tooltipId: string;
  readonly tooltip: React.ReactNode;
}) {
  return <legend className="stationary-picker-label">
    <span>{label}</span>
    <small className="stationary-element-tooltip" id={tooltipId} role="tooltip">{tooltip}</small>
  </legend>;
}
