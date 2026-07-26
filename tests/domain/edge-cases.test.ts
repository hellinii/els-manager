import { describe, expect, it } from 'vitest'
import { evaluateCondition } from '@/lib/domain/condition'
import { isKiTouchCandidate, kiStatus } from '@/lib/domain/ki'
import { asActive, isRedeemed } from '@/lib/domain/redemption'
import type { RedemptionMark } from '@/lib/domain/redemption'
import { underlyingRatio, worstOf } from '@/lib/domain/worstOf'
import {
  applicableCouponRate,
  grossExpected,
  realizedPnl,
  taxableIncome,
} from '@/lib/domain/proceeds'
import {
  attributionYear,
  dDay,
  generateEvaluationDates,
  isPast,
  nextEvaluation,
  overdueEvaluations,
} from '@/lib/domain/schedule'
import { active } from '../fixtures/active'
import { expectAmount } from '../fixtures/assert'

/** DOC-007 §9 — 도메인 관련 예외 및 경계 처리 */

describe('E-01: 기초자산 현재가 누락', () => {
  it('하나라도 없으면 W = null이다. 기본값을 대입하지 않는다', () => {
    expect(
      worstOf([
        { basePrice: '100', currentPrice: '95' },
        { basePrice: '200', currentPrice: null },
      ]),
    ).toBeNull()
  })

  it('전부 없으면 W = null이다', () => {
    expect(
      worstOf([
        { basePrice: '100', currentPrice: null },
        { basePrice: '200', currentPrice: null },
      ]),
    ).toBeNull()
  })

  it('W = null이면 조건 판정도 null이다', () => {
    expect(
      evaluateCondition(active({ worstOf: null, barrier: '0.9' })),
    ).toBeNull()
  })

  it('기준가격이 0 이하면 비율을 산출할 수 없으므로 거부한다', () => {
    expect(() => underlyingRatio('0', '95')).toThrow()
    expect(() =>
      worstOf([{ basePrice: '0', currentPrice: '95' }]),
    ).toThrow()
  })
})

describe('전제조건: 기초자산 0건 (DOC-007 §3.1, DOC-002 I-07)', () => {
  // E-01과 별도 describe에 두는 것이 의도다. 문서가 두 상태를 분리했으므로
  // 테스트 그룹도 분리해야 "이것은 예외 처리가 아니라 전제조건"이 드러난다.
  //
  // v0.3까지는 worstOf([])가 E-01과 같은 null을 반환했다. 그래서 시세가 오면
  // 해소되는 일시적 상태와 I-07을 위반한 구조적 상태가 화면에서 구분되지
  // 않았고, "시세 없음"을 표시한 채 영원히 오지 않을 시세를 기다렸다
  it('기초자산이 없으면 거부한다 — E-01의 null과 구분된다', () => {
    expect(() => worstOf([])).toThrow(RangeError)
  })

  it('거부 메시지가 I-07을 가리킨다 — E-01로 오독되지 않게', () => {
    expect(() => worstOf([])).toThrow(/I-07/)
  })
})

