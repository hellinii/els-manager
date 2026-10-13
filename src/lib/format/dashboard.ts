/**
 * 홈의 **표시 구조** — SCR-101 (P4 컷 9)
 *
 * ## 왜 화면 안이 아니라 여기인가
 *
 * `page.tsx`는 `server.ts`를 끌어오므로 어떤 스위트의 import 그래프에도 들어갈 수
 * 없다(AQ-23). 「한 상품이 한 줄이다」·「자름을 표시한다」는 값의 성질이므로
 * 순수 함수로 떼어 두면 상시 스위트가 본다 — `lib/format/schedule.ts`
 * (월 그룹·과거/미래 구획)를 뗀 것과 같은 자리이며 그쪽과 같은 이유로 **타입을
 * 계약에 묶지 않고** 필요한 필드만 요구한다.
 *
 * ## 계약이 화면에 넘긴 판단이 여기 있다
 *
 * DOC-011 §4.1은 기간 창을 두지 않는다 — 창을 계약에 박으면 창 밖의 상품이 화면에서
 * 사라지고 그 상수는 어느 문서에도 근거가 없다. 그래서 표시 건수는 화면의 것이며
 * 근거는 DOC-008 §5 SCR-101에 있다. 이 파일은 그 결정의 **단일 구현**이다.
 *
 * ~~「임박」의 경계(30일)도 여기 있었다~~ → 없앴다 *(홈 피드백 컷 K4 · 민서 결정(2026-10-12) D2)* — 모든 행이
 * D-Day를 이미 적어 표식이 행마다 같은 말을 했고, 계약에 창이 없어 그 경계는 강조만 정했다(DOC-008 SCR-101
 * 「화면이 정한 값」 표).
 */

import type { AttentionReason } from '@/lib/db/queries/map'
import { dec } from '@/lib/decimal'

import { ATTENTION_REASON_GRADES, type BadgeGrade } from './badges'
import { taxMethodVerdictOf, type TaxMethodVerdict } from './tax'

/**
 * 표시 건수 — 「스크롤이나 클릭 없이 세 가지를 안다」(DOC-008 §5의 설계 의도).
 *
 * ⑤가 ①보다 짧은 이유는 그것이 세 물음 중 어디에도 없는 **회고**라는 것이다.
 * 두 값 모두 자름을 화면이 표시하므로(`takeVisible`) 6번째가 조용히 사라지지 않는다.
 */
export const UPCOMING_VISIBLE = 5
export const RECENT_VISIBLE = 3

