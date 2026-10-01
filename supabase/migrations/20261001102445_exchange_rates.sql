-- ============================================================================
-- M-a3 — 환율 (DOC-002 v1.10 §4.12 · I-22 · DQ-13 · DOC-010 §7 · P8 컷 a3 · 배포 웨이브 W2)
--
-- 추정용 환율의 관측 이력이다. **공용 관측 데이터**이고 `asset_prices`와 같은 부류다 — 소유자 열도 FK도
-- 없고, 한 사용자가 넣은 환율을 모두가 읽고 고칠 수 있으며, **지울 수 없다**(이력이다).
--
-- ★ 세금을 움직이는 첫 «공용» 입력이다(DOC-010 AQ-76) — 달러 상품의 추정 과세 금융소득이 이 값을
--   곱한다. 그래서 무효화 축(`EXCHANGE_RATE_WIDE`)에 세금 조회가 «있다». 확정 원화 과세(거래내역)는
--   이 테이블과 무관하다(U1) — `redemptions.exchange_rate`(적용 환율)는 이 테이블을 참조하지 않는다.
--
-- ★ 식별자에 `fx_*`를 쓰지 않는다 — 테스트에서 `FX_NAME_PREFIX`는 「fixture」를 뜻한다(DOC-002 §4.12).
-- ★ 기본 환율을 두지 않는다 — 행이 없으면 추정하지 않고 센다(DOC-007 E-09).
-- ============================================================================

create table public.exchange_rates (
  id         uuid                   primary key default gen_random_uuid(),
  -- 지원 외화. 상품 통화 enum을 재사용한다 — 원화는 환율의 대상이 아니다(아래 CHECK)
  currency   public.product_currency not null,
  -- 원천이 준 날짜다 — 수집일로 옮기지 않는다(ADR-010 분기 A′)
  as_of_date date                   not null,
  -- 1단위 외화당 원. 시세와 같은 numeric(18,6)이다(DOC-011 Q-07 — 형식 부류 PRICE)
  rate       numeric(18,6)          not null,
  source     public.price_source    not null,
  -- 자동 수집일 때만. 수동 입력(§5.13)은 null을 명시해 싣는다
  provider   varchar(30),
  created_at timestamptz            not null default now(),

  -- I-22 — 통화·일자당 1건. UPSERT의 근거이며 「기준일 이전 최신 1건」 조회를 이 색인이 받친다
  constraint exchange_rates_currency_as_of_date_key unique (currency, as_of_date),
  -- 원화 환율은 1이다 — 행으로 두지 않는다. 두면 「x = 1을 곱한다」가 원화 경로에 생긴다(DOC-007 §4.8)
  constraint exchange_rates_currency_check check (currency <> 'KRW'),
  constraint exchange_rates_rate_check check (rate > 0),
  -- 출처와 공급자가 함께 있거나 함께 없다 — 수동 행에 공급자가 남으면 「자동」으로 읽힌다
  constraint exchange_rates_provider_check check ((source = 'AUTO') = (provider is not null))
);

comment on table public.exchange_rates is
  'DOC-002 §4.12 · I-22 — 추정용 환율의 공용 관측 이력. 소유자·FK 없음. 지울 수 없다(DELETE 권한·정책 없음).';

-- ---------------------------------------------------------------------------
-- I-22 — 관측 좌표(currency · as_of_date) 동결. I-16(`freeze_asset_price_coordinates`)과 같은 형태다
--
-- 동일값 재대입은 통과한다 — supabase-js `.upsert()`가 payload 전역을 SET에 실어도 동작한다(§5.13).
-- 관측값(rate · source · provider)의 정정은 공용 데이터 원칙대로 열려 있다.
-- 거부 시 제약 이름을 constraint(pg 경로)와 detail 첫 줄(PostgREST 경로) 양쪽에 싣는다.
-- ---------------------------------------------------------------------------
create function public.freeze_exchange_rate_coordinates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.currency   is distinct from old.currency
  or new.as_of_date is distinct from old.as_of_date then
    raise exception
      '환율 관측의 좌표(currency·as_of_date)는 변경할 수 없다. 좌표가 다른 환율은 정정이 아니라 새 관측이므로 UPSERT로 새 행을 넣는다 — DOC-002 I-22.'
      using errcode    = '23514',
            constraint = 'exchange_rates_coordinates_immutable',
            detail     = 'constraint=exchange_rates_coordinates_immutable',
            table      = 'exchange_rates';
  end if;
  return new;
end;
$$;

create trigger exchange_rates_freeze_coordinates
  before update on public.exchange_rates
  for each row execute function public.freeze_exchange_rate_coordinates();

comment on trigger exchange_rates_freeze_coordinates on public.exchange_rates is
  'I-22: 관측 좌표(currency·as_of_date)를 동결한다. 동일값 재대입은 통과(UPSERT 보존). created_at·id는 좌표가 아니다.';

-- 함수 실행 권한 — 세 롤에서 명시 회수한다. 운영의 기본 권한이 로컬과 달랐다(DOC-010 AQ-90) — `from public`
-- 만으로는 운영에서 열린 채 태어난다(20260930105317이 기본 권한을 고쳤지만 이중으로 막는다)
revoke execute on function public.freeze_exchange_rate_coordinates()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS · 권한 — 회수 후 명시 부여 (CLAUDE.md 절대 규칙 6 · DOC-010 §7)
--
-- RLS는 GRANT 위에 얹히는 필터다. 새 테이블은 기본 권한 회수(20260726193115 · 20260729155440)로 권한
-- 없이 태어나는 것이 로컬의 전제지만, 운영의 기본 권한이 로컬과 같은지는 테이블에 대해 실측된 적이 없다
-- (AQ-90은 함수만 쟀다) — 그래서 먼저 전부 회수하고 SELECT · INSERT · UPDATE만 `authenticated`에 준다.
-- **DELETE는 GRANT도 정책도 두지 않는다(두 겹).** `service_role`에는 주지 않는다(0 DML 유지 — 자동 수집기는
-- 컷 c2의 결정이다).
-- ---------------------------------------------------------------------------
alter table public.exchange_rates enable row level security;

revoke all on public.exchange_rates from public, anon, authenticated, service_role;
grant select, insert, update on public.exchange_rates to authenticated;

create policy exchange_rates_select_all on public.exchange_rates
  for select to authenticated using (true);
create policy exchange_rates_insert_all on public.exchange_rates
  for insert to authenticated with check (true);
create policy exchange_rates_update_all on public.exchange_rates
  for update to authenticated using (true) with check (true);
