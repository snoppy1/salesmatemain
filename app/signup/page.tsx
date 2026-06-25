"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AuthShell,
  Field,
  PasswordField,
  GoogleButton,
  Divider,
  ErrorMsg,
  SubmitButton,
  BottomLink,
} from "../login/page";

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default function SignupPage() {
  const router = useRouter();
  const [shopName, setShopName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    if (!shopName.trim()) {
      setError("กรุณาใส่ชื่อร้าน");
      return;
    }
    if (!isEmail(email.trim())) {
      setError("อีเมลไม่ถูกต้อง");
      return;
    }
    if (password.length < 6) {
      setError("รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shopName, email, password }),
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
    <AuthShell title="สมัครใช้ฟรี" subtitle="สร้างบัญชีร้านของคุณ ใช้เวลาไม่ถึงนาที">
      <GoogleButton label="สมัครด้วย Google" />
      <Divider />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field
          label="ชื่อร้าน"
          value={shopName}
          onChange={setShopName}
          placeholder="เช่น ร้านสวยใส บิวตี้"
        />
        <Field
          label="อีเมล"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          placeholder="you@example.com"
        />
        <PasswordField
          label="รหัสผ่าน"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint="อย่างน้อย 6 ตัวอักษร"
        />
        {error && <ErrorMsg>{error}</ErrorMsg>}
        <SubmitButton loading={loading} idle="สมัครและเริ่มใช้งาน" busy="กำลังสมัคร…" />
      </form>
      <BottomLink text="มีบัญชีอยู่แล้ว?" href="/login" cta="เข้าสู่ระบบ" />
    </AuthShell>
  );
}
