"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import type {
  Product,
  Shop,
  ShopData,
  ImportResult,
  ConnectionStatus,
  LineChannelStatus,
  FacebookChannelStatus,
  TiktokChannelStatus,
  LazadaChannelStatus,
  ShopeeChannelStatus,
  MockSettings,
} from "@/lib/types";
import ThemeToggle from "@/components/ThemeToggle";
import { SiFacebook, SiLine, SiShopee, SiTiktok } from "react-icons/si";
import { LazadaMark } from "@/components/BrandMarks";
import InboxView from "./InboxView";
import UpsellMetric from "@/components/UpsellMetric";
import OverviewView from "@/components/OverviewView";
import { sourceList, unifyStock } from "@/lib/stock";

// ช่องทางที่ยังไม่พร้อม — ซ่อนจาก UI ก่อน (โค้ดหลังบ้านยังอยู่ครบ เปิดคืนได้)
const HIDDEN_PLATFORMS = ["tiktok", "shopee"];
const SHOW_COMING_SOON_CHANNELS = false;

function genId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function newProduct(): Product {
  return { id: genId(), name: "", description: "", price: "", enabled: true };
}

/** อ่านไฟล์รูป → ย่อให้ด้านยาวสุดไม่เกิน max px → คืนเป็น data URL (JPEG) เก็บในระบบได้เลย */
async function fileToResizedDataUrl(file: File, max = 512): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("decode failed"));
    im.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height || 1));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.8);
}

type SaveState = "idle" | "saving" | "saved" | "error";

type View = "overview" | "inbox" | "settings" | "catalog";

