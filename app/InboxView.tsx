"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ConversationSummary, ConversationDetail } from "@/lib/types";

const btnPrimary =
  "rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700";
const inputCls =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white";

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
let autoReplyCache = false;
const detailCache = new Map<string, ConversationDetail>();

/** ไอคอน LINE (ฟองแชตสีเขียวแบรนด์) */
function LineGlyph({ small }: { small?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={small ? "h-4 w-4" : "h-7 w-7"}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2C6.48 2 2 5.74 2 10.28c0 4.07 3.59 7.48 8.44 8.12.33.07.78.22.89.5.1.26.07.66.03.92 0 0-.12.71-.14.86-.04.26-.2 1.01.89.55 1.09-.46 5.86-3.45 8-5.91 1.48-1.62 2.19-3.27 2.19-5.04C22.3 5.74 17.52 2 12 2z" />
    </svg>
  );
}

/** ไอคอน Facebook (ตัว f) */
function FacebookGlyph({ small }: { small?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={small ? "h-4 w-4" : "h-7 w-7"}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.9 3.78-3.9 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.9h-2.34V22c4.78-.76 8.44-4.92 8.44-9.94z" />
    </svg>
  );
}

/** ไอคอน TikTok (โน้ตดนตรี) */
function TiktokGlyph({ small }: { small?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={small ? "h-4 w-4" : "h-7 w-7"}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M16.5 3c.3 2.06 1.5 3.69 3.5 4.05v2.66c-1.19.12-2.28-.18-3.5-.78v5.36c0 3.62-2.6 6.21-6 6.21A5.9 5.9 0 0 1 4 14.6c0-3.5 3.2-6.06 6.8-5.4v2.77c-.43-.13-.9-.2-1.4-.2-1.6 0-2.7 1.1-2.7 2.6 0 1.55 1.13 2.66 2.6 2.66 1.5 0 2.7-1.13 2.7-2.95V3z" />
    </svg>
  );
}

/** ไอคอน Lazada (ถุงช้อปปิ้ง) */
function LazadaGlyph({ small }: { small?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={small ? "h-4 w-4" : "h-7 w-7"}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6 7h12l-.9 12.1A2 2 0 0 1 15.1 21H8.9a2 2 0 0 1-2-1.9L6 7zm3 0a3 3 0 0 1 6 0h-2a1 1 0 0 0-2 0H9z" />
    </svg>
  );
}

