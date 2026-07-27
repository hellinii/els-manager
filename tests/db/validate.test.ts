import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { escapeLikePattern } from '@/lib/db/queries/load'
import {
  LENGTH_LIMITS,
  Problems,
  SMALLINT_MAX,
  isRealIsoDate,
} from '@/lib/db/validate/primitives'
import {
  RULE_IDS,
  RULE_TARGETS,
  V10_redemptionAfterIssue,
  V14_lizardRoundDefined,
  V17_notFuture,
  V18_kiTouchedRequiresBarrier,
  type RuleId,
} from '@/lib/db/validate/rules'
import {
  parseAssetInput,
  parseManualPriceInput,
  parseProductInput,
  parseRedemptionInput,
  parseTaxProfileInput,
  parseTouchedAt,
} from '@/lib/db/validate/inputs'
import type { ProductInput, RedemptionInput } from '@/lib/db/mutations/types'

/**
 * 검증 규칙 — DOC-011 §6, AQ-10
 *
 * **전수 열거 단언이 이 파일의 핵심이다.** 규칙이 20개인데 케이스가 18개면 어느
 * 둘이 빠졌는지 눈으로는 드러나지 않는다. 아래 `CASES` 표가 각 케이스에 규칙 ID를
 * 달고, 마지막 단언이 **그 ID 집합과 `RULE_IDS`가 같은지** 본다 — 규칙을 추가하고
 * 케이스를 잊으면 그 단언이 먼저 실패한다.
 */

// ---------------------------------------------------------------------------
// 정상 입력 — 여기서 출발해 한 필드씩 망가뜨린다
// ---------------------------------------------------------------------------

const ASSET_A = '00000000-0000-4000-8000-0000000000a1'
const ASSET_B = '00000000-0000-4000-8000-0000000000a2'

function validProduct(): Record<string, unknown> {
  return {
    name: '한국투자 ELS 12345',
    issuer: '한국투자증권',
    issueDate: '2026-01-02',
    principal: '100000000',
    evaluationPeriodMonths: 6,
    totalRounds: 2,
    annualCouponRate: '0.08',
    kiBarrier: '0.5',
    kiObservation: 'CLOSING',
    accountType: 'GENERAL',
    note: '테스트',
    underlyings: [
      { assetId: ASSET_A, basePrice: '100.000000', sequence: 1 },
      { assetId: ASSET_B, basePrice: '412.550000', sequence: 2 },
    ],
    schedules: [
      { roundNo: 1, evaluationDate: '2026-07-02', barrier: '0.9' },
      {
        roundNo: 2,
        evaluationDate: '2027-01-04',
        barrier: '0.85',
        lizardBarrier: '0.8',
        lizardCouponRate: '0.02',
        lizardRequiresNoKi: true,
      },
    ],
  }
}

function validRedemption(): Record<string, unknown> {
  return {
    redemptionType: 'EARLY',
    roundNo: 1,
    redemptionDate: '2026-07-02',
    grossAmount: '104000000',
    taxableIncome: '4000000',
    withholdingTax: '616000',
    isConfirmed: true,
  }
}

/** 정상 입력을 부분 교체한다. 스칼라는 덮고 배열은 통째로 바꾼다 */
function product(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...validProduct(), ...patch }
}

function redemption(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...validRedemption(), ...patch }
}

function parse(raw: unknown): Problems {
  const p = new Problems()
  parseProductInput(p, raw)
  return p
}

function parseRedemption(raw: unknown): Problems {
  const p = new Problems()
  parseRedemptionInput(p, raw)
  return p
}

