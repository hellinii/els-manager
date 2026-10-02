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
  parseExchangeRateInput,
  parseManualPriceInput,
  parseProductInput,
  parseProviderSymbolInput,
  parseRealizedProductInput,
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
    currency: 'KRW',
    evaluationPeriodMonths: 6,
    totalRounds: 2,
    annualCouponRate: '0.08',
    // P8 컷 b2 — 필수 · 기본값 없음(V-25)
    couponPayout: 'AT_REDEMPTION',
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

/**
 * 월지급식으로 바꾸는 조각 (P8 컷 b2) — 연쿠폰율 0 · 월수익 연쿠폰율 · 일정 두 달 · **리자드 없는** 차수.
 * 기준 입력의 2차는 원금상환형 리자드이므로 그대로 두면 V-25의 리자드 금지가 함께 걸린다.
 */
function monthlyTerms() {
  return {
    couponPayout: 'MONTHLY',
    annualCouponRate: '0',
    monthlyCouponAnnualRate: '0.072',
    schedules: [
      { roundNo: 1, evaluationDate: '2026-07-02', barrier: '0.9' },
      { roundNo: 2, evaluationDate: '2027-01-04', barrier: '0.85' },
    ],
    couponSchedules: [
      { couponNo: 1, evaluationDate: '2026-02-01', paymentDate: '2026-02-04', couponBarrier: '0.6' },
      { couponNo: 2, evaluationDate: '2026-03-01', paymentDate: '2026-03-04', couponBarrier: '0.6' },
    ],
  }
}

