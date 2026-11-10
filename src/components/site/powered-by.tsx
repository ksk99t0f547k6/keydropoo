import { useTranslations } from "next-intl";
import { poweredBy } from "@/config/site";
import { cn } from "@/lib/utils";

// 「Powered by Keydrop」小字連結；在 src/config/site.ts 的 poweredBy.enabled 關閉。
export function PoweredBy({ className }: { className?: string }) {
  const t = useTranslations("common");
  if (!poweredBy.enabled) return null;
  return (
    <p className={cn("powered-by", className)}>
      {t.rich("poweredBy", {
        link: (chunks) => (
          <a href={poweredBy.url} target="_blank" rel="noopener">
            {chunks}
          </a>
        ),
      })}
    </p>
  );
}
