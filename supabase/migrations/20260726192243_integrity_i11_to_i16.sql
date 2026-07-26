-- ============================================================================
-- 무결성 규칙 I-11 ~ I-16 — DOC-002 v0.4 §8
--
-- P2 산출물을 명세와 대조 검증하면서 드러난 갭을 닫는다. 여섯 규칙의 공통점은
-- **문서가 전제하는 상태를 스키마가 강제하지 않았다**는 것이다. I-08과 같은
-- 부류이므로 같은 방식으로 다룬다 — 계약 계층 검증(DOC-011 §6)은 UX 목적으로
-- 남기고, DB 제약이 최종 보장을 맡는다.
--
-- ★ 제약 이름의 알파벳 순서에 의존하지 않는다.
--
--   CheckConstraintFetch 가 CHECK 를 이름순으로 평가하므로 한 행이 두 제약을
--   동시에 위반하면 이름이 앞선 쪽이 보고된다. 이는 PostgreSQL 구현 세부사항
--   이지 보장된 계약이 아니다. 따라서 순서를 근거로 삼지 않고,
--   tests/rls/constraints.test.ts 의 각 케이스가 **한 번에 한 제약만 위반하도록**
--   데이터를 구성했다. 어떤 순서로 평가되든 결과가 같다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- I-12 — 과세 금융소득은 0 이상이다
--
-- I-08(MATURITY_LOSS → taxable_income = 0)은 손실 상환만 덮는다. 그래서
-- MATURITY_GAIN 에 음수 과세소득을 넣는 경로가 열려 있었고, 그 값은
-- DOC-007 §7.3 의 연도별 금융소득 합계를 그대로 오염시켜 세액을 낮춘다.
--
-- CLAUDE.md 절대 규칙 #8 의 "음수가 될 수 없다"는 상환 유형과 무관한
-- 진술이다. 두 제약은 대체가 아니라 포함 관계다 — I-08 은 손실 상환에서
-- 정확히 0 을, I-12 는 전 유형에서 하한을 보장한다.
--
-- ★ 이 제약에 걸리는 데이터가 나오면 제약이 아니라 모델을 고친다.
-- ---------------------------------------------------------------------------
alter table public.redemptions
  add constraint redemptions_taxable_income_check
  check (taxable_income >= 0);

comment on constraint redemptions_taxable_income_check on public.redemptions is
  'I-12: 과세 금융소득은 0 이상이다. I-08은 MATURITY_LOSS만 덮으므로 유형 무관 하한이 따로 필요하다 — 음수가 들어가면 DOC-007 §7.3의 연도별 합계가 조용히 줄어든다.';

-- ---------------------------------------------------------------------------
-- I-14 — 조기·리자드 상환은 차수를 갖는다
--
-- 아래 I-13 의 복합 FK 는 MATCH SIMPLE 이므로 round_no 가 NULL 인 행을 검사
-- 하지 않는다. 그래서 FK 만으로는 "EARLY 인데 차수가 없는" 행 — 거부하려던
-- 바로 그 불량 행 — 이 통과한다. 조기·리자드 상환은 정의상 특정 평가일에서
-- 발생하므로(DOC-007 §3.3) 차수가 없을 수 없다.
--
-- 단방향으로 쓴다. 쌍조건으로 쓰면 만기 상환에 최종 차수를 기록하는 것까지
-- 금지하는데, DOC-002 §4.9 가 그것을 금지한 적은 없다.
-- DOC-011 V-13 과 같은 진술이며 계약 계층과 DB 가 역할을 나눈다.
-- ---------------------------------------------------------------------------
alter table public.redemptions
  add constraint redemptions_round_no_required_check
  check (redemption_type not in ('EARLY', 'LIZARD') or round_no is not null);

comment on constraint redemptions_round_no_required_check on public.redemptions is
  'I-14: 조기·리자드 상환은 round_no를 갖는다. I-13의 복합 FK가 MATCH SIMPLE이라 round_no IS NULL을 검사하지 않으므로 이 제약이 그 빈틈을 메운다. 단방향이다 — 만기 상환의 차수 기록은 금지하지 않는다.';

