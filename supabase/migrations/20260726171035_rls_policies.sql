-- ============================================================================
-- 권한 정책 — DOC-010 §7 권한 표, ADR-002, CLAUDE.md 절대 규칙 #6
--
-- 이 파일은 DOC-010 §7 표와 1:1로 대응한다. 표를 바꾸면 이 파일을 바꾸고
-- tests/rls/의 케이스를 함께 갱신한다. 순서는 문서 → 마이그레이션 → 테스트다.
--
-- 정책은 기본이 PERMISSIVE이며 같은 명령에 대해 OR로 결합된다. 이 파일은
-- (테이블, 명령)당 정확히 1개의 정책만 만든다. 조건을 AND로 좁히려면 새
-- PERMISSIVE 정책이 아니라 RESTRICTIVE 정책을 써야 한다.
--
-- auth.uid()가 아니라 (select auth.uid())를 쓴다. 스칼라 서브쿼리로 감싸면
-- 플래너가 InitPlan으로 1회만 평가한다. 행마다 재평가되지 않는다.
--
-- force row level security는 쓰지 않는다. FORCE는 테이블 소유자에게만
-- 효과가 있고 BYPASSRLS를 가진 롤(Supabase의 postgres)에는 무력하다.
-- 반대로 순정 Postgres로 옮기면 tax_brackets에 INSERT 정책이 없어 연도별
-- 시드 마이그레이션이 실패한다. 실제로 일어나는 사고("새 테이블에 RLS 켜는
-- 것을 잊음")는 tests/rls/catalog.test.ts가 막는다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. RLS 활성화 — 예외 없이 전 테이블
-- ---------------------------------------------------------------------------
alter table public.users                  enable row level security;
alter table public.tax_profiles           enable row level security;
alter table public.assets                 enable row level security;
alter table public.asset_provider_symbols enable row level security;
alter table public.asset_prices           enable row level security;
alter table public.els_products           enable row level security;
alter table public.els_underlyings        enable row level security;
alter table public.redemption_schedules   enable row level security;
alter table public.redemptions            enable row level security;
alter table public.tax_years              enable row level security;
alter table public.tax_brackets           enable row level security;
alter table public.tax_constants          enable row level security;

-- ---------------------------------------------------------------------------
-- 1. 권한을 알려진 상태에서 시작한다
--
-- RLS는 GRANT 위에 얹히는 2차 필터다. 권한이 없으면 정책과 무관하게 42501로
-- 막히고, 권한이 넓으면 정책이 유일한 방어선이 된다. 둘을 함께 명시한다.
--
-- **Supabase의 기본 권한에 기대지 않는다.** 신규 테이블에 어떤 권한이
-- 자동 부여되는지는 CLI·플랫폼 버전에 따라 달라지며, 실제로 이 스택에서는
-- authenticated에 DML이 부여되지 않았다. 암묵적 기본값에 의존하면 정책
-- 파일만 읽어서는 최종 권한을 알 수 없고, 플랫폼이 기본값을 바꾸면 조용히
-- 깨지거나 조용히 열린다. 전부 회수한 뒤 필요한 것만 명시적으로 부여한다.
--
-- anon은 아무것도 받지 않는다 — 공개 가입이 없고(SEC-03) anon 키는 클라이언트
-- 번들에 실리므로(SEC-06) 권한 하나만 열려 있어도 키를 가진 누구나 접근한다.
-- 정책을 to authenticated로만 만들어도 anon은 0행을 볼 뿐이지만, 권한 자체를
-- 회수하면 42501로 시끄럽게 실패하고 실수로 to public 정책이 추가되어도
-- 데이터가 새지 않는다.
--
-- service_role은 RLS를 우회하지만 테이블 권한은 별개다. 시세 배치(§6.2)가
-- 사용자 세션 없이 도는 유일한 경로이므로 전 권한을 부여한다.
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- 2. users — 조회 전체 / 변경 본인 (display_name만)
--
-- 조회를 전체에 여는 근거: DOC-011 §4.2·§4.3·§4.4가 모든 상품·일정 행에
-- ownerName을 요구한다. 소유자 표시명을 읽을 수 없으면 "전체 조회"(S-10)
-- 화면이 성립하지 않는다.
--
-- INSERT·DELETE 정책이 없다. 계정은 초대 경로로만 생기고(SEC-03) 프로필
-- 행은 트리거가 만든다. 트리거는 security definer이므로 이 회수에 영향받지
-- 않는다.
-- ---------------------------------------------------------------------------
grant select on public.users to authenticated;
grant update (display_name) on public.users to authenticated;

create policy users_select_all on public.users
  for select to authenticated
  using (true);

create policy users_update_self on public.users
  for update to authenticated
  using      (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. tax_profiles — 조회·변경 모두 본인만
--
-- 유일하게 조회를 제한하는 테이블이다. 금융소득 외 종합소득 과세표준은
-- ELS와 무관한 개인 소득 정보이므로, 전체 공개 대상인 보유 현황과 성격이
-- 다르다(DOC-010 §7).
--
-- with check가 using과 함께 필요한 이유: 없으면 본인 프로필의 user_id를
-- 타인으로 바꿔 넘길 수 있다.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.tax_profiles to authenticated;

create policy tax_profiles_select_self on public.tax_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy tax_profiles_insert_self on public.tax_profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy tax_profiles_update_self on public.tax_profiles
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy tax_profiles_delete_self on public.tax_profiles
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. els_products — 조회 전체 / 변경 소유자 (S-10, ADR-002)
--
-- INSERT의 with check가 DOC-011 §5.1의 "owner_id는 인증 사용자로 서버에서
-- 설정한다. 입력값으로 받지 않는다"를 DB 수준에서 강제한다.
--
-- UPDATE의 with check가 없으면 소유자가 owner_id를 타인으로 바꿔 상품을
-- 떠넘길 수 있다. 소유권 이전 경로는 계약에 없다(I-09의 정신).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.els_products to authenticated;

create policy els_products_select_all on public.els_products
  for select to authenticated
  using (true);

create policy els_products_insert_own on public.els_products
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy els_products_update_own on public.els_products
  for update to authenticated
  using      (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy els_products_delete_own on public.els_products
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. els_products 하위 — 부모 상품의 소유자를 경유해 판정한다
--
-- 세 가지가 핵심이다.
--
--   (1) INSERT는 with check만 존재한다(using 불가). 삽입되는 행의 els_id가
--       내 상품을 가리켜야 한다.
--   (2) UPDATE의 using과 with check는 서로 다른 행을 본다. using은 기존 행,
--       with check는 변경 후 행이다. 둘 다 걸어야 els_id를 타인 상품으로
--       바꿔치기하는 재부모화를 막는다. 가장 놓치기 쉬운 지점이며, using만
--       있으면 B가 자기 행을 A의 상품 밑으로 옮겨 A의 상품 구성을 변조할 수
--       있다.
--   (3) DELETE는 using만 존재한다.
--
-- exists 서브쿼리는 호출자 권한으로 실행되므로 els_products의 SELECT 정책이
-- 적용된다. 지금은 using(true)이라 부모가 항상 보이지만, els_products의
-- 조회를 좁히는 결정이 생기면 이 정책들이 조용히 무너진다. 그때는
-- security definer 헬퍼 함수로 전환한다.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete
  on public.els_underlyings, public.redemption_schedules, public.redemptions
  to authenticated;

-- 5.1 els_underlyings
create policy els_underlyings_select_all on public.els_underlyings
  for select to authenticated
  using (true);

create policy els_underlyings_insert_owner on public.els_underlyings
  for insert to authenticated
  with check (
    exists (
      select 1 from public.els_products p
      where p.id = els_underlyings.els_id
        and p.owner_id = (select auth.uid())
    )
  );

create policy els_underlyings_update_owner on public.els_underlyings
  for update to authenticated
  using (
    exists (
      select 1 from public.els_products p
      where p.id = els_underlyings.els_id
        and p.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.els_products p
      where p.id = els_underlyings.els_id
        and p.owner_id = (select auth.uid())
    )
  );

create policy els_underlyings_delete_owner on public.els_underlyings
  for delete to authenticated
  using (
    exists (
      select 1 from public.els_products p
      where p.id = els_underlyings.els_id
        and p.owner_id = (select auth.uid())
    )
  );

-- 5.2 redemption_schedules
create policy redemption_schedules_select_all on public.redemption_schedules
  for select to authenticated
  using (true);

create policy redemption_schedules_insert_owner on public.redemption_schedules
  for insert to authenticated
  with check (
    exists (
      select 1 from public.els_products p
      where p.id = redemption_schedules.els_id
        and p.owner_id = (select auth.uid())
    )
  );

create policy redemption_schedules_update_owner on public.redemption_schedules
  for update to authenticated
  using (
    exists (
      select 1 from public.els_products p
      where p.id = redemption_schedules.els_id
        and p.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.els_products p
      where p.id = redemption_schedules.els_id
        and p.owner_id = (select auth.uid())
    )
  );

create policy redemption_schedules_delete_owner on public.redemption_schedules
  for delete to authenticated
  using (
    exists (
      select 1 from public.els_products p
      where p.id = redemption_schedules.els_id
        and p.owner_id = (select auth.uid())
    )
  );

-- 5.3 redemptions — 조회 전체 / 변경 상품 소유자 (DOC-010 §7)
create policy redemptions_select_all on public.redemptions
  for select to authenticated
  using (true);

create policy redemptions_insert_owner on public.redemptions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.els_products p
      where p.id = redemptions.els_id
        and p.owner_id = (select auth.uid())
    )
  );

create policy redemptions_update_owner on public.redemptions
  for update to authenticated
  using (
    exists (
      select 1 from public.els_products p
      where p.id = redemptions.els_id
        and p.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.els_products p
      where p.id = redemptions.els_id
        and p.owner_id = (select auth.uid())
    )
  );

create policy redemptions_delete_owner on public.redemptions
  for delete to authenticated
  using (
    exists (
      select 1 from public.els_products p
      where p.id = redemptions.els_id
        and p.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 6. assets · asset_prices — 공용 데이터. 조회·등록·수정은 전체 (DOC-010 §7)
--
-- DOC-011 §5.7 saveManualPrice, §5.10 createAsset이 모두 "인증 사용자 전체"다.
--
-- 삭제는 열지 않는다. 계약에 삭제 함수가 없고, 한 사용자가 시세를 지우면
-- 그 자산을 쓰는 타인 상품의 조건 판정이 함께 깨진다. 공용 데이터의 삭제는
-- 공용 피해를 낳는다.
-- ---------------------------------------------------------------------------
-- delete를 부여하지 않는 것이 곧 삭제 차단이다. 정책도 두지 않아 두 겹이 된다.
grant select, insert, update on public.assets       to authenticated;
grant select, insert, update on public.asset_prices to authenticated;

create policy assets_select_all on public.assets
  for select to authenticated using (true);
create policy assets_insert_all on public.assets
  for insert to authenticated with check (true);
create policy assets_update_all on public.assets
  for update to authenticated using (true) with check (true);

create policy asset_prices_select_all on public.asset_prices
  for select to authenticated using (true);
create policy asset_prices_insert_all on public.asset_prices
  for insert to authenticated with check (true);
create policy asset_prices_update_all on public.asset_prices
  for update to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 7. asset_provider_symbols — 조회 전체 / 변경 없음
--
-- DOC-011 §4.9 AssetOption.hasPriceProvider가 조회를 요구한다. 변경은
-- 마이그레이션과 수집 배치(service_role) 전용이다 — 도메인 코드는 공급자
-- 심볼을 알지 못하고(ADR-004), 사용자가 매핑을 편집할 화면도 없다.
-- ---------------------------------------------------------------------------
grant select on public.asset_provider_symbols to authenticated;

create policy asset_provider_symbols_select_all on public.asset_provider_symbols
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 8. 참조 데이터 — 조회 전체 / 변경 없음 (마이그레이션 전용, ADR-005)
--
-- "변경 없음"을 두 겹으로 표현한다.
--   (a) SELECT 정책만 만든다 → 나머지 명령은 RLS 기본 거부
--   (b) SELECT 권한만 부여한다 → 42501 permission denied로 시끄럽게 실패
--
-- (b)가 없으면 UPDATE·DELETE가 오류 없이 0행으로 끝나 애플리케이션 버그가
-- 은폐된다. 세율을 바꾸려는 코드가 조용히 아무 일도 하지 않는 것보다 즉시
-- 실패하는 편이 낫다.
--
-- 시드는 postgres(BYPASSRLS)로 실행되는 마이그레이션이 넣는다. 정책도 권한도
-- 관여하지 않는다.
-- ---------------------------------------------------------------------------
grant select
  on public.tax_years, public.tax_brackets, public.tax_constants
  to authenticated;

create policy tax_years_select_all on public.tax_years
  for select to authenticated using (true);
create policy tax_brackets_select_all on public.tax_brackets
  for select to authenticated using (true);
create policy tax_constants_select_all on public.tax_constants
  for select to authenticated using (true);
