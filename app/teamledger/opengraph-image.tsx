import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-static';
export const alt = 'teamLedger — 함께 쓰는 장부';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpenGraphImage() {
  const [wordmark, mascot, sans] = await Promise.all([
    readFile(join(process.cwd(), 'public/brand/teamLedger.svg')),
    readFile(join(process.cwd(), 'public/helper/stand.png')),
    readFile(join(process.cwd(), 'node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf')),
  ]);
  return new ImageResponse(
    <div style={{ display: 'flex', width: '100%', height: '100%', background: '#fff', color: '#212121', fontFamily: 'LedgerSans', padding: '60px 76px', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <img src={`data:image/svg+xml;base64,${wordmark.toString('base64')}`} alt="teamLedger" width="550" height="192" />
        <div style={{ fontSize: 25, color: '#666', marginTop: 18 }}>One shared ledger.</div>
        <div style={{ fontSize: 20, color: '#777', marginTop: 92 }}>teamledger.net/teamledger</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', padding: '34px 30px', border: '1px solid #ccc', width: 340, transform: 'rotate(4deg)', boxShadow: '10px 12px 0 #f3f3f3' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20, paddingBottom: 25, borderBottom: '1px solid #212121' }}><span>3 PEOPLE</span><span>01</span></div>
        <div style={{ fontSize: 58, marginTop: 22 }}>93,000</div>
        <div style={{ fontSize: 18, color: '#777', marginTop: 8 }}>KRW · SHARED EXPENSES</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 22 }}><img src={`data:image/png;base64,${mascot.toString('base64')}`} alt="" width="124" height="124" /></div>
      </div>
    </div>,
    { ...size, fonts: [{ name: 'LedgerSans', data: sans, style: 'normal', weight: 400 }] },
  );
}
