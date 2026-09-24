import { dec, truncateToUnit } from '@/lib/decimal'
import { dDay, generateEvaluationDates } from '@/lib/domain'
import { parseTenor } from '@/lib/providers/kiwoom/ladder'
import { crossCheckTerms } from '@/lib/providers/kiwoom/terms-check'
import type {
  KiwoomProductTerms,
  KiwoomRound,
  TermsDiscrepancy,
} from '@/lib/providers/kiwoom/terms-types'

import { path } from './fieldPath'
import type { AssetResolution } from './importAssets'
import { EVALUATION_DATE_BASIS_FIELD } from './schedules'

/**
 * 키움 상품 조건 → SCR-204 폼 값 — **순수**하다 (DOC-008 §5 SCR-204 v2.9 · DOC-010 ADR-009)
 *
 * 불러오기의 마지막 단계다. 어댑터가 페이지를 **페이지의 단위**로 옮겨 오고(`'85'`·누적 수익률),
 * 이 함수가 그것을 폼의 단위로 바꾼다(퍼센트 문자열 — 폼의 모든 비율 칸이 퍼센트다). 저장은
 * 여기서 일어나지 않는다 — 결과는 `initialValues`이고 사용자가 확인한 뒤 §5.1을 지난다.
 *
 * ## 결과는 셋이다 — 그리고 «거부»는 값을 하나도 싣지 않는다
 *
 * | 결과 | 뜻 |
 * |---|---|
 * | `REFUSED` | 채우지 않는다. 사유와 투자설명서 링크만 보인다 |
 * | `PARTIAL` | 검증된 것을 채웠고 **무엇이 비었는지** 안내한다 |
 * | `FILLED` | 채울 수 있는 것을 전부 채웠다 |
 *
 * **부분만 믿을 수 있는 상품을 부분 채움으로 두지 않는 이유**: 표의 1·2차 배리어가 틀린
 * 상품(E03060)에서 나머지를 채우면 사용자는 채워진 전부를 같은 무게로 믿는다. 어긋남이 하나라도
 * 있으면 그 상품의 표 전체가 의심스럽다 — 폼을 비우고 투자설명서로 보낸다.
 *
 * ## 절대 채우지 않는 셋
 *
 * `principal`·`accountType`·`note` — 계좌 정보이고 원천에 없다(DOC-001 S-12).
 * `tests/app/importFill.test.ts`가 결과 키에 그 셋이 없음을 단언한다.
 *
 * ## 던지지 않는다
 *
 * `roundFillOf`(SCR-203)와 같은 규약이다 — 어떤 입력에도 값을 돌려준다. 순수 모듈의 예외는
 * 잡아서 `REFUSED`로 바꾼다(페이지를 죽이면 수동 등록까지 막힌다 — DOC-011 §4.10 X-02).
 */

export type ImportNote = {
  /** 안내를 붙일 스칼라 칸. `null`이면 구획 머리의 안내다 */
  field: string | null
  text: string
}

export type ImportFill =
  | { kind: 'REFUSED'; reasons: string[]; notes: ImportNote[] }
  | {
      kind: 'FILLED' | 'PARTIAL'
      values: Record<string, string>
      notes: ImportNote[]
      /** 앱 자산과 잇지 못한 기초자산의 **팝업 표 이름** — 형제 폼이 하나씩 받는다 */
      unresolved: string[]
    }

export const IMPORT_ISSUER = '키움증권'

/** 산식(0일 규약)에서 이만큼 넘게 벗어난 평가일은 거부한다 — 실측 차이는 0~4일이고 월 오차는 28일 이상이다 */
const MAX_DRIFT_DAYS = 10

export function importFillOf(
  terms: KiwoomProductTerms,
  assets: Readonly<Record<string, AssetResolution>>,
): ImportFill {
  try {
    return fill(terms, assets)
  } catch {
    return {
      kind: 'REFUSED',
      reasons: ['안내 화면의 값을 해석하지 못했다 — 투자설명서를 보고 직접 입력한다.'],
      notes: [],
    }
  }
}

