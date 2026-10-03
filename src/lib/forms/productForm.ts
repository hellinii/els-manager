import type { ActionResult } from '@/lib/db/mutations/result'
import { COUPON_PAYOUT_ORDER, type CouponPayout } from '@/lib/domain/coupon'
import { CURRENCY_ORDER, type ProductCurrency } from '@/lib/domain/currency'

import { barrierNotice, parseBarrierList } from './barriers'
import {
  applyCouponBarriers,
  applyCouponDates,
  couponRowCountOf,
  isMonthlyValues,
  monthlyFieldNames,
} from './monthly'
import { parseFieldPath, path } from './fieldPath'
import { initialFormState, toFormState, type FormState } from './state'
import { MAX_ROUNDS, roundCountOf } from './rounds'
import { EVALUATION_DATE_BASIS_FIELD, applyEvaluationDates } from './schedules'

/**
 * 차수 계수는 `./rounds`에 있고 여기서 재수출한다 — 소비자의 import 경로가 그대로 산다.
 * 옮긴 이유는 순환이다: `schedules.ts`가 이 셋을 쓰고 `transition`이 `schedules.ts`의
 * 평가일 채움을 쓴다(DOC-008 v2.8). 순환은 린트가 막지 않지만 지금 트리에 하나도 없다
 * (`schedules.ts`는 이 파일을 **타입으로만** import한다).
 */
export { MAX_ROUNDS, countOf, roundCountOf } from './rounds'

/**
 * SCR-204의 폼 기계 — **순수**하다. `next`도 `react`도 모른다
 *
 * ## 단계 분리를 철회했다 (P6 컷 1, DOC-008 v1.8)
 *
 * v0.5는 현재 단계를 `step` 히든 필드에 두고 전환을 제출로 했다. 실사용 11건이
 * 그 설계를 뒤집었다 — §5.1 K-01(1건 90초)이 어긋났고 반복이 측정값으로 있다
 * (기초자산 조합 5회 · 발행일 3회 · 배리어 세트 4회 재입력). 단계형은 **1건을
 * 겨냥한 설계**였고 11건에서는 「어느 칸이 어느 단계에 있는가」를 기억하게 만들어
 * 왕복을 늘렸다.
 *
 * **그 결정의 근거 중 하나는 철회되지 않았다.** 「`useState`로 하면 JS 없이 동작
 * 하지 않는다」(컷 1b 실측)는 여전히 참이고, 단일 페이지는 폼 하나·제출 하나이므로
 * 그 요구를 **더 쉽게** 만족한다. 둘째 근거(「전이를 순수 모듈로 빼야 상시 스위트가
 * 본다」, AQ-32)는 **애초에 단계를 가진 비용**이었다 — 전이가 없으면 뺄 전이도 없다.
 *
 * ## 남는 것은 페이지 안의 조작 넷이다
 *
 * 행 추가 · 행 삭제 · 배리어 일괄 적용 · 산식으로 다시 채우기(평가일, DOC-008 v2.8).
 * 단계 이동이 아니지만 같은 이유로 **제출**
 * 이며 버튼의 `name`·`value`가 의도를 나른다. 그래서 `Intent`와 `transition`은
 * 남고 `moveStep`·`carryNames`·`stepForErrors`는 사라졌다.
 *
 * ## 히든 이송이 사라졌다
 *
 * 모든 칸이 동시에 렌더되므로 전부 진짜 컨트롤이고 전부 제출된다. 이 설계에서
 * 가장 미묘했던 부분(`carryNames`가 「전체 이름 − 활성 단계의 이름」을 파생시켜야
 * 했고, 빠뜨리면 **증상이 저장 버튼을 누를 때까지 나타나지 않았다**)이 통째로
 * 없어졌다. `productFieldNames`는 남는다 — 계약이 돌려주는 오류 키를 칸과 짝지을
 * 때 「폼의 이름」 목록이 여전히 필요하다(`toFormState`의 `knownNames`).
 */

