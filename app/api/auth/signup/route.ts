import { NextResponse } from "next/server";
import { queryOne, withTx } from "@/lib/db";
import {
  hashPassword,
  createSession,
  setSessionCookie,
  newId,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { shopName?: string; username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const shopName = (body.shopName ?? "").trim();
  const username = (body.username ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!shopName) {
    return NextResponse.json({ error: "กรุณาใส่ชื่อร้าน" }, { status: 400 });
  }
  if (username.length < 3) {
    return NextResponse.json(
      { error: "ชื่อผู้ใช้ต้องยาวอย่างน้อย 3 ตัวอักษร" },
      { status: 400 },
    );
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร" },
      { status: 400 },
    );
  }

  const exists = await queryOne("SELECT 1 AS ok FROM admins WHERE username = $1", [
    username,
  ]);
  if (exists) {
    return NextResponse.json(
      { error: "ชื่อผู้ใช้นี้ถูกใช้แล้ว ลองชื่ออื่น" },
      { status: 409 },
    );
  }

  const shopId = newId();
  const adminId = newId();
  const now = Date.now();

  await withTx(async (client) => {
    await client.query(
      "INSERT INTO shops (id, name, voice, created_at) VALUES ($1, $2, '', $3)",
      [shopId, shopName, now],
    );
    await client.query(
      "INSERT INTO admins (id, shop_id, username, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)",
      [adminId, shopId, username, hashPassword(password), now],
    );
  });

  const { token, expiresAt } = await createSession(adminId);
  await setSessionCookie(token, expiresAt);

  return NextResponse.json({ username, shopName });
}
