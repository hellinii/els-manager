-- ============================================================================
-- RLS 테스트·로컬 개발 전용 사용자
--
-- migrations/가 아니라 seed/에 있으므로 `supabase db push`(운영)에서는
-- 실행되지 않는다. `supabase db reset`(로컬)에서만 적용된다.
--
-- auth.users에 직접 INSERT하는 것은 GoTrue의 스키마 버전에 결합된다.
-- 그 결합을 테스트 헬퍼 코드가 아니라 리뷰 가능한 SQL 파일 한 곳에 가둔다.
-- CLI 업그레이드로 auth 스키마가 바뀌면 여기만 고치면 된다.
--
-- public.users 행은 만들지 않는다. on_auth_user_created 트리거가 만들며,
-- 그 자체가 20260726171034 마이그레이션의 검증이 된다.
--
-- UUID는 tests/rls/helpers/fixtures.ts의 USER_A·USER_B와 반드시 일치한다.
--
-- ---------------------------------------------------------------------------
-- ★ 빈 문자열 토큰 열 (P3a 실측, GoTrue v2.192.0)
--
-- GoTrue는 `auth.users`의 토큰 열들을 Go의 `string`(널 불가)으로 스캔한다.
-- 아래 4개 열만 컬럼 기본값이 없어 INSERT에서 생략하면 NULL이 되고,
-- 그러면 로그인이 **500 unexpected_failure / "Database error querying schema"**
-- 로 죽는다. 실제 로그:
--   error finding user: sql: Scan error on column index 3,
--   name "confirmation_token": converting NULL to string is unsupported
-- 사용자를 못 찾는 경우는 400 invalid_credentials이므로, 이 오류는 행이
-- **존재할 때만** 난다 — 즉 시드가 있어야 비로소 드러난다.
--
-- 나머지 4개(phone_change, phone_change_token, email_change_token_current,
-- reauthentication_token)는 컬럼 기본값이 ''이므로 생략해도 안전하다.
-- 기본값에 의존하지 않고 8개 모두 명시해 CLI 업그레이드에 대비한다.
--
-- `auth.identities` 행도 함께 만든다 — GoTrue가 자기 가입 경로에서 만드는 것과
-- 같은 상태로 맞춘다(`getUser().identities`가 빈 배열이 되지 않게).
-- provider_id는 email provider에서 사용자 UUID다.
--
-- 이 파일이 고쳐지기 전까지 RLS 스위트는 전부 초록색이었다 — `pg` 직결 +
-- `set local role` 가장이라 GoTrue를 한 번도 지나지 않기 때문이다.
-- ---------------------------------------------------------------------------
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
   '00000000-0000-4000-8000-00000000000a',
   'authenticated', 'authenticated', 'rls-a@example.test',
   extensions.crypt('rls-test-password', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"테스트 사용자 A"}'::jsonb,
   '', '', '', '', '', '', '', ''),

  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-8000-00000000000b',
   'authenticated', 'authenticated', 'rls-b@example.test',
   extensions.crypt('rls-test-password', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"테스트 사용자 B"}'::jsonb,
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
where u.id in ('00000000-0000-4000-8000-00000000000a',
               '00000000-0000-4000-8000-00000000000b')
on conflict (provider_id, provider) do nothing;
