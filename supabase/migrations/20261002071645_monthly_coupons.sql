-- ============================================================================
-- M-b2 — 월지급식 ELS expand (DOC-002 v1.15 D-09 · §4.6 · §4.9 · §4.13 · §4.14 · I-12 · I-21 · I-23~I-27 ·
--        DOC-010 AQ-79 · AQ-87 ⓑ · AQ-93 · P8 컷 b2 · 배포 웨이브 W4)
--
-- 월수익은 상환과 별개의 사건 엔티티다(D-09). 이 마이그레이션이 세우는 것:
--   ① 열거형 둘 — `coupon_payout`(AT_REDEMPTION · MONTHLY) · `coupon_outcome`(PAID · UNPAID)
--   ② `els_products.coupon_payout`(W4 expand — 기본값 AT_REDEMPTION, W6의 M-b2c가 뗀다) ·
--      `monthly_coupon_annual_rate` · I-23 짝 CHECK
--   ③ `monthly_coupon_schedules`(계약 조건 — CASCADE) · `monthly_coupon_payments`(과세 이력 — RESTRICT)
--      — RLS · 회수 후 명시 부여 · 정책 넷씩
--   ④ 트리거 — 자릿수(기존 함수 확장) · 기록의 부모 셋 · 상환 쪽 둘 · 기록 뒤 동결 둘
--   ⑤ `redemptions_withholding_tax_check`(I-12 확장 — DQ-17 ④)
--   ⑥ 쓰기 함수 셋 — couponPayout(coalesce) · 월수익 일정(create insert · update delete + upsert) · 꼬리 검사 셋
--
-- ★ 부모 행 잠금 (AQ-93 결정 ⓐ). 교차 테이블 트리거는 각자 상대 테이블의 «커밋된» 상태만 본다(READ COMMITTED).
--   FK가 거는 FOR KEY SHARE는 서로도, 부모 UPDATE의 FOR NO KEY UPDATE와도 충돌하지 않으므로 잠금 없이는 경합하는
--   두 쓰기가 둘 다 커밋된다(실측 — DOC-010 v3.24). 그래서 **부모 상품을 읽는 트리거는 전부 그 행을
--   `select … for update`로 먼저 잠근다** — 트리거는 이름순으로 발화하므로 «가장 먼저 부모를 읽는 트리거»가
--   잠금을 잡아야 한다(자릿수 트리거 `*_check_amount_scale`이 `*_check_parent` · `*_check_coupon_terms`보다 앞이다).
--   같은 트랜잭션 안의 재잠금은 비용이 없다. 상품 동결 트리거는 그 UPDATE 자신이 행을 잠그므로 두지 않는다.
--   RLS 아래에서 `for update`는 UPDATE 정책의 USING도 적용받는다 — 소유자가 아니면 행이 걸러져 잠금 없이 지나고,
--   그 쓰기는 뒤의 INSERT · UPDATE 정책이 42501로 거부한다(새 거부 경로를 만들지 않는다).
--
-- ★ 라벨은 테이블마다 리터럴이다 — `tests/rls/constraint-names.test.ts`가 `constraint = '<이름>'`과
--   `detail     = 'constraint=<이름>'`을 이 텍스트에서 찾는다(TG_TABLE_NAME으로 조립하지 않는다 — DOC-002 §4.9).
-- ★ 트리거 · 부모 · 형제를 보는 규칙은 데이터 전용 복원(session_replication_role = replica)에서 돌지 않는다
--   (DOC-010 AQ-80). 단일 행 CHECK는 복원에서도 재검증된다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ① 열거형
-- ---------------------------------------------------------------------------
create type public.coupon_payout as enum ('AT_REDEMPTION', 'MONTHLY');
create type public.coupon_outcome as enum ('PAID', 'UNPAID');

comment on type public.coupon_payout is
  'DOC-002 §4.6 — 쿠폰 지급방식. AT_REDEMPTION = 상환 시 지급(일괄), MONTHLY = 월지급식(D-09).';
comment on type public.coupon_outcome is
  'DOC-002 §4.14 — 월수익 지급 기록의 결과. 미기록은 미지급이 아니다 — 관측한 결과만 저장한다.';

