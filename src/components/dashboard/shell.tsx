"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import {
  Bell,
  ChevronsUpDown,
  ClipboardCheck,
  ExternalLink,
  HandCoins,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Package,
  PanelLeft,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  SunMoon,
  TicketPercent,
  Undo2,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import {
  AnimatedSidebar,
  AnimatedSidebarContent,
  AnimatedSidebarFooter,
  AnimatedSidebarGroup,
  AnimatedSidebarGroupContent,
  AnimatedSidebarGroupLabel,
  AnimatedSidebarHeader,
  AnimatedSidebarInset,
  AnimatedSidebarMenu,
  AnimatedSidebarMenuButton,
  AnimatedSidebarMenuItem,
  AnimatedSidebarProvider,
  AnimatedSidebarRail,
  AnimatedSidebarTrigger,
  useAnimatedSidebar,
} from "@/components/motion/animated-sidebar";
import { CommandPalette, type CommandItem } from "@/components/motion/command-palette";
import { MorphPopover, MorphPopoverContent, MorphPopoverTrigger } from "@/components/motion/popover-morph";
import { BrandMark, BrandWordmark } from "@/components/site/brand-logo";
import { ThemeToggle } from "@/components/motion/theme-toggle";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { Tooltip } from "@/components/motion/tooltip";
import { cn } from "@/lib/utils";
import { useIsRtl } from "@/i18n/use-direction";

export interface ShellCounts {
  notifications: number;
  reviews: number;
  revocations: number;
}

interface NavEntry {
  key: string;
  href: string;
  icon: LucideIcon;
  badge?: keyof ShellCounts;
  exact?: boolean;
}

const groups: { key: string | null; items: NavEntry[] }[] = [
  {
    key: "workspace",
    items: [
      { key: "overview", href: "/dashboard", icon: LayoutDashboard, exact: true },
      { key: "products", href: "/dashboard/products", icon: Package },
      { key: "handout", href: "/dashboard/handout", icon: HandCoins },
      { key: "orders", href: "/dashboard/orders", icon: Receipt },
    ],
  },
  {
    key: "distribution",
    items: [{ key: "stripeDiscounts", href: "/dashboard/stripe-discounts", icon: TicketPercent }],
  },
  {
    key: "operations",
    items: [
      { key: "notifications", href: "/dashboard/notifications", icon: Bell, badge: "notifications" },
      { key: "externalReviews", href: "/dashboard/external-reviews", icon: ClipboardCheck, badge: "reviews" },
      { key: "externalRevocations", href: "/dashboard/external-revocations", icon: Undo2, badge: "revocations" },
    ],
  },
  {
    key: "developers",
    items: [
      { key: "tokens", href: "/dashboard/tokens", icon: KeyRound },
      { key: "webhooks", href: "/dashboard/webhooks", icon: Webhook },
    ],
  },
];

// 商品下的活動頁屬於「商品」導覽。
function isActive(pathname: string, item: NavEntry) {
  if (item.exact) return pathname === item.href;
  if (item.key === "products" && pathname.startsWith("/dashboard/campaigns/")) return true;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

async function signOutRequest() {
  const response = await fetch("/api/auth/sign-out", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error("SIGN_OUT_FAILED");
  // 登出後完整重載，清除含明文碼的 React 與路由快取。
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 必須整頁重載，不能用 router.push。
  window.location.assign("/sign-in");
}

function Brand() {
  const common = useTranslations("common");
  const { state, isMobile } = useAnimatedSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  return (
    <Link href="/dashboard" aria-label={common("brand")} className="flex h-9 items-center gap-2.5 rounded-xl px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <BrandMark />
      <BrandWordmark label={common("brand")} className={cn("h-5 transition-opacity", collapsed && "opacity-0")} />
    </Link>
  );
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "A";
}

function UserIdentity({ name, email, initials }: { name: string; email: string; initials: string }) {
  return (
    <>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold" aria-hidden>
        {initials}
      </span>
      <span className="grid min-w-0 flex-1 text-start leading-tight">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{email}</span>
      </span>
    </>
  );
}

const menuItemClass =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

// 側欄底部的帳號選單：點開後是身分、帳號安全、通知、公開網站與登出。
function UserMenu({ name, email }: { name: string; email: string }) {
  const t = useTranslations("shell");
  const { state, isMobile, setOpenMobile } = useAnimatedSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const initials = initialsOf(name);
  const close = () => {
    setOpen(false);
    if (isMobile) setOpenMobile(false);
  };
  return (
    <div className="flex flex-col gap-1">
      <MorphPopover open={open} onOpenChange={setOpen} className="w-full">
        <MorphPopoverTrigger>
          <button
            type="button"
            aria-label={t("accountMenu")}
            aria-haspopup="dialog"
            aria-expanded={open}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl p-1.5 text-start outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
              open && "bg-muted",
              collapsed && "justify-center",
            )}
          >
            {collapsed ? (
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold" aria-hidden>
                {initials}
              </span>
            ) : (
              <>
                <UserIdentity name={name} email={email} initials={initials} />
                <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </>
            )}
          </button>
        </MorphPopoverTrigger>
        <MorphPopoverContent side="top" align="start" sideOffset={6} radius={14} className="w-60 p-1.5">
          <div className="flex items-center gap-2.5 px-1.5 py-1.5">
            <UserIdentity name={name} email={email} initials={initials} />
          </div>
          <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("admin")}</p>
          <div className="my-1 h-px bg-border" role="separator" />
          <Link href="/dashboard/security" onClick={close} className={menuItemClass}>
            <ShieldCheck aria-hidden />
            {t("nav.security")}
          </Link>
          <Link href="/dashboard/notifications" onClick={close} className={menuItemClass}>
            <Bell aria-hidden />
            {t("nav.notifications")}
          </Link>
          <Link href="/" target="_blank" rel="noreferrer" onClick={close} className={menuItemClass}>
            <ExternalLink aria-hidden />
            {t("viewSite")}
          </Link>
          <div className="my-1 h-px bg-border" role="separator" />
          <button
            type="button"
            className={menuItemClass}
            onClick={() => {
              setError(false);
              signOutRequest().catch(() => setError(true));
            }}
          >
            <LogOut aria-hidden />
            {t("signOut")}
          </button>
        </MorphPopoverContent>
      </MorphPopover>
      {error && <p role="alert" className="px-3 text-xs text-destructive">{t("signOutFailed")}</p>}
    </div>
  );
}