/**
 * 아직 서지 않은 조각 — **원장이다** (컷 2·3의 `NOT_YET_BUILT`와 같은 형태)
 *
 * 컷 4a는 라우트를 실화면으로 바꾸므로 `placeholderRoutes()`가 `/products/new`를
 * 더 이상 세지 않는다. 그러면 화면 하나가 **부분적으로** 선 상태가 어느 원장에도
 * 남지 않고, 그것은 컷 2·3이 「합계를 단언한다」로 막은 상태와 같은 부류다 —
 * 숫자만 줄어들고 「화면이 섰다」로 읽힌다.
 *
 * 그래서 화면 **안의** 미완성을 여기서 센다. 조각이 서면 이 표에서 지우고,
 * `tests/app/productForm.test.ts`가 표와 실제를 대조한다(지우지 않으면 빨간불).
 *
 * > **원장이 두 번 비었다.** 컷 4a가 셋(③·④·저장)을 등재하고 컷 4b가 비웠으며,
 * > 컷 5가 SCR-202의 셋(상환 처리·상환 취소·KI 터치 확정)을 등재하고 **컷 6이
 * > 비웠다.** 채워짐과 비워짐이 번갈아 일어나는 것이 이 표가 살아 있다는 증거다 —
 * > 비었음을 단언으로 남기므로 다음에 조각을 미루는 컷이 오면 다시 채워진다.
 *
 * > **키 규약이 좁아졌다 (P6 컷 1).** 종전에는 「화면 id 또는 **단계 id**」였는데
 * > 단계가 없어졌으므로 화면 id 하나다. 사유에 컷 번호를 요구하는 것은 그대로다.
 */
export const PENDING_PARTS: Record<string, string> = {}

export const INTENT_FIELD = 'intent'

/**
 * 수정 대상 상품 id — **폼의 이름이지만 계약 입력의 필드가 아니다** (P4 컷 5)
 *
 * `useActionState`의 서명은 `(prev, formData)`이므로 라우트 파라미터가 액션에 자동으로
 * 오지 않는다. 히든으로 실으면 조작이 가능하지만 계약이 소유를 다시 확인하며(§5.2의
 * 사전 조회 + RLS) 결과는 `FORBIDDEN`·`NOT_FOUND`다 — SCR-302가 줄마다 `assetId`를
 * 히든으로 싣는 것과 같은 자리다.
 *
 * **`productFieldNames`에 넣지 않는다.** 그 목록은 「계약 입력의 이름」이고 `transition`이
 * 그것으로 값을 좁히므로, 넣으면 상태가 id를 나르게 되고 그때 id의 정본이 둘이 된다
 * (라우트와 상태). 폼은 이 칸을 **props의 값으로 매 렌더 다시 그린다.**
 */
export const PRODUCT_ID_FIELD = 'productId'

/** 배열 필드의 행 상한 — 한 상품의 기초자산 수 (DOC-007 §3.1은 N종을 허용한다) */
export const MAX_UNDERLYINGS = 10

// ---------------------------------------------------------------------------
// 단계 전이
// ---------------------------------------------------------------------------

export type Intent =
  | { kind: 'SUBMIT' }
  | { kind: 'ADD_UNDERLYING' }
  | { kind: 'REMOVE_UNDERLYING'; index: number }
  | { kind: 'APPLY_BARRIERS' }
  | { kind: 'APPLY_EVALUATION_DATES' }
  // 월지급 블록의 조작 둘(P8 컷 b3-4 — DOC-008 SCR-204 「남는 조작」) — 같은 규약(제출 · JS 없이 동작)
  | { kind: 'APPLY_COUPON_BARRIERS' }
  | { kind: 'APPLY_COUPON_DATES' }
  | { kind: 'NONE' }

/**
 * 버튼의 `value` → 의도.
 *
 * `<button name="intent" value="REMOVE_UNDERLYING:2">`처럼 인자를 콜론 뒤에 싣는다.
 * 버튼의 이름·값은 **JS 없이도 제출되므로** 이 인코딩이 두 경로에서 같다.
 *
 * 인식하지 못한 값은 `NONE`이다 — 조작된 값에 오류를 내면 링크 하나가 폼을 막고,
 * 그 판단은 `lib/forms/query.ts`가 URL 질의에 대해 이미 내렸다.
 */
