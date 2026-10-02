"use client";

import React, { useId, useState, type ReactNode } from "react";

/** Shared mouse/touch drag handles with keyboard pickup, movement, drop and cancel. */
export function SortableList<T>({ items, identity, label, onMove, renderItem, disabled = false,
  ordered = false, className, ariaLabel, canDrag = () => true, language = "en" }: {
  items: readonly T[]; identity: (item: T) => string; label: (item: T) => string;
  onMove: (from: number, to: number) => void;
  renderItem: (item: T, index: number, handle: ReactNode) => ReactNode;
  disabled?: boolean; ordered?: boolean; className?: string; ariaLabel?: string;
  canDrag?: (item: T) => boolean; language?: string;
}) {
  const id = useId();
  const [drag, setDrag] = useState<{ key: string; target: string; keyboard: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const ids = items.map(identity);
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
      const handle = !disabled && canDrag(item) && items.filter(canDrag).length > 1 ? <button type="button" className="sort-handle" style={{ touchAction: "none" }}
        aria-label={`${language === "sv" ? "Ordna" : "Reorder"} ${label(item)}`} aria-describedby={`${id}-help`} aria-pressed={drag?.key === key}
        draggable onDragStart={(event) => {
          event.stopPropagation(); event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-opentriage-sort", JSON.stringify({ list: id, key }));
          setDrag({ key, target: key, keyboard: false });
        }} onDragEnd={() => setDrag(null)}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") return;
          event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
          setDrag({ key, target: key, keyboard: false });
        }} onPointerMove={(event) => {
          if (event.pointerType === "mouse" || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const target = targetAt(event.clientX, event.clientY);
          if (target) setDrag({ key, target, keyboard: false });
        }} onPointerUp={(event) => {
          if (event.pointerType === "mouse" || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          move(key, targetAt(event.clientX, event.clientY) ?? drag?.target ?? key);
        }} onPointerCancel={() => setDrag(null)}
        onKeyDown={(event) => {
          if (["Enter", " "].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            if (drag?.key === key && drag.keyboard) move(key, drag.target);
            else { setDrag({ key, target: key, keyboard: true }); setAnnouncement(`Reorder ${label(item)}`); }
          } else if (drag?.key === key && drag.keyboard && ["ArrowUp", "ArrowDown", "Home", "End", "Escape"].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            if (event.key === "Escape") { setDrag(null); return; }
            const movableIds = items.filter(canDrag).map(identity);
            const current = movableIds.indexOf(drag.target);
            const next = event.key === "Home" ? 0 : event.key === "End" ? movableIds.length - 1
              : Math.max(0, Math.min(movableIds.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
            setDrag({ ...drag, target: movableIds[next]! }); setAnnouncement(`${next + 1} / ${items.length}`);
          }
        }}><span aria-hidden="true">⠿</span></button> : null;
      return <Row key={key} data-sortable-item={key} data-sortable-list={id}
        className={`sortable-item${drag?.key === key ? " is-dragging" : ""}${drag?.target === key && drag.key !== key ? " is-drop-target" : ""}`}
        onDragOver={(event) => {
          if (disabled || !canDrag(item) || !drag || drag.keyboard) return;
          event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move";
          setDrag({ ...drag, target: key });
        }} onDrop={(event) => {
          if (disabled) return;
          event.stopPropagation();
          try {
            const data = JSON.parse(event.dataTransfer.getData("application/x-opentriage-sort"));
            if (data.list !== id) return;
            event.preventDefault(); move(data.key, key);
          } catch { /* Ignore drops from outside this list. */ }
        }}>{renderItem(item, index, handle)}</Row>;
    })}
  </Root>
    <span id={`${id}-help`} className="visually-hidden">{language === "sv" ? "Dra för att ändra ordning. Tryck mellanslag, använd piltangenter och tryck mellanslag igen. Escape avbryter." : "Drag to reorder. With the keyboard, press Space, use arrow keys, then Space to drop. Escape cancels."}</span>
    <span role="status" className="visually-hidden">{announcement}</span>
  </>;
}
