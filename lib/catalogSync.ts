import "server-only";
import { getValidAccessToken, getStatus } from "./connectionRepo";
import { getMockSettings, isMockEnabled, syncProductsStock } from "./shopRepo";
import { fetchCatalog as lzFetch, withVariantNote, type CatalogItem } from "./marketplace";
import { fetchCatalog as spFetch } from "./shopee";
import { fetchCatalog as ttFetch } from "./tiktok";

const PLATFORMS = ["lazada", "shopee", "tiktok"] as const;

async function fetchFor(
  platform: string,
  token: string,
  sellerId: string,
): Promise<CatalogItem[]> {
  if (platform === "shopee") return spFetch(token, sellerId);
  if (platform === "tiktok") return ttFetch(token, sellerId);
  return lzFetch(token);
}

export type SyncResult = { platform: string; updated: number; added: number };

/**
 * ซิงค์สินค้า+สต็อกล่าสุดจากทุก marketplace ที่ร้านเชื่อมไว้ → อัปเดตลง DB
 * - ข้ามเจ้าที่ยังไม่เชื่อม
 * - ข้ามเจ้าที่เป็น mock แต่ปิดสวิตช์ "ข้อมูลทดลองสินค้า" ไว้
 * ใช้ได้ทั้ง mock และของจริง และเป็นฐานให้ webhook push / ตัดสต็อก ต่อยอด
 */
export async function syncAllPlatforms(shopId: string): Promise<SyncResult[]> {
  const mock = await getMockSettings(shopId);
  const out: SyncResult[] = [];
  for (const platform of PLATFORMS) {
    const token = await getValidAccessToken(shopId, platform);
    if (!token) continue; // ยังไม่เชื่อม
    if (token.startsWith("mock-") && !isMockEnabled(mock, platform, "catalog")) {
      continue; // mock แต่ปิดข้อมูลทดลองสินค้า
    }
    let items: CatalogItem[];
    try {
      const status = await getStatus(shopId, platform);
      items = await fetchFor(platform, token, status.sellerId ?? "");
    } catch {
      continue;
    }
    // สินค้าใหม่ที่ sync เพิ่มเอง ใช้ description ดิบ (ไม่ผ่านตัวย่อ) → ต่อท้ายตัวเลือกสี/แบบตรงนี้
    // (สินค้าที่มีอยู่แล้ว sync ไม่แตะ description — ตัวเลือกจะติดมาตอนร้าน import ใหม่)
    const res = await syncProductsStock(
      shopId,
      platform,
      items.map((it) => ({ ...it, description: withVariantNote(it.description, it.variantOptions) })),
    );
    out.push({ platform, ...res });
  }
  return out;
}