function fill(
  terms: KiwoomProductTerms,
  assets: Readonly<Record<string, AssetResolution>>,
): ImportFill {
  const reasons: string[] = []
  const notes: ImportNote[] = []
  const ladder = terms.ladder

  /*
   * ---------- 적격성 + 같은 페이지 안의 두 번째 증인과의 대조 (ADR-009 §3 둘째 겹)
   *
   * 월지급·외화·만기 구획 없음·K ≥ L도 어댑터의 `BLOCKING`이다(`terms-check.ts`의 대응표).
   * 여기서 다시 판정하지 않는다 — 두 층이 같은 거부를 각자 하면 한쪽만 고쳐지는 날이 온다.
   * 이 층에 남는 거부는 **앱의 산식이 필요한 것**(평가일 10일)과 **폼의 단위로 옮길 수 없는 것**
   * (리자드 쿠폰의 연율 환산)뿐이다.
   */
  const discrepancies = crossCheckTerms(terms)

  /*
   * ---------- 청약 중은 거부다 (DOC-008 v2.11 — 반박 검토)
   *
   * 기준가격이 아직 없다(발행 전). 계약이 V-15로 양수를 요구하고 열이 `NOT NULL`이므로 채워
   * 봐야 저장할 수 없고, 저장하려면 기준가를 지어내야 한다 — 그 값은 워스트오브·KI·조기상환의
   * 분모다. v2.9는 이것을 「일부 채움」으로 두고 「발행 뒤 채운다」고 안내했는데 그 안내를 따르면
   * 저장이 거부됐다.
   */
  if (terms.status !== 'ISSUED') {
    reasons.push(
      '청약 중인 상품이다 — 기준가격이 아직 정해지지 않아 저장할 수 없다. 기준가격 결정일 뒤 다시 불러온다.',
    )
  }

  for (const d of discrepancies) {
    if (d.severity === 'BLOCKING') {
      const text = reasonOf(d)
      if (!reasons.includes(text)) reasons.push(text)
    }
  }

  /* ---------- 평가주기 · 차수 */
  const period = ladder.periodMonths ?? parseTenor(terms.header.tenorText).periodMonths
  // 월지급식은 어댑터가 PERIOD_UNKNOWN을 내지 않는다(수익률 대조를 건너뛴다) — 여기서도 막되 문구는 하나다
  if (period == null && !reasons.includes('평가주기를 읽을 수 없다.')) reasons.push('평가주기를 읽을 수 없다.')

  const early = terms.rounds.filter((r) => r.variant !== 2)
  const lizardRows = terms.rounds.filter((r) => r.variant === 2)
  const totalRounds = early.length + 1

  /* ---------- 리자드 — K < L은 어댑터가 보았다(KI_NOT_BELOW_LIZARD). 여기서는 쿠폰의 단위다 */
  const lizards = lizardSpecs(terms, lizardRows, period)
  for (const spec of lizards) {
    if (spec.couponPct == null) {
      reasons.push(`${spec.round}차 리자드 쿠폰율을 연율로 환산할 수 없다 — 투자설명서로 확인한다.`)
    }
  }

  /* ---------- 평가일 — 실제 날짜. 만기는 마지막 평균일 (DQ-10) */
  const dates: string[] = early.map((r) => r.evaluationDate)
  const maturityDate = terms.maturity?.evaluationDates.at(-1) ?? ''
  dates.push(maturityDate)

  if (period != null && terms.maturity != null) {
    for (const problem of dateProblems(terms.header.issueDate, period, dates)) reasons.push(problem)
  }

  if (reasons.length > 0) return { kind: 'REFUSED', reasons, notes }
  // 여기부터는 거부가 없다 — 어댑터의 대응표가 아래 넷의 부재를 BLOCKING으로 막았다
  const maturity = terms.maturity!
  const headline = terms.header.headlineAnnualPct!

  /* ---------- 여기부터 채운다 */
  const values: Record<string, string> = {
    name: terms.name,
    issuer: IMPORT_ISSUER,
    issueDate: terms.header.issueDate,
    evaluationPeriodMonths: String(period),
    totalRounds: String(totalRounds),
    annualCouponRate: pct(headline),
    kiBarrier: ladder.noKi ? '' : pct(ladder.kiPct!),
    // 관찰방식은 안내 화면에 없다 — 지어내지 않는다(DOC-008 SQ-09). V-16이 선택을 요구한다
    kiObservation: '',
    barriers: '',
    // 불러온 날짜의 기준 — 저장 규칙이 이 날짜들을 「실제 날짜」로 읽는다(DOC-008 v2.8)
    [EVALUATION_DATE_BASIS_FIELD]: `${terms.header.issueDate}|${period}`,
  }

  const barriers = [...early.map((r) => r.barrierPct), maturity.barrierPct]

  for (let index = 0; index < totalRounds; index += 1) {
    const at = (sub: string) => path('schedules', index, sub)
    values[at('evaluationDate')] = dates[index] ?? ''
    values[at('barrier')] = pct(barriers[index]!)
    const lizard = lizards.find((spec) => spec.round === index + 1)
    values[at('lizardBarrier')] = lizard == null ? '' : pct(lizard.barrierPct)
    values[at('lizardCouponRate')] = lizard?.couponPct == null ? '' : pct(lizard.couponPct)
    // 키움 리자드는 경로 조건이다 — 켜 두는 쪽이 진실에 더 가깝다(DQ-09, 민서 결정 2026-09-23)
    values[at('lizardRequiresNoKi')] = lizard == null ? '' : 'on'
  }

  /* ---------- 기초자산 */
  const unresolved: string[] = []
  const usedIds = new Set<string>()
  let duplicate = false
  terms.assets.forEach((asset, index) => {
    const resolution = assets[asset.name]
    let assetId = ''
    if (resolution?.kind === 'RESOLVED') {
      if (usedIds.has(resolution.assetId)) {
        // V-09 — 한 상품에 같은 자산이 둘이면 계약이 거부한다. 뒤의 행을 비워 사람이 고르게 한다
        duplicate = true
        notes.push({ field: null, text: `${asset.name} — 앞 행과 같은 앱 자산으로 풀렸다. 고른다.` })
      } else {
        assetId = resolution.assetId
        usedIds.add(assetId)
      }
    } else {
      unresolved.push(asset.name)
    }
    values[path('underlyings', index, 'assetId')] = assetId
    values[path('underlyings', index, 'basePrice')] = asset.basePrice ?? ''
  })

  /* ---------- 안내 */
  if (!ladder.noKi) {
    notes.push({
      field: 'kiObservation',
      text: '관찰방식은 안내 화면에 없다 — 투자설명서에서 확인해 고른다.',
    })
  }
  if (lizards.length > 0) {
    notes.push({
      field: null,
      text:
        '리자드는 약관상 「그 차수까지 한 번이라도 리자드 배리어 미만으로 떨어진 적이 없어야」 하는 경로 조건이다. ' +
        '앱은 평가일 하루로 판정하므로 전망이 실제보다 낙관적일 수 있다(DQ-09).',
    })
    if (ladder.noKi) {
      notes.push({
        field: null,
        text: '노낙인 상품의 리자드는 「KI 미터치 요구」가 판정에 쓰이지 않는다 — 평가일 하루만 본다.',
      })
    }
  }
  if (maturity.evaluationDates.length > 1) {
    notes.push({
      field: null,
      text:
        `만기는 ${maturity.evaluationDates.length}일 종가 평균으로 판정된다 — 앱은 마지막 날(${maturityDate}) ` +
        '하루로 판정한다(DQ-10).',
    })
  }
  if (/상환/.test(terms.header.redeemedText ?? '') && !/미상환/.test(terms.header.redeemedText ?? '')) {
    notes.push({
      field: null,
      text: '이미 상환된 상품이다 — 과거 이력을 옮기는 것이면 기실현 등재(SCR-205)가 맞다.',
    })
  }
  for (const d of discrepancies) {
    if (d.severity === 'NOTE') {
      const text = noteOf(d)
      if (text != null) notes.push({ field: null, text })
    }
  }

  // KI 상품은 관찰방식이 비므로 늘 PARTIAL이다 — 「무엇이 비었는지」를 화면이 말해야 한다
  const partial = unresolved.length > 0 || !ladder.noKi || duplicate
  return { kind: partial ? 'PARTIAL' : 'FILLED', values, notes, unresolved }
}