/** §5.11 기실현 등재의 정상 입력 (P8 컷 b2 — 지급방식 케이스가 쓴다) */
function validRealized(): Record<string, unknown> {
  return {
    name: '키움 ELS 1740',
    principal: '19390000',
    currency: 'KRW',
    couponPayout: 'AT_REDEMPTION',
    accountType: 'GENERAL',
    redemptionType: 'EARLY',
    redemptionDate: '2025-06-02',
    grossAmount: '20000000',
    taxableIncome: '610000',
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

    // §5.13 — 환율은 6자리까지 그대로 나른다(정규화는 DB의 numeric(18,6)이 한다 — scale 제약이 없다)
    const p2b = new Problems()
    expect(
      parseExchangeRateInput(p2b, { currency: 'USD', asOfDate: '2026-06-29', rate: '1392.4' }),
    ).toEqual({ currency: 'USD', asOfDate: '2026-06-29', rate: '1392.4' })
    expect(p2b.all()).toEqual([])

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
    // 종전 V-01의 「정수」가 V-23의 원화 경우가 됐다(P8 a2). typmod를 뗐으므로 이 검사가 없으면
    // 이름 있는 제약(els_products_principal_scale_check)이 23514로 막는다 — 필드는 같다
    rule: 'V-23',
    what: '원화 상품의 원금에 소수점은 거부된다',
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
      V17_notFuture(p, '2026-07-01', '2026-06-30', '시세')
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
  {
    rule: 'V-22',
    what: '상품 통화가 비었다 — 원화로 채우지 않는다',
    run: () => parse(product({ currency: '' })),
  },
  {
    rule: 'V-22',
    what: '지원하지 않는 통화 — 형식(3자 대문자)은 맞다',
    run: () => parse(product({ currency: 'EUR' })),
  },
  {
    rule: 'V-23',
    what: '달러 원금의 소수 3자리 — 보조단위(센트)를 넘는다',
    run: () => parse(product({ currency: 'USD', principal: '10000.505' })),
  },
  {
    rule: 'V-23',
    what: '정수부 16자리 — 정밀도를 뗀 열의 천장',
    run: () => parse(product({ principal: '1000000000000000' })),
  },
  {
    rule: 'V-24',
    what: '적용 환율 0 — 형태만으로 거부된다',
    run: () => parseRedemption(redemption({ exchangeRate: '0' })),
  },
  {
    rule: 'V-24',
    what: '원화 기실현에 적용 환율 — 저장되지 않을 값을 조용히 버리지 않는다',
    run: () => {
      const p = new Problems()
      parseRealizedProductInput(p, {
        name: '키움 ELS 1740',
        principal: '19390000',
        currency: 'KRW',
        accountType: 'GENERAL',
        redemptionType: 'EARLY',
        redemptionDate: '2025-06-02',
        grossAmount: '20000000',
        taxableIncome: '610000',
        exchangeRate: '1392.4',
        isConfirmed: true,
      })
      return p
    },
  },
  /*
   * V-24 ⓑ — 환율 입력(§5.13 · P8 컷 a3). ⓐ와 같은 수치 규칙이 **필수**로 걸리고, 통화는 지원 외화만이다.
   * 셋을 따로 두는 이유는 셋이 다른 칸(`rate` · `currency`)으로 가고, 그중 원화 거부는 DB CHECK
   * (`exchange_rates_currency_check`)가 두 번째 겹이라 계약에서 빠져도 DB 경로에서는 초록이기 때문이다.
   */
  {
    rule: 'V-24',
    what: 'ⓑ 환율 입력의 빈칸 — 이 계약의 값이 그것 하나다',
    run: () => {
      const p = new Problems()
      parseExchangeRateInput(p, { currency: 'USD', asOfDate: '2026-06-29', rate: '' })
      return p
    },
  },
  {
    rule: 'V-24',
    what: 'ⓑ 원화 환율 — 원화는 1이고 행으로 두지 않는다',
    run: () => {
      const p = new Problems()
      parseExchangeRateInput(p, { currency: 'KRW', asOfDate: '2026-06-29', rate: '1' })
      return p
    },
  },
  {
    rule: 'V-24',
    what: 'ⓑ 소수 7자리 — `numeric(18,6)`이 조용히 반올림한다',
    run: () => {
      const p = new Problems()
      parseExchangeRateInput(p, { currency: 'USD', asOfDate: '2026-06-29', rate: '1392.4000001' })
      return p
    },
  },
  /*
   * P8 컷 b2 — 월지급식(DOC-011 §6 말미). 기준 입력은 **원금상환형 리자드가 있는** 상환 시 지급 상품이므로,
   * 월지급식으로 바꾸는 케이스는 리자드를 뺀 일정(`monthlySchedules`)을 함께 싣는다 — 그래야 한 케이스가 한
   * 규칙만 건다(V-25의 리자드 금지가 끼지 않는다)
   */
  {
    rule: 'V-25',
    what: '쿠폰 지급방식이 빈칸 — 기본값이 없다(U7)',
    run: () => parse(product({ couponPayout: '' })),
  },
  {
    rule: 'V-25',
    what: '모르는 지급방식 — 열거 밖',
    run: () => parse(product({ couponPayout: 'QUARTERLY' })),
  },
  {
    rule: 'V-25',
    what: '월지급식인데 월수익 연쿠폰율이 없다',
    run: () => parse(product({ ...monthlyTerms(), monthlyCouponAnnualRate: undefined })),
  },
  {
    rule: 'V-25',
    what: '월지급식인데 월수익 일정이 없다',
    run: () => parse(product({ ...monthlyTerms(), couponSchedules: [] })),
  },
  {
    rule: 'V-25',
    what: '월지급식에 리자드 차수 — 월지급 + 리자드는 v2',
    run: () => parse(product({ ...monthlyTerms(), schedules: validProduct().schedules })),
  },
  {
    rule: 'V-25',
    what: '상환 시 지급인데 월수익 연쿠폰율이 있다',
    run: () => parse(product({ monthlyCouponAnnualRate: '0.072' })),
  },
  {
    rule: 'V-25',
    what: '상환 시 지급인데 월수익 일정이 있다',
    run: () => parse(product({ couponSchedules: monthlyTerms().couponSchedules })),
  },
  {
    rule: 'V-25',
    what: '월수익 연쿠폰율 240 — 퍼센트를 그대로 넣었다(상한은 V-08과 같은 2)',
    run: () => parse(product({ ...monthlyTerms(), monthlyCouponAnnualRate: '2.424' })),
  },
  {
    rule: 'V-25',
    what: '기실현 등재의 지급방식 빈칸',
    run: () => {
      const p = new Problems()
      parseRealizedProductInput(p, { ...validRealized(), couponPayout: undefined })
      return p
    },
  },
  {
    rule: 'V-08',
    what: 'V-08′ — 월지급식의 연쿠폰율이 0이 아니다(헤드라인 율을 연쿠폰율에 — 이중 계상)',
    run: () => parse(product({ ...monthlyTerms(), annualCouponRate: '0.2424' })),
  },
  {
    rule: 'V-20',
    what: 'V-20′ — 월수익 순번 0',
    run: () =>
      parse(
        product({
          ...monthlyTerms(),
          couponSchedules: [{ ...monthlyTerms().couponSchedules[0], couponNo: 0 }],
        }),
      ),
  },
  {
    rule: 'V-26',
    what: '월수익 순번이 1부터 연속이 아니다 — 1, 3',
    run: () =>
      parse(
        product({
          ...monthlyTerms(),
          couponSchedules: [
            monthlyTerms().couponSchedules[0],
            { ...monthlyTerms().couponSchedules[1], couponNo: 3 },
          ],
        }),
      ),
  },
  {
    rule: 'V-26',
    what: '월수익 평가일이 엄격히 증가하지 않는다',
    run: () =>
      parse(
        product({
          ...monthlyTerms(),
          couponSchedules: [
            monthlyTerms().couponSchedules[0],
            { ...monthlyTerms().couponSchedules[1], evaluationDate: '2026-02-01', paymentDate: '2026-02-04' },
          ],
        }),
      ),
  },
  {
    rule: 'V-26',
    what: '첫 월수익 평가일이 발행일보다 앞선다',
    run: () =>
      parse(
        product({
          ...monthlyTerms(),
          couponSchedules: [
            { ...monthlyTerms().couponSchedules[0], evaluationDate: '2025-12-31', paymentDate: '2026-01-05' },
            monthlyTerms().couponSchedules[1],
          ],
        }),
      ),
  },
  {
    rule: 'V-26',
    what: '마지막 월수익 평가일이 만기(마지막 차수 평가일) 뒤다',
    run: () =>
      parse(
        product({
          ...monthlyTerms(),
          couponSchedules: [
            monthlyTerms().couponSchedules[0],
            { ...monthlyTerms().couponSchedules[1], evaluationDate: '2027-01-05', paymentDate: '2027-01-08' },
          ],
        }),
      ),
  },
  {
    rule: 'V-26',
    what: '월수익 지급일이 평가일보다 앞선다',
    run: () =>
      parse(
        product({
          ...monthlyTerms(),
          couponSchedules: [
            { ...monthlyTerms().couponSchedules[0], paymentDate: '2026-01-31' },
            monthlyTerms().couponSchedules[1],
          ],
        }),
      ),
  },
  {
    rule: 'V-26',
    what: '월수익 배리어 120% — 상한은 1이다(V-08의 2가 아니다)',
    run: () =>
      parse(
        product({
          ...monthlyTerms(),
          couponSchedules: [
            { ...monthlyTerms().couponSchedules[0], couponBarrier: '1.2' },
            monthlyTerms().couponSchedules[1],
          ],
        }),
      ),
  },
  {
    rule: 'V-26',
    what: '월수익 일정 61행 — 상한 60',
    run: () =>
      parse(
        product({
          ...monthlyTerms(),
          totalRounds: 1,
          schedules: [{ roundNo: 1, evaluationDate: '2031-12-31', barrier: '0.9' }],
          couponSchedules: Array.from({ length: 61 }, (_, index) => {
            const month = new Date(Date.UTC(2026, 1 + index, 1)).toISOString().slice(0, 10)
            return { couponNo: index + 1, evaluationDate: month, paymentDate: month, couponBarrier: '0.6' }
          }),
        }),
      ),
  },
  {
    rule: 'V-21',
    what: '코드가 모르는 공급자 — 형식은 맞고 소속이 틀렸다',
    run: () => {
      /*
       * ★ 이 케이스의 요점은 «형식이 통과한다»는 것이다. `varchar(30)` 이내의 평범한
       * 문자열이므로 V-19는 걸리지 않는다. 그런데 어느 수집기도 모르는 값이므로 그
       * 매핑은 **영구히 쓰이지 않는 행**이 되고, 화면은 「자동 수집됨」으로 읽히면서
       * 수집은 되지 않고 `unmapped`도 세지 않는다 — 오타 하나가 만드는 조용한 상태다.
       */
      const p = new Problems()
      parseProviderSymbolInput(p, {
        assetId: ASSET_A,
        provider: 'KIWOOM_ES04', // 마지막 0이 빠졌다
        providerSymbol: '3:AAPL',
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

describe(`전수 열거 — 규칙 ${RULE_IDS.length}개에 케이스가 하나도 빠지지 않았다`, () => {
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

describe('§5.13 환율 입력 — 칸과 문구 (V-24 ⓑ · V-17 · P8 컷 a3)', () => {
  function fieldsOf(raw: unknown): Record<string, string> {
    const p = new Problems()
    parseExchangeRateInput(p, raw)
    return p.fields()
  }

  it('원화는 `currency` 칸으로 간다 — `rate` 칸이 아니다', () => {
    expect(fieldsOf({ currency: 'KRW', asOfDate: '2026-06-29', rate: '1' })).toEqual({
      currency: '통화을(를) 선택한다.',
    })
  })

  it('빈칸은 「입력한다」, 숫자가 아니면 「숫자로」 — 단위(1달러당 원)를 함께 말한다', () => {
    expect(fieldsOf({ currency: 'USD', asOfDate: '2026-06-29' }).rate).toBe(
      '환율을(를) 입력한다(1달러당 원).',
    )
    expect(fieldsOf({ currency: 'USD', asOfDate: '2026-06-29', rate: '1,392.4' }).rate).toBe(
      '환율은(는) 숫자로 입력한다(1달러당 원).',
    )
  })

  it('★ 숫자를 받지 않는다 — float을 경유한 값은 경계에서 막는다 (절대 규칙 #2)', () => {
    expect(fieldsOf({ currency: 'USD', asOfDate: '2026-06-29', rate: 1392.4 }).rate).toBe(
      '환율은(는) 숫자로 입력한다(1달러당 원).',
    )
  })

  it('V-17은 대상을 말한다 — 환율 폼에 「시세」가 뜨지 않는다', () => {
    const p = new Problems()
    V17_notFuture(p, '2026-07-01', '2026-06-30', '환율')
    expect(p.fields()).toEqual({ asOfDate: '기준일(2026-06-30) 이후의 환율은 입력할 수 없다.' })
    // 시세 쪽 문구는 종전 그대로다(바이트 불변)
    const q = new Problems()
    V17_notFuture(q, '2026-07-01', '2026-06-30', '시세')
    expect(q.fields()).toEqual({ asOfDate: '기준일(2026-06-30) 이후의 시세는 입력할 수 없다.' })
  })
})

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

interface MigrationFile {
  readonly name: string
  readonly sql: string
}

function migrationFiles(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }))
}

const DOLLAR_TAG = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y

/**
 * SQL을 문장으로 자른다 — 주석·문자열 리터럴·달러 인용 본문을 비운 채로.
 *
 * 비우는 이유가 둘이다. `comment on … is '… varchar(50) …'`의 설명 문장이 선언으로
 * 세어지면 안 되고, 함수 본문(`$$ … $$`)의 `;`가 문장을 끊으면 그 뒤의 `alter table`이
 * 엉뚱한 문장에 붙는다. 본문 안의 `varchar(n)`은 변수·캐스트이지 열 선언이 아니다.
 *
 * **닫히지 않은 인용은 던진다.** 삼키면 파일의 나머지가 통째로 사라지고 그 안의
 * 선언이 0건으로 조용히 통과한다.
 */
function sqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let i = 0
  const unclosed = (what: string, from: number): never => {
    throw new Error(`닫히지 않은 ${what} — ${JSON.stringify(sql.slice(from, from + 60))}`)
  }

  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end
      continue
    }
    if (sql.startsWith('/*', i)) {
      const from = i
      let depth = 0
      do {
        if (i >= sql.length) unclosed('블록 주석', from)
        if (sql.startsWith('/*', i)) {
          depth++
          i += 2
        } else if (sql.startsWith('*/', i)) {
          depth--
          i += 2
        } else {
          i++
        }
      } while (depth > 0)
      current += ' '
      continue
    }

    const ch = sql[i]
    if (ch === "'") {
      const from = i
      const escapes = /(?:^|[^\w$])[eE]$/.test(current)
      i++
      for (;;) {
        if (i >= sql.length) unclosed('문자열', from)
        if (escapes && sql[i] === '\\') {
          i += 2
        } else if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2
        } else if (sql[i] === "'") {
          i++
          break
        } else {
          i++
        }
      }
      current += "''"
      continue
    }
    if (ch === '"') {
      let end = sql.indexOf('"', i + 1)
      while (end !== -1 && sql[end + 1] === '"') end = sql.indexOf('"', end + 2)
      if (end === -1) unclosed('따옴표 식별자', i)
      current += sql.slice(i, end + 1)
      i = end + 1
      continue
    }
    if (ch === '$' && !/[\w$]$/.test(current)) {
      DOLLAR_TAG.lastIndex = i
      const tag = DOLLAR_TAG.exec(sql)
      if (tag != null) {
        const end = sql.indexOf(tag[0], i + tag[0].length)
        if (end === -1) unclosed(`달러 인용 ${tag[0]}`, i)
        i = end + tag[0].length
        current += ' $$ '
        continue
      }
    }
    if (ch === ';') {
      statements.push(current)
      current = ''
      i++
      continue
    }
    current += ch
    i++
  }
  statements.push(current)

  return statements.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s !== '')
}

