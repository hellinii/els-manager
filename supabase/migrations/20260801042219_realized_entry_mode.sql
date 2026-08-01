-- ============================================================================
-- 기실현 등재 — DOC-002 v1.0 §4.6·D-07·I-18, DOC-011 v3.2 §5.11 (P6 컷 5)
--
-- 이미 상환이 끝난 ELS 를 과거 이력으로 등재한다. 증권사 거래내역이 주는 것은
-- 상품명·상환일·실수령액·과표·제세금·투자원금·계좌유형 일곱이고, 발행일·
-- 연쿠폰율·기초자산·기준가·차수·배리어는 그 문서에 없다.
--
-- ★ 없는 값을 지어내지 않는다.
--
--   기초자산 1종·차수 1건을 합성해 I-07 을 만족시키는 대안은 값이 거짓인 행을
--   만든다. 형식이 정상이므로 어디에도 드러나지 않고 워스트오브·조건 판정에
--   그대로 들어간다 — DQ-02 가 시세 결측에 대해 거부한 것과 같은 부류다.
--   대신 entry_mode 로 "모른다" 를 저장한다.
--
-- ★ 판별 열을 두는 이유는 표현력이 아니라 거짓의 표현 불가다.
--
--   entry_mode 없이 I-07 을 상환 존재로만 조건화하면 의도된 0건과 결함인 0건이
--   같은 모양이 된다. 계약을 우회해 기초자산이 지워진 상품(AQ-14 의 잔여 경로)이
--   상환만 있으면 정상으로 읽히고 integrityIssue 가 그 상태를 더 이상 드러내지
--   못한다. 절대 규칙 #6 이 열거하는 fail-open 이며 위반자가 0 인 동안 보이지 않는다.
--
-- ★ 절대 규칙 #4 를 어기지 않는다.
--
--   상태(보유중·상환완료)는 여전히 redemptions 존재로만 유도된다(D-01). 이 열은
--   그 유도에 참여하지 않고 "무엇을 입력받기로 했는가" 를 담는다.
-- ============================================================================

create type public.product_entry_mode as enum ('FULL', 'REALIZED_ONLY');

comment on type public.product_entry_mode is
  'DOC-002 §4.6: FULL = 계약 조건을 갖는다 / REALIZED_ONLY = 기실현 등재. 상태가 아니라 입력 완전성의 종류다 — 상태는 redemptions 존재로 유도된다(D-01).';

-- ---------------------------------------------------------------------------
-- 열 추가 + 계약 조건 두 열의 널 허용
--
-- 기본값 FULL 이 안전한 방향이다. 명시하지 않고 만들어진 상품은 계약 조건을
-- 요구받으므로, 빠뜨림이 개방이 아니라 폐쇄로 떨어진다.
-- ---------------------------------------------------------------------------
alter table public.els_products
  add column entry_mode public.product_entry_mode not null default 'FULL';

comment on column public.els_products.entry_mode is
  'DOC-002 §4.6. REALIZED_ONLY 이면 issue_date·annual_coupon_rate 가 NULL 이고 하위 행이 0건이며 그것이 결함이 아니다(D-07).';

alter table public.els_products
  alter column issue_date         drop not null,
  alter column annual_coupon_rate drop not null;

-- ---------------------------------------------------------------------------
-- I-18 — FULL 은 계약 조건 두 열을 갖는다
--
-- 널 허용의 대가를 되받는다. 완화가 FULL 에도 적용되면 조건 판정의 입력이
-- 조용히 사라진다 — annual_coupon_rate 가 없으면 예상 수령액(DOC-007 §4.1)을
-- 낼 수 없고 issue_date 가 없으면 평가일 생성(§4.8)의 기준이 없다.
--
-- I-11·I-15 와 같은 짝 규칙이고, 다른 점은 짝의 한쪽이 값이 아니라 모드라는 것이다.
-- ---------------------------------------------------------------------------
alter table public.els_products
  add constraint els_products_full_terms_check
  check (
    entry_mode <> 'FULL'
    or (issue_date is not null and annual_coupon_rate is not null)
  );

