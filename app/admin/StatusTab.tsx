"use client";

import { useCallback, useEffect, useState } from "react";

/** แท็บ "สถานะระบบ" — สุขภาพ cron (prewarm/retention) + token Lazada ทุกร้าน */

type CronRun = { job: string; ranAt: number; ok: boolean; detail: string };
type LazadaTokenStatus = {
  shopName: string;
  accountName: string;
  expiresAt: number | null;
  updatedAt: number;
  hasRefresh: boolean;
};
type StatusData = { runs: CronRun[]; lazada: LazadaTokenStatus[]; now: number };

const JOB_INFO: Record<string, { label: string; expectEveryMs: number; source: string }> = {
  // prewarm รันทุก 30 นาที (cron-job.org) + สำรองรายวัน (Vercel) — เกิน 45 นาที = ผิดปกติ
  prewarm: { label: "อุ่นแคช + ต่ออายุ token", expectEveryMs: 45 * 60e3, source: "cron-job.org ทุก 30 นาที + Vercel รายวัน" },
  // retention รันวันละครั้ง (Vercel) — เกิน 26 ชม. = ผิดปกติ
  retention: { label: "ลบข้อมูลเก่า (retention)", expectEveryMs: 26 * 3600e3, source: "Vercel Cron รายวัน" },
};

function agoTh(ms: number, now: number): string {
  const m = Math.max(0, Math.round((now - ms) / 60e3));
  if (m < 1) return "เมื่อกี้";
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} ชม. ${m % 60} นาทีที่แล้ว`;
  return `${Math.floor(h / 24)} วันที่แล้ว`;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** สรุปผลจาก detail JSON ของแต่ละ job เป็นข้อความอ่านง่าย */
function summarize(run: CronRun): string {
  try {
    const d = JSON.parse(run.detail) as Record<string, unknown>;
    if (run.job === "prewarm") {
      const errs = Array.isArray(d.refreshErrors) ? d.refreshErrors : [];
      return (
        `อุ่นแคช ${d.warmed}/${d.total} ร้าน · ต่ออายุ token ${d.refreshedTokens} ครั้ง` +
        (errs.length ? ` · ล้มเหลว: ${errs.join(", ")}` : "")
      );
    }
    if (run.job === "retention") {
      return `ลบบทสนทนาเก่า ${d.purgedConversations} · ลบรูปหมดอายุ ${d.expiredImages}`;
    }
    return run.detail;
  } catch {
    return run.detail;
  }
}

type Health = { tone: "ok" | "warn" | "bad" | "none"; text: string };

const TONE_CLASS: Record<Health["tone"], string> = {
  ok: "bg-accent/15 text-accent",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  bad: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  none: "bg-surface2 text-muted",
};

function Badge({ h }: { h: Health }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_CLASS[h.tone]}`}>
      {h.text}
    </span>
  );
}

export default function StatusTab() {
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    fetch("/api/admin/status")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setData(d as StatusData))
      .catch(() => setError("โหลดสถานะไม่สำเร็จ ลองรีเฟรช"));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 60000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (!data) return <p className="text-sm text-muted">กำลังโหลดสถานะ…</p>;

  const now = data.now;

  // สุขภาพราย job: ดูการรันล่าสุด (มี error ไหม + ขาดช่วงไหม)
  const jobs = Object.entries(JOB_INFO).map(([job, info]) => {
    const runs = data.runs.filter((r) => r.job === job);
    const last = runs[0] ?? null;
    let health: Health;
    if (!last) {
      health = { tone: "none", text: "ยังไม่มีข้อมูล" };
    } else if (now - last.ranAt > info.expectEveryMs) {
      health = { tone: "bad", text: `ขาดช่วง — รันล่าสุด ${agoTh(last.ranAt, now)}` };
    } else if (!last.ok) {
      health = { tone: "bad", text: "รอบล่าสุดมี error" };
    } else {
      health = { tone: "ok", text: "ปกติ" };
    }
    return { job, info, last, health };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">อัปเดตอัตโนมัติทุก 1 นาที</p>
        <button
          type="button"
          onClick={load}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-surface2"
        >
          รีเฟรช
        </button>
      </div>

      {/* การ์ดสุขภาพ cron */}
      <div className="grid gap-3 sm:grid-cols-2">
        {jobs.map(({ job, info, last, health }) => (
          <div key={job} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-fg">{info.label}</p>
              <Badge h={health} />
            </div>
            <p className="mt-1 text-xs text-muted">{info.source}</p>
            <p className="mt-2 text-sm text-fg">
              {last ? (
                <>
                  รันล่าสุด {agoTh(last.ranAt, now)} · {summarize(last)}
                </>
              ) : (
                "ยังไม่เคยบันทึกการรัน (เริ่มเก็บหลัง deploy ฟีเจอร์นี้)"
              )}
            </p>
          </div>
        ))}
      </div>

      {/* token Lazada ต่อร้าน */}
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">ร้าน (Lazada)</th>
              <th className="px-4 py-3 font-medium">สถานะ token</th>
              <th className="px-4 py-3 font-medium">หมดอายุ</th>
              <th className="px-4 py-3 font-medium">ต่ออายุล่าสุด</th>
            </tr>
          </thead>
          <tbody>
            {data.lazada.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-xs text-muted">
                  ยังไม่มีร้านที่เชื่อม Lazada
                </td>
              </tr>
            )}
            {data.lazada.map((c) => {
              const exp = c.expiresAt;
              // แดง=หมดแล้ว / เหลือง=เหลือ <4 ชม. (cron ควรต่อให้แล้ว แปลว่าเริ่มผิดปกติ) / เขียว=ปกติ
              const h: Health = !exp
                ? { tone: "none", text: "ไม่ทราบอายุ" }
                : exp < now
                  ? { tone: "bad", text: "หมดอายุ — ต้องเชื่อมใหม่" }
                  : exp - now < 4 * 3600e3
                    ? { tone: "warn", text: `เหลือ ${Math.round((exp - now) / 3600e3)} ชม.` }
                    : { tone: "ok", text: `ปกติ (เหลือ ${Math.round((exp - now) / 3600e3)} ชม.)` };
              return (
                <tr key={c.shopName + c.accountName} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-fg">
                    {c.shopName}
                    <span className="ml-1.5 text-xs text-muted">{c.accountName}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge h={h} />
                  </td>
                  <td className="px-4 py-3 text-muted">{exp ? fmtTime(exp) : "–"}</td>
                  <td className="px-4 py-3 text-muted">{agoTh(c.updatedAt, now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ประวัติการรันล่าสุด */}
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">เวลา</th>
              <th className="px-4 py-3 font-medium">งาน</th>
              <th className="px-4 py-3 font-medium">ผล</th>
              <th className="px-4 py-3 font-medium">รายละเอียด</th>
            </tr>
          </thead>
          <tbody>
            {data.runs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-xs text-muted">
                  ยังไม่มีประวัติ — จะเริ่มเก็บเมื่อ cron รันรอบถัดไป
                </td>
              </tr>
            )}
            {data.runs.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 whitespace-nowrap text-muted">{fmtTime(r.ranAt)}</td>
                <td className="px-4 py-2.5 text-fg">{JOB_INFO[r.job]?.label ?? r.job}</td>
                <td className="px-4 py-2.5">
                  <Badge
                    h={r.ok ? { tone: "ok", text: "สำเร็จ" } : { tone: "bad", text: "มี error" }}
                  />
                </td>
                <td className="px-4 py-2.5 text-muted">{summarize(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
