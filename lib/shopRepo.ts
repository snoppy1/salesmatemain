import "server-only";
import { query, queryOne, withTx } from "./db";
import { newId } from "./auth";
import type { Rule, ShopData, ShopSummary } from "./types";

type RuleRow = {
  id: string;
  trigger: string;
  partner: string;
  price: string;
  reason: string;
  promo: string;
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

export async function getShopData(shopId: string): Promise<ShopData> {
  const shop = await queryOne<{ name: string; voice: string }>(
    "SELECT name, voice FROM shops WHERE id = $1",
    [shopId],
  );

  const ruleRows = await query<RuleRow>(
    `SELECT id, "trigger", partner, price, reason, promo
     FROM rules WHERE shop_id = $1 ORDER BY sort_order ASC`,
    [shopId],
  );

  return {
    shop: { name: shop?.name ?? "", voice: shop?.voice ?? "" },
    rules: ruleRows,
  };
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
  });

  const rules = Array.isArray(data.rules) ? data.rules.map(clean) : [];

  await withTx(async (client) => {
    await client.query("UPDATE shops SET name = $1, voice = $2 WHERE id = $3", [
      (data.shop?.name ?? "").toString(),
      (data.shop?.voice ?? "").toString(),
      shopId,
    ]);
    await client.query("DELETE FROM rules WHERE shop_id = $1", [shopId]);
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      await client.query(
        `INSERT INTO rules (id, shop_id, "trigger", partner, price, reason, promo, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [r.id, shopId, r.trigger, r.partner, r.price, r.reason, r.promo, i],
      );
    }
  });

  return getShopData(shopId);
}
