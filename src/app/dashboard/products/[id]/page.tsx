import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Ban, Boxes, PackageCheck, Send } from "lucide-react";
import { runtime } from "@/lib/server/env";
import { createAuth, isAdmin } from "@/lib/server/auth";
import { CodeManager } from "@/components/inventory/code-manager";
import { StatCard } from "@/components/dashboard/overview";
import { Card, CardContent } from "@/components/motion/card";

export const dynamic = "force-dynamic";

export default async function Product({ params }: { params: Promise<{ id: string }> }) {
  const { env, settings } = await runtime();
  const session = await createAuth(env, settings).api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (!(await isAdmin(env.DB, session.user.id))) redirect("/");
  const { id } = await params;
  const product = await env.DB.prepare("SELECT archived_at FROM products WHERE id=?").bind(id).first<{ archived_at: number | null }>();
  if (!product) notFound();
  const t = await getTranslations("productNav");
  const { results } = await env.DB.prepare("SELECT status,count(*) AS n FROM codes WHERE product_id=? GROUP BY status").bind(id).all<{ status: string; n: number }>();
  const count = (status: string) => results.find((row) => row.status === status)?.n ?? 0;
  const total = results.reduce((sum, row) => sum + row.n, 0);
  return (
    <>
      <section className="mb-6 grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4" aria-label={t("codes")}>
        <StatCard label={t("statsTotal")} value={total} icon={<Boxes />} />
        <StatCard label={t("statsAvailable")} value={count("available")} icon={<PackageCheck />} />
        <StatCard label={t("statsAssigned")} value={count("assigned")} icon={<Send />} />
        <StatCard label={t("statsRevoked")} value={count("revoked")} icon={<Ban />} />
      </section>
      <Card>
        <CardContent>
          <CodeManager productId={id} archived={product.archived_at !== null} />
        </CardContent>
      </Card>
    </>
  );
}
