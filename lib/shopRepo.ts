import "server-only";
import { query, queryOne, withTx } from "./db";
import { newId } from "./auth";
import { sourceList, unifyStock } from "./stock";
import { embedDocuments, embeddingsEnabled } from "./embeddings";
import type {
  Product,
  Rule,
  ShopData,
  ShopSummary,
  MockSettings,
  AutoLevel,
} from "./types";

type RuleRow = {
  id: string;
  trigger: string;
  partner: string;
  price: string;
  reason: string;
  promo: string;
  enabled: boolean;
};

type ProductRow = {
  id: string;
  name: string;
  description: string;
  price: string;
  image_url: string | null;
  source: string | null;
  external_id: string | null;
  enabled: boolean;
  stock: number | null;
  stock_by_platform: Record<string, number> | null;
};

/** รายชื่อร้านทั้งหมด (สำหรับ superadmin เลือกดู) */
export async function listAllShops(): Promise<ShopSummary[]> {
  const rows = await query<{
    id: string;
    name: string;
    createdat: string;
    username: string | null;
    rulecount: string;
  }>(
    `SELECT s.id            AS id,
            s.name          AS name,
            s.created_at    AS createdat,
            MIN(a.username) AS username,
            (SELECT COUNT(*) FROM rules r WHERE r.shop_id = s.id) AS rulecount
     FROM shops s
     LEFT JOIN admins a ON a.shop_id = s.id
     GROUP BY s.id, s.name, s.created_at
     ORDER BY s.created_at ASC`,
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    username: r.username ?? "(ไม่มีแอดมิน)",
    ruleCount: Number(r.rulecount),
    createdAt: Number(r.createdat),
  }));
}

/** มีร้านนี้จริงไหม (กันแก้ id มั่ว) */
export async function shopExists(shopId: string): Promise<boolean> {
  const row = await queryOne("SELECT 1 AS ok FROM shops WHERE id = $1", [shopId]);
  return Boolean(row);
}

/** ค่าเริ่มต้น auto-reply ของร้าน (LINE เฟส 2) */
export async function getAutoReply(shopId: string): Promise<boolean> {
  const row = await queryOne<{ auto_reply: boolean }>(
    "SELECT auto_reply FROM shops WHERE id = $1",
    [shopId],
  );
  return Boolean(row?.auto_reply);
}

export async function setAutoReply(shopId: string, value: boolean): Promise<void> {
  await query("UPDATE shops SET auto_reply = $1 WHERE id = $2", [value, shopId]);
}

/** ระดับการตอบ AI ของร้าน — ไม่เคยตั้ง → อนุมานจาก auto_reply เดิม (true=safe, false=off) */
export async function getAutoLevel(shopId: string): Promise<AutoLevel> {
  const row = await queryOne<{ auto_level: string | null; auto_reply: boolean }>(
    "SELECT auto_level, auto_reply FROM shops WHERE id = $1",
    [shopId],
  );
  const lvl = row?.auto_level;
  if (lvl === "off" || lvl === "safe" || lvl === "full") return lvl;
  // ค่าเก่า "night" (เลิกใช้) หรือยังไม่ตั้ง → อนุมานจาก auto_reply (เปิดอยู่ = ปลอดภัย)
  return row?.auto_reply ? "safe" : "off";
}

/** ตั้งระดับการตอบ AI + อัปเดต auto_reply ให้สอดคล้อง (off=ปิด, อื่นๆ=เปิด) */
export async function setAutoLevel(shopId: string, level: AutoLevel): Promise<void> {
  await query("UPDATE shops SET auto_level = $1, auto_reply = $2 WHERE id = $3", [
    level,
    level !== "off",
    shopId,
  ]);
}

/** ตั้งค่า "ข้อมูลทดลอง (mock)" แยกต่อแพลตฟอร์ม — {} = ค่าเริ่มต้นเปิดทั้งหมด */
export async function getMockSettings(shopId: string): Promise<MockSettings> {
  const row = await queryOne<{ mock_settings: MockSettings | null }>(
    "SELECT mock_settings FROM shops WHERE id = $1",
    [shopId],
  );
  return row?.mock_settings ?? {};
}

export async function setMockSettings(
  shopId: string,
  settings: MockSettings,
): Promise<void> {
  await query("UPDATE shops SET mock_settings = $1 WHERE id = $2", [
    JSON.stringify(settings ?? {}),
    shopId,
  ]);
}

/** เปิด mock ของหมวดนี้อยู่ไหม (ไม่มีค่า = ปิด โดยปริยาย → ระบบเป็น "ของจริงก่อน") */
export function isMockEnabled(
  settings: MockSettings,
  platform: string,
  kind: "chat" | "catalog",
): boolean {
  return settings[platform]?.[kind] === true;
}

