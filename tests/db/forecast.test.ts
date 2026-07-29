import { describe, expect, it } from 'vitest'

import { dec } from '@/lib/decimal'

import {
  FORECAST_DEFAULT_YEARS,
  FORECAST_MAX_YEARS,
  forecastItemOf,
} from '@/lib/db/queries/forecast'
import { profileFor, resolveTaxYear, type TaxProfileRow } from '@/lib/db/queries/load'

import { productRow, redemption, schedule } from './helpers/rows'

/**
 * §4.7 계약의 **순수 절반** — DB 없이 본다 (P4b 컷 7)
 *
 * `getForecast` 자체는 로더 셋을 부르므로 여기서 실행할 수 없고 `test:integration`이
 * 왕복과 형식을 본다. 그러나 그 계약이 **판단하는** 것은 셋이며 셋 다 순수 함수로 떼어져
 * 있다 — 행 → 항목 사상(`forecastItemOf`) · 프로필 이월(`profileFor`) · 연도별 세법
 * 근사(`resolveTaxYear`를 연도마다 재사용). 이 파일이 그 셋을 본다.
 *
 * **떼어 둔 이유가 관측 가능성이다.** 붙여 두면 「프로필이 아예 없는 사용자」와
 * 「2024년 것만 있는 사용자」를 만들려면 매번 DB를 세워야 하고, 그 상태 중 일부는
 * 커밋된 픽스처와 공존할 수 없다(AQ-34가 e2e 전용 사용자 둘로 닫은 것과 같은 부류다).
 */

const ASOF = '2026-06-30'

