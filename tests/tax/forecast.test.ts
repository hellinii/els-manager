import { describe, expect, it } from 'vitest'

import { dec } from '@/lib/decimal'
import { forecastYears, type ForecastItem, type ForecastYearInput } from '@/lib/tax'

import { BRACKETS_2026, CONSTANTS_2026 } from '../fixtures/tax-2026'

/**
 * 다년도 누적과 잔여 원금 — DOC-007 §7.5
 *
 * **§7.5의 검산을 상시 케이스로 고정한다.** 그 문서가 손 유도가 아니라 이 파일의
 * 실행 결과로 검증되어야 하는 이유는 두 값이 **이중 계상 스위치**에 걸려 있다는
 * 것이다 — 측정 시점을 기준일로 두면 `asOf` 이후 같은 해에 상환되는 상품이 유량과
 * 저량 양쪽에 잡혀 그 상품의 원금만큼 과대해지는데, **그 오류는 화면에서 「합계가
 * 조금 크다」로만 보인다.** 값 하나가 아니라 두 경로의 일치를 함께 단언한다.
 *
 * DB에 접근하지 않는다. 세율·상수는 픽스처로 주입하며 그것이 마이그레이션 시드와
 * 일치하는지는 `tests/seed/tax-2026-agreement.test.ts`가 본다(AQ-05).
 */

const OWNER = '00000000-0000-4000-8000-0000000000a1'

/** §7.5의 검산 시나리오 — A(2026 상환 가정) · B(2029 상환 가정), 둘 다 원금 1억 */
const A: ForecastItem = {
  principal: '100000000',
  attributionYear: 2026,
  gross: '110000000', // 원금 1억 + 쿠폰 1천만 — **원금 반환분을 포함한다**
  taxableIncome: '10000000',
  isEstimated: true,
}

const B: ForecastItem = {
  principal: '100000000',
  attributionYear: 2029,
  gross: '130000000', // 원금 1억 + 쿠폰 3천만
  taxableIncome: '30000000',
  isEstimated: true,
}

function year(y: number, overrides: Partial<ForecastYearInput> = {}): ForecastYearInput {
  return {
    year: y,
    // 시드는 2026 하나이므로 그 이후 연도는 전부 근사다(DOC-011 §4.6).
    taxLawYear: 2026,
    brackets: BRACKETS_2026,
    constants: CONSTANTS_2026,
    otherIncomeBase: '0',
    otherFinancialIncome: '0',
    subscriberType: 'REGIONAL',
    profileYear: null,
    ...overrides,
  }
}

const RANGE = [2026, 2027, 2028, 2029, 2030, 2031].map((y) => year(y))

function run(items: readonly ForecastItem[], years = RANGE) {
  return forecastYears({ ownerId: OWNER, items, years })
}

