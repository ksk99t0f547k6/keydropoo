"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Boxes, Cpu, Gift, Megaphone, Settings } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";

const sections = [
  { key: "inventory", path: "", icon: Boxes },
  { key: "campaigns", path: "/campaigns", icon: Megaphone },
  { key: "devices", path: "/devices", icon: Cpu },
  { key: "entitlements", path: "/entitlements", icon: Gift },
  { key: "settings", path: "/settings", icon: Settings },
] as const;

// 商品各分頁的導覽：beUI 底線分頁，切換時換網址。
export function ProductTabs({ productId }: { productId: string }) {
  const t = useTranslations("productNav");
  const pathname = usePathname();
  const router = useRouter();
  const base = `/dashboard/products/${productId}`;
  const current = sections.find((section) => section.path && pathname.startsWith(base + section.path))?.key ?? "inventory";
  return (
    <Tabs value={current} onValueChange={(value) => router.push(base + (sections.find((section) => section.key === value)?.path ?? ""))} variant="underline" className="mb-8">
      <TabsList aria-label={t("label")} className="w-full">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <TabsTrigger key={section.key} value={section.key} icon={<Icon className="size-4" />}>
              {t(section.key)}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