function closingParen(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return i
  }
  throw new Error(`괄호가 닫히지 않는다 — ${text.slice(0, 80)}`)
}

/** 괄호 밖의 쉼표로 가른다 — `numeric(18,6)`·`check (a in (1, 2))`를 쪼개지 않는다 */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    else if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(text.slice(start).trim())
  return parts.filter((p) => p !== '')
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`
const QNAME = String.raw`(?:(${IDENT})\s*\.\s*)?(${IDENT})`
/** 길이를 갖는 문자열형 — `varchar`·`character varying`·`char`·`character`·`bpchar` */
// 긴 표기를 앞에 둔다 — PostgreSQL이 받는 철자 전부(char varying · nchar · national character varying ·
// 따옴표 붙은 "varchar")를 덮는다. 빠진 철자는 파서와 전역 스캔 «둘 다» 못 보므로 조용히 초록이 된다
// (P8 컷 1 검증이 롤백되는 임시 테이블로 실측했다 — 셋 다 PostgreSQL이 받는다).
const LENGTH_TYPE = String.raw`(?:"varchar"|varchar|bpchar|nchar(?:\s+varying)?|(?:national\s+)?(?:character|char)(?:\s+varying)?)\s*\(\s*(\d+)\s*\)`

const LENGTH_TYPE_AT_START = new RegExp(`^${LENGTH_TYPE}`, 'i')
const LENGTH_TYPE_ANYWHERE = new RegExp(String.raw`(?<![\w])${LENGTH_TYPE}`, 'gi')
const QNAME_ONLY = new RegExp(`^${QNAME}$`, 'i')

const CREATE_TABLE = new RegExp(
  String.raw`^create\s+(?:(?:global|local)\s+)?(?:(?:temp|temporary|unlogged)\s+)?table\s+(?:if\s+not\s+exists\s+)?${QNAME}\s*\(`,
  'i',
)
const ALTER_TABLE = new RegExp(
  String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${QNAME}\s*\*?\s+(.+)$`,
  'i',
)
const DROP_TABLE = /^drop\s+table\s+(?:if\s+exists\s+)?(.+?)(?:\s+(?:cascade|restrict))?$/i

