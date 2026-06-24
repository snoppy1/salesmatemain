// ชั่วคราวสำหรับ debug Vercel Blob — ลบไฟล์นี้ออกหลังแก้ปัญหาเสร็จ
import { NextResponse } from "next/server";
import { isBlobConfigured, putImage, delBlobs } from "@/lib/blobStore";

export const runtime = "nodejs";

const DIAG_KEY = "diag-7f3a9c2e8b1d4056";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== DIAG_KEY) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const configured = isBlobConfigured();
  let putOk = false;
  let blobUrl: string | null = null;
  let error: string | null = null;

  if (configured) {
    try {
      // 1x1 px PNG
      const buf = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      );
      const up = await putImage(buf, "image/png");
      putOk = true;
      blobUrl = up.url;
      await delBlobs([up.key]);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json({ configured, putOk, blobUrl, error });
}
