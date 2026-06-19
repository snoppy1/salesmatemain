import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SUPER_COOKIE,
  destroySuperSession,
  clearSuperCookie,
} from "@/lib/superAuth";

export const runtime = "nodejs";

export async function POST() {
  const store = await cookies();
  const token = store.get(SUPER_COOKIE)?.value;
  if (token) await destroySuperSession(token);
  await clearSuperCookie();
  return NextResponse.json({ ok: true });
}
