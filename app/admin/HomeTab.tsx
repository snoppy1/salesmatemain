"use client";

import { useEffect, useState } from "react";
import type { AdminOverview } from "@/lib/adminStats";

const CHANNEL_LABEL: Record<string, string> = {
  line: "LINE",
  lazada: "Lazada",
  facebook: "FB",
};

function fmtLast(ms: number | null): string {
  if (!ms) return "–";
  return new Date(ms).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HomeTab({ onOpenShop }: { onOpenShop: (id: string) => void }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/overview")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const d = (await res.json()) as AdminOverview;
        if (alive) setData(d);
      })
      .catch(() => alive && setError("โหลดภาพรวมไม่สำเร็จ ลองรีเฟรช"));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (!data) return <p className="text-sm text-muted">กำลังโหลดภาพรวม…</p>;

  const cards = [
    { label: "ร้านทั้งหมด", value: String(data.cards.totalShops) },
    { label: "ร้าน active วันนี้", value: String(data.cards.activeToday) },
    { label: "ข้อความลูกค้าวันนี้", value: String(data.cards.custMsgsToday) },
    // ฐานคิดโควตา subscription (จำกัดข้อความ/วัน) ในอนาคต
    { label: "AI ตอบวันนี้", value: String(data.cards.aiMsgsToday) },
    { label: "ต้นทุน AI วันนี้ (จริง)", value: `฿${data.cards.costTodayTHB.toFixed(2)}` },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-xs text-muted">{c.label}</p>
            <p className="mt-1 text-2xl font-bold text-fg">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">ร้าน</th>
              <th className="px-4 py-3 font-medium">อีเมลเจ้าของ</th>
              <th className="px-4 py-3 font-medium">ช่องทาง</th>
              <th className="px-4 py-3 font-medium text-right">สินค้า</th>
              <th className="px-4 py-3 font-medium text-right">บทสนทนา</th>
              <th className="px-4 py-3 font-medium text-right">ข้อความวันนี้ / 7วัน</th>
              <th className="px-4 py-3 font-medium text-right">AI ตอบวันนี้ / 7วัน</th>
              <th className="px-4 py-3 font-medium text-right">ต้นทุนจริง วันนี้ / 7วัน</th>
              <th className="px-4 py-3 font-medium">ใช้งานล่าสุด</th>
            </tr>
          </thead>
          <tbody>
            {data.shops.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onOpenShop(s.id)}
                    className="font-medium text-fg underline-offset-2 hover:underline"
                  >
                    {s.name || "(ไม่มีชื่อ)"}
                  </button>
                </td>
                <td className="px-4 py-3 text-muted">{s.email || "–"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {s.channels.length === 0 && <span className="text-muted">–</span>}
                    {s.channels.map((ch) => (
                      <span
                        key={ch}
                        className="rounded-full bg-surface2 px-2 py-0.5 text-xs font-semibold text-muted"
                      >
                        {CHANNEL_LABEL[ch] ?? ch}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">{s.productCount}</td>
                <td className="px-4 py-3 text-right">{s.conversationCount}</td>
                <td className="px-4 py-3 text-right">
                  {s.custMsgsToday} / {s.custMsgs7d}
                </td>
                <td className="px-4 py-3 text-right">
                  {s.aiMsgsToday} / {s.aiMsgs7d}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  ฿{s.costTodayTHB.toFixed(2)} / ฿{s.cost7dTHB.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-muted">{fmtLast(s.lastActivityAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
