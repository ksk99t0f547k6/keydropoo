"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/motion/button/base";
import { Drawer } from "@/components/motion/drawer";
import { cn } from "@/lib/utils";
import { useIsRtl } from "@/i18n/use-direction";

// 「新增」按鈕＋右側 beUI 抽屜，放建立用的表單。
export function FormDrawer({
  label,
  title,
  description,
  children,
  wide = false,
  disabled = false,
  variant = "primary",
}: {
  label: ReactNode;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  const rtl = useIsRtl();
  const t = useTranslations("shell");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant={variant} disabled={disabled} onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden />
        {label}
      </Button>
      <Drawer side={rtl ? "left" : "right"} open={open} onOpenChange={setOpen} ariaLabel={title} className={cn("w-full", wide ? "max-w-2xl" : "max-w-md")}>
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">{title}</h2>
              {description && <p className="text-sm text-muted-foreground">{description}</p>}
            </div>
            <Button variant="ghost" size="icon" aria-label={t("close")} onClick={() => setOpen(false)}>
              <X className="size-4" aria-hidden />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
        </div>
      </Drawer>
    </>
  );
}