const TABLE_CONSTRAINT = /^(?:constraint|primary|unique|check|foreign|exclude|like)\b/i
const COLUMN_DEF = new RegExp(String.raw`^(${IDENT})\s+(.+)$`, 'i')
const ADD_COLUMN = new RegExp(
  String.raw`^add\s+(?!(?:constraint|primary|unique|check|foreign|exclude)\b)(?:column\s+)?(?:if\s+not\s+exists\s+)?(${IDENT})\s+(.+)$`,
  'i',
)
const ALTER_TYPE = new RegExp(
  String.raw`^alter\s+(?:column\s+)?(${IDENT})\s+(?:set\s+data\s+)?type\s+(.+)$`,
  'i',
)
const DROP_COLUMN = new RegExp(
  String.raw`^drop\s+(?!constraint\b)(?:column\s+)?(?:if\s+exists\s+)?(${IDENT})`,
  'i',
)
const RENAME_COLUMN = new RegExp(
  String.raw`^rename\s+(?!(?:constraint|to)\b)(?:column\s+)?(${IDENT})\s+to\s+(${IDENT})$`,
  'i',
)
const RENAME_TABLE = new RegExp(String.raw`^rename\s+to\s+(${IDENT})$`, 'i')

function ident(raw: string): string {
  return raw.startsWith('"') ? raw.slice(1, -1).replace(/""/g, '"') : raw.toLowerCase()
}