describe('E-05: 상환 완료 상품 (DOC-007 §9.1)', () => {
  const REDEEMED: RedemptionMark = { redemptionDate: '2026-07-15' }
  const PARAMS = { worstOf: '0.92', barrier: '0.90' }

  it('상환 레코드가 있으면 판정 대상이 아니다 — asActive가 null을 반환한다', () => {
    expect(asActive(PARAMS, REDEEMED)).toBeNull()
    expect(isRedeemed(REDEEMED)).toBe(true)
  })

  it('보유중이면 판정 대상이며 판정이 수행된다', () => {
    expect(isRedeemed(null)).toBe(false)
    expect(evaluateCondition(asActive(PARAMS, null))).toBe('EARLY')
  })

  it('상태를 상환 레코드 존재로만 판단한다 (절대 규칙 #4)', () => {
    // 상품에 status 컬럼이 없으므로 판정 대상 여부도 레코드 유무로만 결정된다
    const cases: ReadonlyArray<readonly [RedemptionMark, boolean]> = [
      [null, true],
      [{ redemptionDate: '2026-01-01' }, false],
    ]
    for (const [redemption, judgeable] of cases) {
      expect(asActive(PARAMS, redemption) !== null).toBe(judgeable)
    }
  })

  it('상환 완료 상품에는 판정 함수를 호출할 수 없다 — 타입 수준 거부', () => {
    /**
     * **실행하지 않는다.** 검증은 `npm run typecheck`가 수행한다 —
     * `@ts-expect-error`가 붙은 줄이 오류를 내지 않으면 tsc가 "unused
     * directive"로 실패한다.
     *
     * 여기에 런타임 단언을 둘 수 없다. 상환 완료 상품의 판정 인자는 보유중
     * 상품과 값이 동일하고, 구분되는 유일한 신호인 상환 레코드는 `asActive`가
     * 이미 소비했기 때문이다. 그래서 타입이 유일한 방어선이다.
     */
    const rejectedAtCompileTime = () => {
      // @ts-expect-error — 표식 없는 입력은 조건 판정에 넘길 수 없다
      evaluateCondition(PARAMS)

      // @ts-expect-error — KI 표시 등급도 보유중 상품에만 정의된다
      kiStatus({ kiBarrier: '0.5', kiTouchedAt: null, worstOf: '0.92' })

      // @ts-expect-error — 시세 비교이므로 터치 후보 판정도 같다
      isKiTouchCandidate({ kiBarrier: '0.5', kiTouchedAt: null, worstOf: '0.4' })

      // @ts-expect-error — null 가능성이 남은 값을 그대로 넘길 수 없다
      evaluateCondition(asActive(PARAMS, REDEEMED as RedemptionMark))
    }

    expect(rejectedAtCompileTime).toBeTypeOf('function')
    // 런타임 계약은 asActive의 반환값이다
    expect(asActive(PARAMS, REDEEMED)).toBeNull()
  })
})

describe('E-06: 노낙인 상품 (ki_barrier IS NULL)', () => {
  it('KI 판정을 생략하고 NO_KI를 반환한다', () => {
    expect(
      kiStatus(active({ kiBarrier: null, kiTouchedAt: null, worstOf: '0.4' })),
    ).toBe('NO_KI')
  })

  it('터치 후보로도 표시하지 않는다', () => {
    expect(
      isKiTouchCandidate(
        active({
          kiBarrier: null,
          kiTouchedAt: null,
          worstOf: '0.1',
        }),
      ),
    ).toBe(false)
  })
})

describe('KI 표시 등급 (DOC-007 §3.4)', () => {
  const barrier = '0.5'

  it('터치가 확정되면 시세와 무관하게 KI 터치다', () => {
    expect(
      kiStatus(
        active({
          kiBarrier: barrier,
          kiTouchedAt: '2026-03-15',
          worstOf: '0.99',
        }),
      ),
    ).toBe('TOUCHED')
  })

  it('W ≤ KI 배리어면 확인 필요(BELOW)다', () => {
    expect(
      kiStatus(active({ kiBarrier: barrier, kiTouchedAt: null, worstOf: '0.5' })),
    ).toBe('BELOW')
    expect(
      kiStatus(
        active({ kiBarrier: barrier, kiTouchedAt: null, worstOf: '0.49' }),
      ),
    ).toBe('BELOW')
  })

  it('W ≤ KI 배리어 × 1.1이면 주의다', () => {
    expect(
      kiStatus(
        active({ kiBarrier: barrier, kiTouchedAt: null, worstOf: '0.55' }),
      ),
    ).toBe('WARNING')
    expect(
      kiStatus(
        active({ kiBarrier: barrier, kiTouchedAt: null, worstOf: '0.51' }),
      ),
    ).toBe('WARNING')
  })

  it('그 외는 안전이다', () => {
    expect(
      kiStatus(
        active({ kiBarrier: barrier, kiTouchedAt: null, worstOf: '0.56' }),
      ),
    ).toBe('SAFE')
  })

  it('시세가 없으면 등급도 null이다 (E-01)', () => {
    expect(
      kiStatus(active({ kiBarrier: barrier, kiTouchedAt: null, worstOf: null })),
    ).toBeNull()
  })

  it('보조 판정은 하회(W < 배리어)에서만 후보로 본다', () => {
    // 시스템이 ki_touched_at을 확정하지 않는다 (D-04). 후보 표시가 전부다
    expect(
      isKiTouchCandidate(
        active({
          kiBarrier: barrier,
          kiTouchedAt: null,
          worstOf: '0.49',
        }),
      ),
    ).toBe(true)
    expect(
      isKiTouchCandidate(
        active({
          kiBarrier: barrier,
          kiTouchedAt: null,
          worstOf: '0.5',
        }),
      ),
    ).toBe(false)
    // 이미 확정된 상품은 후보가 아니다
    expect(
      isKiTouchCandidate(
        active({
          kiBarrier: barrier,
          kiTouchedAt: '2026-01-02',
          worstOf: '0.1',
        }),
      ),
    ).toBe(false)
  })
})

