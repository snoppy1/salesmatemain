"use client";

import { useEffect, useRef, useState } from "react";

/**
 * เลขไต่ขึ้นสู่ค่าจริง (ease-out ~0.7s) — โหลดครั้งแรกไต่จาก 0,
 * ค่าเปลี่ยนภายหลัง (เช่นรีเฟรชทุก 30 วิ) ไต่จากค่าเดิมเฉพาะตอนค่าเปลี่ยนจริง
 * เคารพ prefers-reduced-motion: แสดงค่าตรงทันที ไม่ไต่
 */
export default function CountUp({
  value,
  format = (n) => n.toLocaleString(),
}: {
  value: number;
  format?: (n: number) => string;
}) {
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [shown, setShown] = useState(reduce ? value : 0);
  const shownRef = useRef(shown);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const from = shownRef.current;
    if (from === value) return;
    const t0 = performance.now();
    const DURATION = 700;
    let raf = requestAnimationFrame(function tick(t: number) {
      const p = Math.min((t - t0) / DURATION, 1);
      const cur = Math.round(from + (value - from) * (1 - Math.pow(1 - p, 4)));
      shownRef.current = cur;
      setShown(cur);
      if (p < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{format(shown)}</>;
}