function Topbar({ onSearch }: { onSearch: () => void }) {
  const t = useTranslations("shell");
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md md:px-5">
      <AnimatedSidebarTrigger aria-label={t("toggleSidebar")} className="size-9 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
        <PanelLeft className="size-4" aria-hidden />
      </AnimatedSidebarTrigger>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <button
        type="button"
        onClick={onSearch}
        className="flex h-9 w-full max-w-sm items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate text-left">{t("search")}</span>
        <kbd className="hidden rounded border border-border bg-muted px-1.5 font-mono text-[11px] sm:inline">{t("searchShortcut")}</kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <Tooltip content={t("viewSite")}>
          <Link
              href="/"
              target="_blank"
              rel="noreferrer"
              aria-label={t("viewSite")}
              className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
            <ExternalLink className="size-4" aria-hidden />
          </Link>
        </Tooltip>
        <LanguageSwitcher compact className="w-auto sm:w-40" />
        <ThemeToggle aria-label={t("toggleTheme")} title={t("toggleTheme")} className="size-9 rounded-lg" iconClassName="size-4" />
      </div>
    </header>
  );
}

export function DashboardShell({
  user,
  counts,
  children,
}: {
  user: { name: string; email: string };
  counts: ShellCounts;
  children: ReactNode;
}) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const rtl = useIsRtl();

  const commands = useMemo<CommandItem[]>(() => {
    const pages = groups.flatMap((group) =>
      group.items.map((item) => ({
        id: `page:${item.key}`,
        label: t(`nav.${item.key}`),
        group: t("commandGroups.pages"),
        icon: item.icon,
        onSelect: () => router.push(item.href),
      })),
    );
    return [
      ...pages,
      { id: "page:security", label: t("nav.security"), group: t("commandGroups.pages"), icon: ShieldCheck, onSelect: () => router.push("/dashboard/security") },
      { id: "action:handout", label: t("actions.handout"), group: t("commandGroups.actions"), icon: HandCoins, onSelect: () => router.push("/dashboard/handout") },
      { id: "action:new-product", label: t("actions.newProduct"), group: t("commandGroups.actions"), icon: Plus, onSelect: () => router.push("/dashboard/products?new=1") },
      { id: "action:view-site", label: t("actions.viewSite"), group: t("commandGroups.actions"), icon: ExternalLink, onSelect: () => window.open("/", "_blank", "noopener") },
      { id: "action:theme", label: t("actions.toggleTheme"), group: t("commandGroups.actions"), icon: SunMoon, onSelect: () => setTheme(resolvedTheme === "dark" ? "light" : "dark") },
      { id: "action:sign-out", label: t("actions.signOut"), group: t("commandGroups.actions"), icon: LogOut, onSelect: () => void signOutRequest().catch(() => undefined) },
    ];
  }, [resolvedTheme, router, setTheme, t]);

  return (
    <AnimatedSidebarProvider className="dashboard-root bg-background text-foreground">
      <AnimatedSidebar ariaLabel={t("navigation")} collapsible="icon" side={rtl ? "right" : "left"} className={rtl ? "order-first" : undefined}>
        <AnimatedSidebarHeader>
          <Brand />
        </AnimatedSidebarHeader>
        <AnimatedSidebarContent>
          {groups.map((group) => (
            <AnimatedSidebarGroup key={group.key}>
              {group.key && <AnimatedSidebarGroupLabel>{t(`groups.${group.key}`)}</AnimatedSidebarGroupLabel>}
              <AnimatedSidebarGroupContent>
                <AnimatedSidebarMenu>
                  {group.items.map((item) => {
                    const count = item.badge ? counts[item.badge] : 0;
                    const Icon = item.icon;
                    return (
                      <AnimatedSidebarMenuItem key={item.key}>
                        <AnimatedSidebarMenuButton
                          href={item.href}
                          isActive={isActive(pathname, item)}
                          icon={<Icon className="size-4" />}
                          badge={
                            count > 0 ? (
                              <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold tabular-nums text-primary-foreground">
                                {count > 99 ? "99+" : count}
                              </span>
                            ) : undefined
                          }
                        >
                          {t(`nav.${item.key}`)}
                        </AnimatedSidebarMenuButton>
                      </AnimatedSidebarMenuItem>
                    );
                  })}
                </AnimatedSidebarMenu>
              </AnimatedSidebarGroupContent>
            </AnimatedSidebarGroup>
          ))}
        </AnimatedSidebarContent>
        <AnimatedSidebarFooter>
          <UserMenu name={user.name} email={user.email} />
        </AnimatedSidebarFooter>
        <AnimatedSidebarRail />
      </AnimatedSidebar>
      <AnimatedSidebarInset>
        <Topbar onSearch={() => setPaletteOpen(true)} />
        <div className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 pt-6 md:px-8 md:pt-8">{children}</div>
      </AnimatedSidebarInset>
      <CommandPalette
        items={commands}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        placeholder={t("commandPlaceholder")}
        emptyMessage={t("commandEmpty")}
      />
    </AnimatedSidebarProvider>
  );
}
