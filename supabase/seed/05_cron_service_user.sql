-- ============================================================================
-- 배치 전용 서비스 계정 — P5a 컷 3 (DOC-010 AQ-57 = ⓐ · DOC-013 §7)
--
-- ★ 왜 «사용자»인가 — `service_role`을 쓰지 않기로 한 결정의 이행이다.
--
--   배치가 시세를 쓰려면 어떤 정체성이 필요하다. 선택지가 둘이었고(AQ-57)
--   ⓑ `service_role` 키를 도입하면 **RLS 정책 32개가 배치 경로에서 통째로
--   무효**가 된다(`rolbypassrls = t`). 그 사실은 정책 테스트가 전부 초록인 채로
--   참이 되므로 — 테스트는 롤 «안»의 분리만 본다 — 그것이 이 저장소가 반복해서
--   거부해 온 형태다.
--
--   ⓐ는 배치를 **그냥 또 하나의 `authenticated` 사용자**로 만든다. 그래서
--   `SUPABASE_SECRET_KEY`가 어느 커밋에도 들어오지 않는 상태가 **영구**가 된다
--   (`tests/db/no-service-role.test.ts`가 그것을 정확 일치로 지킨다).
--
-- ★★ 그리고 그 결정이 `cron_runs.actor_id`를 «위조 불가»로 만든다.
--
--   정책이 `with check (actor_id = (select auth.uid()))`이므로 다른 값을 적으려면
--   42501이다. 즉 그 열은 「누가 썼다고 주장하는가」가 아니라 **「누가 썼는가」**다.
--   배치가 자기 GoTrue 정체성을 갖지 않으면 이 성질이 성립하지 않는다 —
--   ⓐ의 네 번째 논거이며 두 결정(AQ-51 · AQ-57)의 직접적인 상승효과다.
--
-- ★★★ 남는 공백을 적어 둔다: cron과 손으로 쏜 진단 `curl`은 **구별되지 않는다.**
--   둘 다 이 계정의 토큰을 쓴다. `cron_runs.caller`는 「배치 라우트인가 화면
--   버튼인가」만 가른다. `x-vercel-cron` 헤더가 후보이나 **미실측**이므로 설계가
--   아니라 잔여로 남긴다.
--
-- ★ 왜 `seed/`에 두는가 — 사용자는 허용된 예외다(CLAUDE.md).
--
--   `sql_paths`가 글롭이라 시드에 **상품·시세**를 넣으면 `tests/integration/`의
--   필터 없는 전역 건수 단언이 잘못된 이유로 빨간불이 된다. 그러나 사용자 쪽
--   단언은 전부 id로 필터하거나 `.find()`로 행을 고르므로 안전하고, 무엇보다
--   **매 리셋에 살아 있어야 로그인할 수 있다.** 03·04와 같은 근거다.
--
--   이 계정은 상품을 갖지 않는다. 어느 파일도 이 사용자에 무엇도 만들지 않는다 —
--   `cron_runs` 행만 쌓이고 그쪽에는 전역 건수 단언이 없다.
--
-- ★ 왜 …0001**07**인가.
--
--   …0001xx가 사용자 대역이다(101·102 = integration, 103~106 = e2e).
--   107이 다음 빈 자리다.
--
-- ★ 토큰 열 8개를 '' 로 명시한다.
--
--   4개는 컬럼 기본값이 없어 생략하면 NULL이 되고, GoTrue가 그것을 널 불가
--   string으로 스캔해 로그인이 **500**으로 죽는다. 실측 로그는
--   00_rls_test_users.sql의 주석에 있다.
--
-- ★★ 비밀번호가 여기 «평문으로» 있는 것이 안전한 이유와 그 한계.
--
--   이 파일은 **로컬 스택 전용**이다(`db:reset`이 적용한다). 운영에서는 이
--   계정을 Supabase 대시보드에서 만들고 비밀번호를 Vercel 환경변수
--   `CRON_SERVICE_PASSWORD`에 넣는다 — **그 값은 어느 문서·커밋에도 적지 않는다**
--   (SEC-05: 변수 «이름»만 기록한다). 즉 저장소에 남는 평문은 로컬 값 하나이고
--   그것은 `dev-password`·`e2e-test-password`와 같은 부류다.
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
   '00000000-0000-4000-8000-000000000107',
   'authenticated', 'authenticated', 'cron@example.test',
   extensions.crypt('cron-service-password', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   -- 표시 이름이 다른 사용자의 부분문자열이 아니다 — `toContain`이 둘을 구분해야 한다
   '{"display_name":"시세 배치"}'::jsonb,
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
where u.id = '00000000-0000-4000-8000-000000000107'
on conflict (provider_id, provider) do nothing;
