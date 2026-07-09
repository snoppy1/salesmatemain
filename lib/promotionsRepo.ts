import "server-only";
import { query, withTx } from "./db";
import { newId } from "./auth";
import type { Promotion } from "./types";

type Row = {
  id: string;
  title: string;
  type: string;
  conditions_text: string;
  min_spend: number | null;
  product_scope: string;
  code: string;
  starts_at: string | null;
  ends_at: string | null;
  source: string;
};

function toPromotion(r: Row): Promotion {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    conditionsText: r.conditions_text,
    minSpend: r.min_spend != null ? Number(r.min_spend) : null,
    productScope: r.product_scope,
    code: r.code,
    startsAt: r.starts_at != null ? Number(r.starts_at) : null,
    endsAt: r.ends_at != null ? Number(r.ends_at) : null,
    source: r.source,
  };
}

export async function listPromotions(shopId: string): Promise<Promotion[]> {
  const rows = await query<Row>(
    `SELECT id, title, type, conditions_text, min_spend, product_scope, code,
            starts_at, ends_at, source
       FROM promotions WHERE shop_id = $1 ORDER BY synced_at DESC, id`,
    [shopId],
  );
  return rows.map(toPromotion);
}

/** แทนที่โปรทั้งหมดของร้านด้วยชุดล่าสุด (sync) — ทำใน transaction */
export async function replacePromotions(shopId: string, promos: Promotion[]): Promise<void> {
  const now = Date.now();
  await withTx(async (client) => {
    await client.query("DELETE FROM promotions WHERE shop_id = $1", [shopId]);
    for (const p of promos) {
      await client.query(
        `INSERT INTO promotions
           (id, shop_id, title, type, conditions_text, min_spend, product_scope, code, starts_at, ends_at, source, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [newId(), shopId, p.title, p.type, p.conditionsText, p.minSpend, p.productScope, p.code, p.startsAt, p.endsAt, p.source, now],
      );
    }
  });
}