-- ---------------------------------------------------------------------------
-- ② els_products — 쿠폰 지급방식 · 월수익 연쿠폰율 · I-23
--
-- 기본값은 W4(expand) 동안 배포 중인 구 코드를 위한 것이다 — 계약의 기본값이 아니다(DOC-011 V-25: 필수 ·
-- 기본값 없음). W6의 M-b2c가 `drop default`한다(되돌릴 수 없는 지점 — DOC-010 AQ-78).
-- 기존 행은 전부 AT_REDEMPTION · 월수익 연쿠폰율 NULL이 되므로 I-23을 이미 만족한다(재작성 없음).
-- ---------------------------------------------------------------------------
alter table public.els_products
  add column coupon_payout public.coupon_payout not null default 'AT_REDEMPTION',
  add column monthly_coupon_annual_rate numeric(6,4);

comment on column public.els_products.coupon_payout is
  'DOC-002 §4.6 ★ — W4 expand 기본값 AT_REDEMPTION(구 코드용). 계약은 필수·기본값 없음(V-25). W6에서 drop default.';
comment on column public.els_products.monthly_coupon_annual_rate is
  'DOC-002 §4.6 — 월수익 연쿠폰율(연 환산 · 소수 정규화). FULL ∧ MONTHLY면 > 0, 그 밖에는 NULL(I-23).';

-- I-23 — 월지급 조건의 짝. `coalesce(…, false)`가 NULL을 거부로 읽는다 — `CHECK`는 식이 NULL이면 통과시키므로
-- 감싸지 않으면 FULL ∧ MONTHLY ∧ 월수익 연쿠폰율 NULL이 지난다(`NULL > 0`이 NULL). 모르는 entry_mode도 CASE가
-- NULL을 내어 거부된다(I-21의 fail-closed `coalesce(…, -1)`과 같은 처리). 비율 상한은 계약(V-25)만 본다.
alter table public.els_products
  add constraint els_products_monthly_terms_check check (
    coalesce(
      case entry_mode
        when 'FULL' then
          (coupon_payout = 'MONTHLY' and annual_coupon_rate = 0 and monthly_coupon_annual_rate > 0)
          or (coupon_payout = 'AT_REDEMPTION' and monthly_coupon_annual_rate is null)
        when 'REALIZED_ONLY' then monthly_coupon_annual_rate is null
      end,
      false
    )
  );

comment on constraint els_products_monthly_terms_check on public.els_products is
  'I-23: FULL ∧ MONTHLY ⇒ 연쿠폰율 0 ∧ 월수익 연쿠폰율 > 0(이중 계상 방지 — DQ-11), FULL ∧ AT_REDEMPTION ⇒ 월수익 연쿠폰율 NULL, REALIZED_ONLY ⇒ 월수익 연쿠폰율 NULL. coalesce(…, false)로 NULL을 거부한다.';

-- ---------------------------------------------------------------------------
-- ⑤ redemptions — 원천징수세액 ≥ 0 (I-12 확장 · DQ-17 ④)
--
-- 운영 읽기 전용 감사(2026-10-02): 상환 3건 · withholding_tax < 0 0건 · NULL 0건 — 검증이 기존 행에 걸리지
-- 않는다. 계약은 이미 0 이상을 본다(V-19). 이것은 직접 쓰기의 그물이다.
-- ---------------------------------------------------------------------------
alter table public.redemptions
  add constraint redemptions_withholding_tax_check check (withholding_tax >= 0);

comment on constraint redemptions_withholding_tax_check on public.redemptions is
  'I-12(v1.15 확장): 원천징수세액은 0 이상이다 — 월수익 지급 기록 쪽(I-26)과 대칭. NULL은 계약이 채운다.';

-- ---------------------------------------------------------------------------
-- ③-1 monthly_coupon_schedules — 월수익 일정 (DOC-002 §4.13 · I-24)
--
-- 계약 조건이다 — `redemption_schedules`와 같은 부류(CASCADE). 날짜는 입력값이 정본이고 산식은 채우는 도구다.
-- 순번의 연속 · 평가일 증가 · 발행일 이상 · 만기 이하 · 1..60행 · 배리어 상한은 계약 계층만 본다(V-26).
-- ---------------------------------------------------------------------------
create table public.monthly_coupon_schedules (
  id              uuid         primary key default gen_random_uuid(),
  els_id          uuid         not null references public.els_products (id) on delete cascade,
  -- 월수익 순번(1부터). 차수가 아니다(DOC-005 §8.3) — 세는 값이라 CountingColumn이다
  coupon_no       smallint     not null,
  evaluation_date date         not null,
  -- 일정상의 예정 지급일. 기록 없는 달의 추정은 이 날짜의 연도에 귀속된다(D-09)
  payment_date    date         not null,
  coupon_barrier  numeric(6,4) not null,

  constraint monthly_coupon_schedules_els_id_coupon_no_key unique (els_id, coupon_no),
  -- b0 반박 검토가 찾은 부류(`redemption_schedules.round_no ≤ 0` — DOC-010 AQ-92)를 되풀이하지 않는 싼 방어
  constraint monthly_coupon_schedules_coupon_no_check check (coupon_no >= 1),
  -- 거꾸로 된 행은 귀속연도(지급일 연도)를 평가보다 앞당긴다
  constraint monthly_coupon_schedules_payment_date_check check (payment_date >= evaluation_date),
  -- I-17의 barrier > 0과 같은 논거 — 음수 배리어는 어떤 워스트오브에서도 충족된다
  constraint monthly_coupon_schedules_coupon_barrier_check check (coupon_barrier > 0)
);

