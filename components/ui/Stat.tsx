import type { ReactNode } from "react";

export function Stat({
  label,
  value,
  hint,
  highlight = false,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        highlight ? "border-accent/40 bg-accent/10" : "border-line bg-surface"
      }`}
    >
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-lg font-bold ${highlight ? "text-accent" : "text-fg"}`}>{value}</div>
      {hint && <div className="text-xs text-muted/80">{hint}</div>}
    </div>
  );
}
