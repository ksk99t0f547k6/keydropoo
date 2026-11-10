"use client";

import { useEffect, useState } from "react";
import { Check, CreditCard } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useReducedMotion } from "motion/react";
import { BrandMark } from "@/components/site/brand-logo";

// 純展示用的範例碼，不讀資料庫。
const CODES = ["KDRP-7F3A-Q9LM", "LNCH-24XW-8B7C", "PRO1-M4ZT-6HQV", "BETA-9KRD-3NFX"];
const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const START_LEFT = 248;

// 每隔幾秒「掉落」一組新碼：字元先亂跳再逐一定格，剩餘數量跟著減一。
function useCodeDrop(reduce: boolean) {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState(CODES[0]);
  const [left, setLeft] = useState(START_LEFT);
  useEffect(() => {
    if (reduce) return;
    const cycle = window.setInterval(() => {
      setIndex((value) => (value + 1) % CODES.length);
      setLeft((value) => (value > 200 ? value - 1 : START_LEFT));
    }, 3600);
    return () => window.clearInterval(cycle);
  }, [reduce]);
  useEffect(() => {
    if (reduce) return;
    const target = CODES[index];
    let frame = 0;
    const total = 18;
    const timer = window.setInterval(() => {
      frame += 1;
      const settled = Math.floor((frame / total) * target.length);
      setText(
        [...target]
          .map((char, i) => (char === "-" || i < settled ? char : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]))
          .join(""),
      );
      if (frame >= total) window.clearInterval(timer);
    }, 40);
    return () => window.clearInterval(timer);
  }, [index, reduce]);
  // 減少動態時不亂碼，直接顯示當下的碼。
  return { text: reduce ? CODES[index] : text, left, index };
}

export function HeroVisual() {
  const t = useTranslations("home.visual");
  const format = useFormatter();
  const reduce = useReducedMotion() ?? false;
  const { text, left, index } = useCodeDrop(reduce);
  return (
    <div className="relative mx-auto aspect-[5/4] w-full max-w-[480px] select-none" aria-hidden>
      {/* 後面兩張票券 */}
      <div className="absolute inset-x-[12%] top-[14%] h-[58%] -rotate-[9deg] rounded-[28px] border border-border bg-card/70 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.35)] backdrop-blur-sm" />
      <div className="absolute inset-x-[8%] top-[10%] h-[60%] rotate-[6deg] rounded-[28px] border border-border bg-card shadow-[0_24px_70px_-30px_rgba(0,0,0,0.4)]" />

      {/* 主票券 */}
      <div className="kd-float absolute inset-x-[4%] top-[12%] overflow-hidden rounded-[28px] bg-[#1e2230] text-[#f4f3ef] shadow-[0_40px_90px_-30px_rgba(30,34,48,0.75)] ring-1 ring-white/10">
        <div className="pointer-events-none absolute -end-16 -top-20 size-56 rounded-full bg-[#ff5a4e]/35 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -start-10 size-56 rounded-full bg-[#7c6cff]/30 blur-3xl" />
        <div className="relative flex items-center justify-between gap-3 px-6 pt-6">
          <span className="flex items-center gap-2.5 text-sm font-medium">
            <BrandMark className="size-7 [--primary:#f4f3ef] [--primary-foreground:#1e2230] [--brand-accent-on-primary:#d9443b]" />
            {t("campaign")}
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 font-mono text-[11px] tabular-nums text-white/80">
            {t("left", { count: format.number(left) })}
          </span>
        </div>
        <div className="relative px-6 pb-7 pt-8">
          <p key={index} className="kd-drop font-mono text-[clamp(22px,4.6vw,34px)] font-semibold tracking-[0.06em] tabular-nums">
            {text}
          </p>
        </div>
        {/* 撕線與缺口 */}
        <div className="relative">
          <div className="mx-6 border-t-2 border-dashed border-white/15" />
          <span className="absolute -start-4 -top-4 size-8 rounded-full bg-background" />
          <span className="absolute -end-4 -top-4 size-8 rounded-full bg-background" />
        </div>
        <div className="relative flex items-center justify-between px-6 py-4 text-xs text-white/70">
          <span className="flex items-center gap-1.5">
            <span className="grid size-4 place-items-center rounded-full bg-emerald-400/90 text-[#1e2230]">
              <Check className="size-3" strokeWidth={3} />
            </span>
            {t("claimed")}
          </span>
          <span>{t("justNow")}</span>
        </div>
      </div>

      {/* 浮動提示 */}
      <div className="kd-float-slow absolute -end-1 top-[2%] flex items-center gap-2 rounded-2xl border border-border bg-background/90 px-3.5 py-2.5 text-sm shadow-lg backdrop-blur-md sm:-end-6">
        <span className="grid size-7 place-items-center rounded-lg bg-[#635bff] text-white">
          <CreditCard className="size-3.5" />
        </span>
        <span className="leading-tight">
          <span className="block text-[11px] text-muted-foreground">{t("paid")}</span>
          <span className="font-semibold tabular-nums">{format.number(9, { style: "currency", currency: "USD" })}</span>
        </span>
      </div>
      <div className="kd-float-delay absolute bottom-[4%] start-0 flex items-center gap-2 rounded-2xl border border-border bg-background/90 px-3.5 py-2.5 text-sm shadow-lg backdrop-blur-md sm:-start-6">
        <span className="grid size-7 place-items-center rounded-lg bg-emerald-500 text-white">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
        <span className="font-medium">{t("delivered")}</span>
      </div>
    </div>
  );
}
