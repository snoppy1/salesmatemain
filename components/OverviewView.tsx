"use client";

import { useCallback, useEffect, useState } from "react";
import CountUp from "@/components/CountUp";
import UpsellMetric from "@/components/UpsellMetric";

type OverviewDay = {
  label: string;
  isToday: boolean;
  custMsgs: number;
  aiMsgs: number;
  upsellValue: number;
};
type Overview = { pendingNow: number; daily: OverviewDay[] };

/** หน้าภาพรวมร้าน — ตัวเลขคือหลักฐาน: รอตอบตอนนี้ + ยอดเดือนนี้ + กราฟ 7 วัน */
export default function OverviewView({ onGoInbox }: { onGoInbox: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    fetch("/api/metrics/overview")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setData(d as Overview))
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 30000); // รีเฟรชทุก 30 วิ พอ (หน้าภาพรวม ไม่ใช่แชต)
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-fg">ภาพรวมร้าน</h2>
        <p className="mt-0.5 text-sm text-muted">
          ผลงาน AI และความเคลื่อนไหวของร้านใน 7 วันล่าสุด
        </p>
      </div>

      <LazadaExpiredAlert />

      {/* แถวบน: รอตอบ (งานด่วน) + AI ตอบวันนี้ (โควตา) + ยอดเดือนนี้ */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <button
          type="button"
          onClick={onGoInbox}
          className={`rounded-xl border px-4 py-3 text-left transition ${
            (data?.pendingNow ?? 0) > 0
              ? "border-red-300 bg-red-50 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:hover:bg-red-950/60"
              : "border-line bg-surface hover:bg-surface2"
          }`}
        >
          <div className="text-xs text-muted">รอคุณตอบตอนนี้</div>
          <div
            className={`text-lg font-bold ${
              (data?.pendingNow ?? 0) > 0
                ? "text-red-600 dark:text-red-400"
                : "text-fg"
            }`}
          >
            {data ? (
              <>
                <CountUp value={data.pendingNow} /> แชต
              </>
            ) : (
              "…"
            )}
          </div>
          <div className="text-xs text-muted">แตะเพื่อไปกล่องแชต</div>
        </button>
        {/* โควตาข้อความ AI — อนาคตโชว์เพดานตามแพ็กเกจตรงนี้ (เช่น 42/100) */}
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <div className="text-xs text-muted">AI ตอบวันนี้</div>
          <div className="text-lg font-bold text-fg">
            {data ? (
              <>
                <CountUp value={data.daily[data.daily.length - 1]?.aiMsgs ?? 0} /> ข้อความ
              </>
            ) : (
              "…"
            )}
          </div>
          <div className="text-xs text-muted">แพ็กเกจเบต้า: ไม่จำกัด</div>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <UpsellMetric layout="row" />
        </div>
      </div>

      {/* กราฟ 7 วัน — คนละแกน คนละการ์ด (ห้าม dual-axis) */}
      <div className="grid gap-4 lg:grid-cols-2">
        {error ? (
          <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-6 text-sm text-muted lg:col-span-2">
            โหลดกราฟไม่สำเร็จ
            <button
              type="button"
              onClick={load}
              className="rounded-lg border border-line px-2 py-1 text-xs font-medium text-fg transition hover:bg-surface2"
            >
              ลองใหม่
            </button>
          </div>
        ) : (
          <>
            <ChartCard
              title="ข้อความจากลูกค้า"
              unit="ข้อความ"
              colorVar="var(--chart-msgs)"
              days={data?.daily ?? null}
              value={(d) => d.custMsgs}
            />
            <ChartCard
              title="มูลค่าที่ AI เสนอพ่วง"
              unit="บาท"
              colorVar="var(--chart-upsell)"
              days={data?.daily ?? null}
              value={(d) => d.upsellValue}
              formatValue={(n) => `฿${n.toLocaleString()}`}
            />
            <ChartCard
              title="ข้อความที่ AI ตอบ"
              unit="ข้อความ"
              colorVar="var(--chart-ai)"
              days={data?.daily ?? null}
              value={(d) => d.aiMsgs}
            />
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- ป้ายเตือนการเชื่อมต่อ Lazada หลุด (token ตาย = แชตใหม่ไม่เข้า) ----------
   วางหน้าแรกเพราะเป็นหน้าที่เปิดเจอแน่ๆ — บทเรียนจากเหตุการณ์ token ตายเงียบ 2 วัน */
function LazadaExpiredAlert() {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    fetch("/api/lazada/connect/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { connected?: boolean; expired?: boolean } | null) =>
        setExpired(Boolean(d?.connected && d?.expired)),
      )
      .catch(() => {});
  }, []);

  if (!expired) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 dark:border-red-900 dark:bg-red-950/40">
      <p className="text-sm font-semibold text-red-700 dark:text-red-300">
        การเชื่อมต่อ Lazada หลุด — แชตใหม่จะไม่เข้าจนกว่าจะเชื่อมใหม่
      </p>
      <a
        href="/api/lazada/connect/start"
        className="rounded-lg bg-[#0F146E] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[#0a0e52]"
      >
        เชื่อม Lazada ใหม่ (เข้าสู่ระบบ)
      </a>
    </div>
  );
}

/* ---------- การ์ดกราฟแท่ง 7 วัน (SVG ตามสเปก dataviz) ---------- */