export default function Dashboard({
  username,
  initial,
}: {
  username: string;
  initial: ShopData;
}) {
  const router = useRouter();

  const [shop, setShop] = useState<Shop>(initial.shop);
  const [products, setProducts] = useState<Product[]>(initial.products ?? []);
  const [save, setSave] = useState<SaveState>("saved");
  const [dirty, setDirty] = useState(false);
  const savingRef = useRef(false);
  const editSeqRef = useRef(0);
  // เปิดแอปมาเจอภาพรวมก่อน — เห็นผลงาน AI + งานที่รออยู่ ("แม่ค้าเปิดแอป 8 โมงเช้าควรเห็นอะไร")
  const [view, setView] = useState<View>("overview");
  const [mockSettings, setMockSettings] = useState<MockSettings>({});
  const [mockModalOpen, setMockModalOpen] = useState(false);
  const [metricsKey, setMetricsKey] = useState(0); // bump เพื่อให้การ์ดวัดยอดโหลดใหม่
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);

  // โหลดตั้งค่า "ข้อมูลทดลอง (mock)" ต่อร้าน
  useEffect(() => {
    fetch("/api/mock-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.settings) setMockSettings(d.settings as MockSettings);
      })
      .catch(() => {});
  }, []);

  // เปิด/ปิดข้อมูลทดลองทั้งหมด (ทุกแพลตฟอร์ม ทั้งแชต+สินค้า) ทีเดียว
  async function setAllMock(on: boolean) {
    const next: MockSettings = {};
    for (const p of MOCK_PLATFORMS) {
      next[p.id] = { chat: on, catalog: p.catalog ? on : false };
    }
    setMockSettings(next);
    await fetch("/api/mock-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: next }),
    }).catch(() => {});
    // สลับกลับเป็นของจริง → ล้างข้อมูลพ่วงที่สะสมตอนเดโม (รีเซ็ตเหลือ 0)
    if (!on) {
      await fetch("/api/metrics/reset", { method: "POST" }).catch(() => {});
    }
    setMetricsKey((k) => k + 1); // ให้การ์ดวัดยอดโหลดใหม่ (mock→ยอดขาย 0 / real→ค่าจริง)
  }

  function markDirty() {
    editSeqRef.current += 1;
    setDirty(true);
    setSave((s) => (s === "saving" ? s : "idle"));
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
        body: JSON.stringify({ shop, products } satisfies ShopData),
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
  }, [shop, products]);

  // ซิงค์สินค้า+สต็อกล่าสุดจากทุก marketplace ที่เชื่อมไว้
  // - silent (อัตโนมัติ): ข้ามถ้ากำลังแก้ค้างไว้ กันทับของที่ยังไม่เซฟ
  // - manual: เซฟก่อนแล้วค่อยซิงค์
  const handleSync = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (dirty) {
        if (opts?.silent) return;
        await handleSave();
      }
      setSyncing(true);
      const seq = editSeqRef.current;
      try {
        const res = await fetch("/api/catalog/sync", { method: "POST" });
        if (res.ok) {
          const d = (await res.json()) as { products?: Product[] };
          // ใช้ผลซิงค์เฉพาะเมื่อไม่มีการแก้ระหว่างรอ (กันทับของที่ผู้ใช้พิมพ์)
          if (Array.isArray(d.products) && editSeqRef.current === seq) {
            setProducts(d.products);
          }
          setLastSync(Date.now());
        }
      } catch {
        /* เงียบ */
      } finally {
        setSyncing(false);
      }
    },
    [dirty, handleSave],
  );

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

  // กลับจากเชื่อม: Facebook (?fb=) → หน้าตั้งค่า · marketplace (?connected=/?connect=) → อยู่หน้าคลังสินค้า
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("connected") === "lazada-chat") {
      setView("settings");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (sp.get("fb")) {
      setView("settings");
    } else if (sp.get("connected") || sp.get("connect")) {
      setView("catalog");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // นำเข้าอัตโนมัติ: AI แยกข้อความดิบเป็นรายการสินค้า แล้วเพิ่มต่อท้าย
  async function handleImport(text: string): Promise<{ products: number }> {
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("import failed");
    const data = (await res.json()) as ImportResult;
    const newProducts: Product[] = data.products.map((p) => ({ ...newProduct(), ...p }));
    if (newProducts.length) {
      setProducts((prev) => [...prev, ...newProducts]);
      markDirty();
    }
    return { products: newProducts.length };
  }

  // นำเข้าจากลิงก์: ดึงหน้าเว็บสินค้า (Firecrawl/fetch) → AI สกัด ชื่อ/ราคา/รูป → เพิ่มต่อท้าย
  async function handleImportUrl(url: string): Promise<{ products: number }> {
    const res = await fetch("/api/import-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      products?: Array<Partial<Product>>;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error || "ดึงข้อมูลไม่สำเร็จ");
    const newProducts: Product[] = (data.products ?? []).map((p) => ({
      ...newProduct(),
      ...p,
    }));
    if (newProducts.length) {
      setProducts((prev) => [...prev, ...newProducts]);
      markDirty();
    }
    return { products: newProducts.length };
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
          const sbp =
            inc.stock != null ? { [platform]: Number(inc.stock) } : undefined;
          next.push({
            ...newProduct(),
            name: inc.name,
            price: inc.price,
            description: inc.description,
            image: inc.image,
            source: platform,
            externalId: inc.externalId,
            stock: unifyStock(sbp),
            stockByPlatform: sbp,
          });
          added++;
        } else {
          const cur = next[idx];
          const srcs = sourceList(cur.source);
          if (srcs.length === 0) continue; // เพิ่มเอง → ไม่แตะ
          // อัปเดตสต็อกของแพลตฟอร์มนี้เสมอ (เลขอาจเปลี่ยนแม้เคยเชื่อมแล้ว)
          const sbp = { ...(cur.stockByPlatform ?? {}) };
          if (inc.stock != null) sbp[platform] = Number(inc.stock);
          const source = srcs.includes(platform)
            ? cur.source
            : [...srcs, platform].join(",");
          next[idx] = {
            ...cur,
            source,
            stockByPlatform: Object.keys(sbp).length ? sbp : undefined,
            stock: unifyStock(sbp) ?? cur.stock,
          };
          if (!srcs.includes(platform)) added++; // นับว่าเชื่อมเพิ่มอีกเจ้า
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
          const sbp = { ...(p.stockByPlatform ?? {}) };
          delete sbp[platform];
          const nextSbp = Object.keys(sbp).length ? sbp : undefined;
          return {
            ...p,
            source: left.join(","),
            stockByPlatform: nextSbp,
            stock: unifyStock(nextSbp) ?? p.stock,
          };
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
        onOpenSettings={() => setMockModalOpen(true)}
      />
      <MockSettingsModal
        open={mockModalOpen}
        onClose={() => setMockModalOpen(false)}
        settings={mockSettings}
        onToggleAll={setAllMock}
      />
      {/* มือถือ: เมนูเป็นแถบล่าง (กันที่ด้วย pb-20) / จอใหญ่: sidebar ซ้ายเปิดค้าง 256px + เว้นช่องกับเนื้อหา */}
      <main className="pb-20 md:pb-0 md:pl-[17rem]">
        {/* ภาพรวมเป็นแดชบอร์ด data-forward → เต็มความกว้างจอ (เหมือน dashboard เต็มจอ) คุมสุดที่ 2560 กันจอ 4K ยืดเกิน
            ส่วนตั้งค่า/คลังสินค้าเป็นฟอร์ม → คง max-w-6xl ไว้ให้ measure อ่านง่าย ไม่ยืดจนล้า
            padding เพิ่มขั้นตามจอ (มือถือ 16 → sm 24 → lg 32 → 2xl 48) กันเนื้อหาชิดขอบบนจอใหญ่ */}
        <div
          className={`mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-8 2xl:px-12 ${
            view === "overview" ? "max-w-[2560px]" : "max-w-6xl"
          }`}
        >
          {view === "overview" && (
            <OverviewView
              onGoInbox={() => setView("inbox")}
              onGoSettings={() => setView("settings")}
            />
          )}
          {view === "inbox" && <InboxView mockSettings={mockSettings} />}
          {view === "settings" && (
            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
              <SettingsView
                shop={shop}
                updateShop={updateShop}
                save={save}
                onSave={handleSave}
              />
              <section className="h-fit rounded-2xl border border-line bg-surface p-5">
                <h2 className="mb-4 text-base font-semibold text-fg">
                  ผลงาน AI · ยอดขาย
                </h2>
                <UpsellMetric key={metricsKey} />
              </section>
            </div>
          )}
          {view === "catalog" && (
            <CatalogView
              products={products}
              updateProduct={updateProduct}
              addProduct={addProduct}
              removeProduct={removeProduct}
              onImport={handleImport}
              onImportUrl={handleImportUrl}
              onImportMarketplace={handleImportMarketplace}
              onDisconnectMarketplace={handleDisconnectMarketplace}
              save={save}
              onSave={handleSave}
              onSync={handleSync}
              syncing={syncing}
              lastSync={lastSync}
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
  onOpenSettings,
}: {
  view: View;
  setView: (v: View) => void;
  username: string;
  onLogout: () => void;
  onOpenSettings: () => void;
}) {
  const items: { key: View; label: string; icon: React.ReactNode }[] = [
    { key: "overview", label: "ภาพรวม", icon: <IconChart /> },
    { key: "inbox", label: "กล่องแชต", icon: <IconChat /> },
    { key: "catalog", label: "คลังสินค้า", icon: <IconList /> },
    { key: "settings", label: "ตั้งค่าร้าน", icon: <IconStore /> },
  ];

  // ป้ายเมนู: จอใหญ่แสดงตลอด (sidebar เปิดค้าง)
  const railLabel = "whitespace-nowrap";

  return (
    /* มือถือ: แถบล่างแนวนอน (นิ้วโป้งเอื้อมถึง) / จอใหญ่: sidebar ซ้ายเปิดค้าง 256px */
    <aside className="group fixed inset-x-0 bottom-0 z-40 flex h-16 flex-row items-stretch overflow-hidden border-t border-line bg-surface md:inset-x-auto md:inset-y-0 md:left-0 md:h-auto md:w-64 md:flex-col md:border-r md:border-t-0">
      {/* โลโก้ (เฉพาะจอใหญ่) — ข้อความ SalesMate เลื่อนออกมาตอน hover/focus */}
      <div className="hidden h-16 items-center gap-3 px-3 md:flex">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/salesmate-logo.svg"
          alt="SalesMate"
          className="h-10 w-10 shrink-0 object-contain"
        />
        <span className="whitespace-nowrap text-lg font-bold tracking-tight text-fg">
          SalesMate
        </span>
      </div>

      {/* หมวดหมู่ — มือถือ: ไอคอน+ป้ายเล็กเรียงแถว / จอใหญ่: แนวตั้ง */}
      <nav className="flex flex-1 flex-row items-center justify-around gap-1 px-1 md:mt-2 md:flex-col md:items-stretch md:justify-start md:px-2">
        {items.map((it) => {
          const active = view === it.key;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => setView(it.key)}
              title={it.label}
              className={`flex min-w-16 flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 transition active:scale-[.96] md:min-w-0 md:flex-row md:items-center md:gap-3 md:px-3 md:py-2.5 md:text-left ${
                active
                  ? "bg-accent/15 text-accent"
                  : "text-muted hover:bg-surface2 hover:text-fg"
              }`}
            >
              <span className="shrink-0">{it.icon}</span>
              <span className="text-[10px] font-medium md:hidden">{it.label}</span>
              <span className={`hidden text-sm font-medium md:inline ${railLabel}`}>{it.label}</span>
            </button>
          );
        })}

        {/* มือถือ: ธีม + ออกจากระบบ อยู่ในแถบล่างด้วย (จอใหญ่ย้ายไปส่วนล่างของ rail) */}
        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <button
            type="button"
            onClick={onLogout}
            aria-label="ออกจากระบบ"
            className="flex min-w-16 flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-muted transition hover:bg-surface2 hover:text-fg"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5M21 12H9" />
            </svg>
            <span className="text-[10px] font-medium">ออก</span>
          </button>
        </div>
      </nav>

      {/* ซ้ายล่าง (เฉพาะจอใหญ่): ดันไปล่างสุดของแถบ (mt-auto) — ข้อมูลทดลอง + บัญชี + ออกจากระบบ + ธีม */}
      <div className="hidden border-t border-line p-2 md:block md:mt-auto">
        <button
          type="button"
          onClick={onOpenSettings}
          title="ข้อมูลทดลอง (mock)"
          className="mb-1 flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-muted transition hover:bg-surface2 hover:text-fg"
        >
          <IconGear />
          <span className={`text-sm font-semibold ${railLabel}`}>ข้อมูลทดลอง</span>
        </button>
        <div className="flex items-center gap-3 rounded-lg px-3 py-1 text-muted">
          <span className={`truncate text-xs ${railLabel}`}>@{username}</span>
        </div>
        <div className="flex items-center gap-2 px-3 pb-1">
          <button
            type="button"
            onClick={onLogout}
            className="whitespace-nowrap rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-surface2"
          >
            ออกจากระบบ
          </button>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}

/* ---------------- โมดัล: ตั้งค่าข้อมูลทดลอง (mock) ---------------- */

const MOCK_PLATFORMS: {
  id: string;
  name: string;
  color: string;
  catalog: boolean;
}[] = [
  { id: "line", name: "LINE", color: "bg-[#06C755]", catalog: false },
  { id: "facebook", name: "Facebook", color: "bg-[#0866FF]", catalog: false },
  { id: "tiktok", name: "TikTok", color: "bg-black", catalog: true },
  { id: "lazada", name: "Lazada", color: "bg-[#0F146E]", catalog: true },
  { id: "shopee", name: "Shopee", color: "bg-[#EE4D2D]", catalog: true },
];

function MockSettingsModal({
  open,
  onClose,
  settings,
  onToggleAll,
}: {
  open: boolean;
  onClose: () => void;
  settings: MockSettings;
  onToggleAll: (on: boolean) => void;
}) {
  if (!open) return null;
  // ทุกแพลตฟอร์มเปิดครบหมดไหม (แชต + สินค้าเฉพาะเจ้าที่มี)
  const allOn = MOCK_PLATFORMS.every(
    (p) => settings[p.id]?.chat === true && (!p.catalog || settings[p.id]?.catalog === true),
  );
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-base font-bold text-fg">
            ตั้งค่าข้อมูลทดลอง (mock)
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="rounded-md p-1 text-muted transition hover:bg-surface2 hover:text-fg"
          >
            <IconX />
          </button>
        </div>
        <p className="mb-3 text-xs text-muted">
          เปิด = โชว์ข้อมูลตัวอย่างให้ลองเล่น (ยอดขายจะเป็น ฿0) · ปิด = ใช้ของจริง แล้วรีเซ็ตข้อมูลเดโมเหลือ 0
        </p>
        <div className="mb-3 flex items-center justify-between rounded-lg bg-surface2 px-3 py-2.5">
          <span className="text-sm font-semibold text-fg">
            เปิดข้อมูลทดลอง (ทุกแพลตฟอร์ม)
          </span>
          <EnableToggle
            enabled={allOn}
            onToggle={() => onToggleAll(!allOn)}
            label="เปิด/ปิดข้อมูลทดลองทั้งหมด"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MOCK_PLATFORMS.filter((p) => !HIDDEN_PLATFORMS.includes(p.id)).map((p) => (
            <span
              key={p.id}
              className="flex items-center gap-1.5 rounded-full bg-surface2 px-2.5 py-1 text-xs text-muted"
            >
              <span className={`h-3 w-3 rounded-sm ${p.color}`} />
              {p.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function IconChart() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" />
      <path d="M7 15v3M12 10v8M17 6v12" />
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
function IconX() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
function IconRefresh({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 11-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}
function IconLink({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </svg>
  );
}
function IconSparkle({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" />
    </svg>
  );
}
function IconChevronDown({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
/** เลขลำดับขั้นตอน (แทน 1️⃣2️⃣ เดิม) — วงกลมจางสี accent อ่านชัดทั้งสองธีม */
function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-bold tabular-nums text-accent">
      {n}
    </span>
  );
}
function IconGear() {
  return (
    <svg className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">ตั้งค่าร้าน</h2>
        <SaveButton save={save} onSave={onSave} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* ซ้าย: ข้อมูลร้านพื้นฐาน */}
        <div className="space-y-4">
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

        {/* ขวา: สิ่งที่ AI ควรจำ (ข้อมูล/นโยบายร้าน) */}
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/20">
          <h3 className="text-sm font-semibold text-fg">
            สิ่งที่ AI ควรจำ
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            ใส่ข้อมูล/นโยบายร้านที่อยากให้ AI ตอบลูกค้าได้เอง เช่น ค่าส่ง วิธีจ่ายเงิน เก็บเงินปลายทาง
            การรับประกัน เวลาทำการ ที่ตั้งร้าน — เรื่องไหนไม่ได้ใส่ AI จะขอเช็คกับแอดมินให้
          </p>
          <textarea
            value={shop.memory}
            onChange={(e) => updateShop({ memory: e.target.value })}
            placeholder={
              "เช่น\n• ส่งฟรีเมื่อซื้อครบ 500 บาท ส่งทุกวันจันทร์–เสาร์\n• รับเก็บเงินปลายทาง (COD) ได้\n• โอนพร้อมเพย์ 081-xxx-xxxx\n• รับประกันสินค้า 7 วัน เปลี่ยน/คืนได้ถ้าชำรุด\n• ร้านอยู่ราชบุรี ส่ง Kerry / ไปรษณีย์ไทย"
            }
            rows={8}
            className={`${inputClass} mt-2`}
          />
        </div>
      </div>

      <LineConnectBox />
      <FacebookConnectBox />
      {SHOW_COMING_SOON_CHANNELS && <TiktokConnectBox />}
      <LazadaConnectBox />
      {SHOW_COMING_SOON_CHANNELS && <ShopeeConnectBox />}
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
        <span className="flex items-center gap-1.5 text-sm font-semibold text-green-800 dark:text-green-300">
          <SiLine className="h-4 w-4 shrink-0" aria-hidden="true" />
          เชื่อม LINE OA
          {status?.mock && (
            <span className="text-xs font-normal text-green-600 dark:text-green-400">
              (โหมดทดลอง)
            </span>
          )}
        </span>
        {connected ? (
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-contrast">
            เชื่อมแล้ว
          </span>
        ) : (
          <span className="rounded-full bg-surface2 px-2 py-0.5 text-xs font-semibold text-muted">
            ยังไม่เชื่อม
          </span>
        )}
      </div>

      {connected ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-fg">
              OA: <b>{status?.displayName || "—"}</b>{" "}
              <span className="text-muted">{status?.basicId}</span>
            </span>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="ml-auto rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-surface2 disabled:opacity-50"
            >
              ยกเลิกการเชื่อมต่อ
            </button>
          </div>
          <p className="text-xs text-muted">
            ตั้งค่า “ให้ AI ตอบเองอัตโนมัติ” ได้ที่หน้า <b>กล่องแชต</b> (สวิตช์ข้างไอคอน LINE)
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="space-y-3 text-xs text-muted">
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              ต้องมี <b>LINE Official Account (บัญชีทางการของร้าน)</b> ก่อน — ยังไม่มี สมัครฟรีที่{" "}
              <a
                href="https://manager.line.biz"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                manager.line.biz
              </a>
            </p>

            <div>
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-fg">
                <StepBadge n={1} />
                เอารหัส 2 ตัวจากเว็บ LINE Developers
              </p>
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>
                  เข้า{" "}
                  <a
                    href="https://developers.line.biz/console/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline"
                  >
                    developers.line.biz
                  </a>{" "}
                  → ล็อกอินด้วย LINE ของร้าน → กดเลือกบัญชี OA ของร้าน
                </li>
                <li>
                  เปิดแท็บ <b>Basic settings</b> → เลื่อนหา <b>Channel secret</b> → กดคัดลอกไว้
                </li>
                <li>
                  เปิดแท็บ <b>Messaging API</b> → ที่หัวข้อ <b>Channel access token</b> กดปุ่ม{" "}
                  <b>Issue</b> → กดคัดลอกไว้
                </li>
              </ol>
            </div>

            <div>
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-fg">
                <StepBadge n={2} />
                วางลิงก์รับข้อความ (Webhook)
              </p>
              <p>
                ยังอยู่แท็บ <b>Messaging API</b> → เอาลิงก์ข้างล่างนี้ไปวางช่อง{" "}
                <b>Webhook URL</b> → กด <b>Update</b> → เปิดสวิตช์ <b>“Use webhook”</b>
              </p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-app px-2 py-1 text-[11px] text-fg">
                  {status?.webhookUrl ?? "…"}
                </code>
                <button
                  type="button"
                  onClick={copyWebhook}
                  className="shrink-0 rounded border border-line px-2 py-1 text-[11px] font-medium text-muted hover:bg-surface2"
                >
                  {copied ? "คัดลอกแล้ว ✓" : "คัดลอก"}
                </button>
              </div>
            </div>

            <div>
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-fg">
                <StepBadge n={3} />
                ปิดบอทอัตโนมัติเดิม (กันตอบชนกับ AI)
              </p>
              <p>
                กลับไปที่{" "}
                <a
                  href="https://manager.line.biz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline"
                >
                  manager.line.biz
                </a>{" "}
                → ตั้งค่า → <b>การตอบกลับ</b> → ปิด <b>“ตอบกลับอัตโนมัติ”</b> และ{" "}
                <b>“ข้อความทักทาย”</b>
              </p>
            </div>

            <p className="flex items-center gap-1.5 font-medium text-fg">
              <StepBadge n={4} />
              <span>
                เอา <b>Channel secret</b> + <b>access token</b> มาวาง 2 ช่องล่างนี้ แล้วกด “เชื่อม LINE”
              </span>
            </p>
          </div>

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

function FacebookConnectBox() {
  const [status, setStatus] = useState<FacebookChannelStatus | null>(null);
  const [pages, setPages] = useState<{ id: string; name: string }[]>([]);
  const [pickId, setPickId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/facebook/connect/status");
      if (r.ok) setStatus((await r.json()) as FacebookChannelStatus);
    } catch {
      /* เงียบไว้ */
    }
  }, []);

  const loadPages = useCallback(async () => {
    try {
      const r = await fetch("/api/facebook/oauth/pages");
      if (!r.ok) return;
      const d = (await r.json()) as { pages: { id: string; name: string }[] };
      setPages(d.pages ?? []);
      if (d.pages?.[0]) setPickId((cur) => cur || d.pages[0].id);
    } catch {
      /* เงียบไว้ */
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadPages();
    // อ่านผลลัพธ์ที่เด้งกลับมาจาก Facebook (?fb=...)
    const sp = new URLSearchParams(window.location.search);
    const fb = sp.get("fb");
    if (fb) {
      const reason = sp.get("reason");
      const map: Record<string, string> = {
        connected: "เชื่อม Facebook สำเร็จ",
        choose: "คุณมีหลายเพจ — เลือกเพจที่จะใช้ด้านล่าง",
        nopage: "ไม่พบเพจที่คุณเป็นแอดมิน — สร้างเพจก่อนแล้วลองใหม่",
        error: reason ? `เชื่อมไม่สำเร็จ: ${reason}` : "เชื่อมไม่สำเร็จ ลองใหม่อีกครั้ง",
        error_state:
          "เซสชันหมดอายุหรือไม่ตรง — กดเชื่อมใหม่ (เข้าผ่าน salesmate.chat และอย่ารอเกิน 10 นาที)",
        noapp: "ระบบยังไม่ได้ตั้งค่า Facebook (ผู้ดูแลต้องตั้ง FB_APP_ID/SECRET)",
      };
      setNotice(map[fb] ?? "");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [loadStatus, loadPages]);

  async function selectPage() {
    if (busy || !pickId) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/facebook/oauth/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pageId: pickId }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) {
        setErr(d.error || "เลือกเพจไม่สำเร็จ");
        return;
      }
      setPages([]);
      setNotice("เชื่อม Facebook สำเร็จ");
      await loadStatus();
    } catch {
      setErr("เลือกเพจไม่สำเร็จ ลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  async function connectManual() {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/facebook/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessToken: token.trim() }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) {
        setErr(d.error || "เชื่อมไม่สำเร็จ");
        return;
      }
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
    if (!window.confirm("ยกเลิกการเชื่อมต่อเพจ Facebook นี้?")) return;
    setBusy(true);
    await fetch("/api/facebook/connect/disconnect", { method: "POST" }).catch(() => {});
    await loadStatus();
    setBusy(false);
  }

  function copy(text: string, key: string) {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    });
  }

  const connected = status?.connected;

  return (
    <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900/60 dark:bg-blue-950/20">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-blue-800 dark:text-blue-300">
          <SiFacebook className="h-4 w-4 shrink-0" aria-hidden="true" />
          เชื่อม Facebook (Messenger)
          {status?.mock && (
            <span className="text-xs font-normal text-blue-600 dark:text-blue-400">
              (โหมดทดลอง)
            </span>
          )}
        </span>
        {connected ? (
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-contrast">
            เชื่อมแล้ว
          </span>
        ) : (
          <span className="rounded-full bg-surface2 px-2 py-0.5 text-xs font-semibold text-muted">
            ยังไม่เชื่อม
          </span>
        )}
      </div>

      {connected ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-fg">
              เพจ: <b>{status?.pageName || "—"}</b>
            </span>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="ml-auto rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-surface2 disabled:opacity-50"
            >
              ยกเลิกการเชื่อมต่อ
            </button>
          </div>
          <p className="text-xs text-muted">
            ตั้งค่า “ให้ AI ตอบเองอัตโนมัติ” ได้ที่หน้า <b>กล่องแชต</b> (สวิตช์ข้างไอคอน Facebook)
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {notice && (
            <p className="rounded-lg bg-blue-100 px-3 py-2 text-xs text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
              {notice}
            </p>
          )}
          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}

          {pages.length > 0 ? (
            // มีหลายเพจ → ให้เลือก
            <div className="space-y-2">
              <p className="text-sm text-fg">เลือกเพจที่จะใช้:</p>
              <select
                value={pickId}
                onChange={(e) => setPickId(e.target.value)}
                className={inputClass}
              >
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={selectPage}
                disabled={busy || !pickId}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? "กำลังเชื่อม…" : "ใช้เพจนี้"}
              </button>
            </div>
          ) : (
            // ยังไม่เชื่อม → ปุ่มคลิกเดียว
            <div className="space-y-2">
              <a
                href="/api/facebook/oauth/start"
                className="inline-flex items-center gap-2 rounded-lg bg-[#0866FF] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0654cc]"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.9 3.78-3.9 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.9h-2.34V22c4.78-.76 8.44-4.92 8.44-9.94z" />
                </svg>
                เชื่อม Facebook (เข้าสู่ระบบ)
              </a>
              <p className="text-xs text-muted">
                กดแล้วล็อกอิน Facebook → เลือกเพจร้าน → เสร็จเลย (ระบบตั้งค่าให้อัตโนมัติ)
              </p>
            </div>
          )}

          {/* ขั้นสูง / ผู้ดูแลระบบ — ตั้งค่าระดับแอป + วาง token เอง */}
          <details className="rounded-lg border border-blue-200 bg-white/60 p-2 text-xs dark:border-blue-900/60 dark:bg-gray-800/40">
            <summary className="cursor-pointer font-medium text-blue-800 dark:text-blue-300">
              ขั้นสูง (สำหรับผู้ดูแลระบบ)
            </summary>
            {status && !status.configured && (
              <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                ยังไม่ได้ตั้ง env <code>FB_APP_ID</code>, <code>FB_APP_SECRET</code>,{" "}
                <code>FB_VERIFY_TOKEN</code> — ปุ่มเชื่อมจะใช้ไม่ได้ (mock ใส่ token ขึ้นต้น mock- ได้)
              </p>
            )}
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted">
              <li>
                ใส่ Callback URL นี้ในหน้า Webhooks ของ Meta:
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-app px-2 py-1 text-[11px] text-fg">
                    {status?.webhookUrl ?? "…"}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(status?.webhookUrl ?? "", "wh")}
                    className="shrink-0 rounded border border-line px-2 py-1 text-[11px] font-medium text-muted hover:bg-surface2"
                  >
                    {copied === "wh" ? "คัดลอกแล้ว ✓" : "คัดลอก"}
                  </button>
                </div>
              </li>
              <li>
                เพิ่ม Redirect URI นี้ใน Facebook Login → Valid OAuth Redirect URIs:
                <div className="mt-1">
                  <code className="block truncate rounded bg-app px-2 py-1 text-[11px] text-fg">
                    {(status?.webhookUrl ?? "").replace("/webhook", "/oauth/callback") || "…"}
                  </code>
                </div>
              </li>
            </ol>
            <div className="mt-2 space-y-2 border-t border-line pt-2">
              <p className="text-muted">วาง Page Access Token เอง (หรือ mock- เพื่อทดลอง):</p>
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Page Access Token (หรือ mock-…)"
                className={inputClass}
              />
              <button
                type="button"
                onClick={connectManual}
                disabled={busy || !token.trim()}
                className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:bg-transparent dark:text-blue-300"
              >
                {busy ? "กำลังเชื่อม…" : "เชื่อมด้วย token"}
              </button>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function TiktokConnectBox() {
  const [status, setStatus] = useState<TiktokChannelStatus | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/tiktok/connect/status");
      if (r.ok) setStatus((await r.json()) as TiktokChannelStatus);
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
      const r = await fetch("/api/tiktok/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessToken: token.trim() }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) {
        setErr(d.error || "เชื่อมไม่สำเร็จ");
        return;
      }
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
    if (!window.confirm("ยกเลิกการเชื่อมต่อแชต TikTok นี้?")) return;
    setBusy(true);
    await fetch("/api/tiktok/connect/disconnect", { method: "POST" }).catch(() => {});
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
    <div className="mt-6 rounded-xl border border-line bg-surface2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <SiTiktok className="h-4 w-4 shrink-0" aria-hidden="true" />
          เชื่อมแชต TikTok
          {status?.mock && (
            <span className="text-xs font-normal text-muted">
              (โหมดทดลอง)
            </span>
          )}
        </span>
        {connected ? (
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-contrast">
            เชื่อมแล้ว
          </span>
        ) : (
          <span className="rounded-full bg-surface2 px-2 py-0.5 text-xs font-semibold text-muted">
            ยังไม่เชื่อม
          </span>
        )}
      </div>

      {connected ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-fg">
              ร้าน: <b>{status?.accountName || "—"}</b>
            </span>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="ml-auto rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-surface2 disabled:opacity-50"
            >
              ยกเลิกการเชื่อมต่อ
            </button>
          </div>
          <p className="text-xs text-muted">
            ตั้งค่า “ให้ AI ตอบเองอัตโนมัติ” ได้ที่หน้า <b>กล่องแชต</b> (สวิตช์ข้างไอคอน TikTok)
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            แชต TikTok ต้องสมัครเป็น TikTok Shop Partner ก่อน (API จำกัดกว่าเจ้าอื่น) —
            ตอนนี้ใส่ token ขึ้นต้น <code>mock-</code> เพื่อทดลองก่อนได้ พอได้สิทธิ์จริงค่อยใส่ token จริง
          </p>

          <details className="rounded-lg border border-line bg-surface2 p-2 text-xs">
            <summary className="cursor-pointer font-medium text-fg">
              ตั้งค่าระดับแอป (ทำครั้งเดียว)
            </summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted">
              <li>
                ตั้ง env <code>TIKTOK_CHAT_SECRET</code> (ใช้ verify webhook)
              </li>
              <li>
                ใส่ Webhook URL นี้ในตั้งค่าแอป TikTok:
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-app px-2 py-1 text-[11px] text-fg">
                    {status?.webhookUrl ?? "…"}
                  </code>
                  <button
                    type="button"
                    onClick={copyWebhook}
                    className="shrink-0 rounded border border-line px-2 py-1 text-[11px] font-medium text-muted hover:bg-surface2"
                  >
                    {copied ? "คัดลอกแล้ว ✓" : "คัดลอก"}
                  </button>
                </div>
              </li>
            </ol>
          </details>

          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Access Token (หรือ mock-… เพื่อทดลอง)"
            className={inputClass}
          />
          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
          <button
            type="button"
            onClick={connect}
            disabled={busy || !token.trim()}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-contrast transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "กำลังเชื่อม…" : "เชื่อม TikTok"}
          </button>
        </div>
      )}
    </div>
  );
}

function LazadaConnectBox() {
  const [status, setStatus] = useState<LazadaChannelStatus | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/lazada/connect/status");
      if (r.ok) setStatus((await r.json()) as LazadaChannelStatus);
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
      const r = await fetch("/api/lazada/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessToken: token.trim() }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) {
        setErr(d.error || "เชื่อมไม่สำเร็จ");
        return;
      }
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
    if (!window.confirm("ยกเลิกการเชื่อมต่อแชต Lazada นี้?")) return;
    setBusy(true);
    await fetch("/api/lazada/connect/disconnect", { method: "POST" }).catch(() => {});
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
    <div className="mt-6 rounded-xl border border-line bg-surface2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <LazadaMark className="h-4 w-4 shrink-0" />
          เชื่อมแชต Lazada
          {status?.mock && (
            <span className="text-xs font-normal text-muted">
              (โหมดทดลอง)
            </span>
          )}
        </span>
        {connected ? (
          status?.expired ? (
            <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
              การเชื่อมต่อหลุด
            </span>
          ) : status?.atRisk ? (
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">
              กำลังจะหมดอายุ
            </span>
          ) : (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-contrast">
              เชื่อมแล้ว
            </span>
          )
        ) : (
          <span className="rounded-full bg-surface2 px-2 py-0.5 text-xs font-semibold text-muted">
            ยังไม่เชื่อม
          </span>
        )}
      </div>

      {connected ? (
        <div className="mt-3 space-y-3">
          {/* token หมดอายุ = Lazada หยุดส่งแชตใหม่เข้าเว็บ — ต้องบอกตรงนี้ดังๆ ไม่ปล่อยเงียบ */}
          {status?.expired && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/40">
              <p className="font-semibold text-red-700 dark:text-red-300">
                การเชื่อมต่อ Lazada หลุด — แชตใหม่จะไม่เข้าเว็บจนกว่าจะเชื่อมใหม่
              </p>
              <a
                href="/api/lazada/connect/start"
                className="mt-2 inline-flex items-center gap-2 rounded-lg bg-[#0F146E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0a0e52]"
              >
                เชื่อม Lazada ใหม่ (เข้าสู่ระบบ)
              </a>
            </div>
          )}
          {/* ยังไม่หมด แต่ต่ออายุอัตโนมัติล้มเหลว — เตือนเหลืองให้เชื่อมใหม่ก่อนแชตหยุด */}
          {!status?.expired && status?.atRisk && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
              <p className="font-semibold text-amber-700 dark:text-amber-300">
                การเชื่อมต่อ Lazada กำลังจะหมดอายุ — ต่ออายุอัตโนมัติไม่สำเร็จ ควรกดเชื่อมใหม่เพื่อไม่ให้แชตหยุด
              </p>
              <a
                href="/api/lazada/connect/start"
                className="mt-2 inline-flex items-center gap-2 rounded-lg bg-[#0F146E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0a0e52]"
              >
                เชื่อม Lazada ใหม่ (เข้าสู่ระบบ)
              </a>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-fg">
              ร้าน: <b>{status?.accountName || "—"}</b>
            </span>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="ml-auto rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-surface2 disabled:opacity-50"
            >
              ยกเลิกการเชื่อมต่อ
            </button>
          </div>
          <p className="text-xs text-muted">
            ตั้งค่า “ให้ AI ตอบเองอัตโนมัติ” ได้ที่หน้า <b>กล่องแชต</b> (สวิตช์ข้างไอคอน Lazada)
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <a
            href="/api/lazada/connect/start"
            className="inline-flex items-center gap-2 rounded-lg bg-[#0F146E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0a0e52]"
          >
            <LazadaMark className="h-4 w-4" />
            เชื่อม Lazada (เข้าสู่ระบบ)
          </a>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
            <li>กดปุ่มด้านบน → ล็อกอินบัญชี <b>Lazada Seller</b> ของร้าน</li>
            <li>
              กด <b>อนุญาต (Authorize)</b> ให้ระบบเข้าถึงแชตของร้าน
            </li>
            <li>ระบบดึง Token ให้เอง — เสร็จเลย ไม่ต้องคัดลอกอะไร</li>
          </ol>

          <details className="rounded-lg border border-line bg-surface2 p-2 text-xs">
            <summary className="cursor-pointer font-medium text-fg">
              ขั้นสูง (สำหรับผู้ดูแลระบบ)
            </summary>
            <div className="mt-2 space-y-2 text-muted">
              <p>
                ตั้งครั้งเดียวระดับแอป: env <code>LAZADA_IM_APP_KEY</code> /{" "}
                <code>LAZADA_IM_APP_SECRET</code> (เชื่อมแชต) + <code>LAZADA_CHAT_SECRET</code>{" "}
                (verify webhook)
              </p>
              <div>
                Webhook URL (ใส่ในตั้งค่า Push Notification ของแอป Lazada):
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-app px-2 py-1 text-[11px] text-fg">
                    {status?.webhookUrl ?? "…"}
                  </code>
                  <button
                    type="button"
                    onClick={copyWebhook}
                    className="shrink-0 rounded border border-line px-2 py-1 text-[11px] font-medium text-muted hover:bg-surface2"
                  >
                    {copied ? "คัดลอกแล้ว ✓" : "คัดลอก"}
                  </button>
                </div>
              </div>
              <div>
                หรือใส่ Access Token เอง (หรือ <code>mock-…</code> เพื่อทดลอง):
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Access Token (หรือ mock-…)"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={connect}
                    disabled={busy || !token.trim()}
                    className="shrink-0 rounded-lg bg-[#0F146E] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[#0a0e52] disabled:opacity-50"
                  >
                    {busy ? "…" : "เชื่อม"}
                  </button>
                </div>
              </div>
              {err && <p className="text-red-500">{err}</p>}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function ShopeeConnectBox() {
  const [status, setStatus] = useState<ShopeeChannelStatus | null>(null);
  const [token, setToken] = useState("");
  const [shopId, setShopId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/shopee/connect/status");
      if (r.ok) setStatus((await r.json()) as ShopeeChannelStatus);
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
      const r = await fetch("/api/shopee/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessToken: token.trim(), shopId: shopId.trim() }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) {
        setErr(d.error || "เชื่อมไม่สำเร็จ");
        return;
      }
      setToken("");
      setShopId("");
      await loadStatus();
    } catch {
      setErr("เชื่อมไม่สำเร็จ ลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    if (!window.confirm("ยกเลิกการเชื่อมต่อแชต Shopee นี้?")) return;
    setBusy(true);
    await fetch("/api/shopee/connect/disconnect", { method: "POST" }).catch(() => {});
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
    <div className="mt-6 rounded-xl border border-line bg-surface2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <SiShopee className="h-4 w-4 shrink-0" aria-hidden="true" />
          เชื่อมแชต Shopee
          {status?.mock && (
            <span className="text-xs font-normal text-muted">
              (โหมดทดลอง)
            </span>
          )}
        </span>
        {connected ? (
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-contrast">
            เชื่อมแล้ว
          </span>
        ) : (
          <span className="rounded-full bg-surface2 px-2 py-0.5 text-xs font-semibold text-muted">
            ยังไม่เชื่อม
          </span>
        )}
      </div>

      {connected ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-fg">
              ร้าน: <b>{status?.accountName || "—"}</b>
            </span>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="ml-auto rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-surface2 disabled:opacity-50"
            >
              ยกเลิกการเชื่อมต่อ
            </button>
          </div>
          <p className="text-xs text-muted">
            ตั้งค่า “ให้ AI ตอบเองอัตโนมัติ” ได้ที่หน้า <b>กล่องแชต</b> (สวิตช์ข้างไอคอน Shopee)
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">
            Shopee เปิด Chat API กว้างที่สุดในสาม marketplace — ใช้ Access Token + Shop ID จากการเชื่อม Shopee
            (โหมดทดลองใส่ token ขึ้นต้น <code>mock-</code> ได้เลย ไม่ต้องใส่ Shop ID)
          </p>

          <details className="rounded-lg border border-line bg-surface2 p-2 text-xs">
            <summary className="cursor-pointer font-medium text-fg">
              ตั้งค่าระดับแอป (ทำครั้งเดียว)
            </summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted">
              <li>
                ตั้ง env <code>SHOPEE_PARTNER_ID</code> + <code>SHOPEE_PARTNER_KEY</code> (ใช้เซ็น + verify webhook)
              </li>
              <li>
                ใส่ Push URL นี้ในตั้งค่า Shopee Open Platform (Push Mechanism):
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-app px-2 py-1 text-[11px] text-fg">
                    {status?.webhookUrl ?? "…"}
                  </code>
                  <button
                    type="button"
                    onClick={copyWebhook}
                    className="shrink-0 rounded border border-line px-2 py-1 text-[11px] font-medium text-muted hover:bg-surface2"
                  >
                    {copied ? "คัดลอกแล้ว ✓" : "คัดลอก"}
                  </button>
                </div>
              </li>
            </ol>
          </details>

          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Access Token (หรือ mock-… เพื่อทดลอง)"
            className={inputClass}
          />
          <input
            type="text"
            value={shopId}
            onChange={(e) => setShopId(e.target.value)}
            placeholder="Shop ID (เว้นว่างได้ในโหมดทดลอง)"
            className={inputClass}
          />
          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
          <button
            type="button"
            onClick={connect}
            disabled={busy || !token.trim()}
            className="rounded-lg bg-[#EE4D2D] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[#d8431f] disabled:opacity-50"
          >
            {busy ? "กำลังเชื่อม…" : "เชื่อม Shopee"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- หมวด: รายการคู่พ่วงและคลังสินค้า ---------------- */

function CatalogView({
  products,
  updateProduct,
  addProduct,
  removeProduct,
  onImport,
  onImportUrl,
  onImportMarketplace,
  onDisconnectMarketplace,
  save,
  onSave,
  onSync,
  syncing,
  lastSync,
}: {
  products: Product[];
  updateProduct: (id: string, patch: Partial<Product>) => void;
  addProduct: () => void;
  removeProduct: (id: string) => void;
  onImport: (text: string) => Promise<{ products: number }>;
  onImportUrl: (url: string) => Promise<{ products: number }>;
  onImportMarketplace: (platform: string) => Promise<number>;
  onDisconnectMarketplace: (platform: string) => Promise<void>;
  save: SaveState;
  onSave: () => void;
  onSync: (opts?: { silent?: boolean }) => Promise<void>;
  syncing: boolean;
  lastSync: number | null;
}) {
  // ซิงค์สต็อกอัตโนมัติ: ตอนเปิดหน้าคลังสินค้า + ทุก 45 วิ ระหว่างเปิดหน้าอยู่
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;
  useEffect(() => {
    void onSyncRef.current({ silent: true });
    const id = setInterval(() => void onSyncRef.current({ silent: true }), 45000);
    return () => clearInterval(id);
  }, []);

  // ค้นหาสินค้า (กรองตามชื่อ/คำอธิบาย แต่คงเลขลำดับเดิมไว้)
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const shown = products
    .map((product, i) => ({ product, i }))
    .filter(
      ({ product }) =>
        !ql ||
        product.name.toLowerCase().includes(ql) ||
        product.description.toLowerCase().includes(ql),
    );

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-fg">
          คลังสินค้า
        </h2>
        <SaveButton save={save} onSave={onSave} />
      </div>

      {/* เชื่อมต่อ marketplace (Lazada / Shopee / TikTok) */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MARKETPLACES.filter((cfg) => !HIDDEN_PLATFORMS.includes(cfg.platform)).map((cfg) => (
          <MarketplaceBox
            key={cfg.platform}
            cfg={cfg}
            onImport={() => onImportMarketplace(cfg.platform)}
            onDisconnect={() => onDisconnectMarketplace(cfg.platform)}
          />
        ))}
      </div>

      {/* วางลิงก์สินค้า → AI ดึงจากหน้าเว็บ */}
      <ImportUrlBox onImportUrl={onImportUrl} />

      {/* นำเข้าอัตโนมัติ อยู่บนกลาง เต็มความกว้าง */}
      <ImportBox onImport={onImport} />

      {/* แถบซิงค์สต็อก — ดึงจำนวนคงเหลือล่าสุดจาก marketplace ที่เชื่อมไว้ */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2">
        <button
          type="button"
          onClick={() => void onSync()}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-contrast transition hover:opacity-90 disabled:opacity-50"
        >
          <IconRefresh className={syncing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          {syncing ? "กำลังซิงค์…" : "ซิงค์สต็อก"}
        </button>
        <span className="text-xs text-muted">
          {lastSync
            ? `ซิงค์ล่าสุด ${new Date(lastSync).toLocaleTimeString("th-TH")}`
            : "ดึงจำนวนคงเหลือล่าสุดจาก marketplace ที่เชื่อมไว้"}{" "}
          · อัปเดตอัตโนมัติทุก 45 วิ
        </span>
      </div>

      <div className="mt-4 rounded-xl border border-line p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg">
            รายการสินค้า{" "}
            <span className="text-xs font-normal text-muted">({products.length})</span>
          </h3>
          <button type="button" onClick={addProduct} className={secondaryBtnClass}>
            + เพิ่มสินค้า
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          AI ใช้สินค้าเหล่านี้ตอบลูกค้าและแนะนำสินค้าที่เข้ากัน
        </p>

        {products.length > 0 && (
          <div className="mt-3">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาสินค้า… (ชื่อ หรือ คำอธิบาย)"
              className={inputClass}
            />
            {ql && (
              <p className="mt-1 text-xs text-muted">
                พบ {shown.length} จาก {products.length} รายการ
              </p>
            )}
          </div>
        )}

        {products.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-line bg-surface2 px-3 py-6 text-center text-sm text-muted">
            ยังไม่มีสินค้า — กด “+ เพิ่มสินค้า” หรือดึงจาก marketplace ด้านบน
          </p>
        ) : shown.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-line bg-surface2 px-3 py-6 text-center text-sm text-muted">
            ไม่พบสินค้าที่ตรงกับ “{q}”
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {shown.map(({ product, i }) => (
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
        enabled ? "bg-accent" : "border border-line bg-surface2"
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
  const sbp = product.stockByPlatform;
  const perPlatform = sources
    .map((s) => ({ s, n: sbp?.[s] }))
    .filter((x): x is { s: string; n: number } => typeof x.n === "number");
  // สต็อกแต่ละเจ้าไม่เท่ากันไหม → ถ้าไม่เท่า โชว์ตัวเลขติดข้างไอคอนแต่ละเจ้า
  const stocksDiffer =
    perPlatform.length >= 2 && !perPlatform.every((x) => x.n === perPlatform[0].n);
  const fileRef = useRef<HTMLInputElement>(null);
  const [imgBusy, setImgBusy] = useState(false);
  // ลบ 2 จังหวะ: แตะแรก = ขอยืนยัน (ถอยเองใน 4 วิ) — กันมือลั่นลบถาวรแล้ว autosave ทับ
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // ให้เลือกไฟล์เดิมซ้ำได้
    if (!f) return;
    setImgBusy(true);
    try {
      onChange({ image: await fileToResizedDataUrl(f) });
    } catch {
      /* ย่อรูปไม่สำเร็จ — เงียบไว้ */
    }
    setImgBusy(false);
  }

  return (
    <div
      className={`rounded-lg border p-3 transition ${
        enabled
          ? "border-line bg-surface2"
          : "border-line bg-surface opacity-60"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted">
          สินค้า #{index + 1}
          {!enabled && (
            <span className="rounded bg-surface2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
              ปิดอยู่
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
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              onRemove();
            }}
            className={`rounded-lg px-2 py-1 text-xs font-medium transition ${
              confirmDelete
                ? "bg-red-600 text-white hover:bg-red-700"
                : "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
            }`}
            aria-label={`ลบสินค้าที่ ${index + 1}`}
          >
            {confirmDelete ? "ยืนยันลบ?" : "ลบ"}
          </button>
        </div>
      </div>

      {/* รูปสินค้า — อัปโหลดจากเครื่อง (ย่ออัตโนมัติ) */}
      <div className="mb-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-app"
          aria-label={`รูปสินค้าที่ ${index + 1}`}
        >
          {product.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image}
              alt={product.name || "รูปสินค้า"}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-[10px] text-muted">＋ รูป</span>
          )}
        </button>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={imgBusy}
            className="rounded border border-line px-2 py-1 text-[11px] font-medium text-muted transition hover:bg-surface2 disabled:opacity-50"
          >
            {imgBusy ? "กำลังย่อรูป…" : product.image ? "เปลี่ยนรูป" : "อัปโหลดรูป"}
          </button>
          {product.image && (
            <button
              type="button"
              onClick={() => onChange({ image: "" })}
              className="text-left text-[11px] text-red-500 hover:underline"
            >
              ลบรูป
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPickImage}
        />
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
        {stocksDiffer ? (
          // สต็อกแต่ละเจ้าไม่ตรงกัน → แทนกล่องคงเหลือ ด้วยรายการ ชื่อเจ้า · จำนวนชิ้น
          <Field label="คงเหลือ (แต่ละเจ้าไม่ตรงกัน)" compact>
            <div className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-lg border border-line bg-app px-3 py-2">
              {perPlatform.map(({ s, n }) =>
                PLATFORM_BADGE[s] ? (
                  <span key={s} className={PLATFORM_BADGE[s].cls}>
                    {PLATFORM_BADGE[s].label} · {n} ชิ้น
                  </span>
                ) : null,
              )}
            </div>
          </Field>
        ) : (
          <Field label="คงเหลือ (ชิ้น, ว่างได้)" compact>
            <input
              type="text"
              inputMode="numeric"
              value={product.stock != null ? String(product.stock) : ""}
              onChange={(e) => {
                const v = e.target.value.trim();
                onChange({
                  stock: v === "" ? undefined : Math.max(0, parseInt(v, 10) || 0),
                });
              }}
              placeholder="เช่น 12"
              className={inputClass}
            />
          </Field>
        )}
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

      {/* ที่มาแพลตฟอร์ม (โชว์ใต้สินค้า) — จำนวนสต็อกย้ายไปอยู่ช่อง "คงเหลือ" แล้ว */}
      {sources.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2 text-xs text-muted">
          <span>ดึงจาก:</span>
          {sources.map((s) =>
            PLATFORM_BADGE[s] ? (
              <span key={s} className={PLATFORM_BADGE[s].cls}>
                {PLATFORM_BADGE[s].label}
              </span>
            ) : null,
          )}
        </div>
      )}
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
          ? "border border-red-500/30 bg-red-500/10 text-red-500 hover:bg-red-500/20"
          : "bg-accent text-accent-contrast hover:opacity-90"
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
  Icon: (props: { className?: string }) => React.ReactElement;
  box: string;
  title: string;
  mockText: string;
  btn: string;
};

const MARKETPLACES: MktConfig[] = [
  {
    platform: "lazada",
    label: "Lazada",
    Icon: LazadaMark,
    box: "border-orange-200 bg-orange-50/50 dark:border-orange-900/60 dark:bg-orange-950/20",
    title: "text-orange-800 dark:text-orange-300",
    mockText: "text-orange-600 dark:text-orange-400",
    btn: "bg-orange-600 hover:bg-orange-700",
  },
  {
    platform: "shopee",
    label: "Shopee",
    Icon: (p) => <SiShopee className={p.className} aria-hidden="true" />,
    box: "border-red-200 bg-red-50/50 dark:border-red-900/60 dark:bg-red-950/20",
    title: "text-red-800 dark:text-red-300",
    mockText: "text-red-600 dark:text-red-400",
    btn: "bg-red-600 hover:bg-red-700",
  },
  {
    platform: "tiktok",
    label: "TikTok Shop",
    Icon: (p) => <SiTiktok className={p.className} aria-hidden="true" />,
    box: "border-line bg-surface2",
    title: "text-fg",
    mockText: "text-muted",
    btn: "bg-accent text-accent-contrast hover:opacity-90",
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
  tiktok: {
    label: "TikTok",
    cls: "rounded bg-surface2 px-1.5 py-0.5 text-[10px] font-semibold text-fg",
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
        <span className={`flex items-center gap-1.5 text-sm font-semibold ${cfg.title}`}>
          <cfg.Icon className="h-4 w-4 shrink-0" />
          เชื่อมต่อร้านค้า {cfg.label}
          {mock && (
            <span className={`text-xs font-normal ${cfg.mockText}`}>(โหมดทดลอง)</span>
          )}
        </span>
        {connected ? (
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-contrast">
            เชื่อมต่อแล้ว
          </span>
        ) : (
          <span className="rounded-full bg-surface2 px-2 py-0.5 text-xs font-semibold text-muted">
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
          <p className="mt-1 text-xs text-muted">
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
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-surface2 disabled:opacity-50"
          >
            ยกเลิกการเชื่อมต่อ
          </button>
          {msg && (
            <span className="text-xs text-accent">{msg}</span>
          )}
        </div>
      )}
    </div>
  );
}

function ImportUrlBox({
  onImportUrl,
}: {
  onImportUrl: (url: string) => Promise<{ products: number }>;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function run() {
    if (!url.trim() || status === "loading") return;
    setStatus("loading");
    setMsg("");
    try {
      const { products } = await onImportUrl(url.trim());
      if (products === 0) {
        setStatus("error");
        setMsg("ไม่พบสินค้าในลิงก์นี้ — ลองวางลิงก์ “หน้าสินค้า” โดยตรง");
        return;
      }
      setStatus("idle");
      setMsg(`เพิ่มแล้ว: สินค้า ${products} รายการ (ตรวจ/แก้ได้ด้านล่าง)`);
      setUrl("");
    } catch (e) {
      setStatus("error");
      setMsg((e as Error).message || "ดึงข้อมูลไม่สำเร็จ ลองใหม่");
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/50 p-3 dark:border-sky-900 dark:bg-sky-950/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold text-sky-800 dark:text-sky-300">
          <IconLink className="h-4 w-4 shrink-0" />
          วางลิงก์สินค้า — AI ดึงชื่อ/ราคา/รูป จากหน้าเว็บให้เอง
        </span>
        <IconChevronDown
          className={`h-4 w-4 shrink-0 text-sky-700 transition-transform dark:text-sky-400 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void run();
              }}
              placeholder="วางลิงก์สินค้า เช่น https://www.lazada.co.th/products/..."
              className={inputClass}
            />
            <button
              type="button"
              onClick={run}
              disabled={!url.trim() || status === "loading"}
              className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "loading" ? "กำลังดึง…" : "ดึงจากลิงก์"}
            </button>
          </div>
          {msg && (
            <span
              className={`block text-xs ${status === "error" ? "text-red-600 dark:text-red-400" : "text-sky-700 dark:text-sky-400"}`}
            >
              {msg}
            </span>
          )}
          <p className="text-xs text-muted">
            รองรับลิงก์ Lazada และเว็บร้านทั่วไป — ดึงแล้วเพิ่มต่อท้าย ตรวจ/แก้ได้ก่อนใช้จริง
          </p>
        </div>
      )}
    </div>
  );
}

function ImportBox({
  onImport,
}: {
  onImport: (text: string) => Promise<{ products: number }>;
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
      const { products } = await onImport(text);
      if (products === 0) {
        setStatus("error");
        setMsg("ไม่พบข้อมูลที่แยกได้ ลองจัดข้อความให้ชัดขึ้น");
        return;
      }
      setStatus("idle");
      setMsg(`เพิ่มแล้ว: สินค้า ${products} รายการ (ระบบบันทึกให้อัตโนมัติ)`);
      setText("");
    } catch {
      setStatus("error");
      setMsg("แยกข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-accent/30 bg-accent/10 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold text-accent">
          <IconSparkle className="h-4 w-4 shrink-0" />
          นำเข้าอัตโนมัติ — วางข้อความ AI แยกเป็นรายการสินค้าให้เอง
        </span>
        <IconChevronDown
          className={`h-4 w-4 shrink-0 text-accent transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={
              "วางข้อมูลแบบไหนก็ได้ เช่น:\nเซรั่มบำรุงผิว 690 บาท ลดเลือนริ้วรอย\nครีมกันแดด SPF50 350 บาท\nมาส์กหน้า แพ็ก 10 ชิ้น 199"
            }
            className={inputClass}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={run}
              disabled={!text.trim() || status === "loading"}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-contrast transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "loading" ? "กำลังแยกข้อมูล…" : "แยกและเพิ่มอัตโนมัติ"}
            </button>
            {msg && (
              <span
                className={`text-xs ${status === "error" ? "text-red-600 dark:text-red-400" : "text-accent"}`}
              >
                {msg}
              </span>
            )}
          </div>
          <p className="text-xs text-muted">
            แยกแล้วจะเพิ่มต่อท้ายรายการด้านล่าง ตรวจ/แก้ได้ก่อนใช้งานจริง
          </p>
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
