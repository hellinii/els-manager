import { describe, expect, it } from 'vitest'
import { dec } from '@/lib/decimal'
import { grossExpected, taxableIncome } from '@/lib/domain'
import { calculateFinancialIncomeTax } from '@/lib/tax/comprehensive'
import { separateTaxationWithholding } from '@/lib/tax/withholding'
import { BRACKETS_2026, CONSTANTS_2026 } from '../fixtures/tax-2026'

/**
 * 분리과세 원천징수 — DOC-007 §4.5 · §5.5 (P6 컷 6, DOC-010 AQ-67)
 *
 * ## 이 파일이 있는 이유는 「검산이 TC가 아니기 때문」이다
 *
 * §4.5의 산식은 §10의 TC-01~22에 넣지 않았다 — 그 문자열이 CLAUDE.md 절대 규칙 #1과
 * 저장소 여러 곳에 박혀 있어 스물셋째를 더하면 인용이 전부 낡는다. 대신 §4.5 본문의
 * **검산 블록**을 이 파일이 실행한다. 즉 여기가 그 산식의 유일한 관측 지점이다.
 *
 * ## 요율을 리터럴로 적지 않는다
 *
 * `'0.154'`를 쓰면 절대 규칙 #5의 반대편 위험이 된다 — 테스트가 자기 사본을 갖고,
 * 시드가 바뀌어도 초록으로 남는다. `CONSTANTS_2026`을 쓰면 `tests/seed/`의 시드 대조
 * (AQ-05)가 그 픽스처를 마이그레이션과 묶어 주므로 **같은 보장을 탄다.**
 */

const withhold = (income: string) =>
  separateTaxationWithholding({
    taxableIncome: income,
    constants: CONSTANTS_2026,
  }).toString()

describe('DOC-007 §4.5 검산 — 실보유 상품의 증권사 대조표와 원 단위 일치', () => {
  /* 실보유 ELS 한 건. P = 5천만 · r = 17.22% · 6개월 주기 */
  const PRINCIPAL = '50000000'
  const ROUND_1_GROSS = '54305000'

  it('예상 수령액이 54,305,000이다 — P × (1 + r × 6/12)', () => {
    const gross = grossExpected({
      principal: PRINCIPAL,
      couponRate: '0.1722',
      evaluationPeriodMonths: 6,
      roundNo: 1,
    })
    expect(gross.toString()).toBe(ROUND_1_GROSS)
  })

  it('과세 금융소득이 4,305,000이다 — max(0, 세전 − 원금)', () => {
    const income = taxableIncome({
      accountType: 'GENERAL',
      principal: PRINCIPAL,
      redemption: null,
      expectedGross: ROUND_1_GROSS,
    })
    expect(income.toString()).toBe('4305000')
  })

  it('예상 원천징수가 662,970이다', () => {
    expect(withhold('4305000')).toBe('662970')
  })

  it('세후 예상 수령액이 53,642,030이다 — 세전 − 원천징수', () => {
    const net = dec(ROUND_1_GROSS).minus(dec(withhold('4305000')))
    expect(net.toString()).toBe('53642030')
  })

  /*
   * 비과세 계좌는 §4.3이 과세 금융소득을 0으로 정하므로 곱셈이 0이 되고
   * **세후 = 세전**이다. 이 분기가 §4.5에 명시적으로 적힌 이유는 「곱해서 0」과
   * 「부과 대상이 아님」을 화면이 다르게 말해야 하기 때문이며, 값의 층에서는
   * 여기가 그 성질의 유일한 단언이다.
   */
  it('TAX_FREE는 원천징수 0 — 세후가 세전과 같다', () => {
    const income = taxableIncome({
      accountType: 'TAX_FREE',
      principal: PRINCIPAL,
      redemption: null,
      expectedGross: ROUND_1_GROSS,
    })
    expect(income.toString()).toBe('0')
    expect(withhold(income.toString())).toBe('0')
  })
})