/** 한정 없는 이름은 `public`으로 읽는다(기본 `search_path`). 그 밖의 스키마는 접두사를 단다 */
function tableKey(schema: string | undefined, table: string): string {
  const s = schema == null ? 'public' : ident(schema)
  return s === 'public' ? ident(table) : `${s}.${ident(table)}`
}

interface DeclaredLengths {
  /** `테이블.열` → 선언 길이. 마이그레이션을 파일 순서대로 **재생한** 결과다 */
  readonly lengths: Map<string, number>
  /** 길이형이 나오는데 열에 귀속되지 못한 문장 — 파서가 모르는 형태다 */
  readonly unattributed: string[]
  /** 문장 전체에서 센 길이형 개수. 파서의 문장 해석과 독립이다 */
  readonly scanned: number
}

/**
 * 마이그레이션을 순서대로 재생해 문자열 열의 선언 길이를 뽑는다.
 *
 * 초판은 `create table` 블록만 읽었다. 그러면 나중 마이그레이션의
 * `alter table … add column x varchar(n)`이 **보이지 않고**, 대조 표에 없는 열이므로
 * 아무것도 실패하지 않는다 — CLAUDE.md 규칙 6의 부류(객체 종류가 늘어날 때 기존
 * 열거가 따라오지 않는다)다. 지금은 `create table`·`alter table`(add column /
 * alter column … type / drop column / rename)·`drop table`을 재생한다.
 *
 * **「빠지지 않았는가」는 재생 규칙으로 답하지 않는다.** 모르는 형태가 오면 재생은
 * 그것을 조용히 건너뛴다. 그래서 문장마다 길이형을 **독립적으로 세고**(`scanned`)
 * 재생이 귀속시킨 수보다 많으면 그 문장을 `unattributed`에 올린다. 함수 인자·
 * `create domain`·캐스트가 거기 걸린다 — 도메인이면 파서가 배워야 하고(길이가
 * 도메인을 통해 강제된다), 함수 인자면 열 선언이 아니다(PostgreSQL은 인자의 길이
 * 수식어를 버린다). 어느 쪽인지 정하는 것은 그 마이그레이션을 쓰는 사람이다.
 */
