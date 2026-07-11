"use client";

import { useCallback, useEffect, useState } from "react";

/** โมเดล AI ที่ใช้ตอบ + ต้นทุน + จำนวนแชต — รวมทุกร้าน และคลิกดูรายร้าน */

type ModelAgg = {
  model: string;
  replies: number;
  replyCostThb: number;
  imports: number;
  importCostThb: number;
  prewarmCostThb: number;
  cacheWriteCostThb: number;
  coldWrites: number;
  totalCostThb: number;
};
type ShopModelUsage = {
  shopId: string;
  shopName: string;
  replies: number;
  totalCostThb: number;
  models: ModelAgg[];
};
type DailyWriteRow = {
  day: string;
  shopId: string;
  shopName: string;
  chatWrites: number;
  prewarmWrites: number;
  costThb: number;
};
type Data = {
  days: number;
  overall: ModelAgg[];
  byShop: ShopModelUsage[];
  dailyWrites: DailyWriteRow[];
  totals: { replies: number; costThb: number };
};

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function thaiDay(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${THAI_MONTHS[(m ?? 1) - 1]}`;
}

/** ชื่อ + บทบาทของโมเดล (จาก router: Opus = เคสยาก, Sonnet = ทั่วไป) */
const MODEL_INFO: Record<string, { name: string; tier: string }> = {
  "claude-opus-4-8": { name: "Opus 4.8", tier: "เคสยาก/เดิมพันสูง" },
  "claude-sonnet-4-6": { name: "Sonnet 4.6", tier: "ทั่วไป/สินค้า-ราคา" },
};
function modelName(m: string): string {
  return MODEL_INFO[m]?.name ?? m;
}
function modelTier(m: string): string {
  return MODEL_INFO[m]?.tier ?? "";
}

const RANGES: { days: number; label: string }[] = [
  { days: 1, label: "วันนี้" },
  { days: 7, label: "7 วัน" },
  { days: 30, label: "30 วัน" },
];

export default function ModelUsageTab() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [openShop, setOpenShop] = useState<string | null>(null);

  const load = useCallback((d: number) => {
    setError("");
    setData(null);
    fetch(`/api/admin/model-usage?days=${d}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => setData(j as Data))
      .catch(() => setError("โหลดข้อมูลไม่สำเร็จ ลองรีเฟรช"));
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">โมเดล AI ที่ใช้ตอบ · ต้นทุน · จำนวนแชต</h3>
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
          {/* รวมทุกร้าน */}
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-3 font-medium">โมเดล (รวมทุกร้าน)</th>
                  <th className="px-4 py-3 font-medium text-right">ข้อความที่ตอบ</th>
                  <th className="px-4 py-3 font-medium text-right">ต้นทุนตอบ</th>
                  <th className="px-4 py-3 font-medium text-right">นำเข้าสินค้า</th>
                  <th className="px-4 py-3 font-medium text-right">อุ่นแคช</th>
                  <th className="px-4 py-3 font-medium text-right">เขียนแคชใหม่*</th>
                  <th className="px-4 py-3 font-medium text-right">รวมต้นทุน</th>
                </tr>
              </thead>
              <tbody>
                {data.overall.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-xs text-muted">
                      ยังไม่มีการใช้ AI ในช่วงนี้
                    </td>
                  </tr>
                )}
                {data.overall.map((m) => (
                  <tr key={m.model} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-medium text-fg">{modelName(m.model)}</span>
                      {modelTier(m.model) && (
                        <span className="ml-2 text-xs text-muted">{modelTier(m.model)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{m.replies.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      ฿{m.replyCostThb.toFixed(2)}
                      {m.replies > 0 && (
                        <span className="ml-1 text-xs text-muted">
                          (฿{(m.replyCostThb / m.replies).toFixed(2)}/ข้อความ)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-muted">
                      {m.imports > 0 ? `฿${m.importCostThb.toFixed(2)}` : "-"}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-muted">
                      ฿{m.prewarmCostThb.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-muted">
                      ฿{m.cacheWriteCostThb.toFixed(2)}
                      {m.coldWrites > 0 && (
                        <span className="ml-1 text-xs">({m.coldWrites} ครั้ง)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-fg">
                      ฿{m.totalCostThb.toFixed(2)}
                    </td>
                  </tr>
                ))}
                {data.overall.length > 0 && (
                  <tr className="bg-surface2">
                    <td className="px-4 py-3 font-semibold text-fg">รวม</td>
                    <td className="px-4 py-3 text-right font-semibold text-fg">
                      {data.totals.replies.toLocaleString()}
                    </td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-fg">
                      ฿{data.totals.costThb.toFixed(2)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            * ต้นทุนตอบ = ค่าตอบแท้ๆ ต่อข้อความ (ไม่รวมค่าเขียนแคช) · เขียนแคชใหม่ = ค่า &quot;จุดแคช&quot;
            ตอนข้อความมาแล้วไม่มีแคชเดิม (วงเล็บ = กี่ครั้ง) · อุ่นแคชรวมค่าจุดของระบบอุ่นเองแล้ว —
            ต้นทุนตอบ + นำเข้า + อุ่นแคช + เขียนแคชใหม่ ≈ รวมต้นทุน
          </p>

          {/* แยกรายร้าน — คลิกเพื่อดูโมเดลของร้านนั้น */}
          <div>
            <h4 className="mb-2 text-sm font-semibold text-fg">แยกรายร้าน (คลิกเพื่อดูโมเดลของร้าน)</h4>
            <div className="overflow-hidden rounded-2xl border border-line bg-surface">
              {data.byShop.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-muted">ยังไม่มีร้านที่ใช้ AI ในช่วงนี้</p>
              )}
              {data.byShop.map((s) => {
                const open = openShop === s.shopId;
                return (
                  <div key={s.shopId} className="border-b border-line last:border-0">
                    <button
                      type="button"
                      onClick={() => setOpenShop(open ? null : s.shopId)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface2"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="text-muted">{open ? "▾" : "▸"}</span>
                        <span className="truncate font-medium text-fg">
                          {s.shopName || "(ไม่มีชื่อ)"}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-4 text-sm">
                        <span className="text-muted">{s.replies.toLocaleString()} ข้อความ</span>
                        <span className="font-semibold text-fg">฿{s.totalCostThb.toFixed(2)}</span>
                      </span>
                    </button>
                    {open && (
                      <div className="overflow-x-auto border-t border-line bg-app/40 px-4 py-3">
                        <table className="w-full min-w-[700px] text-sm">
                          <thead>
                            <tr className="text-left text-xs text-muted">
                              <th className="py-1.5 pr-4 font-medium">โมเดล</th>
                              <th className="py-1.5 pr-4 font-medium text-right">ข้อความ</th>
                              <th className="py-1.5 pr-4 font-medium text-right">ต้นทุนตอบ</th>
                              <th className="py-1.5 pr-4 font-medium text-right">นำเข้าสินค้า</th>
                              <th className="py-1.5 pr-4 font-medium text-right">อุ่นแคช</th>
                              <th className="py-1.5 pr-4 font-medium text-right">เขียนแคชใหม่</th>
                              <th className="py-1.5 font-medium text-right">รวม</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.models.map((m) => (
                              <tr key={m.model}>
                                <td className="py-1.5 pr-4">
                                  <span className="text-fg">{modelName(m.model)}</span>
                                  {modelTier(m.model) && (
                                    <span className="ml-2 text-xs text-muted">
                                      {modelTier(m.model)}
                                    </span>
                                  )}
                                </td>
                                <td className="py-1.5 pr-4 text-right">{m.replies.toLocaleString()}</td>
                                <td className="py-1.5 pr-4 text-right whitespace-nowrap">
                                  ฿{m.replyCostThb.toFixed(2)}
                                  {m.replies > 0 && (
                                    <span className="ml-1 text-xs text-muted">
                                      (฿{(m.replyCostThb / m.replies).toFixed(2)}/ขค.)
                                    </span>
                                  )}
                                </td>
                                <td className="py-1.5 pr-4 text-right whitespace-nowrap text-muted">
                                  {m.imports > 0 ? `฿${m.importCostThb.toFixed(2)}` : "-"}
                                </td>
                                <td className="py-1.5 pr-4 text-right whitespace-nowrap text-muted">
                                  ฿{m.prewarmCostThb.toFixed(2)}
                                </td>
                                <td className="py-1.5 pr-4 text-right whitespace-nowrap text-muted">
                                  ฿{m.cacheWriteCostThb.toFixed(2)}
                                  {m.coldWrites > 0 && (
                                    <span className="ml-1 text-xs">({m.coldWrites} ครั้ง)</span>
                                  )}
                                </td>
                                <td className="py-1.5 text-right whitespace-nowrap font-semibold text-fg">
                                  ฿{m.totalCostThb.toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* จุดแคชใหม่รายวัน — ตัวชี้สุขภาพแคช: จุดบ่อยผิดปกติ = มีอะไรไปล้างแคช */}
          <div>
            <h4 className="mb-2 text-sm font-semibold text-fg">จุดแคชใหม่รายวัน (กี่ครั้ง/วัน)</h4>
            <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-4 py-3 font-medium">วัน</th>
                    <th className="px-4 py-3 font-medium">ร้าน</th>
                    <th className="px-4 py-3 font-medium text-right">จุดจากแชต</th>
                    <th className="px-4 py-3 font-medium text-right">จุดจากระบบอุ่น</th>
                    <th className="px-4 py-3 font-medium text-right">รวม (ครั้ง)</th>
                    <th className="px-4 py-3 font-medium text-right">ค่าเขียนรวม</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dailyWrites.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-xs text-muted">
                        ไม่มีการจุดแคชในช่วงนี้
                      </td>
                    </tr>
                  )}
                  {data.dailyWrites.map((d, i) => {
                    const total = d.chatWrites + d.prewarmWrites;
                    const showDay = i === 0 || data.dailyWrites[i - 1].day !== d.day;
                    return (
                      <tr key={`${d.day}-${d.shopId}`} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                          {showDay ? thaiDay(d.day) : ""}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-fg">{d.shopName || "(ไม่มีชื่อ)"}</td>
                        <td className="px-4 py-2.5 text-right">{d.chatWrites || "-"}</td>
                        <td className="px-4 py-2.5 text-right">{d.prewarmWrites || "-"}</td>
                        <td className={`px-4 py-2.5 text-right font-semibold ${total >= 5 ? "text-amber-500" : "text-fg"}`}>
                          {total}
                          {total >= 5 && " ⚠️"}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap text-muted">
                          ฿{d.costThb.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">
              ร้านคึกปกติควรจุด ~2-4 ครั้ง/วัน — ถ้าเกิน 5 ครั้ง (⚠️) ทั้งที่แชตไม่เยอะ
              แปลว่ามีอะไรไปล้างแคชบ่อยผิดปกติ (เช่น แก้ข้อมูลร้าน/สินค้าถี่ๆ หรือราคาแกว่ง)
            </p>
          </div>
        </>
      )}
    </div>
  );
}
