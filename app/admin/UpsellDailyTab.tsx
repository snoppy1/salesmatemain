"use client";

import { useCallback, useEffect, useState } from "react";

/** ยอดขายจากการพ่วงของ AI รายวัน แยกรายร้าน — "เสนอ" คือประมาณจากราคาตอนเสนอ, "ขายได้จริง" แมตช์กับออเดอร์แล้ว */

type Row = {
  day: string;
  shopId: string;
  shopName: string;
  offered: number;
  estValue: number;
  sold: number;
  soldValue: number;
  cards: number;
};
type Data = {
  days: number;
  rows: Row[];
  totals: { offered: number; estValue: number; sold: number; soldValue: number; cards: number };
};

const RANGES: { days: number; label: string }[] = [
  { days: 7, label: "7 วัน" },
  { days: 30, label: "30 วัน" },
];

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function thaiDay(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${THAI_MONTHS[(m ?? 1) - 1]}`;
}

export default function UpsellDailyTab() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  const load = useCallback((d: number) => {
    setError("");
    setData(null);
    fetch(`/api/admin/upsell-daily?days=${d}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => setData(j as Data))
      .catch(() => setError("โหลดข้อมูลไม่สำเร็จ ลองรีเฟรช"));
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  const dayList = data ? [...new Set(data.rows.map((r) => r.day))] : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">ยอดขายจากการพ่วงของ AI · รายวัน · รายร้าน</h3>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                days === r.days
                  ? "bg-fg text-surface"
                  : "border border-line bg-surface text-muted hover:bg-surface2"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {!error && !data && <p className="text-sm text-muted">กำลังโหลด…</p>}

      {data && (
        <>
          {/* สรุปทั้งช่วง — กรวย: เสนอ → ส่งการ์ด (ของถึงมือลูกค้า) → ซื้อจริง */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: "AI เสนอพ่วง", value: `${data.totals.offered.toLocaleString()} ครั้ง` },
              { label: "ส่งการ์ดสินค้า (Lazada)", value: `${data.totals.cards.toLocaleString()} ใบ` },
              { label: "มูลค่าที่เสนอ (ประมาณ)", value: `฿${data.totals.estValue.toLocaleString()}` },
              { label: "ปิดได้จริง", value: `${data.totals.sold.toLocaleString()} ครั้ง` },
              { label: "ยอดขายจริงจากพ่วง", value: `฿${data.totals.soldValue.toLocaleString()}` },
            ].map((c) => (
              <div key={c.label} className="rounded-2xl border border-line bg-surface px-4 py-3">
                <p className="text-xs text-muted">{c.label}</p>
                <p className="mt-1 text-lg font-semibold text-fg">{c.value}</p>
              </div>
            ))}
          </div>

          {dayList.length === 0 && (
            <p className="rounded-2xl border border-line bg-surface px-4 py-6 text-center text-sm text-muted">
              ยังไม่มีการเสนอพ่วงในช่วงนี้
            </p>
          )}

          {dayList.map((day) => {
            const rows = data.rows.filter((r) => r.day === day);
            return (
              <div key={day} className="overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="border-b border-line bg-surface2 px-4 py-2 text-sm font-semibold text-fg">
                  {thaiDay(day)}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-muted">
                        <th className="px-4 py-2 font-medium">ร้าน</th>
                        <th className="px-4 py-2 font-medium text-right">เสนอพ่วง</th>
                        <th className="px-4 py-2 font-medium text-right">ส่งการ์ด</th>
                        <th className="px-4 py-2 font-medium text-right">มูลค่าที่เสนอ (ประมาณ)</th>
                        <th className="px-4 py-2 font-medium text-right">ปิดได้จริง</th>
                        <th className="px-4 py-2 font-medium text-right">ยอดขายจริง</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={`${r.day}-${r.shopId}`} className="border-b border-line last:border-0">
                          <td className="px-4 py-2 font-medium text-fg">{r.shopName || "(ไม่มีชื่อ)"}</td>
                          <td className="px-4 py-2 text-right">
                            {r.offered > 0 ? `${r.offered.toLocaleString()} ครั้ง` : "-"}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {r.cards > 0 ? `${r.cards.toLocaleString()} ใบ` : "-"}
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap text-muted">
                            {r.estValue > 0 ? `฿${r.estValue.toLocaleString()}` : "-"}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {r.sold > 0 ? `${r.sold.toLocaleString()} ครั้ง` : "-"}
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap font-semibold text-fg">
                            {r.soldValue > 0 ? `฿${r.soldValue.toLocaleString()}` : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          <p className="text-xs text-muted">
            &quot;มูลค่าที่เสนอ&quot; เป็นตัวเลขประมาณจากราคาสินค้าตอน AI เสนอ ·
            &quot;ส่งการ์ด&quot; = การ์ดสินค้าที่ยื่นถึงมือลูกค้าในแชต Lazada (ขากลางของกรวย เสนอ→เห็นของ→ซื้อ;
            Lazada ไม่บอกว่าลูกค้ากดการ์ดไหม) ·
            &quot;ปิดได้จริง/ยอดขายจริง&quot; นับเฉพาะที่แมตช์กับออเดอร์จริงแล้วเท่านั้น
          </p>
        </>
      )}
    </div>
  );
}
