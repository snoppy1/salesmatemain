"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import type {
  Product,
  Rule,
  Shop,
  ShopData,
  GenerateResult,
  ImportResult,
  ConnectionStatus,
  LineChannelStatus,
} from "@/lib/types";
import ThemeToggle from "@/components/ThemeToggle";
import InboxView from "./InboxView";

function genId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function newRule(): Rule {
  return { id: genId(), trigger: "", partner: "", price: "", reason: "", promo: "", enabled: true };
}

function newProduct(): Product {
  return { id: genId(), name: "", description: "", price: "", enabled: true };
}

/** แยก source (CSV) เป็นรายชื่อ platform */
function sourceList(source?: string): string[] {
  return (source ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type ResultState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "result"; data: GenerateResult }
  | { kind: "error"; message: string };

type SaveState = "idle" | "saving" | "saved" | "error";

type View = "generate" | "inbox" | "settings" | "catalog";

export default function Dashboard({
  username,
  initial,
}: {
  username: string;
  initial: ShopData;
}) {
  const router = useRouter();

  const [shop, setShop] = useState<Shop>(initial.shop);
  const [rules, setRules] = useState<Rule[]>(initial.rules);
  const [products, setProducts] = useState<Product[]>(initial.products ?? []);
  const [save, setSave] = useState<SaveState>("saved");
  const [dirty, setDirty] = useState(false);
  const savingRef = useRef(false);
  const editSeqRef = useRef(0);
  const [view, setView] = useState<View>("generate");

  const [customerMsg, setCustomerMsg] = useState("");
  const [result, setResult] = useState<ResultState>({ kind: "idle" });

  function markDirty() {
    editSeqRef.current += 1;
    setDirty(true);
    setSave((s) => (s === "saving" ? s : "idle"));
  }
  function updateRule(id: string, patch: Partial<Rule>) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    markDirty();
  }
  function addRule() {
    setRules((prev) => [...prev, newRule()]);
    markDirty();
  }
  function removeRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
    markDirty();
  }
  function updateShop(patch: Partial<Shop>) {
    setShop((s) => ({ ...s, ...patch }));
    markDirty();
  }
  function updateProduct(id: string, patch: Partial<Product>) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    markDirty();
  }
  function addProduct() {
    setProducts((prev) => [...prev, newProduct()]);
    markDirty();
  }
  function removeProduct(id: string) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    markDirty();
  }

  const handleSave = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    const seq = editSeqRef.current;
    setSave("saving");
    try {
      const res = await fetch("/api/shop", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shop, rules, products } satisfies ShopData),
      });
      if (!res.ok) {
        setSave("error");
        return;
      }
      // ไม่เอา response มาทับ state — กันทับสิ่งที่ผู้ใช้พิมพ์ระหว่างกำลังเซฟ
      if (editSeqRef.current === seq) {
        setDirty(false);
        setSave("saved");
      } else {
        setSave("idle"); // มีการแก้ระหว่างเซฟ → ยังไม่ล่าสุด ให้ autosave รอบใหม่จัดการ
      }
    } catch {
      setSave("error");
    } finally {
      savingRef.current = false;
    }
  }, [shop, rules, products]);

  // บันทึกอัตโนมัติ: หลังหยุดแก้ ~1.2 วิ (ไม่ยิงซ้อนระหว่างกำลังเซฟ)
  useEffect(() => {
    if (!dirty || save === "saving") return;
    const t = setTimeout(() => {
      void handleSave();
    }, 1200);
    return () => clearTimeout(t);
  }, [dirty, save, handleSave]);

  // เตือนถ้าปิด/รีเฟรชหน้าทั้งที่ยังมีของยังไม่เซฟ
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function handleGenerate() {
    if (!customerMsg.trim() || result.kind === "loading") return;
    setResult({ kind: "loading" });
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shopName: shop.name,
          shopVoice: shop.voice,
          rules,
          products,
          customerMsg,
        }),
      });
      if (!res.ok) {
        setResult({ kind: "error", message: "เจนไม่สำเร็จ ลองใหม่อีกครั้ง" });
        return;
      }
      const data = (await res.json()) as GenerateResult;
      setResult({ kind: "result", data });
    } catch {
      setResult({ kind: "error", message: "เจนไม่สำเร็จ ลองใหม่อีกครั้ง" });
    }
  }

  // นำเข้าอัตโนมัติ: AI แยกข้อความดิบเป็นคู่พ่วง/คลังสินค้า แล้วเพิ่มต่อท้าย
  async function handleImport(text: string): Promise<{ rules: number; products: number }> {
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("import failed");
    const data = (await res.json()) as ImportResult;
    const newRules: Rule[] = data.rules.map((r) => ({ ...newRule(), ...r }));
    const newProducts: Product[] = data.products.map((p) => ({ ...newProduct(), ...p }));
    if (newRules.length) setRules((prev) => [...prev, ...newRules]);
    if (newProducts.length) setProducts((prev) => [...prev, ...newProducts]);
    if (newRules.length || newProducts.length) markDirty();
    return { rules: newRules.length, products: newProducts.length };
  }

  // ดึงสินค้าจาก marketplace (lazada/shopee) → เพิ่มเข้าคลัง
  // - ถ้าชื่อซ้ำกับสินค้าที่มาจาก platform อื่นอยู่แล้ว → ผนวก platform เข้า source เดิม (ไม่เพิ่มซ้ำ)
  // - ถ้าชื่อซ้ำกับสินค้าที่เพิ่มเอง (ไม่มี source) → ข้าม ไม่แตะ (กันโดนลบตอน disconnect)
  async function handleImportMarketplace(platform: string): Promise<number> {
    const res = await fetch(`/api/connect/${platform}/import`, { method: "POST" });
    if (!res.ok) throw new Error("import failed");
    const data = (await res.json()) as { products: Product[] };

    let added = 0;
    setProducts((prev) => {
      const next = [...prev];
      const norm = (s: string) => s.trim().toLowerCase();
      for (const inc of data.products) {
        const idx = next.findIndex((p) => norm(p.name) === norm(inc.name));
        if (idx === -1) {
          // ยังไม่มี → เพิ่มใหม่
          next.push({
            ...newProduct(),
            name: inc.name,
            price: inc.price,
            description: inc.description,
            source: platform,
            externalId: inc.externalId,
          });
          added++;
        } else {
          const cur = next[idx];
          const srcs = sourceList(cur.source);
          if (srcs.length === 0) continue; // เพิ่มเอง → ไม่แตะ
          if (!srcs.includes(platform)) {
            next[idx] = { ...cur, source: [...srcs, platform].join(",") };
            added++; // นับว่าเชื่อมเพิ่มอีกเจ้า
          }
        }
      }
      return next;
    });
    if (added) markDirty();
    return added;
  }

  // ยกเลิกเชื่อม platform → ถอด platform นั้นออกจาก source ของสินค้า
  // สินค้าที่เหลือ source ว่าง (มาจากเจ้านี้เจ้าเดียว) จะถูกลบ; ถ้ายังมีเจ้าอื่นอยู่ → คงไว้
  async function handleDisconnectMarketplace(platform: string): Promise<void> {
    await fetch(`/api/connect/${platform}/disconnect`, { method: "POST" }).catch(() => {});
    setProducts((prev) =>
      prev
        .map((p) => {
          const srcs = sourceList(p.source);
          if (!srcs.includes(platform)) return p; // ไม่เกี่ยวกับเจ้านี้
          const left = srcs.filter((s) => s !== platform);
          return { ...p, source: left.join(",") };
        })
        // ลบเฉพาะตัวที่ "เคยมี source แต่ตอนนี้ว่าง" (มาจาก platform ล้วนๆ)
        .filter((p) => {
          const had = sourceList(p.source);
          // ถ้า source ว่าง แปลว่าอาจเป็นเพิ่มเอง หรือเพิ่งถูกถอดจนหมด — เก็บเฉพาะเพิ่มเอง
          // ใช้ externalId เป็นตัวชี้ว่ามาจาก marketplace
          if (had.length === 0 && p.externalId) return false;
          return true;
        }),
    );
    markDirty();
  }

  async function handleLogout() {
    if (dirty) await handleSave(); // เซฟก่อนออก กันข้อมูลหาย
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen">
      <Sidebar
        view={view}
        setView={setView}
        username={username}
        onLogout={handleLogout}
      />
      <main className="pl-16">
        <div
          className={`mx-auto px-4 py-6 sm:py-8 ${
            view === "catalog" || view === "inbox" ? "max-w-6xl" : "max-w-3xl"
          }`}
        >
          {view === "generate" && (
            <Console
              customerMsg={customerMsg}
              setCustomerMsg={setCustomerMsg}
              onGenerate={handleGenerate}
              result={result}
            />
          )}
          {view === "inbox" && <InboxView />}
          {view === "settings" && (
            <SettingsView
              shop={shop}
              updateShop={updateShop}
              save={save}
              onSave={handleSave}
            />
          )}
          {view === "catalog" && (
            <CatalogView
              rules={rules}
              updateRule={updateRule}
              addRule={addRule}
              removeRule={removeRule}
              products={products}
              updateProduct={updateProduct}
              addProduct={addProduct}
              removeProduct={removeProduct}
              onImport={handleImport}
              onImportMarketplace={handleImportMarketplace}
              onDisconnectMarketplace={handleDisconnectMarketplace}
              save={save}
              onSave={handleSave}
            />
          )}
        </div>
      </main>
    </div>
  );
}

