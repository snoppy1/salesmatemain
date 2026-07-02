# Admin Home Console + Email Allowlist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** กันคนนอกสมัครใช้ SalesMate (email allowlist บังคับทั้งฟอร์ม+Google) และเพิ่มแท็บ Home/Allowlist ใน console `/admin` ให้เจ้าของระบบเห็นภาพรวมทุกร้าน + ค่า AI โดยประมาณ ก่อนเปิด beta

**Architecture:** ตาราง `allowed_emails` ใหม่ + repo (`lib/allowlistRepo.ts`) บังคับที่ 2 จุดสมัคร; สถิติภาพรวมคิวรีสดจากตารางเดิมผ่าน `lib/adminStats.ts`; UI ต่อยอด `AdminConsole.tsx` เดิมเป็น 3 แท็บ (home/shops/allowlist) โดยแยกแท็บใหม่เป็นไฟล์ component ละไฟล์ ทุก API ใหม่ guard ด้วย `getCurrentSuperadmin()` เหมือน `/api/admin/shops`

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind, Neon Postgres (pg), vitest

**Spec:** `docs/superpowers/specs/2026-07-02-admin-console-allowlist-design.md`

## Global Constraints

- ข้อความปฏิเสธสมัคร (ใช้ตรงกันทุกจุด): `อีเมลนี้ยังไม่ได้รับสิทธิ์ทดลองใช้ กรุณาติดต่อทีมงาน`
- อีเมลเก็บ/เทียบ lowercase+trim เสมอ; บัญชีที่มีอยู่แล้วล็อกอินได้เสมอ (คุมเฉพาะสมัครใหม่)
- ค่า AI ประมาณ: 1 ข้อความลูกค้า ≈ ฿0.5 (`THB_PER_CUSTOMER_MSG = 0.5`) — UI ต้องมีคำว่า "โดยประมาณ"
- "วันนี้" = เที่ยงคืนตามเวลาไทย (UTC+7)
- เทสต์ DB ใช้อีเมล throwaway `zz-test-*@example.com` และลบทิ้งในเทสต์เอง (กฎ no-destructive-tests)
- ทุก commit: ต่อท้ายด้วย `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- สไตล์ UI ใช้คลาสธีมเดิมของโปรเจกต์: `bg-surface`, `bg-surface2`, `border-line`, `text-fg`, `text-muted`, `rounded-2xl`

---

### Task 1: ตาราง allowed_emails + lib/allowlistRepo.ts (TDD)

**Files:**
- Modify: `lib/db.ts` (เพิ่ม CREATE TABLE ในบล็อก ensureSchema — วางต่อจาก `CREATE TABLE IF NOT EXISTS super_sessions (...)`)
- Create: `lib/allowlistRepo.ts`
- Test: `test/allowlist.test.ts`

**Interfaces:**
- Produces: `normalizeEmail(email: string): string` (pure), `isEmailAllowed(email: string): Promise<boolean>`, `addAllowedEmail(email: string, note?: string): Promise<void>`, `removeAllowedEmail(email: string): Promise<void>`, `listAllowedEmails(): Promise<AllowedEmailRow[]>` โดย `AllowedEmailRow = { email: string; note: string; createdAt: number; registered: boolean }`
- หมายเหตุ: vitest มี alias `server-only` → stub และ `@` → root อยู่แล้ว (vitest.config.ts) เทสต์ import lib ได้ตรงๆ; pool สร้าง lazy ตอน query แรก จึงโหลด .env.local ใน test body ได้

- [ ] **Step 1: เขียนเทสต์ (จะ fail เพราะยังไม่มีไฟล์)**

```ts
// test/allowlist.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import {
  normalizeEmail,
  isEmailAllowed,
  addAllowedEmail,
  removeAllowedEmail,
  listAllowedEmails,
} from "@/lib/allowlistRepo";

// โหลด DATABASE_URL ก่อนคิวรีแรก (pool สร้าง lazy)
const env = readFileSync(".env.local", "utf8");
for (const l of env.split(/\r?\n/)) {
  const i = l.indexOf("=");
  if (i > 0 && !l.startsWith("#")) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim();
}

// อีเมล throwaway — ลบทิ้งเองทั้งก่อนและหลัง (no-destructive-tests)
const E1 = "zz-test-allow-1@example.com";
const E2_UPPER = "ZZ-Test-Allow-2@Example.COM";
const E2_LOWER = "zz-test-allow-2@example.com";

