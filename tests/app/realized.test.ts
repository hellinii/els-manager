import { describe, expect, it } from 'vitest'

import { Problems } from '@/lib/db/validate/primitives'
import { parseRealizedProductInput } from '@/lib/db/validate/inputs'
import { parseRealizedProductForm } from '@/lib/forms/parse'
import {
  REALIZED_FIELDS,
  attributionYearOf,
  realizedDefaults,
  realizedPnlOf,
} from '@/lib/forms/realized'

/**
 * SCR-205 기실현 등재의 순수 계층 — DOC-008 §5 · DOC-011 §5.11
 *
 * 화면은 어떤 스위트의 import 그래프에도 없다(AQ-23). 이 파일이 보는 것은 **화면이
 * 계약에 무엇을 넘기는가**와 **표시만 하는 값 셋이 실제로 파생인가**다.
 *
 * 그림(사용자의 스프레드시트) 한 줄을 픽스처로 쓴다 — 실측된 실제 값이며, 그
 * 덕분에 원천징수세액 산출의 배수 관계까지 검산된다.
 */

/** 「(주) 키움 뉴글로벌100조 ELS 1740회」 — 2026-06-04 상환 */
const ROW = {
  name: '(주) 키움 뉴글로벌100조 ELS 1740회',
  issuer: '키움증권',
  principal: '19390000',
  accountType: 'GENERAL',
  redemptionType: 'EARLY',
  redemptionDate: '2026-06-04',
  grossAmount: '20788019',
  taxableIncome: '1398019',
  withholdingTax: '215295',
  isConfirmed: 'on',
  note: '',
} as const

function formOf(overrides: Partial<Record<string, string>> = {}): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries({ ...ROW, ...overrides })) {
    form.set(key, value)
  }
  return form
}

describe('표시만 하는 값 셋 — 칸이 아니다', () => {
  /**
   * ★ **귀속연도에 칸을 두지 않는 것이 이 화면의 핵심 결정이다.**
   *
   * 사용자의 스프레드시트에는 열로 있지만 DOC-007 §7.2가 그 값을 상환일로 정한다.
   * 칸을 두면 두 값이 갈릴 수 있고, 집계 키가 `(owner_id, year)`이므로 갈리는 순간
   * **그 해의 금융소득 합계가 통째로 이동한다.**
   */
  it('귀속연도는 상환일의 연도다 — 그림의 2026-06-04 → 2026', () => {
    expect(attributionYearOf('2026-06-04')).toBe(2026)
    expect(attributionYearOf('2025-12-31')).toBe(2025)
    // 연말·연초가 갈리는 자리 — 12월 상환을 1월에 입력해도 전 해로 간다
    expect(attributionYearOf('2026-01-01')).toBe(2026)
  })

  it('타이핑 중인 날짜에 던지지 않는다 — 절반만 적힌 값이 정상 입력이다', () => {
    // `lib/domain`의 `attributionYear`는 `RangeError`를 던진다. 표시 계층이 그것을
    // 부르면 사용자가 날짜를 채우는 동안 화면이 에러 경계로 갈아치워진다.
    for (const partial of ['', '2026', '2026-0', '2026-06-', 'abcd-ef-gh']) {
      expect(attributionYearOf(partial), partial).toBeNull()
    }
  })

  it('실현손익은 실수령액 − 투자원금이다 — 그림의 1,398,019원', () => {
    expect(realizedPnlOf('20788019', '19390000')).toBe('1398019')
    // 그림에서 과표와 실현손익이 같은 값인 것이 우연이 아니다 — 조기상환의
    // 과세 금융소득이 정의상 「수령액 − 원금」이다(DOC-007 §4.2).
    expect(realizedPnlOf('20788019', '19390000')).toBe(ROW.taxableIncome)
  })

  it('실현손익은 음수가 될 수 있다 — 손실 상환이 그 자리다', () => {
    expect(realizedPnlOf('8000000', '10000000')).toBe('-2000000')
  })

  it('쉼표를 지운다 — 사용자가 붙여 넣는 형태가 그렇다', () => {
    expect(realizedPnlOf('20,788,019', '19,390,000')).toBe('1398019')
  })

  /**
   * **`0`으로 접으면 「손익이 0이다」와 「아직 못 셌다」가 같은 화면이 된다.**
   * 그래서 `null`이며 화면은 그 동안 자리를 만들지 않는다.
   */
  it('숫자가 아니면 `null`이다 — 0이 아니다', () => {
    expect(realizedPnlOf('', '19390000')).toBeNull()
    expect(realizedPnlOf('20788019', '')).toBeNull()
    // `dec()`가 통과시키는 두 형태를 표시 계층이 먼저 막는다(§4.6의 실측)
    expect(realizedPnlOf('0x1f', '0')).toBeNull()
    expect(realizedPnlOf('1e999', '0')).toBeNull()
  })
})

describe('초기값 — 전부 비운다', () => {
  /**
   * ★ **`redemptionDate`에 기준일을 넣지 않는 것이 SCR-203과 다른 점이다.**
   *
   * 그 화면은 「지금 상환을 처리한다」이므로 오늘이 그럴듯하지만, 이 화면은 과거
   * 이력을 옮긴다 — 오늘을 채워 두면 그 값이 그대로 저장될 수 있고 상환일은
   * 귀속연도를 결정한다. 틀린 기본값 하나가 그 해의 세액을 바꾼다.
   */
  it('상환일도 계좌유형도 비어 있다', () => {
    const defaults = realizedDefaults()
    expect(defaults.redemptionDate).toBe('')
    expect(defaults.accountType).toBe('')
    expect(defaults.isConfirmed).toBe('')
  })

  it('칸 전수를 담는다 — 하나라도 빠지면 그 칸이 uncontrolled가 된다', () => {
    const defaults = realizedDefaults()
    expect(Object.keys(defaults).sort()).toEqual([...REALIZED_FIELDS].sort())
  })

  it('차수 칸이 없다 — 일정 0건이라 실재하는 차수가 없다 (I-13)', () => {
    expect(REALIZED_FIELDS).not.toContain('roundNo')
    // 계약 조건 여섯도 없다 — 거래내역에 없는 값이다(D-07)
    for (const absent of [
      'issueDate',
      'annualCouponRate',
      'evaluationPeriodMonths',
      'totalRounds',
      'kiBarrier',
      'kiObservation',
    ]) {
      expect(REALIZED_FIELDS, absent).not.toContain(absent)
    }
  })
})

