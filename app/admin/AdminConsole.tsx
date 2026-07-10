"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Product, Rule, Shop, ShopData, ShopSummary } from "@/lib/types";
import ThemeToggle from "@/components/ThemeToggle";
import HomeTab from "./HomeTab";
import AllowlistTab from "./AllowlistTab";
import StatusTab from "./StatusTab";
import ModelUsageTab from "./ModelUsageTab";
import UpsellDailyTab from "./UpsellDailyTab";

function genId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function newRule(): Rule {
  return { id: genId(), trigger: "", partner: "", price: "", reason: "", promo: "" };
}

function newProduct(): Product {
  return { id: genId(), name: "", description: "", price: "" };
}

type LoadState =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

type SaveState = "idle" | "saving" | "saved" | "error";

export default function AdminConsole({
  username,
  shops,
}: {
  username: string;
  shops: ShopSummary[];
}) {
  const router = useRouter();

  const [list, setList] = useState<ShopSummary[]>(shops);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [load, setLoad] = useState<LoadState>({ kind: "none" });
  const [shop, setShop] = useState<Shop>({ name: "", voice: "", memory: "" });
  const [rules, setRules] = useState<Rule[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [save, setSave] = useState<SaveState>("idle");
  const [tab, setTab] = useState<
    "home" | "shops" | "allowlist" | "status" | "models" | "sales"
  >("home");

  const selected = list.find((s) => s.id === selectedId) ?? null;

  async function selectShop(id: string) {
    setSelectedId(id);
    setSave("idle");
    setLoad({ kind: "loading" });
    try {
      const res = await fetch(`/api/admin/shops/${id}`);
      if (!res.ok) {
        setLoad({ kind: "error", message: "โหลดข้อมูลร้านไม่สำเร็จ" });
        return;
      }
      const data = (await res.json()) as ShopData;
      setShop(data.shop);
      setRules(data.rules ?? []);
      setProducts(data.products ?? []);
      setLoad({ kind: "ready" });
    } catch {
      setLoad({ kind: "error", message: "โหลดข้อมูลร้านไม่สำเร็จ" });
    }
  }

  function markDirty() {
    setSave((s) => (s === "saving" ? s : "idle"));
  }

  // ลบร้านถาวร (DB CASCADE ทุกตารางลูก + ลบรูป Blob) — เรียกจากโซนอันตรายหลังพิมพ์ชื่อยืนยัน
  async function handleDeleteShop(): Promise<boolean> {
    if (!selectedId) return false;
    try {
      const res = await fetch(`/api/admin/shops/${selectedId}`, { method: "DELETE" });
      if (!res.ok) return false;
      setList((prev) => prev.filter((s) => s.id !== selectedId));
      setSelectedId(null);
      setLoad({ kind: "none" });
      return true;
    } catch {
      return false;
    }
  }

  async function handleSave() {
    if (!selectedId || save === "saving") return;
    setSave("saving");
    try {
      const res = await fetch(`/api/admin/shops/${selectedId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shop, rules, products } satisfies ShopData),
      });
      if (!res.ok) {
        setSave("error");
        return;
      }
      const data = (await res.json()) as ShopData;
      setShop(data.shop);
      setRules(data.rules ?? []);
      setProducts(data.products ?? []);
      setSave("saved");
      // อัปเดตชื่อ/จำนวนคู่พ่วงในลิสต์ซ้าย
      setList((prev) =>
        prev.map((s) =>
          s.id === selectedId
            ? { ...s, name: data.shop.name, ruleCount: (data.rules ?? []).length }
            : s,
        ),
      );
    } catch {
      setSave("error");
    }
  }

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-fg">SalesMate</h1>
            <span className="rounded-full bg-surface2 px-2 py-0.5 text-xs font-semibold text-muted">
              ผู้ดูแลระบบ
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            ดู/แก้ข้อมูลได้ทุกร้าน — เพื่อการคุมระบบเท่านั้น
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm">
          <span className="hidden text-muted sm:inline">@{username}</span>
          <ThemeToggle />
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 font-medium text-fg transition hover:bg-surface2"
          >
            ออกจากระบบ
          </button>
        </div>
      </header>

      <nav className="mb-6 flex gap-2">
        {(
          [
            ["home", "หน้าแรก"],
            ["shops", "ร้านค้า"],
            ["allowlist", "อีเมลที่อนุญาต"],
            ["status", "สถานะระบบ"],
            ["models", "โมเดล AI"],
            ["sales", "ยอดขาย AI"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === key
                ? "bg-fg text-surface"
                : "border border-line bg-surface text-muted hover:bg-surface2"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "home" && (
        <HomeTab
          onOpenShop={(id) => {
            setTab("shops");
            void selectShop(id);
          }}
        />
      )}

      {tab === "allowlist" && <AllowlistTab />}

      {tab === "status" && <StatusTab />}

      {tab === "models" && <ModelUsageTab />}

      {tab === "sales" && <UpsellDailyTab />}

      {tab === "shops" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_1fr]">
          {/* รายชื่อร้าน */}
          <aside className="rounded-2xl border border-line bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-fg">
                ร้านทั้งหมด ({list.length})
              </h2>
              <button
                type="button"
                onClick={() => router.refresh()}
                className="text-xs font-medium text-accent hover:underline"
              >
                รีเฟรช
              </button>
            </div>

            {list.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line bg-surface2 px-3 py-6 text-center text-sm text-muted">
                ยังไม่มีร้านในระบบ
              </p>
            ) : (
              <ul className="space-y-1.5">
                {list.map((s) => {
                  const active = s.id === selectedId;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => selectShop(s.id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                          active
                            ? "border-accent/50 bg-accent/12"
                            : "border-line bg-surface hover:bg-surface2"
                        }`}
                      >
                        <div className="truncate text-sm font-semibold text-fg">
                          {s.name || "(ยังไม่ตั้งชื่อร้าน)"}
                        </div>
                        <div className="mt-0.5 flex items-center justify-between text-xs text-muted">
                          <span className="truncate">@{s.username}</span>
                          <span className="shrink-0">{s.ruleCount} คู่พ่วง</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* ตัวแก้ไขร้านที่เลือก */}
          <section className="rounded-2xl border border-line bg-surface p-5">
            {!selected ? (
              <div className="flex min-h-[12rem] items-center justify-center text-sm text-muted">
                เลือกร้านจากรายการด้านซ้ายเพื่อดู/แก้ข้อมูล
              </div>
            ) : load.kind === "loading" ? (
              <div className="flex min-h-[12rem] items-center justify-center text-sm text-muted">
                กำลังโหลดข้อมูลร้าน…
              </div>
            ) : load.kind === "error" ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {load.message}
              </div>
            ) : (
              <ShopEditor
                selected={selected}
                shop={shop}
                setShop={(patch) => {
                  setShop((s) => ({ ...s, ...patch }));
                  markDirty();
                }}
                rules={rules}
                addRule={() => {
                  setRules((p) => [...p, newRule()]);
                  markDirty();
                }}
                updateRule={(id, patch) => {
                  setRules((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));
                  markDirty();
                }}
                removeRule={(id) => {
                  setRules((p) => p.filter((r) => r.id !== id));
                  markDirty();
                }}
                products={products}
                addProduct={() => {
                  setProducts((p) => [...p, newProduct()]);
                  markDirty();
                }}
                updateProduct={(id, patch) => {
                  setProducts((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
                  markDirty();
                }}
                removeProduct={(id) => {
                  setProducts((p) => p.filter((x) => x.id !== id));
                  markDirty();
                }}
                save={save}
                onSave={handleSave}
              />
            )}
            {load.kind === "ready" && selected && (
              <DangerZone
                shopName={shop.name || selected.name}
                onDelete={handleDeleteShop}
              />
            )}
          </section>
        </div>
      )}
    </main>
  );
}

