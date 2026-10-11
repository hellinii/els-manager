import { describe, expect, it, vi } from 'vitest'
import {
  evaluationVerdictOf,
  finalRoundOf,
  roundToJudge,
  type EvaluationVerdictParams,
  type VerdictRound,
} from '@/lib/domain/evaluationVerdict'
import { asActive, type RedemptionMark } from '@/lib/domain/redemption'
import { isWeekendDate } from '@/lib/domain/schedule'
import { active } from '../fixtures/active'

/**
 * 평가일 판정 — DOC-007 §3.6 · 검산 블록 F (검증 케이스가 «아니다» — TC-01~22와 별개)
 *
 * 표본: 기초자산 A · B · C(기준가 100), 1차 2026-02-02(B 0.90 · L 0.80 · KI 미터치 요구) · 2차 2026-08-03(B 0.85) ·
 * 3차(만기) 2027-02-01(B 0.80), KI 0.50, 등록일 2026-01-02. 평가일은 전부 월요일이다.
 */

const R1 = {
  roundNo: 1,
  evaluationDate: '2026-02-02',
  barrier: '0.9000',
  lizardBarrier: '0.8000',
  lizardRequiresNoKi: true,
}
const R2 = { roundNo: 2, evaluationDate: '2026-08-03', barrier: '0.8500', lizardBarrier: null }
const R3 = { roundNo: 3, evaluationDate: '2027-02-01', barrier: '0.8000', lizardBarrier: null }
const SCHEDULES: VerdictRound[] = [R1, R2, R3]

const UNDERLYINGS = [
  { assetId: 'A', basePrice: '100' },
  { assetId: 'B', basePrice: '100' },
  { assetId: 'C', basePrice: '100' },
]

/** `'A@2026-02-02': '90'` 형태 — 정확한 날짜만 돌려준다 */
function closes(table: Record<string, string>) {
  return (assetId: string, date: string) => table[`${assetId}@${date}`] ?? null
}

function at(date: string, a: string, b: string, c: string): Record<string, string> {
  return { [`A@${date}`]: a, [`B@${date}`]: b, [`C@${date}`]: c }
}

function params(
  overrides: Partial<EvaluationVerdictParams<VerdictRound>>,
): EvaluationVerdictParams<VerdictRound> {
  return {
    schedules: SCHEDULES,
    underlyings: UNDERLYINGS,
    closeOn: closes({}),
    kiBarrier: '0.5000',
    kiTouchedAt: null,
    registrationDate: '2026-01-02',
    asOf: '2026-02-03',
    ...overrides,
  }
}

const verdict = (overrides: Partial<EvaluationVerdictParams<VerdictRound>>) =>
  evaluationVerdictOf(active(params(overrides)))

