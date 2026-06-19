"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Rule, Shop, ShopData, ShopSummary } from "@/lib/types";

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
  const [shop, setShop] = useState<Shop>({ name: "", voice: "" });
  const [rules, setRules] = useState<Rule[]>([]);
  const [save, setSave] = useState<SaveState>("idle");

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
      setRules(data.rules);
      setLoad({ kind: "ready" });
    } catch {
      setLoad({ kind: "error", message: "โหลดข้อมูลร้านไม่สำเร็จ" });
    }
  }

  function markDirty() {
    setSave((s) => (s === "saving" ? s : "idle"));
  }

  async function handleSave() {
    if (!selectedId || save === "saving") return;
    setSave("saving");
    try {
      const res = await fetch(`/api/admin/shops/${selectedId}`, {
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
      // อัปเดตชื่อ/จำนวนคู่พ่วงในลิสต์ซ้าย
      setList((prev) =>
        prev.map((s) =>
          s.id === selectedId
            ? { ...s, name: data.shop.name, ruleCount: data.rules.length }
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
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">พ่วง</h1>
            <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs font-semibold text-white">
              ผู้ดูแลระบบ
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            ดู/แก้ข้อมูลได้ทุกร้าน — เพื่อการคุมระบบเท่านั้น
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-sm">
          <span className="hidden text-gray-500 sm:inline">@{username}</span>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 transition hover:bg-gray-50"
          >
            ออกจากระบบ
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_1fr]">
        {/* รายชื่อร้าน */}
        <aside className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">
              ร้านทั้งหมด ({list.length})
            </h2>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="text-xs font-medium text-emerald-700 hover:underline"
            >
              รีเฟรช
            </button>
          </div>

          {list.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
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
                          ? "border-emerald-400 bg-emerald-50"
                          : "border-gray-200 bg-white hover:bg-gray-50"
                      }`}
                    >
                      <div className="truncate text-sm font-semibold text-gray-900">
                        {s.name || "(ยังไม่ตั้งชื่อร้าน)"}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-xs text-gray-500">
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
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          {!selected ? (
            <div className="flex min-h-[12rem] items-center justify-center text-sm text-gray-500">
              เลือกร้านจากรายการด้านซ้ายเพื่อดู/แก้ข้อมูล
            </div>
          ) : load.kind === "loading" ? (
            <div className="flex min-h-[12rem] items-center justify-center text-sm text-gray-500">
              กำลังโหลดข้อมูลร้าน…
            </div>
          ) : load.kind === "error" ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
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
              save={save}
              onSave={handleSave}
            />
          )}
        </section>
      </div>
    </main>
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
          <h2 className="text-base font-semibold text-gray-900">
            {shop.name || "(ยังไม่ตั้งชื่อร้าน)"}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            แอดมิน @{selected.username} · รหัสร้าน {selected.id.slice(0, 8)}…
          </p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={save === "saving"}
          className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
            save === "error"
              ? "border border-red-300 bg-white text-red-600 hover:bg-red-50"
              : "bg-emerald-600 text-white hover:bg-emerald-700"
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
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">รายการคู่พ่วง</h3>
          <button type="button" onClick={addRule} className={secondaryBtnClass}>
            + เพิ่มคู่พ่วง
          </button>
        </div>

        {rules.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
            ร้านนี้ยังไม่มีคู่พ่วง
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {rules.map((rule, i) => (
              <div key={rule.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">
                    คู่พ่วง #{i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRule(rule.id)}
                    className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
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
                  <Field label="ราคา (บาท)" compact>
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
        className={`mb-1 block font-medium text-gray-700 ${compact ? "text-xs" : "text-sm"}`}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

const secondaryBtnClass =
  "rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50";
