"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccountRow } from "@/lib/accountsRepo";

/** รายชื่อบัญชีที่ลงทะเบียน + ค้นหา + เปิด/ปิดสิทธิ์กล่องแชตต่อบัญชี */
export default function AccountsTab() {
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/accounts")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        setAccounts(((await res.json()) as { accounts: AccountRow[] }).accounts);
      })
      .catch(() => setError("โหลดรายชื่อบัญชีไม่สำเร็จ ลองรีเฟรช"));
  }, []);

  const filtered = useMemo(() => {
    if (!accounts) return null;
    const term = q.trim().toLowerCase();
    if (!term) return accounts;
    return accounts.filter(
      (a) => a.email.toLowerCase().includes(term) || a.shopName.toLowerCase().includes(term),
    );
  }, [accounts, q]);

  async function toggleAccess(target: AccountRow) {
    if (busyId) return;
    const next = !target.hasChatAccess;
    setBusyId(target.id);
    setError("");
    // optimistic — อัปเดตทุกแถวที่ใช้อีเมลเดียวกัน (สิทธิ์ผูกกับอีเมล)
    setAccounts((prev) =>
      prev
        ? prev.map((a) => (a.email === target.email ? { ...a, hasChatAccess: next } : a))
        : prev,
    );
    try {
      const res = await fetch("/api/admin/accounts/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: target.email, allowed: next }),
      });
      const data = (await res.json()) as { allowed?: boolean; error?: string };
      if (!res.ok || typeof data.allowed !== "boolean") {
        throw new Error(data.error || "");
      }
      // ยืนยันผลจาก server
      setAccounts((prev) =>
        prev
          ? prev.map((a) => (a.email === target.email ? { ...a, hasChatAccess: data.allowed! } : a))
          : prev,
      );
    } catch (e) {
      // rollback กลับสถานะเดิม
      setAccounts((prev) =>
        prev
          ? prev.map((a) =>
              a.email === target.email ? { ...a, hasChatAccess: target.hasChatAccess } : a,
            )
          : prev,
      );
      setError((e as Error).message || "อัปเดตสิทธิ์ไม่สำเร็จ ลองใหม่");
    } finally {
      setBusyId(null);
    }
  }

  const allowedCount = accounts?.filter((a) => a.hasChatAccess).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-fg">บัญชีผู้ใช้ที่ลงทะเบียน</h2>
        <p className="mt-1 text-xs text-muted">
          รายชื่อบัญชีที่สมัครเข้าระบบทั้งหมด — เปิด/ปิด &quot;สิทธิ์เปิดกล่องแชต&quot; ต่อบัญชีได้ที่นี่
          (ต่างจากแท็บสิทธิ์กล่องแชตที่ใช้เพิ่มอีเมลไว้ล่วงหน้าก่อนสมัคร)
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาอีเมล หรือ ชื่อร้าน…"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder-muted/60 sm:max-w-xs"
          />
          {accounts && (
            <span className="text-xs text-muted">
              ทั้งหมด {accounts.length.toLocaleString()} บัญชี · มีสิทธิ์กล่องแชต{" "}
              {allowedCount.toLocaleString()}
            </span>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">อีเมล</th>
              <th className="px-4 py-3 font-medium">ชื่อร้าน</th>
              <th className="px-4 py-3 font-medium">วันสมัคร</th>
              <th className="px-4 py-3 font-medium">สิทธิ์กล่องแชต</th>
            </tr>
          </thead>
          <tbody>
            {accounts === null && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  กำลังโหลด…
                </td>
              </tr>
            )}
            {filtered?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  {accounts && accounts.length > 0
                    ? "ไม่พบบัญชีที่ตรงกับคำค้น"
                    : "ยังไม่มีบัญชีที่ลงทะเบียน"}
                </td>
              </tr>
            )}
            {filtered?.map((a) => {
              const busy = busyId === a.id;
              return (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium text-fg">{a.email}</td>
                  <td className="px-4 py-3 text-muted">{a.shopName || "–"}</td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap">
                    {new Date(a.createdAt).toLocaleDateString("th-TH", {
                      timeZone: "Asia/Bangkok",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={a.hasChatAccess}
                      disabled={busy}
                      onClick={() => toggleAccess(a)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition disabled:opacity-50 ${
                        a.hasChatAccess
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
                          : "border-line bg-surface2 text-muted hover:bg-surface2/70"
                      }`}
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          a.hasChatAccess ? "bg-emerald-500" : "bg-muted"
                        }`}
                        aria-hidden="true"
                      />
                      {busy
                        ? "กำลังบันทึก…"
                        : a.hasChatAccess
                          ? "มีสิทธิ์เปิดกล่องแชต"
                          : "ยังไม่มีสิทธิ์"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
