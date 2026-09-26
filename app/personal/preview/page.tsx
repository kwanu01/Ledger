import type { Metadata } from 'next';
import { getLang } from '../../../lib/lang.ts';
import Logo from '../../Logo.tsx';
import PersonalBooks from '../../PersonalBooks.tsx';

export const metadata: Metadata = { title: '개인 장부 미리보기 — teamLedger', robots: { index: false, follow: false } };

export default async function PersonalPreview() {
  const lang = await getLang();
  return <main className="landing landing-personal"><Logo plain /><PersonalBooks locale={lang} /></main>;
}