/* ---------------- แถบเมนูซ้าย (เลื่อนออกเมื่อ hover) ---------------- */

function Sidebar({
  view,
  setView,
  username,
  onLogout,
}: {
  view: View;
  setView: (v: View) => void;
  username: string;
  onLogout: () => void;
}) {
  const items: { key: View; label: string; icon: React.ReactNode }[] = [
    { key: "generate", label: "เจนประโยคแนะนำการขาย", icon: <IconSpark /> },
    { key: "inbox", label: "กล่องแชต (LINE)", icon: <IconChat /> },
    { key: "settings", label: "ตั้งค่าร้าน", icon: <IconStore /> },
    { key: "catalog", label: "รายการคู่พ่วงและคลังสินค้า", icon: <IconList /> },
  ];

  return (
    <aside className="group fixed inset-y-0 left-0 z-40 flex w-16 flex-col overflow-hidden border-r border-gray-200 bg-white shadow-sm transition-[width] duration-200 ease-out hover:w-64 dark:border-gray-800 dark:bg-gray-900">
      {/* โลโก้มุมซ้ายบน — ข้อความ พ่วง เลื่อนออกมาตอน hover */}
      <div className="flex h-16 items-center gap-3 px-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-xl font-bold text-white shadow-sm">
          พ
        </div>
        <span className="whitespace-nowrap text-lg font-bold tracking-tight text-gray-900 opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:text-white">
          พ่วง
        </span>
      </div>

      {/* หมวดหมู่ */}
      <nav className="mt-2 flex flex-1 flex-col gap-1 px-2">
        {items.map((it) => {
          const active = view === it.key;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => setView(it.key)}
              title={it.label}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                active
                  ? "bg-emerald-600 text-white"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              <span className="shrink-0">{it.icon}</span>
              <span className="whitespace-nowrap text-sm font-medium opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                {it.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* ฟันเฟืองซ้ายล่าง: บัญชี + ออกจากระบบ + ธีม */}
      <div className="border-t border-gray-200 p-2 dark:border-gray-800">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-gray-500 dark:text-gray-400">
          <IconGear />
          <span className="truncate whitespace-nowrap text-sm opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            @{username}
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 pb-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <button
            type="button"
            onClick={onLogout}
            className="whitespace-nowrap rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            ออกจากระบบ
          </button>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}

function IconSpark() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z" />
      <path d="M19 14l.7 1.8 1.8.7-1.8.7L19 19l-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  );
}
function IconChat() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
    </svg>
  );
}
function IconStore() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M4 9v10a1 1 0 001 1h14a1 1 0 001-1V9" />
      <path d="M3 9a2.5 2.5 0 005 0 2.5 2.5 0 005 0 2.5 2.5 0 005 0 2.5 2.5 0 005 0" />
    </svg>
  );
}
function IconList() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}
function IconGear() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

