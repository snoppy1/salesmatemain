"use client";

import { useEffect, useState } from "react";

type Metrics = {
  sales: { orderCount: number; totalRevenue: number };
  offered: { count: number; totalEstValue: number };
  sold: { count: number; totalSoldValue: number };
};

export default function UpsellMetric() {
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/metrics/refresh", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && d.offered) setM(d as Metrics);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!m) return null; // ระหว่างโหลด

  const baht = (n: number) => `฿${n.toLocaleString()}`;

  return (
    <div className="grid grid-cols-1 gap-2">
      <Tile label="ยอดขาย Lazada (เดือนนี้)" value={baht(m.sales.totalRevenue)} hint={`${m.sales.orderCount} ออเดอร์`} />
      <Tile label="AI เสนอพ่วง (ส่งแล้ว)" value={baht(m.offered.totalEstValue)} hint={`${m.offered.count} ครั้ง`} />
      <Tile label="พ่วงขายได้จริง" value={baht(m.sold.totalSoldValue)} hint={`${m.sold.count} ครั้ง`} highlight />
    </div>
  );
}

function Tile({
  label, value, hint, highlight,
}: {
  label: string; value: string; hint: string; highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        highlight
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
          : "border-zinc-300/60 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/40 dark:text-zinc-200"
      }`}
    >
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs opacity-60">{hint}</div>
    </div>
  );
}
