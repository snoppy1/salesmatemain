"use client";

import { useCallback, useEffect, useId, useState } from "react";
import CountUp from "@/components/CountUp";
import type {
  FacebookChannelStatus,
  LazadaChannelStatus,
  LineChannelStatus,
} from "@/lib/types";
import { SiFacebook, SiLine } from "react-icons/si";
import { LazadaMark } from "@/components/BrandMarks";

/** วันในกราฟต้องมีอย่างน้อยชื่อวัน + ธงวันนี้ (ค่าตัวเลขดึงผ่าน accessor) */
type ChartDay = { label: string; isToday: boolean };
type OverviewDay = ChartDay & {
  custMsgs: number;
  aiMsgs: number;
  upsellValue: number;
};
type SalesDay = ChartDay & { revenue: number };
type Overview = { pendingNow: number; daily: OverviewDay[] };

const baht = (n: number) => `฿${n.toLocaleString()}`;

/**
 * หน้าภาพรวมร้าน — คำถามเดียวที่หน้านี้ต้องตอบ:
 * "เช้านี้มีงานค้างไหม แล้ว AI ทำเงินให้เท่าไหร่"
 * ลำดับสายตา: งานด่วน (รอตอบ) → ผลงานเงินเดือนนี้ → ความเคลื่อนไหว 7 วัน
 */
