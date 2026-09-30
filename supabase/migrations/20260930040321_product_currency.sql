-- ============================================================================
-- 상품 통화 — P8 컷 a2 (W1, expand). DOC-002 v1.10 §4.6 · §4.9 · §8 I-21 · D-08 · M-08
--
-- ★ 이 파일은 expand 절반이다.
--
--   currency 의 default 'KRW' 와 쓰기 함수의 coalesce 는 **배포 틈을 받치는 임시 장치**다.
--   db push 와 코드 배포 사이에 도는 구 코드는 payload 에 currency 를 보내지 않는다 —
--   직접 INSERT 는 열 default 가, RPC 경유 쓰기는 coalesce 가 그 빈 값을 받친다(RPC 는
--   열 목록을 명시하므로 NULL 이 default 를 건너뛴다). **둘 다 컷 a3 의 M-a2c(W2)가
--   제거한다** — 남겨 두면 달러 상품이 통화 없이 저장될 때 조용히 원화가 되어 모든 금액이
--   약 1,400배 틀린다(DOC-002 §4.6). DOC-013 §10.2.1.
--
-- ★ 금액 열의 정밀도를 «뗀다» — numeric(17,2) 로 넓히지 않는다.
--
--   numeric(15,0) → numeric 은 테이블을 다시 쓰지 않고 기존 값의 scale 을 보존하므로
--   principal::text 가 그대로 '100000000' 이다. numeric(17,2) 로 넓히면 배포 중인 구 코드가
--   '100000000.00' 을 읽어 V-01(정수)과 형식 단언이 깨진다. 자릿수는 아래 이름 있는
--   제약이 강제한다 — 초과 소수는 반올림되지 않고 **거부된다**(AQ-16 을 이 두 열에서 닫는다).
--
-- ★ 과세 축(taxable_income · withholding_tax)은 건드리지 않는다.
--
--   달러 상품이어도 거래내역의 원화 값이다(DOC-002 M-08 · D-08). numeric(15,0) 유지.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 상품 통화
-- ---------------------------------------------------------------------------
create type public.product_currency as enum ('KRW', 'USD');

comment on type public.product_currency is
  'DOC-005 「상품 통화」. 투자원금·실수령액·월수익의 통화 — 기초자산 통화(assets.currency)와 독립이다(DOC-005 §8.11). enum 인 이유: 생성 타입이 합집합이 되어 Record<ProductCurrency, …> 가 값 추가 시 컴파일되지 않는다(규칙 6).';

-- expand: default 는 W2(M-a2c)에서 뗀다 — 위 머리 주석
alter table public.els_products
  add column currency public.product_currency not null default 'KRW';

comment on column public.els_products.currency is
  'DOC-002 §4.6. 상품 통화. principal·redemptions.gross_amount 의 단위다. 과세 축은 통화와 무관하게 원화다(M-08). 기본값은 확장 웨이브(W1) 동안만 있고 W2 에서 제거된다.';

-- ---------------------------------------------------------------------------
-- 금액 열 정밀도 해제 + 자릿수 제약 (I-21)
-- ---------------------------------------------------------------------------
alter table public.els_products
  alter column principal type numeric;

alter table public.redemptions
  alter column gross_amount type numeric;

-- fail-closed — enum 에 새 값이 생기면 case 가 NULL 이 되고 coalesce(-1) 이 모든 행을 거부한다.
-- CHECK 는 NULL 을 통과시키므로 coalesce 없이 쓰면 새 통화의 금액이 자릿수 제한 없이 들어온다.
alter table public.els_products
  add constraint els_products_principal_scale_check check (
    scale(principal) <= coalesce(case currency when 'KRW' then 0 when 'USD' then 2 end, -1)
    and principal < 1000000000000000
  );

-- 통화와 무관한 절반 — 복원(data-only, replica)에서도 재검사된다(DOC-002 §4.9, DOC-010 AQ-80)
alter table public.redemptions
  add constraint redemptions_gross_amount_digits_check check (
    gross_amount < 1000000000000000 and scale(gross_amount) <= 2
  );