describe('예상 수령액 (DOC-007 §4.1)', () => {
  it('P × (1 + r × (m × n) / 12)', () => {
    // 1억, 연 6%, 6개월 주기, 1차 → 1억 × (1 + 0.06 × 0.5) = 103,000,000
    expectAmount(
      grossExpected({
        principal: '100000000',
        couponRate: '0.06',
        evaluationPeriodMonths: 6,
        roundNo: 1,
      }),
      '103000000',
    )

    // 3차 → 1억 × (1 + 0.06 × 18/12) = 109,000,000
    expectAmount(
      grossExpected({
        principal: '100000000',
        couponRate: '0.06',
        evaluationPeriodMonths: 6,
        roundNo: 3,
      }),
      '109000000',
    )
  })

  it('리자드 쿠폰율을 주입하면 축소된 수령액이 나온다', () => {
    // 리자드 쿠폰 2% → 1억 × (1 + 0.02 × 0.5) = 101,000,000
    expectAmount(
      grossExpected({
        principal: '100000000',
        couponRate: '0.02',
        evaluationPeriodMonths: 6,
        roundNo: 1,
      }),
      '101000000',
    )
  })

  it('쿠폰율 0이면 원금만 상환된다 — Q-04의 원금상환형 리자드', () => {
    expectAmount(
      grossExpected({
        principal: '100000000',
        couponRate: '0',
        evaluationPeriodMonths: 6,
        roundNo: 2,
      }),
      '100000000',
    )
  })

  it('차수·개월수는 양의 정수여야 한다', () => {
    expect(() =>
      grossExpected({
        principal: '100000000',
        couponRate: '0.06',
        evaluationPeriodMonths: 6,
        roundNo: 0,
      }),
    ).toThrow()
    expect(() =>
      grossExpected({
        principal: '100000000',
        couponRate: '0.06',
        evaluationPeriodMonths: 6.5,
        roundNo: 1,
      }),
    ).toThrow()
  })
})