describe('폼 → 계약 입력', () => {
  it('그림의 한 줄이 그대로 계약 입력이 된다', () => {
    expect(parseRealizedProductForm(formOf())).toEqual({
      name: ROW.name,
      issuer: ROW.issuer,
      principal: '19390000',
      accountType: 'GENERAL',
      redemptionType: 'EARLY',
      redemptionDate: '2026-06-04',
      grossAmount: '20788019',
      taxableIncome: '1398019',
      withholdingTax: '215295',
      isConfirmed: true,
    })
  })

  it('원천징수세액을 비우면 키가 없다 — 계약이 산출하는 조건이다', () => {
    const parsed = parseRealizedProductForm(formOf({ withholdingTax: '' }))
    expect('withholdingTax' in parsed).toBe(false)
  })

  it('쉼표를 지운다 — 세 금액 칸 전부', () => {
    const parsed = parseRealizedProductForm(
      formOf({
        principal: '19,390,000',
        grossAmount: '20,788,019',
        taxableIncome: '1,398,019',
      }),
    )
    expect(parsed.principal).toBe('19390000')
    expect(parsed.grossAmount).toBe('20788019')
    expect(parsed.taxableIncome).toBe('1398019')
  })

  it('체크하지 않으면 추정값이다 (ST-05)', () => {
    expect(parseRealizedProductForm(formOf({ isConfirmed: '' })).isConfirmed).toBe(false)
  })
})

describe('계약 계층 검증 — 없는 칸에 오류를 붙이지 않는다', () => {
  function parse(overrides: Record<string, unknown> = {}) {
    const p = new Problems()
    const input = parseRealizedProductInput(p, { ...ROW, isConfirmed: true, ...overrides })
    return { input, error: p.isEmpty ? null : p.toError() }
  }

  it('그림의 한 줄을 통과시킨다', () => {
    const { input, error } = parse()
    expect(error).toBeNull()
    expect(input?.redemptionType).toBe('EARLY')
  })

  /**
   * ★★ **조기상환인데 차수가 없는 것이 이 계약에서는 정상이다.**
   *
   * `parseRedemptionInput`은 같은 입력을 V-13으로 거부한다 — 그쪽은 실재하는 차수를
   * 가진 상품의 상환이기 때문이다. 여기서는 **입력에 `roundNo`가 없어 위반을 표현할
   * 수 없고**, DB 쪽도 I-14 트리거가 `REALIZED_ONLY` 부모를 면제한다.
   */
  it('V-13을 부르지 않는다 — 차수 없는 조기상환이 통과한다', () => {
    const { error } = parse({ redemptionType: 'EARLY' })
    expect(error).toBeNull()
  })

  it('V-10을 부르지 않는다 — 비교할 발행일이 없다', () => {
    // 상환일이 아무리 과거여도 발행일이 없으므로 비교가 성립하지 않는다.
    const { error } = parse({ redemptionDate: '1999-01-01' })
    expect(error).toBeNull()
  })

  /** 절대 규칙 #8 — 이것은 **부른다.** 유형과 과표만 보면 판정된다 */
  it('V-12는 부른다 — 만기손실의 과세 금융소득은 0이어야 한다', () => {
    const { input, error } = parse({
      redemptionType: 'MATURITY_LOSS',
      taxableIncome: '1398019',
    })
    expect(input).toBeNull()
    expect(error?.code).toBe('VALIDATION_FAILED')
    expect(error?.fields?.taxableIncome).toContain('0이어야 한다')
  })

  it('만기손실 + 과표 0은 통과한다', () => {
    const { error } = parse({ redemptionType: 'MATURITY_LOSS', taxableIncome: '0' })
    expect(error).toBeNull()
  })

  it('V-01 — 투자원금은 0보다 커야 한다', () => {
    const { error } = parse({ principal: '0' })
    expect(error?.fields?.principal).toBeDefined()
  })

  it('V-11 — 과세 금융소득은 음수가 될 수 없다 (I-12)', () => {
    const { error } = parse({ taxableIncome: '-1' })
    expect(error?.fields?.taxableIncome).toBeDefined()
  })

  it('계좌유형·상환 유형은 열거값이어야 한다', () => {
    expect(parse({ accountType: 'ISA' }).error?.fields?.accountType).toBeDefined()
    expect(parse({ redemptionType: 'SOLD' }).error?.fields?.redemptionType).toBeDefined()
  })

  it('상환일은 ISO 날짜여야 한다', () => {
    expect(parse({ redemptionDate: '2026/06/04' }).error?.fields?.redemptionDate)
      .toBeDefined()
    // 존재하지 않는 날짜도 거부한다
    expect(parse({ redemptionDate: '2026-02-30' }).error?.fields?.redemptionDate)
      .toBeDefined()
  })

  it('입력이 객체가 아니면 형태 오류다', () => {
    const p = new Problems()
    expect(parseRealizedProductInput(p, 'nope')).toBeNull()
    expect(p.isEmpty).toBe(false)
  })
})
