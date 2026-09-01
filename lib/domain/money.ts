/**
 * Ledger — 통화와 금액 표기
 *
 * 핵심 규칙: 금액은 언제나 **그 통화의 최소 단위 정수**로 저장한다.
 *   KRW  1  = 1원      (소수 자리 없음)
 *   USD  1  = 1센트    (소수 두 자리)
 *
 * 그래서 정산 엔진은 통화를 몰라도 된다. 32,500이 원이든 센트든
 * 나머지 1단위까지 정확히 나누는 규칙은 그대로다. 통화는 표기할 때만 쓴다.
 *
 * 장부 하나는 통화 하나를 쓴다. 한 장부 안에서 통화를 섞는 것은 §27의 미결 항목이다.
 */

export type CurrencyCode = 'KRW' | 'JPY' | 'CNY' | 'VND' | 'USD' | 'EUR' | 'GBP';

/** 화면 언어. 숫자와 날짜를 어느 관습으로 쓸지도 여기서 갈린다. */
export type Locale = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'vi';

export const CURRENCIES: Record<CurrencyCode, { decimals: number; label: string }> = {
  KRW: { decimals: 0, label: '원' },
  JPY: { decimals: 0, label: '円' },
  CNY: { decimals: 2, label: '元' },
  VND: { decimals: 0, label: 'Đồng' },
  USD: { decimals: 2, label: 'Dollar' },
  EUR: { decimals: 2, label: 'Euro' },
  GBP: { decimals: 2, label: 'Pound' },
};

const TAGS: Record<Locale, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN', es: 'es-ES', vi: 'vi-VN',
};
const localeTag = (locale: Locale) => TAGS[locale] ?? 'ko-KR';

/** 최소 단위 정수 → 사람이 읽는 금액 (통화 기호 포함) */
/**
 * 원화는 기호 대신 '원'을 뒤에 붙인다.
 *
 * ₩(U+20A9)는 W에 가로줄을 그은 글자다. 본문 활자로 크게 찍으면 그 가로줄이
 * 취소선처럼 읽힌다 — ₩0 이 '0을 지운 것'으로 보인다. 금액을 적는 자리에서
 * 그렇게 보이면 안 된다.
 *
 * 그리고 한국에서 돈은 원래 '41,300원'이라고 적는다. 기호를 앞에 붙이는 것은
 * 달러의 관습이다. 카카오톡으로 나가는 정산 내역도 이쪽이 자연스럽게 읽힌다.
 *
 * 다른 통화는 그대로 둔다. $와 ¥는 앞에 붙는 것이 그 나라의 관습이고,
 * 글자 모양도 문제가 없다.
 */
/** 원화 뒤에 붙는 말. 화면의 언어를 따른다. */
const WON: Record<Locale, string> = {
  ko: '원',
  en: ' KRW',
  ja: 'ウォン',
  zh: '韩元',
  es: ' KRW',
  vi: ' KRW',
};

export function formatMoney(minor: number, code: CurrencyCode = 'KRW', locale: Locale = 'ko'): string {
  const { decimals } = CURRENCIES[code];
  const sign = minor < 0 ? '-' : '';
  const value = Math.abs(minor) / 10 ** decimals;

  if (code === 'KRW') {
    return `${sign}${new Intl.NumberFormat(localeTag(locale)).format(value)}${WON[locale]}`;
  }
  // narrowSymbol을 써야 한국어 로캘에서 USD가 'US$'가 아니라 '$'로 나온다.
  // 지원하지 않는 환경이면 기본 표기로 떨어진다.
  const opts: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: code,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  };
  let text: string;
  try {
    text = new Intl.NumberFormat(localeTag(locale), { ...opts, currencyDisplay: 'narrowSymbol' }).format(value);
  } catch {
    text = new Intl.NumberFormat(localeTag(locale), opts).format(value);
  }
  return sign + text;
}

/** 최소 단위 정수 → 기호 없는 숫자 (표의 금액 칸에 쓴다) */
export function formatNumber(minor: number, code: CurrencyCode = 'KRW', locale: Locale = 'ko'): string {
  const { decimals } = CURRENCIES[code];
  const sign = minor < 0 ? '-' : '';
  const value = Math.abs(minor) / 10 ** decimals;
  return (
    sign +
    new Intl.NumberFormat(localeTag(locale), {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value)
  );
}

/**
 * 장부의 금액 칸 (§20)
 *
 * 빼는 금액에 마이너스 기호와 빨간색을 함께 붙이면 반대로 읽힌다. 반품은
 * 돈이 돌아온 일인데 빨간 −8,900은 손해처럼 보인다. 한국에서는 빨강이 오르는
 * 쪽 색이라 더 헷갈린다.
 *
 * 회계 장부는 예부터 빼는 금액을 괄호로 적었다. 색에 기대지 않고, 부호를
 * 놓칠 일도 없다. 등폭 숫자라서 닫는 괄호 한 칸만큼 왼쪽으로 물러나 앉는데,
 * 그 어긋남이 곧 "이 줄은 빼는 줄"이라는 표시가 된다.
 */
export function formatEntryAmount(
  minor: number,
  code: CurrencyCode = 'KRW',
  locale: Locale = 'ko',
  withSymbol = false,
): string {
  const f = withSymbol ? formatMoney : formatNumber;
  const text = f(Math.abs(minor), code, locale);
  return minor < 0 ? `(${text})` : text;
}

/** 사람이 입력한 문자열 → 최소 단위 정수. 반올림하지 않고 잘라 낸다. */
export function parseMoney(input: string, code: CurrencyCode = 'KRW'): number {
  const { decimals } = CURRENCIES[code];
  const cleaned = String(input).replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const [whole, frac = ''] = cleaned.split('.');
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return Number(whole || '0') * 10 ** decimals + Number(padded || '0');
}

/** 한 단위 = 최소 단위 몇 개인가. 입력 폼의 step 등에 쓴다. */
export function minorPerUnit(code: CurrencyCode = 'KRW'): number {
  return 10 ** CURRENCIES[code].decimals;
}
