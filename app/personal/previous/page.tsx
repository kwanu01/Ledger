import type { Metadata } from 'next';
import { getLang } from '../../../lib/lang.ts';
import Logo from '../../Logo.tsx';
import WeeklyMoney from '../../WeeklyMoney.tsx';

export const metadata: Metadata = { title: '이전 개인 기록 — teamLedger', robots: { index: false, follow: false } };

export default async function PreviousPersonal() {
  const lang = await getLang();
  return <main className="landing landing-personal"><Logo plain /><WeeklyMoney locale={lang} /></main>;
}
