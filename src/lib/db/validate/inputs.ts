import type { HealthInsuranceType } from '@/lib/tax'

import type {
  AssetInput,
  ManualPriceInput,
  ProductInput,
  ProviderSymbolInput,
  RealizedProductInput,
  RedemptionInput,
  ScheduleInput,
  TaxProfileInput,
  UnderlyingInput,
} from '../mutations/types'
import {
  LENGTH_LIMITS,
  Problems,
  isPlainObject,
  optionalAmount,
  optionalBoolean,
  optionalEnum,
  optionalInt,
  optionalRatio,
  optionalString,
  requireAmount,
  requireArray,
  requireBoolean,
  requireEnum,
  requireInt,
  requireIsoDate,
  requireRatio,
  requireString,
  requireUuid,
} from './primitives'
import {
  V12_maturityLossZero,
  V21_knownProvider,
  validateProductCrossFields,
  validateRedemptionCrossFields,
} from './rules'

/**
 * 셰이프 파싱 — 서버 액션의 인자는 **`unknown`이다**
 *
 * 변경 계약은 클라이언트가 직렬화한 값을 받으므로 타입 선언은 아무것도 보장하지
 * 않는다. 여기서 형태를 확인하고 §5의 타입으로 좁힌다. 필드 단위 규칙(V-01·V-08·
 * V-11·V-15·V-19·V-20)은 이 과정에서 같은 ID로 기록된다 — 형식과 범위를 두 번
 * 순회하지 않기 위함이다. 교차 필드 규칙은 `rules.ts`가 맡는다.
 *
 * **부분 실패에서도 최대한 많은 위반을 모은다.** 첫 오류에서 멈추면 사용자가
 * 필드를 하나씩 고치며 왕복하게 된다. 다만 하위 배열의 원소가 형태부터 깨졌으면
 * 그 원소의 교차 필드 규칙은 검사하지 않는다 — 없는 값으로 비교하면 위반이 아니라
 * 잡음이 된다.
 */

const ACCOUNT_TYPES = ['GENERAL', 'TAX_FREE'] as const
const KI_OBSERVATIONS = ['CONTINUOUS', 'CLOSING'] as const
const REDEMPTION_TYPES = ['EARLY', 'LIZARD', 'MATURITY_GAIN', 'MATURITY_LOSS'] as const
const ASSET_TYPES = ['STOCK', 'INDEX', 'ETF'] as const
const HEALTH_INSURANCE_TYPES: readonly HealthInsuranceType[] = [
  'EMPLOYEE',
  'REGIONAL',
  'DEPENDENT',
  'NONE',
]

/** 순수 모듈의 날짜 하한(`toEpochDay`는 연도 < 1000을 거부한다)과 맞춘다 */
const MIN_YEAR = 1000
const MAX_YEAR = 9999

/** `null`이 하나라도 있으면 파싱 실패 — 위반은 이미 기록되어 있다 */
function allPresent<T>(values: Array<T | null | undefined>): boolean {
  return values.every((value) => value !== null)
}

// ---------------------------------------------------------------------------
// 상품
// ---------------------------------------------------------------------------

function parseUnderlying(
  p: Problems,
  raw: unknown,
  index: number,
): UnderlyingInput | null {
  const at = `underlyings[${index}]`
  if (!isPlainObject(raw)) {
    p.add('V-02', at, '기초자산 입력 형식이 올바르지 않다.')
    return null
  }

  const assetId = requireUuid(p, 'V-09', `${at}.assetId`, raw.assetId, '기초자산')
  // V-15 — 기준가격은 등락률의 분모다. 0이면 조회가 전원에게 죽는다(DOC-007 §3.1)
  const basePrice = requireAmount(p, 'V-15', `${at}.basePrice`, raw.basePrice, {
    label: '기준가격',
    min: 'positive',
  })
  const sequence = requireInt(p, 'V-20', `${at}.sequence`, raw.sequence, {
    label: '순서',
    min: 1,
  })

  if (!allPresent([assetId, basePrice, sequence])) return null
  return { assetId: assetId!, basePrice: basePrice!, sequence: sequence! }
}