export function parseIntent(raw: string | null | undefined): Intent {
  const [kind = '', arg = ''] = (raw ?? '').split(':')

  switch (kind) {
    case 'SUBMIT':
      return { kind: 'SUBMIT' }
    case 'ADD_UNDERLYING':
      return { kind: 'ADD_UNDERLYING' }
    case 'APPLY_BARRIERS':
      return { kind: 'APPLY_BARRIERS' }
    case 'APPLY_EVALUATION_DATES':
      return { kind: 'APPLY_EVALUATION_DATES' }
    case 'APPLY_COUPON_BARRIERS':
      return { kind: 'APPLY_COUPON_BARRIERS' }
    case 'APPLY_COUPON_DATES':
      return { kind: 'APPLY_COUPON_DATES' }
    case 'REMOVE_UNDERLYING': {
      const index = /^\d+$/.test(arg) ? Number.parseInt(arg, 10) : -1
      return index < 0 ? { kind: 'NONE' } : { kind: 'REMOVE_UNDERLYING', index }
    }
    default:
      return { kind: 'NONE' }
  }
}

// ---------------------------------------------------------------------------
// 상품 통화 선택지 — DOC-008 SCR-204 (P8 컷 a2)
// ---------------------------------------------------------------------------

/**
 * 폼이 고르게 하는 상품 통화 — **원화 · 달러 둘이다** (P8 컷 a2-3b에서 달러를 열었다).
 *
 * DOC-008 SCR-204: 「「달러」는 모든 금액 표시가 통화를 아는 커밋에서 비로소 고를 수 있다」. 표시는
 * 컷 a2-3a가, **입력 칸**(투자원금 라벨 · 상환의 실수령액 라벨 · 적용 환율 칸)은 a2-3b가 통화를 알게
 * 했다 — 그 전에 열면 「실수령액 (원)」 칸에 달러를 적게 된다. 선택지는 선언 순서(`CURRENCY_ORDER`)다.
 *
 * 기본값은 없다(U7) — 「선택」에서 시작하고 고르지 않으면 V-22가 그 칸에 붙는다.
 */
export const SELECTABLE_PRODUCT_CURRENCIES: readonly ProductCurrency[] = CURRENCY_ORDER

/**
 * 선택지 — 저장값이 위 목록 밖이면(계약 경유로 저장된 달러 상품) **그 값을 더한다.** 빼면 수정
 * 화면의 `<select>`가 「선택」을 보여 주고 저장이 V-22로 막히거나, 사용자가 원화를 골라 달러
 * 상품이 조용히 원화가 된다.
 */
export function currencyOptionsOf(current: string | undefined): ProductCurrency[] {
  const options = [...SELECTABLE_PRODUCT_CURRENCIES]
  const stored = CURRENCY_ORDER.find((c) => c === current)
  if (stored != null && !options.includes(stored)) options.push(stored)
  return CURRENCY_ORDER.filter((c) => options.includes(c))
}

// ---------------------------------------------------------------------------
// 쿠폰 지급방식 선택지 — DOC-008 SCR-204 · SCR-205 (P8 컷 b2)
// ---------------------------------------------------------------------------

/**
 * 폼이 고르게 하는 쿠폰 지급방식 — **「상환 시 지급」 하나다** (컷 b2 · b3).
 *
 * DOC-008 SCR-204: 「「월지급식」은 b4에서 연다」 — 세금 · 전망이 월수익을 사건으로 읽는 것이 b4이므로, 그 전에
 * 고르게 하면 월수익이 화면에는 있고 세금에는 없는 상품이 저장된다(상품 통화의 「달러는 모든 금액 표시가 통화를
 * 아는 커밋에서」와 같은 판단). 계약은 b2부터 월지급식을 받는다(통합 테스트 · 개발 표본).
 *
 * 기본값은 없다(U7) — 「선택」에서 시작하고 고르지 않으면 V-25가 그 칸에 붙는다. 칸을 숨기고 상환 시 지급을
 * 몰래 실으면 그것이 곧 기본값이다(DOC-011 §5.1).
 */
export const SELECTABLE_COUPON_PAYOUTS: readonly CouponPayout[] = ['AT_REDEMPTION']

/**
 * 선택지 — 저장값이 위 목록 밖이면(계약 경유로 저장된 월지급 상품) **그 값을 더한다**(`currencyOptionsOf`와 같다).
 * 빼면 수정 화면의 `<select>`가 「선택」으로 떨어져, 그대로 저장하면 V-25이고 「상환 시 지급」을 고르면 지급방식이
 * 바뀐다. ★ 다만 b2 · b3의 폼에는 월지급 블록(월수익 연쿠폰율 · 월수익 일정)이 없으므로 **그 상품의 수정 저장은
 * b3까지 V-25로 거부된다** — 지급방식이 뒤집히지 않는 것이 이 함수가 지키는 것이다(DOC-008 v2.24 등재).
 */
