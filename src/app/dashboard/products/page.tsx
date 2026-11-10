import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ChevronRight, Package } from "lucide-react";
import { runtime } from "@/lib/server/env";
import { createAuth, isAdmin } from "@/lib/server/auth";
import { listProducts } from "@/lib/server/inventory";
import { currencyDigits } from "@/lib/domain/money";
import { ProductFilter } from "@/components/products/product-filter";
import { PageHeader } from "@/components/dashboard/page-header";
import { PagePagination } from "@/components/dashboard/page-pagination";
import { CreateProductButton } from "@/components/dashboard/create-product";
import { Card } from "@/components/motion/card";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { ProductIcon } from "@/components/products/product-icon";
import { productIconUrl } from "@/lib/domain/product-icon";

export const dynamic = "force-dynamic";

export default async function Products({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { env, settings } = await runtime();
  const session = await createAuth(env, settings).api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (!(await isAdmin(env.DB, session.user.id))) redirect("/");
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const params = await searchParams;
  const page = typeof params.page === "string" && /^\d+$/.test(params.page) ? Math.min(100000, Math.max(1, Number(params.page))) : 1;
  const state = params.state === "archived" ? "archived" : "active";
  const query = typeof params.query === "string" ? params.query.slice(0, 120) : "";
  const { products: results, total, pageSize } = await listProducts(env.DB, { page, state, query });

  return (
    <>
      <PageHeader
        title={t("products.title")}
        description={t("products.description")}
        crumbs={[{ label: t("products.title") }]}
        actions={<CreateProductButton />}
      />
      <Card size="compact" className="gap-0 py-0">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-4 pt-4">
          <ProductFilter query={query} state={state} />
          <p className="mb-6 text-sm text-muted-foreground">{t("products.total", { count: total })}</p>
        </div>
        {results.length ? (
          <ul className="divide-y divide-border">
            <li className="hidden grid-cols-[minmax(0,1fr)_140px_120px_120px_24px] gap-4 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid" aria-hidden>
              <span>{t("productsPage.columns.name")}</span>
              <span>{t("products.price")}</span>
              <span>{t("productsPage.columns.codes")}</span>
              <span>{t("productsPage.columns.status")}</span>
              <span />
            </li>
            {results.map((product) => (
              <li key={product.id}>
                <Link
                  href={`/dashboard/products/${product.id}`}
                  className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 transition-colors hover:bg-muted/50 md:grid-cols-[minmax(0,1fr)_140px_120px_120px_24px]"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <ProductIcon url={productIconUrl(product.id, product.icon_version)} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{product.name}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{product.slug}</span>
                    </span>
                  </span>
                  <span className="hidden text-sm tabular-nums md:block">
                    {product.price_minor > 0
                      ? format.number(product.price_minor / 10 ** currencyDigits(product.currency), { style: "currency", currency: product.currency })
                      : "—"}
                  </span>
                  <span className="hidden text-sm tabular-nums md:block">{format.number(product.code_count ?? 0)}</span>
                  <span className="hidden md:block">
                    <AnimatedBadge size="sm" status={product.archived_at === null ? "success" : "neutral"} showIcon={false}>
                      {t(product.archived_at === null ? "productNav.active" : "productNav.archived")}
                    </AnimatedBadge>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-label={t("productsPage.open")} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden>
              <Package className="size-5" />
            </span>
            <p className="text-sm font-medium">{t("products.empty")}</p>
          </div>
        )}
      </Card>
      <PagePagination page={page} totalPages={Math.ceil(total / pageSize)} />
    </>
  );
}
