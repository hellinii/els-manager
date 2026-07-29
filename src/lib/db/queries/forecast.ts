import { ZERO } from '@/lib/decimal'
import {
  forecastYears,
  type ForecastItem,
  type ForecastYearInput,
} from '@/lib/tax'

import { currentYear } from '../today'
import { attributionOf } from './attribution'
import type { QueryContext } from './context'
import {
  loadAllTaxYears,
  loadProducts,
  loadTaxProfiles,
  profileFor,
  resolveTaxYear,
  type ProductRow,
} from './load'
import { amountString, ratioString } from './map'
import { contributionOf, toBrackets, toConstants } from './tax'

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
  /** 이 행의 값이 적용 차수 가정에 의존한다 (§7.5의 **행 축**) */
  hasEstimates: boolean
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
 * **`contributionOf`를 상품당 한 번만 부른다.** 그 함수는 연도를 받아 귀속연도가 다르면
 * `null`을 내므로, 연도마다 부르면 상품 × 연도 번 부르고 그중 대부분이 버려진다. 적용
 * 차수를 `attributionOf`로 먼저 읽고 **그 상품 자신의 연도로** 부르면 상품 수만큼으로 끝난다.
 * 두 함수가 같은 `attributionOf`를 쓰므로(컷 3의 단일 원천) 판정이 갈릴 수 없다.
 *
 * `0`을 넣는 것이 항목을 **버리는 것과 다르다** — 버리면 그 원금이 잔여 원금에서도 사라져
 * 화면에서 조용히 증발한다(§7.5 「배제하면」). 항목은 남고 유량만 0이다.
 */
export function forecastItemOf(row: ProductRow, asOf: string): ForecastItem {
  const attribution = attributionOf(row, asOf)
  const contribution =
    attribution.year == null ? null : contributionOf(row, attribution.year, asOf)

  return {
    principal: row.principal,
    /*
     * `null`은 적용 차수를 정할 수 없다는 뜻이며 **배제하지 않는다** — 전 연도의 잔여
     * 원금에 남아 「회수 시점을 모르는 자산」으로 보이는 것이 E-07의 시각적 형태다(§7.5).
     */
    attributionYear: attribution.year,
    gross: contribution?.gross ?? ZERO,
    taxableIncome: contribution?.amount ?? ZERO,
    isEstimated: contribution?.isEstimated ?? false,
  }
}

/**
 * 아홉째 조회 계약 — **산식을 갖지 않는다.**
 *
 * §7.5 전부가 `lib/tax/forecast.ts`에 있고 적용 차수는 `queries/attribution.ts`에 있다.
 * 이 모듈이 하는 일은 셋이다: 왕복 셋을 한 물결로 내고, 행 → `ForecastItem` 사상을
 * 만들고, 연도별 세법·프로필을 이월 규칙으로 붙인다.
 *
 * ## 왕복 3이며 연도 수에 비례하지 않는다
 *
 * `loadAllTaxYears`가 시드된 연도를 **한 번에** 가져오고 `resolveTaxYear`(순수)를 연도마다
 * 재사용한다 — 여섯 연도의 컨텍스트를 얻기 위해 왕복을 여섯 번 하지 않는다. 그 분해는
 * P4 컷 8이 AQ-22를 부분 처리하며 만든 것이고 그 독블록이 이 재사용을 예고했다.
 * 프로필도 `.lte()` 한 번이며, 상품은 소유자 필터 하나다.
 *
 * ## `contributionOf`를 상품당 **한 번** 부른다
 *
 * 그 함수는 연도를 인자로 받아 귀속연도가 다르면 `null`을 낸다. 연도마다 부르면
 * 상품 × 연도가 되고 여섯 중 다섯은 버려지는 호출이다. 적용 차수를 `attributionOf`로
 * 먼저 읽고 **그 상품 자신의 연도로** 한 번 부르면 같은 결과를 상품 수만큼의 호출로 얻는다.
 * 두 함수가 같은 `attributionOf`를 쓰므로(컷 3이 단일 원천으로 모았다) 판정이 갈릴 수 없다.
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
    const [taxYearRows, profiles, products] = await Promise.all([
      loadAllTaxYears(ctx),
      loadTaxProfiles(ctx, ctx.viewerId, throughYear),
      loadProducts(ctx, { ownerId: ctx.viewerId }),
    ])

    const items = products.map((row) => forecastItemOf(row, ctx.asOf))

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
      }),
    )
  }

  return { getForecast }
}
