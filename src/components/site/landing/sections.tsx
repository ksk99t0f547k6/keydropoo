import type { ReactNode } from "react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowUpRight, Check, CreditCard, FileSpreadsheet, KeyRound, Send, ShieldCheck, Sparkles, TicketCheck, Webhook } from "lucide-react";
import { BrandMark } from "@/components/site/brand-logo";
import { cn } from "@/lib/utils";
import { HeroVisual } from "./hero-visual";
import { GitHubMark } from "@/components/site/github-mark";
import { publicSite } from "@/config/site";

// 落地頁區塊。文案都在 messages/<語言>.json 的 home；要換首頁時改這個檔案或 src/app/page.tsx。

const container = "mx-auto w-full max-w-[1200px] px-6 md:px-9";

// 「開源」徽章；有設定倉庫網址時直接連到 GitHub。
function OpenSourceBadge({ label }: { label: string }) {
  const style = "inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1.5 text-xs font-medium backdrop-blur";
  const content = (
    <>
      <span className="relative flex size-2">
        <span className="kd-ping absolute inline-flex size-full rounded-full bg-[var(--brand-accent)] opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-[var(--brand-accent)]" />
      </span>
      {label}
    </>
  );
  if (!publicSite.repositoryUrl) return <span className={style}>{content}</span>;
  return (
    <a href={publicSite.repositoryUrl} target="_blank" rel="noopener" className={cn(style, "transition-colors hover:border-foreground/30")}>
      {content}
      <GitHubMark className="size-3.5 opacity-70" />
    </a>
  );
}

export async function HeroSection({ featuresHref }: { featuresHref: string }) {
  const t = await getTranslations("home");
  return (
    <section className="relative isolate overflow-hidden">
      {/* 背景：點陣格線＋緩慢移動的光暈 */}
      <div className="kd-grid pointer-events-none absolute inset-0 -z-10" aria-hidden />
      <div className="kd-aurora pointer-events-none absolute -top-40 start-1/2 -z-10 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,90,78,0.28),transparent)] blur-2xl rtl:translate-x-1/2" aria-hidden />
      <div className="kd-aurora-slow pointer-events-none absolute -end-40 top-40 -z-10 h-[420px] w-[620px] rounded-full bg-[radial-gradient(closest-side,rgba(124,108,255,0.22),transparent)] blur-2xl" aria-hidden />
      <div className={cn(container, "grid items-center gap-14 pb-20 pt-16 md:pb-28 md:pt-24 lg:grid-cols-[1.1fr_0.9fr]")}>
        <div className="kd-rise">
          <OpenSourceBadge label={t("badge")} />
          <h1 className="mt-7 max-w-[13ch] text-balance text-[clamp(44px,7.2vw,88px)] font-semibold leading-[0.98] tracking-[-0.045em]">
            {t.rich("title", {
              accent: (chunks) => <span className="kd-gradient-text">{chunks}</span>,
            })}
          </h1>
          <p className="mt-7 max-w-[34rem] text-pretty text-lg leading-relaxed text-muted-foreground">{t("description")}</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="group inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-6 text-sm font-medium text-background! shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)] transition-transform hover:-translate-y-0.5"
            >
              {t("cta")}
              <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 rtl:-scale-x-100" aria-hidden />
            </Link>
            <Link href={featuresHref} className="inline-flex h-12 items-center rounded-full border border-border bg-background/60 px-6 text-sm font-medium backdrop-blur transition-colors hover:bg-muted">
              {t("secondaryCta")}
            </Link>
          </div>
          <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t("eyebrow")}</p>
        </div>
        <div className="kd-rise-delay">
          <HeroVisual />
        </div>
      </div>
    </section>
  );
}

const TOOLS = ["Stripe Checkout", "Cloudflare Workers", "Cloudflare D1", "App Store offer codes", "CSV · Excel", "Webhooks", "MCP", "REST API", "Email OTP", "Better Auth"];