async function cleanup() {
  await removeAllowedEmail(E1);
  await removeAllowedEmail(E2_LOWER);
}

describe("allowlistRepo", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("normalizeEmail: trim + lowercase", () => {
    expect(normalizeEmail("  Foo@BAR.com ")).toBe("foo@bar.com");
  });

  it("อีเมลที่ไม่ได้เพิ่ม → ไม่อนุญาต", async () => {
    expect(await isEmailAllowed(E1)).toBe(false);
  });

  it("เพิ่มแล้ว → อนุญาต และเช็คแบบไม่สนตัวพิมพ์", async () => {
    await addAllowedEmail(E2_UPPER, "ร้านทดสอบ");
    expect(await isEmailAllowed(E2_LOWER)).toBe(true);
    expect(await isEmailAllowed("zz-TEST-allow-2@EXAMPLE.com")).toBe(true);
  });

  it("เพิ่มซ้ำ = upsert อัปเดต note ไม่ error", async () => {
    await addAllowedEmail(E2_LOWER, "โน้ตใหม่");
    const rows = await listAllowedEmails();
    const row = rows.find((r) => r.email === E2_LOWER);
    expect(row?.note).toBe("โน้ตใหม่");
    expect(row?.registered).toBe(false); // ไม่มีบัญชีจริงของอีเมลนี้
  });

  it("ลบแล้ว → ไม่อนุญาต", async () => {
    await removeAllowedEmail(E2_LOWER);
    expect(await isEmailAllowed(E2_LOWER)).toBe(false);
  });
}, 30000);
```

- [ ] **Step 2: รันให้เห็นว่า fail**

Run: `npx vitest run test/allowlist.test.ts`
Expected: FAIL — `Cannot find module '@/lib/allowlistRepo'` (หรือ resolve error)

- [ ] **Step 3: เพิ่มตารางใน lib/db.ts**

ในสตริง ensureSchema ของ `lib/db.ts` วางบล็อกนี้ต่อจากตาราง `super_sessions`:

```sql
    CREATE TABLE IF NOT EXISTS allowed_emails (
      email      TEXT PRIMARY KEY,
      note       TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    );
```

- [ ] **Step 4: สร้าง lib/allowlistRepo.ts**

```ts
import "server-only";
import { query, queryOne } from "./db";

/** อีเมลที่ได้รับอนุญาตให้ "สมัครใหม่" (beta gate) — เก็บ lowercase เสมอ */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function isEmailAllowed(email: string): Promise<boolean> {
  const row = await queryOne<{ email: string }>(
    "SELECT email FROM allowed_emails WHERE email = $1",
    [normalizeEmail(email)],
  );
  return Boolean(row);
}

/** เพิ่มอีเมล (ซ้ำ = อัปเดตโน้ต ไม่ error) */
export async function addAllowedEmail(email: string, note = ""): Promise<void> {
  await query(
    `INSERT INTO allowed_emails (email, note, created_at) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET note = EXCLUDED.note`,
    [normalizeEmail(email), note.trim(), Date.now()],
  );
}

export async function removeAllowedEmail(email: string): Promise<void> {
  await query("DELETE FROM allowed_emails WHERE email = $1", [normalizeEmail(email)]);
}

export type AllowedEmailRow = {
  email: string;
  note: string;
  createdAt: number;
  registered: boolean; // มีบัญชีใน admins แล้วหรือยัง
};

export async function listAllowedEmails(): Promise<AllowedEmailRow[]> {
  const rows = await query<{
    email: string;
    note: string;
    created_at: string;
    registered: boolean;
  }>(
    `SELECT ae.email, ae.note, ae.created_at,
            EXISTS (SELECT 1 FROM admins a WHERE lower(a.email) = ae.email) AS registered
     FROM allowed_emails ae
     ORDER BY ae.created_at DESC`,
  );
  return rows.map((r) => ({
    email: r.email,
    note: r.note,
    createdAt: Number(r.created_at),
    registered: r.registered,
  }));
}
```

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

Run: `npx vitest run test/allowlist.test.ts`
Expected: PASS 5 tests

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts lib/allowlistRepo.ts test/allowlist.test.ts
git commit -m "feat(beta-gate): ตาราง allowed_emails + allowlistRepo (เช็ค/เพิ่ม/ลบ/ลิสต์, case-insensitive)"
```

---