comment on table public.monthly_coupon_schedules is
  'DOC-002 §4.13 · D-09 — 월지급식의 월수익 일정(계약 조건, CASCADE). 횟수의 정본은 행 수다.';

-- 평가일정(SCR-301)의 월수익 행 — els_id 접두 없는 기간 조회(DOC-011 §4.12, 컷 b3)
create index monthly_coupon_schedules_evaluation_date_idx
  on public.monthly_coupon_schedules (evaluation_date);

-- ---------------------------------------------------------------------------
-- ③-2 monthly_coupon_payments — 월수익 지급 기록 (DOC-002 §4.14 · I-21 · I-26 · I-27)
--
-- 과세 이력이다 — els_id는 RESTRICT(상환과 같은 근거, DQ-01). 관측된 결과만 저장한다 — 추정 사건은 저장하지
-- 않는다(DQ-02). 금액 열은 상환과 같은 두 부류다(M-08): gross_amount = 상품 통화(정밀도 없음 + 자릿수 두 층),
-- taxable_income · withholding_tax = 원화 numeric(15,0). 생성·수정 시각 열은 두지 않는다(redemptions 선례).
-- ---------------------------------------------------------------------------
create table public.monthly_coupon_payments (
  id              uuid                  primary key default gen_random_uuid(),
  els_id          uuid                  not null references public.els_products (id) on delete restrict,
  -- FULL 부모면 필수(그 상품의 일정에 실재 — 복합 FK), REALIZED_ONLY 부모면 NULL(일정이 없다 — D-07)
  coupon_no       smallint,
  outcome         public.coupon_outcome not null,
  -- 거래내역의 지급일. 귀속연도의 기준이다(D-09). PAID면 필수, UNPAID면 NULL
  payment_date    date,
  gross_amount    numeric,
  taxable_income  numeric(15,0),
  withholding_tax numeric(15,0),
  -- 적용 환율 — 참고값. 어떤 계산에도 쓰지 않는다(DOC-005)
  exchange_rate   numeric(18,6),
  is_confirmed    boolean               not null,
  note            text,

  -- I-26 — 달 1 : 기록 1. 순번 없는 기실현 기록은 NULL끼리 같지 않으므로 지급일 UNIQUE가 중복을 막는다
  constraint monthly_coupon_payments_els_id_coupon_no_key unique (els_id, coupon_no),
  constraint monthly_coupon_payments_els_id_payment_date_key unique (els_id, payment_date),
  -- I-26 — 기록의 형태. 미지급은 금액·지급일·과세·원천징수·환율이 전부 없고 «순번은 있다»(그 달을 가리켜야
  -- 의미가 있다 — 순번 없는 미지급은 두 UNIQUE가 모두 무력하다). 두 갈래 다 NULL을 내지 않는 식이다
  constraint monthly_coupon_payments_outcome_check check (
    (outcome = 'PAID'
      and payment_date is not null
      and gross_amount is not null
      and taxable_income is not null
      and gross_amount > 0)
    or (outcome = 'UNPAID'
      and payment_date is null
      and gross_amount is null
      and taxable_income is null
      and withholding_tax is null
      and exchange_rate is null
      and coupon_no is not null)
  ),
  constraint monthly_coupon_payments_coupon_no_check check (coupon_no >= 1),
  -- 값 범위 — I-08 · I-12 · I-22의 확장. NULL은 CHECK를 통과한다(UNPAID)
  constraint monthly_coupon_payments_taxable_income_check check (taxable_income >= 0),
  constraint monthly_coupon_payments_withholding_tax_check check (withholding_tax >= 0),
  constraint monthly_coupon_payments_exchange_rate_check check (exchange_rate > 0),
  -- I-21 — 통화와 무관한 한계(정수부 15자리 · scale ≤ 2). 단일 행이라 복원에서도 재검증된다
  constraint monthly_coupon_payments_gross_amount_digits_check check (
    gross_amount < 1000000000000000 and scale(gross_amount) <= 2
  ),
  -- I-27 — 순번이 그 상품의 일정에 실재한다. MATCH SIMPLE(기본값) — coupon_no NULL(기실현 기록)은 검사 밖.
  -- RESTRICT — 기록된 달의 일정 행은 지울 수 없다(DOC-002 §4.13 「기록된 달은 고정된다」 ⓐ)
  constraint monthly_coupon_payments_els_id_coupon_no_fkey foreign key (els_id, coupon_no)
    references public.monthly_coupon_schedules (els_id, coupon_no) on delete restrict
);

