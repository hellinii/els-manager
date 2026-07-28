-- ============================================================================
-- 로컬 개발(브라우저) 전용 사용자 — P4 컷 2
--
-- ★ 왜 RLS·integration 사용자를 쓰지 않는가.
--
--   화면을 브라우저로 확인하는 행위는 **커밋한다.** SCR-401을 열어 과세 프로필을
--   저장하면 `tax_profiles` 행이 남고, `tests/rls/tax-profiles.test.ts:51`은
--   **필터 없이** `select user_id from tax_profiles`를 하고 `toEqual([USER_A])`를
--   단언한다 — RLS 사용자로 로그인해 화면을 쓰면 그 단언이 깨진다. 같은 부류의
--   충돌 3건이 `01_integration_users.sql` 주석에 실측으로 적혀 있다.
--
--   격리를 규율("개발 중에는 SCR-401을 열지 않는다")로 지키면 언젠가 깨지고,
--   깨진 뒤에는 원인이 스위트 결함처럼 보인다. 사용자를 따로 두면 구조가 된다.
--
-- ★ 왜 둘인가 (계획 §9는 하나로 적었다).
--
--   SCR-201의 **소유자 필터**가 DOC-008 SQ-01의 근거다 — 「소유자 필터가 사용자
--   현황 화면을 대체한다」가 SCR-501을 만들지 않는 이유이고, 그러므로 그 필터는
--   소유자가 **둘 이상**일 때에만 확인된다. 둘째 소유자로 RLS·integration
--   사용자를 빌리면 그 사용자의 대역에 개발용 상품이 들어가고, 위에서 구조로
--   만든 격리가 다시 규율이 된다.
--
--   SCR-202의 「타 사용자 → 액션 버튼 미노출」(ST-04)도 둘째 소유자를 요구한다.
--
-- ★ 이 파일은 `seed/`에 있다 — 표본 데이터와 다르다.
--
--   `sql_paths = ["./seed/*.sql"]`가 글롭이므로 `db:reset`이 자동으로 싣는다.
--   **사용자는 그래도 된다**: 위 세 스위트의 사용자 단언은 전부 id로 필터하고
--   (`tests/rls/users.test.ts:89`, `tests/rls/global-setup.ts:65`)
--   `listUserSummaries`에는 고정 건수 단언이 없다(`user-summaries.test.ts`는
--   `.find()`로 행을 고른다). **상품·시세는 그렇지 않으므로** `supabase/dev/`에
--   둔다 — `tests/integration/contracts.test.ts`에 필터 없는 전역 건수 단언이
--   있고 모든 SELECT 정책이 `using (true)`라 남의 상품도 센다(CLAUDE.md).
--
-- ★ 토큰 열 8개를 `''`로 명시한다.
--
--   4개는 컬럼 기본값이 없어 생략하면 NULL이 되고, GoTrue가 그것을 널 불가
--   `string`으로 스캔해 로그인이 **500**으로 죽는다. 근거는
--   `00_rls_test_users.sql`의 주석에 실측 로그와 함께 있다.
--
-- UUID 대역: 00000000-0000-4000-8000-0000000004xx
--   (RLS는 ...00a/b, integration은 ...1xx~3xx)
--
-- 로그인: dev-a@example.test / dev-b@example.test, 비밀번호 dev-password
-- ============================================================================

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token
) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-8000-000000000401',
   'authenticated', 'authenticated', 'dev-a@example.test',
   extensions.crypt('dev-password', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"개발 본인"}'::jsonb,
   '', '', '', '', '', '', '', ''),

  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-8000-000000000402',
   'authenticated', 'authenticated', 'dev-b@example.test',
   extensions.crypt('dev-password', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"개발 타인"}'::jsonb,
   '', '', '', '', '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at,
  created_at, updated_at
)
select
  u.id::text,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true,
                     'phone_verified', false),
  'email',
  now(), now(), now()
from auth.users u
where u.id in ('00000000-0000-4000-8000-000000000401',
               '00000000-0000-4000-8000-000000000402')
on conflict (provider_id, provider) do nothing;