-- ---------------------------------------------------------------------------
-- I-13 — 상환의 차수는 해당 상품에 실재해야 한다
--
-- round_no 가 아무것도 참조하지 않아 실재하지 않는 차수(예: 99차)가 저장됐다.
-- DOC-007 §7.2 의 귀속연도가 그 차수의 evaluation_date 로 결정되므로, 허수
-- 차수는 세금 계산의 귀속연도를 결정 불가로 만든다.
--
-- ★ MATCH SIMPLE(기본)을 쓴다. MATCH FULL 을 쓰면 안 된다.
--
--   MATCH SIMPLE 은 참조 열 중 하나라도 NULL 이면 검사하지 않는다. els_id 가
--   NOT NULL 이므로 검사를 건너뛰는 경우는 round_no IS NULL 뿐이고, 이는
--   DOC-002 §4.9 가 만기 상환을 위해 의도한 상태다. MATCH FULL 로 바꾸면 그
--   순간 round_no 가 필수가 되어 만기 상환을 표현할 수 없다.
--
-- ON DELETE RESTRICT — 상환이 가리키는 차수는 사라질 수 없다. 상환 완료
-- 상품의 수정을 DOC-011 §5.2 가 이미 CONFLICT 로 막으므로 계약과 모순되지
-- 않는다. ON UPDATE 는 스키마의 다른 FK 와 같이 기본값(NO ACTION)이다 —
-- 참조된 차수의 번호를 바꾸면 오류가 나는데 그것이 올바른 방향이다.
--
-- 새 인덱스는 불필요하다. 참조측 redemptions 에 UNIQUE(els_id) 가 있어
-- els_id 당 최대 1행이므로 역참조 스캔이 이미 최적이고, 참조 대상의
-- UNIQUE(els_id, round_no) 가 FK 자격을 만족한다.
-- ---------------------------------------------------------------------------
alter table public.redemptions
  add constraint redemptions_els_id_round_no_fkey
  foreign key (els_id, round_no)
  references public.redemption_schedules (els_id, round_no)
  on delete restrict;

comment on constraint redemptions_els_id_round_no_fkey on public.redemptions is
  'I-13: 상환의 round_no는 해당 상품에 실재하는 차수를 가리킨다. MATCH SIMPLE이므로 round_no IS NULL(만기 상환)은 검사하지 않는다 — MATCH FULL로 바꾸면 만기 상환을 표현할 수 없다. RESTRICT이므로 상환이 가리키는 일정 행과 그 round_no는 불변이다(DOC-002 §8.1).';

-- ---------------------------------------------------------------------------
-- I-11 — KI 배리어와 관찰 방식은 짝을 이룬다
--
-- I-10 과 같은 논거다(DOC-002 §4.8). ki_barrier 만 있고 ki_observation 이
-- NULL 이면 DOC-007 §3.4 의 보조 판정이 CONTINUOUS(장중 터치)와 CLOSING
-- (종가 기준) 중 무엇으로 관측할지 결정할 수 없다. 두 방식은 요구하는
-- 데이터가 다르므로(D-04) 임의로 하나를 가정할 수 없다.
--
-- 역방향 — ki_barrier 가 NULL 인데 관찰 방식이 있는 행 — 은 노낙인 상품에
-- 의미 없는 값이 붙은 상태다.
-- ---------------------------------------------------------------------------
alter table public.els_products
  add constraint els_products_ki_pair_check
  check ((ki_barrier is null) = (ki_observation is null));

comment on constraint els_products_ki_pair_check on public.els_products is
  'I-11: ki_barrier와 ki_observation은 함께 존재하거나 함께 부재한다. 배리어만 있으면 DOC-007 §3.4 보조 판정이 관측 방식을 결정할 수 없고, 관찰 방식만 있으면 노낙인 상품에 무의미한 값이 붙는다.';

-- ---------------------------------------------------------------------------
-- I-15 — 노낙인 상품에 터치 이력이 붙을 수 없다
--
-- I-11 보다 무겁다. ki_barrier 가 NULL 인데 ki_touched_at 이 있는 행은
-- **저장된 사실이 계산에서 사라진다.**
--
-- DOC-007 §3.4 는 ki_barrier IS NULL 을 노낙인으로 정의하고 E-06 이
-- "노낙인 상품은 KI 판정을 생략하고 리자드의 KI 요구 조건을 항상 충족으로
-- 처리"한다고 규정한다. 그래서 판정은 ki_touched_at 을 아예 보지 않는다.
-- 그 결과 lizard_requires_no_ki = true 인 차수가 KI 가 터치됐는데도 리자드
-- 충족으로 판정되고, 적용 쿠폰율이 리자드 쿠폰율로 선택되어(§4.1)
-- 수령액이 실제와 어긋난다.
--
-- ★ 고칠 곳은 판정 로직이 아니라 여기다. 판정은 명세대로 동작하고 있고,
--   문제는 명세가 존재를 전제하지 않은 행을 스키마가 허용한 것이다.
-- ---------------------------------------------------------------------------
alter table public.els_products
  add constraint els_products_ki_touched_check
  check (ki_touched_at is null or ki_barrier is not null);

