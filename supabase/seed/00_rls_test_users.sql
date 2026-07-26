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
-- ============================================================================

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-8000-00000000000a',
   'authenticated', 'authenticated', 'rls-a@example.test',
   extensions.crypt('rls-test-password', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"테스트 사용자 A"}'::jsonb),

  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-8000-00000000000b',
   'authenticated', 'authenticated', 'rls-b@example.test',
   extensions.crypt('rls-test-password', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"테스트 사용자 B"}'::jsonb)
on conflict (id) do nothing;