export async function LogosSection() {
  const t = await getTranslations("home");
  return (
    <section className="border-y border-border bg-muted/30 py-8">
      <div className={container}>
        <p className="text-center text-sm text-muted-foreground">{t("logosTitle")}</p>
      </div>
      <div className="kd-marquee-mask mt-6 overflow-hidden" aria-label={t("logosTitle")}>
        <ul className="kd-marquee flex w-max gap-3">
          {[...TOOLS, ...TOOLS].map((tool, index) => (
            <li
              key={`${tool}-${index}`}
              aria-hidden={index >= TOOLS.length || undefined}
              className="whitespace-nowrap rounded-full border border-border bg-background px-4 py-2 font-mono text-xs text-foreground/80"
            >
              {tool}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function BentoCard({ title, body, icon, className, children }: { title: string; body: string; icon: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card p-6 transition-colors hover:border-foreground/20 md:p-7",
        className,
      )}
    >
      <div className="pointer-events-none absolute -end-24 -top-24 size-56 rounded-full bg-[var(--brand-accent)]/0 blur-3xl transition-colors duration-500 group-hover:bg-[var(--brand-accent)]/15" aria-hidden />
      <span className="grid size-10 place-items-center rounded-xl border border-border bg-muted/60 text-foreground [&_svg]:size-[18px]" aria-hidden>
        {icon}
      </span>
      <h3 className="mt-5 text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      {children && <div className="mt-6 flex-1" aria-hidden>{children}</div>}
    </article>
  );
}

export async function FeaturesSection() {
  const [t, format] = await Promise.all([getTranslations("home"), getFormatter()]);
  const rows = [
    { key: "launch", total: 500, used: 312, color: "bg-[var(--brand-accent)]" },
    { key: "partners", total: 120, used: 48, color: "bg-[#7c6cff]" },
    { key: "licenses", total: 80, used: 61, color: "bg-emerald-500" },
  ] as const;
  return (
    <section className="py-24 md:py-32">
      <div className={container}>
        <div className="max-w-2xl">
          <h2 className=" text-balance text-[clamp(32px,4.4vw,52px)] font-semibold leading-[1.05] tracking-[-0.035em]">{t("featuresTitle")}</h2>
          <p className="mt-5 text-pretty text-lg text-muted-foreground">{t("featuresBody")}</p>
        </div>
        <div className="mt-14 grid gap-4 md:grid-cols-6">
          <BentoCard className="md:col-span-4" title={t("bento.inventory.title")} body={t("bento.inventory.body")} icon={<FileSpreadsheet />}>
            <ul className="space-y-3 rounded-2xl border border-border bg-background/60 p-4">
              {rows.map((row) => (
                <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 text-sm">
                  <span className="truncate font-medium">{t(`demo.${row.key}`)}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {format.number(row.used)} / {format.number(row.total)}
                  </span>
                  <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <span className={cn("kd-bar block h-full rounded-full", row.color)} style={{ width: `${Math.round((row.used / row.total) * 100)}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          </BentoCard>
          <BentoCard className="md:col-span-2" title={t("bento.campaigns.title")} body={t("bento.campaigns.body")} icon={<TicketCheck />}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-border bg-background px-3 py-1.5">{t("demo.verified")}</span>
              <span className="font-mono text-[10px] font-semibold text-[var(--brand-accent)]">{t("demo.and")}</span>
              <span className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-border p-1.5">
                <span className="rounded-full bg-muted px-3 py-1">{t("demo.invite")}</span>
                <span className="font-mono text-[10px] font-semibold text-muted-foreground">{t("demo.or")}</span>
                <span className="rounded-full bg-muted px-3 py-1">{t("demo.passphrase")}</span>
              </span>
            </div>
          </BentoCard>
          <BentoCard className="md:col-span-2" title={t("bento.checkout.title")} body={t("bento.checkout.body")} icon={<CreditCard />}>
            <ol className="space-y-2.5 text-sm">
              {(["paid", "reserved", "delivered"] as const).map((step, index) => (
                <li key={step} className="flex items-center gap-3">
                  <span className={cn("grid size-6 place-items-center rounded-full text-white", index === 2 ? "bg-emerald-500" : "bg-foreground/80")}>
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                  <span>{t(`demo.${step}`)}</span>
                  {index === 0 && <span className="ms-auto font-mono text-xs tabular-nums text-muted-foreground">{format.number(9, { style: "currency", currency: "USD" })}</span>}
                </li>
              ))}
            </ol>
          </BentoCard>
          <BentoCard className="md:col-span-2" title={t("bento.rewards.title")} body={t("bento.rewards.body")} icon={<Sparkles />}>
            <div className="space-y-3 rounded-2xl border border-border bg-background/60 p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{t("demo.plan")}</span>
                <span className="relative flex size-2.5"><span className="kd-ping absolute inline-flex size-full rounded-full bg-emerald-500 opacity-60" /><span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" /></span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <span className="kd-bar block h-full w-[68%] rounded-full bg-gradient-to-r from-[#ff5a4e] to-[#7c6cff]" />
              </div>
              <div className="flex justify-between font-mono text-xs tabular-nums text-muted-foreground">
                <span>{t("demo.credits", { count: format.number(1200) })}</span>
                <span>{t("demo.devices", { used: format.number(2), total: format.number(3) })}</span>
              </div>
            </div>
          </BentoCard>
          <BentoCard className="md:col-span-2" title={t("bento.own.title")} body={t("bento.own.body")} icon={<ShieldCheck />}>
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/60 p-4">
              <BrandMark className="size-10" />
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium">{t("demo.deploy")}</p>
                <p className="font-mono text-xs text-muted-foreground">{t("demo.license")}</p>
              </div>
            </div>
          </BentoCard>
          <BentoCard className="md:col-span-6 lg:col-span-6" title={t("bento.api.title")} body={t("bento.api.body")} icon={<Webhook />}>
            <div className="grid gap-4 lg:grid-cols-2" dir="ltr">
              <pre className="overflow-x-auto rounded-2xl bg-[#1e2230] p-5 font-mono text-[12.5px] leading-relaxed text-[#e9e8e3]">
                <code>
                  <span className="text-[#ff8a7a]">curl</span> -X POST https://your-site/api/v1/operations {"\\\n"}
                  {"  "}-H <span className="text-[#a5d6a7]">&quot;Authorization: Bearer kd_…&quot;</span> {"\\\n"}
                  {"  "}-d <span className="text-[#a5d6a7]">&apos;{"{"}&quot;action&quot;:&quot;licenses.activate&quot;,{"\n"}
                  {"       "}&quot;code&quot;:&quot;PRO1-M4ZT-6HQV&quot;,&quot;deviceId&quot;:&quot;mac-01&quot;, …{"}"}&apos;</span>
                </code>
              </pre>
              <div className="flex flex-col justify-center gap-2.5 rounded-2xl border border-border bg-background/60 p-5 font-mono text-xs">
                {[
                  { icon: <KeyRound className="size-3.5" />, text: "code.claimed" },
                  { icon: <Send className="size-3.5" />, text: "order.delivered" },
                  { icon: <Webhook className="size-3.5" />, text: "code.redeemed" },
                ].map((event) => (
                  <div key={event.text} className="flex items-center gap-2.5">
                    <span className="grid size-6 place-items-center rounded-md bg-muted">{event.icon}</span>
                    <span>{event.text}</span>
                    <span className="ms-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">200</span>
                  </div>
                ))}
              </div>
            </div>
          </BentoCard>
        </div>
      </div>
    </section>
  );
}

export async function StepsSection() {
  const t = await getTranslations("home");
  const steps = ["import", "share", "track"] as const;
  return (
    <section className="border-t border-border py-24 md:py-32">
      <div className={container}>
        <h2 className="max-w-2xl text-balance text-[clamp(32px,4.4vw,52px)] font-semibold leading-[1.05] tracking-[-0.035em]">{t("stepsTitle")}</h2>
        <ol className="relative mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          <span className="absolute inset-x-[16%] top-6 hidden border-t border-dashed border-border md:block" aria-hidden />
          {steps.map((step, index) => (
            <li key={step} className="relative">
              <span className="relative grid size-12 place-items-center rounded-2xl border border-border bg-background font-mono text-sm font-semibold shadow-sm">
                0{index + 1}
              </span>
              <h3 className="mt-6 text-xl font-semibold tracking-tight">{t(`steps.${step}.title`)}</h3>
              <p className="mt-3 max-w-sm leading-relaxed text-muted-foreground">{t(`steps.${step}.body`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export async function FactsSection() {
  const t = await getTranslations("home");
  const facts = ["kinds", "languages", "deploy", "fees"] as const;
  return (
    <section className="border-y border-border bg-muted/30">
      <dl className={cn(container, "grid grid-cols-2 lg:grid-cols-4")}>
        {facts.map((fact, index) => (
          <div key={fact} className={cn("flex flex-col-reverse gap-2 py-10 md:py-14", index % 2 === 1 && "border-s border-border ps-6 md:ps-9", index >= 2 && "border-t border-border lg:border-t-0", index === 2 && "lg:border-s lg:ps-9")}>
            <dt className="text-sm text-muted-foreground">{t(`facts.${fact}.label`)}</dt>
            <dd className="kd-gradient-text text-[clamp(36px,5vw,56px)] font-semibold leading-none tracking-[-0.04em]">{t(`facts.${fact}.value`)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export async function StartSection({ featuresHref }: { featuresHref: string }) {
  const [t, home] = await Promise.all([getTranslations("publicSite"), getTranslations("home")]);
  return (
    <section className="py-24 md:py-32">
      <div className={container}>
        <div className="relative isolate overflow-hidden rounded-[2rem] bg-[#1e2230] px-8 py-16 text-[#f4f3ef] md:px-16 md:py-24">
          <div className="kd-aurora pointer-events-none absolute -top-32 end-[-10%] -z-10 size-[460px] rounded-full bg-[#ff5a4e]/35 blur-3xl" aria-hidden />
          <div className="kd-aurora-slow pointer-events-none absolute -bottom-40 start-[-10%] -z-10 size-[460px] rounded-full bg-[#7c6cff]/30 blur-3xl" aria-hidden />
          <div className="kd-grid-dark pointer-events-none absolute inset-0 -z-10 opacity-60" aria-hidden />
          <BrandMark className="size-12 [--primary:#f4f3ef] [--primary-foreground:#1e2230] [--brand-accent-on-primary:#d9443b]" />
          <h2 className="mt-8 max-w-3xl text-balance text-[clamp(34px,5vw,64px)] font-semibold leading-[1.02] tracking-[-0.04em]">{t("startTitle")}</h2>
          <p className="mt-5 max-w-xl text-pretty text-lg text-white/70">{t("startBody")}</p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/dashboard" className="inline-flex h-12 items-center gap-2 rounded-full bg-[#f4f3ef] px-6 text-sm font-medium text-[#1e2230]! transition-transform hover:-translate-y-0.5">
              {home("cta")}
              <ArrowUpRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
            <Link href={featuresHref} className="inline-flex h-12 items-center rounded-full border border-white/20 px-6 text-sm font-medium text-white! transition-colors hover:bg-white/10">
              {t("explore")}
            </Link>
            {publicSite.repositoryUrl && (
              <a href={publicSite.repositoryUrl} target="_blank" rel="noopener" className="inline-flex h-12 items-center gap-2 rounded-full px-5 text-sm font-medium text-white/80! transition-colors hover:text-white!">
                <GitHubMark className="size-4" />
                {home("github")}
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
