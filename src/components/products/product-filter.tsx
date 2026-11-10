"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/motion/input";
import { Button } from "@/components/motion/button/base";
import { Choice } from "@/components/inventory/choice";

export function ProductFilter({ query, state }: { query: string; state: string }) {
 const t = useTranslations("products");
 const router = useRouter();
 const [search, setSearch] = useState(query);
 const [status, setStatus] = useState(state);
 return <form className="mb-4 flex flex-wrap items-end gap-3" onSubmit={event => {
  event.preventDefault();
  router.push(`/dashboard/products?${new URLSearchParams({query:search,state:status})}`);
 }}>
  <Input label={t("search")} value={search} onChange={setSearch} maxLength={120}/>
  <Choice label={t("statusLabel")} value={status} onChange={setStatus} options={["active","archived"].map(value=>({value,label:t(value)}))}/>
  <Button type="submit" variant="outline">{t("filter")}</Button>
 </form>;
}
