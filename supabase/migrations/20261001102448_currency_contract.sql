-- ============================================================================
-- M-a2c — 상품 통화 contract (DOC-002 §4.6 ★ 표 · DOC-013 §10.2.1 W2 · P8 컷 a3)
--
-- W1(20260930040321)이 expand로 둔 받침 둘을 뗀다.
--   ① `els_products.currency`의 `default 'KRW'`
--   ② 쓰기 함수 셋의 `coalesce`(create 둘은 'KRW', update는 «저장값»으로 받쳤다)
-- 그 뒤로 통화를 보내지 않는 쓰기는 `23502`(null value in column "currency")로 거부된다 →
-- 계약 계층이 `VALIDATION_FAILED` + `fields.currency`(`NOT_NULL_FIELD`)로 올린다.
--
-- ★ **되돌릴 수 없는 지점이다**(DOC-010 AQ-78 · DOC-013 §10.2.1). 이 뒤로 W1 이전 빌드로의 Instant
--   Rollback은 그 빌드의 등록을 23502로 죽인다. 그래서 W1 코드가 운영에서 ≥1일 돈 뒤에만 적용한다
--   (W1 배포 2026-09-30 20:05 KST · buildId J9vpZhxgdFMBaNnNdzEAB → 2026-10-01 20:05 KST 이후).
--
-- ★ 본문은 W1 파일의 본문에서 출발했고 바뀐 것은 currency 세 줄뿐이다(exchange_rate 열 · redeemed_immutable ·
--   ki_touched_at case 그대로). security invoker · search_path 를 다시 적는다 — create or replace 는 그 절을
--   되살리지 않는다. 서명이 같아 ACL 이 유지된다(AQ-90 이후의 상태 — authenticated 만).
-- ============================================================================

alter table public.els_products alter column currency drop default;

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
    -- W2(M-a2c) — coalesce 를 뗐다. 키가 없으면 열의 not null 이 23502 로 거부한다(기본값도 없다)
    (payload->>'currency')::public.product_currency,
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
    -- W2(M-a2c) — 저장값으로 받치던 coalesce 를 뗐다. 키가 없으면 23502 다. ★ 이 줄이 되살아나면 통화를
    -- 보내지 않는 수정이 조용히 성공한다 — tests/rls/currency.test.ts 가 update 케이스로 영구 단언한다
    currency                 = (payload->>'currency')::public.product_currency,
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
    -- W2(M-a2c) — coalesce 를 뗐다. 키가 없으면 열의 not null 이 23502 로 거부한다(기본값도 없다)
    (payload->>'currency')::public.product_currency,
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
