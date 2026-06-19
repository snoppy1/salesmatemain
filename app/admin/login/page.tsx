"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell, FormField, btnClass } from "../../login/page";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "เข้าสู่ระบบไม่สำเร็จ");
        return;
      }
      router.push("/admin");
      router.refresh();
    } catch {
      setError("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="ผู้ดูแลระบบ"
      subtitle="เฉพาะเจ้าของระบบ — ดู/แก้ข้อมูลได้ทุกร้าน"
    >
      <form onSubmit={submit} className="space-y-4">
        <FormField
          label="ชื่อผู้ใช้ผู้ดูแล"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          placeholder="username ผู้ดูแล"
        />
        <FormField
          label="รหัสผ่าน"
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={loading} className={btnClass}>
          {loading ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบผู้ดูแล"}
        </button>
      </form>
    </AuthShell>
  );
}
