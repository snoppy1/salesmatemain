import { NextResponse } from "next/server";
import type { GenerateRequest } from "@/lib/types";
import { getCurrentAdmin } from "@/lib/auth";
import { generateUpsell, ClaudeError } from "@/lib/claude";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  let body: GenerateRequest;
  try {
    body = (await request.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  if (!body?.customerMsg?.trim()) {
    return NextResponse.json(
      { error: "กรุณาใส่ข้อความล่าสุดของลูกค้า" },
      { status: 400 },
    );
  }

  try {
    const parsed = await generateUpsell({
      shopName: body.shopName ?? "",
      shopVoice: body.shopVoice ?? "",
      rules: Array.isArray(body.rules) ? body.rules : [],
      products: Array.isArray(body.products) ? body.products : [],
      customerMsg: body.customerMsg ?? "",
    });
    return NextResponse.json(parsed);
  } catch (e) {
    const err = e as ClaudeError;
    return NextResponse.json(
      { error: err.message || "เจนไม่สำเร็จ" },
      { status: err.status || 502 },
    );
  }
}
