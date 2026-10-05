"use client";

import React, { useId, useRef, useState, type ReactNode } from "react";

/** Shared mouse/touch drag handles with keyboard pickup, movement, drop and cancel. */
export function SortableList<T>({ items, identity, label, onMove, renderItem, disabled = false,
  ordered = false, className, ariaLabel, canDrag = () => true, language = "en", onItemClick }: {
  items: readonly T[]; identity: (item: T) => string; label: (item: T) => string;
  onMove: (from: number, to: number) => void;
  renderItem: (item: T, index: number, handle: ReactNode) => ReactNode;
  disabled?: boolean; ordered?: boolean; className?: string; ariaLabel?: string;
  canDrag?: (item: T) => boolean; language?: string;
  onItemClick?: (item: T, event: React.MouseEvent<HTMLElement>) => void;
}) {
  const id = useId();
  const pointer = useRef<number | null>(null);
  const [drag, setDrag] = useState<{ key: string; target: string; keyboard: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const ids = items.map(identity);
  const movableIds = items.filter(canDrag).map(identity);
  const move = (key: string, target: string) => {
    const from = ids.indexOf(key), to = ids.indexOf(target);
    if (!disabled && from >= 0 && to >= 0 && from !== to && canDrag(items[from]!) && canDrag(items[to]!)) {
      onMove(from, to); setAnnouncement(`${label(items[from]!)}: ${to + 1} / ${items.length}`);
    }
    setDrag(null);
  };
  const targetAt = (x: number, y: number) => {
    let row = window.document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-sortable-item]");
    while (row && row.dataset.sortableList !== id) row = row.parentElement?.closest<HTMLElement>("[data-sortable-item]");
    return row?.dataset.sortableItem;
  };
  const Root = ordered ? "ol" : "div";
  const Row = ordered ? "li" : "div";
  return <><Root className={className} aria-label={ariaLabel}>
    {items.map((item, index) => {
      const key = identity(item);
      const handle = !disabled && canDrag(item) && movableIds.length > 1 ? <button type="button" className="sort-handle" style={{ touchAction: "none" }}
        aria-label={`${language === "sv" ? "Ordna" : "Reorder"} ${label(item)}`} aria-describedby={`${id}-help`} aria-pressed={drag?.key === key}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId); pointer.current = event.pointerId;
          setDrag({ key, target: key, keyboard: false });
        }} onPointerMove={(event) => {
          if (pointer.current !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          event.stopPropagation();
          const target = targetAt(event.clientX, event.clientY);
          setDrag({ key, target: target ?? key, keyboard: false });
        }} onPointerUp={(event) => {
          if (pointer.current !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          event.stopPropagation(); pointer.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          move(key, targetAt(event.clientX, event.clientY) ?? key);
        }} onPointerCancel={(event) => { event.stopPropagation(); pointer.current = null; setDrag(null); }}
        onLostPointerCapture={() => { pointer.current = null; setDrag(null); }}
        onKeyDown={(event) => {
          if (["Enter", " "].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            if (drag?.key === key && drag.keyboard) move(key, drag.target);
            else { setDrag({ key, target: key, keyboard: true }); setAnnouncement(`Reorder ${label(item)}`); }
          } else if (drag?.key === key && drag.keyboard && ["ArrowUp", "ArrowDown", "Home", "End", "Escape"].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            if (event.key === "Escape") { setDrag(null); return; }
            const current = movableIds.indexOf(drag.target);
            const next = event.key === "Home" ? 0 : event.key === "End" ? movableIds.length - 1
              : Math.max(0, Math.min(movableIds.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
            setDrag({ ...drag, target: movableIds[next]! }); setAnnouncement(`${next + 1} / ${items.length}`);
          }
        }}><span aria-hidden="true">⠿</span></button> : null;
      const dropTarget = drag?.target === key && drag.key !== key && canDrag(item);
      return <Row key={key} data-sortable-item={key} data-sortable-list={id}
        onClick={onItemClick ? (event) => onItemClick(item, event) : undefined}
        data-drop-position={dropTarget ? ids.indexOf(drag.key) < index ? "after" : "before" : undefined}
        className={`sortable-item${drag?.key === key ? " is-dragging" : ""}${dropTarget ? " is-drop-target" : ""}`}>
        {renderItem(item, index, handle)}</Row>;
    })}
  </Root>
    <span id={`${id}-help`} className="visually-hidden">{language === "sv" ? "Dra för att ändra ordning. Tryck mellanslag, använd piltangenter och tryck mellanslag igen. Escape avbryter." : "Drag to reorder. With the keyboard, press Space, use arrow keys, then Space to drop. Escape cancels."}</span>
    <span role="status" className="visually-hidden">{announcement}</span>
  </>;
}