function parseDeclaredLengths(files: readonly MigrationFile[]): DeclaredLengths {
  const lengths = new Map<string, number>()
  const unattributed: string[] = []
  let scanned = 0

  /** 열 하나의 타입으로 원장을 갱신한다. 길이형이 아니면 상한이 없어진 것이므로 지운다 */
  const apply = (table: string, column: string, type: string): number => {
    const key = `${table}.${column}`
    const typed = LENGTH_TYPE_AT_START.exec(type)
    if (typed == null) {
      lengths.delete(key)
      return 0
    }
    lengths.set(key, Number.parseInt(typed[1], 10))
    return 1
  }
  const renameColumn = (from: string, to: string): void => {
    const n = lengths.get(from)
    lengths.delete(from)
    if (n != null) lengths.set(to, n)
  }
  const renameTable = (from: string, to: string | null): void => {
    for (const [key, n] of [...lengths]) {
      if (!key.startsWith(`${from}.`)) continue
      lengths.delete(key)
      if (to != null) lengths.set(`${to}${key.slice(from.length)}`, n)
    }
  }

  for (const file of files) {
    for (const statement of sqlStatements(file.sql)) {
      const tokens = statement.match(LENGTH_TYPE_ANYWHERE)?.length ?? 0
      scanned += tokens
      let attributed = 0

      const create = CREATE_TABLE.exec(statement)
      const alter = create == null ? ALTER_TABLE.exec(statement) : null
      const drop = create == null && alter == null ? DROP_TABLE.exec(statement) : null

      if (create != null) {
        const table = tableKey(create[1], create[2])
        const open = create[0].length - 1
        const body = statement.slice(open + 1, closingParen(statement, open))
        for (const element of splitTopLevel(body)) {
          if (TABLE_CONSTRAINT.test(element)) continue
          const column = COLUMN_DEF.exec(element)
          if (column != null) attributed += apply(table, ident(column[1]), column[2])
        }
      } else if (alter != null) {
        const table = tableKey(alter[1], alter[2])
        for (const action of splitTopLevel(alter[3])) {
          let m: RegExpExecArray | null
          if ((m = ADD_COLUMN.exec(action)) != null) {
            attributed += apply(table, ident(m[1]), m[2])
          } else if ((m = ALTER_TYPE.exec(action)) != null) {
            attributed += apply(table, ident(m[1]), m[2])
          } else if ((m = DROP_COLUMN.exec(action)) != null) {
            lengths.delete(`${table}.${ident(m[1])}`)
          } else if ((m = RENAME_COLUMN.exec(action)) != null) {
            renameColumn(`${table}.${ident(m[1])}`, `${table}.${ident(m[2])}`)
          } else if ((m = RENAME_TABLE.exec(action)) != null) {
            renameTable(table, tableKey(alter[1], m[1]))
          }
        }
      } else if (drop != null) {
        for (const name of splitTopLevel(drop[1])) {
          const q = QNAME_ONLY.exec(name)
          if (q != null) renameTable(tableKey(q[1], q[2]), null)
        }
      }

      if (attributed < tokens) unattributed.push(`${file.name}: ${statement.slice(0, 160)}`)
    }
  }
  return { lengths, unattributed, scanned }
}

function declaredLengths(): DeclaredLengths {
  return parseDeclaredLengths(migrationFiles())
}

/** V-19가 대조하는 열 — 계약 입력이 이 열에 닿는다 */
const V19_COLUMNS: Array<[string, number]> = [
  ['els_products.name', LENGTH_LIMITS.productName],
  ['els_products.issuer', LENGTH_LIMITS.issuer],
  ['assets.name', LENGTH_LIMITS.assetName],
  ['assets.market', LENGTH_LIMITS.market],
  ['assets.currency', LENGTH_LIMITS.currency],
  // P5a 컷 2b — §5.12가 쓰는 두 열. 리터럴로 두면 이 대조 «밖»이 된다
  ['asset_provider_symbols.provider', LENGTH_LIMITS.provider],
  ['asset_provider_symbols.provider_symbol', LENGTH_LIMITS.providerSymbol],
]

/**
 * 선언 길이가 있지만 V-19의 대상이 아닌 열 — **사유가 곧 등재 조건이다.**
 *
 * 이 표가 있어야 위 대조가 「빠지지 않았는가」에 답한다. 대조 표만으로는 표에 있는
 * 열이 맞는지만 보므로, `add column`으로 새 열이 붙어도 표에 없으면 초록이다.
 * 계약에 이 열로 가는 쓰기 경로가 생기면 여기서 빼고 `V19_COLUMNS`로 올린다.
 */
