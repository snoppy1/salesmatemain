import "server-only";
import { query } from "./db";
import { newId } from "./auth";

/** บันทึก/อ่านการรันของ cron — ใช้แสดงหน้า "สถานะระบบ" ใน admin console */

export type CronRun = {
  job: string;
  ranAt: number;
  ok: boolean;
  detail: string; // JSON string ของผลลัพธ์ (เช่น {warmed, refreshedTokens, refreshErrors})
};

/** บันทึกผลการรัน 1 ครั้ง (best-effort — cron ห้ามล้มเพราะบันทึก log ไม่ได้) */
export async function recordCronRun(job: string, ok: boolean, detail: unknown): Promise<void> {
  try {
    await query("INSERT INTO cron_runs (id, job, ran_at, ok, detail) VALUES ($1, $2, $3, $4, $5)", [
      newId(),
      job,
      Date.now(),
      ok,
      JSON.stringify(detail ?? ""),
    ]);
    // เก็บแค่ 50 รายการล่าสุดต่อ job กันตารางบวม
    await query(
      `DELETE FROM cron_runs
        WHERE job = $1 AND id NOT IN
          (SELECT id FROM cron_runs WHERE job = $1 ORDER BY ran_at DESC LIMIT 50)`,
      [job],
    );
  } catch (e) {
    console.error("[cronRuns] record failed:", e instanceof Error ? e.message : e);
  }
}

/** รายการรันล่าสุด (ทุก job รวมกัน เรียงใหม่→เก่า) */
export async function listCronRuns(limit = 30): Promise<CronRun[]> {
  const rows = await query<{ job: string; ran_at: string; ok: boolean; detail: string }>(
    "SELECT job, ran_at, ok, detail FROM cron_runs ORDER BY ran_at DESC LIMIT $1",
    [limit],
  );
  return rows.map((r) => ({
    job: r.job,
    ranAt: Number(r.ran_at),
    ok: r.ok,
    detail: r.detail,
  }));
}