/** ไอคอน Shopee (ถุงช้อปปิ้ง) */
function ShopeeGlyph({ small }: { small?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={small ? "h-4 w-4" : "h-7 w-7"}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6 7h12l-.9 12.1A2 2 0 0 1 15.1 21H8.9a2 2 0 0 1-2-1.9L6 7zm3 0a3 3 0 0 1 6 0h-2a1 1 0 0 0-2 0H9zm3 5c-1.3 0-2.3.8-2.3 2 0 1.1.8 1.6 2 2 .9.3 1.2.5 1.2.9 0 .4-.4.6-.9.6-.6 0-1.1-.2-1.6-.5l-.5 1.2c.5.4 1.3.6 2 .6 1.5 0 2.4-.8 2.4-2 0-1-.6-1.6-1.9-2-.9-.3-1.2-.5-1.2-.8 0-.3.3-.5.8-.5.5 0 1 .2 1.4.4l.5-1.2c-.5-.3-1.1-.4-1.6-.4z" />
    </svg>
  );
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

/** ปลายทาง API ส่งข้อความตามช่องทาง (draft/choices ใช้ /api/line ร่วมกันได้) */
function sendBaseFor(channel: string | undefined): string {
  if (channel === "facebook") return "/api/facebook";
  if (channel === "tiktok") return "/api/tiktok";
  if (channel === "lazada") return "/api/lazada";
  if (channel === "shopee") return "/api/shopee";
  return "/api/line";
}

/** สวิตช์เปิด/ปิด */
function Toggle({
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
      title={label}
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
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

export default function InboxView() {
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
  const [autoReply, setAutoReply] = useState<boolean>(() => autoReplyCache);
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

  // โหลดสถานะสวิตช์รวม "ให้ AI ตอบเองอัตโนมัติ"
  useEffect(() => {
    fetch("/api/line/automode")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          autoReplyCache = Boolean(d.autoReply);
          setAutoReply(autoReplyCache);
        }
      })
      .catch(() => {});
  }, []);

  // สลับสวิตช์รวม: ให้ AI ตอบเองทุกแชต (เปิดแล้ว AI ตอบข้อความที่ค้างให้ด้วย)
  async function toggleAuto() {
    const next = !autoReply;
    setAutoReply(next);
    autoReplyCache = next;
    try {
      await fetch("/api/line/automode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoReply: next }),
      });
    } catch {
      setAutoReply(!next);
      autoReplyCache = !next;
      return;
    }
    // โหมดทุกแชตเปลี่ยน + อาจมีการตอบอัตโนมัติ → รีเฟรช
    void loadConversations();
    if (activeIdRef.current) void loadDetail(activeIdRef.current);
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
        error?: string;
      };
      if (!r.ok) {
        setReasonFor(id, d.error || "ร่างคำตอบไม่สำเร็จ");
        return;
      }
      setDraftFor(id, d.message || "");
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

  // หน้ารวมแพลตฟอร์ม (ยังไม่ได้เลือกแพลตฟอร์ม)
  if (!selectedPlatform) {
    return (
      <div className="h-[calc(100vh-8rem)]">
        <PlatformHub conversations={conversations} onPick={pickPlatform} />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* ซ้าย: รายการบทสนทนา */}
      <div className="flex w-72 shrink-0 flex-col rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-200 p-3 dark:border-gray-800">
          <button
            type="button"
            onClick={() => setSelectedPlatform(null)}
            className="mb-2 flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            ‹ กล่องแชต
          </button>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white ${platform?.iconBg ?? "bg-gray-400"}`}
              >
                {platform ? <platform.Glyph small /> : null}
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {platform?.name ?? "แชต"}
                </h2>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {visibleConvos.length} บทสนทนา
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                {autoReply ? "🤖 AI ตอบเอง" : "✋ กดส่งเอง"}
              </span>
              <Toggle
                enabled={autoReply}
                onToggle={toggleAuto}
                label="ให้ AI ตอบเองอัตโนมัติทุกแชต"
              />
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {visibleConvos.length === 0 ? (
            <p className="p-4 text-center text-xs text-gray-500 dark:text-gray-400">
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
                  className={`flex w-full flex-col gap-0.5 border-b border-gray-100 px-3 py-2.5 text-left transition dark:border-gray-800 ${
                    active
                      ? "bg-emerald-50 dark:bg-emerald-950/30"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-gray-900 dark:text-white">
                        {c.customerName}
                      </span>
                      {c.pendingHuman && (
                        <span className="shrink-0 rounded bg-red-100 px-1 py-0.5 text-[9px] font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300">
                          รอตอบ
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[10px] text-gray-400">
                      {timeAgo(c.lastMessageAt)}
                    </span>
                  </div>
                  <span className="truncate text-xs text-gray-500 dark:text-gray-400">
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
      <div className="flex flex-1 flex-col rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        {!detail ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            {activeId ? "กำลังโหลด…" : "เลือกบทสนทนา หรือจำลองลูกค้าทักเพื่อเริ่ม"}
          </div>
        ) : (
          <>
            <div className="flex items-center border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <div>
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
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
                        ? "bg-emerald-600 text-white"
                        : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* ช่องร่าง/ส่ง */}
            <div className="border-t border-gray-200 p-3 dark:border-gray-800">
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
                      className="block w-full rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-left text-sm text-gray-800 transition hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-gray-100 dark:hover:bg-emerald-950/40"
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

              {/* แถวจำลองลูกค้า (สำหรับทดสอบ) */}
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-gray-50 p-2 dark:bg-gray-800/50">
                <span className="shrink-0 text-[11px] font-medium text-gray-400">
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
            </div>
          </>
        )}

        {/* เริ่มแชทจำลองใหม่ (เมื่อยังไม่เลือก/ไม่มีบทสนทนา) */}
        {!detail && (
          <div className="border-t border-gray-200 p-3 dark:border-gray-800">
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

/** หน้ารวมแพลตฟอร์ม — การ์ดไอคอน + ชื่อ กดเข้าหน้าแชตของเจ้านั้น */
function PlatformHub({
  conversations,
  onPick,
}: {
  conversations: ConversationSummary[];
  onPick: (channel: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">กล่องแชต</h2>
        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
          รวมแชตจากทุกแพลตฟอร์มไว้ที่เดียว — กดแพลตฟอร์มเพื่อเปิดแชต
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {PLATFORMS.map((p) => {
          const convos = conversations.filter((c) => c.channel === p.channel);
          const pending = convos.filter((c) => c.pendingHuman).length;
          return (
            <button
              key={p.id}
              type="button"
              disabled={!p.available}
              onClick={() => p.available && onPick(p.channel)}
              className={`flex flex-col items-start gap-3 rounded-2xl border p-4 text-left transition ${
                p.available
                  ? "border-gray-200 bg-white hover:border-emerald-400 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-emerald-600"
                  : "cursor-not-allowed border-dashed border-gray-200 bg-gray-50 opacity-60 dark:border-gray-800 dark:bg-gray-900/40"
              }`}
            >
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-xl text-white ${p.iconBg}`}
              >
                <p.Glyph />
              </span>
              <div className="w-full">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-gray-900 dark:text-white">
                    {p.name}
                  </span>
                  {pending > 0 && (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300">
                      รอตอบ {pending}
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {p.available ? `${convos.length} บทสนทนา` : "เร็วๆ นี้"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
