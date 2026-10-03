"use client";

import { useRef, type MouseEvent, type ReactNode } from "react";

export function activateListRow(event: MouseEvent<HTMLElement>) {
  if ((event.target as HTMLElement).closest("button, a, input, select, textarea, label, summary, [data-tooltip-trigger]")) return;
  event.currentTarget.querySelector<HTMLButtonElement>("[data-list-row-action]")?.click();
}

/** Keep the item's content plain while exposing its row action to keyboard users. */
export function ListRowAction({ children, label, itemName, onAction }: {
  readonly children: ReactNode;
  readonly label: string;
  readonly itemName: string;
  readonly onAction: (trigger: HTMLButtonElement) => void;
}) {
  const action = useRef<HTMLButtonElement>(null);
  return <div className="list-row-content" onClick={activateListRow}>
    {children}
    <button ref={action} type="button" data-list-row-action aria-label={`${label}: ${itemName}`}
      onClick={() => { if (action.current) onAction(action.current); }}>{label}</button>
  </div>;
}