comment on table public.monthly_coupon_payments is
  'DOC-002 §4.14 · D-09 — 월수익 지급 기록(과세 이력, RESTRICT). 관측한 결과(PAID · UNPAID)만 저장한다.';

-- ---------------------------------------------------------------------------
-- ④-1 I-21 — 자릿수 트리거를 둘째 테이블에 건다 (기존 함수 확장, 서명 불변 → ACL 유지)
--
-- 바뀐 것 셋: ⓐ 부모 행 잠금(AQ-93 — 이 트리거가 두 테이블에서 부모를 가장 먼저 읽는다) ⓑ gross_amount가
-- NULL이면 통과(UNPAID — redemptions의 그 열은 NOT NULL이라 동작 불변) ⓒ 라벨을 테이블마다 리터럴로 낸다.
-- ---------------------------------------------------------------------------
create or replace function public.check_amount_scale_by_currency()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_currency public.product_currency;
  v_max_scale integer;
begin
  -- AQ-93 — 부모를 읽기 전에 잠근다. 통화 수정과 경합하면 낡은 통화로 판정할 수 있다(USD → KRW 수정 중에
  -- 들어온 1000.50이 USD 기준으로 통과한 뒤 부모가 KRW가 되는 경로). 소유자가 아니면 RLS가 걸러 잠그지 않는다
  perform 1 from public.els_products p where p.id = new.els_id for update;

  -- 미지급(UNPAID)의 금액은 NULL이다 — 볼 자릿수가 없다
  if new.gross_amount is null then
    return new;
  end if;

  select p.currency into v_currency from public.els_products p where p.id = new.els_id;

  -- 부모가 없으면 FK 가 거부한다. 알 수 없는 통화는 거부한다(fail-closed).
  v_max_scale := case v_currency when 'KRW' then 0 when 'USD' then 2 end;

  -- 책임을 CHECK와 가른다: 전역 한도(소수 2자리 초과 · 정수부 15자리)는 *_gross_amount_digits_check가 보고하게
  -- 둔다. ★ BEFORE 행 트리거는 CHECK보다 **먼저** 돈다(실측, P8 a2) — 여기서 scale > 2까지 거부하면 그 값은
  -- CHECK에 닿기 전에 이 라벨로 보고되어, 복원에서도 재검사되는 CHECK의 몫을 트리거가 가로챈다
  if v_max_scale is null
     or (scale(new.gross_amount) > v_max_scale and scale(new.gross_amount) <= 2) then
    -- 라벨은 테이블마다 리터럴이다(조립하지 않는다 — constraint-names 대조가 텍스트에서 찾는다)
    if tg_table_name = 'monthly_coupon_payments' then
      raise exception
        '월수익(세전)의 소수 자릿수가 상품 통화의 보조단위를 넘는다 — 원화 0자리 · 달러 2자리 (DOC-002 I-21).'
        using errcode    = '23514',
              constraint = 'monthly_coupon_payments_gross_amount_scale',
              detail     = 'constraint=monthly_coupon_payments_gross_amount_scale',
              table      = 'monthly_coupon_payments';
    end if;
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
  'I-21 의 통화에 딸린 절반: 부모 상품의 통화가 원화면 금액은 0자리, 달러면 2자리 이내. redemptions · monthly_coupon_payments 두 테이블에 걸리고 라벨은 테이블마다 리터럴이다. NULL 금액(UNPAID)은 통과. 부모 행을 FOR UPDATE로 먼저 잠근다(AQ-93).';

create trigger monthly_coupon_payments_check_amount_scale
  before insert or update on public.monthly_coupon_payments
  for each row execute function public.check_amount_scale_by_currency();

comment on trigger monthly_coupon_payments_check_amount_scale on public.monthly_coupon_payments is
  'I-21. UPDATE 도 본다 — updateCouponPayment(§5.15)가 금액을 고친다.';