### Task 2: บังคับ allowlist ที่จุดสมัคร (ฟอร์ม + Google) + ข้อความหน้า login

**Files:**
- Modify: `app/api/auth/signup/route.ts` (~บรรทัด 28-31 หลัง validate อีเมล)
- Modify: `app/api/auth/google/callback/route.ts` (~บรรทัด 69-80 branch สร้างบัญชีใหม่)
- Modify: `app/login/page.tsx` (~บรรทัด 7-10 `SIGNIN_ERRORS`)

**Interfaces:**
- Consumes: `isEmailAllowed(email)` จาก Task 1

- [ ] **Step 1: signup route — เพิ่มเช็คหลัง `isValidEmail` (ก่อนเช็ค password)**

```ts
// เพิ่ม import บนไฟล์
import { isEmailAllowed } from "@/lib/allowlistRepo";

// ใน POST หลังบล็อก if (!isValidEmail(email)) {...} เพิ่ม:
  // beta gate: เฉพาะอีเมลที่ได้รับอนุญาตเท่านั้นที่สมัครได้
  if (!(await isEmailAllowed(email))) {
    return NextResponse.json(
      { error: "อีเมลนี้ยังไม่ได้รับสิทธิ์ทดลองใช้ กรุณาติดต่อทีมงาน" },
      { status: 403 },
    );
  }
```

- [ ] **Step 2: google callback — กันเฉพาะ "บัญชีใหม่" (บัญชีเดิมล็อกอินได้เสมอ)**

```ts
// เพิ่ม import บนไฟล์
import { isEmailAllowed } from "@/lib/allowlistRepo";

// เปลี่ยน branch else (ตอนไม่เจอ admin เดิม) เป็น:
    let admin = await findAdminByGoogle(googleId, email);
    if (admin) {
      await linkGoogleId(admin.id, googleId);
    } else {
      // beta gate: คนใหม่ต้องอยู่ใน allowlist ก่อน
      if (!(await isEmailAllowed(email))) {
        return NextResponse.redirect(`${origin}/login?e=not_invited`);
      }
      const adminId = await createAccount({
        shopName: info.name ? `ร้านของ ${info.name}` : "ร้านของฉัน",
        username: email,
        email,
        googleId,
      });
      admin = { id: adminId };
    }
```

- [ ] **Step 3: หน้า login — เพิ่มข้อความ `not_invited`**

```ts
const SIGNIN_ERRORS: Record<string, string> = {
  google_unconfigured: "ยังไม่ได้ตั้งค่า Google บนระบบ — ใช้อีเมลเข้าสู่ระบบไปก่อนได้",
  google_failed: "เข้าสู่ระบบด้วย Google ไม่สำเร็จ ลองใหม่อีกครั้ง",
  not_invited: "อีเมลนี้ยังไม่ได้รับสิทธิ์ทดลองใช้ กรุณาติดต่อทีมงาน",
};
```

- [ ] **Step 4: ตรวจ type + เทสต์เดิมไม่พัง**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0, เทสต์ผ่านทั้งหมด (รวม 5 ของ Task 1)

- [ ] **Step 5: Commit**

```bash
git add app/api/auth/signup/route.ts app/api/auth/google/callback/route.ts app/login/page.tsx
git commit -m "feat(beta-gate): บังคับ email allowlist ตอนสมัคร (ฟอร์ม 403 + Google redirect not_invited) — บัญชีเดิมไม่กระทบ"
```

---

### Task 3: lib/adminStats.ts + GET /api/admin/overview (TDD ฟังก์ชัน pure)

**Files:**
- Create: `lib/adminStats.ts`
- Create: `app/api/admin/overview/route.ts`
- Test: `test/adminStats.test.ts`

**Interfaces:**
- Produces: `bangkokDayStartMs(now?: number): number` (pure), `THB_PER_CUSTOMER_MSG = 0.5`, `getAdminOverview(): Promise<AdminOverview>` โดย

```ts
export type ShopOverviewRow = {
  id: string; name: string; email: string;
  channels: string[];               // เซ็ตย่อยของ ["line","lazada","facebook"]
  productCount: number; conversationCount: number;
  custMsgsToday: number; custMsgs7d: number;
  lastActivityAt: number | null;    // epoch ms
};
export type AdminOverview = {
  cards: { totalShops: number; activeToday: number; custMsgsToday: number; estCostTodayTHB: number };
  shops: ShopOverviewRow[];
};
```

