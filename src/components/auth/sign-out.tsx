"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/motion/button/base";
export function SignOut() {
 const t = useTranslations(); const [error, setError] = useState(false);
 return <><Button variant="ghost" onClick={async () => {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 登出後完整重載，清除含明文碼的 React 與路由快取。
  try { const r = await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); if (!r.ok) throw new Error(); location.assign("/sign-in"); } catch { setError(true); }
 }}>{t("common.signOut")}</Button>{error && <span role="alert">{t("errors.generic")}</span>}</>;
}