/** 퍼센트 문자열 — 폼이 기대하는 정규형(`ratioToPercent`와 같다: `'32.10'` → `'32.1'`) */
function pct(raw: string): string {
  return dec(raw).toString()
}

type LizardSpec = { round: number; barrierPct: string; couponPct: string | null }

/** 배수가 적혀 있지 않을 때 시험하는 정수 배수의 상한 — 실측은 1배·2배다 */
const MAX_LIZARD_MULTIPLE = 3

/**
 * 리자드 차수 — `k-2` 행. 쿠폰율은 **연율**이다(DOC-007 §4.1 — `applicableCouponRate`가
 * 연쿠폰율 자리를 대신한다).
 *
 * 배수가 적혀 있으면 `배수 × 헤드라인 연율`이다(어댑터가 표의 누적값과 맞는지 이미 봤다).
 * **적혀 있지 않으면 역산하지 않는다** (ADR-009 §3 v3.9 — 반박 검토): 표의 누적값은 **절사된**
 * 값이므로 `누적 × 12 / 경과 개월`은 절사 오차를 연율에 싣고, 그 결과가 소수 둘째 자리 안에
 * 떨어지기까지 하면 검사를 통과한다. 대신 정수 배수 k마다 `헤드라인 × 경과 개월 / 12 × k`를
 * 절사해 표와 **정방향으로** 비교하고, 맞는 k가 없으면 `null`(거부)이다.
 */
