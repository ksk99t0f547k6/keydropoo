"use client";

import { Fragment, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/motion/breadcrumb";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  href?: string;
}

// 控制台每頁共用的頁首：麵包屑、標題、說明與右側操作。
export function PageHeader({
  title,
  description,
  crumbs = [],
  actions,
  meta,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  const t = useTranslations("shell");
  const trail: Crumb[] = [{ label: t("home"), href: "/dashboard" }, ...crumbs];
  return (
    <div className={cn("mb-8 flex flex-col gap-4", className)}>
      {crumbs.length > 0 && (
        <Breadcrumb>
          <BreadcrumbList maxItems={5}>
            {trail.map((crumb, index) => (
              <Fragment key={`${crumb.label}:${index}`}>
                {index > 0 && <BreadcrumbSeparator className="rtl:rotate-180" />}
                <BreadcrumbItem>
                  {crumb.href && index < trail.length - 1 ? (
                    <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="dashboard-title">{title}</h1>
            {meta}
          </div>
          {description && <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

// 區塊標題（卡片外的小節）。
export function SectionTitle({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
