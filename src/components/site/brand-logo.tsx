import { cn } from "@/lib/utils";
import { mark, wordmark } from "./brand-paths";

// 品牌字標與圖示。字母跟著文字色（currentColor），句點用 --brand-accent，深淺色自動切換。
// 部署者換品牌時只要改這個檔案；label 傳入 messages 的 common.brand，給螢幕閱讀器讀。

export function BrandWordmark({ label, className }: { label: string; className?: string }) {
  return (
    <svg viewBox={wordmark.viewBox} role="img" aria-label={label} className={cn("h-7 w-auto", className)}>
      <path fill="currentColor" d={wordmark.letters} />
      <path fill="currentColor" fillRule="evenodd" d={wordmark.keyhole} />
      <circle {...wordmark.dot} fill="var(--brand-accent)" />
    </svg>
  );
}

// 圓角方塊圖示：底色用 --primary，字母用 --primary-foreground，跟著主題反轉。
export function BrandMark({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox={mark.viewBox}
      className={cn("size-7 shrink-0", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <rect width="512" height="512" rx="112" fill="var(--primary)" />
      <g transform={mark.transform}>
        <path fill="var(--primary-foreground)" d={mark.k} />
        <circle {...mark.dot} fill="var(--brand-accent-on-primary)" />
      </g>
    </svg>
  );
}