function lizardSpecs(
  terms: KiwoomProductTerms,
  lizardRows: readonly KiwoomRound[],
  period: number | null,
): LizardSpec[] {
  return lizardRows.map((row) => ({
    round: row.round,
    barrierPct: row.barrierPct,
    couponPct: lizardCouponPct({
      headlinePct: terms.header.headlineAnnualPct,
      multiple: terms.ladder.lizardMultiple,
      periodMonths: period,
      round: row.round,
      cumulativePct: row.cumulativeYieldPct,
    }),
  }))
}

/**
 * 리자드 쿠폰율(연율, 퍼센트) — 위 각주의 규칙. 맞는 값이 없으면 `null`(거부)이다.
 *
 * 테스트가 이 함수를 직접 부른다 — 어댑터의 대조가 먼저 막는 합성 상품으로는 이 규칙만 따로
 * 시험할 수 없다.
 */
export function lizardCouponPct(input: {
  headlinePct: string | null
  multiple: number | null
  periodMonths: number | null
  round: number
  cumulativePct: string
}): string | null {
  if (input.headlinePct == null) return null
  if (input.multiple != null) return dec(input.headlinePct).times(input.multiple).toString()
  if (input.periodMonths == null) return null

  const accrued = dec(input.headlinePct).times(input.periodMonths * input.round).div(12)
  for (let k = 1; k <= MAX_LIZARD_MULTIPLE; k += 1) {
    if (truncateToUnit(accrued.times(k), '0.01').eq(dec(input.cumulativePct))) {
      return dec(input.headlinePct).times(k).toString()
    }
  }
  return null
}

/**
 * 평가일 검사.
 *
 * 엄격 증가 · 발행일 이상은 파서도 보지만(`BAD_DATE`) V-07과 같은 규칙이므로 여기서 한 번 더
 * 말한다 — 거부 사유가 **어느 차수인지**를 사람에게 보여 줄 자리가 이 층뿐이다. 이 층만 할 수
 * 있는 검사는 **산식(0일 규약)에서 10일 이내**다 — 형식이 옳은 거짓(연·월을 잘못 읽은 날짜)은
 * 28일 이상 벗어나고, 실측 차이는 0~4일이다(E04000 +2 · EM1740 −1). 0일 규약을 쓰는 이유는
 * 저장 산식(−1일)과 무관한 **거리**만 재기 때문이다.
 */
function dateProblems(issueDate: string, period: number, dates: readonly string[]): string[] {
  const problems: string[] = []
  const formula = generateEvaluationDates({
    issueDate,
    evaluationPeriodMonths: period,
    totalRounds: dates.length,
    offsetDays: 0,
  })
  let previous: string | null = null
  dates.forEach((date, index) => {
    if (date === '') return
    const label = index === dates.length - 1 ? '만기' : `${index + 1}차`
    if (date < issueDate) problems.push(`${label} 평가일 ${date} — 발행일 ${issueDate}보다 이르다.`)
    if (previous != null && date <= previous) {
      problems.push(`${label} 평가일 ${date} — 앞 차수(${previous})보다 늦어야 한다.`)
    }
    const drift = Math.abs(dDay({ from: formula[index]!, evaluationDate: date }))
    if (drift > MAX_DRIFT_DAYS) {
      problems.push(`${label} 평가일 ${date}이 발행일·평가주기에서 ${drift}일 벗어났다 — 투자설명서로 확인한다.`)
    }
    previous = date
  })
  return problems
}

/** 차수 라벨 → 사람의 말. `'MATURITY'` → 만기, `'3-2'` → 3차 리자드 */
function roundName(label: string | undefined): string {
  if (label == null) return ''
  if (label === 'MATURITY') return '만기'
  const [n, v] = label.split('-')
  return v === '2' ? `${n}차 리자드` : `${n}차`
}

/**
 * `BLOCKING` 불일치 → 거부 사유. **문구는 여기서만 만든다** — 어댑터는 판별값만 낸다.
 *
 * 문장이 조사를 피한다(`{값}와`는 끝 글자에 따라 `과`가 된다) — 「무엇이 · 무엇과」를 가운뎃점으로 가른다.
 */
