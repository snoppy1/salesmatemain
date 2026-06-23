import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { exchangeCode } from "@/lib/marketplace";
import { saveConnection } from "@/lib/connectionRepo";
import { exchangeImCode, fetchAccountInfo } from "@/lib/lazadaChatClient";
import { saveChannel } from "@/lib/lazadaChannelRepo";

export const runtime = "nodejs";

function originOf(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// ปลายทาง OAuth: รับ code → แลก token → บันทึก connection → กลับหน้าแอป
export async function GET(request: Request) {
  const origin = originOf(request);
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.redirect(new URL("/login", origin));

  const sp = new URL(request.url).searchParams;
  const code = sp.get("code") ?? "";
  const state = sp.get("state") ?? "";
  if (!code) {
    return NextResponse.redirect(new URL("/?connect=error", origin));
  }

  // ฝั่งแชต (IM): แลก code ด้วยคีย์แอปแชต → เก็บเป็น channel แชต Lazada
  if (state === "imchat") {
    try {
      const t = await exchangeImCode(code);
      if (!t.ok) return NextResponse.redirect(new URL("/?connect=error", origin));
      let accountId = t.accountId;
      let name = t.name;
      if (!accountId) {
        const info = await fetchAccountInfo(t.accessToken);
        if (info) {
          accountId = info.accountId;
          name = info.name;
        }
      }
      if (!accountId) return NextResponse.redirect(new URL("/?connect=error", origin));
      await saveChannel(admin.shopId, {
        accountId,
        accessToken: t.accessToken,
        accountName: name,
      });
      return NextResponse.redirect(new URL("/?connected=lazada-chat", origin));
    } catch {
      return NextResponse.redirect(new URL("/?connect=error", origin));
    }
  }

  // ฝั่งดึงสินค้า (catalog)
  try {
    const tokens = await exchangeCode(code);
    await saveConnection(admin.shopId, "lazada", tokens);
    return NextResponse.redirect(new URL("/?connected=lazada", origin));
  } catch {
    return NextResponse.redirect(new URL("/?connect=error", origin));
  }
}
