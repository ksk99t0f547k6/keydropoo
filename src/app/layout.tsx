import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { rtlLocales, type Locale } from "@/i18n/locales";
import { SiteThemeProvider } from '@/components/site/theme-controls';
import messages from '../../messages/en.json';
import "./globals.css";
export const metadata: Metadata = { title: { default: messages.common.brand, template: `%s · ${messages.common.brand}` }, robots: {index: false, follow: false}, icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }], apple: '/icons/apple-touch-icon.png' } };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
 const locale = await getLocale();
 return <html lang={locale} dir={rtlLocales.includes(locale as Locale) ? "rtl" : "ltr"} suppressHydrationWarning><body><NextIntlClientProvider><SiteThemeProvider>{children}</SiteThemeProvider></NextIntlClientProvider></body></html>;
}
