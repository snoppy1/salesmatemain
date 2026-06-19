import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { getShopData, saveShopData } from "@/lib/shopRepo";
import type { ShopData } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  return NextResponse.json(await getShopData(admin.shopId));
}

export async function PUT(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  let body: ShopData;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const saved = await saveShopData(admin.shopId, {
    shop: {
      name: body?.shop?.name ?? "",
      voice: body?.shop?.voice ?? "",
    },
    rules: Array.isArray(body?.rules) ? body.rules : [],
  });

  return NextResponse.json(saved);
}
