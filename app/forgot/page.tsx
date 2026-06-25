"use client";

import { useState } from "react";
import {
  AuthShell,
  Field,
  ErrorMsg,
  SubmitButton,
  BottomLink,
} from "../login/page";

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    if (!isEmail(email.trim())) {
      setError("อีเมลไม่ถูกต้อง");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "ส่งคำขอไม่สำเร็จ");
        return;
      }
      setSent(true);
    } catch {
      setError("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="ลืมรหัสผ่าน?"
      subtitle="ใส่อีเมลที่ใช้สมัคร เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้"
    >
      {sent ? (
        <div className="space-y-4">
          <p className="rounded-lg bg-emerald-500/10 px-3 py-3 text-sm text-emerald-300">
            ถ้ามีบัญชีที่ใช้อีเมลนี้ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปให้แล้ว — ลองเช็กกล่องอีเมล (รวมถึงโฟลเดอร์สแปม)
          </p>
          <BottomLink text="จำรหัสได้แล้ว?" href="/login" cta="กลับไปเข้าสู่ระบบ" />
        </div>
      ) : (
        <>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field
              label="อีเมล"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              placeholder="you@example.com"
            />
            {error && <ErrorMsg>{error}</ErrorMsg>}
            <SubmitButton loading={loading} idle="ส่งลิงก์ตั้งรหัสใหม่" busy="กำลังส่ง…" />
          </form>
          <BottomLink text="จำรหัสได้แล้ว?" href="/login" cta="กลับไปเข้าสู่ระบบ" />
        </>
      )}
    </AuthShell>
  );
}