function parseSchedule(p: Problems, raw: unknown, index: number): ScheduleInput | null {
  const at = `schedules[${index}]`
  if (!isPlainObject(raw)) {
    p.add('V-03', at, '평가일정 입력 형식이 올바르지 않다.')
    return null
  }

  const roundNo = requireInt(p, 'V-20', `${at}.roundNo`, raw.roundNo, {
    label: '차수',
    min: 1,
  })
  const evaluationDate = requireIsoDate(
    p,
    'V-07',
    `${at}.evaluationDate`,
    raw.evaluationDate,
    '평가일',
  )
  const barrier = requireRatio(p, 'V-08', `${at}.barrier`, raw.barrier, {
    label: '배리어',
    min: 'positive',
  })
  const lizardBarrier = optionalRatio(p, 'V-08', `${at}.lizardBarrier`, raw.lizardBarrier, {
    label: '리자드 배리어',
    min: 'positive',
  })
  // ★ 하한이 0이다 — 원금상환형 리자드는 0으로 표기한다(DOC-007 §4.1). V-08의
  //   하한을 필드별로 세분한 이유가 이 한 줄이다.
  const lizardCouponRate = optionalRatio(
    p,
    'V-08',
    `${at}.lizardCouponRate`,
    raw.lizardCouponRate,
    { label: '리자드 쿠폰율', min: 'zero' },
  )
  const lizardRequiresNoKi = optionalBoolean(
    p,
    'V-06',
    `${at}.lizardRequiresNoKi`,
    raw.lizardRequiresNoKi,
    'KI 미터치 요구',
  )

  if (
    !allPresent([
      roundNo,
      evaluationDate,
      barrier,
      lizardBarrier,
      lizardCouponRate,
      lizardRequiresNoKi,
    ])
  ) {
    return null
  }

  const schedule: ScheduleInput = {
    roundNo: roundNo!,
    evaluationDate: evaluationDate!,
    barrier: barrier!,
  }
  if (lizardBarrier != null) schedule.lizardBarrier = lizardBarrier
  if (lizardCouponRate != null) schedule.lizardCouponRate = lizardCouponRate
  if (lizardRequiresNoKi != null) schedule.lizardRequiresNoKi = lizardRequiresNoKi
  return schedule
}

