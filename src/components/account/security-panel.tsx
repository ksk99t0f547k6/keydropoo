"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { PasswordForm } from "@/components/auth/password-form";
import { ProfileForm } from "@/components/account/profile-form";
import { signInLink } from "@/lib/domain/auth-navigation";

export interface SecurityState {
  name: string;
  email: string;
  hasPassword: boolean;
  needsVerification: boolean;
  needsFresh: boolean;
  emailEnabled: boolean;
}

// 帳號的共用內容（名稱與密碼）：一般使用者頁 /account/security 與後台 /dashboard/security 共用。
export function SecurityPanel({ state, returnTo }: { state: SecurityState; returnTo: string }) {
  const t = useTranslations("security");
  return (
    <div className="space-y-10">
      <section className="space-y-4" aria-labelledby="account-profile">
        <h2 id="account-profile" className="text-lg font-medium">{t("profileHeading")}</h2>
        <p className="break-all text-sm text-muted-foreground">{state.email}</p>
        <ProfileForm name={state.name} />
      </section>
      <section className="space-y-6" aria-labelledby="account-password">
        <h2 id="account-password" className="text-lg font-medium">{t("passwordHeading")}</h2>
        {state.needsVerification || state.needsFresh ? (
          <div className="space-y-5">
            <p>{t(state.needsVerification ? "verifyFirst" : "reauth")}</p>
            <Link className="underline" href={signInLink(returnTo)}>
              {t("signInAgain")}
            </Link>
          </div>
        ) : (
          <PasswordForm hasPassword={state.hasPassword} returnTo={returnTo} />
        )}
        {state.emailEnabled && (
          <p>
            <Link className="text-sm underline" href="/reset-password">
              {t("forgot")}
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}
