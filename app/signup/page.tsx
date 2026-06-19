"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthShell, FormField, btnClass } from "../login/page";

export default function SignupPage() {
  const router = useRouter();
  const [shopName, setShopName] = useState("");
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
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shopName, username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "สมัครไม่สำเร็จ");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="สมัครเปิดร้านใหม่" subtitle="สร้างบัญชีแอดมินสำหรับร้านของคุณ">
      <form onSubmit={submit} className="space-y-4">
        <FormField
          label="ชื่อร้าน"
          value={shopName}
          onChange={setShopName}
          placeholder="เช่น ร้านสวยใส บิวตี้"
        />
        <FormField
          label="ชื่อผู้ใช้ (สำหรับเข้าสู่ระบบ)"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          placeholder="อย่างน้อย 3 ตัวอักษร"
        />
        <FormField
          label="รหัสผ่าน"
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete="new-password"
          placeholder="อย่างน้อย 6 ตัวอักษร"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={loading} className={btnClass}>
          {loading ? "กำลังสมัคร…" : "สมัครและเริ่มใช้งาน"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-gray-600">
        มีร้านอยู่แล้ว?{" "}
        <Link href="/login" className="font-semibold text-emerald-700 hover:underline">
          เข้าสู่ระบบ
        </Link>
      </p>
    </AuthShell>
  );
}
