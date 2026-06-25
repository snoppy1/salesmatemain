import type { ReactNode } from "react";

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      {label && <span className="block text-sm font-medium text-fg">{label}</span>}
      {children}
      {error ? (
        <span className="block text-xs text-red-500">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}
