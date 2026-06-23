import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getMockSettings, setMockSettings } from "@/lib/shopRepo";
import type { MockSettings } from "@/lib/types";

export const runtime = "nodejs";

const PLATFORMS = ["line", "facebook", "tiktok", "lazada", "shopee"];

// แปลง input ให้สะอาด (กันค่าแปลกปลอม) — เก็บเฉพาะแพลตฟอร์มที่รู้จัก + เป็น boolean
function clean(input: unknown): MockSettings {
  const out: MockSettings = {};
  if (input && typeof input === "object") {
    for (const p of PLATFORMS) {
      const v = (input as Record<string, unknown>)[p];
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        out[p] = {
          chat: o.chat === true,
          catalog: o.catalog === true,
        };
      }
    }
  }
  return out;
}

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  return NextResponse.json({ settings: await getMockSettings(admin.shopId) });
}

export async function PUT(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  let body: { settings?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const settings = clean(body.settings);
  await setMockSettings(admin.shopId, settings);
  return NextResponse.json({ settings });
}
