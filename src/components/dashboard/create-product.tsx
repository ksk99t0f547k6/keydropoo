"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/motion/button/base";
import { Drawer } from "@/components/motion/drawer";
import { ProductForm } from "@/components/products/product-form";
import { useIsRtl } from "@/i18n/use-direction";

// 「新增商品」按鈕＋右側抽屜；網址帶 ?new=1 時自動開啟（指令面板與首頁捷徑會用到）。
export function CreateProductButton() {
  const rtl = useIsRtl();
  const t = useTranslations();
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 只在網址要求時開啟一次。
    if (params.get("new") === "1") setOpen(true);
  }, [params]);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden />
        {t("productsPage.newProduct")}
      </Button>
      <Drawer side={rtl ? "left" : "right"} open={open} onOpenChange={setOpen} ariaLabel={t("products.create")} className="w-full max-w-md">
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">{t("products.create")}</h2>
              <p className="text-sm text-muted-foreground">{t("productsPage.createDescription")}</p>
            </div>
            <Button variant="ghost" size="icon" aria-label={t("shell.close")} onClick={() => setOpen(false)}>
              <X className="size-4" aria-hidden />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <ProductForm onCreated={(id) => router.push(`/dashboard/products/${id}`)} />
          </div>
        </div>
      </Drawer>
    </>
  );
}