/**
 * **상품이 없어도 ③을 렌더해야 하는가** — SCR-101 (P4.5)
 *
 * ## 이 함수가 없던 동안 화면이 자기 목적 하나를 수행하지 않았다
 *
 * DOC-008 §5는 이 화면의 요구를 「스크롤이나 클릭 없이 세 가지를 안다」로 규정하고
 * 그 둘째가 **「올해 종합과세 대상인가」**다. 그런데 빈 상태 분기(`activeCount === 0`
 * 이고 상환 0건)가 **다섯 절을 통째로** 지웠고, ③의 값은 상품에 의존하지 않는다 —
 * `getDashboard`가 본인 과세 프로필의 `other_financial_income`을 함께 읽어
 * `elsTotal.plus(other)`를 내므로 **상품 0건에서도 `other`가 남는다.**
 *
 * 도달 경로가 열려 있다: §5.6 `saveTaxProfile`은 상품을 요구하지 않고 SCR-401은
 * 상품 0건에서 정상 동작한다. 상품 0건 + ELS 외 금융소득 3,000만 원이면
 * **`isComprehensive`가 참인데** 홈은 「내 상품이 없다」만 적었다.
 *
 * > 그 예시의 추가납부는 **0이다**(실측: 산출세액 4,200,000 < 원천징수 4,620,000).
 * > 금융소득 외 종합소득이 저장되어 있지 않으면 비교과세 ①이 원천징수액과 같아지므로
 * > 추가납부가 양수가 되려면 금융소득이 훨씬 커야 한다. **결론은 그것과 무관하다** —
 * > ③이 답하는 물음은 「올해 종합과세 대상인가」이고 그 답이 이미 참이다.
 *
 * ## 「상품이 없다」와 「올해 금융소득이 0이다」는 다른 사실이다
 *
 * 그래서 빈 상태가 ③을 지우는 조건은 「상품이 없다」가 아니라 **「말할 금융소득이
 * 없다」**여야 한다. 판정 입력은 이미 뷰에 있다(`currentYearTax.financialIncome`).
 *
 * ## 문자열 비교를 쓰지 않는다 — 다만 오늘은 두 구현이 같은 답을 낸다
 *
 * **절대 규칙 #2를 판정에도 적용한다**: 금액의 비교는 값으로 하고 표기로 하지 않는다.
 * `!== '0'`으로 판정하면 `'0.000000'`·`'00'` 같은 표기에서 조용히 참이 되어 금융소득이
 * 0인 사용자에게 ③이 나타난다 — 값이 아니라 **표기**가 화면을 정하는 형태다.
 *
 * > **그 표기가 오늘 이 필드로 올 수는 없다.** 계약이 금액을 문자열로 주는 것은 맞지만
 * > (Q-08) 이 필드는 `::text` 원형을 그대로 통과하는 축이 아니다 — `getDashboard`가
 * > `amountString(own.financialIncome)`으로 만들고 그 함수는 `toFixed(0)`이므로 **항상
 * > 고정표기 정수 문자열**이다(`'-0'`도 `'0'`이 된다). 그러므로 `!== '0'`도 오늘은 옳고,
 * > `dec()`를 쓰는 것은 **그 정규화가 사라지는 날의 회귀 방어**다. 반대 방향의 대가도
 * > 적어 둔다: `dec()`는 비숫자에서 던지므로 계약이 그 불변식을 잃으면 홈이 오류 화면이
 * > 된다 — 조용히 틀리는 것보다 낫다는 판단이며, 그 입력이 오려면 계약이 먼저 깨져야 한다.
 *
 * 상품이 있으면 이 함수를 부르지 않는다 — 그때는 다섯 절이 전부 렌더된다.
 */
export function hasFinancialIncomeToReport(tax: { financialIncome: string }): boolean {
  return !dec(tax.financialIncome).isZero()
}

/** ②의 금액 칸이 읽는 통화별 필드 셋 — 계약 `totals.byCurrency`의 금액 필드(DOC-011 §4.1) */
export type CurrencyAmountField = 'activePrincipal' | 'realizedPnl' | 'receivedCoupons'

/**
 * **②의 칸에 어느 통화 줄을 세우는가** — 값이 0인 통화 줄은 숨긴다 (홈 피드백 컷 K11 · 피드백 #7 · 민서 결정(2026-10-12) D5)
 *
 * ## 왜 숨기는가
 *
 * 계약의 `byCurrency`는 **그 통화의 상품이 하나라도 있으면** 행을 준다(상환 완료 포함 — 손익이 갈 행이 있어야 한다). 그래서
 * 달러 상품이 미상환 하나뿐이면 실현손익 칸에 「$0.00」이, 달러 상품이 전부 상환됐으면 투자원금 칸에 「$0.00」이 섰다 —
 * 칸마다 그 통화의 사실이 0이라는 것을 한 줄씩 말했다(DOC-008 SCR-101 「홈 피드백 컷 K0」 ②).
 *
 * ## `keepOne` — 칸이 비지 않게 한다
 *
 * 투자원금 · 실현손익은 칸 머리가 늘 서므로 전부 0이면 **첫 줄 하나**를 남긴다(선언 순 — 계약이 원화 → 달러로 준다). 받은
 * 월수익은 칸 머리가 없는 덧줄이라 하나도 남기지 않는다(`keepOne: false` — 종전대로 줄이 없다).
 *
 * ## 대가 — 「손익이 정확히 0」이 다른 통화 옆에서 보이지 않는다
 *
 * 계약은 통화별 상환 유무를 싣지 않으므로 「상환이 없어 0」과 「손익이 정확히 0」을 여기서 가르지 못하고 둘 다 숨긴다. 행
 * 단위 사실은 ⑤와 SCR-201 상환완료 목록이 말한다.
 *
 * ## 비교는 `dec`다 (절대 규칙 #2)
 *
 * `'-0.00'` · `'0.000'`도 0이다. 오늘 계약은 `moneyString`(고정 자릿수)을 지나 `'0'` · `'0.00'`만 내지만 — 종전 받은 월수익
 * 줄의 거름이 그 두 표기를 문자열로 비교했다 — 표기가 줄을 정하면 그 정규화가 사라지는 날 「$0.000」 줄이 선다
 * (`hasFinancialIncomeToReport`와 같은 판단). 순서는 바꾸지 않는다. 타입을 계약에 묶지 않고 필요한 필드만 요구한다(이 파일 머리글).
 */