describe('§7.5 검산 — 연도 말 기준이 이중 계상을 막는다', () => {
  const rows = run([A, B])
  const at = (y: number) => rows.find((r) => r.year === y)!

  it('여섯 행이 나온다 — 상환이 없는 해에도 행이 있다 (AQ-08: 기본 6)', () => {
    // 항목이 없는 연도의 행을 만들지 않는 `aggregateFinancialIncomeByOwnerYear`를
    // 쓰지 않는 이유가 이것이다 — 2027·2028에도 잔여 원금과 누적이 필요하다.
    expect(rows.map((r) => r.year)).toEqual([2026, 2027, 2028, 2029, 2030, 2031])
  })

  it('2026 — F가 기준금액 이하이므로 분리과세로 종결된다', () => {
    const r = at(2026)
    expect(r.financialIncome.toFixed(0)).toBe('10000000')
    expect(r.isComprehensive).toBe(false)
    expect(r.thresholdGap.toFixed(0)).toBe('-10000000')
    expect(r.effectiveRate.toFixed(5)).toBe('0.15400')
    expect(r.additionalTax.toFixed(0)).toBe('0')
    // 지역가입 문턱이 **초과**이므로 1,000만원 정확히는 0이다(§10.3 TC-10과 같은 경계).
    expect(r.totalInsurance.toFixed(0)).toBe('0')
  })

  it('★ 2026 누적 자산 = 208,460,000 — 기준일 기준의 308,460,000이 아니다', () => {
    const r = at(2026)
    // 유량: 110,000,000 − 10,000,000 × 0.154 = 108,460,000
    expect(r.netProceeds.toFixed(0)).toBe('108460000')
    // 저량: A는 그 해에 상환되었으므로 B의 1억만 남는다 — **연도 말 기준**이다.
    expect(r.remainingPrincipal.toFixed(0)).toBe('100000000')
    expect(r.cumulativeAssets.toFixed(0)).toBe('208460000')

    // ★ 기준일(2026-07-28)에서 재면 A가 아직 미상환이라 잔여 원금이 2억이 되고
    //   같은 해 유량에도 A의 회수가 들어간다 → 308,460,000. **정확히 A의 원금만큼**
    //   과대하며, 그 값이 나오지 않는 것이 이 케이스의 내용이다.
    expect(r.cumulativeAssets.toFixed(0)).not.toBe('308460000')
    expect(r.cumulativeAssets.plus(dec(A.principal)).toFixed(0)).toBe('308460000')
  })

  it('2029 — 기준금액 초과인데 추가납부가 0인 것이 정상이다 (§5.5)', () => {
    const r = at(2029)
    expect(r.financialIncome.toFixed(0)).toBe('30000000')
    expect(r.isComprehensive).toBe(true)
    expect(r.thresholdGap.toFixed(0)).toBe('10000000')
    // 방식①(4,200,000) > 방식②(3,400,000) → 총세액이 원천징수액과 같아진다.
    // 분기점은 77,600,000이며 §10.1 TC-01·TC-02가 그 사이 구간을 고정한다.
    expect(r.additionalTax.toFixed(0)).toBe('0')
    expect(r.effectiveRate.toFixed(5)).toBe('0.15400')
    expect(r.netProceeds.toFixed(0)).toBe('125380000')
  })

  it('★ 2029 누적 자산 = 233,840,000 — 두 경로의 검산이 일치한다', () => {
    const r = at(2029)
    expect(r.remainingPrincipal.toFixed(0)).toBe('0')
    expect(r.cumulativeAssets.toFixed(0)).toBe('233840000')

    // ★ 다른 경로: 투입 2억 + 쿠폰 4천만 − 세금 616만.
    //   두 식이 같은 값을 내는 것이 **배타적·전체적 분할이 성립한다는 증거**다.
    const byComposition = dec('200000000').plus(dec('40000000')).minus(dec('6160000'))
    expect(r.cumulativeAssets.toFixed(0)).toBe(byComposition.toFixed(0))
    // 세금 616만의 분해 — 2026년 154만 + 2029년 462만
    expect(dec('1540000').plus(dec('4620000')).toFixed(0)).toBe('6160000')
  })

  it('2029 보험료 합계 = 2,440,429 — 누적 자산에서 차감되지 않는다', () => {
    const r = at(2029)
    // 건강보험료 2,157,000 + 장기요양 283,429. §7.4가 세액만 반영하므로 누계도
    // 같은 기준이며, 이 값은 표의 별 열이다(A-06 — 세대를 모델링하지 않는다).
    expect(r.totalInsurance.toFixed(0)).toBe('2440429')
    expect(r.cumulativeAssets.toFixed(0)).toBe('233840000')
  })

  it('상환이 없는 해는 유량이 0이고 누적은 유지된다', () => {
    for (const y of [2027, 2028]) {
      const r = at(y)
      expect(r.grossProceeds.toFixed(0)).toBe('0')
      expect(r.netProceeds.toFixed(0)).toBe('0')
      expect(r.cumulativeNet.toFixed(0)).toBe('108460000')
      expect(r.remainingPrincipal.toFixed(0)).toBe('100000000')
      expect(r.cumulativeAssets.toFixed(0)).toBe('208460000')
    }
  })

  it('상환이 끝난 뒤에도 누적은 남는다 — 저량만 0이 된다', () => {
    for (const y of [2030, 2031]) {
      const r = at(y)
      expect(r.remainingPrincipal.toFixed(0)).toBe('0')
      expect(r.cumulativeAssets.toFixed(0)).toBe('233840000')
    }
  })
})

