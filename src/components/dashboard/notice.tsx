"use client";

import type { ReactNode } from "react";
import { Alert, AlertContent, AlertDescription, AlertIcon, AlertTitle, type AlertVariant } from "@/components/motion/alert";
import { cn } from "@/lib/utils";

// 表單與頁面的提示訊息，統一用 beUI Alert。錯誤用 role=alert，其餘用 role=status。
export function Notice({
  variant = "default",
  title,
  children,
  role,
  className,
}: {
  variant?: AlertVariant;
  title?: ReactNode;
  children?: ReactNode;
  role?: "alert" | "status";
  className?: string;
}) {
  return (
    <Alert variant={variant} role={role ?? (variant === "destructive" ? "alert" : "status")} className={cn("border border-current/10", className)}>
      <AlertIcon />
      <AlertContent>
        {title && <AlertTitle>{title}</AlertTitle>}
        {children && <AlertDescription className={title ? undefined : "text-current"}>{children}</AlertDescription>}
      </AlertContent>
    </Alert>
  );
}