describe('정상 입력은 통과한다', () => {
  it('상품', () => {
    const p = new Problems()
    const parsed = parseProductInput(p, validProduct())

    expect(p.all()).toEqual([])
    expect(parsed).not.toBeNull()
    // 금액·비율이 문자열로 남는다 — W-04
    expect(parsed!.principal).toBe('100000000')
    expect(parsed!.schedules[1].lizardCouponRate).toBe('0.02')
    // 선택 필드는 부재 시 키가 없다(`undefined`를 넣지 않는다)
    expect('kiTouchedAt' in parsed!).toBe(false)
  })

  it('상품 — 선택 필드를 전부 비운 형태', () => {
    const p = new Problems()
    const parsed = parseProductInput(
      p,
      product({ issuer: undefined, kiBarrier: undefined, kiObservation: undefined, note: undefined }),
    )
    expect(p.all()).toEqual([])
    expect(parsed).not.toBeNull()
    expect('kiBarrier' in parsed!).toBe(false)
  })

  it('원금상환형 리자드 — lizardCouponRate = 0이 통과한다', () => {
    // ★ v0.8까지의 V-08(0 < x)이 거부하던 입력이다. DOC-007 §4.1은 이 표기를
    //   요구하므로, 거부하면 그 상품은 0도 null도 저장할 수 없는 상태가 된다.
    const p = new Problems()
    const parsed = parseProductInput(
      p,
      product({
        schedules: [
          {
            roundNo: 1,
            evaluationDate: '2026-07-02',
            barrier: '0.9',
            lizardBarrier: '0.85',
            lizardCouponRate: '0',
          },
        ],
        totalRounds: 1,
      }),
    )
    expect(p.all()).toEqual([])
    expect(parsed!.schedules[0].lizardCouponRate).toBe('0')
  })

  it('상환·시세·프로필·자산', () => {
    const p1 = new Problems()
    expect(parseRedemptionInput(p1, validRedemption())).not.toBeNull()
    expect(p1.all()).toEqual([])

    const p2 = new Problems()
    expect(
      parseManualPriceInput(p2, { assetId: ASSET_A, asOfDate: '2026-06-30', price: '95.5' }),
    ).not.toBeNull()
    expect(p2.all()).toEqual([])

    const p3 = new Problems()
    expect(
      parseTaxProfileInput(p3, {
        year: 2026,
        otherIncomeBase: '50000000',
        otherFinancialIncome: '3000000',
        healthInsuranceType: 'EMPLOYEE',
      }),
    ).not.toBeNull()
    expect(p3.all()).toEqual([])

    const p4 = new Problems()
    expect(
      parseAssetInput(p4, {
        name: 'S&P 500',
        assetType: 'INDEX',
        market: null,
        currency: 'USD',
      }),
    ).not.toBeNull()
    expect(p4.all()).toEqual([])
  })

  it('setKiTouched — null은 해제이므로 정상 입력이다', () => {
    const p = new Problems()
    expect(parseTouchedAt(p, null)).toBeNull()
    expect(parseTouchedAt(p, '2026-06-30')).toBe('2026-06-30')
    expect(p.all()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 규칙별 케이스 — **표의 `rule`이 전수 열거의 근거다**
// ---------------------------------------------------------------------------

type Case = { rule: RuleId; what: string; run: () => Problems }

const CASES: Case[] = [
  {
    rule: 'V-01',
    what: '원금 0은 거부된다',
    run: () => parse(product({ principal: '0' })),
  },
  {
    rule: 'V-01',
    what: '원금에 소수점은 거부된다 — numeric(15,0)이 조용히 반올림한다',
    run: () => parse(product({ principal: '1000.5' })),
  },
  {
    rule: 'V-02',
    what: '기초자산 0건 (I-07)',
    run: () => parse(product({ underlyings: [] })),
  },
  {
    rule: 'V-03',
    what: '평가일정 0건 (I-07)',
    run: () => parse(product({ schedules: [] })),
  },
  {
    rule: 'V-03',
    what: '일정 건수 ≠ totalRounds — 배리어 파서의 오류를 잡는다',
    run: () => parse(product({ totalRounds: 3 })),
  },
  {
    rule: 'V-04',
    what: '차수 중복 (I-03)',
    run: () =>
      parse(
        product({
          schedules: [
            { roundNo: 1, evaluationDate: '2026-07-02', barrier: '0.9' },
            { roundNo: 1, evaluationDate: '2027-01-04', barrier: '0.85' },
          ],
        }),
      ),
  },
  {
    rule: 'V-04',
    what: '차수가 1부터 연속이 아니다 — 1, 99',
    run: () =>
      parse(
        product({
          schedules: [
            { roundNo: 1, evaluationDate: '2026-07-02', barrier: '0.9' },
            { roundNo: 99, evaluationDate: '2027-01-04', barrier: '0.85' },
          ],
        }),
      ),
  },
  {
    rule: 'V-05',
    what: '리자드 배리어 > 조기상환 배리어 (I-04)',
    run: () =>
      parse(
        product({
          totalRounds: 1,
          schedules: [
            {
              roundNo: 1,
              evaluationDate: '2026-07-02',
              barrier: '0.9',
              lizardBarrier: '0.95',
              lizardCouponRate: '0.02',
            },
          ],
        }),
      ),
  },
  {
    rule: 'V-06',
    what: '리자드 배리어만 있고 쿠폰율이 없다 (I-10)',
    run: () =>
      parse(
        product({
          totalRounds: 1,
          schedules: [
            {
              roundNo: 1,
              evaluationDate: '2026-07-02',
              barrier: '0.9',
              lizardBarrier: '0.85',
            },
          ],
        }),
      ),
  },
  {
    rule: 'V-07',
    what: '평가일이 차수 순으로 증가하지 않는다',
    run: () =>
      parse(
        product({
          schedules: [
            { roundNo: 1, evaluationDate: '2027-01-04', barrier: '0.9' },
            { roundNo: 2, evaluationDate: '2026-07-02', barrier: '0.85' },
          ],
        }),
      ),
  },
  {
    rule: 'V-07',
    what: '최초 평가일이 발행일보다 앞선다',
    run: () => parse(product({ issueDate: '2026-08-01' })),
  },
  {
    rule: 'V-07',
    what: '존재하지 않는 날짜 — 2026-02-30',
    run: () => parse(product({ issueDate: '2026-02-30' })),
  },
  {
    rule: 'V-08',
    what: '정규화 누락 — 배리어 90 (9000%)',
    run: () =>
      parse(
        product({
          totalRounds: 1,
          schedules: [{ roundNo: 1, evaluationDate: '2026-07-02', barrier: '90' }],
        }),
      ),
  },
  {
    rule: 'V-08',
    what: '연쿠폰율 0은 거부된다 — 리자드 쿠폰율과 하한이 다르다',
    run: () => parse(product({ annualCouponRate: '0' })),
  },
  {
    rule: 'V-09',
    what: '같은 기초자산을 두 번 (I-02)',
    run: () =>
      parse(
        product({
          underlyings: [
            { assetId: ASSET_A, basePrice: '100', sequence: 1 },
            { assetId: ASSET_A, basePrice: '200', sequence: 2 },
          ],
        }),
      ),
  },
  {
    rule: 'V-10',
    what: '상환일이 발행일보다 앞선다 — DB에 없는 검사다',
    run: () => {
      const p = new Problems()
      V10_redemptionAfterIssue(p, '2025-12-31', '2026-01-02')
      return p
    },
  },
  {
    rule: 'V-11',
    what: '과세 금융소득 음수 (I-12)',
    run: () => parseRedemption(redemption({ taxableIncome: '-1' })),
  },
  {
    rule: 'V-12',
    what: 'MATURITY_LOSS인데 과세소득 > 0 (I-08, 절대 규칙 #8)',
    run: () =>
      parseRedemption(
        redemption({
          redemptionType: 'MATURITY_LOSS',
          roundNo: undefined,
          taxableIncome: '1000',
        }),
      ),
  },
  {
    rule: 'V-13',
    what: 'EARLY인데 차수가 없다 (I-14)',
    run: () => parseRedemption(redemption({ roundNo: undefined })),
  },
  {
    rule: 'V-14',
    what: 'LIZARD인데 그 차수에 리자드 조건이 없다',
    run: () => {
      const p = new Problems()
      V14_lizardRoundDefined(
        p,
        { ...validRedemption(), redemptionType: 'LIZARD' } as unknown as RedemptionInput,
        { lizardBarrier: null, lizardCouponRate: null },
      )
      return p
    },
  },
  {
    rule: 'V-14',
    what: 'LIZARD인데 차수가 실재하지 않는다 (I-13)',
    run: () => {
      const p = new Problems()
      V14_lizardRoundDefined(
        p,
        { ...validRedemption(), redemptionType: 'LIZARD' } as unknown as RedemptionInput,
        null,
      )
      return p
    },
  },
  {
    rule: 'V-15',
    what: '시세 0',
    run: () => {
      const p = new Problems()
      parseManualPriceInput(p, { assetId: ASSET_A, asOfDate: '2026-06-30', price: '0' })
      return p
    },
  },
  {
    rule: 'V-15',
    what: '기준가격 0 — 등락률의 분모다(DOC-007 §3.1)',
    run: () =>
      parse(product({ underlyings: [{ assetId: ASSET_A, basePrice: '0', sequence: 1 }] })),
  },
  {
    rule: 'V-16',
    what: 'KI 배리어만 있고 관찰 방식이 없다 (I-11)',
    run: () => parse(product({ kiObservation: undefined })),
  },
  {
    rule: 'V-16',
    what: '노낙인인데 관찰 방식이 있다 (I-11 역방향)',
    run: () => parse(product({ kiBarrier: undefined })),
  },
  {
    rule: 'V-17',
    what: '미래 일자 시세 — DB CHECK로 만들 수 없는 규칙이다',
    run: () => {
      const p = new Problems()
      V17_notFuture(p, '2026-07-01', '2026-06-30')
      return p
    },
  },
  {
    rule: 'V-18',
    what: '노낙인 상품에 KI 터치 (I-15)',
    run: () => {
      const p = new Problems()
      V18_kiTouchedRequiresBarrier(p, '2026-06-30', { kiBarrier: null })
      return p
    },
  },
  {
    rule: 'V-19',
    what: '상품명이 200자를 넘는다 — 22001은 열을 말하지 않는다',
    run: () => parse(product({ name: '가'.repeat(LENGTH_LIMITS.productName + 1) })),
  },
  {
    rule: 'V-19',
    what: '통화가 2자 — char(3)은 공백으로 채워 오류조차 내지 않는다',
    run: () => {
      const p = new Problems()
      parseAssetInput(p, { name: 'X', assetType: 'STOCK', currency: 'US' })
      return p
    },
  },
  {
    rule: 'V-20',
    what: '평가주기 0개월',
    run: () => parse(product({ evaluationPeriodMonths: 0 })),
  },
  {
    rule: 'V-20',
    what: '차수가 smallint를 넘는다 — 22003은 열을 말하지 않는다',
    run: () =>
      parse(
        product({
          totalRounds: 1,
          schedules: [
            { roundNo: SMALLINT_MAX + 1, evaluationDate: '2026-07-02', barrier: '0.9' },
          ],
        }),
      ),
  },
  {
    rule: 'V-20',
    what: '연도가 4자리가 아니다',
    run: () => {
      const p = new Problems()
      parseTaxProfileInput(p, {
        year: 26,
        otherIncomeBase: '0',
        otherFinancialIncome: '0',
        healthInsuranceType: 'NONE',
      })
      return p
    },
  },
]

describe.each(CASES)('$rule — $what', ({ rule, run }) => {
  it(`${rule}이 걸린다`, () => {
    const problems = run()
    expect(problems.rules(), RULE_TARGETS[rule]).toContain(rule)
  })
})

describe('전수 열거 — 규칙 20개에 케이스가 하나도 빠지지 않았다', () => {
  it('CASES가 RULE_IDS 전부를 덮는다', () => {
    const covered = [...new Set(CASES.map((c) => c.rule))].sort()
    expect(covered).toEqual([...RULE_IDS].sort())
  })

  it('각 케이스가 선언한 규칙을 실제로 걸었다 — 선언과 동작이 갈리지 않는다', () => {
    // 위 describe.each가 개별로 보지만, 여기서 한 번 더 모아 본다.
    // 케이스가 "다른 규칙만" 걸고 통과하는 상태를 막는다.
    const missed = CASES.filter((c) => !c.run().rules().includes(c.rule))
    expect(missed.map((c) => `${c.rule}: ${c.what}`)).toEqual([])
  })

  it('RULE_TARGETS가 RULE_IDS와 양방향으로 일치한다', () => {
    expect(Object.keys(RULE_TARGETS).sort()).toEqual([...RULE_IDS].sort())
  })
})

// ---------------------------------------------------------------------------
// fields의 형태
// ---------------------------------------------------------------------------

describe('fields — 화면이 필드별로 표시할 수 있는 형태', () => {
  it('배열 원소는 인덱스가 붙는다 — DB 오류와 다른 점이다', () => {
    const problems = parse(
      product({
        totalRounds: 1,
        schedules: [
          {
            roundNo: 1,
            evaluationDate: '2026-07-02',
            barrier: '0.9',
            lizardBarrier: '0.95',
            lizardCouponRate: '0.02',
          },
        ],
      }),
    )
    expect(Object.keys(problems.fields())).toContain('schedules[0].lizardBarrier')
  })

  it('필드당 첫 오류만 남는다 — 순서가 §6 표의 순서다', () => {
    const problems = new Problems()
    problems.add('V-01', 'principal', '첫 번째')
    problems.add('V-08', 'principal', '두 번째')
    expect(problems.fields()).toEqual({ principal: '첫 번째' })
  })

  it('여러 필드가 동시에 걸린다 — 한 번에 다 보여준다', () => {
    const problems = parse(product({ principal: '0', annualCouponRate: '90' }))
    expect(Object.keys(problems.fields()).sort()).toEqual(['annualCouponRate', 'principal'])
  })

  it('toError는 VALIDATION_FAILED이고 원문을 담지 않는다', () => {
    const error = parse(product({ principal: '0' })).toError()
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.fields?.principal).toContain('0보다 커야')
  })

  it('형태가 깨진 입력에서도 여러 위반을 모은다 — 왕복을 줄인다', () => {
    const problems = parse({ name: 123, principal: null, underlyings: 'x', schedules: null })
    expect(problems.rules().length).toBeGreaterThan(2)
  })
})

describe('금액·비율은 문자열로 남는다 (W-04)', () => {
  it('지수 표기를 거부한다 — 형식 규약이 문자열이다', () => {
    expect(parse(product({ principal: '1e8' })).rules()).toContain('V-01')
  })

  it('숫자 타입을 거부한다 — 그 값은 이미 float64를 경유했다', () => {
    const problems = parse(product({ principal: 100000000 }))
    expect(problems.rules()).toContain('V-01')
  })

  it('선행 부호·공백을 거부한다', () => {
    expect(parse(product({ principal: '+100' })).rules()).toContain('V-01')
    expect(parse(product({ principal: ' 100' })).rules()).toContain('V-01')
  })
})

describe('날짜 형식', () => {
  it('존재하지 않는 날짜를 거부한다', () => {
    expect(isRealIsoDate('2026-02-30')).toBe(false)
    expect(isRealIsoDate('2026-13-01')).toBe(false)
    expect(isRealIsoDate('2026-00-10')).toBe(false)
    // 윤년은 통과한다
    expect(isRealIsoDate('2028-02-29')).toBe(true)
    expect(isRealIsoDate('2026-02-28')).toBe(true)
  })

  it('형식이 아니면 거부한다', () => {
    expect(isRealIsoDate('2026-6-30')).toBe(false)
    expect(isRealIsoDate('20260630')).toBe(false)
    expect(isRealIsoDate('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 길이 상한이 스키마와 일치한다 (V-19)
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

/**
 * `create table` 블록에서 문자열 열의 선언 길이를 뽑는다.
 *
 * **`alter ... type`은 보지 않는다.** 그래서 그 문장이 존재하지 않는다는 것을 함께
 * 단언한다 — 파서의 전제를 검사하지 않으면 나중에 열을 넓히는 마이그레이션이
 * 추가될 때 이 대조가 **조용히 낡은 값을 통과시킨다.**
 */
function declaredLengths(): Map<string, number> {
  const out = new Map<string, number>()
  let table: string | null = null

  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    if (!file.endsWith('.sql')) continue
    for (const line of readFileSync(join(MIGRATIONS_DIR, file), 'utf8').split('\n')) {
      const create = /^create table public\.(\w+)/.exec(line)
      if (create != null) {
        table = create[1]
        continue
      }
      if (table != null && /^\);/.test(line)) {
        table = null
        continue
      }
      const column = /^\s{2}(\w+)\s+(?:varchar|char)\((\d+)\)/.exec(line)
      if (table != null && column != null) {
        out.set(`${table}.${column[1]}`, Number.parseInt(column[2], 10))
      }
    }
  }
  return out
}

describe('V-19의 길이 상한이 스키마와 일치한다', () => {
  const lengths = declaredLengths()

  it('마이그레이션에 열 타입을 바꾸는 문장이 없다 — 파서의 전제', () => {
    const altering = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .filter((file) =>
        /alter\s+column\s+\w+\s+type/i.test(readFileSync(join(MIGRATIONS_DIR, file), 'utf8')),
      )
    expect(altering).toEqual([])
  })

  it.each([
    ['els_products.name', LENGTH_LIMITS.productName],
    ['els_products.issuer', LENGTH_LIMITS.issuer],
    ['assets.name', LENGTH_LIMITS.assetName],
    ['assets.market', LENGTH_LIMITS.market],
    ['assets.currency', LENGTH_LIMITS.currency],
  ])('%s = %i', (column, expected) => {
    expect(lengths.get(column)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// 필터 문법 격리 — AQ-26
// ---------------------------------------------------------------------------

describe('escapeLikePattern — 이스케이프 대상 전체 (AQ-26)', () => {
  it('백슬래시를 먼저 처리한다 — 순서가 뒤집히면 조용히 틀린다', () => {
    // 나중에 처리하면 자기가 넣은 백슬래시를 다시 이스케이프한다.
    // `%`를 `\%`로 만든 뒤 백슬래시를 이스케이프하면 `\\%`가 되어 와일드카드가 산다.
    expect(escapeLikePattern('\\')).toBe('\\\\')
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%')
  })

  it.each([
    ['%', '\\%'],
    ['_', '\\_'],
    ['*', '\\*'],
    [',', '\\,'],
    ['.', '\\.'],
    ['(', '\\('],
    [')', '\\)'],
    [':', '\\:'],
    ['"', '\\"'],
  ])('%s → %s', (input, expected) => {
    expect(escapeLikePattern(input)).toBe(expected)
  })

  it('평범한 입력은 그대로 둔다', () => {
    expect(escapeLikePattern('S&P 500')).toBe('S&P 500')
    expect(escapeLikePattern('삼성전자')).toBe('삼성전자')
  })

  it('와일드카드 한 글자가 전체 목록을 반환하지 못한다', () => {
    expect(escapeLikePattern('%')).not.toBe('%')
  })
})

describe('타입이 계약을 지킨다', () => {
  it('ProductInput의 금액·비율이 문자열이다', () => {
    const input: ProductInput = parseProductInput(new Problems(), validProduct())!
    // 타입 수준 단언 — number를 넣으면 typecheck가 거부한다
    const principal: string = input.principal
    const rate: string = input.annualCouponRate
    expect(typeof principal).toBe('string')
    expect(typeof rate).toBe('string')
  })
})
