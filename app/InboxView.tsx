"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type {
  ConversationSummary,
  ConversationDetail,
  MockSettings,
  AutoLevel,
} from "@/lib/types";
import { SiLine, SiFacebook, SiTiktok, SiShopee } from "react-icons/si";

const btnPrimary =
  "rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-contrast transition hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-surface2 hover:text-fg disabled:opacity-50";
const inputCls =
  "w-full rounded-lg border border-line bg-app px-3 py-2 text-sm text-fg outline-none transition focus:border-accent";

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "เมื่อกี้";
  if (s < 3600) return `${Math.floor(s / 60)} นาที`;
  if (s < 86400) return `${Math.floor(s / 3600)} ชม.`;
  return `${Math.floor(s / 86400)} วัน`;
}

// cache ระดับโมดูล — อยู่รอดข้ามการสลับหน้า/รีเมานต์ ทำให้สลับแชตขึ้นทันที
let convCache: ConversationSummary[] = [];
let activeIdCache: string | null = null;
let selectedPlatformCache: string | null = null;
let appsCache: InboxApp[] = [];
const detailCache = new Map<string, ConversationDetail>();
// เก็บข้อมูลการพ่วงของร่างล่าสุดต่อบทสนทนา → ใช้นับยอดพ่วงตอนแอดมินกดส่ง
const draftUpsellCache = new Map<string, { product: string; estValue: number | null }>();

/** แอปที่ร้านเพิ่มในกล่องแชต + โหมด AI ของแอปนั้น */
type InboxApp = { channel: string; level: AutoLevel };

/** ตัวเลือกโหมด AI (ใช้ทั้งการ์ดในหน้ารวม + header ในหน้าแชต) */
const LEVEL_OPTIONS: { value: AutoLevel; label: string }[] = [
  { value: "off", label: "✋ กดส่งเอง" },
  { value: "safe", label: "🛡️ ปลอดภัย" },
];

/** ไอคอนแบรนด์ทางการ (react-icons / Simple Icons) — โลโก้สีขาวบนพื้นสีแบรนด์ */
function LineGlyph({ small }: { small?: boolean }) {
  return <SiLine className={small ? "h-4 w-4" : "h-7 w-7"} aria-hidden="true" />;
}
function FacebookGlyph({ small }: { small?: boolean }) {
  return <SiFacebook className={small ? "h-4 w-4" : "h-7 w-7"} aria-hidden="true" />;
}
function TiktokGlyph({ small }: { small?: boolean }) {
  return <SiTiktok className={small ? "h-4 w-4" : "h-7 w-7"} aria-hidden="true" />;
}
// โลโก้ Lazada — รูปถุงทางการ (จากไฟล์ที่ผู้ใช้ให้) เป็น silhouette สีขาวบนพื้นน้ำเงิน
function LazadaGlyph({ small }: { small?: boolean }) {
  return (
    <svg
      viewBox="0 0 67.46 54.72"
      className={small ? "h-4 w-4" : "h-7 w-7"}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M 33.7366,54.7161 C 33.2581,54.7194 32.7871,54.5969 32.3707,54.361 28.8059,52.2985 2.4039,35.7444 1.40683,35.239 0.648025,34.8849 0.129878,34.1595 0.0409756,33.3268 V 10.1073 C 0.0213409,9.24058 0.449817,8.42493 1.17463,7.94927 L 1.36585,7.84 C 3.92,6.25561 12.4702,1.03805 13.8224,0.286829 14.1327,0.102692 14.4861,0.00374668 14.8468,0 c 0.3382,0.00382664 0.6706,0.0881007 0.9698,0.245854 0,0 11.9649,7.799026 13.7951,8.495606 1.2842,0.59 2.6845,0.88406 4.0976,0.86049 1.6012,0.03347 3.1834,-0.35265 4.5892,-1.12 C 40.0878,7.53951 51.52,0.286829 51.6429,0.286829 51.9311,0.112743 52.2623,0.0228451 52.599,0.0273171 52.9601,0.0290843 53.3139,0.128172 53.6234,0.314146 55.1805,1.17463 65.7795,7.66244 66.2302,7.94927 66.9757,8.39902 67.4276,9.20946 67.4185,10.08 v 23.2195 c -0.0836,0.8347 -0.6034,1.5624 -1.3658,1.9122 -0.9971,0.5463 -27.3171,17.1005 -30.9503,19.122 -0.4136,0.2455 -0.8848,0.3774 -1.3658,0.3824 Z" />
    </svg>
  );
}
function ShopeeGlyph({ small }: { small?: boolean }) {
  return <SiShopee className={small ? "h-4 w-4" : "h-7 w-7"} aria-hidden="true" />;
}

