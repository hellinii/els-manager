import { dec, ZERO } from '@/lib/decimal'
import { type EstimateRates, type ExchangeRate } from '@/lib/domain'
import {
  forecastYears,
  type ForecastItem,
  type ForecastYearInput,
} from '@/lib/tax'

import { currentYear } from '../today'
import { attributionOf } from './attribution'
import type { QueryContext } from './context'
import { incomeEventsOf, type IncomeEvent } from './income'
import {
  loadAllTaxYears,
  loadEstimateRates,
  loadProducts,
  loadTaxProfiles,
  profileFor,
  resolveTaxYear,
  type ProductRow,
} from './load'
import { amountString, exchangeRateBasisOf, ratioString, type ExchangeRateBasisView } from './map'
import { toBrackets, toConstants } from './tax'

/** §4.7 — 다년도 전망 (SCR-402) */

/**
 * 기본 전망 연수 — **AQ-08이 6으로 확정했다.**
 *
 * 근거는 상품의 만기다: 통상 3년이고 발행일이 흩어져 있으므로 지금 보유한 상품 전부가
 * 상환을 마치는 데 필요한 구간이 그 두 배 안쪽이다. 더 짧으면 만기가 먼 상품의 회수가
 * 표에서 잘려 잔여 원금이 마지막 행에 영구히 남는 것처럼 보이고, 더 길면 시드된 세율이
 * 하나뿐이라 뒤 행이 전부 같은 근사인데 행 수만 늘어난다.
 */
export const FORECAST_DEFAULT_YEARS = 6

/**
 * `years`의 상한 — **가드이며 도메인 의미가 없다** (DOC-011 §4.7 v2.5).
 *
 * 스키마에서 유도할 수 없다: `evaluation_period_months >= 1`에 상한이 없으므로(V-20)
 * 만기가 구조적으로 무계이고 「모든 상품이 상환을 마치는 해」를 계산할 방법이 없다.
 * 만족하는 조건은 둘뿐이다 — ① 기본값보다 확실히 크다(같으면 `years` 인자가 장식이
 * 되어 AQ-08의 「인자를 남겨 둔다」가 무효가 된다) ② 행 수가 렌더 위험이 될 수 없다.
 *
 * **「20년까지 전망이 유효하다」는 뜻이 아니다.** 시드가 2026 하나인 동안 둘째 행부터
 * 이미 전부 근사이며 근사의 유효 범위는 이 상한과 무관하다.
 */
export const FORECAST_MAX_YEARS = 20

/** §4.7 — 행 하나. 금액·비율은 문자열이다 (Q-08) */
export type ForecastRow = {
  year: number
  /** 적용된 세율·상수의 연도. `year`와 다르면 근사다 */
  taxLawYear: number
  /** 적용한 과세 프로필의 연도. `null`이면 미입력 */
  profileYear: number | null
  grossProceeds: string
  financialIncome: string
  /** 종합과세 기준금액 대비. **양수면 초과** — §4.6의 절대값과 다르다 */
  thresholdGap: string
  isComprehensive: boolean
  effectiveRate: string
  additionalTax: string
  /** 건강보험료 + 장기요양보험료 (DOC-005 §5) */
  totalInsurance: string
  netProceeds: string
  cumulativeNet: string
  remainingPrincipal: string
  /** **건보료 차감 전이다** — DOC-007 §7.5 */
  cumulativeAssets: string
  /** 이 행의 값이 적용 차수 가정에 의존한다 (§7.5의 **행 축**) · 또는 원화 환산을 포함한다 */
  hasEstimates: boolean
  /**
   * 추정 환율이 없어 이 행의 원화 합계 열에서 빠진 외화 상품 수 (§4.7 v4.9) — **표 밖 표식**이다.
   *
   * 그 상품이 처음 원화 합에 필요해진 행부터 **마지막 행까지** 센다 — 누적 두 열이 뒤 행에서도
   * 그 상품을 잃기 때문이다. 기준 연도 이전에 상환된 상품은 어느 열에도 없으므로 세지 않는다.
   * 그래서 이 규칙에서는 모든 행이 같은 값이다(보유중·`Y₀` 상환 상품은 첫 행부터 필요하다).
   */
  excludedForeignCount: number
  /**
   * 이 행의 원화 환산에 쓴 추정 환율 (§4.7 v4.9 — P8 컷 a3) — **표 밖 표식 다섯째**(열이 아니다).
   *
   * `excludedForeignCount`와 **같은 규칙**으로 붙는다 — 환산한 외화 상품이 처음 원화 합에 필요해진 행부터
   * 마지막 행까지다(누적 두 열이 뒤 행에서도 그 환산을 담는다). 그래서 모든 행이 같은 값이고, 추정 환율이
   * 요청당 하나이므로(§4.0 규칙 2) 어느 상품에서 읽어도 같다. 기준 연도 이전에 상환된 외화 상품은 어느
   * 열에도 없으므로 이 표식을 세우지 않는다.
   */
  exchangeRateBasis: ExchangeRateBasisView | null
}

