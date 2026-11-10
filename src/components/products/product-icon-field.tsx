"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ImageUp, Trash2 } from "lucide-react";
import { Button } from "@/components/motion/button/base";
import { Notice } from "@/components/dashboard/notice";
import { ProductIcon } from "@/components/products/product-icon";
import { PRODUCT_ICON_MAX_BYTES, PRODUCT_ICON_SIZE, productIconUrl } from "@/lib/domain/product-icon";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif";
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("INVALID_IMAGE"));
    };
    image.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

// 在瀏覽器裡置中裁成正方形並縮到 256px；SVG 等格式也在這裡轉成點陣圖，伺服器只收 PNG／WebP／JPEG。
async function prepareIcon(file: File) {
  if (file.size > MAX_SOURCE_BYTES) throw new Error("SOURCE_TOO_LARGE");
  const image = await loadImage(file);
  const width = image.naturalWidth || PRODUCT_ICON_SIZE;
  const height = image.naturalHeight || PRODUCT_ICON_SIZE;
  const side = Math.min(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PRODUCT_ICON_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("INVALID_IMAGE");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, PRODUCT_ICON_SIZE, PRODUCT_ICON_SIZE);
  // 優先 WebP（保留透明、檔案小），瀏覽器不支援就用 PNG；太大再退到 JPEG。
  for (const [type, quality] of [["image/webp", 0.9], ["image/png", undefined], ["image/jpeg", 0.88]] as const) {
    const blob = await toBlob(canvas, type, quality);
    if (blob && blob.type === type && blob.size <= PRODUCT_ICON_MAX_BYTES) return blob;
  }
  throw new Error("IMAGE_TOO_LARGE");
}

export function ProductIconField({ productId, version }: { productId: string; version: string | null }) {
  const t = useTranslations("products");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState(version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const blob = await prepareIcon(file);
      const response = await fetch(`/api/products/${productId}/icon`, { method: "PUT", headers: { "Content-Type": blob.type }, body: blob });
      if (!response.ok) throw new Error(response.status === 413 ? "IMAGE_TOO_LARGE" : "UPLOAD_FAILED");
      const data = (await response.json()) as { version: string };
      setCurrent(data.version);
      router.refresh();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(t(code === "INVALID_IMAGE" ? "iconInvalid" : code === "IMAGE_TOO_LARGE" || code === "SOURCE_TOO_LARGE" ? "iconTooLarge" : "iconFailed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/products/${productId}/icon`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setCurrent(null);
      router.refresh();
    } catch {
      setError(t("iconFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{t("icon")}</p>
      <div className="flex items-center gap-4">
        <ProductIcon url={productIconUrl(productId, current)} className="size-16 rounded-2xl" />
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
            <ImageUp className="size-3.5" aria-hidden />
            {t(busy ? "iconWorking" : current ? "iconReplace" : "iconUpload")}
          </Button>
          {current && (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>
              <Trash2 className="size-3.5" aria-hidden />
              {t("iconRemove")}
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t("iconHint")}</p>
      {error && <Notice variant="destructive">{error}</Notice>}
    </div>
  );
}