export async function getShopData(shopId: string): Promise<ShopData> {
  const shop = await queryOne<{ name: string; voice: string; ai_memory: string }>(
    "SELECT name, voice, ai_memory FROM shops WHERE id = $1",
    [shopId],
  );

  const ruleRows = await query<RuleRow>(
    `SELECT id, "trigger", partner, price, reason, promo, enabled
     FROM rules WHERE shop_id = $1 ORDER BY sort_order ASC`,
    [shopId],
  );

  const productRows = await query<ProductRow>(
    `SELECT id, name, description, price, image_url, source, external_id, enabled,
            stock, stock_by_platform
     FROM products WHERE shop_id = $1 ORDER BY sort_order ASC`,
    [shopId],
  );

  return {
    shop: {
      name: shop?.name ?? "",
      voice: shop?.voice ?? "",
      memory: shop?.ai_memory ?? "",
    },
    rules: ruleRows.map((r) => ({
      id: r.id,
      trigger: r.trigger,
      partner: r.partner,
      price: r.price,
      reason: r.reason,
      promo: r.promo,
      enabled: r.enabled,
    })),
    products: productRows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price,
      image: p.image_url ?? undefined,
      source: p.source ?? undefined,
      externalId: p.external_id ?? undefined,
      enabled: p.enabled,
      stock: p.stock ?? undefined,
      stockByPlatform: p.stock_by_platform ?? undefined,
    })),
  };
}

/** โหลดเวกเตอร์ความหมายของสินค้าตาม id (เฉพาะที่มี embedding) — ใช้ตอนตอบแชตทำ hybrid retrieval */
export async function loadEmbeddingsByIds(
  ids: string[],
): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  if (!ids.length) return map;
  const rows = await query<{ id: string; embedding: number[] | null }>(
    "SELECT id, embedding FROM products WHERE id = ANY($1) AND embedding IS NOT NULL",
    [ids],
  );
  for (const r of rows) if (Array.isArray(r.embedding)) map.set(r.id, r.embedding);
  return map;
}

/** ร้านที่มีแชตเคลื่อนไหวตั้งแต่ since (ms) — ใช้ pre-warm เฉพาะร้านที่ใช้งานจริง */
export async function listActiveShopIds(since: number): Promise<string[]> {
  const rows = await query<{ shop_id: string }>(
    "SELECT DISTINCT shop_id FROM conversations WHERE last_message_at > $1",
    [since],
  );
  return rows.map((r) => r.shop_id);
}

/** บันทึกชื่อ/โทนร้าน + แทนที่รายการคู่พ่วงทั้งหมด (ทำใน transaction) */
export async function saveShopData(shopId: string, data: ShopData): Promise<ShopData> {
  const clean = (r: Partial<Rule>): RuleRow => ({
    id: typeof r.id === "string" && r.id ? r.id : newId(),
    trigger: (r.trigger ?? "").toString(),
    partner: (r.partner ?? "").toString(),
    price: (r.price ?? "").toString(),
    reason: (r.reason ?? "").toString(),
    promo: (r.promo ?? "").toString(),
    enabled: r.enabled !== false, // default true
  });

  const cleanStockMap = (m?: Record<string, number>): Record<string, number> | null => {
    if (!m || typeof m !== "object") return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(m)) {
      if (Number.isFinite(Number(v))) out[k] = Number(v);
    }
    return Object.keys(out).length ? out : null;
  };

  const cleanProduct = (p: Partial<Product>): ProductRow => ({
    id: typeof p.id === "string" && p.id ? p.id : newId(),
    name: (p.name ?? "").toString(),
    description: (p.description ?? "").toString(),
    price: (p.price ?? "").toString(),
    image_url: p.image ? p.image.toString() : null,
    source: p.source ? p.source.toString() : null,
    external_id: p.externalId ? p.externalId.toString() : null,
    enabled: p.enabled !== false, // default true
    stock: p.stock != null && Number.isFinite(Number(p.stock)) ? Number(p.stock) : null,
    stock_by_platform: cleanStockMap(p.stockByPlatform),
  });

  const rules = Array.isArray(data.rules) ? data.rules.map(clean) : [];
  const products = Array.isArray(data.products)
    ? data.products.map(cleanProduct)
    : [];

  // embedding: DELETE+INSERT ทำให้ vector เดิมหาย → เก็บไว้โดยจับคู่ด้วยเนื้อหา (name+desc)
  // ตัวที่เนื้อหาเปลี่ยน/เพิ่มใหม่ค่อย embed ใหม่ (best-effort; พลาด = null → retrieval fallback keyword)
  const embForProduct: (number[] | null)[] = products.map(() => null);
  if (embeddingsEnabled() && products.length) {
    const sigOf = (n: string, d: string) => `${n}\n${d}`;
    const oldRows = await query<{ name: string; description: string; embedding: number[] | null }>(
      "SELECT name, COALESCE(description,'') AS description, embedding FROM products WHERE shop_id = $1 AND embedding IS NOT NULL",
      [shopId],
    );
    const oldEmb = new Map<string, number[]>();
    for (const r of oldRows) if (Array.isArray(r.embedding)) oldEmb.set(sigOf(r.name, r.description), r.embedding);
    products.forEach((p, i) => { embForProduct[i] = oldEmb.get(sigOf(p.name, p.description)) ?? null; });
    const todo = products.map((_, i) => i).filter((i) => !embForProduct[i]);
    if (todo.length) {
      const vecs = await embedDocuments(todo.map((i) => `${products[i].name}. ${products[i].description}`.trim()));
      todo.forEach((i, k) => { if (vecs[k]) embForProduct[i] = vecs[k]; });
    }
  }

  await withTx(async (client) => {
    // memory: undefined = ผู้เรียกไม่ได้ส่งมา → คงค่าเดิม (COALESCE); "" = ตั้งใจล้างค่า
    const memoryParam =
      data.shop?.memory === undefined ? null : data.shop.memory.toString();
    await client.query(
      "UPDATE shops SET name = $1, voice = $2, ai_memory = COALESCE($4, ai_memory) WHERE id = $3",
      [
        (data.shop?.name ?? "").toString(),
        (data.shop?.voice ?? "").toString(),
        shopId,
        memoryParam,
      ],
    );
    await client.query("DELETE FROM rules WHERE shop_id = $1", [shopId]);
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      await client.query(
        `INSERT INTO rules (id, shop_id, "trigger", partner, price, reason, promo, enabled, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [r.id, shopId, r.trigger, r.partner, r.price, r.reason, r.promo, r.enabled, i],
      );
    }
    await client.query("DELETE FROM products WHERE shop_id = $1", [shopId]);
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      await client.query(
        `INSERT INTO products (id, shop_id, name, description, price, image_url, source, external_id, enabled, stock, stock_by_platform, sort_order, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
        [
          p.id, shopId, p.name, p.description, p.price, p.image_url, p.source,
          p.external_id, p.enabled, p.stock,
          p.stock_by_platform ? JSON.stringify(p.stock_by_platform) : null,
          i,
          embForProduct[i] ? JSON.stringify(embForProduct[i]) : null,
        ],
      );
    }
  });

  return getShopData(shopId);
}