/* ---------------- หมวด: ตั้งค่าร้าน ---------------- */

function SettingsView({
  shop,
  updateShop,
  save,
  onSave,
}: {
  shop: Shop;
  updateShop: (patch: Partial<Shop>) => void;
  save: SaveState;
  onSave: () => void;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">ตั้งค่าร้าน</h2>
        <SaveButton save={save} onSave={onSave} />
      </div>

      <div className="mt-4 space-y-4">
        <Field label="ชื่อร้าน">
          <input
            type="text"
            value={shop.name}
            onChange={(e) => updateShop({ name: e.target.value })}
            placeholder="เช่น ร้านสวยใส บิวตี้"
            className={inputClass}
          />
        </Field>

        <Field label="โทนการพูดของร้าน">
          <textarea
            value={shop.voice}
            onChange={(e) => updateShop({ voice: e.target.value })}
            placeholder="เช่น เป็นกันเอง ใช้คำว่า 'นะคะ' น่ารักๆ ไม่ทางการ"
            rows={3}
            className={inputClass}
          />
        </Field>
      </div>

      <LineConnectBox />
    </section>
  );
}

function LineConnectBox() {
  const [status, setStatus] = useState<LineChannelStatus | null>(null);
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/line/connect/status");
      if (r.ok) setStatus((await r.json()) as LineChannelStatus);
    } catch {
      /* เงียบไว้ */
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function connect() {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/line/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelSecret: secret.trim(), accessToken: token.trim() }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) {
        setErr(d.error || "เชื่อมไม่สำเร็จ");
        return;
      }
      setSecret("");
      setToken("");
      await loadStatus();
    } catch {
      setErr("เชื่อมไม่สำเร็จ ลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    if (!window.confirm("ยกเลิกการเชื่อมต่อ LINE OA นี้?")) return;
    setBusy(true);
    await fetch("/api/line/connect/disconnect", { method: "POST" }).catch(() => {});
    await loadStatus();
    setBusy(false);
  }

  function copyWebhook() {
    if (!status?.webhookUrl) return;
    void navigator.clipboard.writeText(status.webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const connected = status?.connected;

  return (
    <div className="mt-6 rounded-xl border border-green-200 bg-green-50/50 p-4 dark:border-green-900/60 dark:bg-green-950/20">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-green-800 dark:text-green-300">
          💬 เชื่อม LINE OA{" "}
          {status?.mock && (
            <span className="text-xs font-normal text-green-600 dark:text-green-400">
              (โหมดทดลอง)
            </span>
          )}
        </span>
        {connected ? (
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">
            เชื่อมแล้ว
          </span>
        ) : (
          <span className="rounded-full bg-gray-400 px-2 py-0.5 text-xs font-semibold text-white dark:bg-gray-600">
            ยังไม่เชื่อม
          </span>
        )}
      </div>

      {connected ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-700 dark:text-gray-200">
            OA: <b>{status?.displayName || "—"}</b>{" "}
            <span className="text-gray-400">{status?.basicId}</span>
          </span>
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="ml-auto rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            ยกเลิกการเชื่อมต่อ
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-xs text-gray-600 dark:text-gray-400">
            <li>เปิด Messaging API บน LINE OA แล้วเข้า LINE Developers Console</li>
            <li>
              วาง Webhook URL นี้ในช่อง Webhook URL ของ LINE แล้วเปิด “Use webhook”:
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-white px-2 py-1 text-[11px] text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                  {status?.webhookUrl ?? "…"}
                </code>
                <button
                  type="button"
                  onClick={copyWebhook}
                  className="shrink-0 rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {copied ? "คัดลอกแล้ว ✓" : "คัดลอก"}
                </button>
              </div>
            </li>
            <li>ก๊อป Channel secret และ Channel access token มาวางด้านล่าง แล้วกดเชื่อม</li>
            <li>อย่าลืมปิด auto-reply/greeting ของ OA กันมันตอบชนกัน</li>
          </ol>

          <input
            type="text"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Channel secret"
            className={inputClass}
          />
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Channel access token (long-lived)"
            className={inputClass}
          />
          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
          <button
            type="button"
            onClick={connect}
            disabled={busy || !secret.trim() || !token.trim()}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
          >
            {busy ? "กำลังเชื่อม…" : "เชื่อม LINE"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- หมวด: รายการคู่พ่วงและคลังสินค้า ---------------- */

function CatalogView({
  rules,
  updateRule,
  addRule,
  removeRule,
  products,
  updateProduct,
  addProduct,
  removeProduct,
  onImport,
  onImportMarketplace,
  onDisconnectMarketplace,
  save,
  onSave,
}: {
  rules: Rule[];
  updateRule: (id: string, patch: Partial<Rule>) => void;
  addRule: () => void;
  removeRule: (id: string) => void;
  products: Product[];
  updateProduct: (id: string, patch: Partial<Product>) => void;
  addProduct: () => void;
  removeProduct: (id: string) => void;
  onImport: (text: string) => Promise<{ rules: number; products: number }>;
  onImportMarketplace: (platform: string) => Promise<number>;
  onDisconnectMarketplace: (platform: string) => Promise<void>;
  save: SaveState;
  onSave: () => void;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          รายการคู่พ่วงและคลังสินค้า
        </h2>
        <SaveButton save={save} onSave={onSave} />
      </div>

      {/* เชื่อมต่อ marketplace (Lazada + Shopee) */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MARKETPLACES.map((cfg) => (
          <MarketplaceBox
            key={cfg.platform}
            cfg={cfg}
            onImport={() => onImportMarketplace(cfg.platform)}
            onDisconnect={() => onDisconnectMarketplace(cfg.platform)}
          />
        ))}
      </div>

      {/* นำเข้าอัตโนมัติ อยู่บนกลาง เต็มความกว้าง */}
      <ImportBox onImport={onImport} />

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ซ้าย: รายการคู่พ่วง */}
        <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">รายการคู่พ่วง</h3>
            <button type="button" onClick={addRule} className={secondaryBtnClass}>
              + เพิ่มคู่พ่วง
            </button>
          </div>

          {rules.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
              ยังไม่มีคู่พ่วง — กด “+ เพิ่มคู่พ่วง”
            </p>
          ) : (
            <div className="mt-3 max-h-[62vh] space-y-3 overflow-y-auto pr-1">
              {rules.map((rule, i) => (
                <RuleRow
                  key={rule.id}
                  index={i}
                  rule={rule}
                  onChange={(patch) => updateRule(rule.id, patch)}
                  onRemove={() => removeRule(rule.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ขวา: คลังสินค้า */}
        <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">คลังสินค้า</h3>
            <button type="button" onClick={addProduct} className={secondaryBtnClass}>
              + เพิ่มสินค้า
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            AI ใช้แนะนำเมื่อไม่มีคู่พ่วงที่ตรง
          </p>

          {products.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
              ยังไม่มีสินค้า — กด “+ เพิ่มสินค้า”
            </p>
          ) : (
            <div className="mt-3 max-h-[62vh] space-y-3 overflow-y-auto pr-1">
              {products.map((product, i) => (
                <ProductRow
                  key={product.id}
                  index={i}
                  product={product}
                  onChange={(patch) => updateProduct(product.id, patch)}
                  onRemove={() => removeProduct(product.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** สวิตช์ เปิด/ปิด ใช้ร่วมกันทั้งสินค้าและคู่พ่วง */
function EnableToggle({
  enabled,
  onToggle,
  label,
}: {
  enabled: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition ${
        enabled ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
          enabled ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function ProductRow({
  index,
  product,
  onChange,
  onRemove,
}: {
  index: number;
  product: Product;
  onChange: (patch: Partial<Product>) => void;
  onRemove: () => void;
}) {
  const enabled = product.enabled !== false;
  const sources = sourceList(product.source);
  return (
    <div
      className={`rounded-lg border p-3 transition ${
        enabled
          ? "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50"
          : "border-gray-200 bg-gray-100 opacity-60 dark:border-gray-800 dark:bg-gray-900/40"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
          สินค้า #{index + 1}
          {sources.map(
            (s) =>
              PLATFORM_BADGE[s] && (
                <span key={s} className={PLATFORM_BADGE[s].cls}>
                  {PLATFORM_BADGE[s].label}
                </span>
              ),
          )}
          {!enabled && (
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              หมดสต็อก
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <EnableToggle
            enabled={enabled}
            onToggle={() => onChange({ enabled: !enabled })}
            label={`เปิด/ปิดสินค้าที่ ${index + 1}`}
          />
          <button
            type="button"
            onClick={onRemove}
            className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
            aria-label={`ลบสินค้าที่ ${index + 1}`}
          >
            ลบ
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="ชื่อสินค้า" compact>
          <input
            type="text"
            value={product.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="เช่น เซรั่มบำรุงผิวหน้า"
            className={inputClass}
          />
        </Field>
        <Field label="ราคา (บาท, ว่างได้)" compact>
          <input
            type="text"
            inputMode="numeric"
            value={product.price}
            onChange={(e) => onChange({ price: e.target.value })}
            placeholder="เช่น 690"
            className={inputClass}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="คำอธิบายสินค้า" compact>
            <input
              type="text"
              value={product.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="เช่น เซรั่มเข้มข้น ลดเลือนริ้วรอย เหมาะกับผิวแห้ง"
              className={inputClass}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function SaveButton({ save, onSave }: { save: SaveState; onSave: () => void }) {
  const label =
    save === "saving"
      ? "กำลังบันทึก…"
      : save === "saved"
        ? "บันทึกแล้ว ✓"
        : save === "error"
          ? "บันทึกไม่สำเร็จ ลองใหม่"
          : "บันทึก";
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={save === "saving"}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
        save === "error"
          ? "border border-red-300 bg-white text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/40"
          : "bg-emerald-600 text-white hover:bg-emerald-700"
      }`}
    >
      {label}
    </button>
  );
}

/** ตั้งค่าหน้าตาแต่ละ marketplace (คลาส Tailwind เขียนเต็มเพื่อไม่ให้โดน purge) */
type MktConfig = {
  platform: string;
  label: string;
  emoji: string;
  box: string;
  title: string;
  mockText: string;
  btn: string;
};

const MARKETPLACES: MktConfig[] = [
  {
    platform: "lazada",
    label: "Lazada",
    emoji: "🛒",
    box: "border-orange-200 bg-orange-50/50 dark:border-orange-900/60 dark:bg-orange-950/20",
    title: "text-orange-800 dark:text-orange-300",
    mockText: "text-orange-600 dark:text-orange-400",
    btn: "bg-orange-600 hover:bg-orange-700",
  },
  {
    platform: "shopee",
    label: "Shopee",
    emoji: "🛍️",
    box: "border-red-200 bg-red-50/50 dark:border-red-900/60 dark:bg-red-950/20",
    title: "text-red-800 dark:text-red-300",
    mockText: "text-red-600 dark:text-red-400",
    btn: "bg-red-600 hover:bg-red-700",
  },
];

/** ป้ายกำกับที่มาของสินค้าในคลัง */
const PLATFORM_BADGE: Record<string, { label: string; cls: string }> = {
  lazada: {
    label: "Lazada",
    cls: "rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
  },
  shopee: {
    label: "Shopee",
    cls: "rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-300",
  },
};

function MarketplaceBox({
  cfg,
  onImport,
  onDisconnect,
}: {
  cfg: MktConfig;
  onImport: () => Promise<number>;
  onDisconnect: () => Promise<void>;
}) {
  const [status, setStatus] = useState<
    (ConnectionStatus & { configured?: boolean }) | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch(`/api/connect/${cfg.platform}/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => {});
  }, [cfg.platform]);

  async function doImport() {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      const n = await onImport();
      setMsg(
        n > 0
          ? `ดึงสินค้าจาก ${cfg.label} ${n} รายการ (บันทึกอัตโนมัติ)`
          : "ไม่มีสินค้าใหม่ (ดึงครบแล้ว)",
      );
    } catch {
      setMsg("ดึงสินค้าไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    const ok = window.confirm(
      `ยกเลิกการเชื่อมต่อ ${cfg.label}?\nสินค้าที่ดึงมาจาก ${cfg.label} จะถูกลบออกจากคลัง (ยกเว้นตัวที่ยังมีอีกแพลตฟอร์มเชื่อมอยู่)`,
    );
    if (!ok) return;
    setBusy(true);
    // ลบ connection + ถอดสินค้าที่มาจากเจ้านี้ออก (จัดการใน onDisconnect)
    await onDisconnect().catch(() => {});
    setStatus({ connected: false, platform: cfg.platform });
    setMsg("");
    setBusy(false);
  }

  const connected = status?.connected;
  const mock = status?.mock || status?.configured === false;

  return (
    <div className={`rounded-xl border p-3 ${cfg.box}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm font-semibold ${cfg.title}`}>
          {cfg.emoji} เชื่อมต่อร้านค้า {cfg.label}{" "}
          {mock && (
            <span className={`text-xs font-normal ${cfg.mockText}`}>(โหมดทดลอง)</span>
          )}
        </span>
        {connected ? (
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">
            เชื่อมต่อแล้ว
          </span>
        ) : (
          <span className="rounded-full bg-gray-400 px-2 py-0.5 text-xs font-semibold text-white dark:bg-gray-600">
            ยังไม่เชื่อมต่อ
          </span>
        )}
      </div>

      {!connected ? (
        <div className="mt-2">
          <a
            href={`/api/connect/${cfg.platform}`}
            className={`inline-block rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition ${cfg.btn}`}
          >
            เชื่อมต่อ {cfg.label}
          </a>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            เชื่อมแล้วดึงสินค้าจากร้าน {cfg.label} เข้าคลังได้อัตโนมัติ
          </p>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={doImport}
            disabled={busy}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition disabled:opacity-50 ${cfg.btn}`}
          >
            {busy ? "กำลังดึง…" : `ดึงสินค้าจาก ${cfg.label}`}
          </button>
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            ยกเลิกการเชื่อมต่อ
          </button>
          {msg && (
            <span className="text-xs text-emerald-700 dark:text-emerald-400">{msg}</span>
          )}
        </div>
      )}
    </div>
  );
}

function ImportBox({
  onImport,
}: {
  onImport: (text: string) => Promise<{ rules: number; products: number }>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function run() {
    if (!text.trim() || status === "loading") return;
    setStatus("loading");
    setMsg("");
    try {
      const { rules, products } = await onImport(text);
      if (rules === 0 && products === 0) {
        setStatus("error");
        setMsg("ไม่พบข้อมูลที่แยกได้ ลองจัดข้อความให้ชัดขึ้น");
        return;
      }
      setStatus("idle");
      setMsg(`เพิ่มแล้ว: คู่พ่วง ${rules} รายการ, สินค้า ${products} รายการ (ระบบบันทึกให้อัตโนมัติ)`);
      setText("");
    } catch {
      setStatus("error");
      setMsg("แยกข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
          ✨ นำเข้าอัตโนมัติ — วางข้อความ AI แยกคู่พ่วง/สินค้าให้เอง
        </span>
        <span className="text-emerald-700 dark:text-emerald-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={
              "วางข้อมูลแบบไหนก็ได้ เช่น:\nแบตเตอรี่รถยนต์ ซื้อคู่กับสายพ่วง 450 บาท ลดเหลือ 290\nน้ำมันเครื่อง 1200 บาท สังเคราะห์แท้ 100%\nใบปัดน้ำฝน 250 บาท"
            }
            className={inputClass}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={run}
              disabled={!text.trim() || status === "loading"}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "loading" ? "กำลังแยกข้อมูล…" : "แยกและเพิ่มอัตโนมัติ"}
            </button>
            {msg && (
              <span
                className={`text-xs ${status === "error" ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
              >
                {msg}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            แยกแล้วจะเพิ่มต่อท้ายรายการด้านล่าง ตรวจ/แก้ได้ก่อนใช้งานจริง
          </p>
        </div>
      )}
    </div>
  );
}

function RuleRow({
  index,
  rule,
  onChange,
  onRemove,
}: {
  index: number;
  rule: Rule;
  onChange: (patch: Partial<Rule>) => void;
  onRemove: () => void;
}) {
  const enabled = rule.enabled !== false;
  return (
    <div
      className={`rounded-lg border p-3 transition ${
        enabled
          ? "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50"
          : "border-gray-200 bg-gray-100 opacity-60 dark:border-gray-800 dark:bg-gray-900/40"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
          คู่พ่วง #{index + 1}
          {!enabled && (
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              ปิดอยู่
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <EnableToggle
            enabled={enabled}
            onToggle={() => onChange({ enabled: !enabled })}
            label={`เปิด/ปิดคู่พ่วงที่ ${index + 1}`}
          />
          <button
            type="button"
            onClick={onRemove}
            className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
            aria-label={`ลบคู่พ่วงที่ ${index + 1}`}
          >
            ลบ
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="ลูกค้าสนใจ (trigger)" compact>
          <input
            type="text"
            value={rule.trigger}
            onChange={(e) => onChange({ trigger: e.target.value })}
            placeholder="เช่น ครีมทารอบดวงตา"
            className={inputClass}
          />
        </Field>
        <Field label="เสนอพ่วง (partner)" compact>
          <input
            type="text"
            value={rule.partner}
            onChange={(e) => onChange({ partner: e.target.value })}
            placeholder="เช่น เซรั่มบำรุงผิว"
            className={inputClass}
          />
        </Field>
        <Field label="ราคาของพ่วง (บาท)" compact>
          <input
            type="text"
            inputMode="numeric"
            value={rule.price}
            onChange={(e) => onChange({ price: e.target.value })}
            placeholder="เช่น 690"
            className={inputClass}
          />
        </Field>
        <Field label="โปร (ว่างได้)" compact>
          <input
            type="text"
            value={rule.promo}
            onChange={(e) => onChange({ promo: e.target.value })}
            placeholder="เช่น ซื้อคู่ลด 10%"
            className={inputClass}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="เหตุผลที่ขายคู่กัน (ดีกับลูกค้ายังไง)" compact>
            <input
              type="text"
              value={rule.reason}
              onChange={(e) => onChange({ reason: e.target.value })}
              placeholder="เช่น เซรั่มช่วยให้ครีมซึมดีขึ้น เห็นผลไวกว่า"
              className={inputClass}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

/* ---------------- ฝั่งขวา: console ---------------- */

function Console({
  customerMsg,
  setCustomerMsg,
  onGenerate,
  result,
}: {
  customerMsg: string;
  setCustomerMsg: (v: string) => void;
  onGenerate: () => void;
  result: ResultState;
}) {
  const loading = result.kind === "loading";
  const canGenerate = customerMsg.trim().length > 0 && !loading;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h2 className="text-base font-semibold text-gray-900 dark:text-white">เจนประโยคขายพ่วง</h2>

      <div className="mt-4 space-y-4">
        <Field label="ข้อความ/บริบทจากลูกค้า">
          <textarea
            value={customerMsg}
            onChange={(e) => setCustomerMsg(e.target.value)}
            placeholder={
              "วางข้อความที่ลูกค้าทักมา + บริบทถ้ามี รวมในช่องเดียว\nเช่น: สนใจครีมรอบดวงตาค่ะ งบไม่เกิน 500 ซื้อเป็นของขวัญ"
            }
            rows={6}
            className={inputClass}
          />
        </Field>

        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate}
          className={primaryBtnClass}
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Spinner />
              กำลังเจน…
            </span>
          ) : (
            "เจนประโยคขายพ่วง"
          )}
        </button>
      </div>

      <div className="mt-5">
        <ResultArea result={result} />
      </div>

      <p className="mt-5 border-t border-gray-100 pt-3 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
        ประโยคที่ได้เป็นคำแนะนำ แอดมินควรอ่านก่อนกดส่งทุกครั้ง
      </p>
    </section>
  );
}

function ResultArea({ result }: { result: ResultState }) {
  if (result.kind === "idle") {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
        ผลลัพธ์จะแสดงตรงนี้
      </p>
    );
  }

  if (result.kind === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-8 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
        <Spinner />
        กำลังวิเคราะห์บทสนทนา…
      </div>
    );
  }

  if (result.kind === "error") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        {result.message}
      </div>
    );
  }

  const { data } = result;

  if (!data.should_upsell) {
    return (
      <div className="rounded-lg border border-gray-300 bg-gray-100 px-4 py-4 dark:border-gray-700 dark:bg-gray-800">
        <p className="font-semibold text-gray-700 dark:text-gray-200">ยังไม่ใช่จังหวะเสนอ</p>
        {data.reason_for_admin && (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{data.reason_for_admin}</p>
        )}
      </div>
    );
  }

  return <UpsellCard data={data} />;
}

function UpsellCard({ data }: { data: GenerateResult }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(data.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const value =
    typeof data.est_added_value === "number" && data.est_added_value > 0
      ? `+฿${Math.round(data.est_added_value).toLocaleString("th-TH")}`
      : null;

  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/30">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">ประโยคที่ส่งได้</span>
        {value && (
          <span className="shrink-0 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">
            {value}
          </span>
        )}
      </div>

      <p className="mt-2 whitespace-pre-wrap rounded-md border border-emerald-200 bg-white px-3 py-2.5 text-[15px] leading-relaxed text-gray-900 dark:border-emerald-900 dark:bg-gray-900 dark:text-gray-100">
        {data.message}
      </p>

      <button type="button" onClick={copy} className={copyBtnClass}>
        {copied ? "คัดลอกแล้ว ✓" : "คัดลอกประโยค"}
      </button>

      {data.reason_for_admin && (
        <div className="mt-3 border-t border-emerald-200 pt-2.5 dark:border-emerald-900">
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            เหตุผลสำหรับแอดมิน (ลูกค้าไม่เห็น)
          </p>
          <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">{data.reason_for_admin}</p>
        </div>
      )}
    </div>
  );
}

/* ---------------- ชิ้นส่วนร่วม ---------------- */

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
        className={`mb-1 block font-medium text-gray-700 dark:text-gray-300 ${compact ? "text-xs" : "text-sm"}`}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-current"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500";

const primaryBtnClass =
  "w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50";

const secondaryBtnClass =
  "rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-700 dark:bg-transparent dark:text-emerald-400 dark:hover:bg-emerald-950/40";

const copyBtnClass =
  "mt-3 w-full rounded-lg border border-emerald-400 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-700 dark:bg-transparent dark:text-emerald-300 dark:hover:bg-emerald-900/40";
