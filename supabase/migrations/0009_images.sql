-- ══════════════════════════════════════════════════════════════════════
-- 0009 · 사진 저장소
--
-- 영수증과 대표 사진을 담을 자리를 만든다.
--
-- **공개하지 않는다(public = false).** 영수증에는 카드 뒷번호와 매장, 시각이
-- 찍혀 있다. 주소만 알면 누구나 열리는 자리에 두면 그 링크가 흘러나가는 순간
-- 끝이다. 그래서 파일은 서버만 꺼낼 수 있게 두고, 화면에는 우리 주소
-- (/l/<장부>/img/<경로>)로 내보낸다. 그 자리에서 이 장부에 들어올 수 있는
-- 사람인지 한 번 더 판정한다(app/l/[ledgerId]/img).
--
-- 정책(policy)은 따로 만들지 않는다. 이 서비스는 브라우저에서 저장소를 직접
-- 부르지 않고, 서버가 service_role 로만 읽고 쓴다. 정책을 열어 두면 오히려
-- 우리가 막아 둔 길을 옆으로 트는 셈이 된다.
--
-- Supabase SQL Editor 에서 한 번 실행한다.
-- ══════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-images',
  'expense-images',
  false,
  5242880,                                     -- 5MB. 폰 사진 한 장이면 충분하다
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
