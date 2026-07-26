-- ============================================================================
-- 스키마 — DOC-002 §4 엔티티 정의, §8 무결성 규칙
--
-- DOC-002의 DECIMAL(p,s)는 PostgreSQL의 numeric(p,s)와 같은 타입이다(M-03).
-- pg_dump·supabase db diff가 numeric으로 출력하므로 표기를 맞춘다.
--
-- 비율은 소수로 정규화하여 저장한다 — 90%는 0.9000이다(M-04). scale 4가
-- 그 표기를 담는다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ENUM — DOC-005 §2. 값은 UPPER_SNAKE
--
-- 타입명은 단수다. 값의 도메인을 가리키므로 복수형 규칙(테이블명)이
-- 적용되지 않는다.
-- ---------------------------------------------------------------------------
create type public.health_insurance_type as enum ('EMPLOYEE', 'REGIONAL', 'DEPENDENT', 'NONE');
create type public.asset_type            as enum ('STOCK', 'INDEX', 'ETF');
create type public.price_source          as enum ('AUTO', 'MANUAL');
create type public.ki_observation        as enum ('CONTINUOUS', 'CLOSING');
create type public.account_type          as enum ('GENERAL', 'TAX_FREE');
create type public.redemption_type       as enum ('EARLY', 'LIZARD', 'MATURITY_GAIN', 'MATURITY_LOSS');

-- ---------------------------------------------------------------------------
-- updated_at 유지
--
-- DOC-002 §4는 컬럼만 정의하고 갱신 수단을 정하지 않는다(§1이 물리 수준
-- 상세를 DOC-006으로 미룬다). 애플리케이션이 매번 now()를 실어 보내는 대신
-- 트리거로 강제해 누락 경로를 없앤다.
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4.1 users — 사용자
--
-- id는 auth.users.id와 같은 값이다(DOC-002 D-06). 대리키를 따로 두면
-- owner_id = auth.uid() 비교마다 조인이 붙고, ADR-002의 RLS 정책 예시가
-- 성립하지 않는다.
--
-- 행 생성은 auth.users 트리거만 담당한다(SEC-03). 20260726171034 참조.
-- ---------------------------------------------------------------------------
create table public.users (
  id           uuid         primary key references auth.users (id) on delete cascade,
  email        varchar(255) not null unique,
  display_name varchar(50)  not null,
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now()
);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4.2 tax_profiles — 연도별 과세 기초정보
-- ---------------------------------------------------------------------------
create table public.tax_profiles (
  id                     uuid          primary key default gen_random_uuid(),
  user_id                uuid          not null references public.users (id) on delete cascade,
  tax_year               smallint      not null,
  other_income_base      numeric(15,0) not null default 0,
  other_financial_income numeric(15,0) not null default 0,
  health_insurance_type  public.health_insurance_type not null,

  -- I-06 — 사용자·연도당 과세 프로필은 1건
  constraint tax_profiles_user_id_tax_year_key unique (user_id, tax_year)
);

-- ---------------------------------------------------------------------------
-- 4.3 assets — 기초자산
--
-- UNIQUE(name, market)에 nulls not distinct를 붙이는 이유: market이
-- nullable인데 기본 semantics에서 NULL은 서로 같지 않다. 그대로 두면
-- ('S&P 500', NULL)이 두 번 저장되어 한 자산이 두 개의 asset_id와 두 개의
-- 독립된 시세 계열로 갈라지고, §4.3이 말하는 "동일 기초자산 중복 해소"가
-- 시장 정보 없는 자산에 대해서만 조용히 깨진다.
-- ---------------------------------------------------------------------------
create table public.assets (
  id         uuid         primary key default gen_random_uuid(),
  name       varchar(100) not null,
  asset_type public.asset_type not null,
  market     varchar(20),
  currency   char(3)      not null,
  created_at timestamptz  not null default now(),

  constraint assets_name_market_key unique nulls not distinct (name, market)
);

-- ---------------------------------------------------------------------------
-- 4.4 asset_provider_symbols — 공급자 심볼 매핑 (M-07, D-05)
-- ---------------------------------------------------------------------------
create table public.asset_provider_symbols (
  id              uuid        primary key default gen_random_uuid(),
  asset_id        uuid        not null references public.assets (id) on delete cascade,
  provider        varchar(30) not null,
  provider_symbol varchar(50) not null,

  constraint asset_provider_symbols_asset_id_provider_key unique (asset_id, provider)
);