comment on constraint els_products_full_terms_check on public.els_products is
  'I-18: entry_mode = FULL 이면 issue_date·annual_coupon_rate 가 있다. 두 열의 널 허용은 기실현 등재를 위한 것이므로 FULL 에는 미치지 않는다. 부수로 REALIZED_ONLY → FULL 전이를 막는다(DOC-010 AQ-65).';

-- ---------------------------------------------------------------------------
-- I-14 — CHECK 에서 트리거로
--
-- 규칙은 그대로이고 적용 범위에 예외가 하나 생긴다. 기실현 등재는 일정 행이
-- 0건이라 실재하는 차수가 없으므로(I-13 의 복합 FK 가 전부 거부한다) 조기·리자드
-- 상환도 round_no IS NULL 이어야 하는데 종전 CHECK 는 그것을 거부한다.
--
-- ★ 면제 조건이 부모 행의 entry_mode 라 단일 행 CHECK 로 표현할 수 없다.
--
--   redemption_date >= issue_date 가 승격되지 못한 이유(DQ-06)와 같은 부류이고,
--   수단은 I-16 이 이미 쓴 BEFORE 트리거다.
--
-- ★ 유형을 만기 둘로 한정하는 대안을 택하지 않았다.
--
--   그러면 트리거가 필요 없지만 실제로 조기상환된 상품이 MATURITY_GAIN 으로
--   남는다. 세액은 옳고 저장값이 거짓이며, 세금 계산이 유형을 보지 않으므로
--   (DOC-007 §7.3 은 taxable_income 만 읽는다) 그 거짓은 어느 화면에서도
--   반증되지 않는다.
--
-- ★ 이름에서 _check 를 뗀다.
--
--   접미사가 계약 계층의 판정 입력이고(DOC-002 §8 명명 규약) 이 규칙은 이제
--   다른 행을 보므로 *_required(교차 행)가 정확한 부류다. 계약 계층의 처리
--   (VALIDATION_FAILED + roundNo)는 두 접미사에서 같아 화면 동작은 불변이다.
-- ---------------------------------------------------------------------------
alter table public.redemptions
  drop constraint redemptions_round_no_required_check;

create function public.check_redemption_round_required()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- 차수가 있으면 I-13 의 복합 FK 가 그 실재를 검사한다. 여기서 볼 것이 없다.
  if new.round_no is not null then
    return new;
  end if;

  -- 만기 상환은 차수 없이 기록할 수 있다(DOC-002 §4.9). 단방향 규칙이다.
  if new.redemption_type not in ('EARLY', 'LIZARD') then
    return new;
  end if;

  -- 기실현 등재는 실재하는 차수가 없으므로 면제된다(D-07).
  --
  -- 부모가 없으면(있을 수 없다 — els_id 가 NOT NULL FK 다) 하위 질의가 NULL 이고
  -- IS NOT DISTINCT FROM 이 거짓이 되어 아래 거부로 떨어진다. 안전한 방향이다.
  if (
    select p.entry_mode from public.els_products p where p.id = new.els_id
  ) is not distinct from 'REALIZED_ONLY'::public.product_entry_mode then
    return new;
  end if;

  raise exception
    '조기상환·리자드 상환은 차수가 필요하다 — DOC-002 I-14.'
    using errcode    = '23514',
          constraint = 'redemptions_round_no_required',
          detail     = 'constraint=redemptions_round_no_required',
          table      = 'redemptions';
end;
$$;

comment on function public.check_redemption_round_required() is
  'I-14: 조기·리자드 상환은 round_no 를 갖는다 — 부모가 FULL 일 때. 기실현 등재는 일정 0건이라 실재하는 차수가 없으므로 면제된다(D-07). CHECK 로 표현할 수 없는 이유는 면제 조건이 부모 행에 있기 때문이다.';

create trigger redemptions_require_round_no
  before insert or update on public.redemptions
  for each row execute function public.check_redemption_round_required();

comment on trigger redemptions_require_round_no on public.redemptions is
  'I-14. UPDATE 도 본다 — updateRedemption 이 유형과 차수를 함께 바꾸므로(DOC-011 §5.5) INSERT 만 걸면 조기상환으로 고치면서 차수를 비우는 경로가 열린다.';

