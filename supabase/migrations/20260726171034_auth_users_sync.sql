-- ============================================================================
-- Supabase Auth 연계 — DOC-002 D-06, SEC-01·SEC-03
--
-- public.users에는 INSERT 정책을 두지 않는다. 계정은 초대(auth.users)
-- 경로로만 생기므로(A-05, 공개 가입 없음) 프로필 행을 만드는 유일한
-- 경로가 여기다.
--
-- 이 파일만 "문서에 없던 결정"을 담는다. 결정을 바꿔야 하면 스키마를
-- 건드리지 않고 이 파일에 대응하는 후속 마이그레이션 하나로 끝난다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 계정 생성 시 프로필 행 생성
--
-- display_name 확보 순서 (D-06):
--   1. 초대 시 지정한 user_metadata.display_name
--   2. 이메일 로컬파트 — NOT NULL을 항상 만족시키기 위한 폴백
--
-- left(..., 50)이 필요한 이유: display_name은 varchar(50)이고 이메일
-- 로컬파트는 그보다 길 수 있다. 자르지 않으면 길이 초과로 INSERT가 실패하고,
-- 트리거가 auth.users의 INSERT 트랜잭션 안에 있으므로 초대 자체가 실패한다.
-- 원인이 드러나는 자리와 실패하는 자리가 멀어진다.
--
-- security definer + search_path = '' — Supabase 권장 형태. 호출자가
-- authenticated여도 public.users에 쓸 수 있어야 하고, search_path를 비워
-- 스키마 탈취를 막는다.
-- ---------------------------------------------------------------------------
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, display_name)
  values (
    new.id,
    new.email,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
        split_part(new.email, '@', 1)
      ),
      50
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- 이메일 변경 동기화
--
-- 없으면 users.email이 UNIQUE NOT NULL인 채로 아무도 갱신하지 않는
-- 스냅샷이 된다. 사용자가 Auth에서 이메일을 바꾸면 두 값이 갈라지고,
-- users.email은 로그인 식별자로서의 의미를 잃는다(DOC-002 §4.1).
-- ---------------------------------------------------------------------------
create function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function public.handle_auth_user_email_change();

-- ---------------------------------------------------------------------------
-- 백필
--
-- 이 마이그레이션 이전에 초대된 계정에는 프로필 행이 없다. 그 상태로는
-- els_products.owner_id의 FK가 걸려 모든 쓰기가 실패한다.
-- ---------------------------------------------------------------------------
insert into public.users (id, email, display_name)
select
  u.id,
  u.email,
  left(
    coalesce(
      nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''),
      split_part(u.email, '@', 1)
    ),
    50
  )
from auth.users u
where u.email is not null
on conflict (id) do nothing;
