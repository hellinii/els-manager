-- ============================================================================
-- 조회 계약(integration) 스위트 전용 사용자
--
-- **RLS 스위트의 USER_A·USER_B를 쓰지 않는다.** 이 스위트의 픽스처는 커밋되고
-- (HTTP 클라이언트가 다른 커넥션이라 롤백 전제로는 보이지 않는다) RLS 스위트는
-- 롤백 전제이므로, 같은 사용자를 공유하면 커밋된 행이 RLS 단언을 깬다.
-- 실측으로 확인한 충돌 3곳:
--
--   ① tests/rls/tax-profiles.test.ts는 **필터 없이** `select user_id from
--      tax_profiles`를 하고 `toEqual([USER_A])`를 단언한다 → USER_A의 커밋된
--      프로필 행 하나로 빨간불.
--   ② seedTaxProfile의 기본 연도가 2026이라 UNIQUE(user_id, tax_year) 충돌 →
--      시드 자체가 23505로 죽는다.
--   ③ seedAsset 기본값 ('테슬라','NASDAQ')이 assets_name_market_key
--      (NULLS NOT DISTINCT)와 충돌.
--
-- 그래서 이 스위트는 **자기 사용자 + 예약된 이름·UUID 대역**을 쓰고
-- USER_A·USER_B의 tax_profiles를 절대 건드리지 않는다.
--
-- UUID 대역: 00000000-0000-4000-8000-0000000001xx (RLS는 ...00000a/b)
--
-- 토큰 열을 ''로 명시하는 이유는 00_rls_test_users.sql의 주석에 있다 —
-- NULL이면 GoTrue 로그인이 500으로 죽는다.
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
   '00000000-0000-4000-8000-000000000101',
   'authenticated', 'authenticated', 'itg-a@example.test',
   extensions.crypt('itg-test-password', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"계약 사용자 A"}'::jsonb,
   '', '', '', '', '', '', '', ''),

  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-8000-000000000102',
   'authenticated', 'authenticated', 'itg-b@example.test',
   extensions.crypt('itg-test-password', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"계약 사용자 B"}'::jsonb,
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
where u.id in ('00000000-0000-4000-8000-000000000101',
               '00000000-0000-4000-8000-000000000102')
on conflict (provider_id, provider) do nothing;