describe('배타적·전체적 분할 — 네 부류가 전부 닫힌다', () => {
  it('한 항목은 두 항 중 정확히 하나에만 들어간다', () => {
    // `gross`가 원금 반환분을 포함하므로 성립한다(§4.1). 상환된 해에는 원금이
    // 유량으로 들어오고 잔여에서 빠진다 — 두 곳에 동시에 있지 않다.
    const rows = run([A])
    const before = rows.find((r) => r.year === 2026)!

    expect(before.netProceeds.gt(0)).toBe(true)
    expect(before.remainingPrincipal.toFixed(0)).toBe('0')
  })

  it('`attributionYear > Y`인 항목은 잔여 원금에만 들어간다', () => {
    const rows = run([B])
    const r = rows.find((r) => r.year === 2027)!

    expect(r.grossProceeds.toFixed(0)).toBe('0')
    expect(r.remainingPrincipal.toFixed(0)).toBe('100000000')
    expect(r.cumulativeAssets.toFixed(0)).toBe('100000000')
  })

  it('★ `attributionYear < Y₀`인 항목은 어느 항에도 없다 — 이름의 근거다', () => {
    // 이것이 `totalAssets`가 아니라 `cumulativeAssets`인 이유다(§7.5의 분할 표
    // 둘째 줄). 2020년에 상환된 상품은 유량 구간 밖이고 이미 상환되었으므로 저량도
    // 아니다 — 즉 이 값은 「보유 자산의 총액」이 아니라 전망 구간 안의 누적이다.
    const past: ForecastItem = { ...A, attributionYear: 2020 }
    const rows = run([past])

    for (const r of rows) {
      expect(r.grossProceeds.toFixed(0)).toBe('0')
      expect(r.remainingPrincipal.toFixed(0)).toBe('0')
      expect(r.cumulativeAssets.toFixed(0)).toBe('0')
    }
  })

  it('★ 적용 차수를 정할 수 없는 항목은 전 연도의 잔여 원금에 남는다', () => {
    // E-07(전 차수 경과 미상환)·평가일정 0건. **배제하면 그 원금이 화면에서 조용히
    // 증발한다** — 여섯 행 전부에 남는 것이 정확한 표현이며 E-07의 시각적 형태다.
    const noRound: ForecastItem = { ...A, attributionYear: null }
    const rows = run([noRound])

    for (const r of rows) {
      expect(r.remainingPrincipal.toFixed(0)).toBe('100000000')
      expect(r.grossProceeds.toFixed(0)).toBe('0')
      expect(r.hasEstimates).toBe(true)
    }
  })
})

describe('추정 표식은 행 축이다', () => {
  it('확정 상환만 남은 해는 추정이 아니다', () => {
    const confirmed: ForecastItem = { ...A, isEstimated: false }
    const rows = run([confirmed])

    expect(rows.find((r) => r.year === 2026)!.hasEstimates).toBe(false)
    // 상환이 끝났고 남은 항목도 없으므로 이후 행도 확정이다.
    expect(rows.find((r) => r.year === 2031)!.hasEstimates).toBe(false)
  })

  it('연도 말에 남은 미상환 항목이 있으면 그 행은 추정이다', () => {
    // 잔여 원금 자체가 적용 차수 가정에 의존하므로, 그 해에 상환이 없어도 추정이다 —
    // 아니면 화면이 「확정」이라 말하면서 시점을 모르는 원금을 보여준다.
    const rows = run([{ ...A, isEstimated: false }, B])

    expect(rows.find((r) => r.year === 2027)!.hasEstimates).toBe(true)
    expect(rows.find((r) => r.year === 2029)!.hasEstimates).toBe(true)
    expect(rows.find((r) => r.year === 2030)!.hasEstimates).toBe(false)
  })
})

describe('빈 입력과 전제', () => {
  it('상품이 0건이어도 years개 행을 반환한다 — `[]`가 아니다', () => {
    // `[]`를 주면 상품 0건 + ELS 외 금융소득이 있는 사용자에게서 세금 행이 사라져
    // DOC-011 §8.1의 E 부류를 재현한다(SCR-101의 빈 상태 분기와 같은 형태).
    const rows = run([])

    expect(rows).toHaveLength(6)
    expect(rows.every((r) => r.cumulativeAssets.isZero())).toBe(true)
  })

  it('ELS 외 금융소득만 있어도 종합과세가 성립한다', () => {
    const rows = forecastYears({
      ownerId: OWNER,
      items: [],
      years: [year(2026, { otherFinancialIncome: '30000000' })],
    })

    expect(rows[0]!.financialIncome.toFixed(0)).toBe('30000000')
    expect(rows[0]!.isComprehensive).toBe(true)
  })

  it('구간이 오름차순 연속이 아니면 거부한다 — 누계가 순서에 의존한다', () => {
    expect(() =>
      forecastYears({ ownerId: OWNER, items: [], years: [year(2026), year(2028)] }),
    ).toThrow(/오름차순 연속/)
    expect(() =>
      forecastYears({ ownerId: OWNER, items: [], years: [year(2027), year(2026)] }),
    ).toThrow(/오름차순 연속/)
  })

  it('구간이 비어 있으면 거부한다', () => {
    expect(() => forecastYears({ ownerId: OWNER, items: [], years: [] })).toThrow(
      /비어 있다/,
    )
  })

  it('프로필 출처 연도와 세율 연도를 그대로 나른다 — 행 단위다', () => {
    const rows = forecastYears({
      ownerId: OWNER,
      items: [],
      years: [
        year(2026, { taxLawYear: 2026, profileYear: 2026 }),
        year(2027, { taxLawYear: 2026, profileYear: 2026 }),
      ],
    })

    expect(rows.map((r) => [r.year, r.taxLawYear, r.profileYear])).toEqual([
      [2026, 2026, 2026],
      [2027, 2026, 2026], // 근사 + 이월
    ])
  })
})