- [ ] **Step 1: เขียนเทสต์ pure function (fail ก่อน)**

```ts
// test/adminStats.test.ts
import { describe, it, expect } from "vitest";
import { bangkokDayStartMs, THB_PER_CUSTOMER_MSG } from "@/lib/adminStats";

describe("bangkokDayStartMs", () => {
  it("10:00 เวลาไทย → เที่ยงคืนไทยวันเดียวกัน (17:00Z ของเมื่อวาน)", () => {
    const now = Date.parse("2026-07-02T03:00:00Z"); // = 10:00 ICT 2026-07-02
    expect(bangkokDayStartMs(now)).toBe(Date.parse("2026-07-01T17:00:00Z"));
  });
  it("00:30 เวลาไทย → ยังเป็นวันเดียวกัน (ไม่ถอยไปวันก่อน)", () => {
    const now = Date.parse("2026-07-01T17:30:00Z"); // = 00:30 ICT 2026-07-02
    expect(bangkokDayStartMs(now)).toBe(Date.parse("2026-07-01T17:00:00Z"));
  });
  it("ค่าคงที่ต้นทุนต่อข้อความ = 0.5", () => {
    expect(THB_PER_CUSTOMER_MSG).toBe(0.5);
  });
});
```

- [ ] **Step 2: รันให้ fail**

Run: `npx vitest run test/adminStats.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: สร้าง lib/adminStats.ts**

```ts
import "server-only";
import { query } from "./db";

/** ประมาณค่า AI: ข้อความลูกค้า 1 ข้อความ ≈ 1 การตอบ ≈ ฿0.5 (ค่า warm เฉลี่ยที่วัดจริง) */
export const THB_PER_CUSTOMER_MSG = 0.5;

export type ShopOverviewRow = {
  id: string;
  name: string;
  email: string;
  channels: string[];
  productCount: number;
  conversationCount: number;
  custMsgsToday: number;
  custMsgs7d: number;
  lastActivityAt: number | null;
};

export type AdminOverview = {
  cards: {
    totalShops: number;
    activeToday: number;
    custMsgsToday: number;
    estCostTodayTHB: number;
  };
  shops: ShopOverviewRow[];
};

/** เที่ยงคืนของ "วันนี้" ตามเวลาไทย (UTC+7) เป็น epoch ms */
export function bangkokDayStartMs(now = Date.now()): number {
  const BKK = 7 * 3600e3;
  return Math.floor((now + BKK) / 86400e3) * 86400e3 - BKK;
}

/** ภาพรวมทุกร้านสำหรับ console ผู้ดูแลระบบ (คิวรีสด — จำนวนร้านระดับสิบ ไม่ต้อง cache) */
export async function getAdminOverview(): Promise<AdminOverview> {
  const dayStart = bangkokDayStartMs();
  const weekStart = dayStart - 6 * 86400e3; // วันนี้ + ย้อนหลัง 6 วัน = 7 วัน

  const rows = await query<{
    id: string;
    name: string;
    email: string;
    has_line: boolean;
    has_lazada: boolean;
    has_facebook: boolean;
    product_count: number;
    conversation_count: number;
    msgs_today: number;
    msgs_7d: number;
    last_activity: string | null;
  }>(
    `SELECT s.id, s.name,
       COALESCE((SELECT a.email FROM admins a WHERE a.shop_id = s.id ORDER BY a.created_at ASC LIMIT 1), '') AS email,
       EXISTS (SELECT 1 FROM line_channels x WHERE x.shop_id = s.id)     AS has_line,
       EXISTS (SELECT 1 FROM lazada_channels x WHERE x.shop_id = s.id)   AS has_lazada,
       EXISTS (SELECT 1 FROM facebook_channels x WHERE x.shop_id = s.id) AS has_facebook,
       (SELECT count(*)::int FROM products p WHERE p.shop_id = s.id) AS product_count,
       (SELECT count(*)::int FROM conversations c WHERE c.shop_id = s.id) AS conversation_count,
       (SELECT count(*)::int FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.shop_id = s.id AND m.sender = 'customer' AND m.created_at >= $1) AS msgs_today,
       (SELECT count(*)::int FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.shop_id = s.id AND m.sender = 'customer' AND m.created_at >= $2) AS msgs_7d,
       (SELECT max(c.last_message_at) FROM conversations c WHERE c.shop_id = s.id) AS last_activity
     FROM shops s
     ORDER BY (SELECT max(c.last_message_at) FROM conversations c WHERE c.shop_id = s.id) DESC NULLS LAST`,
    [dayStart, weekStart],
  );

  const shops: ShopOverviewRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    channels: [
      ...(r.has_line ? ["line"] : []),
      ...(r.has_lazada ? ["lazada"] : []),
      ...(r.has_facebook ? ["facebook"] : []),
    ],
    productCount: r.product_count,
    conversationCount: r.conversation_count,
    custMsgsToday: r.msgs_today,
    custMsgs7d: r.msgs_7d,
    lastActivityAt: r.last_activity != null ? Number(r.last_activity) : null,
  }));

  const custMsgsToday = shops.reduce((a, s) => a + s.custMsgsToday, 0);
  return {
    cards: {
      totalShops: shops.length,
      activeToday: shops.filter((s) => s.custMsgsToday > 0).length,
      custMsgsToday,
      estCostTodayTHB: custMsgsToday * THB_PER_CUSTOMER_MSG,
    },
    shops,
  };
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `npx vitest run test/adminStats.test.ts`
Expected: PASS 3 tests

