"use client";

import { useLocale } from "next-intl";
import { rtlLocales, type Locale } from "./locales";

// 目前語言是否由右到左（阿拉伯文）。抽屜、側欄等有方向性的元件用它決定從哪一邊出現。
export function useIsRtl() {
  return rtlLocales.includes(useLocale() as Locale);
}
