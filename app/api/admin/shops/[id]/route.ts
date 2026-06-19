import { NextResponse } from "next/server";
import { getCurrentSuperadmin } from "@/lib/superAuth";
import { getShopData, saveShopData, shopExists } from "@/lib/shopRepo";
import type { ShopData } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const su = await getCurrentSuperadmin();
  if (!su) {
    return NextResponse.json({ error: "ต้องเป็นผู้ดูแลระบบ" }, { status: 401 });
  }
  const { id } = await params;
  if (!(await shopExists(id))) {
    return NextResponse.json({ error: "ไม่พบร้านนี้" }, { status: 404 });
  }
  return NextResponse.json(await getShopData(id));
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const su = await getCurrentSuperadmin();
  if (!su) {
    return NextResponse.json({ error: "ต้องเป็นผู้ดูแลระบบ" }, { status: 401 });
  }
  const { id } = await params;
  if (!(await shopExists(id))) {
    return NextResponse.json({ error: "ไม่พบร้านนี้" }, { status: 404 });
  }

  let body: ShopData;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const saved = await saveShopData(id, {
    shop: { name: body?.shop?.name ?? "", voice: body?.shop?.voice ?? "" },
    rules: Array.isArray(body?.rules) ? body.rules : [],
  });
  return NextResponse.json(saved);
}
