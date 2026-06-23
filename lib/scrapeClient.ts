import "server-only";

/**
 * ดึงเนื้อหา + รูปจากหน้าเว็บสินค้า (สำหรับฟีเจอร์ "วางลิงก์ → AI ดึงสินค้า")
 * - ถ้าตั้ง FIRECRAWL_API_KEY → ใช้ Firecrawl (เปิดหน้าเหมือนเบราว์เซอร์ ผ่านระบบกันบอท Lazada/Shopee/TikTok)
 * - ถ้าไม่ตั้ง → fetch ตรงๆ (ใช้ได้กับเว็บทั่วไป แต่มักโดนบล็อกในเว็บ marketplace)
 */

const FIRECRAWL_URL = "https://api.firecrawl.dev/v1/scrape";

export type ScrapeResult = {
  text: string; // เนื้อหาหน้าเว็บ (markdown หรือข้อความล้วน)
  title: string;
  images: string[]; // URL รูปที่เจอ (ตัวแรกมักเป็นรูปหลัก)
};

export function isFirecrawlConfigured(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY);
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** เอาเฉพาะ URL รูปแบบ http(s) ที่ไม่ซ้ำ + จำกัดจำนวน (รองรับหน้ารวมหลายสินค้า) */
function dedupHttp(urls: string[], limit = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const url = u.trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

/** ดึง URL รูปจาก markdown: ![alt](url "title") */
function imagesFromMarkdown(md: string): string[] {
  const urls: string[] = [];
  const re = /!\[[^\]]*\]\(([^)\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) urls.push(m[1]);
  return urls;
}

/** แปลง URL สัมพัทธ์/โปรโตคอลสัมพัทธ์ ให้เป็น URL เต็มเทียบกับหน้าต้นทาง */
function resolveUrl(src: string, base: string): string {
  try {
    return new URL(src.trim(), base).href;
  } catch {
    return "";
  }
}

/** แกะ title/รูป/ข้อความ จาก HTML ดิบ (โหมด fallback) */
function extractFromHtml(
  html: string,
  baseUrl: string,
): { title: string; images: string[]; text: string } {
  const pick = (re: RegExp) => (html.match(re)?.[1] ?? "").trim();
  const title =
    pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<title[^>]*>([^<]*)<\/title>/i);

  const images: string[] = [];
  const og = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og) images.push(resolveUrl(og, baseUrl));
  const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
  let im: RegExpExecArray | null;
  while ((im = imgRe.exec(html)) && images.length < 80) {
    const abs = resolveUrl(im[1], baseUrl);
    if (abs) images.push(abs);
  }

  // เก็บ JSON-LD (มักมีชื่อ/ราคา/รูป แบบ structured) ไว้หน้าข้อความ
  const ld = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? "";

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50000);

  return { title, images, text: (ld ? ld.trim().slice(0, 6000) + "\n\n" : "") + text };
}

export async function scrapeProductPage(url: string): Promise<ScrapeResult> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("ลิงก์ไม่ถูกต้อง (ต้องขึ้นต้นด้วย http:// หรือ https://)");
  }

  // ---- โหมด Firecrawl (แนะนำสำหรับ marketplace) ----
  if (isFirecrawlConfigured()) {
    let res: Response;
    try {
      res = await fetch(FIRECRAWL_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: false }),
      });
    } catch {
      throw new Error("เชื่อมต่อ Firecrawl ไม่สำเร็จ");
    }
    if (!res.ok) {
      throw new Error(`Firecrawl ดึงหน้าไม่สำเร็จ (${res.status})`);
    }
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const data = (json?.data ?? json ?? {}) as Record<string, unknown>;
    const md = asStr(data.markdown);
    const meta = (data.metadata ?? {}) as Record<string, unknown>;
    const title = asStr(meta.title) || asStr(meta.ogTitle);
    const ogRaw = meta.ogImage;
    const ogImg = Array.isArray(ogRaw) ? asStr(ogRaw[0]) : asStr(ogRaw);
    const images = dedupHttp([ogImg, ...imagesFromMarkdown(md)]);
    if (!md.trim() && images.length === 0) {
      throw new Error("หน้านี้ไม่มีข้อมูลให้ดึง");
    }
    return { text: md.slice(0, 60000), title, images };
  }

  // ---- โหมด fallback: fetch ตรง (เว็บทั่วไป) ----
  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) throw new Error(String(res.status));
    html = await res.text();
  } catch {
    throw new Error(
      "โหลดหน้าเว็บไม่สำเร็จ — เว็บนี้อาจกันบอท (Lazada/Shopee/TikTok) ให้ตั้งค่า FIRECRAWL_API_KEY เพื่อดึงได้",
    );
  }
  const { title, images, text } = extractFromHtml(html, url);
  return { text, title, images: dedupHttp(images) };
}