describe('요율의 «선택»이 함수의 몫이다', () => {
  /*
   * ★ 이 케이스가 이 파일에서 가장 값이 크다.
   *
   * `TaxConstants`에는 0.154와 0.14가 둘 다 있고 차이가 정확히 지방소득세분이다.
   * 함수가 요율을 인자로 열어 두었다면 호출부가 고르게 되고, **잘못 고른 결과는
   * 그럴싸한 숫자다** — 602,700은 662,970과 자릿수도 모양도 같아서 어느 눈대중에도
   * 걸리지 않는다. 음성 대조로 그 값을 박아 둔다: 구현이 소득세율로 바뀌면 위
   * 검산과 함께 «두» 케이스가 죽고, 그중 하나가 그 이유를 말한다.
   */
  it('분리과세율(15.4%)이지 분리과세 소득세율(14%)이 아니다', () => {
    expect(withhold('4305000')).toBe('662970')
    expect(withhold('4305000')).not.toBe(
      dec('4305000').times(dec(CONSTANTS_2026.separateTaxationIncomeTaxRate)).toString(),
    )
  })
})

describe('절사가 함수 안에 있다 (RD-01)', () => {
  /*
   * 소수가 나오는 입력이어야 절사가 관측된다. 위 검산의 값들은 전부 정수라
   * 단위 선택과 무관하며(TC-01~22가 가진 성질과 같다) 이 축을 보지 못한다.
   */
  it('원 단위로 버린다 — 반올림하지 않는다', () => {
    // 1,000,001 × 0.154 = 154,000.154
    expect(withhold('1000001')).toBe('154000')
    // 1,000,005 × 0.154 = 154,000.77 — 반올림이면 154,001이 된다
    expect(withhold('1000005')).toBe('154000')
  })

  it('절사 단위를 주입하면 그 단위로 버린다', () => {
    const byTenThousand = separateTaxationWithholding({
      taxableIncome: '4305000',
      constants: CONSTANTS_2026,
      rounding: { unit: '10000', mode: 'TRUNCATE' },
    })
    expect(byTenThousand.toString()).toBe('660000')
  })

  it('0은 0이다', () => {
    expect(withhold('0')).toBe('0')
  })
})

describe('§5.5의 withheld(F)가 같은 함수를 지난다 (AQ-67)', () => {
  /*
   * 리팩터링이 값을 보존했는지는 TC-01~22가 지키지만, **두 자리가 같은 함수를
   * 쓴다**는 사실 자체는 그 스위트가 말하지 않는다(값이 같으면 사본이어도 초록이다).
   * 여기서 항등식으로 묶는다 — 한쪽만 요율이나 절사를 바꾸면 이 케이스가 죽는다.
   */
  it('연도 합계에 대한 원천징수가 이 함수의 값과 같다', () => {
    const financialIncome = '30000000'

    const result = calculateFinancialIncomeTax({
      financialIncome,
      brackets: BRACKETS_2026,
      constants: CONSTANTS_2026,
    })

    expect(result.withheld.toString()).toBe(withhold(financialIncome))
    // DOC-007 §7.5의 검산에 나오는 값이다 — 30,000,000 × 0.154
    expect(result.withheld.toString()).toBe('4620000')
  })

  it('F ≤ 0에서는 계약이 조기 반환하므로 이 함수를 부르지 않는다', () => {
    // E-02 — 세액이 전부 0이다. 이 함수는 음수를 접지 않으므로(상류의 보장이다)
    // 그 분기가 §5.5 안에 있어야 한다는 사실을 함께 고정한다.
    const result = calculateFinancialIncomeTax({
      financialIncome: '-1000000',
      brackets: BRACKETS_2026,
      constants: CONSTANTS_2026,
    })
    expect(result.withheld.toString()).toBe('0')
    expect(withhold('-1000000')).toBe('-154000')
  })
})