export function couponPayoutOptionsOf(current: string | undefined): CouponPayout[] {
  const options = [...SELECTABLE_COUPON_PAYOUTS]
  const stored = COUPON_PAYOUT_ORDER.find((payout) => payout === current)
  if (stored != null && !options.includes(stored)) options.push(stored)
  return COUPON_PAYOUT_ORDER.filter((payout) => options.includes(payout))
}

// ---------------------------------------------------------------------------
// 폼의 이름 — 계약 오류 키를 칸과 짝지을 때 쓴다
// ---------------------------------------------------------------------------

/** 기본 정보 구획. `note`는 문서의 구획 표에 없다 — 아래 각주 참조 */
const BASIC_NAMES = [
  'name',
  'issuer',
  'issueDate',
  // 상품 통화 — 기본값 없음(U7 · V-22). 수정 폼 왕복에서 빠지면 달러 상품이 조용히 원화가 된다.
  // 투자원금 **바로 위**다 — 그 칸의 단위이기 때문이다(DOC-008 SCR-204 「구획별 입력」)
  'currency',
  'principal',
  'accountType',
  'note',
] as const

/**
 * 평가 조건 구획의 스칼라. 계약 필드가 아닌 것이 둘이다 — `barriers`(일괄 입력 칸)와
 * `evaluationDateBasis`(평가일 기준 히든, DOC-008 v2.8). 둘 다 여기 있어야 `transition`의
 * 값 좁힘을 지나 다음 렌더와 다음 제출로 이어진다.
 */
const CONDITION_NAMES = [
  // 쿠폰 지급방식 — 평가 조건 구획의 **맨 위**(쿠폰의 조건이다 — DOC-008 SCR-204). 기본값 없음(U7 · V-25).
  // 수정 폼 왕복에서 빠지면 저장이 V-25로 막히거나 지급방식이 다시 고른 값으로 뒤집힌다
  'couponPayout',
  'evaluationPeriodMonths',
  'totalRounds',
  'annualCouponRate',
  'kiBarrier',
  'kiObservation',
  'barriers',
  EVALUATION_DATE_BASIS_FIELD,
] as const

/** 배열 행의 하위 이름. 생성기와 파서가 이 목록을 공유한다 */
export const UNDERLYING_SUBS = ['assetId', 'basePrice'] as const
export const SCHEDULE_SUBS = [
  // 입력값이다(DOC-008 v2.8) — 빈 칸은 저장이 산식으로 채운다(`applyEvaluationDates`)
  'evaluationDate',
  'barrier',
  'lizardBarrier',
  'lizardCouponRate',
  'lizardRequiresNoKi',
] as const

/** 일괄 배리어 입력 칸의 이름 — 계약의 필드가 아니라 화면의 도구다 */
export const BARRIERS_FIELD = 'barriers'

/**
 * **설계상 히든인 이름의 원장** — `productFieldNames` 중 진짜 컨트롤이 아닌 것 (DOC-008 v2.8)
 *
 * v1.8(단계 철회)이 「선언된 이름은 전부 진짜 컨트롤이다」를 불변식으로 세웠고
 * `tests/e2e/product-new.test.ts`가 그것을 단언한다 — 히든 이송으로 값이 조용히 사라지는
 * 상태를 구조적으로 없앤 것이 근거다. 평가일 기준은 그 예외다: 사용자가 고칠 값이 아니라
 * 「지금 칸의 날짜가 어떤 발행일·주기에서 나왔는가」의 **기록**이고 계약 필드도 아니다.
 * 예외를 테스트에 적지 않고 여기 두는 이유는 늘어날 때 **이 목록이 늘어나야** 하기 때문이다
 * — 테스트에서 빼면 다음 히든이 조용히 들어온다.
 */
export const HIDDEN_FIELD_NAMES: readonly string[] = [EVALUATION_DATE_BASIS_FIELD]