function reasonOf(d: TermsDiscrepancy): string {
  const where = roundName(d.round)
  const both = `사다리 ${d.expected ?? '없음'} · 표 ${d.actual ?? '없음'}`
  switch (d.kind) {
    case 'LADDER_STEPS_ABSENT':
      return '상환조건 사다리가 없다 — 표의 배리어를 대조할 두 번째 표기가 없다.'
    case 'LADDER_STEP_COUNT':
      return `사다리 계단 수와 차수 수가 다르다 — ${both}.`
    case 'LADDER_BARRIER':
      return `${where} 배리어가 다르다 — 사다리 ${d.expected}% · 표 ${d.actual}%. 투자설명서로 확인한다.`
    case 'LIZARD_POSITION':
      return `${where} 표기가 사다리와 표에서 다르다 — ${both}.`
    case 'LIZARD_MULTIPLE':
      return `${where} 수익률이 배수와 맞지 않는다 — 예상 ${d.expected}% · 표 ${d.actual}%.`
    case 'KI_PCT_UNKNOWN':
      return 'KI 배리어 비율을 읽을 수 없다.'
    case 'KI_CONFLICT':
      return 'KI 표기가 서로 모순된다.'
    case 'KI_PRICE':
      return `${d.asset ?? ''} KI 가격이 기준가격 × KI 비율과 맞지 않는다 — 예상 ${d.expected ?? '없음'} · 표 ${d.actual ?? '없음'}.`
    case 'BARRIER_PRICE':
      return `${where} ${d.asset ?? ''} 가격이 기준가격 × 배리어와 맞지 않는다 — 예상 ${d.expected ?? '없음'} · 표 ${d.actual ?? '없음'}.`
    case 'HEADLINE_UNKNOWN':
      return '연 수익률을 읽을 수 없다.'
    case 'PERIOD_UNKNOWN':
      return '평가주기를 읽을 수 없다.'
    case 'TENOR':
      return `만기 개월 수가 평가주기 × 차수와 다르다 — 예상 ${d.expected}개월 · 표기 ${d.actual}개월.`
    case 'CUMULATIVE_YIELD':
      return `${where} 누적 수익률이 연 수익률과 맞지 않는다 — 예상 ${d.expected}% · 표 ${d.actual}%.`
    case 'HEADER_ASSET_COUNT':
      return `기초자산 수가 다르다 — 머리글 ${d.expected}개 · 표 ${d.actual}개.`
    case 'LISTING_ISSUE_DATE':
      return `발행일이 다르다 — 안내 화면 ${d.expected} · 목록 ${d.actual}.`
    case 'LISTING_MATURITY_DATE':
      return `만기일이 다르다 — 안내 화면 ${d.expected} · 목록 ${d.actual}.`
    case 'MONTHLY_PAY':
      return '월지급식이다 — 이 모델은 매월 쿠폰을 표현하지 못한다(DOC-002 §8).'
    case 'FOREIGN_CURRENCY':
      return '외화 상품이다 — 투자원금과 세액이 원화를 전제하므로 등록할 수 없다.'
    case 'MATURITY_ABSENT':
      return '만기상환 평가정보가 안내 화면에 없다 — 옛 상품은 투자설명서를 보고 직접 입력한다.'
    case 'KI_NOT_BELOW_LIZARD':
      return (
        `${where} — KI 배리어 ${d.actual}%가 리자드 배리어 ${d.expected}% 이상이다. ` +
        '약관의 경로 조건을 평가일 판정으로 근사할 수 없다(DQ-09).'
      )
    default:
      return `안내 화면의 값이 서로 맞지 않는다 (${d.kind}).`
  }
}

/** `NOTE` 불일치 → 안내. 사용자가 할 일이 없는 것은 말하지 않는다(`null`) */
function noteOf(d: TermsDiscrepancy): string | null {
  switch (d.kind) {
    case 'HEADER_ASSET_NAME':
      return `기초자산 이름이 머리글(${d.expected})과 표(${d.actual})에서 다르다 — 표를 따랐다.`
    case 'LIZARD_MULTIPLE_UNSTATED':
      return `${roundName(d.round)} 쿠폰의 배수가 적혀 있지 않다 — 표의 누적 수익률에서 환산했다. 투자설명서로 확인한다.`
    case 'LISTING_LADDER_TEXT':
      return null
    case 'MATURITY_PAYMENT_DATE':
      return null
    default:
      return null
  }
}