-- 적용 환율 — 참고값이며 어떤 계산에도 쓰지 않는다(DOC-005 §4). 원화 상품 금지는 계약 계층(V-24)
alter table public.redemptions
  add column exchange_rate numeric(18,6);

alter table public.redemptions
  add constraint redemptions_exchange_rate_check check (exchange_rate is null or exchange_rate > 0);

comment on column public.redemptions.exchange_rate is
  'DOC-002 §4.9 · DOC-005 「적용 환율」. 거래내역의 지급일 환율(원/달러). 참고값 — 과세 금융소득·원천징수세액은 거래내역의 원화 값이 정본이다(A-04).';

-- ---------------------------------------------------------------------------
-- 통화에 딸린 절반 — 원화 부모 아래의 센트를 거부한다 (I-21)
--
-- ★ CHECK 로 쓸 수 없는 이유: 기준이 부모 행(els_products.currency)에 있다.
-- ★ 라벨은 테이블마다 리터럴로 쓴다 — constraint-names 단언이 마이그레이션 문자열을 찾는다.
--   컷 b2 가 이 함수를 monthly_coupon_payments 에 재사용할 때 TG_TABLE_NAME 으로 라벨을
--   조립하지 않고 분기한다(DOC-002 §4.9).
-- ★ 복원(data-only)은 트리거를 끄므로 이 절반은 재검증되지 않는다(DOC-010 AQ-80).
-- ---------------------------------------------------------------------------
create function public.check_amount_scale_by_currency()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_currency public.product_currency;
  v_max_scale integer;
begin
  select p.currency into v_currency from public.els_products p where p.id = new.els_id;

  -- 부모가 없으면 FK 가 거부한다. 알 수 없는 통화는 거부한다(fail-closed).
  v_max_scale := case v_currency when 'KRW' then 0 when 'USD' then 2 end;

  -- 책임을 CHECK와 가른다: 전역 한도(소수 2자리 초과 · 정수부 15자리)는
  -- redemptions_gross_amount_digits_check가 보고하게 둔다. ★ BEFORE 행 트리거는 CHECK보다
  -- **먼저** 돈다(실측, P8 a2) — 여기서 scale > 2까지 거부하면 그 값은 CHECK에 닿기 전에 이
  -- 라벨로 보고되어, 복원에서도 재검사되는 CHECK의 몫을 트리거가 가로챈다
  if v_max_scale is null
     or (scale(new.gross_amount) > v_max_scale and scale(new.gross_amount) <= 2) then
    raise exception
      '실수령액의 소수 자릿수가 상품 통화의 보조단위를 넘는다 — 원화 0자리 · 달러 2자리 (DOC-002 I-21).'
      using errcode    = '23514',
            constraint = 'redemptions_gross_amount_scale',
            detail     = 'constraint=redemptions_gross_amount_scale',
            table      = 'redemptions';
  end if;

  return new;
end;
$$;

comment on function public.check_amount_scale_by_currency() is
  'I-21 의 통화에 딸린 절반: 부모 상품의 통화가 원화면 실수령액은 0자리, 달러면 2자리 이내. 통화와 무관한 절반(정수부 15자리 · 2자리)은 redemptions_gross_amount_digits_check 가 맡는다 — 그쪽은 복원에서도 재검사된다.';

create trigger redemptions_check_amount_scale
  before insert or update on public.redemptions
  for each row execute function public.check_amount_scale_by_currency();

comment on trigger redemptions_check_amount_scale on public.redemptions is
  'I-21. UPDATE 도 본다 — updateRedemption(§5.5)이 금액을 고친다.';

