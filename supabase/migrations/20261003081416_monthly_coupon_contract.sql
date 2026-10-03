-- ============================================================================
-- M-b2c — 쿠폰 지급방식 contract (DOC-002 §4.6 ★ 쿠폰 지급방식 표 · DOC-013 §10.2.1 W5 · P8 컷 b4)
--
-- W4(20261002071645 M-b2)가 expand로 둔 받침 둘을 뗀다 — 상품 통화의 M-a2c(20261001102448)와 같은 두 단계다.
--   ① `els_products.coupon_payout`의 `default 'AT_REDEMPTION'` — 기존 행의 값은 그대로 남는다
--   ② 쓰기 함수 셋의 `coalesce`(create 둘은 'AT_REDEMPTION', update는 «저장값»으로 받쳤다)
-- 그 뒤로 지급방식을 보내지 않는 쓰기는 `23502`(null value in column "coupon_payout")로 거부된다 →
-- 계약 계층이 `VALIDATION_FAILED` + `fields.couponPayout`(`NOT_NULL_FIELD` — DOC-011 §3.2.1)로 올린다.
--
-- ★ **되돌릴 수 없는 지점이다**(DOC-010 AQ-78 · DOC-013 §10.2.1). 이 뒤로 W4 이전 빌드(51149a3 전)로의 Instant
--   Rollback은 그 빌드의 등록을 23502로 죽인다. 선행 조건(「쿠폰 지급방식을 보내는 코드가 운영에서 ≥1일」)은 W4
--   빌드가 이미 만족한다(2026-10-03 배포 · couponPayout을 보낸다). 같은 W5 묶음 안에서 이 `db push`가 `main` 푸시보다
--   먼저다 — 월지급식 선택을 여는 b4 코드가 M-b2c보다 먼저 나가지 않는다(AQ-78 둘째 조건).
--
-- ★ 본문은 M-b2 파일의 본문에서 출발했고 바뀐 것은 coupon_payout 세 줄뿐이다. **currency의 coalesce를 되살리지
--   않는다**(SB-12 — 「통화 누락 → 23502」 단언이 이 교체에서도 초록이어야 한다). security invoker · search_path 를
--   다시 적는다 — create or replace 는 그 절을 되살리지 않는다. 서명이 같아 ACL 이 유지된다(authenticated 만 — AQ-90).
-- ============================================================================

alter table public.els_products alter column coupon_payout drop default;

-- 열 설명을 바로잡는다(P8.5 대조 — DOC-002 §4.6). M-b2가 적은 「W6에서 drop default」는 묶음 전의 웨이브 이름이다 — 이
-- contract는 W5에 실렸다(DOC-013 v1.23). 상품 통화의 열 설명처럼 시간표를 말하되(M-a2c는 설명을 바꾸지 않았다 — 그쪽
-- 웨이브 이름은 맞았다) 이름을 고친다. 동작과 무관하고 카탈로그만 바뀐다.
comment on column public.els_products.coupon_payout is
  'DOC-002 §4.6 ★ — W4 expand 기본값 AT_REDEMPTION(구 코드용). 계약은 필수·기본값 없음(V-25). W5(M-b2c)에서 drop default.';

