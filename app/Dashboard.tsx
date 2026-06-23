"use client";

import { useState, useEffect, useRef, useCallback, Fragment } from "react";
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
import InboxView from "./InboxView";

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

/** แยก source (CSV) เป็นรายชื่อ platform */
function sourceList(source?: string): string[] {
  return (source ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * รวมสต็อกแยกรายแพลตฟอร์มเป็นเลขเดียว (ที่ใช้ตอบลูกค้า/AI)
 * - ทุกเจ้าเท่ากัน → ใช้เลขนั้น
 * - ไม่เท่ากัน → ใช้ค่ามากสุด (ของยังมี) ส่วนรายละเอียดโชว์ติดข้างไอคอนแต่ละเจ้า
 */
function unifyStock(map?: Record<string, number>): number | undefined {
  if (!map) return undefined;
  const vals = Object.values(map).filter((v) => typeof v === "number");
  if (!vals.length) return undefined;
  return vals.every((v) => v === vals[0]) ? vals[0] : Math.max(...vals);
}

type SaveState = "idle" | "saving" | "saved" | "error";

type View = "inbox" | "settings" | "catalog";

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
  const [view, setView] = useState<View>("inbox");
  const [mockSettings, setMockSettings] = useState<MockSettings>({});
  const [mockModalOpen, setMockModalOpen] = useState(false);

  // โหลดตั้งค่า "ข้อมูลทดลอง (mock)" ต่อร้าน
  useEffect(() => {
    fetch("/api/mock-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.settings) setMockSettings(d.settings as MockSettings);
      })
      .catch(() => {});
  }, []);

  // สลับสวิตช์ข้อมูลทดลองของแพลตฟอร์ม (หมวด chat / catalog) + เซฟทันที
  function toggleMock(platform: string, kind: "chat" | "catalog") {
    setMockSettings((prev) => {
      const base = prev[platform] ?? { chat: true, catalog: true };
      const next: MockSettings = {
        ...prev,
        [platform]: { ...base, [kind]: base[kind] === false },
      };
      void fetch("/api/mock-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: next }),
      }).catch(() => {});
      return next;
    });
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
    if (sp.get("fb")) {
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
        onToggle={toggleMock}
      />
      <main className="pl-16">
        <div
          className={`mx-auto px-4 py-6 sm:py-8 ${
            view === "catalog" || view === "inbox" ? "max-w-6xl" : "max-w-3xl"
          }`}
        >
          {view === "inbox" && <InboxView mockSettings={mockSettings} />}
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
  onOpenSettings,
}: {
  view: View;
  setView: (v: View) => void;
  username: string;
  onLogout: () => void;
  onOpenSettings: () => void;
}) {
  const items: { key: View; label: string; icon: React.ReactNode }[] = [
    { key: "inbox", label: "กล่องแชต", icon: <IconChat /> },
    { key: "catalog", label: "คลังสินค้า", icon: <IconList /> },
    { key: "settings", label: "ตั้งค่าร้าน", icon: <IconStore /> },
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

      {/* ซ้ายล่าง: ปุ่ม Setting (ฟันเฟือง) + บัญชี + ออกจากระบบ + ธีม */}
      <div className="border-t border-gray-200 p-2 dark:border-gray-800">
        <button
          type="button"
          onClick={onOpenSettings}
          title="Setting"
          className="mb-1 flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <IconGear />
          <span className="whitespace-nowrap text-sm font-semibold opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            Setting
          </span>
        </button>
        <div className="flex items-center gap-3 rounded-lg px-3 py-1 text-gray-500 dark:text-gray-400">
          <span className="truncate whitespace-nowrap text-xs opacity-0 transition-opacity duration-200 group-hover:opacity-100">
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
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  settings: MockSettings;
  onToggle: (platform: string, kind: "chat" | "catalog") => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            ตั้งค่าข้อมูลทดลอง (mock)
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          เปิด = โชว์ข้อมูลตัวอย่างให้ลองเล่น · ปิด = ใช้ของจริงล้วน (แยกแชต / สินค้า)
        </p>
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-5 gap-y-3">
          <span className="text-[11px] font-medium text-gray-400">แพลตฟอร์ม</span>
          <span className="w-12 text-center text-[11px] font-medium text-gray-400">
            แชต
          </span>
          <span className="w-12 text-center text-[11px] font-medium text-gray-400">
            สินค้า
          </span>
          {MOCK_PLATFORMS.map((p) => (
            <Fragment key={p.id}>
              <span className="flex items-center gap-2">
                <span className={`h-6 w-6 shrink-0 rounded-md ${p.color}`} />
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {p.name}
                </span>
              </span>
              <span className="flex w-12 justify-center">
                <EnableToggle
                  enabled={settings[p.id]?.chat !== false}
                  onToggle={() => onToggle(p.id, "chat")}
                  label={`ข้อมูลทดลองแชต ${p.name}`}
                />
              </span>
              <span className="flex w-12 justify-center">
                {p.catalog ? (
                  <EnableToggle
                    enabled={settings[p.id]?.catalog !== false}
                    onToggle={() => onToggle(p.id, "catalog")}
                    label={`ข้อมูลทดลองสินค้า ${p.name}`}
                  />
                ) : (
                  <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                )}
              </span>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
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
      <FacebookConnectBox />
      <TiktokConnectBox />
      <LazadaConnectBox />
      <ShopeeConnectBox />
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
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
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
          <p className="text-xs text-gray-500 dark:text-gray-400">
            ตั้งค่า “ให้ AI ตอบเองอัตโนมัติ” ได้ที่หน้า <b>กล่องแชต</b> (สวิตช์ข้างไอคอน LINE)
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="space-y-3 text-xs text-gray-600 dark:text-gray-400">
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              ℹ️ ต้องมี <b>LINE Official Account (บัญชีทางการของร้าน)</b> ก่อน — ยังไม่มี สมัครฟรีที่{" "}
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
              <p className="mb-1 font-semibold text-gray-800 dark:text-gray-200">
                1️⃣ เอารหัส 2 ตัวจากเว็บ LINE Developers
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
              <p className="mb-1 font-semibold text-gray-800 dark:text-gray-200">
                2️⃣ วางลิงก์รับข้อความ (Webhook)
              </p>
              <p>
                ยังอยู่แท็บ <b>Messaging API</b> → เอาลิงก์ข้างล่างนี้ไปวางช่อง{" "}
                <b>Webhook URL</b> → กด <b>Update</b> → เปิดสวิตช์ <b>“Use webhook”</b>
              </p>
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
            </div>

            <div>
              <p className="mb-1 font-semibold text-gray-800 dark:text-gray-200">
                3️⃣ ปิดบอทอัตโนมัติเดิม (กันตอบชนกับ AI)
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

            <p className="font-medium text-gray-800 dark:text-gray-200">
              4️⃣ เอา <b>Channel secret</b> + <b>access token</b> มาวาง 2 ช่องล่างนี้ แล้วกด “เชื่อม LINE” ✅
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
    const fb = new URLSearchParams(window.location.search).get("fb");
    if (fb) {
      const map: Record<string, string> = {
        connected: "เชื่อม Facebook สำเร็จ 🎉",
        choose: "คุณมีหลายเพจ — เลือกเพจที่จะใช้ด้านล่าง",
        nopage: "ไม่พบเพจที่คุณเป็นแอดมิน — สร้างเพจก่อนแล้วลองใหม่",
        error: "เชื่อมไม่สำเร็จ ลองใหม่อีกครั้ง",
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
      setNotice("เชื่อม Facebook สำเร็จ 🎉");
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
        <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">
          📘 เชื่อม Facebook (Messenger){" "}
          {status?.mock && (
            <span className="text-xs font-normal text-blue-600 dark:text-blue-400">
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
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-700 dark:text-gray-200">
              เพจ: <b>{status?.pageName || "—"}</b>
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
          <p className="text-xs text-gray-500 dark:text-gray-400">
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
              <p className="text-sm text-gray-700 dark:text-gray-200">เลือกเพจที่จะใช้:</p>
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
              <p className="text-xs text-gray-500 dark:text-gray-400">
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
                ⚠️ ยังไม่ได้ตั้ง env <code>FB_APP_ID</code>, <code>FB_APP_SECRET</code>,{" "}
                <code>FB_VERIFY_TOKEN</code> — ปุ่มเชื่อมจะใช้ไม่ได้ (mock ใส่ token ขึ้นต้น mock- ได้)
              </p>
            )}
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-gray-600 dark:text-gray-400">
              <li>
                ใส่ Callback URL นี้ในหน้า Webhooks ของ Meta:
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-white px-2 py-1 text-[11px] text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                    {status?.webhookUrl ?? "…"}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(status?.webhookUrl ?? "", "wh")}
                    className="shrink-0 rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    {copied === "wh" ? "คัดลอกแล้ว ✓" : "คัดลอก"}
                  </button>
                </div>
              </li>
              <li>
                เพิ่ม Redirect URI นี้ใน Facebook Login → Valid OAuth Redirect URIs:
                <div className="mt-1">
                  <code className="block truncate rounded bg-white px-2 py-1 text-[11px] text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                    {(status?.webhookUrl ?? "").replace("/webhook", "/oauth/callback") || "…"}
                  </code>
                </div>
              </li>
            </ol>
            <div className="mt-2 space-y-2 border-t border-gray-200 pt-2 dark:border-gray-700">
              <p className="text-gray-600 dark:text-gray-400">วาง Page Access Token เอง (หรือ mock- เพื่อทดลอง):</p>
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
    <div className="mt-6 rounded-xl border border-gray-300 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/40">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          🎵 เชื่อมแชต TikTok{" "}
          {status?.mock && (
            <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
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
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-700 dark:text-gray-200">
              ร้าน: <b>{status?.accountName || "—"}</b>
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
          <p className="text-xs text-gray-500 dark:text-gray-400">
            ตั้งค่า “ให้ AI ตอบเองอัตโนมัติ” ได้ที่หน้า <b>กล่องแชต</b> (สวิตช์ข้างไอคอน TikTok)
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            ℹ️ แชต TikTok ต้องสมัครเป็น TikTok Shop Partner ก่อน (API จำกัดกว่าเจ้าอื่น) —
            ตอนนี้ใส่ token ขึ้นต้น <code>mock-</code> เพื่อทดลองก่อนได้ พอได้สิทธิ์จริงค่อยใส่ token จริง
          </p>

          <details className="rounded-lg border border-gray-300 bg-white/60 p-2 text-xs dark:border-gray-700 dark:bg-gray-800/40">
            <summary className="cursor-pointer font-medium text-gray-800 dark:text-gray-200">
              ตั้งค่าระดับแอป (ทำครั้งเดียว)
            </summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-gray-600 dark:text-gray-400">
              <li>
                ตั้ง env <code>TIKTOK_CHAT_SECRET</code> (ใช้ verify webhook)
              </li>
              <li>
                ใส่ Webhook URL นี้ในตั้งค่าแอป TikTok:
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
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-50 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-white"
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
    <div className="mt-6 rounded-xl border border-gray-300 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/40">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          🛍️ เชื่อมแชต Lazada{" "}
          {status?.mock && (
            <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
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
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-700 dark:text-gray-200">
              ร้าน: <b>{status?.accountName || "—"}</b>
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
          <p className="text-xs text-gray-500 dark:text-gray-400">
            ตั้งค่า “ให้ AI ตอบเองอัตโนมัติ” ได้ที่หน้า <b>กล่องแชต</b> (สวิตช์ข้างไอคอน Lazada)
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            ℹ️ แชต Lazada ใช้ Access Token ตัวเดียวกับฝั่งดึงสินค้า (เชื่อม Lazada ในหน้าคลังสินค้า) —
            ตอนนี้ใส่ token ขึ้นต้น <code>mock-</code> เพื่อทดลองก่อนได้ พอได้สิทธิ์ IM จริงค่อยใส่ token จริง
          </p>

          <details className="rounded-lg border border-gray-300 bg-white/60 p-2 text-xs dark:border-gray-700 dark:bg-gray-800/40">
            <summary className="cursor-pointer font-medium text-gray-800 dark:text-gray-200">
              ตั้งค่าระดับแอป (ทำครั้งเดียว)
            </summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-gray-600 dark:text-gray-400">
              <li>
                ตั้ง env <code>LAZADA_CHAT_SECRET</code> (ใช้ verify webhook)
              </li>
              <li>
                ใส่ Webhook URL นี้ในตั้งค่า Push Notification ของแอป Lazada:
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
            className="rounded-lg bg-[#0F146E] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[#0a0e52] disabled:opacity-50"
          >
            {busy ? "กำลังเชื่อม…" : "เชื่อม Lazada"}
          </button>
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
    <div className="mt-6 rounded-xl border border-gray-300 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/40">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          🛒 เชื่อมแชต Shopee{" "}
          {status?.mock && (
            <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
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
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-700 dark:text-gray-200">
              ร้าน: <b>{status?.accountName || "—"}</b>
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
          <p className="text-xs text-gray-500 dark:text-gray-400">
            ตั้งค่า “ให้ AI ตอบเองอัตโนมัติ” ได้ที่หน้า <b>กล่องแชต</b> (สวิตช์ข้างไอคอน Shopee)
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
            ✅ Shopee เปิด Chat API กว้างที่สุดในสาม marketplace — ใช้ Access Token + Shop ID จากการเชื่อม Shopee
            (โหมดทดลองใส่ token ขึ้นต้น <code>mock-</code> ได้เลย ไม่ต้องใส่ Shop ID)
          </p>

          <details className="rounded-lg border border-gray-300 bg-white/60 p-2 text-xs dark:border-gray-700 dark:bg-gray-800/40">
            <summary className="cursor-pointer font-medium text-gray-800 dark:text-gray-200">
              ตั้งค่าระดับแอป (ทำครั้งเดียว)
            </summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-gray-600 dark:text-gray-400">
              <li>
                ตั้ง env <code>SHOPEE_PARTNER_ID</code> + <code>SHOPEE_PARTNER_KEY</code> (ใช้เซ็น + verify webhook)
              </li>
              <li>
                ใส่ Push URL นี้ในตั้งค่า Shopee Open Platform (Push Mechanism):
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
  onImportMarketplace,
  onDisconnectMarketplace,
  save,
  onSave,
}: {
  products: Product[];
  updateProduct: (id: string, patch: Partial<Product>) => void;
  addProduct: () => void;
  removeProduct: (id: string) => void;
  onImport: (text: string) => Promise<{ products: number }>;
  onImportMarketplace: (platform: string) => Promise<number>;
  onDisconnectMarketplace: (platform: string) => Promise<void>;
  save: SaveState;
  onSave: () => void;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          คลังสินค้า
        </h2>
        <SaveButton save={save} onSave={onSave} />
      </div>

      {/* เชื่อมต่อ marketplace (Lazada / Shopee / TikTok) */}
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

      <div className="mt-6 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">รายการสินค้า</h3>
          <button type="button" onClick={addProduct} className={secondaryBtnClass}>
            + เพิ่มสินค้า
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          AI ใช้สินค้าเหล่านี้ตอบลูกค้าและแนะนำสินค้าที่เข้ากัน
        </p>

        {products.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
            ยังไม่มีสินค้า — กด “+ เพิ่มสินค้า” หรือดึงจาก marketplace ด้านบน
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
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
  const sbp = product.stockByPlatform;
  const perPlatform = sources
    .map((s) => ({ s, n: sbp?.[s] }))
    .filter((x): x is { s: string; n: number } => typeof x.n === "number");
  // สต็อกแต่ละเจ้าไม่เท่ากันไหม → ถ้าไม่เท่า โชว์ตัวเลขติดข้างไอคอนแต่ละเจ้า
  const stocksDiffer =
    perPlatform.length >= 2 && !perPlatform.every((x) => x.n === perPlatform[0].n);
  const fileRef = useRef<HTMLInputElement>(null);
  const [imgBusy, setImgBusy] = useState(false);

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
          ? "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50"
          : "border-gray-200 bg-gray-100 opacity-60 dark:border-gray-800 dark:bg-gray-900/40"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
          สินค้า #{index + 1}
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

      {/* รูปสินค้า — อัปโหลดจากเครื่อง (ย่ออัตโนมัติ) */}
      <div className="mb-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-800"
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
            <span className="text-[10px] text-gray-400">＋ รูป</span>
          )}
        </button>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={imgBusy}
            className="rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-600 transition hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
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
            <div className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/60">
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
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-gray-200 pt-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
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
  {
    platform: "tiktok",
    label: "TikTok Shop",
    emoji: "🎵",
    box: "border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/40",
    title: "text-gray-900 dark:text-gray-100",
    mockText: "text-gray-500 dark:text-gray-400",
    btn: "bg-gray-900 hover:bg-black dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-white",
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
    cls: "rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-800 dark:bg-gray-700 dark:text-gray-200",
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
    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
          ✨ นำเข้าอัตโนมัติ — วางข้อความ AI แยกเป็นรายการสินค้าให้เอง
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
              "วางข้อมูลแบบไหนก็ได้ เช่น:\nเซรั่มบำรุงผิว 690 บาท ลดเลือนริ้วรอย\nครีมกันแดด SPF50 350 บาท\nมาส์กหน้า แพ็ก 10 ชิ้น 199"
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

const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500";

const secondaryBtnClass =
  "rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-700 dark:bg-transparent dark:text-emerald-400 dark:hover:bg-emerald-950/40";