export type RowCounts = {
  underlyings: number
  /** 차수표의 행 수. `totalRounds` 입력에서 나오며 0은 「아직 정하지 않았다」다 */
  rounds: number
  /**
   * 월지급 블록이 폼의 이름인가 (P8 컷 b3-4). **b3에서는 지급방식 값이 월지급식인 렌더만이다**(DOC-008 v2.29 —
   * 선택지가 b4이므로 그 값은 저장값뿐이고, 상환 시 지급 상품의 폼에 칸을 두면 기존 폼이 바뀐다)
   */
  monthly: boolean
  /** 월수익 일정의 행 수 — 값에서 파생(`couponRowCountOf`). 월지급식이 아니면 0 */
  couponRows: number
}

/** 값 맵 → 계수 — 화면(`ProductForm`)과 전이가 같은 함수를 쓴다(두 곳이 다른 수를 보면 저장에서야 어긋난다) */
export function rowCountsOf(values: Record<string, string>): RowCounts {
  const monthly = isMonthlyValues(values)
  return {
    underlyings: rowCountOf(values, 'underlyings'),
    rounds: roundCountOf(values),
    monthly,
    couponRows: monthly ? couponRowCountOf(values) : 0,
  }
}

/** 배열 행의 이름 — 생성기와 파서가 이 함수를 공유한다 */
function rowNames(field: string, count: number, subs: readonly string[]): string[] {
  const names: string[] = []
  for (let index = 0; index < count; index += 1) {
    for (const sub of subs) names.push(path(field, index, sub))
  }
  return names
}

/**
 * 폼의 **모든** 이름 — 화면이 그리는 칸의 정본이다.
 *
 * 쓰이는 곳 둘:
 *
 * ① `toFormState`의 `knownNames` — 계약이 돌려주는 오류 키를 칸과 짝짓는다.
 *    여기 없는 키는 「미매칭」으로 상단 요약에 남으며 **버려지지 않는다**
 *    (`splitFieldErrors`).
 * ② `transition`의 값 좁힘 — `$ACTION_*`·`intent` 같은 폼 밖의 것을 상태에서
 *    걸러낸다. 그리고 저장 제출의 계약 입력이 그 값에서 나오므로(어댑터) 이
 *    목록이 곧 **저장될 수 있는 것의 집합**이다.
 *
 * 목록을 컴포넌트에 두면 새 칸이 한쪽에만 생기는 날이 오고, 그때 계약의 오류가
 * 그 칸에 붙지 않는다. `tests/e2e/`가 「선언된 이름이 전부 DOM에 있다」를 확인한다.
 */
export function productFieldNames(counts: RowCounts): string[] {
  return [
    ...BASIC_NAMES,
    ...rowNames('underlyings', counts.underlyings, UNDERLYING_SUBS),
    ...CONDITION_NAMES,
    ...rowNames('schedules', counts.rounds, SCHEDULE_SUBS),
    ...(counts.monthly ? monthlyFieldNames(counts.couponRows) : []),
  ]
}

// ---------------------------------------------------------------------------
// 행 연산 — 값 맵을 직접 다룬다
// ---------------------------------------------------------------------------

/**
 * 그 배열 필드의 행 수 — **값에서 파생시킨다.**
 *
 * 히든 계수기를 따로 두지 않는 이유: 계수기와 값이 갈리면 화면은 3행을 그리는데
 * 파서는 4행을 읽는(또는 그 반대) 상태가 되고, 그 어긋남은 저장 시점에야 드러난다.
 * 빈 입력도 `''`로 제출되므로 행의 존재는 값 맵에 남는다.
 *
 * 최소 1이다 — 기초자산 0건은 계약이 거부하는 상태이고(V-02), 행이 없으면
 * 사용자가 추가 버튼을 찾아야 한다.
 */
export function rowCountOf(values: Record<string, string>, field: string): number {
  let max = -1
  for (const key of Object.keys(values)) {
    const parsed = parseFieldPath(key)
    if (parsed?.field !== field || parsed.index == null) continue
    if (parsed.index > max) max = parsed.index
  }
  return Math.max(1, max + 1)
}

/** 행 추가 — 빈 값으로 이름을 만든다. 상한을 넘으면 그대로 둔다 */
export function addRow(
  values: Record<string, string>,
  field: string,
  subs: readonly string[],
  max: number,
): Record<string, string> {
  const count = rowCountOf(values, field)
  if (count >= max) return values

  const next = { ...values }
  for (const sub of subs) next[path(field, count, sub)] = ''
  return next
}

