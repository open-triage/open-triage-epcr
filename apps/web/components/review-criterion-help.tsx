"use client";

import { FieldHelp } from "./field-help";

export function ReviewCriterionHelp({ id, label, description }: { readonly id: string; readonly label: string; readonly description: string }) {
  return <FieldHelp id={id} className="review-row-criterion" label={label} text={description} />;
}
