import type { ReactNode } from "react";
import { resolveMessage } from "../app/localization";

export function vitalPointsLabel(language: string, points: number | null | undefined): string | undefined {
  if (points === null) return resolveMessage(language, "mobile.westFieldPointsPending");
  return points === undefined ? undefined : resolveMessage(language, "mobile.westFieldPoints", { points }, points);
}

export function VitalField({ id, label, unit, help, pointsLabel, className, children, action, validation }: {
  readonly id: string;
  readonly label: string;
  readonly unit?: string;
  readonly help?: string;
  readonly pointsLabel?: string;
  readonly className?: string;
  readonly children: (describedBy: string | undefined) => ReactNode;
  readonly action?: ReactNode;
  readonly validation?: ReactNode;
}) {
  const describedBy = [help && `${id}-help`, pointsLabel && `${id}-points`].filter(Boolean).join(" ") || undefined;
  return <div className={className ? `vital-field ${className}` : "vital-field"}>
    <div className="vital-field-heading">
      <label className="vital-field-label" htmlFor={id} tabIndex={help ? 0 : undefined}>
        {label}{unit && <> <small>{unit}</small></>}
        {help && <small className="stationary-element-tooltip" id={`${id}-help`} role="tooltip">{help}</small>}
      </label>
      {pointsLabel && <span className="vital-field-points" id={`${id}-points`}>{pointsLabel}</span>}
    </div>
    <div className={action ? "vital-inputs vital-inputs-with-action" : "vital-inputs"}>
      {children(describedBy)}
      {action}
    </div>
    {validation}
  </div>;
}
