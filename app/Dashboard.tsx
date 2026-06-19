"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Rule, Shop, ShopData, GenerateResult } from "@/lib/types";
import ThemeToggle from "@/components/ThemeToggle";

function newRule(): Rule {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    trigger: "",
    partner: "",
    price: "",
    reason: "",
    promo: "",
  };
}

type ResultState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "result"; data: GenerateResult }
  | { kind: "error"; message: string };

type SaveState = "idle" | "saving" | "saved" | "error";

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
  const [save, setSave] = useState<SaveState>("idle");

  const [customerMsg, setCustomerMsg] = useState("");
  const [customerContext, setCustomerContext] = useState("");
  const [result, setResult] = useState<ResultState>({ kind: "idle" });

  function markDirty() {
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

  async function handleSave() {
    if (save === "saving") return;
    setSave("saving");
    try {
      const res = await fetch("/api/shop", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shop, rules } satisfies ShopData),
      });
      if (!res.ok) {
        setSave("error");
        return;
      }
      const data = (await res.json()) as ShopData;
      setShop(data.shop);
      setRules(data.rules);
      setSave("saved");
    } catch {
      setSave("error");
    }
  }

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
          customerMsg,
          customerContext,
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

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-xl font-bold text-white shadow-sm">
            พ
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              พ่วง
            </h1>
            <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
              AI แนะนำประโยคขายพ่วง — แอดมินอ่านแล้วกดส่งเอง
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm">
          <span className="hidden text-gray-500 dark:text-gray-400 sm:inline">
            @{username}
          </span>
          <ThemeToggle />
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            ออกจากระบบ
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ShopSettings
          shop={shop}
          updateShop={updateShop}
          rules={rules}
          updateRule={updateRule}
          addRule={addRule}
          removeRule={removeRule}
          save={save}
          onSave={handleSave}
        />
        <Console
          customerMsg={customerMsg}
          setCustomerMsg={setCustomerMsg}
          customerContext={customerContext}
          setCustomerContext={setCustomerContext}
          onGenerate={handleGenerate}
          result={result}
        />
      </div>
    </main>
  );
}

/* ---------------- ฝั่งซ้าย: ตั้งค่า ---------------- */

function ShopSettings({
  shop,
  updateShop,
  rules,
  updateRule,
  addRule,
  removeRule,
  save,
  onSave,
}: {
  shop: Shop;
  updateShop: (patch: Partial<Shop>) => void;
  rules: Rule[];
  updateRule: (id: string, patch: Partial<Rule>) => void;
  addRule: () => void;
  removeRule: (id: string) => void;
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
            placeholder="เช่น เป็นกันเอง ใช้คำว่า 'นะคะ' น่ารักๆ มีอีโมจิบ้าง ไม่ทางการ"
            rows={2}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">รายการคู่พ่วง</h3>
          <button type="button" onClick={addRule} className={secondaryBtnClass}>
            + เพิ่มคู่พ่วง
          </button>
        </div>

        {rules.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
            ยังไม่มีคู่พ่วง — กด “+ เพิ่มคู่พ่วง” เพื่อกำหนดว่าสินค้าไหนเสนอพ่วงกับอะไร
          </p>
        ) : (
          <div className="mt-3 space-y-3">
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
    </section>
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
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">คู่พ่วง #{index + 1}</span>
        <button
          type="button"
          onClick={onRemove}
          className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
          aria-label={`ลบคู่พ่วงที่ ${index + 1}`}
        >
          ลบ
        </button>
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
        <Field label="ราคา (บาท)" compact>
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
  customerContext,
  setCustomerContext,
  onGenerate,
  result,
}: {
  customerMsg: string;
  setCustomerMsg: (v: string) => void;
  customerContext: string;
  setCustomerContext: (v: string) => void;
  onGenerate: () => void;
  result: ResultState;
}) {
  const loading = result.kind === "loading";
  const canGenerate = customerMsg.trim().length > 0 && !loading;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h2 className="text-base font-semibold text-gray-900 dark:text-white">เจนประโยคขายพ่วง</h2>

      <div className="mt-4 space-y-4">
        <Field label="ข้อความล่าสุดของลูกค้า">
          <textarea
            value={customerMsg}
            onChange={(e) => setCustomerMsg(e.target.value)}
            placeholder="วางข้อความที่ลูกค้าเพิ่งทักมา เช่น สนใจครีมทารอบดวงตา มีโปรไหมคะ"
            rows={4}
            className={inputClass}
          />
        </Field>

        <Field label="บริบทลูกค้า (ถ้ารู้)">
          <input
            type="text"
            value={customerContext}
            onChange={(e) => setCustomerContext(e.target.value)}
            placeholder="เช่น งบไม่เกิน 500 / ซื้อเป็นของขวัญ / ลูกค้าเก่า"
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