comment on constraint els_products_ki_touched_check on public.els_products is
  'I-15: ki_touched_at은 ki_barrier가 있을 때만 존재한다. 노낙인 상품에 터치 이력이 붙으면 DOC-007 E-06이 그 이력을 무시하므로 리자드의 KI 미터치 요구가 충족으로 판정되고 수령액이 틀린다 — 저장된 사실이 계산에서 사라지는 유형의 결함이다.';

-- ---------------------------------------------------------------------------
-- I-16 — 시세 관측의 좌표는 불변이다
--
-- (asset_id, as_of_date) 는 "어느 자산의 어느 날 종가인가"를 정하는 좌표이고
-- price·source·provider 가 그 좌표에서 관측된 값이다. 좌표를 바꾸는 UPDATE 는
-- 정정이 아니라 다른 행을 만드는 조작이다 — asset_id 변경은 시세를 타인
-- 자산으로 재부모화하고, as_of_date 변경은 DOC-007 §3.1 의 "최신가"를
-- 이동시킨다. 둘 다 타인 상품의 워스트오브를 조용히 바꾸며, 시세 삭제와 달리
-- E-01(시세 없음)로 드러나지도 않는다.
--
-- ★ 왜 트리거인가.
--
--   RLS WITH CHECK 로는 표현할 수 없다 — 정책 표현식은 변경 후 행만 보고
--   변경 전 행을 참조할 수 없다. 열 단위 GRANT 로 강제하면 supabase-js 의
--   .upsert() 가 payload 전역을 DO UPDATE SET 에 실으므로 정상적인 정정
--   UPSERT 가 권한 오류로 실패한다(DOC-011 §5.7). 트리거는 동일값 재대입을
--   통과시켜 UPSERT 를 온전히 남기면서 실제 변경만 거부한다.
--
-- ★ 오류 코드는 23514 다.
--
--   이 규칙은 권한 규칙이 아니라 I-11·I-12 와 같은 층의 무결성 규칙이므로
--   거부 형태를 CHECK 와 일치시킨다. constraint·table 도 함께 실어
--   tests/rls/helpers/expect.ts 가 어느 규칙이 거부했는지 단언할 수 있게 한다.
--
-- ★ created_at·id 는 의도적으로 제외한다.
--
--   좌표는 (asset_id, as_of_date) 뿐이다. created_at 은 감사 메타데이터이고
--   DOC-007 의 어떤 계산도, DOC-011 §4.5 AssetPriceView 도 읽지 않는다.
--   게다가 timestamptz 는 마이크로초, JavaScript Date 는 밀리초까지만
--   표현하므로 조회한 행을 그대로 되싣는 UPSERT 가 절단된 값 때문에
--   거부된다 — .upsert() 를 남기려는 목적이 되돌아간다. id 는 대리키이고
--   조인·판정이 좌표로만 이루어진다.
-- ---------------------------------------------------------------------------
create function public.freeze_asset_price_coordinates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.asset_id   is distinct from old.asset_id
  or new.as_of_date is distinct from old.as_of_date then
    raise exception
      '시세 관측의 좌표(asset_id·as_of_date)는 변경할 수 없다. 좌표가 다른 시세는 정정이 아니라 새 관측이므로 UPSERT로 새 행을 넣는다 — DOC-002 I-16.'
      using errcode    = '23514',
            constraint = 'asset_prices_coordinates_immutable',
            table      = 'asset_prices';
  end if;
  return new;
end;
$$;

create trigger asset_prices_freeze_coordinates
  before update on public.asset_prices
  for each row execute function public.freeze_asset_price_coordinates();

comment on trigger asset_prices_freeze_coordinates on public.asset_prices is
  'I-16: 관측 좌표(asset_id·as_of_date)를 동결한다. 관측값(price·source·provider)의 정정은 공용 데이터 원칙대로 전체에 열려 있다. 동일값 재대입은 통과하므로 supabase-js .upsert()가 payload 전역을 SET에 실어도 동작한다(DOC-011 §5.7). created_at·id는 좌표가 아니므로 제외한다.';