describe('평가일 판정 — 조건 충족 (§3.6 · 검산 블록 F)', () => {
  it('평가일 당일은 경과가 아니다 — 판정하지 않는다(§9.2와 같은 경계)', () => {
    expect(verdict({ asOf: '2026-02-02', closeOn: closes(at('2026-02-02', '90', '95', '100')) })).toBeNull()
  })

  it('W = B(경계 포함)면 조기상환 조건 충족이다 — 종가 90 · 95 · 100, B 0.90', () => {
    const v = verdict({ closeOn: closes(at('2026-02-02', '90', '95', '100')) })
    expect(v?.kind).toBe('CONDITION_MET')
    if (v?.kind !== 'CONDITION_MET') return
    expect(v.result).toBe('EARLY')
    expect(v.schedule).toBe(R1)
    expect(v.worstOf.equals('0.9')).toBe(true)
    expect(v.barrier.equals('0.9')).toBe(true)
  })

  it('반올림하지 않는다 — W 0.84996 < B 0.85면 이월이고, 이월은 묻지 않는다(D2)', () => {
    const v = verdict({ asOf: '2026-08-04', closeOn: closes(at('2026-08-03', '84.996', '90', '100')) })
    expect(v).toBeNull()
  })

  it('리자드 — W 0.85 < B 0.90이고 ≥ L 0.80, KI 미터치면 리자드상환 조건 충족이다. 배리어는 L(n)이다', () => {
    const v = verdict({ closeOn: closes(at('2026-02-02', '85', '95', '100')) })
    expect(v?.kind === 'CONDITION_MET' && v.result).toBe('LIZARD')
    if (v?.kind !== 'CONDITION_MET') return
    expect(v.barrier.equals('0.8')).toBe(true)
  })

  it('KI 터치가 평가일 «전»이면 리자드를 막는다 → 이월 → null', () => {
    expect(
      verdict({ kiTouchedAt: '2026-01-20', closeOn: closes(at('2026-02-02', '85', '95', '100')) }),
    ).toBeNull()
  })

  it('KI 터치가 평가일 «당일»이면 터치다 → 이월 → null', () => {
    expect(
      verdict({ kiTouchedAt: '2026-02-02', closeOn: closes(at('2026-02-02', '85', '95', '100')) }),
    ).toBeNull()
  })

  it('KI 터치가 평가일 «뒤»면 그 차수의 리자드를 막지 않는다(DOC-002 DQ-09 ⓑ)', () => {
    const v = verdict({
      asOf: '2026-05-11',
      kiTouchedAt: '2026-05-10',
      closeOn: closes(at('2026-02-02', '85', '95', '100')),
    })
    expect(v?.kind === 'CONDITION_MET' && v.result).toBe('LIZARD')
  })

  it('노낙인 상품은 KI 요구가 늘 충족이다(E-06)', () => {
    const v = verdict({ kiBarrier: null, closeOn: closes(at('2026-02-02', '85', '95', '100')) })
    expect(v?.kind === 'CONDITION_MET' && v.result).toBe('LIZARD')
  })

  it('리자드가 없는 차수(월지급형)는 조기상환 또는 이월만 나온다', () => {
    const early = verdict({ asOf: '2026-08-04', closeOn: closes(at('2026-08-03', '85', '90', '100')) })
    expect(early?.kind === 'CONDITION_MET' && early.result).toBe('EARLY')
    const carry = verdict({ asOf: '2026-08-04', closeOn: closes(at('2026-08-03', '70', '90', '100')) })
    expect(carry).toBeNull()
  })

  it('긴 소수 기준가도 전 정밀도로 비교한다', () => {
    const v = verdict({
      underlyings: [{ assetId: 'A', basePrice: '3456.789012' }],
      closeOn: closes({ 'A@2026-02-02': '3456.789012' }),
    })
    expect(v?.kind === 'CONDITION_MET' && v.worstOf.equals('1')).toBe(true)
  })
})

describe('평가일 판정 — 평가일 종가 없음 (E-11)', () => {
  it('세 자산 중 하나라도 그날 행이 없으면 판정하지 않는다 — 결측 자산을 알린다', () => {
    const table = at('2026-02-02', '90', '95', '100')
    delete table['B@2026-02-02']
    const v = verdict({ closeOn: closes(table) })
    expect(v).toEqual({ kind: 'CLOSE_MISSING', schedule: R1, missingAssetIds: ['B'], weekend: false })
  })

  it('결측 자산은 기초자산 순서로 낸다', () => {
    const v = verdict({})
    expect(v?.kind === 'CLOSE_MISSING' && v.missingAssetIds).toEqual(['A', 'B', 'C'])
  })

  it('전날 종가가 있어도 결측이다 — 대체하지 않는다(DQ-02)', () => {
    const v = verdict({ closeOn: closes(at('2026-01-30', '120', '120', '120')) })
    expect(v?.kind).toBe('CLOSE_MISSING')
  })

  it('주말로 저장된 평가일은 표식을 단다 — 할 일이 시세 입력이 아니라 일정 수정이다', () => {
    const saturday = { ...R1, evaluationDate: '2026-04-04' }
    const v = verdict({ schedules: [saturday, R2, R3], asOf: '2026-04-06' })
    expect(v?.kind === 'CLOSE_MISSING' && v.weekend).toBe(true)
  })

  it('기초자산이 0건이면 거부한다 — 결측과 구분된다(I-07)', () => {
    expect(() => verdict({ underlyings: [] })).toThrow(RangeError)
  })
})

