'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { Locale } from '../lib/domain/money.ts';
import type { Theme } from '../lib/theme-key.ts';
import ThemeToggle from './ThemeToggle.tsx';
import Helper from './helper/Helper.tsx';

/** Public previews have their own presentation and do not run the floating helper. */
export default function SiteControls({ children, lang, theme }: {
  children: ReactNode;
  lang: Locale;
  theme: Theme | null;
}) {
  const path = usePathname();
  const publicPreview = path === '/chagok' || path === '/demo';
  return <>
    {publicPreview ? null : <ThemeToggle value={theme} />}
    {children}
    {publicPreview ? null : <Helper lang={lang} />}
  </>;
}
