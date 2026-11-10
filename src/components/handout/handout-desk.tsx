"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Check, Copy, Hand, Search, Share2, Undo2, X } from "lucide-react";
import { Button } from "@/components/motion/button/base";
import { StatefulButton, type ButtonState } from "@/components/motion/button/stateful";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/motion/card";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { AnimatedToastStack, useAnimatedToastStack } from "@/components/motion/animated-toast-stack";
import { Drawer } from "@/components/motion/drawer";
import { Input } from "@/components/motion/input";
import { Switch } from "@/components/motion/switch";
import { Choice } from "@/components/inventory/choice";
import { Notice } from "@/components/dashboard/notice";
import { cn } from "@/lib/utils";
import type { Handout } from "@/lib/server/handouts";
import { ShareImageDialog } from "./share-image-dialog";
import { ProductIcon } from "@/components/products/product-icon";
import { useIsRtl } from "@/i18n/use-direction";

export interface HandoutSource {
  id: string;
  name: string;
  batches: { id: string; name: string; kind: string; available: number }[];
}

const CHANNELS = ["WeChat", "LINE", "X", "Email", "Telegram", "In person"] as const;
const STORAGE_KEY = "keydrop-handout-source";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "FAILED");
  return data;
}

// 一鍵複製並短暫顯示「已複製」。
function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1600);
  }, []);
  return { copied, copy };
}

function RecipientForm({ handout, onSaved, onUndone, compact = false }: { handout: Handout; onSaved: (next: Handout) => void; onUndone: (next: Handout) => void; compact?: boolean }) {
  const t = useTranslations("handout");
  const [recipient, setRecipient] = useState(handout.recipient ?? "");
  const [channel, setChannel] = useState(handout.channel ?? "");
  const [note, setNote] = useState(handout.note ?? "");
  const [state, setState] = useState<ButtonState>("idle");
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [undoBusy, setUndoBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("loading");
    try {
      const next = await api<Handout>(`/api/handouts/${handout.id}`, { method: "PATCH", body: JSON.stringify({ recipient, channel, note }) });
      setState("success");
      onSaved(next);
      window.setTimeout(() => setState("idle"), 1400);
    } catch {
      setState("error");
    }
  }

  async function undo() {
    if (!confirmUndo) {
      setConfirmUndo(true);
      window.setTimeout(() => setConfirmUndo(false), 4000);
      return;
    }
    setUndoBusy(true);
    try {
      onUndone(await api<Handout>(`/api/handouts/${handout.id}`, { method: "DELETE" }));
    } catch {
      setState("error");
    } finally {
      setUndoBusy(false);
      setConfirmUndo(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Input label={t("recipient")} value={recipient} onChange={setRecipient} maxLength={200} autoComplete="off" enterKeyHint="done" />
        {!compact && <p className="px-1 text-xs text-muted-foreground">{t("recipientHint")}</p>}
      </div>
      <fieldset className="space-y-2">
        <legend className="px-1 text-sm font-medium">{t("channel")}</legend>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={channel === item}
              onClick={() => setChannel(channel === item ? "" : item)}
              className={cn(
                "h-9 rounded-full border px-3.5 text-sm transition-colors",
                channel === item ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
              )}
            >
              {t(`channels.${item}`)}
            </button>
          ))}
        </div>
      </fieldset>
      <Input label={t("note")} value={note} onChange={setNote} maxLength={1000} autoComplete="off" />
      <div className="flex flex-wrap items-center gap-2">
        <StatefulButton type="submit" state={state} loadingText={t("saving")} successText={t("saved")} errorText={t("failed")}>
          {t("save")}
        </StatefulButton>
        <Button type="button" variant="ghost" disabled={undoBusy} onClick={() => void undo()} className={cn(confirmUndo && "text-destructive")}>
          <Undo2 className="size-4" aria-hidden />
          {t(confirmUndo ? "undoConfirm" : "undo")}
        </Button>
      </div>
    </form>
  );
}

function CodeDisplay({ handout, brand, onToast }: { handout: Handout; brand: string; onToast: (title: string) => void }) {
  const t = useTranslations("handout");
  const format = useFormatter();
  const { copied, copy } = useCopy();
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 只在瀏覽器判斷是否支援系統分享。
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => void copy(handout.id, handout.code).then(() => onToast(t("copied")))}
        className="group relative w-full rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center transition-colors hover:bg-muted"
        aria-label={`${t("copy")}: ${handout.code}`}
      >
        <span className="block break-all font-mono text-2xl font-semibold tracking-wide sm:text-3xl">{handout.code}</span>
        <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {copied === handout.id ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {t(copied === handout.id ? "copied" : "copy")}
        </span>
      </button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-2">
          <ProductIcon url={handout.productIcon} className="size-6 rounded-md" />
          <span className="truncate">
            {handout.productName} · {handout.batchName}
          </span>
        </span>
        {handout.expiresAt && <span>{t("expires", { date: format.dateTime(handout.expiresAt, { dateStyle: "medium" }) })}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button variant="secondary" size="sm" onClick={() => void copy(handout.id, handout.code).then(() => onToast(t("copied")))}>
          <Copy className="size-3.5" aria-hidden />
          {t("copy")}
        </Button>
        {canShare && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void navigator.share({ title: t("shareTitle", { product: handout.productName }), text: handout.code }).catch(() => undefined)}
          >
            <Share2 className="size-3.5" aria-hidden />
            {t("share")}
          </Button>
        )}
        <div className={cn(!canShare && "col-span-1", canShare && "col-span-2 sm:col-span-1")}>
          <ShareImageDialog subject={{ code: handout.code, productName: handout.productName, productIcon: handout.productIcon, expiresAt: handout.expiresAt }} brand={brand} onDone={onToast} />
        </div>
      </div>
    </div>
  );
}