-- ---------------------------------------------------------------------------
-- 쓰기 함수 셋 — currency · exchangeRate 를 읽는다 (create or replace, 서명 불변 → ACL 유지)
--
-- ★ 본문은 종전과 같고 추가된 것은 currency(·exchangeRate) 열뿐이다.
-- ★ security invoker · search_path 를 다시 적는다 — create or replace 는 그 절을 되살리지
--   않는다(tests/rls/functions.test.ts 가 proconfig 를 단언한다).
-- ---------------------------------------------------------------------------
create or replace function public.create_els_product(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.els_products (
    owner_id, name, issuer, issue_date, principal, currency, evaluation_period_months,
    annual_coupon_rate, ki_barrier, ki_observation, account_type, note
  ) values (
    -- 입력값으로 받지 않는다 (§5.1)
    (select auth.uid()),
    payload->>'name',
    payload->>'issuer',
    (payload->>'issueDate')::date,
    (payload->>'principal')::numeric,
    -- expand(W1) 동안만 — W2(M-a2c)에서 coalesce 를 뗀다
    coalesce(payload->>'currency', 'KRW')::public.product_currency,
    (payload->>'evaluationPeriodMonths')::smallint,
    (payload->>'annualCouponRate')::numeric,
    (payload->>'kiBarrier')::numeric,
    (payload->>'kiObservation')::public.ki_observation,
    (payload->>'accountType')::public.account_type,
    payload->>'note'
  )
  returning id into v_id;

  insert into public.els_underlyings (els_id, asset_id, base_price, sequence)
  select v_id,
         (item->>'assetId')::uuid,
         (item->>'basePrice')::numeric,
         (item->>'sequence')::smallint
    from jsonb_array_elements(payload->'underlyings') as item;

  insert into public.redemption_schedules (
    els_id, round_no, evaluation_date, barrier,
    lizard_barrier, lizard_coupon_rate, lizard_requires_no_ki
  )
  select v_id,
         (item->>'roundNo')::smallint,
         (item->>'evaluationDate')::date,
         (item->>'barrier')::numeric,
         (item->>'lizardBarrier')::numeric,
         (item->>'lizardCouponRate')::numeric,
         (item->>'lizardRequiresNoKi')::boolean
    from jsonb_array_elements(payload->'schedules') as item;

  -- I-07 — 여기서 되돌리면 0건 상태가 커밋되지 않는다
  if not exists (select 1 from public.els_underlyings where els_id = v_id) then
    raise exception '상품은 최소 1개의 기초자산을 가진다 (DOC-002 I-07).'
      using errcode    = '23514',
            constraint = 'els_products_underlyings_required',
            detail     = 'constraint=els_products_underlyings_required',
            table      = 'els_products';
  end if;

  if not exists (select 1 from public.redemption_schedules where els_id = v_id) then
    raise exception '상품은 최소 1개의 평가 차수를 가진다 (DOC-002 I-07).'
      using errcode    = '23514',
            constraint = 'els_products_schedules_required',
            detail     = 'constraint=els_products_schedules_required',
            table      = 'els_products';
  end if;

  return v_id;
end;
$$;

create or replace function public.update_els_product(p_id uuid, payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- 상태 충돌 — 이름이 계약 계층에서 23514를 CONFLICT로 올린다(DOC-002 §8 명명 규약)
  if exists (select 1 from public.redemptions r where r.els_id = p_id) then
    raise exception '상환 처리된 상품은 수정할 수 없다. 상환을 먼저 취소한다 (DOC-011 §5.2).'
      using errcode    = '23514',
            constraint = 'els_products_redeemed_immutable',
            detail     = 'constraint=els_products_redeemed_immutable',
            table      = 'els_products';
  end if;

  update public.els_products set
    name                     = payload->>'name',
    issuer                   = payload->>'issuer',
    issue_date               = (payload->>'issueDate')::date,
    principal                = (payload->>'principal')::numeric,
    -- expand(W1) 동안만 — 구 코드는 currency 를 보내지 않으므로 «저장값»으로 받친다('KRW' 가 아니다:
    -- 달러 상품을 구 코드가 고치면 원화로 뒤집힌다). W2(M-a2c)에서 coalesce 를 뗀다
    currency                 = coalesce((payload->>'currency')::public.product_currency, currency),
    evaluation_period_months = (payload->>'evaluationPeriodMonths')::smallint,
    annual_coupon_rate       = (payload->>'annualCouponRate')::numeric,
    ki_barrier               = (payload->>'kiBarrier')::numeric,
    ki_observation           = (payload->>'kiObservation')::public.ki_observation,
    account_type             = (payload->>'accountType')::public.account_type,
    note                     = payload->>'note',
    -- 낙인형 해제 시 터치 이력도 함께 비운다 (V-18, I-15)
    ki_touched_at            = case
                                 when (payload->>'kiBarrier') is null then null
                                 else ki_touched_at
                               end
  where id = p_id
  returning id into v_id;

  -- 영향 행 0 — 계약 계층이 사전 조회로 NOT_FOUND·FORBIDDEN을 가른다
  if v_id is null then
    return null;
  end if;

  delete from public.els_underlyings      where els_id = p_id;
  delete from public.redemption_schedules where els_id = p_id;

  insert into public.els_underlyings (els_id, asset_id, base_price, sequence)
  select p_id,
         (item->>'assetId')::uuid,
         (item->>'basePrice')::numeric,
         (item->>'sequence')::smallint
    from jsonb_array_elements(payload->'underlyings') as item;

  insert into public.redemption_schedules (
    els_id, round_no, evaluation_date, barrier,
    lizard_barrier, lizard_coupon_rate, lizard_requires_no_ki
  )
  select p_id,
         (item->>'roundNo')::smallint,
         (item->>'evaluationDate')::date,
         (item->>'barrier')::numeric,
         (item->>'lizardBarrier')::numeric,
         (item->>'lizardCouponRate')::numeric,
         (item->>'lizardRequiresNoKi')::boolean
    from jsonb_array_elements(payload->'schedules') as item;

  if not exists (select 1 from public.els_underlyings where els_id = p_id) then
    raise exception '상품은 최소 1개의 기초자산을 가진다 (DOC-002 I-07).'
      using errcode    = '23514',
            constraint = 'els_products_underlyings_required',
            detail     = 'constraint=els_products_underlyings_required',
            table      = 'els_products';
  end if;

  if not exists (select 1 from public.redemption_schedules where els_id = p_id) then
    raise exception '상품은 최소 1개의 평가 차수를 가진다 (DOC-002 I-07).'
      using errcode    = '23514',
            constraint = 'els_products_schedules_required',
            detail     = 'constraint=els_products_schedules_required',
            table      = 'els_products';
  end if;

  return v_id;
end;
$$;

create or replace function public.create_realized_els_product(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.els_products (
    owner_id, name, issuer, principal, currency, account_type, note, entry_mode
  ) values (
    -- 입력값으로 받지 않는다 (§5.11)
    (select auth.uid()),
    payload->>'name',
    payload->>'issuer',
    (payload->>'principal')::numeric,
    -- expand(W1) 동안만 — W2(M-a2c)에서 coalesce 를 뗀다
    coalesce(payload->>'currency', 'KRW')::public.product_currency,
    (payload->>'accountType')::public.account_type,
    payload->>'note',
    'REALIZED_ONLY'
  )
  returning id into v_id;

  insert into public.redemptions (
    els_id, redemption_type, round_no, redemption_date,
    gross_amount, taxable_income, withholding_tax, exchange_rate, is_confirmed, note
  ) values (
    v_id,
    (payload->>'redemptionType')::public.redemption_type,
    -- 항상 NULL 이다 — 일정 행이 0건이다(D-07)
    null,
    (payload->>'redemptionDate')::date,
    (payload->>'grossAmount')::numeric,
    (payload->>'taxableIncome')::numeric,
    (payload->>'withholdingTax')::numeric,
    (payload->>'exchangeRate')::numeric,
    (payload->>'isConfirmed')::boolean,
    payload->>'note'
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 권한 — EXECUTE 는 기본으로 PUBLIC 에 부여된다 (AQ-28). create or replace 는 ACL 을 유지하므로
-- 쓰기 함수 셋은 다시 적지 않는다. 새 트리거 함수만 회수한다.
-- ---------------------------------------------------------------------------
revoke execute on function public.check_amount_scale_by_currency() from public;
