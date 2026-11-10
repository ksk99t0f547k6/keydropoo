import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

// 商品圖示：有上傳就顯示圖片，沒有就用預設的盒子圖示。圖片是裝飾，名稱另外以文字呈現。
export function ProductIcon({ url, className }: { url: string | null | undefined; className?: string }) {
  return (
    <span
      className={cn("grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted/50 text-muted-foreground", className)}
      aria-hidden
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- 圖示來自本站 API，尺寸已固定，不需要 next/image 最佳化。
        <img src={url} alt="" className="size-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <Package className="size-[45%]" />
      )}
    </span>
  );
}