export function shownCurrencyRows<K extends CurrencyAmountField, T extends { readonly [P in K]: string }>(
  rows: readonly T[],
  field: K,
  options: { keepOne: boolean },
): T[] {
  const nonZero = rows.filter((row) => !dec(row[field]).isZero())
  if (nonZero.length > 0 || !options.keepOne) return nonZero
  return rows.slice(0, 1)
}

/**
 * ③의 화면 문구 — DOC-008 SCR-101 「홈 피드백 컷 K0」 ③의 「」와 같은 바이트다 (홈 피드백 컷 K10 · DOC-005 §2.1)
 *
 * 제목 · 칸 글자는 명사형이고 안내는 해요체다. 판정 제목은 SCR-401과 같은 상수(`TAX_METHOD_VERDICT_LABELS` — `./tax`)이고
 * 여기 있는 것은 홈만의 글자다. 결속은 `tests/app/dashboard.test.ts`(문서의 그 블록 하나 — `quoteBlock`)다.
 *
 * **세율 숫자를 넣지 않는다**(절대 규칙 #5) — 「0원이 정상」 안내가 원천징수율을 숫자로 말하면 세율이 코드에 박힌다.
 */
export const YEAR_TAX_TEXT = {
  verdictBody: {
    COMPREHENSIVE: '다른 종합소득과 합산해 누진세율이 적용돼요.',
    SEPARATE: '원천징수로 납세 의무가 끝나요.',
  } satisfies Record<TaxMethodVerdict, string>,
  /** 추가납부 칸 — 프로필이 없고 추가납부가 0일 때 금액 대신 */
  profileMissing: '프로필 미입력',
  /** 하한 표식 — 금액 뒤 */
  atLeast: '이상',
  profileMissingNote: '과세 프로필이 없어 다른 소득을 0으로 계산했어요. 판정과 추가납부는 하한이에요.',
  /**
   * 해소 경로 — 다른 소득이 정말 없는 사용자가 이 줄을 늘 보지 않게 한다(DOC-008 SQ-18 「늘 켜진 강조는 정보가 0이다」).
   * 0으로 저장하면 그 해 행이 생겨 `isProfileSaved`가 참이 된다
   */
  profileMissingResolve: '0으로 저장하면 사라져요.',
  profileLink: '과세 프로필 입력',
  zeroIsNormal: '0원이 정상일 수 있어요. 종합과세여도 이미 원천징수된 세금으로 충분하면 더 낼 세금이 없어요.',
  basisSummary: '추정 기준 보기',
  estimateBasis: '미상환 상품은 적용 차수(다음 도래 평가일)에 상환된다고 가정한 추정이에요.',
} as const