export function parseProductInput(p: Problems, raw: unknown): ProductInput | null {
  if (!isPlainObject(raw)) {
    p.add('V-19', 'name', '입력 형식이 올바르지 않다.')
    return null
  }

  const name = requireString(p, 'V-19', 'name', raw.name, {
    label: '상품명',
    max: LENGTH_LIMITS.productName,
  })
  const issuer = optionalString(p, 'V-19', 'issuer', raw.issuer, {
    label: '발행사',
    max: LENGTH_LIMITS.issuer,
  })
  const issueDate = requireIsoDate(p, 'V-07', 'issueDate', raw.issueDate, '발행일')
  const principal = requireAmount(p, 'V-01', 'principal', raw.principal, {
    label: '투자원금',
    min: 'positive',
    integer: true,
  })
  const evaluationPeriodMonths = requireInt(
    p,
    'V-20',
    'evaluationPeriodMonths',
    raw.evaluationPeriodMonths,
    { label: '평가주기(개월)', min: 1 },
  )
  const totalRounds = requireInt(p, 'V-20', 'totalRounds', raw.totalRounds, {
    label: '총 차수',
    min: 1,
  })
  const annualCouponRate = requireRatio(
    p,
    'V-08',
    'annualCouponRate',
    raw.annualCouponRate,
    { label: '연쿠폰율', min: 'positive' },
  )
  const kiBarrier = optionalRatio(p, 'V-08', 'kiBarrier', raw.kiBarrier, {
    label: 'KI 배리어',
    min: 'positive',
  })
  const kiObservation = optionalEnum(
    p,
    'V-16',
    'kiObservation',
    raw.kiObservation,
    KI_OBSERVATIONS,
    'KI 관찰 방식',
  )
  const accountType = requireEnum(
    p,
    'V-19',
    'accountType',
    raw.accountType,
    ACCOUNT_TYPES,
    '계좌유형',
  )
  // note는 text이므로 길이 상한이 없다. 형태만 본다
  const note = optionalString(p, 'V-19', 'note', raw.note, { label: '비고' })

  const rawUnderlyings = requireArray(p, 'V-02', 'underlyings', raw.underlyings, '기초자산')
  const rawSchedules = requireArray(p, 'V-03', 'schedules', raw.schedules, '평가일정')

  const underlyings =
    rawUnderlyings?.map((item, index) => parseUnderlying(p, item, index)) ?? null
  const schedules = rawSchedules?.map((item, index) => parseSchedule(p, item, index)) ?? null

  const scalarsOk = allPresent([
    name,
    issuer,
    issueDate,
    principal,
    evaluationPeriodMonths,
    totalRounds,
    annualCouponRate,
    kiBarrier,
    kiObservation,
    accountType,
    note,
  ])

  // 하위 배열은 **원소 하나라도 형태가 깨지면** 교차 필드 검사를 하지 않는다 —
  // 없는 값으로 비교하면 위반이 아니라 잡음이 된다.
  const childrenOk =
    underlyings != null &&
    schedules != null &&
    underlyings.every((item) => item !== null) &&
    schedules.every((item) => item !== null)

  if (!childrenOk) {
    // 개수 규칙은 형태와 무관하게 성립한다 — 0건은 원소 형태를 볼 필요가 없다
    if (underlyings != null && underlyings.length === 0) {
      p.add('V-02', 'underlyings', '기초자산을 1개 이상 입력한다.')
    }
    if (schedules != null && schedules.length === 0) {
      p.add('V-03', 'schedules', '평가일정을 1개 이상 입력한다.')
    }
    return null
  }
  if (!scalarsOk) return null

  const input: ProductInput = {
    name: name!,
    issueDate: issueDate!,
    principal: principal!,
    evaluationPeriodMonths: evaluationPeriodMonths!,
    totalRounds: totalRounds!,
    annualCouponRate: annualCouponRate!,
    accountType: accountType!,
    underlyings: underlyings as UnderlyingInput[],
    schedules: schedules as ScheduleInput[],
  }
  if (issuer != null) input.issuer = issuer
  if (kiBarrier != null) input.kiBarrier = kiBarrier
  if (kiObservation != null) input.kiObservation = kiObservation
  if (note != null) input.note = note

  validateProductCrossFields(p, input)
  return p.isEmpty ? input : null
}

// ---------------------------------------------------------------------------
// 상환
// ---------------------------------------------------------------------------

export function parseRedemptionInput(p: Problems, raw: unknown): RedemptionInput | null {
  if (!isPlainObject(raw)) {
    p.add('V-19', 'redemptionType', '입력 형식이 올바르지 않다.')
    return null
  }

  const redemptionType = requireEnum(
    p,
    'V-13',
    'redemptionType',
    raw.redemptionType,
    REDEMPTION_TYPES,
    '상환 유형',
  )
  const roundNo = optionalInt(p, 'V-20', 'roundNo', raw.roundNo, { label: '차수', min: 1 })
  const redemptionDate = requireIsoDate(
    p,
    'V-10',
    'redemptionDate',
    raw.redemptionDate,
    '상환일',
  )
  const grossAmount = requireAmount(p, 'V-19', 'grossAmount', raw.grossAmount, {
    label: '실수령액',
    min: 'zero',
    integer: true,
  })
  // V-11 — 0 이상. 음수는 §7.3의 연도별 합계를 그대로 오염시킨다(I-12)
  const taxableIncome = requireAmount(p, 'V-11', 'taxableIncome', raw.taxableIncome, {
    label: '과세 금융소득',
    min: 'zero',
    integer: true,
  })
  const withholdingTax = optionalAmount(p, 'V-19', 'withholdingTax', raw.withholdingTax, {
    label: '원천징수세액',
    min: 'zero',
    integer: true,
  })
  const isConfirmed = requireBoolean(p, 'V-19', 'isConfirmed', raw.isConfirmed, '확정값 여부')
  const note = optionalString(p, 'V-19', 'note', raw.note, { label: '비고' })

  if (
    !allPresent([
      redemptionType,
      roundNo,
      redemptionDate,
      grossAmount,
      taxableIncome,
      withholdingTax,
      isConfirmed,
      note,
    ])
  ) {
    return null
  }

  const input: RedemptionInput = {
    redemptionType: redemptionType!,
    redemptionDate: redemptionDate!,
    grossAmount: grossAmount!,
    taxableIncome: taxableIncome!,
    isConfirmed: isConfirmed!,
  }
  if (roundNo != null) input.roundNo = roundNo
  if (withholdingTax != null) input.withholdingTax = withholdingTax
  if (note != null) input.note = note

  validateRedemptionCrossFields(p, input)
  return p.isEmpty ? input : null
}