describe('적용 쿠폰율 (DOC-007 §4.1)', () => {
  it('조기상환이면 연쿠폰율이다', () => {
    expectAmount(
      applicableCouponRate({
        condition: 'EARLY',
        annualCouponRate: '0.06',
        lizardCouponRate: '0.02',
      }),
      '0.06',
    )
  })

  it('리자드상환이면 해당 차수의 리자드 쿠폰율이다', () => {
    expectAmount(
      applicableCouponRate({
        condition: 'LIZARD',
        annualCouponRate: '0.06',
        lizardCouponRate: '0.02',
      }),
      '0.02',
    )
  })

  it('원금상환형 리자드는 0으로 표기하며 그대로 적용된다', () => {
    expectAmount(
      applicableCouponRate({
        condition: 'LIZARD',
        annualCouponRate: '0.06',
        lizardCouponRate: '0',
      }),
      '0',
    )
  })

  it('리자드인데 쿠폰율이 없으면 거부한다 — 0이나 r로 대체하지 않는다', () => {
    // null을 0으로 보면 과소, r로 보면 과대 추정이다. 어느 쪽도 택하지 않는다
    expect(() =>
      applicableCouponRate({
        condition: 'LIZARD',
        annualCouponRate: '0.06',
        lizardCouponRate: null,
      }),
    ).toThrow(RangeError)

    expect(() =>
      applicableCouponRate({ condition: 'LIZARD', annualCouponRate: '0.06' }),
    ).toThrow(RangeError)
  })

  it('CARRY_OVER는 적용 쿠폰율이 정의되지 않는다 — 타입 수준 거부', () => {
    // 타입이 1차 방어선이고, 우회하더라도 값을 지어내지 않고 거부한다
    expect(() =>
      applicableCouponRate({
        // @ts-expect-error — 이월 차수는 상환되지 않으므로 호출 대상이 아니다
        condition: 'CARRY_OVER',
        annualCouponRate: '0.06',
      }),
    ).toThrow(RangeError)
  })

  it('판정 결과가 예상 수령액을 바꾼다 — §3 판정과 §4.1 산출의 연결', () => {
    const base = {
      principal: '100000000',
      evaluationPeriodMonths: 6,
      roundNo: 1,
    } as const
    const rates = { annualCouponRate: '0.06', lizardCouponRate: '0.02' } as const

    expectAmount(
      grossExpected({
        ...base,
        couponRate: applicableCouponRate({ condition: 'EARLY', ...rates }),
      }),
      '103000000',
    )
    expectAmount(
      grossExpected({
        ...base,
        couponRate: applicableCouponRate({ condition: 'LIZARD', ...rates }),
      }),
      '101000000',
    )
  })
})

describe('과세 금융소득 (DOC-007 §4.3, E-08)', () => {
  it('미상환은 max(0, 예상 수령액 − 원금)이다', () => {
    expectAmount(
      taxableIncome({
        accountType: 'GENERAL',
        principal: '100000000',
        expectedGross: '103000000',
      }),
      '3000000',
    )
  })

  it('E-08: 손실 상환의 과세소득은 0이며 음수가 되지 않는다', () => {
    expectAmount(
      taxableIncome({
        accountType: 'GENERAL',
        principal: '100000000',
        expectedGross: '90000000',
      }),
      '0',
    )

    // 저장값이 음수로 들어와도 0으로 막는다 (절대 규칙 #8)
    expectAmount(
      taxableIncome({
        accountType: 'GENERAL',
        principal: '100000000',
        redemption: { taxableIncome: '-5000000' },
      }),
      '0',
    )
  })

  it('상환 완료는 증권사 확정값을 쓰고 추정값으로 대체하지 않는다 (A-04)', () => {
    // 예상 수령액을 함께 넘겨도 저장값이 우선한다
    expectAmount(
      taxableIncome({
        accountType: 'GENERAL',
        principal: '100000000',
        redemption: { taxableIncome: '2850000' },
        expectedGross: '103000000',
      }),
      '2850000',
    )
  })

  it('비과세 계좌는 저장값·추정값과 무관하게 0이다', () => {
    expectAmount(
      taxableIncome({
        accountType: 'TAX_FREE',
        principal: '100000000',
        redemption: { taxableIncome: '30000000' },
      }),
      '0',
    )
    expectAmount(
      taxableIncome({
        accountType: 'TAX_FREE',
        principal: '100000000',
        expectedGross: '130000000',
      }),
      '0',
    )
  })

  it('상환값도 추정값도 없으면 산출할 수 없다', () => {
    expect(() =>
      taxableIncome({ accountType: 'GENERAL', principal: '100000000' }),
    ).toThrow()
  })
})

describe('포트폴리오 손익 (DOC-005 §8.5)', () => {
  it('음수가 가능하다 — 과세 금융소득과 분기하는 지점이다', () => {
    expectAmount(
      realizedPnl({ grossAmount: '90000000', principal: '100000000' }),
      '-10000000',
    )
    expectAmount(
      realizedPnl({ grossAmount: '120000000', principal: '100000000' }),
      '20000000',
    )
  })
})

