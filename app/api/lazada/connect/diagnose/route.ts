import { NextResponse } from "next/server";

export const runtime = "nodejs";

// ตรวจว่าตั้ง env Lazada ครบไหม + ลิงก์ authorize ที่ระบบสร้าง (ปิดบังค่าลับ ไม่โชว์ความลับ)
// หมายเหตุ: เปิดสาธารณะชั่วคราวเพื่อ debug — ไม่มีการเปิดเผยค่าลับ (โชว์แค่มี/ไม่มี + client_id ปิดบัง)
function mask(v: string): string {
  if (!v) return "❌ ไม่ได้ตั้ง";
  if (v.length <= 6) return `✅ ตั้งแล้ว (${v.length} ตัว)`;
  return `✅ ${v.slice(0, 3)}…${v.slice(-2)} (${v.length} ตัว)`;
}

function originOf(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function GET(request: Request) {
  const origin = originOf(request);
  const appKey = process.env.LAZADA_APP_KEY ?? "";
  const appSecret = process.env.LAZADA_APP_SECRET ?? "";
  const imKey = process.env.LAZADA_IM_APP_KEY ?? "";
  const imSecret = process.env.LAZADA_IM_APP_SECRET ?? "";
  const chatSecret = process.env.LAZADA_CHAT_SECRET ?? "";

  const effKey = imKey || appKey; // คีย์ที่ใช้จริงตอนกด "เชื่อม Lazada (แชต)"
  const callback = `${origin}/api/connect/lazada/callback`;
  const authUrl =
    `https://auth.lazada.com/oauth/authorize?response_type=code&force_auth=true` +
    `&redirect_uri=${encodeURIComponent(callback)}` +
    `&client_id=${encodeURIComponent(effKey)}&state=imchat`;

  return NextResponse.json(
    {
      สรุป: effKey
        ? "client_id มีค่าแล้ว ✅ — ถ้ายัง error ให้เช็คว่า redirect_uri ด้านล่างตรงกับที่ตั้งใน Lazada console ไหม"
        : "❌ client_id ว่าง! ยังไม่ได้ตั้ง LAZADA_IM_APP_KEY หรือ LAZADA_APP_KEY ใน Vercel — นี่แหละสาเหตุ 'Missing parameter'",
      env: {
        LAZADA_APP_KEY: mask(appKey),
        LAZADA_APP_SECRET: appSecret ? "✅ ตั้งแล้ว" : "❌ ไม่ได้ตั้ง",
        LAZADA_IM_APP_KEY: mask(imKey),
        LAZADA_IM_APP_SECRET: imSecret ? "✅ ตั้งแล้ว" : "❌ ไม่ได้ตั้ง",
        LAZADA_CHAT_SECRET: chatSecret ? "✅ ตั้งแล้ว" : "❌ ไม่ได้ตั้ง (จำเป็นตอนรับข้อความ)",
      },
      client_id_ที่ใช้เชื่อมแชต: effKey ? mask(effKey) : "(ว่าง — ปัญหาอยู่ตรงนี้)",
      appKey_ดึงข้อมูล_เทียบ_imKey_แชต:
        appKey && imKey
          ? appKey === imKey
            ? "✅ เป็นแอปเดียวกัน (สิทธิ์ที่ apply บนแอปนี้ใช้ได้ทั้งแชต+ดึงข้อมูล)"
            : "⚠️ คนละแอป! ต้อง apply สิทธิ์ Product/Order บนแอปของ LAZADA_APP_KEY ด้วย"
          : "(ตั้งคีย์ไม่ครบ)",
      redirect_uri_ต้องตั้งใน_lazada_console: callback,
      ลิงก์authที่ระบบสร้าง: authUrl,
    },
    { headers: { "content-type": "application/json; charset=utf-8" } },
  );
}