/**
 * อัปเดตสต็อก/ราคาของสินค้าจาก marketplace แบบเจาะจง (สำหรับระบบซิงค์) — จับคู่ด้วยชื่อ
 * - เจอสินค้าเดิม (มาจาก marketplace) → อัปเดต stock รายเจ้า + ราคา + ผนวก source
 * - เพิ่มเอง (ไม่มี source) → ไม่แตะ
 * - สินค้าใหม่ที่ยังไม่มี → เพิ่มเข้าคลัง
 * - สินค้าเดิมที่หายไปจาก marketplace → คงไว้ (ไม่ลบเอง)
 */
export async function syncProductsStock(
  shopId: string,
  platform: string,
  items: {
    name: string;
    price: string;
    description: string;
    image?: string;
    externalId: string;
    stock?: number;
  }[],
): Promise<{ updated: number; added: number }> {
  const rows = await query<{
    id: string;
    name: string;
    source: string | null;
    stock_by_platform: Record<string, number> | null;
  }>(
    "SELECT id, name, source, stock_by_platform FROM products WHERE shop_id = $1",
    [shopId],
  );
  const norm = (s: string) => s.trim().toLowerCase();
  const maxRow = await queryOne<{ m: number }>(
    "SELECT COALESCE(MAX(sort_order), -1)::int AS m FROM products WHERE shop_id = $1",
    [shopId],
  );
  let nextOrder = (maxRow?.m ?? -1) + 1;
  let updated = 0;
  let added = 0;

  for (const it of items) {
    if (!it.name.trim()) continue;
    const match = rows.find((r) => norm(r.name) === norm(it.name));
    if (match) {
      const srcs = sourceList(match.source ?? undefined);
      if (srcs.length === 0) continue; // เพิ่มเอง → ไม่แตะ
      const sbp = { ...(match.stock_by_platform ?? {}) };
      if (it.stock != null) sbp[platform] = Number(it.stock);
      const source = srcs.includes(platform)
        ? match.source
        : [...srcs, platform].join(",");
      await query(
        "UPDATE products SET stock = $1, stock_by_platform = $2, price = $3, source = $4 WHERE id = $5",
        [
          unifyStock(sbp) ?? null,
          Object.keys(sbp).length ? JSON.stringify(sbp) : null,
          it.price,
          source,
          match.id,
        ],
      );
      updated++;
    } else {
      const sbp = it.stock != null ? { [platform]: Number(it.stock) } : null;
      // embed สินค้าใหม่ (best-effort; พลาด/ติด rate limit = null → retrieval fallback keyword)
      const emb = embeddingsEnabled()
        ? (await embedDocuments([`${it.name}. ${it.description}`.trim()]))[0]
        : null;
      await query(
        `INSERT INTO products (id, shop_id, name, description, price, image_url, source, external_id, enabled, stock, stock_by_platform, sort_order, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12::jsonb)`,
        [
          newId(),
          shopId,
          it.name,
          it.description,
          it.price,
          it.image ?? null,
          platform,
          it.externalId,
          sbp ? (unifyStock(sbp) ?? null) : null,
          sbp ? JSON.stringify(sbp) : null,
          nextOrder++,
          emb ? JSON.stringify(emb) : null,
        ],
      );
      added++;
    }
  }
  return { updated, added };
}