const NOT_CONTRACT_INPUT: Readonly<Record<string, string>> = {
  'users.email': 'handle_new_auth_user 트리거가 auth.users에서 복사한다 — 계약에 쓰기 경로가 없다',
  'users.display_name': '같은 트리거가 left(…, 50)으로 잘라 넣는다 — 계약에 쓰기 경로가 없다',
  'asset_prices.provider': '수집 배치(collect.ts)가 PRICE_PROVIDERS의 id를 쓴다 — 사용자 입력이 아니다',
  // P8 컷 a3 — 같은 사유다. 자동 수집기(컷 c2)만 쓰고 수동 입력 계약(§5.13)은 null을 명시해 싣는다
  'exchange_rates.provider': '자동 수집기만 쓴다 — 수동 입력 계약(§5.13)은 provider = null을 명시한다',
  'tax_constants.key': '세율 마이그레이션만 쓴다(ADR-005) — 계약에 쓰기 경로가 없다',
}

const CLASSIFIED = [
  ...V19_COLUMNS.map(([column]) => column),
  ...Object.keys(NOT_CONTRACT_INPUT),
].sort()

function declaredColumns(lengths: ReadonlyMap<string, number>): string[] {
  return [...lengths.keys()].sort()
}

describe('V-19의 길이 상한이 스키마와 일치한다', () => {
  const { lengths, unattributed, scanned } = declaredLengths()

  /*
   * ★ 이 전제는 **이 파서 때문에** 생겼다 — 초판 파서가 `create table` 블록만 읽었으므로
   * 열을 넓히는 `alter column … type`이 추가되면 대조가 낡은 값을 조용히 통과시켰다.
   * 파서가 그 문장을 재생하게 된 뒤(P8 컷 1)에도 그대로 둔다. **P8 a2가 금액 열의 numeric
   * 정밀도를 의도적으로 떼므로(20260930040321_product_currency) 정규식을 문자열형 대상으로
   * 좁혔다** — numeric 쪽의 대조는 `tests/rls/numeric-typmod.test.ts`가 맡는다.
   */
  it('마이그레이션에 열 타입을 바꾸는 문장이 없다 — 파서의 전제', () => {
    const altering = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .filter((file) =>
        /alter\s+column\s+\w+\s+(?:set\s+data\s+)?type\s+(?:varchar|character\s+varying|char|character|bpchar|text)\b/i.test(
          readFileSync(join(MIGRATIONS_DIR, file), 'utf8'),
        ),
      )
    expect(altering).toEqual([])
  })

  it('길이형이 전부 열 선언에 귀속된다 — 파서가 모르는 형태가 없다', () => {
    expect(unattributed).toEqual([])
    // 공허 방지는 이 자리에 없다 — `scanned ≥ lengths.size`는 같은 정규식이라 항상 참이었다(P8 컷 1
    // 검증이 짚었다). 비공허의 실제 보증은 아래 「전부 분류」의 `toEqual(CLASSIFIED)`다
    expect(scanned).toBeGreaterThan(0)
  })

  it('선언 길이가 있는 열이 전부 분류되어 있다 — 대조하거나 사유를 적는다', () => {
    expect(declaredColumns(lengths)).toEqual(CLASSIFIED)
  })

  it.each(V19_COLUMNS)('%s = %i', (column, expected) => {
    expect(lengths.get(column)).toBe(expected)
  })
})

