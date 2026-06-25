"use client";

import { useEffect, useState } from "react";

export default function UpsellMetric() {
  const [data, setData] = useState<{ count: number; totalEstValue: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/metrics/upsell")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.count === "number") setData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!data || data.count === 0) return null;

  return (
    <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200">
      เดือนนี้ AI เสนอพ่วง (ส่งแล้ว){" "}
      <b>{data.count}</b> ครั้ง · มูลค่า <b>฿{data.totalEstValue.toLocaleString()}</b>
    </div>
  );
}