export function HandoutDesk({ sources, initial, brand, ready }: { sources: HandoutSource[]; initial: { items: Handout[]; hasMore: boolean }; brand: string; ready: boolean }) {
  const rtl = useIsRtl();
  const t = useTranslations("handout");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60000 });
  const router = useRouter();
  const toast = useAnimatedToastStack({ limit: 3, defaultDuration: 2200 });
  const [productId, setProductId] = useState(sources[0]?.id ?? "");
  const [batchId, setBatchId] = useState("any");
  const [current, setCurrent] = useState<Handout | null>(null);
  const [takeState, setTakeState] = useState<ButtonState>("idle");
  const [error, setError] = useState("");
  const pendingKey = useRef<string | null>(null);
  const currentRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState(initial.items);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [editing, setEditing] = useState<Handout | null>(null);
  const { copied, copy } = useCopy();
  const showToast = useCallback((title: string) => toast.showToast({ title, status: "success" }), [toast]);

  // 記住上次選的商品與批次（只存在這台裝置）。
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { productId?: string; batchId?: string } | null;
      const product = sources.find((item) => item.id === saved?.productId);
      if (product) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 掛載後才能讀瀏覽器儲存。
        setProductId(product.id);
        if (saved?.batchId && product.batches.some((batch) => batch.id === saved.batchId)) setBatchId(saved.batchId);
      }
    } catch {
      /* 私密模式或停用儲存時用預設值。 */
    }
  }, [sources]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ productId, batchId }));
    } catch {
      /* 忽略 */
    }
  }, [productId, batchId]);

  const product = sources.find((item) => item.id === productId);
  const batches = product?.batches ?? [];
  const available = batchId === "any" ? batches.reduce((sum, batch) => sum + batch.available, 0) : batches.find((batch) => batch.id === batchId)?.available ?? 0;

  const refresh = useCallback(
    async (nextPage = 1, nextQuery = query, nextMissing = missingOnly) => {
      const params = new URLSearchParams({ page: String(nextPage) });
      if (nextQuery.trim()) params.set("query", nextQuery.trim());
      if (nextMissing) params.set("missingRecipient", "true");
      const data = await api<{ items: Handout[]; hasMore: boolean }>(`/api/handouts?${params}`, { method: "GET" });
      setItems((existing) => (nextPage === 1 ? data.items : [...existing, ...data.items]));
      setHasMore(data.hasMore);
      setPage(nextPage);
    },
    [missingOnly, query],
  );

  async function take() {
    if (!productId) return;
    setError("");
    setTakeState("loading");
    // 失敗重試沿用同一個冪等鍵，不會多佔一個碼。
    pendingKey.current ??= crypto.randomUUID();
    try {
      const handout = await api<Handout>("/api/handouts", {
        method: "POST",
        body: JSON.stringify({ productId, batchId: batchId === "any" ? null : batchId, idempotencyKey: pendingKey.current }),
      });
      pendingKey.current = null;
      setCurrent(handout);
      // 手機上新碼出現在取碼按鈕下方，捲過去讓它進入視線。
      window.requestAnimationFrame(() => currentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      setItems((existing) => [handout, ...existing.filter((item) => item.id !== handout.id)]);
      setTakeState("success");
      window.setTimeout(() => setTakeState("idle"), 1200);
      router.refresh();
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      if (code === "HANDOUT_UNAVAILABLE") pendingKey.current = null;
      setError(t(code === "HANDOUT_UNAVAILABLE" ? "soldOut" : "failed"));
      setTakeState("error");
      window.setTimeout(() => setTakeState("idle"), 1600);
    }
  }

  function replace(next: Handout) {
    setItems((existing) => (next.undoneAt ? existing.filter((item) => item.id !== next.id) : existing.map((item) => (item.id === next.id ? next : item))));
    setCurrent((value) => (value?.id === next.id ? (next.undoneAt ? null : next) : value));
    setEditing((value) => (value?.id === next.id ? (next.undoneAt ? null : next) : value));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
      <div className="space-y-4 lg:sticky lg:top-20">
        {!ready && <Notice variant="warning">{t("encryptionMissing")}</Notice>}
        {sources.length === 0 ? (
          <Notice variant="info">{t("noSources")}</Notice>
        ) : (
          <Card>
            <CardContent className="space-y-4">
              <div className="grid gap-3 min-[420px]:grid-cols-2">
                <Choice
                  label={t("product")}
                  value={productId}
                  onChange={(value) => {
                    setProductId(value);
                    setBatchId("any");
                    pendingKey.current = null;
                  }}
                  options={sources.map((item) => ({ value: item.id, label: item.name }))}
                />
                <Choice
                  label={t("batch")}
                  value={batchId}
                  onChange={(value) => {
                    setBatchId(value);
                    pendingKey.current = null;
                  }}
                  options={[{ value: "any", label: t("anyBatch") }, ...batches.map((batch) => ({ value: batch.id, label: `${batch.name} (${batch.available})` }))]}
                />
              </div>
              <StatefulButton
                className="h-14 w-full text-base"
                size="lg"
                state={takeState}
                disabled={!ready || available === 0}
                loadingText={t("taking")}
                successText={t("taken")}
                errorText={t("failed")}
                icon={<Hand className="size-5" aria-hidden />}
                onClick={() => void take()}
              >
                {t("take")}
              </StatefulButton>
              <p className="text-center text-xs text-muted-foreground">
                <AnimatedBadge size="sm" status={available > 0 ? "neutral" : "warning"} showIcon={false} className="mr-2 align-middle">
                  {t("left", { count: available })}
                </AnimatedBadge>
                {t("takeHint")}
              </p>
              {error && <Notice variant="destructive">{error}</Notice>}
            </CardContent>
          </Card>
        )}
        {current && (
          <div ref={currentRef} className="scroll-mt-20">
          <Card>
            <CardHeader>
              <CardTitle as="h2">{t("current")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <CodeDisplay handout={current} brand={brand} onToast={showToast} />
              <div className="border-t border-border pt-5">
                <RecipientForm
                  key={current.id}
                  handout={current}
                  onSaved={(next) => {
                    replace(next);
                    showToast(t("saved"));
                  }}
                  onUndone={(next) => {
                    replace(next);
                    showToast(t("undone"));
                    router.refresh();
                  }}
                />
              </div>
              <Button variant="secondary" className="w-full" onClick={() => void take()} disabled={!ready || available === 0}>
                {t("next")}
              </Button>
            </CardContent>
          </Card>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("history")}</CardTitle>
          <CardDescription>{t("historyDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            role="search"
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void refresh(1);
            }}
          >
            <div className="min-w-0 flex-1">
              <Input label={t("search")} value={query} onChange={setQuery} maxLength={200} leftIcon={<Search className="size-4" aria-hidden />} enterKeyHint="search" />
            </div>
          </form>
          <Switch
            checked={missingOnly}
            onCheckedChange={(value) => {
              setMissingOnly(value);
              void refresh(1, query, value);
            }}
            label={t("missingOnly")}
          />
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="-mx-2 divide-y divide-border">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-2 py-3">
                  <ProductIcon url={item.productIcon} className="size-9" />
                  <button type="button" onClick={() => setEditing(item)} className="min-w-0 flex-1 text-start">
                    <span className="flex flex-wrap items-center gap-2">
                      {item.recipient ? (
                        <span className="truncate text-sm font-medium">{item.recipient}</span>
                      ) : (
                        <AnimatedBadge size="sm" status="warning" showIcon={false}>
                          {t("noRecipient")}
                        </AnimatedBadge>
                      )}
                      {item.channel && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{t.has(`channels.${item.channel}`) ? t(`channels.${item.channel}`) : item.channel}</span>}
                    </span>
                    <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{item.code}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.productName} · {format.relativeTime(item.createdAt, now)}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t("copy")}: ${item.code}`}
                    onClick={() => void copy(item.id, item.code).then(() => showToast(t("copied")))}
                  >
                    {copied === item.id ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {hasMore && (
            <Button variant="secondary" className="w-full" onClick={() => void refresh(page + 1)}>
              {t("more")}
            </Button>
          )}
        </CardContent>
      </Card>

      <Drawer side={rtl ? "left" : "right"} open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} ariaLabel={t("edit")} className="w-full max-w-md">
        {editing && (
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <h2 className="text-base font-semibold">{t("edit")}</h2>
              <Button variant="ghost" size="icon" aria-label={t("close")} onClick={() => setEditing(null)}>
                <X className="size-4" aria-hidden />
              </Button>
            </div>
            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
              <CodeDisplay handout={editing} brand={brand} onToast={showToast} />
              <RecipientForm
                key={editing.id}
                handout={editing}
                compact
                onSaved={(next) => {
                  replace(next);
                  showToast(t("saved"));
                }}
                onUndone={(next) => {
                  replace(next);
                  showToast(t("undone"));
                  router.refresh();
                }}
              />
            </div>
          </div>
        )}
      </Drawer>
      <AnimatedToastStack toasts={toast.toasts} onDismiss={toast.dismissToast} position="bottom-center" fixed />
    </div>
  );
}
