"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type {
  ConversationSummary,
  ConversationDetail,
  GenerateResult,
} from "@/lib/types";

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

export default function InboxView() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [simText, setSimText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // ร่าง/เหตุผล เก็บแยกต่อบทสนทนา — สลับแชตแล้วข้อความไม่ปนกัน
  const draft = activeId ? (drafts[activeId] ?? "") : "";
  const reason = activeId ? (reasons[activeId] ?? "") : "";
  const setDraftFor = (id: string, v: string) =>
    setDrafts((m) => ({ ...m, [id]: v }));
  const setReasonFor = (id: string, v: string) =>
    setReasons((m) => ({ ...m, [id]: v }));

  const loadConversations = useCallback(async () => {
    try {
      const r = await fetch("/api/line/conversations");
      if (!r.ok) return;
      const d = (await r.json()) as { conversations: ConversationSummary[] };
      setConversations(d.conversations);
      setActiveId((cur) => cur ?? d.conversations[0]?.id ?? null);
    } catch {
      /* เงียบไว้ */
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/line/conversation?id=${encodeURIComponent(id)}`);
      if (!r.ok) return;
      const d = (await r.json()) as { conversation: ConversationDetail };
      setDetail(d.conversation);
    } catch {
      /* เงียบไว้ */
    }
  }, []);

  // โหลดลิสต์ + poll ทุก 4 วิ
  useEffect(() => {
    void loadConversations();
    const t = setInterval(() => void loadConversations(), 4000);
    return () => clearInterval(t);
  }, [loadConversations]);

  // โหลดบทสนทนาที่เลือก + poll ทุก 3 วิ
  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    void loadDetail(activeId);
    const t = setInterval(() => void loadDetail(activeId), 3000);
    return () => clearInterval(t);
  }, [activeId, loadDetail]);

  // เลื่อนลงล่างสุดเมื่อข้อความเพิ่ม
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages.length]);

  // ล้างช่องจำลองลูกค้าเมื่อสลับบทสนทนา (กันค้างข้ามแชต)
  useEffect(() => {
    setSimText("");
  }, [activeId]);

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
      const d = (await r.json()) as GenerateResult & { error?: string };
      if (!r.ok) {
        setReasonFor(id, d.error || "ร่างคำตอบไม่สำเร็จ");
        return;
      }
      setDraftFor(id, d.message || "");
      setReasonFor(
        id,
        d.should_upsell
          ? d.reason_for_admin || ""
          : "AI มองว่ารอบนี้ยังไม่ต้องเสนอขายพ่วง — ตอบตามปกติได้",
      );
    } catch {
      setReasonFor(id, "ร่างคำตอบไม่สำเร็จ ลองใหม่");
    } finally {
      setDrafting(false);
    }
  }

  async function handleSend() {
    if (!activeId || sending) return;
    const id = activeId;
    const text = (drafts[id] ?? "").trim();
    if (!text) return;
    setSending(true);
    try {
      const r = await fetch("/api/line/send", {
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

  // จำลองลูกค้าทัก (เริ่มใหม่ หรือต่อบทเดิม)
  async function handleSimulate(continueChat: boolean) {
    const text = simText.trim();
    if (!text) return;
    const body: Record<string, string> = { text };
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

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* ซ้าย: รายการบทสนทนา */}
      <div className="flex w-72 shrink-0 flex-col rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-200 p-3 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            กล่องแชต
          </h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            ลูกค้าทักเข้ามา · AI ช่วยร่าง · กดส่งเอง
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="p-4 text-center text-xs text-gray-500 dark:text-gray-400">
              ยังไม่มีบทสนทนา — ลองจำลองลูกค้าทักด้านล่าง
            </p>
          ) : (
            conversations.map((c) => {
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
                    <span className="truncate text-sm font-medium text-gray-900 dark:text-white">
                      {c.customerName}
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
            เลือกบทสนทนา หรือจำลองลูกค้าทักเพื่อเริ่ม
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <div>
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {detail.customerName}
                </span>
                <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-950/50 dark:text-green-300">
                  {detail.channel.toUpperCase()}
                </span>
              </div>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                โหมดกดส่งเอง
              </span>
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
              <textarea
                value={draft}
                onChange={(e) => activeId && setDraftFor(activeId, e.target.value)}
                rows={2}
                placeholder="พิมพ์คำตอบ หรือกด “ให้ AI ร่าง” แล้วแก้ก่อนส่ง"
                className={`${inputCls} resize-none`}
              />
              <div className="mt-2 flex items-center gap-2">
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
