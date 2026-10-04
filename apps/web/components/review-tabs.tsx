"use client";

/** Native buttons with roving focus keep every Review navigation usable by keyboard. */
export function ReviewTabs<T extends string>({ id, label, value, options, onChange }: {
  id: string;
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return <div className="review-tabs" role="tablist"
    aria-label={label} aria-orientation="horizontal">
    {options.map((option, index) => <button key={option.value} type="button" role="tab"
      id={`${id}-tab-${option.value}`} aria-controls={`${id}-panel-${option.value}`}
      aria-selected={value === option.value} tabIndex={value === option.value ? 0 : -1}
      onClick={() => onChange(option.value)} onKeyDown={(event) => {
        const target = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 :
          event.key === "ArrowRight" ? (index + 1) % options.length :
            event.key === "ArrowLeft" ? (index + options.length - 1) % options.length : null;
        if (target === null) return;
        const selected = options[target];
        if (!selected) return;
        event.preventDefault();
        onChange(selected.value);
        document.getElementById(`${id}-tab-${selected.value}`)?.focus();
      }}>{option.label}</button>)}
  </div>;
}