-- ---------------------------------------------------------------------------
-- §5.11 createRealizedProduct — 상품 1건 + 상환 1건을 한 트랜잭션에
--
-- ★ 왜 함수인가. PostgREST 는 요청당 하나의 트랜잭션이다.
--
--   요청 둘로 나누면 부분 실패가 "REALIZED_ONLY 인데 상환이 없는 상품" 을
--   남긴다. §5.1 의 잔해(기초자산 0건)는 integrityIssue 가 드러내 주지만, 이
--   잔해는 조회 계층이 entry_mode 만 보고 면제하면 정상으로 읽힌다 — 계약 조건도
--   상환도 없어 판정의 모든 입력이 없는데 결함으로도 표시되지 않는 상태다.
--
-- ★ owner_id·entry_mode 를 함수가 박는다.
--
--   앞의 것은 auth.uid(), 뒤의 것은 리터럴이다. payload 에 그 키가 있어도 읽지
--   않으므로 "입력값으로 받지 않는다" 가 규율이 아니라 구조다.
--
-- ★ SECURITY INVOKER(기본값)를 유지한다.
--
--   함수 안의 INSERT 에도 RLS 가 그대로 적용된다. els_products_insert_own 이
--   owner_id 를 다시 검사하고 redemptions 의 INSERT 정책이 부모 소유를 본다.
--
-- ★ 금액·비율은 ->> 로 꺼내 ::numeric 으로 캐스팅한다 (W-04).
--
--   -> 로 JSON 수치를 쓰면 값이 이미 JS 쪽에서 float64 를 경유했다는 뜻이다.
--   실측으로 99999999999.999999 가 100000000000.000000 이 된다(AQ-30).
--
-- ★ round_no 를 받지 않는다.
--
--   일정 행이 0건이므로 실재하는 차수가 없다. 유형 넷은 그대로 쓰이고 차수만
--   항상 NULL 이며, 위 트리거가 그 조합을 허용한다.
-- ---------------------------------------------------------------------------
create function public.create_realized_els_product(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.els_products (
    owner_id, name, issuer, principal, account_type, note, entry_mode
  ) values (
    -- 입력값으로 받지 않는다 (§5.11)
    (select auth.uid()),
    payload->>'name',
    payload->>'issuer',
    (payload->>'principal')::numeric,
    (payload->>'accountType')::public.account_type,
    payload->>'note',
    'REALIZED_ONLY'
  )
  returning id into v_id;

  insert into public.redemptions (
    els_id, redemption_type, round_no, redemption_date,
    gross_amount, taxable_income, withholding_tax, is_confirmed, note
  ) values (
    v_id,
    (payload->>'redemptionType')::public.redemption_type,
    -- 항상 NULL 이다 — 위 각주
    null,
    (payload->>'redemptionDate')::date,
    (payload->>'grossAmount')::numeric,
    (payload->>'taxableIncome')::numeric,
    (payload->>'withholdingTax')::numeric,
    (payload->>'isConfirmed')::boolean,
    payload->>'note'
  );

  return v_id;
end;
$$;

comment on function public.create_realized_els_product(jsonb) is
  'DOC-011 §5.11. 상품 + 상환 두 행을 한 트랜잭션에 만든다 — 요청 둘로 나누면 부분 실패가 "REALIZED_ONLY 인데 상환이 없는 상품"(판정 입력이 하나도 없는데 결함으로도 표시되지 않는 상태)을 남긴다. owner_id 는 auth.uid(), entry_mode 는 리터럴로 박는다.';

-- ---------------------------------------------------------------------------
-- 권한 — EXECUTE 는 테이블 권한과 달리 기본으로 PUBLIC 에 부여된다 (AQ-28)
-- ---------------------------------------------------------------------------
revoke execute on function public.check_redemption_round_required()  from public;
revoke execute on function public.create_realized_els_product(jsonb) from public;

grant execute on function public.create_realized_els_product(jsonb) to authenticated;