/** แพลตฟอร์มที่โชว์ในหน้ารวมกล่องแชต (เพิ่มเจ้าอื่นภายหลังได้) */
type PlatformDef = {
  id: string;
  channel: string;
  name: string;
  available: boolean;
  iconBg: string; // สีพื้นไอคอน
  Glyph: (props: { small?: boolean }) => React.ReactElement;
};
const PLATFORMS: PlatformDef[] = [
  {
    id: "line",
    channel: "line",
    name: "LINE",
    available: true,
    iconBg: "bg-[#06C755]",
    Glyph: LineGlyph,
  },
  {
    id: "facebook",
    channel: "facebook",
    name: "Facebook",
    available: true,
    iconBg: "bg-[#0866FF]",
    Glyph: FacebookGlyph,
  },
  {
    id: "tiktok",
    channel: "tiktok",
    name: "TikTok",
    available: true,
    iconBg: "bg-black",
    Glyph: TiktokGlyph,
  },
  {
    id: "lazada",
    channel: "lazada",
    name: "Lazada",
    available: true,
    iconBg: "bg-[#0F146E]",
    Glyph: LazadaGlyph,
  },
  {
    id: "shopee",
    channel: "shopee",
    name: "Shopee",
    available: true,
    iconBg: "bg-[#EE4D2D]",
    Glyph: ShopeeGlyph,
  },
];

// ช่องทางที่ยังไม่พร้อม — ซ่อนจาก UI ก่อน (โค้ด/ไอคอนยังอยู่ครบ เปิดคืนได้)
const HIDDEN_CHANNELS = new Set(["tiktok", "shopee"]);

/** ปลายทาง API ส่งข้อความตามช่องทาง (draft/choices ใช้ /api/line ร่วมกันได้) */
function sendBaseFor(channel: string | undefined): string {
  if (channel === "facebook") return "/api/facebook";
  if (channel === "tiktok") return "/api/tiktok";
  if (channel === "lazada") return "/api/lazada";
  if (channel === "shopee") return "/api/shopee";
  return "/api/line";
}

