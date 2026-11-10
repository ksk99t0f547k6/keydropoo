"use client";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/motion/button/base";
import { returnFromHash } from "@/lib/domain/auth-navigation";
import { Input } from "@/components/motion/input";
import {AuthFlowLink} from './auth-flow-link';

export function AuthForm({ setup = false, emailEnabled = false }: { setup?: boolean; emailEnabled?: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [register, setRegister] = useState(false);
  const [verification, setVerification] = useState(false);
  const [otpMode, setOtpMode] = useState(false);
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const path = verification ? sent ? "/api/auth/email-otp/verify-email" : "/api/auth/email-otp/send-verification-otp" : setup ? "/api/setup" : otpMode ? sent ? "/api/auth/sign-in/email-otp" : "/api/auth/email-otp/send-verification-otp" : register ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email";
    const body = verification ? sent ? {email,otp} : {email,type:"email-verification"} : setup ? { name, secret, password } : otpMode ? sent ? { email, otp } : { email, type: "sign-in" } : register ? {name,email,password} : { email, password };
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        const key = setup && ["INVALID_SECRET", "ALREADY_INITIALIZED", "INVALID_INPUT", "SETUP_FAILED"].includes(data.error ?? "") ? data.error : "generic";
        setError(t(`errors.${key}`)); return;
      }
      if (setup) { setSecret(""); setPassword(""); router.replace("/sign-in"); }
      else if (verification && sent) { router.replace(returnFromHash(window.location.hash)); router.refresh(); }
      else if (register && !verification && !otpMode && emailEnabled) { setVerification(true); setPassword(""); setNotice(t("auth.verifyHint")); }
      else if ((otpMode || verification) && !sent) { setSent(true); setNotice(t("auth.codeSent")); }
      else { router.replace(returnFromHash(window.location.hash)); router.refresh(); }
    } catch { setError(t("errors.generic")); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-5">
    <fieldset disabled={busy} className="space-y-5">
      {setup ? <><Input label={t("common.name")} value={name} onChange={setName} required maxLength={100} autoComplete="name" /><Input label={t("setup.secret")} type="password" value={secret} onChange={setSecret} required autoComplete="off" /></> : <Input label={t("common.email")} type="email" value={email} onChange={(v) => { setEmail(v); setSent(false); }} required autoComplete="email" disabled={verification} />}
      {register && !verification && <Input label={t("common.name")} value={name} onChange={setName} required maxLength={100} autoComplete="name"/>}
      {!otpMode && !verification && <Input label={t("common.password")} type="password" value={password} onChange={setPassword} required minLength={setup || register ? 12 : 1} maxLength={128} autoComplete={setup || register ? "new-password" : "current-password"} />}
      {(setup || register) && !verification && <p className="text-sm text-muted-foreground">{t("setup.passwordHint")}</p>}
      {(otpMode || verification) && sent && <Input label={t("auth.code")} value={otp} onChange={setOtp} required inputMode="numeric" autoComplete="one-time-code" />}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? t("common.working") : setup ? t("setup.submit") : (otpMode || verification) && !sent ? t("auth.sendCode") : verification ? t("auth.verify") : register ? t("auth.register") : t("common.signIn")}</Button>
      {!setup && !verification && emailEnabled && <Button type="button" variant="ghost" className="w-full" onClick={() => { setOtpMode(!otpMode); setRegister(false); setSent(false); setError(""); setNotice(""); }}>{t(otpMode ? "auth.passwordMode" : "auth.otpMode")}</Button>}
      {!setup && !verification && <Button type="button" variant="ghost" className="w-full" onClick={()=>{setRegister(!register);setOtpMode(false);setSent(false);setError("");setNotice("");}}>{t(register?"auth.haveAccount":"auth.createAccount")}</Button>}
      {!setup&&!verification&&emailEnabled&&<p className="text-center text-sm"><AuthFlowLink page="reset-password">{t('security.forgot')}</AuthFlowLink></p>}
    </fieldset>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
  </form>;
}
