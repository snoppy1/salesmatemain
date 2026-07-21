"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

const SIGNIN_ERRORS: Record<string, string> = {
  google_unconfigured: "ยังไม่ได้ตั้งค่า Google บนระบบ — ใช้อีเมลเข้าสู่ระบบไปก่อนได้",
  google_failed: "เข้าสู่ระบบด้วย Google ไม่สำเร็จ ลองใหม่อีกครั้ง",
  not_invited: "อีเมลนี้ยังไม่ได้รับสิทธิ์ทดลองใช้ กรุณาติดต่อทีมงาน",
};

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string>(
    () => SIGNIN_ERRORS[params.get("e") ?? ""] ?? "",
  );
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    if (!email.trim() || !password) {
      setError("กรุณาใส่อีเมลและรหัสผ่าน");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: email, password, remember }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "เข้าสู่ระบบไม่สำเร็จ");
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
    <AuthShell title="เข้าสู่ระบบ" subtitle="ยินดีต้อนรับกลับ — จัดการร้านของคุณต่อได้เลย">
      <GoogleButton label="เข้าสู่ระบบด้วย Google" />
      <Divider />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field
          label="อีเมล"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="username"
          placeholder="you@example.com"
        />
        <PasswordField
          label="รหัสผ่าน"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <div className="flex items-center justify-between text-sm">
          <label className="flex cursor-pointer items-center gap-2 text-gray-300">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-transparent accent-emerald-500"
            />
            จดจำฉัน
          </label>
          <Link href="/forgot" className="font-medium text-emerald-400 hover:underline">
            ลืมรหัสผ่าน?
          </Link>
        </div>
        {error && <ErrorMsg>{error}</ErrorMsg>}
        <SubmitButton loading={loading} idle="เข้าสู่ระบบ" busy="กำลังเข้าสู่ระบบ…" />
      </form>
      <BottomLink text="ยังไม่มีบัญชี?" href="/signup" cta="สมัครใช้ฟรี" />
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}

/* ===================== ชิ้นส่วนใช้ร่วมกับ signup / forgot ===================== */

/** พื้นหลังเส้น contour แบบแผนที่ระดับความสูง — วาดครั้งเดียวต่อขนาดจอ (นิ่ง ไม่กินเฟรม) */
function TopoCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const CELL = 230;
    const LEVELS = 13;
    const OPACITY = 0.85;
    const draw = () => {
      const w = (cv.width = Math.max(1, cv.clientWidth));
      const h = (cv.height = Math.max(1, cv.clientHeight));
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      const rnd = (i: number, j: number) => {
        const s = Math.sin(i * 127.1 + j * 311.7 + 94.3) * 43758.5453;
        return s - Math.floor(s);
      };
      const sm = (t: number) => t * t * (3 - 2 * t);
      const vnoise = (x: number, y: number, c: number) => {
        const i = Math.floor(x / c), j = Math.floor(y / c);
        const fx = sm(x / c - i), fy = sm(y / c - j);
        const a = rnd(i, j), b = rnd(i + 1, j), d = rnd(i, j + 1), e = rnd(i + 1, j + 1);
        return a + (b - a) * fx + (d - a) * fy + (a - b - d + e) * fx * fy;
      };
      const field = (x: number, y: number) =>
        0.62 * vnoise(x, y, CELL) + 0.28 * vnoise(x + 917, y + 413, CELL * 0.47) + 0.1 * vnoise(x + 233, y + 771, CELL * 0.21);
      // เส้นชั้นความสูง: ถี่ขึ้นแถวยอด, ยอดสว่างกว่าหุบ, ทุกเส้นที่ 4 เป็นเส้นหลักหนา/สว่าง
      const band = (x: number, y: number) => Math.floor(Math.pow(field(x, y), 1.6) * LEVELS);
      const img = ctx.getImageData(0, 0, w, h);
      const data = img.data;
      const put = (x: number, y: number, v: number) => {
        const k = (y * w + x) * 4;
        if (data[k] < v) {
          data[k] = v;
          data[k + 1] = v;
          data[k + 2] = v;
          data[k + 3] = 255;
        }
      };
      let prevRow = new Int16Array(w);
      for (let x = 0; x < w; x++) prevRow[x] = band(x, 0);
      for (let y = 1; y < h; y++) {
        const row = new Int16Array(w);
        row[0] = band(0, y);
        for (let x = 1; x < w; x++) {
          const b = (row[x] = band(x, y));
          if (b !== row[x - 1] || b !== prevRow[x]) {
            const major = b % 4 === 0;
            const depth = b / LEVELS;
            const v = Math.round((major ? 255 : 120 + 130 * depth) * OPACITY);
            put(x, y, v);
            if (major) {
              put(x - 1, y, Math.round(v * 0.7));
              put(x, y - 1, Math.round(v * 0.7));
            }
          }
        }
        prevRow = row;
      }
      ctx.putImageData(img, 0, 0);
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, []);
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 block h-full w-full" />;
}

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-black px-4 py-10 text-gray-100">
      <TopoCanvas />
      <div className="relative w-full max-w-md">
        {/* วงรีดำหลังหัว — กันเส้น contour ตัดผ่านโลโก้/ตัวหนังสือ */}
        <div
          className="auth-rise mb-6 flex flex-col items-center rounded-full px-10 py-4 text-center"
          style={{ background: "radial-gradient(closest-side, rgba(0,0,0,.92), rgba(0,0,0,.75) 60%, transparent)" }}
        >
          <span
            aria-hidden
            className="auth-breathe inline-block h-[52px] w-16"
            style={{
              background: "#34D399",
              WebkitMask: "url(/salesmate-logo.svg) center / contain no-repeat",
              mask: "url(/salesmate-logo.svg) center / contain no-repeat",
            }}
          />
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-white">SalesMate</h1>
          <p className="mt-1 text-sm text-gray-400">ผู้ช่วยขาย AI สำหรับร้านแชต</p>
        </div>
        {/* ชั้นนอก 1px = เส้นขอบ + แสงเขียวตามเมาส์ (แทน border เดิม) */}
        <div
          className="auth-rise auth-glow rounded-[17px] p-px [animation-delay:.08s]"
          onPointerMove={(e) => {
            if (e.pointerType !== "mouse") return;
            const r = e.currentTarget.getBoundingClientRect();
            e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
            e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
          }}
        >
          <div className="auth-card rounded-2xl bg-[#10161D] p-6 shadow-2xl sm:p-7">
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            <p className="mb-5 mt-1 text-sm text-gray-400">{subtitle}</p>
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}

