"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";

// 以網址切換的 beUI 分頁（篩選列、子頁導覽）。
export function LinkTabs({
  value,
  items,
  label,
  variant = "pill",
  className,
}: {
  value: string;
  items: { value: string; label: ReactNode; href: string; icon?: ReactNode }[];
  label: string;
  variant?: "pill" | "underline" | "segment";
  className?: string;
}) {
  const router = useRouter();
  return (
    <Tabs value={value} onValueChange={(next) => router.push(items.find((item) => item.value === next)?.href ?? "")} variant={variant} className={className}>
      <TabsList aria-label={label} className={variant === "underline" ? "w-full" : "border border-border"}>
        {items.map((item) => (
          <TabsTrigger key={item.value} value={item.value} icon={item.icon}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