/**
 * §5.11 기실현 등재 — 상품 스칼라 넷 + 상환 실적 여섯
 *
 * **`parseProductInput`·`parseRedemptionInput`을 부르지 않는다.** 둘 다 이 입력에
 * 없는 필드를 필수로 요구하므로(발행일·연쿠폰율·기초자산·차수 / 없음) 부르면
 * 존재하지 않는 칸에 오류가 붙는다 — 화면에 그 칸이 없으므로 사용자는 **고칠 수
 * 없는 오류**를 본다. 규칙 ID와 필드 이름은 두 파서와 같은 것을 쓴다: 같은 값에
 * 다른 ID를 주면 §6의 표가 두 뜻을 갖게 된다.
 *
 * **V-13을 부르지 않는 것이 규칙 위반이 아니다** — 입력에 `roundNo`가 없어 위반을
 * 표현할 수 없다(DOC-011 §5.11). V-10도 같다: 발행일이 없으므로 비교 대상이 없다.
 */
export function parseRealizedProductInput(
  p: Problems,
  raw: unknown,
): RealizedProductInput | null {
  if (!isPlainObject(raw)) {
    p.add('V-19', 'name', '입력 형식이 올바르지 않다.')
    return null
  }

  const name = requireString(p, 'V-19', 'name', raw.name, {
    label: '상품명',
    max: LENGTH_LIMITS.productName,
  })
  const issuer = optionalString(p, 'V-19', 'issuer', raw.issuer, {
    label: '발행사',
    max: LENGTH_LIMITS.issuer,
  })
  const principal = requireAmount(p, 'V-01', 'principal', raw.principal, {
    label: '투자원금',
    min: 'positive',
    integer: true,
  })
  const accountType = requireEnum(
    p,
    'V-19',
    'accountType',
    raw.accountType,
    ACCOUNT_TYPES,
    '계좌유형',
  )

  const redemptionType = requireEnum(
    p,
    'V-13',
    'redemptionType',
    raw.redemptionType,
    REDEMPTION_TYPES,
    '상환 유형',
  )
  const redemptionDate = requireIsoDate(
    p,
    'V-10',
    'redemptionDate',
    raw.redemptionDate,
    '상환일',
  )
  const grossAmount = requireAmount(p, 'V-19', 'grossAmount', raw.grossAmount, {
    label: '실수령액',
    min: 'zero',
    integer: true,
  })
  const taxableIncome = requireAmount(p, 'V-11', 'taxableIncome', raw.taxableIncome, {
    label: '과세 금융소득',
    min: 'zero',
    integer: true,
  })
  const withholdingTax = optionalAmount(p, 'V-19', 'withholdingTax', raw.withholdingTax, {
    label: '원천징수세액',
    min: 'zero',
    integer: true,
  })
  const isConfirmed = requireBoolean(p, 'V-19', 'isConfirmed', raw.isConfirmed, '확정값 여부')
  const note = optionalString(p, 'V-19', 'note', raw.note, { label: '비고' })

  if (
    !allPresent([
      name,
      issuer,
      principal,
      accountType,
      redemptionType,
      redemptionDate,
      grossAmount,
      taxableIncome,
      withholdingTax,
      isConfirmed,
      note,
    ])
  ) {
    return null
  }

  const input: RealizedProductInput = {
    name: name!,
    principal: principal!,
    accountType: accountType!,
    redemptionType: redemptionType!,
    redemptionDate: redemptionDate!,
    grossAmount: grossAmount!,
    taxableIncome: taxableIncome!,
    isConfirmed: isConfirmed!,
  }
  if (issuer != null) input.issuer = issuer
  if (withholdingTax != null) input.withholdingTax = withholdingTax
  if (note != null) input.note = note

  // V-12는 부른다 — 절대 규칙 #8이며 유형과 과표만 보면 판정된다(차수가 필요 없다).
  V12_maturityLossZero(p, input)
  return p.isEmpty ? input : null
}

