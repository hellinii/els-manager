-- ============================================================================
-- I-17 값 범위 — DOC-002 v0.6 §8, DQ-06 부분 해결 (P3b)
--
-- 네 규칙 모두 **단일 행 불변식**이고 DOC-011 V-01·V-08·V-20이 이미 계약 계층에
-- 같은 내용을 두고 있다. I-08이 만든 구조를 그대로 적용한다.
--
--   계약 계층 : 필드별 VALIDATION_FAILED 반환. UX 목적
--   DB CHECK  : 최종 보장. 우회 불가
--
-- ★ 승격하는 이유는 "있으면 좋아서"가 아니다.
--
--   음수 배리어가 저장되면 워스트오브가 어떤 값이어도 조건이 충족되어
--   **존재하지 않는 조기상환을 표시한다.** 음수 원금은 수령액·과세소득 산식의
--   부호를 뒤집는다. 둘 다 형식은 정상이고 값만 거짓이므로 화면에 드러나지
--   않는다 — I-15와 같은 부류의 조용한 결함이다.
--
-- ★ DQ-06의 다섯 번째 항목은 승격할 수 없다 (서술의 오류를 v0.6에서 정정했다).
--
--   redemption_date >= issue_date 는 redemptions 와 els_products 를 함께 봐야
--   하므로 단일 행 CHECK 로 표현되지 않는다. DQ-07(교차 테이블 정합성)과 같은
--   부류이며 계약 계층 V-10 에 남는다. **V-17 이 DB 로 못 가는 이유와는 다르다** —
--   그쪽은 표현식이 IMMUTABLE 이 아니어서 못 가고(오늘 유효한 행이 내일 위반이
--   된다) 이것은 참조 범위 때문에 못 간다. 두 이유를 섞으면 나중에 트리거로
--   옮길 수 있는지 판단할 근거가 사라진다.
--
-- ★ 비율 상한(x <= 2)은 이번에 올리지 않는다.
--
--   DOC-011 V-08 의 하한이 **필드별로 다르다**는 사실이 v0.9 에서야 드러났다 —
--   lizard_coupon_rate = 0 은 원금상환형 리자드의 정상 표기다(DOC-007 §4.1).
--   지금 일괄 승격하면 그 상품을 DB 가 거부한다. 계약 계층의 세분이 검증된 뒤에
--   올린다.
--
-- ★ 제약 이름이 계약 계층의 입력이다 (DOC-002 §8 명명 규약).
--
--   DOC-011 §3.2.1 이 이름으로 fields 를 결정하므로 이름을 바꾸면 매핑이 조용히
--   기본값으로 떨어진다. src/lib/db/mutations/errors.ts 의 BY_CONSTRAINT 와
--   tests/rls/constraint-names.test.ts 가 이 이름들을 양방향으로 대조한다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- V-01 / principal > 0
-- ---------------------------------------------------------------------------
alter table public.els_products
  add constraint els_products_principal_check
  check (principal > 0);

comment on constraint els_products_principal_check on public.els_products is
  'I-17/V-01: 투자원금은 0보다 크다. 음수 원금은 grossExpected·realizedPnl·과세소득 산식의 부호를 뒤집으며 형식상 정상으로 보인다.';

-- ---------------------------------------------------------------------------
-- V-20 / evaluation_period_months >= 1
--
-- 0 이면 generateEvaluationDates 의 assertPositiveInteger 가 거부하고(DOC-007
-- §7.2), 저장된 0 은 그 함수를 부르는 모든 경로를 죽인다. 음수는 평가일이
-- 발행일보다 앞서는 일정을 만든다.
-- ---------------------------------------------------------------------------
alter table public.els_products
  add constraint els_products_evaluation_period_check
  check (evaluation_period_months >= 1);

comment on constraint els_products_evaluation_period_check on public.els_products is
  'I-17/V-20: 평가주기는 1개월 이상이다. 0은 순수 모듈의 assertPositiveInteger가 거부하는 값이므로 저장되면 그 상품의 일정 생성이 영구히 실패한다.';

-- ---------------------------------------------------------------------------
-- V-08 / barrier > 0
--
-- 상한(<= 2)은 위 각주대로 보류한다. 하한만으로도 "어떤 시세에서도 충족"되는
-- 배리어를 막는다.
-- ---------------------------------------------------------------------------
alter table public.redemption_schedules
  add constraint redemption_schedules_barrier_check
  check (barrier > 0);

comment on constraint redemption_schedules_barrier_check on public.redemption_schedules is
  'I-17/V-08: 조기상환 배리어는 0보다 크다. 0 이하면 워스트오브가 어떤 값이어도 조건이 충족되어 존재하지 않는 조기상환이 표시된다. 상한(<= 2)은 V-08의 필드별 하한이 확정된 뒤로 보류한다(lizard_coupon_rate = 0은 정상 입력이다).';

-- ---------------------------------------------------------------------------
-- gross_amount >= 0
--
-- 대응하는 V-규칙 번호가 없다 — DOC-011 §6 은 taxable_income 만 하한을 정했다.
-- 실수령액은 원금 손실 시 원금보다 작아질 수 있으나(realizedPnl 이 음수가 되는
-- 것은 정상이다) **음수가 될 수는 없다** — 증권사가 지급한 금액이므로 0 이
-- 하한이다. 계약 계층은 셰이프 검사가 같은 하한을 본다.
-- ---------------------------------------------------------------------------
alter table public.redemptions
  add constraint redemptions_gross_amount_check
  check (gross_amount >= 0);

comment on constraint redemptions_gross_amount_check on public.redemptions is
  'I-17: 실수령액은 0 이상이다. 원금보다 작을 수는 있으나(realizedPnl 음수는 정상) 음수일 수는 없다 — 증권사가 지급한 금액이다.';