-- ---------------------------------------------------------------------------
-- 4.5 asset_prices — 시세 이력
--
-- 최신가는 as_of_date가 가장 큰 행이다(DOC-007 §3.1). UNIQUE 인덱스가
-- distinct on (asset_id) ... order by asset_id, as_of_date desc를 그대로
-- 지원하므로 별도 인덱스를 두지 않는다.
-- ---------------------------------------------------------------------------
create table public.asset_prices (
  id         uuid          primary key default gen_random_uuid(),
  asset_id   uuid          not null references public.assets (id) on delete cascade,
  as_of_date date          not null,
  price      numeric(18,6) not null,
  source     public.price_source not null,
  provider   varchar(30),
  created_at timestamptz   not null default now(),

  -- I-05 — 자산·일자당 시세는 1건. 배치 중복 실행을 UPSERT로 흡수하는 근거
  constraint asset_prices_asset_id_as_of_date_key unique (asset_id, as_of_date)
);

-- ---------------------------------------------------------------------------
-- 4.6 els_products — ELS 상품
--
-- ★ status 컬럼을 만들지 않는다 (D-01, CLAUDE.md 절대 규칙 #4).
--   상태는 redemptions 레코드의 존재로만 유도한다.
-- ---------------------------------------------------------------------------
create table public.els_products (
  id                       uuid          primary key default gen_random_uuid(),
  owner_id                 uuid          not null references public.users (id) on delete restrict,
  name                     varchar(200)  not null,
  issuer                   varchar(50),
  issue_date               date          not null,
  principal                numeric(15,0) not null,
  evaluation_period_months smallint      not null default 6,
  total_rounds             smallint      not null,
  annual_coupon_rate       numeric(6,4)  not null,
  ki_barrier               numeric(6,4),
  ki_observation           public.ki_observation,
  ki_touched_at            date,
  account_type             public.account_type not null,
  note                     text,
  created_at               timestamptz   not null default now(),
  updated_at               timestamptz   not null default now()
);

comment on table public.els_products is
  'D-01: status 컬럼을 두지 않는다. 상태는 redemptions 레코드의 존재로 유도한다 — 보유중은 레코드 없음, 상환완료는 레코드 있음. UNIQUE(redemptions.els_id)가 이중 상환·이중 집계를 스키마 수준에서 불가능하게 한다(K-04).';

create trigger els_products_set_updated_at
  before update on public.els_products
  for each row execute function public.set_updated_at();

-- 소유자별 조회가 이 시스템의 기본 접근 경로다(D-02, 집계 키는 (owner_id, 연도)).
-- users 삭제 시 RESTRICT 검사도 이 인덱스를 쓴다.
create index els_products_owner_id_idx on public.els_products (owner_id);

-- ---------------------------------------------------------------------------
-- 4.7 els_underlyings — 기초자산 구성 (M-01)
-- ---------------------------------------------------------------------------
create table public.els_underlyings (
  id         uuid          primary key default gen_random_uuid(),
  els_id     uuid          not null references public.els_products (id) on delete cascade,
  asset_id   uuid          not null references public.assets (id) on delete restrict,
  base_price numeric(18,6) not null,
  sequence   smallint      not null,

  -- I-02 — 상품당 기초자산 중복 불가
  constraint els_underlyings_els_id_asset_id_key unique (els_id, asset_id)
);

-- 하위 테이블의 RLS 정책이 부모를 매 행 조회하고, 상품 삭제 시 CASCADE가
-- 이 열로 대상 행을 찾는다. UNIQUE(els_id, asset_id)의 선행 열이 els_id이므로
-- els_id 단독 인덱스는 따로 만들지 않는다.
create index els_underlyings_asset_id_idx on public.els_underlyings (asset_id);

-- ---------------------------------------------------------------------------
-- 4.8 redemption_schedules — 차수별 평가 조건
-- ---------------------------------------------------------------------------
create table public.redemption_schedules (
  id                    uuid         primary key default gen_random_uuid(),
  els_id                uuid         not null references public.els_products (id) on delete cascade,
  round_no              smallint     not null,
  evaluation_date       date         not null,
  barrier               numeric(6,4) not null,
  lizard_barrier        numeric(6,4),
  lizard_coupon_rate    numeric(6,4),
  lizard_requires_no_ki boolean,

  -- I-03 — 상품당 차수 번호 중복 불가
  constraint redemption_schedules_els_id_round_no_key unique (els_id, round_no),

  -- I-04 — 리자드 배리어는 해당 차수 조기상환 배리어 이하
  constraint redemption_schedules_lizard_barrier_check
    check (lizard_barrier is null or lizard_barrier <= barrier),

  -- I-10 — 리자드 배리어가 있으면 리자드 쿠폰율은 필수
  constraint redemption_schedules_lizard_coupon_check
    check (lizard_barrier is null or lizard_coupon_rate is not null)
);

comment on constraint redemption_schedules_lizard_coupon_check on public.redemption_schedules is
  'I-10: 리자드 배리어만 있고 쿠폰율이 없으면 해당 차수의 워스트오브가 리자드 배리어를 넘는 순간 지급액을 산출할 수 없다. 원금상환형 리자드는 0으로 표기하며 NULL로 표기하지 않는다(DOC-007 §4.1).';

-- 일정 화면(SCR-301)과 홈(SCR-101)이 전 상품을 대상으로 기간 조회를 한다.
-- els_id 접두가 없는 유일한 반복 조회다.
create index redemption_schedules_evaluation_date_idx
  on public.redemption_schedules (evaluation_date);

-- ---------------------------------------------------------------------------
-- 4.9 redemptions — 상환 실적
--
-- els_id의 FK가 RESTRICT인 것이 핵심이다(DOC-002 §8.1). 상환 실적은
-- 증권사가 확정한 외부 값이고 시스템이 유도할 수 없으므로(A-04), 상품
-- 삭제가 이를 연쇄 삭제하면 해당 귀속연도의 세액이 조용히 바뀐다.
-- 상환을 먼저 취소해야 상품이 지워진다(DOC-011 §5.3).
-- ---------------------------------------------------------------------------
create table public.redemptions (
  id              uuid          primary key default gen_random_uuid(),
  els_id          uuid          not null references public.els_products (id) on delete restrict,
  redemption_type public.redemption_type not null,
  round_no        smallint,
  redemption_date date          not null,
  gross_amount    numeric(15,0) not null,
  taxable_income  numeric(15,0) not null,
  withholding_tax numeric(15,0),
  is_confirmed    boolean       not null,
  note            text,

  -- I-01 — 상품당 상환 레코드는 최대 1건
  constraint redemptions_els_id_key unique (els_id)
);

comment on constraint redemptions_els_id_key on public.redemptions is
  'I-01/D-01: 상품당 상환 1건. 한 상품이 동시에 두 상태일 수 없고 두 번 상환될 수도 없다. 이중 집계가 애플리케이션 로직이 아니라 스키마 수준에서 불가능하다(K-04).';

-- ---------------------------------------------------------------------------
-- 4.10 세율·요율 설정 — M-05, ADR-005
--
-- 애플리케이션은 읽기만 한다. 값은 연도별 마이그레이션이 넣으며 기존 연도
-- 행은 수정하지 않는다. 과거 연도 계산의 재현성이 회귀 테스트(K-08)의
-- 전제다.
-- ---------------------------------------------------------------------------
create table public.tax_years (
  tax_year smallint primary key,
  note     text
);

create table public.tax_brackets (
  tax_year              smallint      not null references public.tax_years (tax_year) on delete restrict,
  lower_bound           numeric(15,0) not null,
  rate                  numeric(6,4)  not null,
  progressive_deduction numeric(15,0) not null,

  primary key (tax_year, lower_bound)
);

create table public.tax_constants (
  tax_year smallint      not null references public.tax_years (tax_year) on delete restrict,
  key      varchar(50)   not null,
  value    numeric(18,6) not null,

  primary key (tax_year, key)
);

comment on table public.tax_constants is
  'ADR-005/M-05: 마이그레이션 전용. 키 목록은 DOC-002 §4.10이 정본이며 DOC-007 §2의 주입 상수와 1:1 대응한다. value는 비율(0.154)과 금액(20000000)을 함께 담으므로 numeric(18,6)이다.';