-- ---------------------------------------------------------------------------
-- ④-2 I-27 기록 쪽 — 부모 트리거 라벨 셋 (DQ-07 ② · ③)
--
-- 순서: 지급방식(가장 근본) → 순번의 형태 → 상환 뒤 달. 부모가 없으면 FK가 거부하게 그대로 둔다.
-- 순번이 일정에 실재하는지는 복합 FK가 본다(트리거 뒤 — 이 트리거는 그 달의 평가일을 «읽기만» 한다).
-- ---------------------------------------------------------------------------
create function public.check_coupon_payment_parent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payout          public.coupon_payout;
  v_entry_mode      public.product_entry_mode;
  v_redemption_date date;
  v_evaluation_date date;
begin
  -- AQ-93 — 상환 쪽 트리거 · 상품 동결과 같은 행을 잠가 같은 상품의 쓰기를 한 줄로 세운다
  perform 1 from public.els_products p where p.id = new.els_id for update;

  select p.coupon_payout, p.entry_mode
    into v_payout, v_entry_mode
    from public.els_products p
   where p.id = new.els_id;

  if not found then
    return new;  -- 부모가 없다 — els_id FK가 23503으로 거부한다
  end if;

  -- DQ-07 ③ — 상환 시 지급 상품에 붙은 기록은 금융소득 합계에 들어간다. 계산에 들어가는 값은 DB가 지킨다
  if v_payout is distinct from 'MONTHLY'::public.coupon_payout then
    raise exception
      '월지급식 상품에만 월수익을 기록할 수 있다 (DOC-002 I-27).'
      using errcode    = '23514',
            constraint = 'monthly_coupon_payments_monthly_required',
            detail     = 'constraint=monthly_coupon_payments_monthly_required',
            table      = 'monthly_coupon_payments';
  end if;

  -- 순번이 부모의 entry_mode에 따라 갈리므로 단일 행 CHECK로 쓸 수 없다(I-14가 트리거로 내려간 것과 같은 이유)
  if (v_entry_mode = 'FULL' and new.coupon_no is null)
     or (v_entry_mode = 'REALIZED_ONLY' and (new.coupon_no is not null or new.outcome <> 'PAID')) then
    raise exception
      '계약 조건을 갖는 상품의 기록은 월수익 순번이 있어야 하고, 기실현 상품의 기록은 순번 없는 지급뿐이다 (DOC-002 I-27).'
      using errcode    = '23514',
            constraint = 'monthly_coupon_payments_coupon_no_required',
            detail     = 'constraint=monthly_coupon_payments_coupon_no_required',
            table      = 'monthly_coupon_payments';
  end if;

  -- DQ-07 ② 기록 쪽 — 상환이 있으면 그 달의 월수익 평가일 ≤ 상환일. 비교 키는 평가일이다(지급일이 아니다 —
  -- 같은 날 평가된 마지막 달은 지급일이 상환일 뒤여도 기록할 수 있다). 결과(PAID · UNPAID)를 가리지 않는다.
  -- 순번 없는 기실현 기록은 평가일이 없어 검사 밖이다
  if new.coupon_no is not null then
    select r.redemption_date into v_redemption_date
      from public.redemptions r
     where r.els_id = new.els_id;

    if v_redemption_date is not null then
      select s.evaluation_date into v_evaluation_date
        from public.monthly_coupon_schedules s
       where s.els_id = new.els_id and s.coupon_no = new.coupon_no;

      if v_evaluation_date > v_redemption_date then
        raise exception
          '상환일 뒤에 평가되는 달의 월수익은 기록할 수 없다 (DOC-002 I-27).'
          using errcode    = '23514',
                constraint = 'monthly_coupon_payments_after_redemption',
                detail     = 'constraint=monthly_coupon_payments_after_redemption',
                table      = 'monthly_coupon_payments';
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.check_coupon_payment_parent() is
  'I-27 기록 쪽: 부모가 MONTHLY · 순번의 형태(FULL ⇒ 있음, REALIZED_ONLY ⇒ 없는 PAID) · 상환이 있으면 그 달 평가일 ≤ 상환일. 부모 행을 FOR UPDATE로 먼저 잠근다(AQ-93).';

create trigger monthly_coupon_payments_check_parent
  before insert or update on public.monthly_coupon_payments
  for each row execute function public.check_coupon_payment_parent();

comment on trigger monthly_coupon_payments_check_parent on public.monthly_coupon_payments is
  'I-27. UPDATE 도 본다 — 기록의 재부모화(els_id · coupon_no 변경)는 동결하지 않으므로 새 좌표에서 다시 판정한다.';

