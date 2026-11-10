"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Smartphone, X } from "lucide-react";
import { Button } from "@/components/motion/button/base";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

const DISMISS_KEY = "keydrop-handout-install-dismissed";

// 「加到主畫面」提示：Android／Chrome 用系統安裝提示；iOS Safari 沒有 API，只能顯示操作說明。
export function InstallHint() {
  const t = useTranslations("handout");
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* 忽略 */
    }
    if (standalone || dismissed) return;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 只能在瀏覽器判斷裝置與安裝狀態。
    setIos(isIos);
    setHidden(!isIos);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* 忽略 */
    }
  };
  return (
    <div className="mb-4 flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted" aria-hidden>
        <Smartphone className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-medium">{t("install")}</p>
        <p className="text-muted-foreground">{ios && !prompt ? t("installIos") : t("installHint")}</p>
        {prompt && (
          <Button size="sm" onClick={() => void prompt.prompt().finally(() => setHidden(true))}>
            {t("install")}
          </Button>
        )}
      </div>
      <button type="button" onClick={dismiss} aria-label={t("dismiss")} className="rounded-lg p-1 text-muted-foreground hover:bg-muted">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