describe('평가일 판정 — 등록일 (D3)', () => {
  it('평가일이 등록일보다 앞서면 판정하지 않는다 — 충족 종가가 있어도', () => {
    expect(
      verdict({
        registrationDate: '2026-03-01',
        asOf: '2026-03-02',
        closeOn: closes(at('2026-02-02', '90', '95', '100')),
      }),
    ).toBeNull()
  })

  it('등록 전 차수의 종가 결측은 「종가 없음」이 아니다', () => {
    expect(verdict({ registrationDate: '2026-03-01', asOf: '2026-03-02' })).toBeNull()
  })

  it('평가일 = 등록일이면 판정한다', () => {
    const v = verdict({ registrationDate: '2026-02-02', closeOn: closes(at('2026-02-02', '90', '95', '100')) })
    expect(v?.kind).toBe('CONDITION_MET')
  })
})

describe('평가일 판정 — 가장 최근 경과 차수 하나 (D4)', () => {
  it('앞 차수가 충족이어도 최근 차수가 이월이면 묻지 않는다 — 카드는 다음 평가일이 지나면 내려간다', () => {
    const v = verdict({
      asOf: '2026-08-04',
      closeOn: closes({ ...at('2026-02-02', '120', '120', '120'), ...at('2026-08-03', '70', '90', '100') }),
    })
    expect(v).toBeNull()
  })

  it('앞 차수가 결측이어도 최근 차수를 판정한다', () => {
    const v = verdict({ asOf: '2026-08-04', closeOn: closes(at('2026-08-03', '86', '90', '100')) })
    expect(v?.kind === 'CONDITION_MET' && v.schedule).toBe(R2)
  })

  it('판정이 조회하는 날짜는 최근 차수의 평가일 하나뿐이다 — 로더의 쌍 선택(`roundToJudge`)과 같다', () => {
    const spy = vi.fn((_assetId: string, _date: string) => null)
    verdict({ asOf: '2026-08-04', closeOn: spy })
    const target = roundToJudge({
      schedules: SCHEDULES,
      registrationDate: '2026-01-02',
      asOf: '2026-08-04',
      redemption: null,
    })
    expect(target).toEqual({ kind: 'JUDGE', schedule: R2 })
    expect(new Set(spy.mock.calls.map(([, date]) => date))).toEqual(new Set([R2.evaluationDate]))
    expect(spy.mock.calls.map(([assetId]) => assetId)).toEqual(['A', 'B', 'C'])
  })
})

describe('평가일 판정 — 만기 (마지막 차수)', () => {
  it('만기 평가일이 지나면 시세 없이 만기 평가일 경과다', () => {
    const v = verdict({ asOf: '2027-02-02' })
    expect(v).toEqual({ kind: 'MATURITY_REACHED', schedule: R3 })
  })

  it('만기에는 등록일 컷이 없다 — 만기 뒤에 등록한 상품도 상환을 기록해야 한다', () => {
    const v = verdict({ asOf: '2027-03-02', registrationDate: '2027-03-01' })
    expect(v?.kind).toBe('MATURITY_REACHED')
  })

  it('차수가 하나뿐인 상품이 경과하면 만기다', () => {
    const v = verdict({ schedules: [R1] })
    expect(v).toEqual({ kind: 'MATURITY_REACHED', schedule: R1 })
  })

  it('마지막 차수는 행 수가 아니라 최대 차수 번호다 — 1 · 2 · 99, 배열 순서와 무관', () => {
    const r99 = { ...R3, roundNo: 99 }
    const v = verdict({ schedules: [r99, R1, R2], asOf: '2027-02-02' })
    expect(v).toEqual({ kind: 'MATURITY_REACHED', schedule: r99 })
    expect(finalRoundOf([R2, r99, R1])).toBe(r99)
    expect(finalRoundOf([])).toBeNull()
  })
})