const W = 320;
const H = 150;
const PAD_TOP = 22; // ที่ว่างสำหรับเลขบนแท่ง
const PAD_BOTTOM = 20; // ที่ว่างสำหรับชื่อวัน
const PLOT_H = H - PAD_TOP - PAD_BOTTOM;

function ChartCard({
  title,
  unit,
  colorVar,
  days,
  value,
  formatValue = (n) => n.toLocaleString(),
}: {
  title: string;
  unit: string;
  colorVar: string;
  days: OverviewDay[] | null;
  value: (d: OverviewDay) => number;
  formatValue?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (!days) {
    return (
      <div className="animate-pulse rounded-2xl border border-line bg-surface p-4">
        <div className="h-4 w-36 rounded bg-surface2" />
        <div className="mt-4 h-[150px] rounded bg-surface2" />
      </div>
    );
  }

  const values = days.map(value);
  const max = Math.max(...values);
  const allZero = max === 0;
  const maxIndex = values.indexOf(max);
  const scale = allZero ? 0 : PLOT_H / max;

  const n = days.length;
  const gap = 10; // ช่องว่างระหว่างแท่ง (>2px ตามสเปก)
  const barW = (W - gap * (n + 1)) / n;

  // แท่งหัวโค้ง 4px ยึดฐานเสมอ (โค้งเฉพาะบน)
  const barPath = (x: number, h: number): string => {
    const r = Math.min(4, h, barW / 2);
    const y = PAD_TOP + PLOT_H - h;
    const bottom = PAD_TOP + PLOT_H;
    if (h <= 0) return "";
    return [
      `M ${x} ${bottom}`,
      `L ${x} ${y + r}`,
      `Q ${x} ${y} ${x + r} ${y}`,
      `L ${x + barW - r} ${y}`,
      `Q ${x + barW} ${y} ${x + barW} ${y + r}`,
      `L ${x + barW} ${bottom}`,
      "Z",
    ].join(" ");
  };

  const hovered = hover !== null ? days[hover] : null;

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <span className="text-xs text-muted">7 วันล่าสุด · {unit}</span>
      </div>

      <div className="relative mt-3">
        {/* tooltip ตอน hover/แตะแท่ง */}
        {hovered && (
          <div className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs shadow-sm">
            <span className="font-medium text-fg">{hovered.label}</span>
            <span className="ml-1.5 text-muted">
              {formatValue(value(hovered))} {unit}
            </span>
          </div>
        )}

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`กราฟแท่ง${title} 7 วันล่าสุด`}
          onMouseLeave={() => setHover(null)}
        >
          {/* grid บางๆ: เส้นฐาน + กึ่งกลาง (recessive) */}
          <line
            x1="0"
            x2={W}
            y1={PAD_TOP + PLOT_H / 2}
            y2={PAD_TOP + PLOT_H / 2}
            stroke="var(--line)"
            strokeDasharray="3 4"
          />
          <line
            x1="0"
            x2={W}
            y1={PAD_TOP + PLOT_H}
            y2={PAD_TOP + PLOT_H}
            stroke="var(--line)"
          />

          {days.map((d, i) => {
            const x = gap + i * (barW + gap);
            const v = values[i];
            const h = Math.max(v * scale, v > 0 ? 3 : 0);
            const showLabel = !allZero && (i === maxIndex || d.isToday) && v > 0;
            return (
              <g key={i}>
                {/* hit target ใหญ่กว่าแท่ง (แตะง่ายบนมือถือ) */}
                <rect
                  x={x - gap / 2}
                  y={0}
                  width={barW + gap}
                  height={H}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onClick={() => setHover(i)}
                />
                {v > 0 && (
                  <path
                    d={barPath(x, h)}
                    fill={colorVar}
                    opacity={hover === null || hover === i ? 1 : 0.45}
                    className="chart-bar"
                    style={{ animationDelay: `${i * 45}ms` }}
                  />
                )}
                {v === 0 && (
                  <line
                    x1={x}
                    x2={x + barW}
                    y1={PAD_TOP + PLOT_H}
                    y2={PAD_TOP + PLOT_H}
                    stroke={colorVar}
                    strokeWidth="2"
                    opacity=".5"
                  />
                )}
                {showLabel && (
                  <text
                    x={x + barW / 2}
                    y={PAD_TOP + PLOT_H - h - 6}
                    textAnchor="middle"
                    className="chart-fade fill-[var(--text)]"
                    fontSize="11"
                    fontWeight="600"
                  >
                    {formatValue(v)}
                  </text>
                )}
                <text
                  x={x + barW / 2}
                  y={H - 5}
                  textAnchor="middle"
                  className="fill-[var(--text-muted)]"
                  fontSize="11"
                  fontWeight={d.isToday ? 700 : 400}
                >
                  {d.label}
                </text>
              </g>
            );
          })}
        </svg>

        {allZero && (
          <p className="absolute inset-x-0 top-1/3 text-center text-xs text-muted">
            ยังไม่มีข้อมูลช่วงนี้ — เริ่มนับเมื่อลูกค้าทักเข้ามา
          </p>
        )}
      </div>

      {/* ตารางข้อมูลสำหรับ screen reader (ทางเลือกไม่พึ่งสี/กราฟ) */}
      <table className="sr-only">
        <caption>{title} 7 วันล่าสุด</caption>
        <thead>
          <tr>
            <th>วัน</th>
            <th>{unit}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d, i) => (
            <tr key={i}>
              <td>{d.label}</td>
              <td>{formatValue(value(d))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
