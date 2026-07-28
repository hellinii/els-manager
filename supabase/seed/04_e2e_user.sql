-- ============================================================================
-- Next 서버 스위트(tests/e2e/) 전용 사용자 **둘** — P4 컷 9 (DOC-010 AQ-34 종결)
--
-- ★ 왜 전용 사용자가 필요한가.
--
--   e2e가 확인해야 하는 상태 둘이 **한 소유자의 데이터를 전부 통제해야** 성립한다.
--
--     ① SCR-301 셋째 빈 상태 「예정 평가일 없음」
--        조건: 그 소유자의 **전 차수가 경과**했고 다가오는 차수가 하나도 없다.
--     ② SCR-101 ①의 절 문구 「임박한 평가일이 없다」
--        조건: 같다(`upcomingEvaluations`가 빈 배열).
--
--   종전 두 사용자(itg-a·itg-b)로는 만들 수 없다. 목록이 전역이고(모든 SELECT
--   정책이 using (true)) tests/integration/의 픽스처가 **커밋된 채 남아 있으며**
--   (CLAUDE.md의 스위트 순서가 integration → e2e다) 그중 productB(ITG_USER_B 소유)가
--   미래 평가일을 갖는다. 즉 **다른 스위트의 데이터가 이 상태의 성립을 막는다** —
--   AQ-34가 등재한 것이 정확히 그것이고, 그 항목이 적은 세 수단 중 (a)가 이 파일이다.
--
--   나머지 둘을 버린 이유도 그 항목에 있다: (b) URL에 `to` 축을 노출하면 화면의
--   필터가 하나 늘어 **검증 수단을 위해 제품을 바꾸는** 일이 되고, (c) Playwright는
--   P4에서 도입하지 않는다.
--
-- ★ 왜 둘인가 — 한 소유자가 두 상태를 동시에 가질 수 없다.
--
--   위 상태는 「다가오는 차수가 **하나도** 없다」이고 SCR-101 ①의 내용(임박 표식·
--   willMeet 세 갈래·판정 없음)은 그 반대를 요구한다. 한 사용자로 둘을 만들려면
--   **테스트의 실행 순서에 의존**해야 하는데(먼저 빈 상태를 보고 나중에 상품을
--   만든다) 그것은 이 프로젝트가 거부하는 초록색이다.
--
--     e2e-live : 임박 1건 · 먼 평가일 1건 · 결함 2건 · 상환 1건 → ①④⑤의 내용
--     e2e-past : 전 차수 경과 1건                              → ①의 빈 절, SCR-301 셋째 빈 상태
--
--   **표시 이름이 서로의 부분문자열이 아니다.** 「서버 사용자」와 「서버 사용자 B」로
--   두면 toContain이 둘을 구분하지 못한다 — 컷 4a의 「기초자산 1」, 컷 5의
--   「상환 실적」과 같은 함정이다.
--
-- ★ 부수 효과가 더 크다 — 이 사용자들의 집계는 **값으로** 단언할 수 있다.
--
--   SCR-101의 ②③⑤는 scope='MINE' 집계이므로 다른 스위트의 상품이 섞이면
--   「포함되어 있다」까지만 확인할 수 있다. 이들의 상품은 tests/e2e/home.test.ts가
--   전부 만들므로 activeCount·activePrincipal·realizedPnl·financialIncome을
--   **정확한 값으로** 단언한다.
--
-- ★ 왜 이 대역인가.
--
--   …0001xx는 사용자 대역이다(01_integration_users.sql이 101·102를 쓴다).
--   …0002xx·…0003xx는 그 스위트의 자산·상품이고 …0004xx는 개발용
--   (03_dev_users.sql)이므로 103·104가 비어 있다.
--
--   resetFixtures()가 지우는 tax_profiles의 대상은 101·102뿐이다 — 이 둘에게는
--   프로필을 만들지 않는다(SCR-101 ③의 단언이 폴백 0을 전제하며, 프로필이 생기면
--   그 값이 바뀐다).
--
-- ★ 기존 사용자 단언에 걸리지 않음을 확인했다.
--
--   tests/rls/users.test.ts:89·tests/rls/global-setup.ts:65는 **id로 필터**하고
--   tests/integration/contracts.test.ts의 listUserSummaries 단언 셋은 .find()로
--   행을 고른다(고정 건수 단언이 없다). 상품·시세 쪽의 **필터 없는 전역 건수
--   단언**에 걸리지 않는 이유는 이 파일이 사용자만 넣기 때문이다 —
--   03_dev_users.sql이 seed/에 있어도 되는 것과 같은 근거다(CLAUDE.md).
--
-- ★ 토큰 열 8개를 '' 로 명시한다.
--
--   4개는 컬럼 기본값이 없어 생략하면 NULL이 되고, GoTrue가 그것을 널 불가
--   string으로 스캔해 로그인이 **500**으로 죽는다. 실측 로그는
--   00_rls_test_users.sql의 주석에 있다.
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
   '00000000-0000-4000-8000-000000000103',
   'authenticated', 'authenticated', 'e2e-live@example.test',
   extensions.crypt('e2e-test-password', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"실행 사용자"}'::jsonb,
   '', '', '', '', '', '', '', ''),

  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-8000-000000000104',
   'authenticated', 'authenticated', 'e2e-past@example.test',
   extensions.crypt('e2e-test-password', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"경과 사용자"}'::jsonb,
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
where u.id in ('00000000-0000-4000-8000-000000000103',
               '00000000-0000-4000-8000-000000000104')
on conflict (provider_id, provider) do nothing;