/**
 * 상품 행 → §7.5의 항목. **순수하다** — `resolveTaxYear`·`profileFor`와 같은 이유로 뗀다.
 *
 * 붙여 두면 이 사상을 실행하는 유일한 방법이 DB를 세우는 것이 되고, 아래 세 성질이
 * `test:integration`에만 보이게 된다. 그 셋이 §7.5의 배타 분할이 성립하는 조건이다.
 *
 * | 상품 | `attributionYear` | `gross`·`taxableIncome` | 어디에 들어가는가 |
 * |---|---|---|---|
 * | 상환 완료·추정 | 그 연도 | 실제 값 | 그 해 `cumulativeNet` **또는** 구간 밖 |
 * | 적용 차수 없음 | `null` | `0` | 전 연도의 `remainingPrincipal` |
 *
 * **사건을 상품당 한 번만 읽는다** *(P8 컷 b0 — 종전 「`contributionOf`를 상품당 한 번」)*. 연도를 받는
 * `contributionOf`를 연도마다 부르면 상품 × 연도 번 부르고 그중 대부분이 버려진다. `incomeEventsOf`는
 * 사건마다 **그 사건 자신의 연도**를 싣고 오므로 상품 수만큼으로 끝나고, `contributionOf`도 같은 함수를
 * 접으므로(§4.6과 같은 사건 집합) 판정이 갈릴 수 없다. 항목은 **사건마다 하나**다 — 이 컷에서는 사건이
 * 상품당 최대 하나라 종전과 같다(`./income`).
 *
 * `0`을 넣는 것이 항목을 **버리는 것과 다르다** — 버리면 그 원금이 잔여 원금에서도 사라져
 * 화면에서 조용히 증발한다(§7.5 「배제하면」). 항목은 남고 유량만 0이다.
 */
export type ForecastProductItem = ForecastItem & {
  /** 추정 환율이 없어 원화 합계 열에서 뺐고 `excludedForeignCount`가 센다 (§4.7 v4.9) */
  excludedForeign: boolean
  /**
   * 원화 합계 열로 환산하는 데 쓴 추정 환율 — `excludedForeign`의 거울이다(P8 컷 a3). 원화 상품 · 기준
   * 연도 이전 상환(어느 열에도 없다) · 환율 없음(그쪽은 `excludedForeign`)이면 `null`
   */
  estimateRate: ExchangeRate | null
}

export function forecastItemsOf(
  row: ProductRow,
  asOf: string,
  /** 추정 환율 — 기본값이 없다(§4.0 규칙 2·3) */
  rates: EstimateRates,
): ForecastProductItem[] {
  const events = incomeEventsOf(row, asOf, rates)
  const items = events.map((event) => itemOf(row, asOf, rates, event.year, event))
  /*
   * **원금을 돌려주는 사건(상환)이 없으면 원금 항목을 하나 둔다** — 원금이 잔여 원금에 남아야 한다(§7.5
   * 「배제하면」). 그 항목의 귀속연도는 `attributionOf`가 정한다: 적용 차수가 없으면 `null`(전 연도의 잔여 원금 —
   * E-07의 시각적 형태), 차수는 있는데 계약 조건이 없으면(AQ-14 · AQ-65 — 계약 밖에서 차수를 넣은 경우) 그 차수의
   * 연도에 유량 0이다. 둘째 경우가 종전 `forecastItemOf`의 동작이며 이 컷은 그것을 바꾸지 않는다.
   *
   * 조건이 「사건이 없음」이 아니라 「원금을 돌려주는 사건이 없음」인 이유는 컷 b4다 — 월수익 사건만 있는 상품
   * (적용 차수 없음 · 흐름 끝 무한)은 사건이 있어도 원금을 돌려주지 않는다. 「사건이 없음」으로 두면 그 원금이
   * 화면에서 증발한다(반박 검토). 이 컷에서는 사건이 전부 상환이라 두 조건이 같다
   */
  if (!events.some((event) => event.kind === 'REDEMPTION')) {
    items.push(itemOf(row, asOf, rates, attributionOf(row, asOf).year, null))
  }
  return items
}