- [ ] **Step 5: สร้าง app/api/admin/overview/route.ts**

```ts
import { NextResponse } from "next/server";
import { getCurrentSuperadmin } from "@/lib/superAuth";
import { getAdminOverview } from "@/lib/adminStats";

export const runtime = "nodejs";

export async function GET() {
  const su = await getCurrentSuperadmin();
  if (!su) {
    return NextResponse.json({ error: "ต้องเป็นผู้ดูแลระบบ" }, { status: 401 });
  }
  return NextResponse.json(await getAdminOverview());
}
```

- [ ] **Step 6: ตรวจ + Commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: ผ่านทั้งหมด

```bash
git add lib/adminStats.ts app/api/admin/overview/route.ts test/adminStats.test.ts
git commit -m "feat(admin): ภาพรวมทุกร้าน (adminStats + GET /api/admin/overview) — ข้อความวันนี้/7วัน + ค่า AI ประมาณ"
```

---

### Task 4: API จัดการ allowlist (GET/POST/DELETE /api/admin/allowlist)

**Files:**
- Create: `app/api/admin/allowlist/route.ts`

**Interfaces:**
- Consumes: `listAllowedEmails/addAllowedEmail/removeAllowedEmail` (Task 1), `isValidEmail` จาก `lib/auth`, `getCurrentSuperadmin` จาก `lib/superAuth`
- Produces: ทุก method คืน `{ emails: AllowedEmailRow[] }` (ลิสต์ล่าสุดหลังทำรายการ) — UI ใช้ตรงๆ

- [ ] **Step 1: สร้างไฟล์**

```ts
import { NextResponse } from "next/server";
import { getCurrentSuperadmin } from "@/lib/superAuth";
import { isValidEmail } from "@/lib/auth";
import {
  listAllowedEmails,
  addAllowedEmail,
  removeAllowedEmail,
} from "@/lib/allowlistRepo";

export const runtime = "nodejs";

const UNAUTHORIZED = () =>
  NextResponse.json({ error: "ต้องเป็นผู้ดูแลระบบ" }, { status: 401 });

export async function GET() {
  if (!(await getCurrentSuperadmin())) return UNAUTHORIZED();
  return NextResponse.json({ emails: await listAllowedEmails() });
}

export async function POST(request: Request) {
  if (!(await getCurrentSuperadmin())) return UNAUTHORIZED();
  let body: { email?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "อีเมลไม่ถูกต้อง" }, { status: 400 });
  }
  await addAllowedEmail(email, (body.note ?? "").toString());
  return NextResponse.json({ emails: await listAllowedEmails() });
}

export async function DELETE(request: Request) {
  if (!(await getCurrentSuperadmin())) return UNAUTHORIZED();
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  if (!email) {
    return NextResponse.json({ error: "ระบุอีเมลที่จะลบ" }, { status: 400 });
  }
  await removeAllowedEmail(email);
  return NextResponse.json({ emails: await listAllowedEmails() });
}
```

- [ ] **Step 2: ตรวจ + Commit**

Run: `npx tsc --noEmit`
Expected: exit 0

```bash
git add app/api/admin/allowlist/route.ts
git commit -m "feat(admin): API จัดการ allowlist (เพิ่ม/ลบ/ลิสต์ + สถานะสมัครแล้ว) หลัง superadmin"
```