/**
 * ③ 박스의 줄 — 앞의 셋은 **펼친 채** 두고 뒤의 셋은 「추정 기준 보기」 안에 접는다(DOC-008 SCR-101 「홈 피드백 컷 K0」 ③).
 *
 * | 줄 | 자리 | 왜 |
 * |---|---|---|
 * | `PROFILE_MISSING` | 펼침 | 판정과 추가납부가 **하한**이라는 신호다 |
 * | `EXCHANGE_RATE_MISSING` | 펼침 | ST-07 — 같은 하한 신호(DOC-008 §6 ST-07 「자리」 — 접지 않는다) |
 * | `ZERO_IS_NORMAL` | 펼침 | 종합과세인데 0원이면 오류로 읽힌다(DOC-007 §5.5) |
 * | `ESTIMATE_BASIS` · `MONTHLY_COUPON` · `CONVERTED` | 접음 | 추정의 **기준** — 값의 성격을 바꾸지 않는다 |
 */
export type YearTaxLine =
  | 'PROFILE_MISSING'
  | 'EXCHANGE_RATE_MISSING'
  | 'ZERO_IS_NORMAL'
  | 'ESTIMATE_BASIS'
  | 'MONTHLY_COUPON'
  | 'CONVERTED'

/** 추가납부 칸 — 금액 · 「{금액} 이상」 · 「프로필 미입력」. `value`는 계약의 문자열 그대로다(화면이 `won`으로 적는다) */
export type YearTaxAmount = { kind: 'AMOUNT' | 'AT_LEAST'; value: string } | { kind: 'PROFILE_MISSING' }

export type YearTaxDisplay = {
  verdict: TaxMethodVerdict
  additionalTax: YearTaxAmount
  /** 펼친 채 두는 줄 — 순서대로 그린다 */
  shown: YearTaxLine[]
  /** 「추정 기준 보기」 안의 줄 — 늘 하나 이상이다(`ESTIMATE_BASIS`) */
  folded: YearTaxLine[]
}

/**
 * **③이 무엇을 확정처럼 적고 무엇을 하한으로 적는가** — SCR-101 ③ (홈 피드백 컷 K10 · 피드백 #5 · #6)
 *
 * ## 하한이 둘에서 온다
 *
 * `!isProfileSaved`(다른 소득이 0으로 들어갔다)와 `unconvertedCount > 0`(환율이 없어 달러 추정이 빠졌다). 추가납부는
 * 다른 종합소득과 금융소득이 더해질수록 줄지 않으므로(귀속세액이 비교과세의 큰 값이고 누진세표가 볼록하다 — DOC-007 §5.2 ·
 * `lib/tax/comprehensive.ts`) 그 상태의 값은 실제 값의 **하한**이다. 그래서 0이 아닌 값은 「{금액} 이상」이다.
 *
 * ## 프로필이 없고 0이면 금액을 적지 않는다
 *
 * 「0원」은 판정의 결과처럼 읽힌다 — 이번 피드백이 그것이었다(프로필 없는 사용자에게 「0원」이 확정처럼 보였다). 그때는
 * 「프로필 미입력」이다(DOC-005 「과세 프로필」 · §6.1 `NONE` 「미입력」과 같은 근거). **환율만 빠지고 0이면 「0원」이다** —
 * 그 하한 신호는 ST-07 줄이 펼친 채로 말한다.
 *
 * ## 분리과세라서 0이라고 가정하지 않는다
 *
 * 분리과세 경로의 추가납부는 상수가 일관되면 정확히 0이다(`separateTaxationRate` = `separateTaxationIncomeTaxRate` ×
 * (1 + `localIncomeTaxRate`) — `lib/tax/comprehensive.ts` · `withholding.ts`). 그
 * 일관성은 이 함수의 전제가 아니다 — 계약이 준 `additionalTax`를 판정과 무관하게 그대로 다룬다. 0이 아닌 분리과세 값이
 * 오면 상수가 어긋난 것이고, 그때 화면이 그 값을 숨기면 결함이 사라진다.
 *
 * ## 비교는 `dec`다 (절대 규칙 #2)
 *
 * `'0.000'` · `'-0'`도 0이다. 오늘 이 필드는 `amountString`(`toFixed(0)`)을 지나 늘 정수 표기지만, 표기가 칸을 정하면
 * 그 정규화가 사라지는 날 「프로필 미입력」이 「0.000원」이 된다(`hasFinancialIncomeToReport`와 같은 판단).
 *
 * 타입을 계약에 묶지 않고 필요한 필드만 요구한다(이 파일 머리글).
 */