/**
 * 행 삭제 — **뒤의 행을 앞으로 당긴다.**
 *
 * 인덱스를 비워 두면 `underlyings[1]`이 없는 채 `[2]`가 남고, 파서가 그 구멍을
 * 빈 행으로 읽어 계약이 「기초자산을 선택한다」를 존재하지 않는 행에 붙인다.
 * 마지막 행은 지우지 않는다(V-02).
 */
export function removeRow(
  values: Record<string, string>,
  field: string,
  subs: readonly string[],
  index: number,
): Record<string, string> {
  const count = rowCountOf(values, field)
  if (count <= 1 || index < 0 || index >= count) return values

  const next = { ...values }
  for (let row = index; row < count - 1; row += 1) {
    for (const sub of subs) {
      next[path(field, row, sub)] = next[path(field, row + 1, sub)] ?? ''
    }
  }
  for (const sub of subs) delete next[path(field, count - 1, sub)]
  return next
}

/**
 * 일괄 배리어를 차수별 칸에 **펼친다** — SQ-04 (P4 컷 4b)
 *
 * ## 왜 칸에 쓰는가 (일괄 입력을 그대로 파싱하지 않는가)
 *
 * 배리어의 정본을 일괄 칸으로 두면 계약이 돌려주는 `schedules[2].barrier` 오류가
 * **어느 칸과도 짝지어지지 않는다** — 상단 요약으로 밀리고, 가장 흔한 오류가 가장
 * 먼 자리에 표시된다. 차수별 칸에 펼치면 오류가 그 차수에 붙고 차수별 수정
 * (스텝다운이 아닌 구조)도 같은 칸에서 된다. 일괄 입력은 **채우는 도구**다.
 *
 * ## 총 차수가 비어 있으면 채운다
 *
 * 비어 있을 때만 채운다 — 사용자가 적은 숫자를 우리가 바꾸지 않는다. 다르면
 * 안내로 알린다. **저장 시점의 backstop은 없다** — V-03이 그 사실을 말한다고
 * 적었던 것은 거짓이었다(양쪽이 같은 칸에서 파생되어 항등이다). DOC-011 §9 AQ-63.
 *
 * ## 두 모드가 있다 — 누가 부르는가가 다르다
 *
 * | 모드 | 부르는 곳 | 이미 적힌 칸 |
 * |---|---|---|
 * | `OVERWRITE` | 「일괄 적용」 버튼 | **덮는다.** 사용자가 그 버튼을 누른 뜻이다 |
 * | `FILL_EMPTY` | 저장 제출 | **건드리지 않는다.** 차수별로 적은 값을 지우면 조용한 손실이다 |
 *
 * `FILL_EMPTY`가 있는 이유는 차수표가 **마지막으로 제출된** 총 차수를 보고 그려지기
 * 때문이다. 단계형에서는 ③→④ 이동이 제출이라 저장 전에 표가 반드시 한 번 그려졌고
 * 그 함정이 가려져 있었다. 단일 페이지에는 강제되는 제출이 없으므로, 총 차수와 일괄
 * 칸을 채운 뒤 곧바로 저장하면 **DOM에 없던 칸에 배리어 필수 오류 N개**가 뜬다 —
 * 값을 다 맞게 넣었는데도. 그래서 저장이 펼침을 먼저 수행한다.
 */
export function applyBarriers(
  values: Record<string, string>,
  mode: 'OVERWRITE' | 'FILL_EMPTY' = 'OVERWRITE',
): {
  values: Record<string, string>
  notice: string
} {
  const list = parseBarrierList(values[BARRIERS_FIELD] ?? '')
  if (list.tokens.length === 0) {
    return {
      values,
      notice: '배리어를 적고 「일괄 적용」을 누른다. 예: 90-85-80-75-70-65',
    }
  }

  const next = { ...values }
  if (roundCountOf(next) === 0) {
    next.totalRounds = String(Math.min(list.tokens.length, MAX_ROUNDS))
  }

  const rounds = roundCountOf(next)
  for (let index = 0; index < Math.min(rounds, list.tokens.length); index += 1) {
    const name = path('schedules', index, 'barrier')
    if (mode === 'FILL_EMPTY' && (next[name] ?? '').trim() !== '') continue
    next[name] = list.tokens[index]!
  }

  return { values: next, notice: barrierNotice(list, rounds) }
}