-- ---------------------------------------------------------------------------
-- ④-3 I-27 상환 쪽 — 라벨 둘 (DQ-07 ② 반대쪽 · ⑤ — AQ-87 ⓑ)
--
-- 기록 쪽과 «같은 기록 집합»(PAID · UNPAID)을 본다 — 대칭(b1 개정). 순번 없는 기록은 평가일이 없어 세지 않는다.
-- ---------------------------------------------------------------------------
create function public.check_redemption_coupon_terms()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payout                   public.coupon_payout;
  v_principal                numeric;
  v_latest_recorded_evaluation date;
begin
  -- AQ-93 — 기록 쪽 트리거와 같은 행을 잠근다
  perform 1 from public.els_products p where p.id = new.els_id for update;

  select p.coupon_payout, p.principal
    into v_payout, v_principal
    from public.els_products p
   where p.id = new.els_id;

  if not found then
    return new;  -- 부모가 없다 — els_id FK가 거부한다
  end if;

  -- DQ-07 ② 상환 쪽 — 상환일 < 기록된 달들의 월수익 평가일 최댓값이면 거부
  select max(s.evaluation_date) into v_latest_recorded_evaluation
    from public.monthly_coupon_payments c
    join public.monthly_coupon_schedules s
      on s.els_id = c.els_id and s.coupon_no = c.coupon_no
   where c.els_id = new.els_id;

  if new.redemption_date < v_latest_recorded_evaluation then
    raise exception
      '상환일이 기록된 달의 월수익 평가일보다 앞설 수 없다 — 상환 뒤에 평가되는 월수익은 없다 (DOC-002 I-27).'
      using errcode    = '23514',
            constraint = 'redemptions_before_coupon_payment',
            detail     = 'constraint=redemptions_before_coupon_payment',
            table      = 'redemptions';
  end if;

  -- DQ-07 ⑤ — 월지급식의 상환은 원금만이다(V-29). 같은 날의 그 달 월수익은 월수익 지급 기록에 따로 적는다
  if v_payout = 'MONTHLY'::public.coupon_payout
     and (new.gross_amount > v_principal or new.taxable_income <> 0) then
    raise exception
      '월지급식 상품의 상환은 원금만이다 — 실수령액 ≤ 투자원금, 과세 금융소득 0 (DOC-002 I-27).'
      using errcode    = '23514',
            constraint = 'redemptions_monthly_principal_only',
            detail     = 'constraint=redemptions_monthly_principal_only',
            table      = 'redemptions';
  end if;

  return new;
end;
$$;

comment on function public.check_redemption_coupon_terms() is
  'I-27 상환 쪽: 상환일 ≥ 기록된 달(PAID · UNPAID)들의 월수익 평가일 최댓값 · MONTHLY면 실수령액 ≤ 원금 ∧ 과세 0. 부모 행을 FOR UPDATE로 먼저 잠근다(AQ-93).';

create trigger redemptions_check_coupon_terms
  before insert or update on public.redemptions
  for each row execute function public.check_redemption_coupon_terms();

comment on trigger redemptions_check_coupon_terms on public.redemptions is
  'I-27. UPDATE 도 본다 — updateRedemption(§5.5)이 상환일 · 금액을 고친다.';

-- ---------------------------------------------------------------------------
-- ④-4 기록 뒤 동결 둘 (DQ-14 · AQ-79 결정 — 어떤 쓰기 경로든 막는다)
--
-- 둘 다 «값이 바뀔 때만»(IS DISTINCT FROM) 거부한다 — `UPDATE OF 열` 트리거는 값이 같아도 그 열이 SET 목록에
-- 있으면 발화하고, update_els_product의 upsert가 기록된 달에 같은 값을 다시 대입한다. 상태 충돌 접미사
-- `*_recorded_immutable` → CONFLICT(고칠 필드가 없다 — 기록을 먼저 지운다).
-- ---------------------------------------------------------------------------
create function public.freeze_recorded_coupon_terms()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- 잠금이 필요 없다 — 이 UPDATE 자신이 그 행을 잠갔다(BEFORE 행 트리거는 행을 잠근 뒤 돈다). 기록 쪽
  -- 트리거가 같은 행을 FOR UPDATE로 잠그므로 첫 기록 INSERT와 직렬화된다(AQ-93 실측)
  if (new.currency is distinct from old.currency
      or new.coupon_payout is distinct from old.coupon_payout)
     and exists (select 1 from public.monthly_coupon_payments c where c.els_id = new.id) then
    raise exception
      '월수익 지급 기록이 있는 상품은 상품 통화 · 쿠폰 지급방식을 바꿀 수 없다. 기록을 먼저 지운다 (DOC-002 DQ-14).'
      using errcode    = '23514',
            constraint = 'els_products_coupon_recorded_immutable',
            detail     = 'constraint=els_products_coupon_recorded_immutable',
            table      = 'els_products';
  end if;
  return new;