export function yearTaxDisplay(tax: {
  isComprehensive: boolean
  isProfileSaved: boolean
  additionalTax: string
  unconvertedCount: number
  convertedCount: number
  monthlyCouponAssumption: boolean
  exchangeRateBasis: unknown
}): YearTaxDisplay {
  const saved = tax.isProfileSaved
  const unconverted = tax.unconvertedCount > 0
  const zero = dec(tax.additionalTax).isZero()
  const lowerBound = !saved || unconverted

  const additionalTax: YearTaxAmount =
    !saved && zero
      ? { kind: 'PROFILE_MISSING' }
      : { kind: lowerBound && !zero ? 'AT_LEAST' : 'AMOUNT', value: tax.additionalTax }

  const shown: YearTaxLine[] = []
  if (!saved) shown.push('PROFILE_MISSING')
  if (unconverted) shown.push('EXCHANGE_RATE_MISSING')
  if (saved && tax.isComprehensive && zero && !unconverted) shown.push('ZERO_IS_NORMAL')

  const folded: YearTaxLine[] = ['ESTIMATE_BASIS']
  if (tax.monthlyCouponAssumption) folded.push('MONTHLY_COUPON')
  // 계약은 `≠ null ⇔ convertedCount > 0`이다 — 둘 다 보는 것은 종전 렌더의 조건 그대로다(환율 없이 그 줄을 쓸 수 없다)
  if (tax.convertedCount > 0 && tax.exchangeRateBasis != null) folded.push('CONVERTED')

  return { verdict: taxMethodVerdictOf(tax.isComprehensive), additionalTax, shown, folded }
}

/**
 * 자름 — **표시하지 않는 자름을 만들지 않는다.**
 *
 * `hidden > 0`이면 화면이 「총 N건 중 …」과 전체를 보는 링크를 함께 렌더한다.
 * 신호 없는 자름은 6번째 항목이 어떤 방법으로도 보이지 않는데 화면에 그 사실이
 * 없는 상태이며, DOC-010 AQ-22가 `searchAssets`에서 등재한 형태와 같다.
 */
export type Visible<T> = {
  shown: T[]
  total: number
  /** 잘려 나간 건수. `0`이면 화면이 자름을 말하지 않는다 */
  hidden: number
}

export function takeVisible<T>(items: readonly T[], limit: number): Visible<T> {
  return {
    shown: items.slice(0, limit),
    total: items.length,
    hidden: Math.max(0, items.length - limit),
  }
}

/**
 * 조치 목록을 **상품 단위로 접는다** — DOC-008 §5 SCR-101 ④
 *
 * 계약은 `(상품 × 사유)`를 평면 배열로 준다(한 상품이 여러 사유를 낸다, §4.1 v0.8).
 * 그 요소의 제목은 「주의 상태 **상품**」이므로 접지 않으면 결함 + KI 하회 상품이
 * 목록에 두 번 나타나고 **사용자는 그것을 두 개의 상품으로 읽는다.**
 *
 * ## 순서를 다시 정하지 않는다 — 두 축 모두
 *
 * 사유의 순서는 계약이 「결함 우선」으로 고정했다(§4.1 v0.8: 결함 → 월수익 미기록 → KI →
 * 시세 없음 — 「평가일 경과」는 P6 컷 7-4에서 ⑥으로 옮겨 갔다). 여기서 다시 정하면 §4.2 우선순위표가 화면마다 갈리는 함정이 이
 * 요소에서 재발한다 — `deriveDisplay()`를 단일 구현으로 둔 것과 같은 논거다.
 * 상품의 순서도 **첫 등장 순서**이며 계약이 준 순서다.
 *
 * 같은 상품이 떨어져서 두 번 나타나도 **먼저 만든 그룹에 합친다**(`groupByMonth`와
 * 같은 규약) — 제목이 두 번 나오면 사용자는 그것을 두 상품으로 읽는다.
 */