/**
 * 사건 하나(또는 사건 없음) → 항목 하나. 값은 종전 `forecastItemOf`와 같다 — 사건이 상품당 최대 하나이므로
 * 그 사건의 원금 반환분이 곧 투자원금이다(P8 컷 b0). 월수익 사건(컷 b4)은 원금 반환분이 0이라 이 사상이 그대로
 * 「원금은 상환 항목에만」을 지킨다.
 */
function itemOf(
  row: ProductRow,
  asOf: string,
  rates: EstimateRates,
  attributionYear: number | null,
  event: IncomeEvent | null,
): ForecastProductItem {
  const base = {
    /*
     * `null`은 적용 차수를 정할 수 없다는 뜻이며 **배제하지 않는다** — 전 연도의 잔여
     * 원금에 남아 「회수 시점을 모르는 자산」으로 보이는 것이 E-07의 시각적 형태다(§7.5).
     */
    attributionYear,
    // 원화다(과세 축). `null`(E-09)을 0으로 두는 것은 흡수가 아니다 — 그 상품은 아래 셋째
    // 분기로 가고 `excludedForeignCount`가 센다. 확정 원화 과세는 환율과 무관하게 여기 있다
    taxableIncome: event?.taxableIncomeKrw ?? ZERO,
  }
  const gross = event?.gross ?? ZERO
  // 사건이 없으면 원금은 그대로 남는다(잔여 원금) — 사건이 있으면 그 사건이 돌려주는 원금이다.
  // 둘 다 저장값 문자열이다 — 종전 항목의 표현 그대로다(`income.ts` `principalReturned`)
  const principal = event?.principalReturned ?? row.principal

  // 원화 상품 — 종전 그대로다. 환율 경로를 지나지 않는다(`x = 1`을 곱하는 것이 아니다)
  if (row.currency === 'KRW') {
    return {
      ...base,
      principal,
      gross,
      isEstimated: event?.isEstimated ?? false,
      excludedForeign: false,
      estimateRate: null,
    }
  }

  // 기준 연도 이전의 사건 — 어느 열에도 없다(DOC-007 §7.5 분할 표 둘째 줄). 환율이 있든 없든 세지 않는다.
  // 이 컷에서는 그런 사건이 상환뿐이다(추정 상환은 다음 도래 평가일이라 기준 연도 이전일 수 없다). 확정 여부를
  // 조건에 넣지 않는 이유는 컷 b4다 — 상환된 상품의 흐름 끝 안 무기록 월수익은 추정 사건이며 기준 연도 이전일 수
  // 있고(U5), 그것도 어느 열에도 없다(반박 검토)
  const outOfRange = event != null && event.year < currentYear(asOf)

  // 외화 · 추정 환율 있음 — 원금과 수령액을 **같은 `x`로** 바꾼다. 그래야 §7.5의 배타 분할
  // (한 상품의 원금은 잔여 원금 아니면 수령액 한쪽에만)이 원화 표에서도 선다. 확정 달러
  // 수령액도 원화로 더하는 순간 추정이다(ST-05) — 그래서 `isEstimated`가 참이다
  const rate = rates[row.currency]
  if (rate != null) {
    const x = dec(rate.rate)
    return {
      ...base,
      principal: dec(principal).times(x),
      gross: gross.times(x),
      isEstimated: true,
      excludedForeign: false,
      estimateRate: outOfRange ? null : rate,
    }
  }

  // 외화 · 추정 환율 없음 — 원화 합계 열에서 빼고 센다. **항목은 남긴다** — F의 확정 원화
  // 과세가 빠지지 않아야 한다(§4.6의 표 첫 줄). 기준 연도 이전 상환은 어느 열에도 없으므로
  // 세지 않는다(DOC-007 §7.5 분할 표 둘째 줄)
  return {
    ...base,
    principal: ZERO,
    gross: ZERO,
    isEstimated: event?.isEstimated ?? false,
    excludedForeign: !outOfRange,
    estimateRate: null,
  }
}