create or replace function public.create_els_product(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_payout public.coupon_payout;
begin
  insert into public.els_products (
    owner_id, name, issuer, issue_date, principal, currency, evaluation_period_months,
    annual_coupon_rate, coupon_payout, monthly_coupon_annual_rate,
    ki_barrier, ki_observation, account_type, note
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
    -- W5(M-b2c) — coalesce 를 뗐다. 키가 없으면 열의 not null 이 23502 로 거부한다(기본값도 없다)
    (payload->>'couponPayout')::public.coupon_payout,
    (payload->>'monthlyCouponAnnualRate')::numeric,
    (payload->>'kiBarrier')::numeric,
    (payload->>'kiObservation')::public.ki_observation,
    (payload->>'accountType')::public.account_type,
    payload->>'note'
  )
  returning id, coupon_payout into v_id, v_payout;

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

  -- 월수익 일정 — 키가 없으면(구 코드) 0행이다
  insert into public.monthly_coupon_schedules (
    els_id, coupon_no, evaluation_date, payment_date, coupon_barrier
  )
  select v_id,
         (item->>'couponNo')::smallint,
         (item->>'evaluationDate')::date,
         (item->>'paymentDate')::date,
         (item->>'couponBarrier')::numeric
    from jsonb_array_elements(coalesce(payload->'couponSchedules', '[]'::jsonb)) as item;

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

  -- I-25 — 지급방식 ⇔ 월수익 일정(계약 경로만 — I-07과 같은 부류). 이 함수가 만드는 상품은 언제나 FULL이다
  if v_payout = 'MONTHLY'
     and not exists (select 1 from public.monthly_coupon_schedules where els_id = v_id) then
    raise exception '월지급식 상품은 월수익 일정을 1행 이상 가진다 (DOC-002 I-25).'
      using errcode    = '23514',
            constraint = 'els_products_monthly_schedules_required',
            detail     = 'constraint=els_products_monthly_schedules_required',
            table      = 'els_products';
  end if;

  if v_payout = 'AT_REDEMPTION'
     and exists (select 1 from public.monthly_coupon_schedules where els_id = v_id) then
    raise exception '상환 시 지급 상품은 월수익 일정을 갖지 않는다 (DOC-002 I-25).'
      using errcode    = '23514',
            constraint = 'els_products_monthly_schedules_forbidden',
            detail     = 'constraint=els_products_monthly_schedules_forbidden',
            table      = 'els_products';
  end if;

  if v_payout = 'MONTHLY'
     and exists (
       select 1 from public.redemption_schedules
        where els_id = v_id and lizard_barrier is not null
     ) then
    raise exception '월지급식 상품은 리자드 차수를 갖지 않는다 — 월지급 + 리자드는 v2다 (DOC-002 I-25).'
      using errcode    = '23514',
            constraint = 'els_products_monthly_lizard_forbidden',
            detail     = 'constraint=els_products_monthly_lizard_forbidden',
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
  v_payout public.coupon_payout;
begin
  -- AQ-93 — 상환 검사 «앞에서» 잠근다. 그래야 그 검사와 동시 상환 INSERT(상환 쪽 트리거가 같은 행을 잠근다)가
  -- 한 줄로 서고, 일정 upsert · 꼬리 검사도 같은 상품의 기록 쓰기와 직렬화된다. 소유자가 아니면 RLS가 걸러
  -- 잠그지 않고, 아래 UPDATE가 0행이 되어 NULL을 반환한다(계약이 사전 조회로 NOT_FOUND · FORBIDDEN을 가른다)
  perform 1 from public.els_products p where p.id = p_id for update;

  -- 상태 충돌 — 이름이 계약 계층에서 23514를 CONFLICT로 올린다(DOC-002 §8 명명 규약)
  if exists (select 1 from public.redemptions r where r.els_id = p_id) then
    raise exception '상환 처리된 상품은 수정할 수 없다. 상환을 먼저 취소한다 (DOC-011 §5.2).'
      using errcode    = '23514',
            constraint = 'els_products_redeemed_immutable',
            detail     = 'constraint=els_products_redeemed_immutable',
            table      = 'els_products';
  end if;

  update public.els_products set
    name                       = payload->>'name',
    issuer                     = payload->>'issuer',
    issue_date                 = (payload->>'issueDate')::date,
    principal                  = (payload->>'principal')::numeric,
    -- W2(M-a2c) — 저장값으로 받치던 coalesce 를 뗐다. 키가 없으면 23502 다. ★ 이 줄이 되살아나면 통화를
    -- 보내지 않는 수정이 조용히 성공한다 — tests/rls/currency.test.ts 가 update 케이스로 영구 단언한다
    currency                   = (payload->>'currency')::public.product_currency,
    evaluation_period_months   = (payload->>'evaluationPeriodMonths')::smallint,
    annual_coupon_rate         = (payload->>'annualCouponRate')::numeric,
    -- W5(M-b2c) — 저장값으로 받치던 coalesce 를 뗐다. 키가 없으면 23502 다. ★ 이 줄이 되살아나면 지급방식을
    -- 보내지 않는 수정이 조용히 성공한다 — tests/rls 가 update 케이스로 영구 단언한다(통화와 같은 자리)
    coupon_payout              = (payload->>'couponPayout')::public.coupon_payout,
    monthly_coupon_annual_rate = (payload->>'monthlyCouponAnnualRate')::numeric,
    ki_barrier                 = (payload->>'kiBarrier')::numeric,
    ki_observation             = (payload->>'kiObservation')::public.ki_observation,
    account_type               = (payload->>'accountType')::public.account_type,
    note                       = payload->>'note',
    -- 낙인형 해제 시 터치 이력도 함께 비운다 (V-18, I-15)
    ki_touched_at              = case
                                   when (payload->>'kiBarrier') is null then null
                                   else ki_touched_at
                                 end
  where id = p_id
  returning id, coupon_payout into v_id, v_payout;

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

  -- 월수익 일정 ① — 입력에 없는 순번의 행을 지운다. NOT IN이 아니라 NOT EXISTS다(입력에 NULL 순번이 하나라도
  -- 있으면 NOT IN이 전부 NULL이 되어 아무것도 지우지 않는다). 기록된 달이면 복합 FK가 23503으로 막는다
  delete from public.monthly_coupon_schedules s
   where s.els_id = p_id
     and not exists (
       select 1
         from jsonb_array_elements(coalesce(payload->'couponSchedules', '[]'::jsonb)) as item
        where (item->>'couponNo')::smallint = s.coupon_no
     );

  -- 월수익 일정 ② — 입력의 행을 순번 기준으로 upsert한다. 기록된 달은 날짜 · 순번이 같으면 동결 트리거를
  -- 지나고(IS DISTINCT FROM) 배리어만 바뀐다
  insert into public.monthly_coupon_schedules (
    els_id, coupon_no, evaluation_date, payment_date, coupon_barrier
  )
  select p_id,
         (item->>'couponNo')::smallint,
         (item->>'evaluationDate')::date,
         (item->>'paymentDate')::date,
         (item->>'couponBarrier')::numeric
    from jsonb_array_elements(coalesce(payload->'couponSchedules', '[]'::jsonb)) as item
  on conflict (els_id, coupon_no) do update set
    evaluation_date = excluded.evaluation_date,
    payment_date    = excluded.payment_date,
    coupon_barrier  = excluded.coupon_barrier;

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

  -- I-25 — create와 같은 꼬리 검사(값을 줄이는 모든 경로에 건다 — I-07의 v0.4 교훈)
  if v_payout = 'MONTHLY'
     and not exists (select 1 from public.monthly_coupon_schedules where els_id = p_id) then
    raise exception '월지급식 상품은 월수익 일정을 1행 이상 가진다 (DOC-002 I-25).'
      using errcode    = '23514',
            constraint = 'els_products_monthly_schedules_required',
            detail     = 'constraint=els_products_monthly_schedules_required',
            table      = 'els_products';
  end if;

  if v_payout = 'AT_REDEMPTION'
     and exists (select 1 from public.monthly_coupon_schedules where els_id = p_id) then
    raise exception '상환 시 지급 상품은 월수익 일정을 갖지 않는다 (DOC-002 I-25).'
      using errcode    = '23514',
            constraint = 'els_products_monthly_schedules_forbidden',
            detail     = 'constraint=els_products_monthly_schedules_forbidden',
            table      = 'els_products';
  end if;

  if v_payout = 'MONTHLY'
     and exists (
       select 1 from public.redemption_schedules
        where els_id = p_id and lizard_barrier is not null
     ) then
    raise exception '월지급식 상품은 리자드 차수를 갖지 않는다 — 월지급 + 리자드는 v2다 (DOC-002 I-25).'
      using errcode    = '23514',
            constraint = 'els_products_monthly_lizard_forbidden',
            detail     = 'constraint=els_products_monthly_lizard_forbidden',
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
    owner_id, name, issuer, principal, currency, coupon_payout, account_type, note, entry_mode
  ) values (
    -- 입력값으로 받지 않는다 (§5.11)
    (select auth.uid()),
    payload->>'name',
    payload->>'issuer',
    (payload->>'principal')::numeric,
    -- W2(M-a2c) — coalesce 를 뗐다. 키가 없으면 열의 not null 이 23502 로 거부한다(기본값도 없다)
    (payload->>'currency')::public.product_currency,
    -- W5(M-b2c) — coalesce 를 뗐다. 기실현은 지급방식 하나만 받는다(율도 일정도 없다 — I-23이 월수익 연쿠폰율 NULL을 강제)
    (payload->>'couponPayout')::public.coupon_payout,
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