export type AttentionGroup<T extends { reason: unknown }> = {
  productId: string
  productName: string
  ownerName: string
  /** 계약이 준 순서 그대로. 대표값은 첫 원소다 */
  reasons: Array<T['reason']>
  /**
   * 사유별 개수 — 계약이 `count`를 준 사유만(지금은 `COUPON_UNRECORDED` — 「n개월」, P8 컷 b3). 화면이 세지 않는다 —
   * 미기록 달을 화면이 세면 E-10의 판정을 계약 밖에서 다시 하게 된다(DOC-008 SCR-101 ④)
   */
  counts: Partial<Record<string, number>>
}

export function groupAttention<
  T extends {
    productId: string
    productName: string
    ownerName: string
    reason: unknown
  },
>(items: readonly T[]): Array<AttentionGroup<T>> {
  const groups: Array<AttentionGroup<T>> = []
  const byId = new Map<string, AttentionGroup<T>>()

  for (const item of items) {
    let group = byId.get(item.productId)
    if (group == null) {
      group = {
        productId: item.productId,
        productName: item.productName,
        ownerName: item.ownerName,
        reasons: [],
        counts: {},
      }
      byId.set(item.productId, group)
      groups.push(group)
    }
    group.reasons.push(item.reason)
    const count = (item as { count?: unknown }).count
    if (typeof count === 'number') group.counts[String(item.reason)] = count
  }

  return groups
}

/**
 * 그룹의 시각 등급 — **가장 무거운 사유가 줄의 등급이다.**
 *
 * 첫 사유를 쓰면 「결함 우선」 순서 때문에 항상 `defect`가 되어 KI 하회 상품과
 * 결함 상품이 같은 색이 된다(그 순서는 **조치의 성격** 순이지 심각도 순이 아니다).
 * 사유마다 뱃지를 달아 각각의 등급을 그대로 보이는 것이 이 화면의 표시이고,
 * 이 함수는 **줄 전체의 강조**에만 쓴다.
 *
 * 서열은 `BADGE_WEIGHT`가 정한다 — `BadgeGrade`의 전수 사상이므로 등급이 늘면
 * 여기서 컴파일이 깨진다. `caution` < `record` < `attention` < `defect`다 *(홈 피드백 컷 K3 · DOC-005 §6.3 v1.24)*:
 * 관찰보다 할 일(기록)이, 기록보다 원금 위험이, 그보다 데이터 결함이 무겁다.
 * **`record`는 다른 어느 등급과도 같은 무게가 아니어야 한다** — 비교가 엄격(`>`)이라 같은 무게면 먼저 온 사유가
 * 이겨 사유 순서에 따라 답이 갈리고, 0이면 「월수익 미기록」만 있는 줄이 `neutral`이 된다.
 */
const BADGE_WEIGHT: Record<BadgeGrade, number> = {
  neutral: 0,
  positive: 0,
  caution: 1,
  record: 2,
  attention: 3,
  defect: 4,
}

export function heaviestGrade(reasons: readonly AttentionReason[]): BadgeGrade {
  let heaviest: BadgeGrade = 'neutral'
  for (const reason of reasons) {
    const grade = ATTENTION_REASON_GRADES[reason]
    if (BADGE_WEIGHT[grade] > BADGE_WEIGHT[heaviest]) heaviest = grade
  }
  return heaviest
}

/**
 * 조치 사유 칩의 글자 — 표시 문자열(DOC-005 §6.1)에 계약이 준 개수를 붙인다 (P8 컷 b3 · DOC-008 SCR-101 ④ v2.31).
 * 「월수익 미기록 · 3개월」. 개수가 없는 사유는 표시 문자열 그대로다(종전 칩이 한 글자도 바뀌지 않는다).
 */
export function attentionChipLabel(label: string, count: number | undefined): string {
  return count == null ? label : `${label} · ${count}개월`
}