/**
 * 원화 합계 열에서 빠진 **외화 상품 수** (DOC-007 §7.5 · DOC-011 §4.7 「외화 상품 수」) — 상품별 항목 묶음을 받는다.
 *
 * 평탄화한 항목을 세면 사건이 여럿인 상품(컷 b4 — 월수익)이 여러 번 세진다. 이 컷에서는 상품당 항목이 하나라
 * 항목 수와 같다(반박 검토가 찾은 잠복 — 순수 함수로 떼어 「한 상품의 항목 여럿은 한 번」을 상시 스위트가 본다)
 */
export function excludedForeignCountOf(perProduct: readonly (readonly ForecastProductItem[])[]): number {
  return perProduct.filter((own) => own.some((item) => item.excludedForeign)).length
}

/**
 * 아홉째 조회 계약 — **산식을 갖지 않는다.**
 *
 * §7.5 전부가 `lib/tax/forecast.ts`에 있고 적용 차수는 `queries/attribution.ts`에 있다.
 * 이 모듈이 하는 일은 셋이다: 왕복 넷(세율 연도 · 프로필 · 상품 · 추정 환율)을 한 물결로 내고, 행 → `ForecastItem` 사상을
 * 만들고, 연도별 세법·프로필을 이월 규칙으로 붙인다.
 *
 * ## 왕복 4이며 연도 수에 비례하지 않는다
 *
 * 종전 3에 추정 환율 하나가 더해졌다(P8 컷 a3 — §4.0 규칙 2). 환율도 요청당 한 번이고 모든 연도에 같은 값을
 * 쓴다 — 연도별 전망 환율이 없다(DOC-007 RD-09). `loadAllTaxYears`가 시드된 연도를 **한 번에** 가져오고 `resolveTaxYear`(순수)를 연도마다
 * 재사용한다 — 여섯 연도의 컨텍스트를 얻기 위해 왕복을 여섯 번 하지 않는다. 그 분해는
 * P4 컷 8이 AQ-22를 부분 처리하며 만든 것이고 그 독블록이 이 재사용을 예고했다.
 * 프로필도 `.lte()` 한 번이며, 상품은 소유자 필터 하나다.
 *
 * ## 사건을 상품당 **한 번** 읽는다 *(P8 컷 b0)*
 *
 * 연도를 받는 `contributionOf`를 연도마다 부르면 상품 × 연도가 되고 여섯 중 다섯은 버려지는 호출이다.
 * `forecastItemsOf`가 `incomeEventsOf`를 상품당 한 번 읽어 **사건 자신의 연도로** 항목을 만든다. 같은 사건을
 * `contributionOf`(§4.6)도 접으므로 판정이 갈릴 수 없다 — 그 둘의 F 항등은 DOC-011 §4.7이 정한다.
 */