// ---------------------------------------------------------------------------
// 전이 한 번 — 액션이 부르는 유일한 함수
// ---------------------------------------------------------------------------

export type Transition = {
  intent: Intent
  /** 다음 렌더의 값. 폼의 모든 이름으로 **좁혀져** 있다 */
  values: Record<string, string>
  counts: RowCounts
  /** 사용자에게 알릴 것 — 오류가 아니다(일괄 적용 결과 등) */
  notice: string | null
  /**
   * 저장 제출이지만 **저장하지 않는다** — 평가일 기준이 바뀌었는데 실제 날짜가 섞여 있다
   * (`applyEvaluationDates`의 `held`). 어댑터는 이것이 참이면 계약을 부르지 않고
   * `intentState`로 안내를 돌려준다. 저장이 성공하면 리다이렉트로 안내가 사라지기 때문이다.
   */
  saveHeld: boolean
}

/**
 * `FormData` → 다음 렌더 상태. **액션에 남는 것은 이 호출과 계약 호출뿐이다.**
 *
 * 어댑터(`app/<route>/actions.ts`)는 `server.ts`를 끌어오므로 어떤 스위트의 import
 * 그래프에도 들어갈 수 없다(AQ-23). 행 연산·배리어 펼침·값 좁힘이 거기 있으면
 * 그만큼이 영구 미검증이므로 전부 여기 있다 — `FormData`는 Node 전역이고 이
 * 파일은 `next`도 `react`도 모른다.
 *
 * **돌려주는 `values`가 계약 입력의 정본이기도 하다.** 어댑터가
 * `parseProductForm(formOfValues(next.values))`를 부르므로 화면이 렌더하는 것과
 * 저장되는 것의 출처가 하나다.
 */
export function transition(form: FormData): Transition {
  const intent = parseIntent(readText(form, INTENT_FIELD))

  let raw = readAll(form)
  let notice: string | null = null
  let saveHeld = false

  switch (intent.kind) {
    case 'ADD_UNDERLYING': {
      const before = rowCountOf(raw, 'underlyings')
      raw = addRow(raw, 'underlyings', UNDERLYING_SUBS, MAX_UNDERLYINGS)
      if (rowCountOf(raw, 'underlyings') === before) {
        notice = `기초자산은 ${MAX_UNDERLYINGS}종까지 입력한다.`
      }
      break
    }
    case 'REMOVE_UNDERLYING': {
      const before = rowCountOf(raw, 'underlyings')
      raw = removeRow(raw, 'underlyings', UNDERLYING_SUBS, intent.index)
      if (rowCountOf(raw, 'underlyings') === before) {
        // 마지막 한 행은 지울 수 없다 — V-02가 0건을 거부한다.
        notice = '기초자산은 1종 이상 필요하다.'
      }
      break
    }
    case 'APPLY_BARRIERS': {
      const applied = applyBarriers(raw, 'OVERWRITE')
      raw = applied.values
      notice = applied.notice
      break
    }
    case 'APPLY_EVALUATION_DATES': {
      const applied = applyEvaluationDates(raw, 'OVERWRITE')
      raw = applied.values
      notice = applied.notice
      break
    }
    case 'APPLY_COUPON_DATES': {
      const applied = applyCouponDates(raw)
      raw = applied.values
      notice = applied.notice
      break
    }
    case 'APPLY_COUPON_BARRIERS': {
      const applied = applyCouponBarriers(raw)
      raw = applied.values
      notice = applied.notice
      break
    }
    case 'SUBMIT': {
      /*
       * 저장도 일괄 칸을 펼친다 — 다만 **빈 칸에만**. 근거는 `applyBarriers`의
       * 각주에 있다(차수표는 마지막으로 제출된 총 차수를 보고 그려지므로, 강제되는
       * 제출이 없으면 「전부 타이핑 → 저장」이 보이지 않는 칸의 오류가 된다).
       *
       * 안내는 버리지 않고 담아 둔다 — 저장이 성공하면 리다이렉트로 사라지고,
       * 실패하면 `submitState`가 필드 오류를 우선하므로 실제로 쓰이지 않지만,
       * 여기서 `null`로 두면 「왜 이 분기만 안내가 없는가」가 설명되지 않는다.
       */
      const applied = applyBarriers(raw, 'FILL_EMPTY')
      /*
       * 평가일은 배리어 **뒤**다 — 일괄 칸이 비어 있던 총 차수를 정할 수 있고, 산식은 그
       * 차수까지 채운다. 순서를 바꾸면 「총 차수를 비우고 일괄 칸만 적고 저장」에서 평가일이
       * 0개 채워진다.
       */
      const dated = applyEvaluationDates(applied.values, 'SUBMIT')
      raw = dated.values
      saveHeld = dated.held
      notice = dated.notice ?? applied.notice
      break
    }
    default:
      break
  }

  /*
   * 월지급식이면 연쿠폰율은 0이다(DOC-011 V-08′ — 수익은 월수익 연쿠폰율에서만 나온다). 칸은 `readOnly`이지만 칸만 막으면
   * 앞서 적은 값이 고칠 수 없는 칸에 남아 V-08′가 거기 붙는다 — 전이가 함께 고정한다(DOC-008 v2.29 (4)).
   */
  if (isMonthlyValues(raw)) raw = { ...raw, annualCouponRate: '0' }

  const counts = rowCountsOf(raw)

  const values: Record<string, string> = {}
  for (const name of productFieldNames(counts)) {
    values[name] = raw[name] ?? ''
  }

  return { intent, values, counts, notice, saveHeld }
}