describe('평가일 판정 — 상환 완료 (E-05 · §9.1)', () => {
  it('roundToJudge는 상환 레코드가 있으면 null이다', () => {
    expect(
      roundToJudge({
        schedules: SCHEDULES,
        registrationDate: '2026-01-02',
        asOf: '2027-02-02',
        redemption: { redemptionDate: '2026-02-09' },
      }),
    ).toBeNull()
  })

  it('표식 없는 입력은 판정에 넘길 수 없다 — 타입 수준 거부', () => {
    const rejectedAtCompileTime = () => {
      // @ts-expect-error — 상환 완료 상품의 평가일 판정은 호출 불가다
      evaluationVerdictOf(params({}))

      // @ts-expect-error — null 가능성이 남은 값을 그대로 넘길 수 없다
      evaluationVerdictOf(asActive(params({}), { redemptionDate: '2026-02-09' } as RedemptionMark))
    }
    expect(rejectedAtCompileTime).toBeTypeOf('function')
    expect(asActive(params({}), { redemptionDate: '2026-02-09' })).toBeNull()
  })
})

describe('평가일 판정 — 형식', () => {
  it('등록일 · KI 터치일이 날짜 형식이 아니면 거부한다', () => {
    expect(() => verdict({ registrationDate: '2026/01/02' })).toThrow(RangeError)
    expect(() =>
      verdict({ kiTouchedAt: '20260120', closeOn: closes(at('2026-02-02', '85', '95', '100')) }),
    ).toThrow(RangeError)
  })
})

describe('isWeekendDate', () => {
  it('토 · 일만 주말이다 — 휴장일은 모른다(RD-03 ⓐ)', () => {
    expect(isWeekendDate('2026-04-04')).toBe(true)
    expect(isWeekendDate('2026-04-05')).toBe(true)
    expect(isWeekendDate('2026-04-06')).toBe(false)
    expect(isWeekendDate('2026-10-09')).toBe(false) // 한글날 — 평일이다
  })
})

