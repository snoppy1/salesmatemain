"use client";

import { useEffect, useState } from "react";
import { Stat } from "@/components/ui";

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
      <Stat label="ยอดขาย Lazada (เดือนนี้)" value={baht(m.sales.totalRevenue)} hint={`${m.sales.orderCount} ออเดอร์`} />
      <Stat label="AI เสนอพ่วง" value={baht(m.offered.totalEstValue)} hint={`${m.offered.count} ครั้ง`} />
      <Stat label="พ่วงขายได้จริง" value={baht(m.sold.totalSoldValue)} hint={`${m.sold.count} ครั้ง`} highlight />
    </div>
  );
}