// ---------------------------------------------------------------------------
// 전이 → 폼 상태 — 어댑터 둘이 공유한다 (P4 컷 5)
// ---------------------------------------------------------------------------

/**
 * 제출이 아닌 의도(행 추가·삭제·일괄 적용)의 결과 상태.
 *
 * `initialFormState`를 쓰는 이유는 이전 제출의 오류가 따라오면 「고쳤는데도 빨간
 * 글씨가 남는」 상태가 되기 때문이다. 안내(`notice`)는 오류가 아니므로 `status`를
 * 바꾸지 않는다 — 일괄 적용의 해석 모드가 그 자리다(SQ-04).
 */
export function intentState(next: Transition): FormState {
  const state = initialFormState(next.values)
  return next.notice == null ? state : { ...state, message: next.notice }
}

/**
 * 제출 실패의 결과 상태.
 *
 * `knownNames`가 **폼 전체**의 이름이어야 한다 — 일부만 주면 나머지 오류가 전부
 * 미매칭으로 상단에 쌓이고 정작 칸에는 표시되지 않는다.
 *
 * **오류 단계로 되돌리는 장치가 없어졌다 (P6 컷 1).** 그것은 「보이지 않는 칸의
 * 오류를 화면에 가져오는」 수단이었고, 모든 칸이 동시에 렌더되므로 보이지 않는
 * 칸이 없다. 어느 칸과도 짝지어지지 않은 오류만 상단 요약이 받는 규약은 그대로다.
 *
 * **등록과 수정이 이 함수를 공유한다.** 어댑터마다 적으면 한쪽만 고쳐지는 날이 오고,
 * 그때 그 화면에서만 오류가 보이지 않는다 — 두 어댑터는 어떤 스위트의 import 그래프에도
 * 없으므로(AQ-23) 그 갈림을 아무도 보지 못한다.
 */
export function submitState<T>(result: ActionResult<T>, next: Transition): FormState {
  return toFormState(result, next.values, productFieldNames(next.counts))
}

/**
 * 폼의 이름만 남긴다 — `$ACTION_*`·`intent`는 상태에 담지 않는다.
 *
 * `valuesOf(form)`을 그대로 쓰면 React의 액션 필드가 상태에 들어오고, 그 상태는
 * 다음 제출을 위해 **폼에 다시 직렬화된다**(컷 1b에서 `$ACTION_*`가 히든 필드로
 * 렌더되는 것을 실측했다). 단계 폼은 값이 많으므로 그 왕복이 커지고, 무엇보다
 * 상태에 무엇이 있는지가 흐려진다.
 */
function readAll(form: FormData): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') values[key] = value
  }
  return values
}

function readText(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value.trim() : ''
}