/** โซนอันตราย: ลบร้านถาวร — ต้องพิมพ์ชื่อร้านยืนยันก่อน (ข้อมูลแชต/สินค้า/บัญชีหายทั้งหมด) */
function DangerZone({
  shopName,
  onDelete,
}: {
  shopName: string;
  onDelete: () => Promise<boolean>;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matched = confirmText.trim() === shopName.trim() && shopName.trim() !== "";

  async function handleClick() {
    if (!matched || busy) return;
    setBusy(true);
    setError("");
    const ok = await onDelete();
    if (!ok) {
      setError("ลบไม่สำเร็จ ลองใหม่");
      setBusy(false);
      return;
    }
    setConfirmText("");
    setBusy(false);
  }

  return (
    <div className="mt-6 rounded-2xl border border-red-300 bg-red-50/50 p-4 dark:border-red-900 dark:bg-red-950/20">
      <h3 className="text-sm font-semibold text-red-700 dark:text-red-300">
        โซนอันตราย — ลบร้านนี้ถาวร
      </h3>
      <p className="mt-1 text-xs text-muted">
        ลบทุกอย่างของร้านนี้: บัญชีผู้ใช้ แชตทั้งหมด สินค้า การเชื่อมต่อ และสถิติ — กู้คืนไม่ได้
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={`พิมพ์ "${shopName}" เพื่อยืนยัน`}
          className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
        />
        <button
          type="button"
          onClick={handleClick}
          disabled={!matched || busy}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "กำลังลบ…" : "ลบร้านถาวร"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function ShopEditor({
  selected,
  shop,
  setShop,
  rules,
  addRule,
  updateRule,
  removeRule,
  products,
  addProduct,
  updateProduct,
  removeProduct,
  save,
  onSave,
}: {
  selected: ShopSummary;
  shop: Shop;
  setShop: (patch: Partial<Shop>) => void;
  rules: Rule[];
  addRule: () => void;
  updateRule: (id: string, patch: Partial<Rule>) => void;
  removeRule: (id: string) => void;
  products: Product[];
  addProduct: () => void;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  removeProduct: (id: string) => void;
  save: SaveState;
  onSave: () => void;
}) {
  const saveLabel =
    save === "saving"
      ? "กำลังบันทึก…"
      : save === "saved"
        ? "บันทึกแล้ว ✓"
        : save === "error"
          ? "บันทึกไม่สำเร็จ ลองใหม่"
          : "บันทึกการแก้ไข";

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">
            {shop.name || "(ยังไม่ตั้งชื่อร้าน)"}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            แอดมิน @{selected.username} · รหัสร้าน {selected.id.slice(0, 8)}…
          </p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={save === "saving"}
          className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
            save === "error"
              ? "border border-red-500/30 bg-red-500/10 text-red-500 hover:bg-red-500/20"
              : "bg-accent text-accent-contrast hover:opacity-90"
          }`}
        >
          {saveLabel}
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <Field label="ชื่อร้าน">
          <input
            type="text"
            value={shop.name}
            onChange={(e) => setShop({ name: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="โทนการพูดของร้าน">
          <textarea
            value={shop.voice}
            onChange={(e) => setShop({ voice: e.target.value })}
            rows={2}
            className={inputClass}
          />
        </Field>
        <Field label="สิ่งที่ AI ควรจำ (ข้อมูล/นโยบายร้าน)">
          <textarea
            value={shop.memory}
            onChange={(e) => setShop({ memory: e.target.value })}
            placeholder="ค่าส่ง / วิธีจ่ายเงิน / เก็บปลายทาง / รับประกัน / เวลาทำการ / ที่ตั้งร้าน"
            rows={4}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg">รายการคู่พ่วง</h3>
          <button type="button" onClick={addRule} className={secondaryBtnClass}>
            + เพิ่มคู่พ่วง
          </button>
        </div>

        {rules.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-line bg-surface2 px-3 py-6 text-center text-sm text-muted">
            ร้านนี้ยังไม่มีคู่พ่วง
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {rules.map((rule, i) => (
              <div key={rule.id} className="rounded-lg border border-line bg-surface2 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted">
                    คู่พ่วง #{i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRule(rule.id)}
                    className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
                  >
                    ลบ
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Field label="ลูกค้าสนใจ (trigger)" compact>
                    <input
                      type="text"
                      value={rule.trigger}
                      onChange={(e) => updateRule(rule.id, { trigger: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="เสนอพ่วง (partner)" compact>
                    <input
                      type="text"
                      value={rule.partner}
                      onChange={(e) => updateRule(rule.id, { partner: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="ราคาของพ่วง (บาท)" compact>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={rule.price}
                      onChange={(e) => updateRule(rule.id, { price: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="โปร (ว่างได้)" compact>
                    <input
                      type="text"
                      value={rule.promo}
                      onChange={(e) => updateRule(rule.id, { promo: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="เหตุผลที่ขายคู่กัน" compact>
                      <input
                        type="text"
                        value={rule.reason}
                        onChange={(e) => updateRule(rule.id, { reason: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg">
            คลังสินค้า{" "}
            <span className="font-normal text-muted">({products.length.toLocaleString()} รายการ)</span>
          </h3>
          <button type="button" onClick={addProduct} className={secondaryBtnClass}>
            + เพิ่มสินค้า
          </button>
        </div>

        {products.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-line bg-surface2 px-3 py-6 text-center text-sm text-muted">
            ร้านนี้ยังไม่มีสินค้าในคลัง
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {products.map((product, i) => (
              <div key={product.id} className="rounded-lg border border-line bg-surface2 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted">
                    สินค้า #{i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeProduct(product.id)}
                    className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
                  >
                    ลบ
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Field label="ชื่อสินค้า" compact>
                    <input
                      type="text"
                      value={product.name}
                      onChange={(e) => updateProduct(product.id, { name: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="ราคา (บาท, ว่างได้)" compact>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={product.price}
                      onChange={(e) => updateProduct(product.id, { price: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="คำอธิบายสินค้า" compact>
                      <input
                        type="text"
                        value={product.description}
                        onChange={(e) => updateProduct(product.id, { description: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  compact,
}: {
  label: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <label className="block">
      <span
        className={`mb-1 block font-medium text-fg ${compact ? "text-xs" : "text-sm"}`}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-line bg-app px-3 py-2 text-sm text-fg placeholder-muted/60 transition focus:border-accent focus:outline-none";

const secondaryBtnClass =
  "rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-fg transition hover:bg-surface2";
