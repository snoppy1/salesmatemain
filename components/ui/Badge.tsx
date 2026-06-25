import type { ReactNode } from "react";

type Tone = "neutral" | "accent" | "warn" | "danger";

const tones: Record<Tone, string> = {
  neutral: "bg-surface2 text-muted",
  accent: "bg-accent/15 text-accent",
  warn: "bg-amber-500/15 text-amber-500",
  danger: "bg-red-500/15 text-red-500",
};

export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
