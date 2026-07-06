"use client";

import { useEffect, useState } from "react";

type ShopProblem = {
  shopName: string;
  accountName: string;
  severity: "critical" | "warning";
  reason: string;
};

/**
 * แบนเนอร์เตือนหน้าแรกแอดมิน — ร้านที่ token Lazada พัง (หมดอายุ / ต่ออายุล้มเหลว)
 * โชว์ชื่อร้านชัดๆ เพื่อรีบไปกดเชื่อมใหม่ ก่อนแชตหยุดยาว
 */
export default function TokenAlerts() {
  const [problems, setProblems] = useState<ShopProblem[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/admin/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { problems?: ShopProblem[] } | null) => {
          if (alive && d?.problems) setProblems(d.problems);
        })
        .catch(() => {});
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (problems.length === 0) return null;

  const hasCritical = problems.some((p) => p.severity === "critical");

  return (
    <div
      className={`rounded-2xl border p-4 ${
        hasCritical
          ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
          : "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
      }`}
      role="alert"
    >
      <p
        className={`text-sm font-bold ${
          hasCritical
            ? "text-red-700 dark:text-red-300"
            : "text-amber-700 dark:text-amber-300"
        }`}
      >
        การเชื่อมต่อ Lazada มีปัญหา {problems.length} ร้าน — ร้านต้องกดเชื่อม Lazada ใหม่
      </p>
      <ul className="mt-2 space-y-1.5">
        {problems.map((p, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span
              className={`inline-block h-2 w-2 shrink-0 translate-y-[-1px] rounded-full ${
                p.severity === "critical" ? "bg-red-500" : "bg-amber-500"
              }`}
              aria-hidden="true"
            />
            <span className="font-semibold text-fg">{p.shopName}</span>
            <span className="text-xs text-muted">{p.accountName}</span>
            <span className="text-muted">— {p.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
