import 'server-only';
import { AccessError } from './access.ts';

/**
 * 오류를 사람 말로 바꾼다.
 *
 * 우리가 던지는 말과 데이터베이스 가드가 던지는 말은 모두 한국어로 쓰여 있다.
 * 사용자에게 보여 주려고 쓴 문장이라 그대로 보여 준다.
 *
 * 그 밖의 것 — 드라이버가 내는 영어 문장 — 은 보여 주지 않는다. 거기에는 표
 * 이름, 제약 이름, 때로는 값까지 들어 있다. 화면에 띄우면 안쪽 구조를 그대로
 * 읽히는 셈이 된다. 대신 서버 기록에는 남긴다.
 *
 * 재는 자가 한 벌이어야 해서 여기 모아 둔다. 액션 파일마다 따로 두면 한 곳만
 * 고쳐지고 다른 곳에서 그대로 새어 나간다.
 */
const SPEAKS_KOREAN = /[가-힣]/;

export function failed(e: unknown, fallback = '처리하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.'): {
  ok: false;
  message: string;
} {
  if (e instanceof AccessError) return { ok: false, message: e.message };
  const raw = e instanceof Error ? e.message : '';
  if (raw && SPEAKS_KOREAN.test(raw)) return { ok: false, message: raw };
  console.error('[ledger]', e);
  return { ok: false, message: fallback };
}