function profile(taxYear: number, overrides: Partial<TaxProfileRow> = {}): TaxProfileRow {
  return {
    user_id: '00000000-0000-4000-8000-0000000000a1',
    tax_year: taxYear,
    other_income_base: '0',
    other_financial_income: '0',
    health_insurance_type: 'NONE',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 행 → 항목 사상
// ---------------------------------------------------------------------------

describe('행 → `ForecastItem` 사상', () => {
  it('상환 완료 상품은 상환일의 연도에 유량으로 들어간다', () => {
    const item = forecastItemOf(
      productRow({ redemptions: redemption({ redemption_date: '2026-07-02' }) }),
      ASOF,
    )

    expect(item.attributionYear).toBe(2026)
    expect(dec(item.gross).toString()).toBe('104000000')
    expect(dec(item.taxableIncome).toString()).toBe('4000000')
    expect(item.isEstimated).toBe(false)
    // 원금은 항목에 항상 남는다 — 잔여 원금의 자료원이다.
    expect(item.principal).toBe('100000000')
  })

  it('미상환 상품은 다음 도래 평가일의 연도이고 추정이다', () => {
    // 기준일 2026-06-30이므로 1차(2026-07-02)가 다음 도래 차수다(§7.2).
    const item = forecastItemOf(productRow(), ASOF)

    expect(item.attributionYear).toBe(2026)
    expect(item.isEstimated).toBe(true)
    // 추정 기여는 `grossExpected`이므로 0이 아니다 — 0이면 유량이 사라진다.
    expect(dec(item.gross).isZero()).toBe(false)
  })

  it('★ 적용 차수가 없는 상품은 `null` + 유량 0이며 **항목이 남는다**', () => {
    /*
     * §7.5가 「배제하지 않는다」로 못 박은 자리다. 항목을 버리면 그 원금이 잔여 원금에서도
     * 사라져 화면에서 조용히 증발한다 — E-07(전 차수 경과 미상환)의 시각적 형태는 그
     * 원금이 여섯 행 전부에 남아 「회수 시점을 모르는 자산」으로 보이는 것이다.
     *
     * 그래서 `attributionYear`만 보지 않고 **`principal`이 살아 있는 것**을 함께 단언한다.
     */
    const item = forecastItemOf(productRow({ redemption_schedules: [] }), ASOF)

    expect(item.attributionYear).toBeNull()
    expect(dec(item.gross).isZero()).toBe(true)
    expect(dec(item.taxableIncome).isZero()).toBe(true)
    expect(item.principal).toBe('100000000')
  })

  it('전 차수가 경과했는데 미상환이면 적용 차수가 없다 — E-07', () => {
    const item = forecastItemOf(
      productRow({
        redemption_schedules: [
          schedule({ round_no: 1, evaluation_date: '2026-01-02' }),
          schedule({ round_no: 2, evaluation_date: '2026-04-02' }),
        ],
      }),
      ASOF,
    )

    expect(item.attributionYear).toBeNull()
    expect(item.principal).toBe('100000000')
  })

  it('만기 상환 + 일정 0건도 상환 완료로 잡힌다 — 유량이 사라지지 않는다', () => {
    // `attributionOf`의 분기 순서가 load-bearing인 것(컷 3)이 여기서도 값에 나타난다.
    const item = forecastItemOf(
      productRow({
        redemption_schedules: [],
        redemptions: redemption({ round_no: null, redemption_date: '2028-01-04' }),
      }),
      ASOF,
    )

    expect(item.attributionYear).toBe(2028)
    expect(dec(item.gross).isZero()).toBe(false)
  })

  it('비과세 계좌는 과세소득이 0이고 세전 회수는 남는다', () => {
    const item = forecastItemOf(
      productRow({
        account_type: 'TAX_FREE',
        redemptions: redemption({ redemption_date: '2026-07-02' }),
      }),
      ASOF,
    )

    expect(dec(item.taxableIncome).isZero()).toBe(true)
    expect(dec(item.gross).toString()).toBe('104000000')
  })
})

// ---------------------------------------------------------------------------
// 프로필 이월 (LOCF) — 세 상태
// ---------------------------------------------------------------------------

describe('`profileFor` — 세 상태를 하나의 값으로 표현한다', () => {
  it('그 해의 행이 있으면 그것을 고른다', () => {
    const chosen = profileFor([profile(2025), profile(2026), profile(2027)], 2026)
    expect(chosen?.tax_year).toBe(2026)
  })

  it('없으면 그 해 **이하**의 가장 최근을 고른다 — 이월', () => {
    const chosen = profileFor([profile(2022), profile(2024)], 2026)
    expect(chosen?.tax_year).toBe(2024)
  })

  it('아무것도 없으면 `null` — 호출부가 §4.6의 폴백을 적용한다', () => {
    expect(profileFor([], 2026)).toBeNull()
  })

  it('★ 미래 연도의 행을 고르지 않는다 — 그러면 뒤 연도 값이 앞 연도에 샌다', () => {
    /*
     * `saveTaxProfile`이 시드 연도로 제한하지 않으므로 2027년 프로필이 실재한다
     * (`tests/e2e/tax.test.ts`가 그 방법을 쓴다). 2026년 행이 2027년 값으로 계산되면
     * 오류도 빈 값도 아닌 **그럴싸한 숫자**가 된다.
     */
    const chosen = profileFor([profile(2027), profile(2031)], 2026)
    expect(chosen).toBeNull()
  })

  it('★ 입력 정렬에 의존하지 않는다 — 질의의 `order`가 사라져도 같은 답이다', () => {
    // 정렬에 기대면 다른 호출부가 정렬 없이 넘기는 날 조용히 틀린 연도를 고른다.
    const descending = [profile(2027), profile(2025), profile(2021), profile(2024)]
    expect(profileFor(descending, 2026)?.tax_year).toBe(2025)
  })

  it('이월된 행의 값이 그대로 쓰인다 — 연도만 고르는 것이 아니다', () => {
    const chosen = profileFor(
      [profile(2024, { other_financial_income: '7000000', health_insurance_type: 'REGIONAL' })],
      2026,
    )

    expect(chosen?.other_financial_income).toBe('7000000')
    expect(chosen?.health_insurance_type).toBe('REGIONAL')
  })
})

// ---------------------------------------------------------------------------
// 연도별 세법 — 시드가 하나면 여섯 행이 전부 근사다
// ---------------------------------------------------------------------------

describe('연도별 세율 연도 — `resolveTaxYear`를 연도마다 재사용한다', () => {
  const seeded2026 = [
    {
      tax_year: 2026,
      tax_brackets: [{ lower_bound: '0', rate: '0.0600', progressive_deduction: '0' }],
      tax_constants: [{ key: 'x', value: '0' }],
    },
  ] as unknown as Parameters<typeof resolveTaxYear>[0]

  it('★ 시드가 2026 하나면 기본 6년의 첫 행만 정확하고 나머지 다섯이 근사다', () => {
    /*
     * §4.7이 `taxLawYear`를 **행 단위**로 담는 이유다 — 2027이 시드되는 날 2026·2027행은
     * 정확해지고 2028~행은 근사로 남아 **한 행 안에서 갈린다.** 계약 단위 하나로 두면
     * 화면이 「이 표 전체가 근사」와 「이 행이 근사」를 구분해 말할 수 없다.
     */
    const lawYears = Array.from({ length: FORECAST_DEFAULT_YEARS }, (_, offset) =>
      resolveTaxYear(seeded2026, 2026 + offset).taxLawYear,
    )

    expect(lawYears).toEqual([2026, 2026, 2026, 2026, 2026, 2026])
    // 근사 여부는 `taxLawYear !== year`이므로 첫 행만 정확하다.
    const approximated = lawYears.filter((lawYear, offset) => lawYear !== 2026 + offset)
    expect(approximated).toHaveLength(FORECAST_DEFAULT_YEARS - 1)
  })

  it('상한까지 늘려도 같은 시드 하나에서 나온다 — 왕복이 연도 수에 비례하지 않는 근거', () => {
    const lawYears = Array.from({ length: FORECAST_MAX_YEARS }, (_, offset) =>
      resolveTaxYear(seeded2026, 2026 + offset).taxLawYear,
    )
    expect(new Set(lawYears)).toEqual(new Set([2026]))
  })
})

// ---------------------------------------------------------------------------
// 상수 둘
// ---------------------------------------------------------------------------

describe('전망 연수 상수', () => {
  it('기본은 6이다 — AQ-08 확정', () => {
    expect(FORECAST_DEFAULT_YEARS).toBe(6)
  })

  it('★ 상한이 기본값보다 **크다** — 같으면 `years` 인자가 장식이 된다', () => {
    /*
     * AQ-08이 「기본값을 상수로 두는 것과 인자를 없애는 것은 다르다」로 인자를 남겼다.
     * 상한과 기본값이 같으면 그 판단이 성립하지 않는다 — 유일하게 유효한 값이 기본값
     * 하나가 되므로 인자를 받는 의미가 사라진다. **이 부등호가 그 결정의 코드 측 짝이다.**
     *
     * 값 자체(20)에는 도메인 의미가 없다(DOC-011 §4.7 v2.5) — 그래서 「20이다」로 박지
     * 않고 만족해야 하는 성질로 박는다.
     */
    expect(FORECAST_MAX_YEARS).toBeGreaterThan(FORECAST_DEFAULT_YEARS)
  })
})