export default function OverviewView({
  onGoInbox,
  onGoSettings,
}: {
  onGoInbox: () => void;
  onGoSettings: () => void;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState(false);
  const [sales, setSales] = useState<SalesDay[] | null>(null);

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

  // ยอดขายรายวันดึงจาก Lazada Orders API — โหลดครั้งเดียวตอนเปิดหน้า (ไม่ poll ทุก 30 วิ)
  const [salesError, setSalesError] = useState(false);
  const loadSales = useCallback(() => {
    setSalesError(false);
    fetch("/api/metrics/sales-daily")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { daily: SalesDay[] }) => setSales(d.daily))
      .catch(() => setSalesError(true));
  }, []);
  useEffect(() => {
    loadSales();
  }, [loadSales]);

  const today = data ? data.daily[data.daily.length - 1] : undefined;
  const yesterday = data ? data.daily[data.daily.length - 2] : undefined;
  const pending = data?.pendingNow ?? 0;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-fg">ภาพรวมร้าน</h2>
        <p className="mt-0.5 text-sm text-muted">
          ผลงาน AI และความเคลื่อนไหวของร้านใน 7 วันล่าสุด
        </p>
      </div>

      <LazadaExpiredAlert />

      {/* แถวบน: งานด่วนก่อน (รอตอบ) แล้วค่อยความเคลื่อนไหววันนี้ */}
      <div className="grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={onGoInbox}
          className={`group rounded-2xl border p-4 text-left transition active:scale-[.99] ${
            pending > 0
              ? "border-red-300 bg-red-50 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:hover:bg-red-950/60"
              : "border-line bg-surface hover:bg-surface2"
          }`}
        >
          <div className="flex items-start gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                pending > 0
                  ? "bg-red-500/15 text-red-600 dark:text-red-400"
                  : "bg-surface2 text-muted"
              }`}
            >
              <IconReply />
            </span>
            <div className="min-w-0">
              <div
                className={`text-3xl font-bold tabular-nums tracking-tight ${
                  pending > 0 ? "text-red-600 dark:text-red-400" : "text-fg"
                }`}
              >
                {data ? <CountUp value={pending} /> : "…"}
                <span className="ml-1.5 text-sm font-medium text-muted">แชต</span>
              </div>
              <div className="text-xs text-muted">รอคุณตอบตอนนี้</div>
              <div
                className={`mt-1.5 flex items-center gap-1 text-xs font-medium ${
                  pending > 0 ? "text-red-600 dark:text-red-400" : "text-muted"
                }`}
              >
                {pending > 0 ? "แตะเพื่อเปิดกล่องแชต" : "ไม่มีแชตค้าง เยี่ยมเลย"}
                {pending > 0 && <IconArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />}
              </div>
            </div>
          </div>
        </button>

        <StatCard
          plate="bg-sand/15 text-sand"
          icon={<IconChatBubble />}
          value={data ? <CountUp value={today?.custMsgs ?? 0} /> : null}
          unit="ข้อความ"
          label="ลูกค้าทักวันนี้"
          hint={data ? `เมื่อวาน ${(yesterday?.custMsgs ?? 0).toLocaleString()} ข้อความ` : ""}
        />
        <StatCard
          plate="bg-accent/15 text-accent"
          icon={<IconSpark />}
          value={data ? <CountUp value={today?.aiMsgs ?? 0} /> : null}
          unit="ข้อความ"
          label="AI ตอบให้วันนี้"
          hint="แพ็กเกจเบต้า: ไม่จำกัด"
        />
      </div>

      {/* แผงมิเตอร์เดือนนี้ — หลักฐานว่า AI ทำเงิน (ตัวเลขพ่วงคือจุดขายของ SalesMate) */}
      <MonthMeter />

      {/* กราฟ + ช่องทาง: แท่ง = เทียบปริมาณรายวัน / จุดสถานะ = ช่องทางที่ AI เฝ้าอยู่ */}
      <div className="grid gap-3 lg:grid-cols-3">
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
          <div className="lg:col-span-2">
            <MessagesBarChart days={data?.daily ?? null} />
          </div>
        )}
        <ChannelsPanel onGoSettings={onGoSettings} />
      </div>

      {/* ยอดขายรวมรายวัน (จาก Lazada Orders) — เส้น+จุด เต็มความกว้าง */}
      {salesError ? (
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-4 text-sm text-muted">
          โหลดยอดขายรายวันไม่สำเร็จ
          <button
            type="button"
            onClick={loadSales}
            className="rounded-lg border border-line px-2 py-1 text-xs font-medium text-fg transition hover:bg-surface2"
          >
            ลองใหม่
          </button>
        </div>
      ) : (
        <TrendChartCard
          title="ยอดขายรวม (ร้านที่ AI ดูแล)"
          unit="บาท"
          colorVar="var(--chart-upsell)"
          days={sales}
          value={(d) => d.revenue}
          formatValue={baht}
          showTotal
        />
      )}
    </div>
  );
}

/* ---------- การ์ดสถิติเดี่ยว: ป้ายไอคอนจาง + เลขใหญ่ tabular + ป้ายชื่อหม่น ---------- */

function StatCard({
  plate,
  icon,
  value,
  unit,
  label,
  hint,
}: {
  plate: string;
  icon: React.ReactNode;
  value: React.ReactNode | null;
  unit: string;
  label: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${plate}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-3xl font-bold tabular-nums tracking-tight text-fg">
            {value ?? "…"}
            <span className="ml-1.5 text-sm font-medium text-muted">{unit}</span>
          </div>
          <div className="text-xs text-muted">{label}</div>
          {hint ? <div className="mt-1.5 text-xs text-muted/80">{hint}</div> : null}
        </div>
      </div>
    </div>
  );
}

/* ---------- แผงมิเตอร์: ผลงาน AI เดือนนี้ (พ่วงขายได้จริงคือพระเอก) ---------- */

type MonthMetrics = {
  sales: { orderCount: number; totalRevenue: number };
  offered: { count: number; totalEstValue: number };
  sold: { count: number; totalSoldValue: number };
};

function MonthMeter() {
  const [m, setM] = useState<MonthMetrics | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    fetch("/api/metrics/refresh", { method: "POST" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (d && d.offered) setM(d as MonthMetrics);
        else setError(true);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-4 text-sm text-muted">
        โหลดผลงานเดือนนี้ไม่สำเร็จ
        <button
          type="button"
          onClick={load}
          className="rounded-lg border border-line px-2 py-1 text-xs font-medium text-fg transition hover:bg-surface2"
        >
          ลองใหม่
        </button>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <span className="text-accent" aria-hidden="true">
            <IconTrendUp />
          </span>
          ผลงาน AI เดือนนี้
        </h3>
        <span className="text-xs text-muted">นับตั้งแต่วันที่ 1 ของเดือน</span>
      </div>

      {!m ? (
        <div className="mt-4 grid animate-pulse gap-4 sm:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div className="h-3 w-24 rounded bg-surface2" />
              <div className="mt-2 h-8 w-32 rounded bg-surface2" />
              <div className="mt-2 h-3 w-20 rounded bg-surface2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 grid sm:grid-cols-[1.3fr_1fr_1fr]">
          {/* พระเอก: เงินที่ AI ชวนซื้อเพิ่มแล้วปิดได้จริง */}
          <div className="pb-4 sm:pb-0 sm:pr-6">
            <div className="text-xs font-medium text-muted">พ่วงขายได้จริง</div>
            <div className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-accent sm:text-4xl">
              <CountUp value={m.sold.totalSoldValue} format={baht} />
            </div>
            <div className="mt-1 text-xs text-muted">
              {m.sold.count.toLocaleString()} ครั้ง · AI ชวนซื้อเพิ่มแล้วลูกค้าซื้อจริง
            </div>
          </div>
          <div className="border-t border-line py-4 sm:border-l sm:border-t-0 sm:py-0 sm:pl-6 sm:pr-6">
            <div className="text-xs font-medium text-muted">AI เสนอพ่วงไป</div>
            <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-sand">
              <CountUp value={m.offered.totalEstValue} format={baht} />
            </div>
            <div className="mt-1 text-xs text-muted">
              {m.offered.count.toLocaleString()} ครั้ง · มูลค่าโดยประมาณ
            </div>
          </div>
          <div className="border-t border-line pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
            <div className="text-xs font-medium text-muted">ยอดขายรวมร้าน</div>
            <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-fg">
              <CountUp value={m.sales.totalRevenue} format={baht} />
            </div>
            <div className="mt-1 text-xs text-muted">
              {m.sales.orderCount.toLocaleString()} ออเดอร์ · จากช่องทางที่เชื่อมไว้
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------- กราฟแท่งคู่ 7 วัน: ลูกค้าทัก (น้ำเงิน) vs AI ตอบ (สีเนื้อทราย) ---------- */

const BW = 340; // viewBox กว้าง
const BH = 190;
const B_PAD_TOP = 16;
const B_PAD_BOTTOM = 22;
const B_SIDE = 8;
const B_PLOT_H = BH - B_PAD_TOP - B_PAD_BOTTOM;
const B_BASE_Y = B_PAD_TOP + B_PLOT_H;

/** แท่งมุมบนโค้ง 3px ยึดเส้นฐาน (สเปก dataviz: rounded data-end เฉพาะปลายข้อมูล) */
function barPath(x: number, yTop: number, w: number, h: number): string {
  const r = Math.min(3, w / 2, h);
  return (
    `M ${x} ${yTop + h} V ${yTop + r} Q ${x} ${yTop} ${x + r} ${yTop}` +
    ` H ${x + w - r} Q ${x + w} ${yTop} ${x + w} ${yTop + r} V ${yTop + h} Z`
  );
}

function MessagesBarChart({ days }: { days: OverviewDay[] | null }) {
  const [hover, setHover] = useState<number | null>(null);

  if (!days) {
    return (
      <div className="h-full animate-pulse rounded-2xl border border-line bg-surface p-5">
        <div className="h-4 w-40 rounded bg-surface2" />
        <div className="mt-4 h-40 rounded bg-surface2 sm:h-44" />
      </div>
    );
  }

  const max = Math.max(...days.map((d) => Math.max(d.custMsgs, d.aiMsgs)));
  const allZero = max === 0;
  const scale = allZero ? 0 : (B_PLOT_H * 0.92) / max;
  const n = days.length;
  const groupW = (BW - 2 * B_SIDE) / n;
  const barW = 13;
  const gap = 3; // ช่องว่างระหว่างแท่งคู่ (สเปก dataviz: เว้น surface ระหว่าง fill)
  const hovered = hover !== null ? days[hover] : null;

  const heightOf = (v: number) => (v <= 0 ? 0 : Math.max(2, v * scale));

  return (
    <div className="relative h-full rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">การพูดคุย 7 วันล่าสุด</h3>
        {/* legend ≥2 ซีรีส์ต้องมีเสมอ */}
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ background: "var(--chart-msgs)" }}
              aria-hidden="true"
            />
            ลูกค้าทัก
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-sand" aria-hidden="true" />
            AI ตอบ
          </span>
        </div>
      </div>

      <div className="relative mt-3">
        {hovered && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-sm"
            style={{
              left: `${Math.min(82, Math.max(18, ((B_SIDE + (hover! + 0.5) * groupW) / BW) * 100))}%`,
            }}
          >
            <span className="font-semibold text-fg">{hovered.label}</span>
            <span className="ml-2 inline-flex items-center gap-1 tabular-nums text-muted">
              <span
                className="h-2 w-2 rounded-[2px]"
                style={{ background: "var(--chart-msgs)" }}
                aria-hidden="true"
              />
              ทัก {hovered.custMsgs.toLocaleString()}
            </span>
            <span className="ml-2 inline-flex items-center gap-1 tabular-nums text-muted">
              <span className="h-2 w-2 rounded-[2px] bg-sand" aria-hidden="true" />
              AI ตอบ {hovered.aiMsgs.toLocaleString()}
            </span>
          </div>
        )}

        {/* ความสูงคงที่ (ไม่โตตามความกว้างจอ) — preserveAspectRatio none ให้แท่งเต็มความกว้างที่ความสูงเท่าเดิม
            ป้ายชื่อวันย้ายไปเป็น HTML ด้านล่าง กันตัวอักษรยืดเพี้ยนตอน svg ถูกยืดแนวนอน */}
        <svg
          viewBox={`0 0 ${BW} ${B_BASE_Y}`}
          preserveAspectRatio="none"
          className="h-40 w-full sm:h-44"
          role="img"
          aria-label="กราฟแท่งเทียบข้อความลูกค้าทักกับข้อความที่ AI ตอบ รายวัน 7 วันล่าสุด"
          onMouseLeave={() => setHover(null)}
        >
          {/* grid บางๆ ไม่แย่งซีนข้อมูล */}
          <line
            x1="0"
            x2={BW}
            y1={B_PAD_TOP + B_PLOT_H / 2}
            y2={B_PAD_TOP + B_PLOT_H / 2}
            stroke="var(--line)"
            strokeDasharray="3 4"
          />
          <line x1="0" x2={BW} y1={B_BASE_Y} y2={B_BASE_Y} stroke="var(--line)" />

          {days.map((d, i) => {
            const gx = B_SIDE + i * groupW;
            const pairW = barW * 2 + gap;
            const x0 = gx + (groupW - pairW) / 2;
            const hCust = heightOf(d.custMsgs);
            const hAi = heightOf(d.aiMsgs);
            const dimmed = hover !== null && hover !== i;
            return (
              <g
                key={i}
                opacity={dimmed ? 0.4 : 1}
                style={{ transition: "opacity 150ms ease" }}
              >
                {/* hit target เต็มคอลัมน์ แตะง่ายบนมือถือ */}
                <rect
                  x={gx}
                  y={0}
                  width={groupW}
                  height={BH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onClick={() => setHover(i)}
                />
                {hCust > 0 && (
                  <path
                    d={barPath(x0, B_BASE_Y - hCust, barW, hCust)}
                    fill="var(--chart-msgs)"
                    className="chart-bar"
                    style={{ animationDelay: `${i * 45}ms` }}
                  />
                )}
                {hAi > 0 && (
                  <path
                    d={barPath(x0 + barW + gap, B_BASE_Y - hAi, barW, hAi)}
                    fill="var(--sand)"
                    className="chart-bar"
                    style={{ animationDelay: `${60 + i * 45}ms` }}
                  />
                )}
              </g>
            );
          })}
        </svg>

        {allZero && (
          <p className="absolute inset-x-0 top-1/3 text-center text-xs text-muted">
            ยังไม่มีบทสนทนาในช่วงนี้ ตัวเลขจะเริ่มนับเมื่อลูกค้าทักเข้ามา
          </p>
        )}

        {/* ป้ายชื่อวัน (HTML — ไม่ยืดเพี้ยนตาม svg) เรียงตรงกับคอลัมน์แท่ง */}
        <div className="mt-1.5 flex px-1">
          {days.map((d, i) => (
            <span
              key={i}
              className={`flex-1 text-center text-[11px] ${
                d.isToday ? "font-bold text-fg" : "text-muted"
              }`}
            >
              {d.label}
            </span>
          ))}
        </div>
      </div>

      {/* ตารางข้อมูลสำหรับ screen reader (ทางเลือกไม่พึ่งสี/กราฟ) */}
      <table className="sr-only">
        <caption>ข้อความลูกค้าทักและข้อความที่ AI ตอบ รายวัน 7 วันล่าสุด</caption>
        <thead>
          <tr>
            <th>วัน</th>
            <th>ลูกค้าทัก</th>
            <th>AI ตอบ</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d, i) => (
            <tr key={i}>
              <td>{d.label}</td>
              <td>{d.custMsgs.toLocaleString()}</td>
              <td>{d.aiMsgs.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- แผงช่องทางของร้าน: จุดสถานะจริง (เชื่อมแล้ว/หลุด/ยังไม่เชื่อม) ---------- */

type ChannelRow = {
  key: string;
  name: string;
  iconBg: string;
  icon: React.ReactNode;
  /** undefined = กำลังเช็ค · null = เช็คไม่สำเร็จ */
  status:
    | { connected: boolean; detail?: string; mock?: boolean; expired?: boolean; atRisk?: boolean }
    | null
    | undefined;
};

function ChannelsPanel({ onGoSettings }: { onGoSettings: () => void }) {
  const [line, setLine] = useState<LineChannelStatus | null | undefined>(undefined);
  const [fb, setFb] = useState<FacebookChannelStatus | null | undefined>(undefined);
  const [lz, setLz] = useState<LazadaChannelStatus | null | undefined>(undefined);

  useEffect(() => {
    const get = <T,>(url: string, set: (v: T | null) => void) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => set(d as T))
        .catch(() => set(null));
    void get<LineChannelStatus>("/api/line/connect/status", setLine);
    void get<FacebookChannelStatus>("/api/facebook/connect/status", setFb);
    void get<LazadaChannelStatus>("/api/lazada/connect/status", setLz);
  }, []);

  const rows: ChannelRow[] = [
    {
      key: "line",
      name: "LINE OA",
      iconBg: "bg-[#06C755]",
      icon: <SiLine className="h-4 w-4" aria-hidden="true" />,
      status:
        line === undefined ? undefined : line === null ? null : { connected: line.connected, detail: line.displayName, mock: line.mock },
    },
    {
      key: "facebook",
      name: "Facebook เพจ",
      iconBg: "bg-[#0866FF]",
      icon: <SiFacebook className="h-4 w-4" aria-hidden="true" />,
      status:
        fb === undefined ? undefined : fb === null ? null : { connected: fb.connected, detail: fb.pageName, mock: fb.mock },
    },
    {
      key: "lazada",
      name: "Lazada",
      iconBg: "bg-[#0F146E]",
      icon: <LazadaMark className="h-4 w-4" />,
      status:
        lz === undefined
          ? undefined
          : lz === null
            ? null
            : {
                connected: lz.connected,
                detail: lz.accountName,
                mock: lz.mock,
                expired: lz.expired,
                atRisk: lz.atRisk,
              },
    },
  ];

  return (
    <section className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5">
      <h3 className="text-sm font-semibold text-fg">ช่องทางที่ AI เฝ้าอยู่</h3>
      <p className="mt-0.5 text-xs text-muted">ลูกค้าทักช่องไหน AI ก็เห็นครบในกล่องแชตเดียว</p>

      <ul className="mt-3 divide-y divide-line">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-3 py-2.5">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white ${row.iconBg}`}
            >
              {row.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-fg">{row.name}</div>
              <div className="truncate text-xs text-muted">
                {row.status === undefined
                  ? "กำลังเช็ค…"
                  : row.status === null
                    ? "เช็คสถานะไม่สำเร็จ ลองรีเฟรชหน้า"
                    : row.status.connected
                      ? `${row.status.detail || "เชื่อมกับร้านแล้ว"}${row.status.mock ? " · โหมดทดลอง" : ""}`
                      : "เชื่อมได้ที่ปุ่มด้านล่าง"}
              </div>
            </div>
            <ChannelDot status={row.status} />
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onGoSettings}
        className="mt-auto flex w-full items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2.5 text-sm font-medium text-fg transition hover:bg-surface2"
      >
        จัดการการเชื่อมต่อ
        <IconArrowRight className="h-4 w-4" />
      </button>
    </section>
  );
}