export function Field({
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-300">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-[#0E1217] px-3.5 py-2.5 text-sm text-gray-100 placeholder-gray-500 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
      />
    </label>
  );
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-300">{label}</span>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder="••••••••"
          className="w-full rounded-xl border border-white/10 bg-[#0E1217] px-3.5 py-2.5 pr-11 text-sm text-gray-100 placeholder-gray-500 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-gray-400 transition hover:text-gray-200"
        >
          {show ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.6 6.6A18.5 18.5 0 0 0 2 12s3 8 10 8a9.1 9.1 0 0 0 5.4-1.6"/><path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z"/><circle cx="12" cy="12" r="3"/></svg>
          )}
        </button>
      </div>
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

export function GoogleButton({ label }: { label: string }) {
  return (
    <a
      href="/api/auth/google/start"
      className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white/5 text-sm font-semibold text-gray-100 transition hover:bg-white/10 active:scale-[.98]"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#FFC107" d="M21.35 11.1H12v3.83h5.32a5.7 5.7 0 0 1-2.47 3.74v3.1h3.99c2.34-2.16 3.69-5.34 3.69-9.12 0-.6-.06-1.18-.17-1.55z"/>
        <path fill="#FF3D00" d="M12 22c3.24 0 5.96-1.08 7.94-2.92l-3.99-3.1c-1.1.74-2.52 1.18-3.95 1.18-3.04 0-5.62-2.05-6.54-4.81H1.34v3.2A10 10 0 0 0 12 22z"/>
        <path fill="#4CAF50" d="M5.46 12.35a6 6 0 0 1 0-3.85V5.3H1.34a10 10 0 0 0 0 9.05l4.12-3.2z" opacity=".001"/>
        <path fill="#1976D2" d="M12 6.04c1.76 0 3.34.6 4.59 1.79l3.42-3.42C17.95 2.43 15.24 1.4 12 1.4A10 10 0 0 0 1.34 7.5l4.12 3.2C6.38 8.09 8.96 6.04 12 6.04z"/>
        <path fill="#4CAF50" d="M5.46 13.5A6 6 0 0 1 5.13 12c0-.52.07-1.02.2-1.5L1.34 7.3A10 10 0 0 0 1.34 16.7l4.12-3.2z"/>
      </svg>
      {label}
    </a>
  );
}

export function Divider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-gray-500">
      <span className="h-px flex-1 bg-white/10" />
      หรือ
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}

export function ErrorMsg({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {children}
    </p>
  );
}

export function SubmitButton({
  loading,
  idle,
  busy,
}: {
  loading: boolean;
  idle: string;
  busy: string;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="relative h-11 w-full overflow-hidden rounded-xl bg-emerald-500 text-sm font-bold text-[#04240F] shadow-[0_10px_26px_-12px_rgba(52,211,153,.9)] transition after:absolute after:inset-0 after:-translate-x-[130%] after:-skew-x-12 after:bg-[linear-gradient(105deg,transparent_42%,rgba(255,255,255,.45)_50%,transparent_58%)] after:transition-transform after:duration-[550ms] after:content-[''] hover:bg-emerald-400 hover:after:translate-x-[130%] active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? busy : idle}
    </button>
  );
}

export function BottomLink({
  text,
  href,
  cta,
}: {
  text: string;
  href: string;
  cta: string;
}) {
  return (
    <p className="mt-5 text-center text-sm text-gray-400">
      {text}{" "}
      <Link href={href} className="font-semibold text-emerald-400 hover:underline">
        {cta}
      </Link>
    </p>
  );
}
