import { NextResponse } from "next/server";
import { getCurrentSuperadmin } from "@/lib/superAuth";
import { getShopData, saveShopData, shopExists, deleteShop } from "@/lib/shopRepo";
import { listInboxApps } from "@/lib/inboxAppsRepo";
import { getShopConnections } from "@/lib/adminConnectionStatus";
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
  // แนบช่องทางในกล่องแชต + โหมดตอบของแต่ละช่อง + สถานะการเชื่อมต่อรายแพลตฟอร์ม
  // (ให้แอดมินเห็นว่าร้านใช้โหมดไหน + เชื่อมแล้ว/ใกล้หมด/หลุด/ยังไม่เชื่อม)
  const [data, inboxApps, connections] = await Promise.all([
    getShopData(id),
    listInboxApps(id),
    getShopConnections(id),
  ]);
  return NextResponse.json({ ...data, inboxApps, connections });
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
    shop: {
      name: body?.shop?.name ?? "",
      voice: body?.shop?.voice ?? "",
      memory: body?.shop?.memory ?? "",
    },
    rules: Array.isArray(body?.rules) ? body.rules : [],
    products: Array.isArray(body?.products) ? body.products : [],
  });
  return NextResponse.json(saved);
}

export async function DELETE(
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
  await deleteShop(id);
  return NextResponse.json({ ok: true });
}