describe('길이 선언 파서가 판별한다 — 위 대조가 공허하지 않다', () => {
  const withProbe = (sql: string): DeclaredLengths =>
    parseDeclaredLengths([...migrationFiles(), { name: '99999999999999_probe.sql', sql }])

  it('나중에 add column으로 붙은 열을 본다 — 분류 대조가 반응한다', () => {
    const { lengths, unattributed } = withProbe(
      'alter table public.assets add column probe varchar(7);',
    )
    expect(lengths.get('assets.probe')).toBe(7)
    expect(unattributed).toEqual([])
    expect(declaredColumns(lengths)).toEqual([...CLASSIFIED, 'assets.probe'].sort())
  })

  it('지웠다 다시 붙인 열의 길이를 갱신한다 — 값 대조가 반응한다', () => {
    const { lengths } = withProbe(`
      alter table public.assets drop column market;
      alter table public.assets add column market varchar(7);
    `)
    expect(lengths.get('assets.market')).toBe(7)
    expect(lengths.get('assets.market')).not.toBe(LENGTH_LIMITS.market)
  })

  const BASE = `
    create table public.t (
      id uuid primary key,
      a  varchar(10) not null,
      b  numeric(18,6),
      constraint t_a_check check (a <> '' and b in (1, 2))
    );
  `

  it.each([
    [
      '여러 줄 · if not exists · character varying',
      `alter table public.t
         add column if not exists c character varying (7) not null default '';`,
      { 't.a': 10, 't.c': 7 },
    ],
    [
      '한 문장의 여러 동작 — 괄호 안 쉼표를 가르지 않는다',
      'alter table public.t add column d numeric(18,6), add column e char(3), add constraint t_e_check check (e <> \'\');',
      { 't.a': 10, 't.e': 3 },
    ],
    ['스키마 한정이 없다 · column 생략', 'ALTER TABLE t ADD f VARCHAR(5);', { 't.a': 10, 't.f': 5 }],
    ['char varying', 'alter table public.t add column g char varying(7);', { 't.a': 10, 't.g': 7 }],
    ['nchar', 'alter table public.t add column h nchar(7);', { 't.a': 10, 't.h': 7 }],
    ['national character varying', 'alter table public.t add column i national character varying (7);', { 't.a': 10, 't.i': 7 }],
    ['따옴표 붙은 "varchar"', 'alter table public.t add column j "varchar"(7);', { 't.a': 10, 't.j': 7 }],
    ['alter column … type — 넓힌다', 'alter table public.t alter column a type varchar(20);', { 't.a': 20 }],
    ['set data type', 'alter table public.t alter column a set data type varchar(30);', { 't.a': 30 }],
    ['text로 바꾸면 상한이 사라진다', 'alter table public.t alter column a type text;', {}],
    ['drop column', 'alter table public.t drop column if exists a;', {}],
    ['rename column', 'alter table public.t rename column a to z;', { 't.z': 10 }],
    ['rename to', 'alter table public.t rename to u;', { 'u.a': 10 }],
    ['drop table', 'drop table if exists public.t cascade;', {}],
    ['public 밖의 스키마는 접두사를 단다', 'create table private.p (x char(2));', { 't.a': 10, 'private.p.x': 2 }],
    [
      '주석·문자열·함수 본문은 선언이 아니다 — 본문의 ; 가 문장을 끊지 않는다',
      `-- alter table public.t add column x varchar(1);
       /* alter table public.t add column x2 varchar(1); /* 중첩 */ */
       comment on column public.t.a is 'varchar(2); it''s';
       comment on table public.t is E'it\\'s varchar(9);';
       create function public.f() returns void language sql as $body$
         alter table public.t add column y varchar(3);
       $body$;
       alter table public.t add column w varchar(4);`,
      { 't.a': 10, 't.w': 4 },
    ],
  ])('%s', (_, sql, expected) => {
    const { lengths, unattributed } = parseDeclaredLengths([
      { name: 'base.sql', sql: BASE },
      { name: 'probe.sql', sql },
    ])
    expect(Object.fromEntries(lengths)).toEqual(expected)
    expect(unattributed).toEqual([])
  })

  it('모르는 형태는 귀속 실패로 드러난다 — 조용히 건너뛰지 않는다', () => {
    const { lengths, unattributed } = parseDeclaredLengths([
      { name: 'probe.sql', sql: 'create domain public.short_code as varchar(7);' },
    ])
    expect(lengths.size).toBe(0)
    expect(unattributed).toEqual(['probe.sql: create domain public.short_code as varchar(7)'])
  })

  it('닫히지 않은 인용은 던진다 — 파일의 나머지를 삼키지 않는다', () => {
    expect(() =>
      parseDeclaredLengths([
        { name: 'x.sql', sql: "comment on table public.t is 'oops;\nalter table public.t add column z varchar(1);" },
      ]),
    ).toThrow(/닫히지 않은 문자열/)
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

describe('V-23 통과 금액은 보조단위로 접어 싣는다 — 기실현도 같다 (P8 컷 a2)', () => {
  /*
   * DB의 `scale()`은 끝의 0을 센다 — 접지 않고 `'10000.500'`을 보내면 `els_products_principal_scale_check`가,
   * `'10400.520'`을 보내면 `redemptions_gross_amount_digits_check`가 **정상 입력을** 거부한다. 원금·상환은
   * 통합 스위트가 왕복시키고, 기실현(부모가 아직 없어 같은 입력의 통화를 쓴다)은 여기서 본다(반박 검토)
   */
  const realized = (overrides: Record<string, unknown>) => {
    const p = new Problems()
    const input = parseRealizedProductInput(p, {
      name: '기실현 정규화',
      couponPayout: 'AT_REDEMPTION',
      accountType: 'GENERAL',
      redemptionType: 'EARLY',
      redemptionDate: '2025-06-02',
      taxableIncome: '610000',
      isConfirmed: true,
      ...overrides,
    })
    return { input, problems: p }
  }

  it('원화 — `19390000.0` · `20000000.00`이 정수 문자열이 된다', () => {
    const { input } = realized({ currency: 'KRW', principal: '19390000.0', grossAmount: '20000000.00' })
    expect(input).toMatchObject({ principal: '19390000', grossAmount: '20000000' })
  })

  it('달러 — `10000.500` · `10400.520`이 소수 두 자리가 된다', () => {
    const { input } = realized({ currency: 'USD', principal: '10000.500', grossAmount: '10400.520' })
    expect(input).toMatchObject({ principal: '10000.50', grossAmount: '10400.52' })
  })
})
