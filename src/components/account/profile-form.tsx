"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/motion/button/base";
import { Input } from "@/components/motion/input";
import { USER_NAME_MAX, normalizeUserName } from "@/lib/domain/user-name";

// 使用者自己改顯示名稱，走 Better Auth 的 /api/auth/update-user；伺服器端鉤子再驗證一次。
export function ProfileForm({ name: initialName }: { name: string }) {
  const t = useTranslations("security");
  const common = useTranslations("common");
  const router = useRouter();
  const [saved, setSaved] = useState(initialName);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "invalid" | "rateLimited" | "failed">("idle");
  const normalized = normalizeUserName(name);
  const unchanged = normalized === saved;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (normalized === null) {
      setStatus("invalid");
      return;
    }
    if (unchanged) return;
    setBusy(true);
    setStatus("idle");
    try {
      const response = await fetch("/api/auth/update-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: normalized }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
        setStatus(response.status === 429 ? "rateLimited" : data.message === "INVALID_NAME" ? "invalid" : "failed");
        return;
      }
      setSaved(normalized);
      setName(normalized);
      setStatus("saved");
      // 重新取得伺服器資料，讓側欄和頁首的名稱一起更新。
      router.refresh();
    } catch {
      setStatus("failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        <Input
          label={common("name")}
          value={name}
          onChange={(value) => {
            setName(value);
            if (status !== "idle") setStatus("idle");
          }}
          required
          maxLength={USER_NAME_MAX}
          autoComplete="name"
        />
        <p className="text-sm text-muted-foreground">{t("nameHint")}</p>
        <Button type="submit" className="w-full" disabled={busy || unchanged || normalized === null}>
          {t(busy ? "working" : "saveName")}
        </Button>
      </fieldset>
      {status === "saved" && <p role="status" className="text-sm">{t("nameSaved")}</p>}
      {(status === "invalid" || status === "rateLimited" || status === "failed") && (
        <p role="alert" className="text-sm text-red-600">
          {t(status === "invalid" ? "nameInvalid" : status === "rateLimited" ? "rateLimited" : "nameFailed")}
        </p>
      )}
    </form>
  );
}
