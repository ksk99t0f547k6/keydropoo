import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { z } from "zod";
import { runtime } from "@/lib/server/env";
import { currencyDigits } from "@/lib/domain/money";
import { PageHeader } from "@/components/dashboard/page-header";
import { ProductTabs } from "@/components/dashboard/product-tabs";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { ProductIcon } from "@/components/products/product-icon";
import { productIconUrl } from "@/lib/domain/product-icon";

export const dynamic = "force-dynamic";

// 商品頁共用頁首與分頁導覽；權限由上層 dashboard layout 與各頁再檢查。
export default async function ProductLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { env } = await runtime();
  const product = await env.DB.prepare("SELECT name,slug,description,price_minor,currency,archived_at,icon_version FROM products WHERE id=?")
    .bind(id)
    .first<{ name: string; slug: string; description: string | null; price_minor: number; currency: string; archived_at: number | null; icon_version: string | null }>();
  if (!product) notFound();
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  return (
    <>
      <PageHeader
        crumbs={[{ label: t("products.title"), href: "/dashboard/products" }, { label: product.name }]}
        title={
          <span className="flex items-center gap-3">
            <ProductIcon url={productIconUrl(id, product.icon_version)} className="size-10 rounded-xl" />
            <span className="min-w-0">{product.name}</span>
          </span>
        }
        meta={
          <AnimatedBadge size="sm" status={product.archived_at === null ? "success" : "neutral"} showIcon={false}>
            {t(product.archived_at === null ? "productNav.active" : "productNav.archived")}
          </AnimatedBadge>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-xs">{product.slug}</span>
            <span aria-hidden>·</span>
            <span>
              {product.price_minor > 0
                ? format.number(product.price_minor / 10 ** currencyDigits(product.currency), { style: "currency", currency: product.currency })
                : t("productNav.free")}
            </span>
            {product.description && (
              <>
                <span aria-hidden>·</span>
                <span className="line-clamp-1">{product.description}</span>
              </>
            )}
          </span>
        }
        className="mb-4"
      />
      <ProductTabs productId={id} />
      {children}
    </>
  );
}
