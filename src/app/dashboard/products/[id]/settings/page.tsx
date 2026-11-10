import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { runtime } from "@/lib/server/env";
import { createAuth, isAdmin } from "@/lib/server/auth";
import { listBatches, type ProductRow } from "@/lib/server/inventory";
import { ProductForm, ArchiveProduct } from "@/components/products/product-form";
import { ProductIconField } from "@/components/products/product-icon-field";
import { SalesSettings } from "@/components/checkout/sales-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/motion/card";

export const dynamic = "force-dynamic";

export default async function ProductSettings({ params }: { params: Promise<{ id: string }> }) {
  const { env, settings } = await runtime();
  const session = await createAuth(env, settings).api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (!(await isAdmin(env.DB, session.user.id))) redirect("/");
  const { id } = await params;
  const product = await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(id).first<ProductRow>();
  if (!product) notFound();
  const [t, batches] = await Promise.all([getTranslations(), listBatches(env.DB, id)]);
  const archived = product.archived_at !== null;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("productNav.productSettings")}</CardTitle>
          <CardDescription>{t("productNav.settingsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <ProductIconField productId={id} version={product.icon_version ?? null} />
          <ProductForm product={product} />
        </CardContent>
      </Card>
      <div className="flex flex-col gap-6">
        <Card>
          <CardContent>
            <SalesSettings
              productId={id}
              slug={product.slug}
              batchId={product.checkout_batch_id}
              stripeProductId={product.stripe_product_id}
              allowPromotionCodes={!!product.allow_promotion_codes}
              batches={batches}
              hasPrice={product.price_minor > 0}
              stripeConfigured={!!env.STRIPE_SECRET_KEY && !!env.STRIPE_WEBHOOK_SECRET}
            />
          </CardContent>
        </Card>
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle as="h2">{t("productNav.dangerZone")}</CardTitle>
            <CardDescription>{archived ? t("products.archivedHint") : t("productNav.dangerDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ArchiveProduct id={id} archived={archived} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
