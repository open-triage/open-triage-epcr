export function QuickActionIcon({ kind }: { readonly kind: "vitals" | "medication" | "procedure" | "note" }) {
  const common = {
    width: 32,
    height: 32,
    viewBox: "0 0 32 32",
    fill: "var(--icon-surface, white)",
    stroke: "currentColor",
    strokeWidth: 2.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (kind === "vitals") return <svg {...common}>
    <path d="M16 28S4 20.7 4 11.8C4 7.4 6.8 4 11 4c2.4 0 4 1.2 5 3 1-1.8 2.6-3 5-3 4.2 0 7 3.4 7 7.8C28 20.7 16 28 16 28Z" />
  </svg>;

  if (kind === "medication") return <svg {...common}>
    <g transform="rotate(-45 16 16)">
      <rect x="4" y="10" width="24" height="12" rx="6" />
      <path d="M10 10h6v12h-6a6 6 0 0 1 0-12Z" fill="var(--icon-accent, currentColor)" stroke="none" />
      <path d="M16 10v12" />
    </g>
  </svg>;

  if (kind === "procedure") return <svg {...common}>
    <g transform="rotate(-45 16 16)">
      <rect x="3" y="10.5" width="26" height="11" rx="5.5" />
      <rect x="11.2" y="11.8" width="9.6" height="8.4" rx="2" />
      <circle cx="7.2" cy="16" r=".9" fill="currentColor" stroke="none" />
      <circle cx="24.8" cy="16" r=".9" fill="currentColor" stroke="none" />
      <circle cx="16" cy="14.3" r=".75" fill="currentColor" stroke="none" />
      <circle cx="16" cy="17.7" r=".75" fill="currentColor" stroke="none" />
    </g>
  </svg>;

  if (kind === "note") return <svg {...common}>
    <path d="m5 27 2-7L21.7 5.3a2.4 2.4 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4L12 25l-7 2Z" />
    <path d="m19.5 7.5 5 5M7 20l5 5" />
  </svg>;

  return null;
}
