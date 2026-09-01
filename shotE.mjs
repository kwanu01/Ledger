import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewportSize: { width: 1060, height: 700 } });
await p.goto('http://localhost:3119/zzp', { waitUntil: 'networkidle' });
await p.waitForTimeout(700);
const el = await p.$('table.book');
await el.screenshot({ path: '/tmp/S-stamps.png' });
await b.close();