export default function InboxView({
  mockSettings = {},
}: {
  mockSettings?: MockSettings;
}) {
  // เริ่มจาก cache ที่เคยโหลดไว้ (สลับหน้ากลับมาไม่ต้องเริ่มศูนย์)
  const [conversations, setConversations] =
    useState<ConversationSummary[]>(() => convCache);
  const [activeId, setActiveId] = useState<string | null>(
    () => activeIdCache ?? convCache[0]?.id ?? null,
  );
  const [detail, setDetail] = useState<ConversationDetail | null>(() => {
    const id = activeIdCache ?? convCache[0]?.id ?? null;
    return id ? (detailCache.get(id) ?? null) : null;
  });
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(
    () => selectedPlatformCache,
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [choicesMap, setChoicesMap] = useState<Record<string, string[]>>({});
  const [drafting, setDrafting] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [apps, setApps] = useState<InboxApp[]>(() => appsCache);
  const [sending, setSending] = useState(false);
  const [simText, setSimText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;
  const selectedPlatformRef = useRef<string | null>(selectedPlatform);
  selectedPlatformRef.current = selectedPlatform;

  // ร่าง/เหตุผล/ตัวเลือก เก็บแยกต่อบทสนทนา — สลับแชตแล้วไม่ปนกัน
  const draft = activeId ? (drafts[activeId] ?? "") : "";
  const reason = activeId ? (reasons[activeId] ?? "") : "";
  const choices = activeId ? (choicesMap[activeId] ?? []) : [];
  const setDraftFor = (id: string, v: string) =>
    setDrafts((m) => ({ ...m, [id]: v }));
  const setReasonFor = (id: string, v: string) =>
    setReasons((m) => ({ ...m, [id]: v }));
  const setChoicesFor = (id: string, v: string[]) =>
    setChoicesMap((m) => ({ ...m, [id]: v }));

  const loadConversations = useCallback(async () => {
    try {
      const r = await fetch("/api/line/conversations");
      if (!r.ok) return;
      const d = (await r.json()) as { conversations: ConversationSummary[] };
      convCache = d.conversations;
      setConversations(d.conversations);
      // เลือกแชตเริ่มต้น "เฉพาะในแพลตฟอร์มที่เปิดอยู่" เท่านั้น
      // (กันบั๊ก: หน้า FB ไม่มีแชต แล้วเผลอไปดึงแชต LINE มาโชว์)
      setActiveId((cur) => {
        const ch = selectedPlatformRef.current;
        if (!ch) return cur; // อยู่หน้ารวม ยังไม่เลือกแพลตฟอร์ม
        if (cur && d.conversations.some((c) => c.id === cur && c.channel === ch)) {
          return cur;
        }
        return d.conversations.find((c) => c.channel === ch)?.id ?? null;
      });
    } catch {
      /* เงียบไว้ */
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/line/conversation?id=${encodeURIComponent(id)}`);
      if (!r.ok) return;
      const d = (await r.json()) as { conversation: ConversationDetail };
      detailCache.set(id, d.conversation);
      // เซ็ตเฉพาะถ้ายังเปิดแชตนี้อยู่ (กันคำตอบช้ามาทับแชตที่สลับไปแล้ว)
      if (activeIdRef.current === id) setDetail(d.conversation);
    } catch {
      /* เงียบไว้ */
    }
  }, []);

  // โหลดลิสต์ + poll ทุก 4 วิ (หยุดเมื่อสลับแท็บไปทำอย่างอื่น)
  useEffect(() => {
    void loadConversations();
    const t = setInterval(() => {
      if (!document.hidden) void loadConversations();
    }, 4000);
    return () => clearInterval(t);
  }, [loadConversations]);

  // โหลดบทสนทนาที่เลือก + poll ทุก 3 วิ
  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    // โชว์จาก cache ทันที (ถ้ามี) แล้วค่อยรีเฟรชเบื้องหลัง
    setDetail(detailCache.get(activeId) ?? null);
    void loadDetail(activeId);
    const t = setInterval(() => {
      if (!document.hidden) void loadDetail(activeId);
    }, 3000);
    return () => clearInterval(t);
  }, [activeId, loadDetail]);

  // เลื่อนลงล่างสุดเมื่อข้อความเพิ่ม
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages.length]);

  // ล้างช่องจำลองลูกค้าเมื่อสลับบทสนทนา + จำแชตที่เปิดไว้ (คงไว้ตอนสลับหน้า)
  useEffect(() => {
    setSimText("");
    activeIdCache = activeId;
  }, [activeId]);

  // จำแพลตฟอร์มที่เปิดอยู่ (คงไว้ตอนสลับหน้าอื่นแล้วกลับมา)
  useEffect(() => {
    selectedPlatformCache = selectedPlatform;
  }, [selectedPlatform]);

  // กันแชตข้ามแพลตฟอร์มค้างในกล่องคุย (เช่น เปิดหน้า FB แต่ detail ยังเป็นแชต LINE)
  useEffect(() => {
    if (selectedPlatform && detail && detail.channel !== selectedPlatform) {
      setDetail(null);
    }
  }, [selectedPlatform, detail]);

  // โหลดลิสต์แอปที่ร้านเพิ่ม (+ โหมด AI ต่อแอป)
  const loadApps = useCallback(async () => {
    try {
      const r = await fetch("/api/inbox/apps");
      if (!r.ok) return;
      const d = (await r.json()) as { apps: InboxApp[] };
      appsCache = d.apps;
      setApps(d.apps);
    } catch {
      /* เงียบไว้ */
    }
  }, []);

  useEffect(() => {
    void loadApps();
  }, [loadApps]);

  const levelOf = (channel: string | null): AutoLevel => {
    const lvl = apps.find((a) => a.channel === channel)?.level ?? "off";
    return lvl === "full" ? "safe" : lvl; // โหมด full เดิม → แสดงเป็นปลอดภัย
  };

  // เปลี่ยนโหมด AI ของแอปนั้น
  async function changeLevel(channel: string, next: AutoLevel) {
    if (next === levelOf(channel)) return;
    const prev = apps;
    const optimistic = apps.map((a) =>
      a.channel === channel ? { ...a, level: next } : a,
    );
    setApps(optimistic);
    appsCache = optimistic;
    try {
      await fetch("/api/inbox/apps/level", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, level: next }),
      });
    } catch {
      setApps(prev);
      appsCache = prev;
      return;
    }
    // โหมดของแชตในแอปนี้เปลี่ยน + อาจมีการตอบอัตโนมัติ → รีเฟรช
    void loadConversations();
    if (activeIdRef.current) void loadDetail(activeIdRef.current);
  }

  // เพิ่มแอปเข้ากล่องแชต
  async function addApp(channel: string) {
    try {
      const r = await fetch("/api/inbox/apps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      if (!r.ok) return;
      const d = (await r.json()) as { apps: InboxApp[] };
      appsCache = d.apps;
      setApps(d.apps);
    } catch {
      /* เงียบไว้ */
    }
  }

  // ลบแอปออกจากกล่องแชต (ไม่ลบแชต/การเชื่อมต่อ)
  async function removeApp(channel: string) {
    if (!window.confirm("ลบแอปนี้ออกจากกล่องแชต? (แชต/การเชื่อมต่อไม่หาย เพิ่มกลับมาได้)")) return;
    try {
      const r = await fetch(`/api/inbox/apps?channel=${encodeURIComponent(channel)}`, {
        method: "DELETE",
      });
      if (!r.ok) return;
      const d = (await r.json()) as { apps: InboxApp[] };
      appsCache = d.apps;
      setApps(d.apps);
    } catch {
      /* เงียบไว้ */
    }
  }

  // เลือกแพลตฟอร์มจากหน้ารวม → เข้าหน้าแชต แล้วเด้งไปบทสนทนาแรกของเจ้านั้น
  function pickPlatform(channel: string) {
    setSelectedPlatform(channel);
    setActiveId((cur) => {
      const stillValid =
        cur && conversations.some((c) => c.id === cur && c.channel === channel);
      return stillValid
        ? cur
        : (conversations.find((c) => c.channel === channel)?.id ?? null);
    });
  }

  async function handleDraft() {
    if (!activeId || drafting) return;
    const id = activeId; // กันสลับแชตระหว่าง AI กำลังร่าง
    setDrafting(true);
    setReasonFor(id, "");
    try {
      const r = await fetch("/api/line/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: id }),
      });
      const d = (await r.json()) as {
        message?: string;
        reason?: string;
        needsHuman?: boolean;
        shouldUpsell?: boolean;
        estAddedValue?: number | null;
        upsellProduct?: string;
        error?: string;
      };
      if (!r.ok) {
        setReasonFor(id, d.error || "ร่างคำตอบไม่สำเร็จ");
        return;
      }
      setDraftFor(id, d.message || "");
      // ร่างนี้มีการเสนอพ่วงไหม → เก็บไว้ ถ้าแอดมินกดส่งจะได้นับยอดพ่วง
      if (d.shouldUpsell) {
        draftUpsellCache.set(id, {
          product: d.upsellProduct ?? "",
          estValue: d.estAddedValue ?? null,
        });
      } else {
        draftUpsellCache.delete(id);
      }
      setReasonFor(
        id,
        d.needsHuman
          ? "AI ไม่ค่อยมั่นใจคำตอบนี้ — ตรวจก่อนส่งนะ"
          : d.reason || "",
      );
    } catch {
      setReasonFor(id, "ร่างคำตอบไม่สำเร็จ ลองใหม่");
    } finally {
      setDrafting(false);
    }
  }

  // โหมด manual: ให้ AI เสนอ 2-3 คำตอบ
  async function handleChoices() {
    if (!activeId || choosing) return;
    const id = activeId;
    setChoosing(true);
    setReasonFor(id, "");
    try {
      const r = await fetch("/api/line/choices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: id }),
      });
      const d = (await r.json()) as { choices?: string[]; error?: string };
      if (!r.ok) {
        setReasonFor(id, d.error || "เสนอคำตอบไม่สำเร็จ");
        return;
      }
      setChoicesFor(id, d.choices ?? []);
    } catch {
      setReasonFor(id, "เสนอคำตอบไม่สำเร็จ ลองใหม่");
    } finally {
      setChoosing(false);
    }
  }

  async function handleSend() {
    if (!activeId || sending) return;
    const id = activeId;
    const text = (drafts[id] ?? "").trim();
    if (!text) return;
    // ส่งตามช่องทางของบทสนทนา (LINE / Facebook / TikTok)
    const sendBase = sendBaseFor(detail?.channel);
    setSending(true);
    try {
      const r = await fetch(`${sendBase}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: id, text }),
      });
      if (r.ok) {
        // โหมดร่าง: ถ้าร่างนี้มีการเสนอพ่วง → นับยอดพ่วง (best-effort)
        const up = draftUpsellCache.get(id);
        if (up) {
          draftUpsellCache.delete(id);
          void fetch("/api/metrics/upsell/record", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ conversationId: id, product: up.product, estValue: up.estValue }),
          }).catch(() => {});
        }
        setDraftFor(id, "");
        setReasonFor(id, "");
        await loadDetail(id);
        void loadConversations();
      }
    } finally {
      setSending(false);
    }
  }

  // จำลองลูกค้าทัก (เริ่มใหม่ หรือต่อบทเดิม) — ตามแพลตฟอร์มที่เปิดอยู่
  async function handleSimulate(continueChat: boolean) {
    const text = simText.trim();
    if (!text) return;
    const body: Record<string, string> = { text, channel: selectedPlatform ?? "line" };
    if (continueChat && activeId) body.conversationId = activeId;
    const r = await fetch("/api/line/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const d = (await r.json()) as { conversationId: string };
      setSimText("");
      setActiveId(d.conversationId);
      await loadConversations();
      await loadDetail(d.conversationId);
    }
  }

  const platform = PLATFORMS.find((p) => p.channel === selectedPlatform) ?? null;
  const visibleConvos = selectedPlatform
    ? conversations.filter((c) => c.channel === selectedPlatform)
    : [];
  // เปิดข้อมูลทดลองแชตของเจ้านี้อยู่ไหม (ปิด = ซ่อนกล่องแชทจำลอง โชว์เฉพาะแชตจริง) — default ปิด
  const chatMockOn = selectedPlatform
    ? mockSettings[selectedPlatform]?.chat === true
    : false;

  // หน้ารวมแพลตฟอร์ม (ยังไม่ได้เลือกแพลตฟอร์ม)
  if (!selectedPlatform) {
    return (
      <div className="h-[calc(100vh-8rem)]">
        <AppList
          apps={apps}
          conversations={conversations}
          onPick={pickPlatform}
          onChangeLevel={changeLevel}
          onAddApp={addApp}
          onRemoveApp={removeApp}
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* ซ้าย: รายการบทสนทนา */}
      <div className="flex w-72 shrink-0 flex-col rounded-2xl border border-line bg-surface">
        <div className="border-b border-line p-3">
          <button
            type="button"
            onClick={() => setSelectedPlatform(null)}
            className="mb-3 flex w-fit items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted transition hover:bg-surface2 hover:text-fg"
          >
            <span className="text-base leading-none">‹</span> กล่องแชต
          </button>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white ${platform?.iconBg ?? "bg-gray-400"}`}
              >
                {platform ? <platform.Glyph small /> : null}
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-fg">
                  {platform?.name ?? "แชต"}
                </h2>
                <p className="text-[11px] text-muted">
                  {visibleConvos.length} บทสนทนา
                </p>
              </div>
            </div>
            <select
              value={levelOf(selectedPlatform)}
              onChange={(e) =>
                selectedPlatform &&
                void changeLevel(selectedPlatform, e.target.value as AutoLevel)
              }
              aria-label="ระดับการตอบของ AI"
              className="shrink-0 rounded-lg border border-line bg-app px-2 py-1 text-xs font-medium text-fg outline-none focus:border-accent"
            >
              {LEVEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {visibleConvos.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted">
              ยังไม่มีบทสนทนา — ลองจำลองลูกค้าทักด้านล่าง
            </p>
          ) : (
            visibleConvos.map((c) => {
              const active = c.id === activeId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveId(c.id)}
                  className={`flex w-full flex-col gap-0.5 border-b border-line px-3 py-2.5 text-left transition ${
                    active
                      ? "bg-accent/12"
                      : "hover:bg-surface2"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-fg">
                        {c.customerName}
                      </span>
                      {c.pendingHuman && (
                        <span className="shrink-0 rounded bg-red-100 px-1 py-0.5 text-[9px] font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300">
                          รอตอบ
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted">
                      {timeAgo(c.lastMessageAt)}
                    </span>
                  </div>
                  <span className="truncate text-xs text-muted">
                    {c.lastSender === "admin" ? "คุณ: " : ""}
                    {c.lastText || "—"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ขวา: บทสนทนา + ช่องตอบ */}
      <div className="flex flex-1 flex-col rounded-2xl border border-line bg-surface">
        {!detail ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">
            {activeId ? "กำลังโหลด…" : "เลือกบทสนทนา หรือจำลองลูกค้าทักเพื่อเริ่ม"}
          </div>
        ) : (
          <>
            <div className="flex items-center border-b border-line px-4 py-3">
              <div>
                <span className="text-sm font-semibold text-fg">
                  {detail.customerName}
                </span>
                <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-950/50 dark:text-green-300">
                  {detail.channel.toUpperCase()}
                </span>
              </div>
            </div>

            {/* ข้อความ */}
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {detail.messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.sender === "admin" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                      m.sender === "admin"
                        ? "bg-accent text-accent-contrast"
                        : "bg-surface2 text-fg"
                    }`}
                  >
                    {m.kind === "image" && m.imageUrl ? (
                      <a href={m.imageUrl} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={m.imageUrl}
                          alt="รูปจากลูกค้า"
                          className="max-h-48 max-w-[12rem] rounded-lg object-cover"
                        />
                      </a>
                    ) : (
                      m.text
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* ช่องร่าง/ส่ง */}
            <div className="border-t border-line p-3">
              {reason && (
                <p className="mb-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  💡 {reason}
                </p>
              )}

              {/* ตัวเลือกคำตอบจาก AI (โหมด manual) — กดเพื่อใส่ในช่องพิมพ์ */}
              {choices.length > 0 && (
                <div className="mb-2 space-y-1.5">
                  {choices.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        if (!activeId) return;
                        setDraftFor(activeId, c);
                        setChoicesFor(activeId, []);
                      }}
                      className="block w-full rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-left text-sm text-fg transition hover:bg-accent/20"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}

              <textarea
                value={draft}
                onChange={(e) => activeId && setDraftFor(activeId, e.target.value)}
                rows={2}
                placeholder="พิมพ์คำตอบ หรือกด “เสนอคำตอบ”/“ให้ AI ร่าง” แล้วแก้ก่อนส่ง"
                className={`${inputCls} resize-none`}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleChoices}
                  disabled={choosing}
                  className={btnGhost}
                >
                  {choosing ? "กำลังคิด…" : "💡 เสนอคำตอบ"}
                </button>
                <button
                  type="button"
                  onClick={handleDraft}
                  disabled={drafting}
                  className={btnGhost}
                >
                  {drafting ? "AI กำลังร่าง…" : "✨ ให้ AI ร่าง"}
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending || !draft.trim()}
                  className={btnPrimary}
                >
                  {sending ? "กำลังส่ง…" : "ส่ง"}
                </button>
              </div>

              {/* แถวจำลองลูกค้า (สำหรับทดสอบ) — ซ่อนเมื่อปิดข้อมูลทดลองแชต */}
              {chatMockOn && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface2 p-2">
                  <span className="shrink-0 text-[11px] font-medium text-muted">
                    จำลองลูกค้า:
                  </span>
                  <input
                    type="text"
                    value={simText}
                    onChange={(e) => setSimText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSimulate(true);
                    }}
                    placeholder="พิมพ์แทนลูกค้าเพื่อทดสอบ แล้ว Enter"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() => void handleSimulate(true)}
                    disabled={!simText.trim()}
                    className={btnGhost}
                  >
                    ทักต่อ
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* เริ่มแชทจำลองใหม่ (เมื่อยังไม่เลือก/ไม่มีบทสนทนา) — ซ่อนเมื่อปิดข้อมูลทดลองแชต */}
        {!detail && chatMockOn && (
          <div className="border-t border-line p-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={simText}
                onChange={(e) => setSimText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSimulate(false);
                }}
                placeholder="จำลองลูกค้าทักเข้ามา (เริ่มแชทใหม่)"
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => void handleSimulate(false)}
                disabled={!simText.trim()}
                className={btnPrimary}
              >
                เริ่มแชท
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** กล่องแชต: ลิสต์แอปที่ร้านเพิ่มเอง (การ์ด 2 บรรทัด) + ปุ่มเพิ่ม/ลบ + โหมด AI ต่อแอป */
function AppList({
  apps,
  conversations,
  onPick,
  onChangeLevel,
  onAddApp,
  onRemoveApp,
}: {
  apps: InboxApp[];
  conversations: ConversationSummary[];
  onPick: (channel: string) => void;
  onChangeLevel: (channel: string, level: AutoLevel) => void;
  onAddApp: (channel: string) => void;
  onRemoveApp: (channel: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const addedChannels = new Set(apps.map((a) => a.channel));
  const available = PLATFORMS.filter(
    (p) => !addedChannels.has(p.channel) && !HIDDEN_CHANNELS.has(p.channel),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-fg">กล่องแชต</h2>
        <p className="mt-0.5 text-sm text-muted">
          เพิ่มแอปที่ใช้ แล้วตั้งโหมด AI แยกแต่ละแอปได้
        </p>
      </div>

      {apps.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-muted">
            ยังไม่มีแอป — เริ่มด้วยการเพิ่มแอปที่คุณใช้
          </p>
          <AddAppButton
            available={available}
            adding={adding}
            setAdding={setAdding}
            onAddApp={onAddApp}
          />
        </div>
      ) : (
        <div className="space-y-2">
          {apps.filter((a) => !HIDDEN_CHANNELS.has(a.channel)).map((a) => {
            const def = PLATFORMS.find((p) => p.channel === a.channel);
            const convos = conversations.filter((c) => c.channel === a.channel);
            const pending = convos.filter((c) => c.pendingHuman).length;
            return (
              <div
                key={a.channel}
                className="group relative rounded-2xl border border-line bg-surface p-3 transition hover:border-accent/50"
              >
                <button
                  type="button"
                  onClick={() => onPick(a.channel)}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <span
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white ${def?.iconBg ?? "bg-gray-400"}`}
                  >
                    {def ? <def.Glyph /> : null}
                  </span>
                  <span className="flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-base font-semibold text-fg">
                        {def?.name ?? a.channel}
                      </span>
                      {pending > 0 && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300">
                          รอตอบ {pending}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted">
                      {convos.length} บทสนทนา
                    </span>
                  </span>
                </button>
                <div className="mt-2 flex items-center gap-2 pl-[3.25rem]">
                  <span className="text-[11px] text-muted">โหมด AI:</span>
                  <select
                    value={a.level === "full" ? "safe" : a.level}
                    onChange={(e) => onChangeLevel(a.channel, e.target.value as AutoLevel)}
                    aria-label={`โหมด AI ของ ${def?.name ?? a.channel}`}
                    className="rounded-lg border border-line bg-app px-2 py-1 text-xs font-medium text-fg outline-none focus:border-accent"
                  >
                    {LEVEL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveApp(a.channel)}
                  aria-label="ลบแอปออกจากกล่องแชต"
                  className="absolute right-2 top-2 hidden rounded-md px-1.5 py-0.5 text-xs text-muted transition hover:bg-red-500/10 hover:text-red-500 group-hover:block"
                >
                  ✕
                </button>
              </div>
            );
          })}
          <AddAppButton
            available={available}
            adding={adding}
            setAdding={setAdding}
            onAddApp={onAddApp}
          />
        </div>
      )}
    </div>
  );
}

/** ปุ่ม ➕ เพิ่มแอป + เมนูเลือกแอปที่ยังไม่ได้เพิ่ม */
function AddAppButton({
  available,
  adding,
  setAdding,
  onAddApp,
}: {
  available: PlatformDef[];
  adding: boolean;
  setAdding: (v: boolean) => void;
  onAddApp: (channel: string) => void;
}) {
  if (available.length === 0) return null;
  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex w-full items-center justify-center gap-1 rounded-2xl border border-dashed border-line px-3 py-2.5 text-sm font-medium text-muted transition hover:border-accent hover:text-accent"
      >
        ➕ เพิ่มแอป
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-line p-2">
      <p className="mb-1 px-1 text-[11px] text-muted">เลือกแอปที่จะเพิ่ม</p>
      <div className="flex flex-wrap gap-2">
        {available.map((p) => (
          <button
            key={p.channel}
            type="button"
            onClick={() => {
              onAddApp(p.channel);
              setAdding(false);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-sm text-fg transition hover:border-accent"
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded text-white ${p.iconBg}`}
            >
              <p.Glyph small />
            </span>
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}
