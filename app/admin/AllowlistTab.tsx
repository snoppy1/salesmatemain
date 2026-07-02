"use client";

import { useEffect, useState } from "react";
import type { AllowedEmailRow } from "@/lib/allowlistRepo";

export default function AllowlistTab() {
  const [emails, setEmails] = useState<AllowedEmailRow[] | null>(null);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/allowlist")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        setEmails(((await res.json()) as { emails: AllowedEmailRow[] }).emails);
      })
      .catch(() => setError("โหลดรายการไม่สำเร็จ ลองรีเฟรช"));
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/allowlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, note }),
      });
      const data = (await res.json()) as { emails?: AllowedEmailRow[]; error?: string };
      if (!res.ok || !data.emails) {
        setError(data.error ?? "เพิ่มไม่สำเร็จ");
        return;
      }
      setEmails(data.emails);
      setEmail("");
      setNote("");
    } catch {
      setError("เพิ่มไม่สำเร็จ ลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: string) {
    if (!confirm(`ลบ ${target} ออกจากรายการอนุญาต?`)) return;
    try {
      const res = await fetch("/api/admin/allowlist", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: target }),
      });
      const data = (await res.json()) as { emails?: AllowedEmailRow[] };
      if (res.ok && data.emails) setEmails(data.emails);
    } catch {
      setError("ลบไม่สำเร็จ ลองใหม่");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-fg">เพิ่มอีเมลที่อนุญาตให้สมัคร</h2>
        <p className="mt-1 text-xs text-muted">
          เฉพาะอีเมลในรายการนี้เท่านั้นที่สมัครบัญชีใหม่ได้ (บัญชีที่มีอยู่แล้วไม่กระทบ)
        </p>
        <form onSubmit={add} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="somchai@example.com"
            className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="โน้ต เช่น ร้านแบต Nathapat (ไม่บังคับ)"
            className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-fg px-4 py-2 text-sm font-semibold text-surface transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "กำลังเพิ่ม…" : "เพิ่ม"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">อีเมล</th>
              <th className="px-4 py-3 font-medium">โน้ต</th>
              <th className="px-4 py-3 font-medium">สถานะ</th>
              <th className="px-4 py-3 font-medium">เพิ่มเมื่อ</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {emails === null && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">กำลังโหลด…</td></tr>
            )}
            {emails?.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">ยังไม่มีอีเมลในรายการ — เพิ่มอีเมลลูกค้า beta ด้านบน</td></tr>
            )}
            {emails?.map((r) => (
              <tr key={r.email} className="border-b border-line last:border-0">
                <td className="px-4 py-3 font-medium text-fg">{r.email}</td>
                <td className="px-4 py-3 text-muted">{r.note || "–"}</td>
                <td className="px-4 py-3">
                  {r.registered ? (
                    <span className="text-emerald-500">✅ สมัครแล้ว</span>
                  ) : (
                    <span className="text-muted">⏳ ยังไม่สมัคร</span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted">
                  {new Date(r.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => remove(r.email)}
                    className="rounded-lg border border-line px-2 py-1 text-xs text-muted transition hover:bg-surface2 hover:text-red-500"
                  >
                    ลบ
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