---

### Task 5: UI 3 แท็บ — HomeTab + AllowlistTab + ปรับ AdminConsole

**Files:**
- Create: `app/admin/HomeTab.tsx`
- Create: `app/admin/AllowlistTab.tsx`
- Modify: `app/admin/AdminConsole.tsx` (state แท็บ + tab bar + ห่อ layout เดิมใน `tab === "shops"`)

**Interfaces:**
- Consumes: `GET /api/admin/overview` → `AdminOverview` (Task 3), `/api/admin/allowlist` → `{ emails }` (Task 4)
- Produces: `<HomeTab onOpenShop={(id: string) => void} />`, `<AllowlistTab />`

- [ ] **Step 1: สร้าง app/admin/HomeTab.tsx**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { AdminOverview } from "@/lib/adminStats";

const CHANNEL_LABEL: Record<string, string> = {
  line: "LINE",
  lazada: "Lazada",
  facebook: "FB",
};

function fmtLast(ms: number | null): string {
  if (!ms) return "–";
  return new Date(ms).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HomeTab({ onOpenShop }: { onOpenShop: (id: string) => void }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/overview")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const d = (await res.json()) as AdminOverview;
        if (alive) setData(d);
      })
      .catch(() => alive && setError("โหลดภาพรวมไม่สำเร็จ ลองรีเฟรช"));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (!data) return <p className="text-sm text-muted">กำลังโหลดภาพรวม…</p>;

  const cards = [
    { label: "ร้านทั้งหมด", value: String(data.cards.totalShops) },
    { label: "ร้าน active วันนี้", value: String(data.cards.activeToday) },
    { label: "ข้อความลูกค้าวันนี้", value: String(data.cards.custMsgsToday) },
    { label: "ค่า AI วันนี้ (โดยประมาณ)", value: `฿${data.cards.estCostTodayTHB.toFixed(2)}` },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-xs text-muted">{c.label}</p>
            <p className="mt-1 text-2xl font-bold text-fg">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">ร้าน</th>
              <th className="px-4 py-3 font-medium">อีเมลเจ้าของ</th>
              <th className="px-4 py-3 font-medium">ช่องทาง</th>
              <th className="px-4 py-3 font-medium text-right">สินค้า</th>
              <th className="px-4 py-3 font-medium text-right">บทสนทนา</th>
              <th className="px-4 py-3 font-medium text-right">ข้อความวันนี้ / 7วัน</th>
              <th className="px-4 py-3 font-medium text-right">ค่า AI 7วัน ≈</th>
              <th className="px-4 py-3 font-medium">ใช้งานล่าสุด</th>
            </tr>
          </thead>
          <tbody>
            {data.shops.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onOpenShop(s.id)}
                    className="font-medium text-fg underline-offset-2 hover:underline"
                  >
                    {s.name || "(ไม่มีชื่อ)"}
                  </button>
                </td>
                <td className="px-4 py-3 text-muted">{s.email || "–"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {s.channels.length === 0 && <span className="text-muted">–</span>}
                    {s.channels.map((ch) => (
                      <span
                        key={ch}
                        className="rounded-full bg-surface2 px-2 py-0.5 text-xs font-semibold text-muted"
                      >
                        {CHANNEL_LABEL[ch] ?? ch}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">{s.productCount}</td>
                <td className="px-4 py-3 text-right">{s.conversationCount}</td>
                <td className="px-4 py-3 text-right">
                  {s.custMsgsToday} / {s.custMsgs7d}
                </td>
                <td className="px-4 py-3 text-right">฿{(s.custMsgs7d * 0.5).toFixed(2)}</td>
                <td className="px-4 py-3 text-muted">{fmtLast(s.lastActivityAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: สร้าง app/admin/AllowlistTab.tsx**

```tsx
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
```

- [ ] **Step 3: ปรับ AdminConsole.tsx เป็น 3 แท็บ**

3.1 เพิ่ม import บนไฟล์:

```tsx
import HomeTab from "./HomeTab";
import AllowlistTab from "./AllowlistTab";
```

3.2 เพิ่ม state แท็บ (วางใต้ `const [save, setSave] = ...`):

```tsx
  const [tab, setTab] = useState<"home" | "shops" | "allowlist">("home");
```

3.3 แทรก tab bar หลังปิด `</header>` (ก่อน `<div className="grid ...">` เดิม):

```tsx
      <nav className="mb-6 flex gap-2">
        {(
          [
            ["home", "หน้าแรก"],
            ["shops", "ร้านค้า"],
            ["allowlist", "อีเมลที่อนุญาต"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === key
                ? "bg-fg text-surface"
                : "border border-line bg-surface text-muted hover:bg-surface2"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "home" && (
        <HomeTab
          onOpenShop={(id) => {
            setTab("shops");
            void selectShop(id);
          }}
        />
      )}

      {tab === "allowlist" && <AllowlistTab />}
```

3.4 ห่อ layout เดิมทั้งก้อน (`<div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_1fr]"> ... </div>` จนจบ) ด้วยเงื่อนไข:

```tsx
      {tab === "shops" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_1fr]">
          {/* ...ของเดิมทั้งหมด ไม่แก้ข้างใน... */}
        </div>
      )}
```

- [ ] **Step 4: ตรวจ type + build**

Run: `npx tsc --noEmit && npx next build 2>&1 | grep -iE "compiled successfully|error"`
Expected: `✓ Compiled successfully`

- [ ] **Step 5: Commit**

```bash
git add app/admin/HomeTab.tsx app/admin/AllowlistTab.tsx app/admin/AdminConsole.tsx
git commit -m "feat(admin): console 3 แท็บ — หน้าแรก (การ์ดสรุป+ตารางทุกร้าน) / ร้านค้า (เดิม) / อีเมลที่อนุญาต"
```

---

### Task 6: Gate สุดท้าย + deploy + ทดสอบจริง

- [ ] **Step 1: รันครบชุด**

Run: `npx vitest run && npx tsc --noEmit && npx next build 2>&1 | grep -iE "compiled successfully|error"`
Expected: เทสต์ผ่านหมด (เดิม 59 + ใหม่ 8), tsc exit 0, build สำเร็จ

- [ ] **Step 2: Deploy**

```bash
git push origin feat/ui-redesign:main
```

- [ ] **Step 3: ทดสอบจริงบน prod (ตาม gate ใน spec — ใช้อีเมล throwaway)**

1. เปิด `/admin` → login superadmin → เห็นแท็บ "หน้าแรก" เป็น default การ์ด 4 ใบ + ตารางร้านตรงกับ DB
2. แท็บ "อีเมลที่อนุญาต" → เพิ่ม `zz-beta-test@example.com` → ขึ้นในตาราง ⏳ ยังไม่สมัคร
3. เปิดหน้า `/signup` (โหมดไม่ล็อกอิน) สมัครด้วย `zz-other@example.com` → ต้องเห็น "อีเมลนี้ยังไม่ได้รับสิทธิ์ทดลองใช้ กรุณาติดต่อทีมงาน"
4. สมัครด้วย `zz-beta-test@example.com` → ผ่าน สร้างร้านได้ → กลับไปแท็บ allowlist เห็น ✅ สมัครแล้ว
5. ล็อกอินบัญชีเดิม (เช่นร้าน Nathapat) → เข้าได้ปกติ (ไม่โดน gate)
6. ลบอีเมล/บัญชีทดสอบทิ้ง (ร้าน zz-beta-test ลบผ่านแท็บร้านค้าถ้ามีปุ่ม หรือปล่อยไว้ mark ว่าเป็นร้านทดสอบ)

- [ ] **Step 4: บันทึกผล + ปิดงาน**

แจ้งผู้ใช้: จุดที่ต้องทำเอง = เพิ่มอีเมลลูกค้า beta จริงเข้า allowlist ก่อนแจกลิงก์

---

## Self-Review (ทำแล้ว)

- **Spec coverage:** ตาราง+repo (T1) / บังคับ 2 จุด+ข้อความ login (T2) / overview+การ์ด+ตาราง (T3,T5) / allowlist API+UI (T4,T5) / edge cases อยู่ในเทสต์ T1 + กติกาใน T2 / manual gate (T6) — ครบทุกหัวข้อ spec
- **Placeholders:** ไม่มี TBD/TODO — โค้ดเต็มทุก step
- **Type consistency:** `AllowedEmailRow` (T1) ใช้ใน T4/T5 ตรงกัน; `AdminOverview/ShopOverviewRow` (T3) ใช้ใน T5 ตรงกัน; ชื่อ error message ตรงกันทุกจุดตาม Global Constraints