end;
$$;

comment on function public.freeze_recorded_coupon_terms() is
  'DQ-14 ⓐ: 월수익 지급 기록이 있으면 currency · coupon_payout이 바뀌지 않는다. 동일값 재대입은 통과.';

create trigger els_products_freeze_recorded_coupon_terms
  before update of currency, coupon_payout on public.els_products
  for each row execute function public.freeze_recorded_coupon_terms();

create function public.freeze_recorded_coupon_schedule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- AQ-93 — 직접 UPDATE 경로도 기록 INSERT와 직렬화한다(update_els_product는 함수 맨 앞에서 이미 잠갔다)
  perform 1 from public.els_products p where p.id = old.els_id for update;

  if (new.evaluation_date is distinct from old.evaluation_date
      or new.payment_date is distinct from old.payment_date
      or new.coupon_no is distinct from old.coupon_no)
     and exists (
       select 1 from public.monthly_coupon_payments c
        where c.els_id = old.els_id and c.coupon_no = old.coupon_no
     ) then
    raise exception
      '월수익 지급 기록이 있는 달의 순번 · 평가일 · 지급일은 바꿀 수 없다. 기록을 먼저 지운다 (DOC-002 DQ-14).'
      using errcode    = '23514',
            constraint = 'monthly_coupon_schedules_recorded_immutable',
            detail     = 'constraint=monthly_coupon_schedules_recorded_immutable',
            table      = 'monthly_coupon_schedules';
  end if;
  return new;
end;
$$;

comment on function public.freeze_recorded_coupon_schedule() is
  'DQ-14 ⓑ: 기록된 달의 coupon_no · evaluation_date · payment_date는 바뀌지 않는다(값이 바뀔 때만 거부 — upsert의 동일값 재대입은 통과). 배리어는 고칠 수 있다. 평가일 동결이 I-27 ②의 비교 키를 지킨다.';

create trigger monthly_coupon_schedules_freeze_recorded
  before update of evaluation_date, payment_date, coupon_no on public.monthly_coupon_schedules
  for each row execute function public.freeze_recorded_coupon_schedule();

-- 함수 실행 권한 — 네 롤에서 명시 회수한다. 운영의 기본 권한이 로컬과 달랐다(DOC-010 AQ-90).
-- 트리거 실행은 함수의 EXECUTE를 검사하지 않으므로 회수해도 동작한다(DOC-010 §7).
revoke execute on function public.check_coupon_payment_parent()
  from public, anon, authenticated, service_role;
revoke execute on function public.check_redemption_coupon_terms()
  from public, anon, authenticated, service_role;
revoke execute on function public.freeze_recorded_coupon_terms()
  from public, anon, authenticated, service_role;
revoke execute on function public.freeze_recorded_coupon_schedule()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ③-3 RLS · 권한 — 회수 후 명시 부여 (CLAUDE.md 절대 규칙 6 · DOC-010 §7)
--
-- 두 테이블 다 `redemption_schedules` · `redemptions` 블록과 같은 형태다 — SELECT 전체, 변경은 부모 상품의
-- 소유자. 쓰기 함수가 invoker로 delete · upsert하므로 authenticated에 전 DML. service_role은 0이다.
-- ★ enable row level security를 빠뜨리면 정책·GRANT와 무관하게 전면 개방된다(fail-open).
-- ---------------------------------------------------------------------------
alter table public.monthly_coupon_schedules enable row level security;
alter table public.monthly_coupon_payments enable row level security;

revoke all on public.monthly_coupon_schedules from public, anon, authenticated, service_role;
revoke all on public.monthly_coupon_payments from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.monthly_coupon_schedules to authenticated;
grant select, insert, update, delete on public.monthly_coupon_payments to authenticated;

create policy monthly_coupon_schedules_select_all on public.monthly_coupon_schedules
  for select to authenticated
  using (true);

create policy monthly_coupon_schedules_insert_owner on public.monthly_coupon_schedules
  for insert to authenticated
  with check (
    exists (
      select 1 from public.els_products p
      where p.id = monthly_coupon_schedules.els_id
        and p.owner_id = (select auth.uid())
    )
  );

