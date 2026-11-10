"use client";

import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Download, ImageIcon, Share2, X } from "lucide-react";
import { Button } from "@/components/motion/button/base";
import { Drawer } from "@/components/motion/drawer";
import { Input } from "@/components/motion/input";
import { cn } from "@/lib/utils";
import { canvasBlob, renderShareCard, shareTemplates, type ShareTemplate } from "./share-card";
import { useIsRtl } from "@/i18n/use-direction";

export interface ShareSubject {
  code: string;
  productName: string;
  productIcon?: string | null;
  expiresAt: number | null;
}

// 分享圖片：三款模板，在本機畫好後存檔或用系統分享（iOS 可在分享面板選「儲存影像」）。
export function ShareImageDialog({ subject, brand, onDone }: { subject: ShareSubject; brand: string; onDone?: (message: string) => void }) {
  const rtl = useIsRtl();
  const t = useTranslations("handout");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState<ShareTemplate>("paper");
  const [message, setMessage] = useState("");
  const [previews, setPreviews] = useState<Partial<Record<ShareTemplate, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const urls = useRef<string[]>([]);

  const input = {
    code: subject.code,
    product: subject.productName,
    eyebrow: t("cardEyebrow"),
    message: message.trim() || null,
    expires: subject.expiresAt ? t("cardExpires", { date: format.dateTime(subject.expiresAt, { dateStyle: "medium" }) }) : null,
    brand,
    icon: subject.productIcon ?? null,
  };
  const key = JSON.stringify(input);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const next: Partial<Record<ShareTemplate, string>> = {};
        for (const item of shareTemplates) {
          const canvas = await renderShareCard(item, JSON.parse(key), 0.5);
          const url = URL.createObjectURL(await canvasBlob(canvas));
          urls.current.push(url);
          next[item] = url;
        }
        if (!cancelled) setPreviews(next);
      } catch {
        if (!cancelled) setError(true);
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, key]);

  // 關閉時釋放預覽圖的記憶體。
  useEffect(() => {
    if (open) return;
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current = [];
  }, [open]);

  async function file() {
    const canvas = await renderShareCard(template, input, 1);
    const blob = await canvasBlob(canvas);
    const safe = subject.productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "code";
    return new File([blob], `${safe}-${template}.png`, { type: "image/png" });
  }

  async function save() {
    setBusy(true);
    setError(false);
    try {
      const image = await file();
      const url = URL.createObjectURL(image);
      const link = document.createElement("a");
      link.href = url;
      link.download = image.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      onDone?.(t("imageSaved"));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    setBusy(true);
    setError(false);
    try {
      const image = await file();
      if (navigator.canShare?.({ files: [image] })) await navigator.share({ files: [image], title: t("shareTitle", { product: subject.productName }) });
      else await save();
    } catch (reason) {
      // 使用者取消分享不算錯誤。
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <ImageIcon className="size-3.5" aria-hidden />
        {t("shareImage")}
      </Button>
      <Drawer side={rtl ? "left" : "right"} open={open} onOpenChange={setOpen} ariaLabel={t("shareImageTitle")} className="w-full max-w-lg">
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">{t("shareImageTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("shareImageDescription")}</p>
            </div>
            <Button variant="ghost" size="icon" aria-label={t("close")} onClick={() => setOpen(false)}>
              <X className="size-4" aria-hidden />
            </Button>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <div className="mx-auto aspect-[4/5] w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-muted">
              {previews[template] ? (
                // eslint-disable-next-line @next/next/no-img-element -- 本機產生的 blob 預覽，不需要圖片最佳化。
                <img src={previews[template]} alt={t("preview", { template: t(`templates.${template}`) })} className="size-full object-cover" />
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label={t("shareImageTitle")}>
              {shareTemplates.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={template === item}
                  onClick={() => setTemplate(item)}
                  className={cn(
                    "space-y-1.5 rounded-xl border p-1.5 text-xs font-medium transition-colors",
                    template === item ? "border-primary ring-1 ring-primary" : "border-border hover:border-muted-foreground/40",
                  )}
                >
                  <span className="block aspect-[4/5] overflow-hidden rounded-lg bg-muted">
                    {previews[item] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 本機產生的 blob 預覽。
                      <img src={previews[item]} alt="" className="size-full object-cover" />
                    ) : null}
                  </span>
                  <span className="block pb-1">{t(`templates.${item}`)}</span>
                </button>
              ))}
            </div>
            <Input label={t("cardMessage")} value={message} onChange={setMessage} maxLength={140} placeholder={t("cardMessagePlaceholder")} />
            {error && <p role="alert" className="text-sm text-destructive">{t("imageFailed")}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-border px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button variant="secondary" disabled={busy} onClick={() => void save()}>
              <Download className="size-4" aria-hidden />
              {t("saveImage")}
            </Button>
            <Button disabled={busy} onClick={() => void share()}>
              <Share2 className="size-4" aria-hidden />
              {t("shareImageAction")}
            </Button>
          </div>
        </div>
      </Drawer>
    </>
  );
}