// ---------------------------------------------------------------------------
// 과세 프로필 · 시세 · 자산
// ---------------------------------------------------------------------------

export function parseTaxProfileInput(p: Problems, raw: unknown): TaxProfileInput | null {
  if (!isPlainObject(raw)) {
    p.add('V-20', 'year', '입력 형식이 올바르지 않다.')
    return null
  }

  const year = requireInt(p, 'V-20', 'year', raw.year, {
    label: '연도',
    min: MIN_YEAR,
    max: MAX_YEAR,
  })
  const otherIncomeBase = requireAmount(p, 'V-19', 'otherIncomeBase', raw.otherIncomeBase, {
    label: '금융소득 외 종합소득 과세표준',
    min: 'zero',
    integer: true,
  })
  const otherFinancialIncome = requireAmount(
    p,
    'V-19',
    'otherFinancialIncome',
    raw.otherFinancialIncome,
    { label: 'ELS 외 금융소득', min: 'zero', integer: true },
  )
  const healthInsuranceType = requireEnum(
    p,
    'V-19',
    'healthInsuranceType',
    raw.healthInsuranceType,
    HEALTH_INSURANCE_TYPES,
    '건강보험 가입유형',
  )

  if (!allPresent([year, otherIncomeBase, otherFinancialIncome, healthInsuranceType])) {
    return null
  }
  return {
    year: year!,
    otherIncomeBase: otherIncomeBase!,
    otherFinancialIncome: otherFinancialIncome!,
    healthInsuranceType: healthInsuranceType!,
  }
}

export function parseManualPriceInput(p: Problems, raw: unknown): ManualPriceInput | null {
  if (!isPlainObject(raw)) {
    p.add('V-15', 'price', '입력 형식이 올바르지 않다.')
    return null
  }

  const assetId = requireUuid(p, 'V-19', 'assetId', raw.assetId, '기초자산')
  const asOfDate = requireIsoDate(p, 'V-17', 'asOfDate', raw.asOfDate, '기준일자')
  const price = requireAmount(p, 'V-15', 'price', raw.price, {
    label: '시세',
    min: 'positive',
  })

  if (!allPresent([assetId, asOfDate, price])) return null
  return { assetId: assetId!, asOfDate: asOfDate!, price: price! }
}

/**
 * §5.12 — 공급자 심볼 매핑.
 *
 * ★ **`providerSymbol`은 `null`을 «정상 값»으로 받는다**(해제). 그래서 `allPresent`에
 * 넣지 않는다 — 넣으면 해제 요청이 「입력 누락」으로 거부된다.
 *
 * ★★ **`provider`는 형식이 아니라 «소속»을 본다 (V-21).** 열이 `varchar(30)`이므로 아무
 * 문자열이나 저장되는데, 어느 수집기도 모르는 값은 그 매핑을 **영구히 쓰이지 않는 행**으로
 * 만든다 — 화면은 「자동 수집됨」으로 읽히고 수집은 되지 않으며 `unmapped`도 세지 않는다.
 * 오타 하나가 만드는 조용한 상태다.
 *
 * ★★★ 반대로 **`providerSymbol`의 «내용»은 검증하지 않는다.** 그것은 공급자만 아는 값이고,
 * 화면이 판단자가 되면 「공급자 목록에 있는데 화면이 거부한다」가 생긴다. 없는 코드는
 * 공급자가 0건으로 답하고 그것이 `NO_DATA`(→ 「매핑을 고친다」)다 — DQ-02가 그 경로를
 * 이미 설계했다. **소속은 우리가 알고 내용은 공급자가 안다.**
 */
