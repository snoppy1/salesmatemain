import type { ReactNode } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-md rounded-2xl border border-line bg-surface shadow-2xl ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5">
            <h3 className="text-base font-semibold text-fg">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิด"
              className="rounded-md p-1 text-muted transition hover:bg-surface2 hover:text-fg"
            >
              ✕
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
