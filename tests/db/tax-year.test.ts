import { describe, expect, it } from 'vitest'

import { TaxSeedRangeError, resolveTaxYear, type TaxYearRow } from '@/lib/db/queries/load'

/**
 * 세율 연도 해석 — **AQ-22 부분 처리** (P4 컷 8)
 *
 * ## 왜 순수 함수로 뗐는가
 *
 * `loadTaxYearContext`는 I/O와 판정을 함께 했다. 그러면 판정의 세 분기를 실행하는
 * 유일한 방법이 DB 상태를 만드는 것이 되는데, **시드가 아예 없는 분기는 통합
 * 스위트로 관측할 수 없다** — 그 상태를 만들면 다른 216건이 함께 죽는다. 컷 6이
 * `TaxSeedRangeError`의 **분류**를 순수 함수로 뗀 것과 같은 이유이며, 이번에는
 * 그것을 던지는 쪽을 뗀다.
 *
 * 나머지 절반(Q-06 절단 방어)은 `loadAllTaxYears`에 붙었고 여기서는 보이지 않는다 —
 * 그쪽은 PostgREST 응답의 성질이므로 통합 스위트의 자리다.
 *
 * ## 픽스처가 실제 행 모양과 갈리지 않게
 *
 * 행 타입을 계약에서 가져오므로(`TaxYearRow`) 열이 늘면 여기서 컴파일이 깨진다.
 * 값은 판정에 쓰이지 않으므로(개수만 본다) 최소한만 채운다 — **그 사실 자체가
 * 이 함수의 성질**이다: 구간·상수의 내용이 아니라 **존재**가 시드 여부를 정한다.
 */

function row(taxYear: number, options: { brackets?: number; constants?: number } = {}): TaxYearRow {
  const brackets = options.brackets ?? 1
  const constants = options.constants ?? 1
  return {
    tax_year: taxYear,
    tax_brackets: Array.from({ length: brackets }, (_, index) => ({
      lower_bound: String(index * 10_000_000),
      rate: '0.0600',
      progressive_deduction: '0',
    })),
    tax_constants: Array.from({ length: constants }, () => ({
      key: 'comprehensive_taxation_threshold',
      value: '20000000',
    })),
  }
}

describe('시드된 연도', () => {
  it('그 연도의 값을 쓰고 `taxLawYear`가 같다', () => {
    const ctx = resolveTaxYear([row(2026), row(2027)], 2026)
    expect(ctx.taxLawYear).toBe(2026)
    expect(ctx.brackets).toHaveLength(1)
  })

  it('`seededYears`가 오름차순 전체다 — 연도 선택기의 하한이 여기서 나온다', () => {
    /*
     * ★ §4.6 v1.9. 화면이 범위를 추측하면(「올해 − 5년」) 시드보다 과거인 선택지가
     * 생기고, 그것을 고르면 **오류 화면**으로 간다 — 사용자에게 제시된 항목이 앱을
     * 멈추는 형태다.
     */
    expect(resolveTaxYear([row(2027), row(2026)], 2026).seededYears).toEqual([2026, 2027])
  })

  it('질의의 순서에 기대지 않는다', () => {
    // 입력이 뒤섞여도 최신·최초 판정이 같아야 한다 — `order`는 질의의 성질이고
    // 이 함수의 성질이 아니다.
    const ctx = resolveTaxYear([row(2028), row(2026), row(2027)], 2029)
    expect(ctx.taxLawYear).toBe(2028)
  })
})

describe('시드 범위 밖', () => {
  it('미래는 최신 시드로 근사한다 — 던지지 않는다', () => {
    /*
     * 이 규칙이 없으면 **2027-01-01에 홈 화면이 코드 변경 없이 죽는다**(§4.1의
     * `currentYearTax`도 당해 연도 구간을 요구한다).
     */
    const ctx = resolveTaxYear([row(2026)], 2030)
    expect(ctx.taxLawYear).toBe(2026)
    // 근사임을 화면이 알 수 있다 — 요청 연도와 다르다는 것이 곧 신호다(§4.6).
    expect(ctx.taxLawYear).not.toBe(2030)
  })

  it('과거는 거부한다 — 전용 타입이다', () => {
    /*
     * 뒤 연도의 법으로 과거를 계산하면 ADR-005가 보장하려는 재현성(K-08의 전제)이
     * 깨진다. **타입이 전용인 이유는 §5.4가 이 하나만 `VALIDATION_FAILED`로
     * 옮기기 때문**이며(컷 6), 문구 정규식으로 분류하지 않기 위함이다.
     */
    expect(() => resolveTaxYear([row(2026)], 2025)).toThrow(TaxSeedRangeError)
    try {
      resolveTaxYear([row(2026), row(2027)], 2024)
    } catch (error) {
      expect(error).toBeInstanceOf(TaxSeedRangeError)
      // 가장 이른 시드를 가리킨다 — 최신이 아니다(그러면 안내가 틀린 연도를 말한다).
      expect((error as TaxSeedRangeError).earliestSeeded).toBe(2026)
      expect((error as TaxSeedRangeError).year).toBe(2024)
    }
  })
})

describe('시드가 아예 없다', () => {
  /**
   * ★ **이 분기는 통합 스위트로 관측할 수 없다.** 시드를 지운 DB를 만들면 다른
   * 216건이 함께 죽으므로, 순수 함수로 떼어 두는 것이 이 분기를 보는 유일한 방법이다.
   */
  it('`TaxSeedRangeError`가 아니라 일반 예외다 — 사용자가 고칠 수 없다', () => {
    expect(() => resolveTaxYear([], 2026)).toThrow(/마이그레이션이 적용되지 않았다/)
    /*
     * 타입으로 갈라야 하는 이유가 여기다(컷 6의 결정). 합치면 마이그레이션 미적용이
     * 「징수액을 입력하라」로 보고되고 사용자가 몇 번을 입력해도 같은 오류가 난다 —
     * §3.2가 `INTERNAL`을 「사용자가 고칠 수 없는 것」으로 정의한 이유다.
     */
    expect(() => resolveTaxYear([], 2026)).not.toThrow(TaxSeedRangeError)
  })

  it('한쪽만 있는 연도는 시드가 아니다 — 구간만·상수만', () => {
    /*
     * ★ 통과시키면 `calculateHealthInsurance`가 **상수 부재로** 죽는다. 그 실패는
     * 세율 조회가 아니라 계산에서 나타나므로 원인이 가려진다 — 「같은 왕복으로
     * 셋을 읽는다」던 D7의 근거가 이 검사에 걸려 있다.
     */
    expect(() => resolveTaxYear([row(2026, { constants: 0 })], 2026)).toThrow(
      /마이그레이션이 적용되지 않았다/,
    )
    expect(() => resolveTaxYear([row(2026, { brackets: 0 })], 2026)).toThrow(
      /마이그레이션이 적용되지 않았다/,
    )
    // 그리고 그 연도는 선택지에도 없다 — 고르면 위 예외가 되는 항목이다.
    const ctx = resolveTaxYear([row(2026), row(2027, { constants: 0 })], 2026)
    expect(ctx.seededYears).toEqual([2026])
  })
})