/** จุดสถานะ + ข้อความ (ไม่พึ่งสีอย่างเดียว) */
function ChannelDot({ status }: { status: ChannelRow["status"] }) {
  if (status === undefined) {
    return <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-surface2" aria-hidden="true" />;
  }
  if (status === null || !status.connected) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <span className="h-2.5 w-2.5 rounded-full border border-line bg-surface2" aria-hidden="true" />
        {status === null ? "เช็คไม่ได้" : "ยังไม่เชื่อม"}
      </span>
    );
  }
  if (status.expired) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden="true" />
        หลุด
      </span>
    );
  }
  if (status.atRisk) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
        <span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />
        ใกล้หมดอายุ
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-accent">
      <span
        className="h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_0_3px_rgb(var(--accent-rgb)/0.15)]"
        aria-hidden="true"
      />
      เชื่อมแล้ว
    </span>
  );
}

/* ---------- ป้ายเตือนการเชื่อมต่อ Lazada หลุด (token ตาย = แชตใหม่ไม่เข้า) ----------
   วางหน้าแรกเพราะเป็นหน้าที่เปิดเจอแน่ๆ — บทเรียนจากเหตุการณ์ token ตายเงียบ 2 วัน */
function LazadaExpiredAlert() {
  const [state, setState] = useState<{ expired: boolean; atRisk: boolean }>({
    expired: false,
    atRisk: false,
  });

  useEffect(() => {
    const load = () =>
      fetch("/api/lazada/connect/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { connected?: boolean; expired?: boolean; atRisk?: boolean } | null) =>
          setState({
            expired: Boolean(d?.connected && d?.expired),
            atRisk: Boolean(d?.connected && d?.atRisk),
          }),
        )
        .catch(() => {});
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 60000);
    return () => clearInterval(t);
  }, []);

  if (!state.expired && !state.atRisk) return null;

  // หมดอายุ = แดง (แชตหยุดแล้ว) / กำลังจะหมด = เหลือง (ต่ออายุล้มเหลว เตือนก่อน)
  const critical = state.expired;
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${
        critical
          ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
          : "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
      }`}
    >
      <span
        className={
          critical ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"
        }
        aria-hidden="true"
      >
        <IconWarning />
      </span>
      <p
        className={`flex-1 text-sm font-semibold ${
          critical
            ? "text-red-700 dark:text-red-300"
            : "text-amber-700 dark:text-amber-300"
        }`}
      >
        {critical
          ? "การเชื่อมต่อ Lazada หลุด — แชตใหม่จะไม่เข้าจนกว่าจะเชื่อมใหม่"
          : "การเชื่อมต่อ Lazada กำลังจะหมดอายุ — ควรกดเชื่อมใหม่ก่อนแชตหยุด"}
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

/* ---------- การ์ดกราฟเส้น + จุด 7 วัน (SVG ตามสเปก dataviz) ---------- */

const W = 320;
const H = 150;
const PAD_TOP = 22; // ที่ว่างสำหรับเลขบนจุด
const PAD_BOTTOM = 20; // ที่ว่างสำหรับชื่อวัน
const SIDE_PAD = 18; // กันจุดหัว-ท้ายไม่ให้ตกขอบ
const PLOT_H = H - PAD_TOP - PAD_BOTTOM;
const BASE_Y = PAD_TOP + PLOT_H; // เส้นฐาน

function TrendChartCard<T extends ChartDay>({
  title,
  unit,
  colorVar,
  days,
  value,
  formatValue = (n) => n.toLocaleString(),
  showTotal = false,
}: {
  title: string;
  unit: string;
  colorVar: string;
  days: T[] | null;
  value: (d: T) => number;
  formatValue?: (n: number) => string;
  showTotal?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gradId = useId();

  if (!days) {
    return (
      <div className="animate-pulse rounded-2xl border border-line bg-surface p-5">
        <div className="h-4 w-36 rounded bg-surface2" />
        <div className="mt-4 h-[150px] rounded bg-surface2" />
      </div>
    );
  }

  const values = days.map(value);
  const max = Math.max(...values);
  const total = values.reduce((a, b) => a + b, 0);
  const allZero = max === 0;
  const maxIndex = values.indexOf(max);
  const scale = allZero ? 0 : PLOT_H / max;

  const n = days.length;
  const xOf = (i: number) =>
    SIDE_PAD + (W - 2 * SIDE_PAD) * (n === 1 ? 0 : i / (n - 1));
  const yOf = (v: number) => BASE_Y - v * scale;

  // จุดของแต่ละวัน (allZero → ยึดเส้นฐาน)
  const pts = values.map((v, i) => [xOf(i), yOf(v)] as const);
  const linePath = "M " + pts.map((p) => `${p[0]} ${p[1]}`).join(" L ");
  const areaPath =
    `M ${xOf(0)} ${BASE_Y} L ` +
    pts.map((p) => `${p[0]} ${p[1]}`).join(" L ") +
    ` L ${xOf(n - 1)} ${BASE_Y} Z`;

  const hovered = hover !== null ? days[hover] : null;
  const colStep = (W - 2 * SIDE_PAD) / Math.max(1, n - 1);

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {showTotal && (
            <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-fg">
              {formatValue(total)}
              <span className="ml-1.5 text-xs font-medium text-muted">รวม 7 วัน</span>
            </div>
          )}
        </div>
        <span className="text-xs text-muted">7 วันล่าสุด · {unit}</span>
      </div>

      <div className="relative mt-3">
        {/* tooltip ตอน hover/แตะจุด */}
        {hovered && (
          <div className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs shadow-sm">
            <span className="font-medium text-fg">{hovered.label}</span>
            <span className="ml-1.5 tabular-nums text-muted">
              {formatValue(value(hovered))} {unit}
            </span>
          </div>
        )}

        {/* ล็อกความสูงสูงสุด กันกราฟสูงเวอร์ตามความกว้างจอ (จุด/ตัวเลขยังคงสัดส่วน ไม่เพี้ยน) */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="mx-auto block max-h-[240px] w-full"
          role="img"
          aria-label={`กราฟเส้น${title} 7 วันล่าสุด`}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            {/* พื้นไล่เฉดใต้เส้น: สีกราฟจางบน → โปร่งใสที่เส้นฐาน */}
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colorVar} stopOpacity="0.28" />
              <stop offset="100%" stopColor={colorVar} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* grid บางๆ: เส้นฐาน + กึ่งกลาง (recessive) */}
          <line
            x1="0"
            x2={W}
            y1={PAD_TOP + PLOT_H / 2}
            y2={PAD_TOP + PLOT_H / 2}
            stroke="var(--line)"
            strokeDasharray="3 4"
          />
          <line x1="0" x2={W} y1={BASE_Y} y2={BASE_Y} stroke="var(--line)" />

          {!allZero && (
            <>
              <path d={areaPath} fill={`url(#${gradId})`} className="chart-area" />
              <path
                d={linePath}
                fill="none"
                stroke={colorVar}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={100}
                className="chart-line"
              />
            </>
          )}

          {/* crosshair แนวตั้งที่จุดชี้ (บอกว่ากำลังอ่านวันไหน) */}
          {hover !== null && (
            <line
              x1={xOf(hover)}
              x2={xOf(hover)}
              y1={PAD_TOP}
              y2={BASE_Y}
              stroke="var(--line)"
            />
          )}

          {days.map((d, i) => {
            const [x, y] = pts[i];
            const v = values[i];
            const active = hover === i;
            const showLabel = !allZero && (i === maxIndex || d.isToday) && v > 0;
            return (
              <g key={i}>
                {/* hit target เต็มความสูง กว้างเท่าช่อง (แตะง่ายบนมือถือ) */}
                <rect
                  x={x - colStep / 2}
                  y={0}
                  width={colStep}
                  height={H}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onClick={() => setHover(i)}
                />
                {/* จุด ≥8px มีวงแหวนสี surface กันกลืนเส้น/พื้น */}
                <circle
                  cx={x}
                  cy={y}
                  r={active ? 5 : 4}
                  fill={colorVar}
                  stroke="var(--surface)"
                  strokeWidth="2"
                  className="chart-dot"
                  style={{ animationDelay: `${300 + i * 45}ms` }}
                />
                {showLabel && (
                  <text
                    x={x}
                    y={y - 9}
                    textAnchor="middle"
                    className="chart-fade fill-[var(--text)]"
                    fontSize="11"
                    fontWeight="600"
                  >
                    {formatValue(v)}
                  </text>
                )}
                <text
                  x={x}
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
            ยังไม่มียอดขายในช่วงนี้ ตัวเลขจะขึ้นเมื่อมีออเดอร์เข้ามา
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

/* ---------- ไอคอน (inline stroke SVG ตระกูลเดียวกับเมนูหลัก strokeWidth 2) ---------- */

function IconReply() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  );
}
function IconChatBubble() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
    </svg>
  );
}
function IconSpark() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" />
    </svg>
  );
}
function IconTrendUp() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}
function IconWarning() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
function IconArrowRight({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M12 5l7 7-7 7" />
    </svg>
  );
}