export function parseProviderSymbolInput(
  p: Problems,
  raw: unknown,
): ProviderSymbolInput | null {
  if (!isPlainObject(raw)) {
    p.add('V-19', 'provider', '입력 형식이 올바르지 않다.')
    return null
  }

  const assetId = requireUuid(p, 'V-19', 'assetId', raw.assetId, '기초자산')
  const provider = requireString(p, 'V-19', 'provider', raw.provider, {
    label: '공급자',
    max: LENGTH_LIMITS.provider,
  })
  if (provider != null) V21_knownProvider(p, provider)

  // `null`·`undefined`는 해제다. 문자열이면 길이·공백을 본다
  let providerSymbol: string | null = null
  if (raw.providerSymbol != null) {
    providerSymbol = requireString(p, 'V-19', 'providerSymbol', raw.providerSymbol, {
      label: '공급자 심볼',
      max: LENGTH_LIMITS.providerSymbol,
    })
    /*
     * 앞뒤 공백을 «거부»한다(잘라내지 않는다). 잘라내면 사용자가 넣은 것과 저장된 것이
     * 달라지고, 공급자 심볼은 그 차이가 조용히 조회 실패로 나타나는 값이다.
     */
    if (providerSymbol != null && providerSymbol !== providerSymbol.trim()) {
      p.add('V-19', 'providerSymbol', '공급자 심볼에 앞뒤 공백을 넣을 수 없다.')
      providerSymbol = null
      return null
    }
  }

  // ★ `providerSymbol`을 넣지 않는다 — `null`이 정상 값이다
  if (!allPresent([assetId, provider])) return null
  return { assetId: assetId!, provider: provider!, providerSymbol }
}

export function parseAssetInput(p: Problems, raw: unknown): AssetInput | null {
  if (!isPlainObject(raw)) {
    p.add('V-19', 'name', '입력 형식이 올바르지 않다.')
    return null
  }

  const name = requireString(p, 'V-19', 'name', raw.name, {
    label: '자산명',
    max: LENGTH_LIMITS.assetName,
  })
  const assetType = requireEnum(p, 'V-19', 'assetType', raw.assetType, ASSET_TYPES, '자산 유형')
  const market = optionalString(p, 'V-19', 'market', raw.market, {
    label: '시장',
    max: LENGTH_LIMITS.market,
  })
  // `char(3)`이므로 짧으면 공백으로 채워진다 — 정확히 3자를 요구한다
  const currency = requireString(p, 'V-19', 'currency', raw.currency, {
    label: '통화',
    exact: LENGTH_LIMITS.currency,
    upperAlpha: true,
  })

  if (!allPresent([name, assetType, market, currency])) return null

  const input: AssetInput = { name: name!, assetType: assetType!, currency: currency! }
  if (market != null) input.market = market
  return input
}

/**
 * §5.9 `setKiTouched`의 `touchedAt` — `null`은 해제이므로 정상 입력이다.
 *
 * **`fields` 키는 파라미터 이름이 아니라 `kiTouchedAt`이다.** 이 계약의 입력은
 * 위치 인자라 필드 이름이 없고, §3.1이 `fields`를 "계약 입력의 필드 이름"으로만
 * 정의해 그 공백에서 계약 계층과 DB 매핑이 갈려 있었다(§5.9 v1.1 각주).
 */
export function parseTouchedAt(p: Problems, raw: unknown): string | null | undefined {
  if (raw === null) return null
  const parsed = requireIsoDate(p, 'V-18', 'kiTouchedAt', raw, 'KI 터치 확정일')
  return parsed ?? undefined
}

export { Problems }