export function makeForecastQueries(ctx: QueryContext) {
  /**
   * §4.7 — **본인 전용이며 근거가 §4.6보다 강하다.**
   *
   * `tax_profiles`의 조회가 본인 한정이므로 타인의 전망은 `other_financial_income`을
   * `0`으로 읽어 조용히 과소 산출된다. §4.6은 한 해가 틀리고 **여기는 `years`개 연도가
   * 전부 틀리며** 이월 규칙이 그 오류를 뒤 연도로 연쇄시킨다.
   */
  async function getForecast(params: {
    ownerId: string
    years?: number
  }): Promise<ForecastRow[]> {
    if (params.ownerId !== ctx.viewerId) {
      throw new Error(
        `getForecast는 본인 전용이다 (요청 ${params.ownerId}, 조회자 ${ctx.viewerId}). ` +
          'tax_profiles의 조회가 본인 한정이므로 타인의 전망은 years개 연도가 전부 ' +
          '과소 산출되고 이월이 그 오류를 연쇄시킨다 (DOC-011 §4.7).',
      )
    }

    const years = params.years ?? FORECAST_DEFAULT_YEARS
    /*
     * **호출부의 프로그래밍 오류다**(§3.1의 시스템 오류) — 화면이 이 인자를 노출하지
     * 않으므로 조작된 주소가 이 축에 닿지 않는다. 그럼에도 계약이 검사하는 이유는
     * 화면 하나의 성질에 의존하지 않는다는 것이다(§4.7).
     */
    if (!Number.isInteger(years) || years < 1 || years > FORECAST_MAX_YEARS) {
      throw new Error(
        `전망 연수가 범위를 벗어났다: ${years}. 1 이상 ${FORECAST_MAX_YEARS} 이하의 ` +
          '정수여야 한다 (DOC-011 §4.7).',
      )
    }

    const startYear = currentYear(ctx.asOf)
    const throughYear = startYear + years - 1

    // 셋 다 ctx.asOf·ctx.viewerId만으로 출발하고 서로 의존하지 않는다 — 한 물결이다.
    // 추정 환율도 `ctx.asOf`에만 의존한다 — 같은 물결이다(왕복 3 → 4, §4.0 규칙 2)
    const [taxYearRows, profiles, products, rates] = await Promise.all([
      loadAllTaxYears(ctx),
      loadTaxProfiles(ctx, ctx.viewerId, throughYear),
      loadProducts(ctx, { ownerId: ctx.viewerId }),
      loadEstimateRates(ctx),
    ])

    // 모든 연도에 같은 추정 환율을 쓴다 — 연도별 전망 환율을 두지 않는다(DOC-007 RD-09)
    const perProduct = products.map((row) => forecastItemsOf(row, ctx.asOf, rates))
    const items = perProduct.flat()
    const excludedForeignCount = excludedForeignCountOf(perProduct)
    const exchangeRateBasis = exchangeRateBasisOf(
      items.find((item) => item.estimateRate != null)?.estimateRate ?? null,
      ctx.asOf,
    )

    const yearInputs: ForecastYearInput[] = []
    for (let offset = 0; offset < years; offset += 1) {
      const year = startYear + offset
      const yearContext = resolveTaxYear(taxYearRows, year)
      // 이월은 **`Y` 이하**의 가장 최근이며 `Y₀` 이하가 아니다 — `saveTaxProfile`이
      // 시드 연도로 제한하지 않으므로 미래 연도의 프로필이 실재한다(§4.7).
      const profile = profileFor(profiles, year)

      yearInputs.push({
        year,
        taxLawYear: yearContext.taxLawYear,
        brackets: toBrackets(yearContext),
        constants: toConstants(yearContext),
        otherIncomeBase: profile?.other_income_base ?? '0',
        otherFinancialIncome: profile?.other_financial_income ?? '0',
        subscriberType: profile?.health_insurance_type ?? 'NONE',
        profileYear: profile?.tax_year ?? null,
      })
    }

    /*
     * **상품 0건에서도 `years`개 행을 반환한다.** `[]`를 주면 상품 0건 + ELS 외
     * 금융소득이 있는 사용자에게서 세금 행이 사라져 §8.1의 E 부류를 재현한다 — 그
     * 사용자의 종합과세 여부와 보험료는 상품과 무관하게 실재한다. 「전망할 데이터
     * 없음」의 판정은 화면 층의 `isForecastEmpty`가 한다.
     */
    return forecastYears({ ownerId: ctx.viewerId, items, years: yearInputs }).map(
      (row) => ({
        year: row.year,
        taxLawYear: row.taxLawYear,
        profileYear: row.profileYear,
        grossProceeds: amountString(row.grossProceeds),
        financialIncome: amountString(row.financialIncome),
        thresholdGap: amountString(row.thresholdGap),
        isComprehensive: row.isComprehensive,
        effectiveRate: ratioString(row.effectiveRate),
        additionalTax: amountString(row.additionalTax),
        totalInsurance: amountString(row.totalInsurance),
        netProceeds: amountString(row.netProceeds),
        cumulativeNet: amountString(row.cumulativeNet),
        remainingPrincipal: amountString(row.remainingPrincipal),
        cumulativeAssets: amountString(row.cumulativeAssets),
        hasEstimates: row.hasEstimates,
        excludedForeignCount,
        exchangeRateBasis,
      }),
    )
  }

  return { getForecast }
}