describe('평가일정 생성 (S-02, DOC-007 §7.2)', () => {
  it('발행일 + 평가주기 × 차수로 생성한다', () => {
    expect(
      generateEvaluationDates({
        issueDate: '2026-01-15',
        evaluationPeriodMonths: 6,
        totalRounds: 6,
      }),
    ).toEqual([
      '2026-07-15',
      '2027-01-15',
      '2027-07-15',
      '2028-01-15',
      '2028-07-15',
      '2029-01-15',
    ])
  })

  it('월말은 해당 월의 마지막 날로 클램핑한다', () => {
    // 8월 31일 + 6개월 = 2월 28일 (2027년은 평년)
    expect(
      generateEvaluationDates({
        issueDate: '2026-08-31',
        evaluationPeriodMonths: 6,
        totalRounds: 2,
      }),
    ).toEqual(['2027-02-28', '2027-08-31'])
  })

  it('윤년의 2월 29일을 처리한다', () => {
    // 2027-08-31 + 6개월 = 2028-02-29 (2028년은 윤년)
    expect(
      generateEvaluationDates({
        issueDate: '2027-08-31',
        evaluationPeriodMonths: 6,
        totalRounds: 1,
      }),
    ).toEqual(['2028-02-29'])
  })

  it('클램핑은 기준일을 잃지 않는다 — 다음 차수는 원래 일자로 돌아온다', () => {
    // 1/31 기준으로 매월 평가하면 2/28로 클램핑되지만 3월은 31일이어야 한다.
    // 직전 결과에 누적 가산하면 3/28이 되어 계약 조건과 어긋난다
    expect(
      generateEvaluationDates({
        issueDate: '2026-01-31',
        evaluationPeriodMonths: 1,
        totalRounds: 3,
      }),
    ).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('타임존에 따라 하루가 밀리지 않는다', () => {
    // UTC 자정 파싱 문제로 흔히 발생하는 오차. 연·월·일을 직접 다루므로 없다
    expect(
      generateEvaluationDates({
        issueDate: '2026-01-01',
        evaluationPeriodMonths: 12,
        totalRounds: 1,
      }),
    ).toEqual(['2027-01-01'])
  })
})

describe('D-Day와 평가일 도래 (DOC-005 §6)', () => {
  it('남은 일수를 반환한다', () => {
    expect(dDay({ from: '2026-07-27', evaluationDate: '2026-08-01' })).toBe(5)
    expect(dDay({ from: '2026-07-27', evaluationDate: '2026-07-27' })).toBe(0)
    expect(dDay({ from: '2026-07-27', evaluationDate: '2026-07-20' })).toBe(-7)
  })

  it('윤년을 넘어도 정확하다', () => {
    expect(dDay({ from: '2028-02-28', evaluationDate: '2028-03-01' })).toBe(2)
    expect(dDay({ from: '2027-02-28', evaluationDate: '2027-03-01' })).toBe(1)
  })

  it('평가일 경과 여부를 판정한다', () => {
    expect(isPast({ evaluationDate: '2026-07-26', asOf: '2026-07-27' })).toBe(
      true,
    )
    expect(isPast({ evaluationDate: '2026-07-27', asOf: '2026-07-27' })).toBe(
      false,
    )
  })
})

describe('적용 차수 결정 (DOC-007 §7.2, RD-02)', () => {
  const schedules = [
    { roundNo: 1, evaluationDate: '2026-01-15' },
    { roundNo: 2, evaluationDate: '2026-07-15' },
    { roundNo: 3, evaluationDate: '2027-01-15' },
  ]

  it('다음 도래 평가일의 차수를 가정한다', () => {
    expect(nextEvaluation({ schedules, asOf: '2026-07-01' })?.roundNo).toBe(2)
  })

  it('평가일 당일은 아직 도래한 것으로 본다', () => {
    expect(nextEvaluation({ schedules, asOf: '2026-07-15' })?.roundNo).toBe(2)
  })

  it('모든 평가일이 과거면 null이다 — E-07 확인이 필요한 상태', () => {
    expect(nextEvaluation({ schedules, asOf: '2027-01-16' })).toBeNull()
  })

  it('차수 순서가 뒤섞여 있어도 평가일 기준으로 찾는다', () => {
    const shuffled = [schedules[2], schedules[0], schedules[1]]
    expect(nextEvaluation({ schedules: shuffled, asOf: '2026-07-01' })?.roundNo).toBe(
      2,
    )
  })
})

describe('E-07: 경과했으나 미상환 (DOC-007 §9.2)', () => {
  const schedules = [
    { roundNo: 1, evaluationDate: '2026-01-15' },
    { roundNo: 2, evaluationDate: '2026-07-15' },
    { roundNo: 3, evaluationDate: '2027-01-15' },
  ]

  it('경과한 차수를 전부 평가일 오름차순으로 반환한다', () => {
    // 종전 구현은 nextEvaluation만 있어 1차 경과를 조용히 건너뛰었다.
    // 2차만 보고 1차 확인이 누락되는 것이 E-07이 막으려는 상황이다
    const overdue = overdueEvaluations({
      schedules,
      asOf: '2026-08-01',
      redemption: null,
    })

    expect(overdue.map((entry) => entry.schedule.roundNo)).toEqual([1, 2])
    expect(overdue[0].daysOverdue).toBe(198) // 2026-01-15 → 2026-08-01
    expect(overdue[1].daysOverdue).toBe(17) // 2026-07-15 → 2026-08-01
  })

  it('상환 완료 상품은 빈 배열이다 — E-05가 우선한다', () => {
    expect(
      overdueEvaluations({
        schedules,
        asOf: '2027-06-01',
        redemption: { redemptionDate: '2026-07-15' },
      }),
    ).toEqual([])
  })

  it('평가일 당일은 경과가 아니다 — nextEvaluation과 경계를 공유한다', () => {
    const overdue = overdueEvaluations({
      schedules,
      asOf: '2026-07-15',
      redemption: null,
    })
    expect(overdue.map((entry) => entry.schedule.roundNo)).toEqual([1])
    expect(nextEvaluation({ schedules, asOf: '2026-07-15' })?.roundNo).toBe(2)
  })

  it('경과한 차수가 없으면 빈 배열이다', () => {
    expect(
      overdueEvaluations({ schedules, asOf: '2026-01-01', redemption: null }),
    ).toEqual([])
  })

  it('두 함수가 전 차수를 배타적으로 나눈다', () => {
    for (const asOf of ['2026-01-01', '2026-07-15', '2026-08-01', '2027-06-01']) {
      const overdue = overdueEvaluations({ schedules, asOf, redemption: null })
      const next = nextEvaluation({ schedules, asOf })
      const overdueRounds = overdue.map((entry) => entry.schedule.roundNo)

      // 경과 목록과 다음 도래 차수는 겹치지 않는다
      expect(overdueRounds).not.toContain(next?.roundNo)
      // 경과 목록은 다음 도래 평가일보다 반드시 앞선다
      expect(overdue.every((entry) => entry.daysOverdue > 0)).toBe(true)
    }
  })

  it('만기까지 전 차수가 경과하면 다음 차수가 없고 목록이 비지 않는다', () => {
    const asOf = '2027-06-01'
    expect(nextEvaluation({ schedules, asOf })).toBeNull()
    expect(
      overdueEvaluations({ schedules, asOf, redemption: null }),
    ).toHaveLength(3)
  })
})

describe('귀속연도 결정 (DOC-007 §7.2)', () => {
  it('상환 완료는 상환일 기준이다', () => {
    expect(
      attributionYear({
        redemptionDate: '2027-01-20',
        evaluationDate: '2026-07-15',
      }),
    ).toBe(2027)
  })

  it('미상환은 적용 차수의 평가일 기준이다', () => {
    expect(attributionYear({ evaluationDate: '2027-01-15' })).toBe(2027)
  })

  it('근거가 없으면 null이다', () => {
    expect(attributionYear({})).toBeNull()
  })
})