describe('검산 블록 F — DOC-007 §3.6의 표 입력 그대로 (P6 컷 7-7)', () => {
  /*
   * 공통 입력: 기초자산 X · Y · Z(기준가 각 100), 1차 2026-04-14(화) · 2차 2026-10-14(수) · 마지막 6차, B(2) = 0.90, 리자드 없음,
   * 노낙인, 등록일 2026-08-20, asOf 2026-10-19(월). 판정 대상은 2차다. 행마다 바꾼 것만 바꾼다
   */
  const F_ROUNDS: VerdictRound[] = [
    { roundNo: 1, evaluationDate: '2026-04-14', barrier: '0.9000' },
    { roundNo: 2, evaluationDate: '2026-10-14', barrier: '0.9000' },
    { roundNo: 3, evaluationDate: '2027-04-14', barrier: '0.8500' },
    { roundNo: 4, evaluationDate: '2027-10-14', barrier: '0.8500' },
    { roundNo: 5, evaluationDate: '2028-04-14', barrier: '0.8000' },
    { roundNo: 6, evaluationDate: '2028-10-14', barrier: '0.8000' },
  ]
  const XYZ = [
    { assetId: 'X', basePrice: '100' },
    { assetId: 'Y', basePrice: '100' },
    { assetId: 'Z', basePrice: '100' },
  ]
  const xyz = (date: string, x: string, y: string, z: string) => ({ [`X@${date}`]: x, [`Y@${date}`]: y, [`Z@${date}`]: z })
  const F = (overrides: Partial<EvaluationVerdictParams<VerdictRound>>) =>
    evaluationVerdictOf(
      active({
        schedules: F_ROUNDS,
        underlyings: XYZ,
        closeOn: closes({}),
        kiBarrier: null,
        kiTouchedAt: null,
        registrationDate: '2026-08-20',
        asOf: '2026-10-19',
        ...overrides,
      }),
    )
  const F1_CLOSES = xyz('2026-10-14', '90', '95', '100')

  it('F-1 — W* = 0.90 = B(2) → EARLY (경계 포함)', () => {
    const v = F({ closeOn: closes(F1_CLOSES) })
    expect(v?.kind === 'CONDITION_MET' && [v.result, v.schedule.roundNo, v.worstOf.toString()]).toEqual(['EARLY', 2, '0.9'])
  })

  it('F-2 — X 89.996 → W* = 0.89996 < 0.90 → 이월 → 없음(반올림하지 않는다)', () => {
    expect(F({ closeOn: closes(xyz('2026-10-14', '89.996', '95', '100')) })).toBeNull()
  })

  it('F-3 — Z의 그날 행 없음 → CLOSE_MISSING [Z]', () => {
    const table = xyz('2026-10-14', '90', '95', '100')
    delete table['Z@2026-10-14']
    expect(F({ closeOn: closes(table) })).toMatchObject({ kind: 'CLOSE_MISSING', missingAssetIds: ['Z'], weekend: false })
  })

  it('F-4 — 셋 다 전날(10-13) 행만 → CLOSE_MISSING [X, Y, Z]', () => {
    expect(F({ closeOn: closes(xyz('2026-10-13', '90', '95', '100')) })).toMatchObject({
      kind: 'CLOSE_MISSING',
      missingAssetIds: ['X', 'Y', 'Z'],
    })
  })

  it('F-5 — 당일(10-14)은 1차가 대상이고 등록 전 → 없음 · 경과 1일(10-15)에 행이 없으면 CLOSE_MISSING', () => {
    expect(F({ asOf: '2026-10-14', closeOn: closes(F1_CLOSES) })).toBeNull()
    expect(F({ asOf: '2026-10-15' })).toMatchObject({ kind: 'CLOSE_MISSING', missingAssetIds: ['X', 'Y', 'Z'] })
    expect(F({ asOf: '2026-10-15', closeOn: closes(F1_CLOSES) })?.kind).toBe('CONDITION_MET')
  })

  it('F-6 — L(2) 0.85 · KI 미터치 요구 · KI 0.60 · X 87 → 평가일 뒤(10-16) 터치면 LIZARD, 당일(10-14) 터치면 없음', () => {
    const rounds = F_ROUNDS.map((r) =>
      r.roundNo === 2 ? { ...r, lizardBarrier: '0.8500', lizardRequiresNoKi: true } : r,
    )
    const base = { schedules: rounds, kiBarrier: '0.6000', closeOn: closes(xyz('2026-10-14', '87', '95', '100')) }
    const after = F({ ...base, kiTouchedAt: '2026-10-16' })
    expect(after?.kind === 'CONDITION_MET' && [after.result, after.barrier.toString()]).toEqual(['LIZARD', '0.85'])
    expect(F({ ...base, kiTouchedAt: '2026-10-14' })).toBeNull()
  })

  it('F-7 — 등록일 10-15(평가일 다음 날) → 없음 · 10-14(= 평가일) → EARLY', () => {
    expect(F({ registrationDate: '2026-10-15', closeOn: closes(F1_CLOSES) })).toBeNull()
    expect(F({ registrationDate: '2026-10-14', closeOn: closes(F1_CLOSES) })?.kind).toBe('CONDITION_MET')
  })

  it('F-8 — 6차(마지막) 뒤 · 그날 행 없음 · 등록일이 그 평가일 뒤 → MATURITY_REACHED', () => {
    expect(F({ asOf: '2028-10-16', registrationDate: '2028-10-15' })).toMatchObject({ kind: 'MATURITY_REACHED' })
    expect(F({ asOf: '2028-10-16', registrationDate: '2028-10-15' })?.schedule.roundNo).toBe(6)
  })

  it('F-9 — 등록 2026-03-01 · 1차 충족(기록 없음) · 2차 X 85 → 없음(가장 최근 차수만 — D4)', () => {
    expect(
      F({
        registrationDate: '2026-03-01',
        closeOn: closes({ ...xyz('2026-04-14', '100', '100', '100'), ...xyz('2026-10-14', '85', '95', '100') }),
      }),
    ).toBeNull()
    // 그 1차 카드는 2차 평가일 전까지 떠 있었다(종가가 들어온 뒤부터)
    expect(
      F({ registrationDate: '2026-03-01', asOf: '2026-10-13', closeOn: closes(xyz('2026-04-14', '100', '100', '100')) })?.kind,
    ).toBe('CONDITION_MET')
  })

  it('F-10 — 2차가 2026-10-17(토)로 저장 · 그날 행 없음 → CLOSE_MISSING · 주말', () => {
    const rounds = F_ROUNDS.map((r) => (r.roundNo === 2 ? { ...r, evaluationDate: '2026-10-17' } : r))
    expect(F({ schedules: rounds })).toMatchObject({ kind: 'CLOSE_MISSING', missingAssetIds: ['X', 'Y', 'Z'], weekend: true })
  })
})