create policy monthly_coupon_schedules_update_owner on public.monthly_coupon_schedules
  for update to authenticated
  using (
    exists (
      select 1 from public.els_products p
      where p.id = monthly_coupon_schedules.els_id
        and p.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.els_products p
      where p.id = monthly_coupon_schedules.els_id
        and p.owner_id = (select auth.uid())
    )
  );

create policy monthly_coupon_schedules_delete_owner on public.monthly_coupon_schedules
  for delete to authenticated
  using (
    exists (
      select 1 from public.els_products p
      where p.id = monthly_coupon_schedules.els_id
        and p.owner_id = (select auth.uid())
    )
  );

create policy monthly_coupon_payments_select_all on public.monthly_coupon_payments
  for select to authenticated
  using (true);

create policy monthly_coupon_payments_insert_owner on public.monthly_coupon_payments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.els_products p
      where p.id = monthly_coupon_payments.els_id
        and p.owner_id = (select auth.uid())
    )
  );

create policy monthly_coupon_payments_update_owner on public.monthly_coupon_payments
  for update to authenticated
  using (
    exists (
      select 1 from public.els_products p
      where p.id = monthly_coupon_payments.els_id
        and p.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.els_products p
      where p.id = monthly_coupon_payments.els_id
        and p.owner_id = (select auth.uid())
    )
  );

-- DELETE는 소유자에게 열린다 — 기록을 지우는 계약(§5.15 deleteCouponPayments)이 그 경로이고 redemptions와 같다
-- (과세 이력이지만 사용자가 틀린 기록을 고칠 길이 있어야 한다). exchange_rates처럼 닫지 않는 이유는 공용
-- 데이터가 아니라 소유자의 거래이기 때문이다
create policy monthly_coupon_payments_delete_owner on public.monthly_coupon_payments
  for delete to authenticated
  using (
    exists (
      select 1 from public.els_products p
      where p.id = monthly_coupon_payments.els_id
        and p.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- ⑥ 쓰기 함수 셋 — create or replace (서명 불변 → ACL 유지 · authenticated만)
--
-- ★ 본문은 M-a2c(20261001102448)의 본문에서 출발했다 — currency의 coalesce를 되살리지 않는다(SB-12 · 「통화 누락 →
--   23502」 단언이 이 교체에서도 초록이어야 한다). security invoker · search_path를 다시 적는다.
-- ★ couponPayout — create 둘은 coalesce(…, 'AT_REDEMPTION'), update는 coalesce(…, 저장값)(W4 expand · DOC-002 §4.6 ★).
--   저장값으로 떨어지는 것이 요점이다 — 'AT_REDEMPTION'으로 떨어지면 지급방식을 싣지 않은 수정이 월지급 상품을
--   상환 시 지급으로 뒤집는다. W6(M-b2c)이 coalesce를 뗀다.
-- ★ 월수익 일정 — update는 전체 교체가 아니다: 입력에 없는 순번을 delete하고 입력의 행은 coupon_no upsert
--   (DOC-002 §4.6 「상태가 아니다」 예외 ⓑ). 기록된 달을 빼는 delete는 복합 FK(RESTRICT)가 23503으로 막는다 —
--   계약이 사전 조회로 먼저 CONFLICT를 낸다(§5.2). 동일값 재대입은 동결 트리거를 지난다.
-- ★ AQ-93 — update는 상환 검사 앞에서 부모 행을 잠근다(기존 check-then-act까지 닫는다).
-- ---------------------------------------------------------------------------
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
    -- W4(M-b2) expand — 구 코드는 키를 보내지 않는다. W6(M-b2c)이 coalesce를 뗀다
    coalesce((payload->>'couponPayout')::public.coupon_payout, 'AT_REDEMPTION'),
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
    -- W4(M-b2) expand — «저장값»으로 떨어진다. 'AT_REDEMPTION'으로 떨어지면 지급방식을 싣지 않은 수정이 월지급
    -- 상품을 조용히 뒤집는다(DOC-002 §4.6 ★). W6(M-b2c)이 coalesce를 뗀다
    coupon_payout              = coalesce((payload->>'couponPayout')::public.coupon_payout, coupon_payout),
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
    -- W4(M-b2) expand — 기실현은 지급방식 하나만 받는다(율도 일정도 없다 — I-23이 월수익 연쿠폰율 NULL을 강제)
    coalesce((payload->>'couponPayout')::public.coupon_payout, 'AT_REDEMPTION'),
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
