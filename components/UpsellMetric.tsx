"use client";

import { useCallback, useEffect, useState } from "react";
import CountUp from "@/components/CountUp";
import { Stat } from "@/components/ui";

type Metrics = {
  sales: { orderCount: number; totalRevenue: number };
  offered: { count: number; totalEstValue: number };
  sold: { count: number; totalSoldValue: number };
};

/**
 * ตัวเลขยอดขาย/ยอดพ่วง — หลักฐานผลงานของ AI (data-forward)
 * layout: "col" = การ์ดเรียงลง (แถบข้างตั้งค่า) / "row" = 3 ช่องแนวนอน (หัวกล่องแชต)
 */
export default function UpsellMetric({ layout = "col" }: { layout?: "col" | "row" }) {
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    fetch("/api/metrics/refresh", { method: "POST" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (d && d.offered) setM(d as Metrics);
        else setError(true);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const wrap =
    layout === "row" ? "grid grid-cols-1 gap-2 sm:grid-cols-3" : "grid grid-cols-1 gap-2";

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-xs text-muted">
        โหลดตัวเลขไม่สำเร็จ
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-line px-2 py-0.5 font-medium text-fg transition hover:bg-surface2"
        >
          ลองใหม่
        </button>
      </div>
    );
  }

  if (!m) {
    // skeleton — กันหน้ากระตุก (ไม่หายเงียบระหว่างโหลด)
    return (
      <div className={wrap} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="animate-pulse rounded-xl border border-line bg-surface px-4 py-3">
            <div className="h-3 w-24 rounded bg-surface2" />
            <div className="mt-2 h-5 w-16 rounded bg-surface2" />
          </div>
        ))}
      </div>
    );
  }

  const baht = (n: number) => `฿${n.toLocaleString()}`;

  return (
    <div className={wrap}>
      <Stat
        label="ยอดขายรวม (เดือนนี้)"
        value={<CountUp value={m.sales.totalRevenue} format={baht} />}
        hint={`${m.sales.orderCount} ออเดอร์`}
      />
      <Stat
        label="AI เสนอพ่วง"
        value={<CountUp value={m.offered.totalEstValue} format={baht} />}
        hint={`${m.offered.count} ครั้ง`}
      />
      <Stat
        label="พ่วงขายได้จริง"
        value={<CountUp value={m.sold.totalSoldValue} format={baht} />}
        hint={`${m.sold.count} ครั้ง`}
        highlight
      />
    </div>
  );
}
