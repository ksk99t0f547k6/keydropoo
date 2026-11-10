"use client";

import { ThemeProvider, useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { ThemeToggle } from '@/components/motion/theme-toggle';
import { LanguageSwitcher } from './language-switcher';

function ThemeControl() {
  const t = useTranslations('publicSite');
  const { setTheme } = useTheme();
  return <div className="theme-controls">
    <LanguageSwitcher className="w-36" />
    <button type="button" className="text-xs" onClick={() => setTheme('system')} title={t('systemTheme')}>{t('system')}</button>
    <ThemeToggle aria-label={t('toggleTheme')} title={t('toggleTheme')} className="h-11 w-11 rounded-full" iconClassName="h-5 w-5" />
  </div>;
}

export function SiteThemeProvider({children}: {children: React.ReactNode}) {
  return <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="keydrop-theme">
    {children}<ThemeControl />
  </ThemeProvider>;
}
