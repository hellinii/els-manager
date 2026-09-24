import type { KiwoomLadder, LadderStep } from './terms-types'

/**
 * `상환조건` 자유 문장 → 구조 — **전함수**다. 던지지 않고, 모르는 낱말은 `unrecognized`에 남긴다.
 *
 * 팝업 헤더와 es020 `type_cntn`이 같은 함수를 지난다. 실측 표본(2026-09-24):
 *
 * | 문장 | 표본 |
 * |---|---|
 * | `3년/ 6개월\r\n(85-85-85-80-75-70) KI35` | E04000 |
 * | `★리자드1배★ 2년/ 4개월\r\n(80-80-75(L50)-75-70-60) KI35` | EM1740 |
 * | `리자드2배, 2년/4개월\r\n(75-75-75(L50)-70-70-60) KI30` | EM2046 |
 * | `달러청약, 월지급배리어 50, 3년/6개월\r\n(85-85-80-75-70-65) KI` (목록) · `… KI25` (팝업) | EM2048 |
 * | `만기2년 리자드형 조기상환형\r\n(80-80-75(L50)-75-70-60) KI40` | EM1039 |
 * | `만기3년 조기상환형\r\n(85-85-80-75-70-65) 25KI` | EM0795 |
 * | `3년/ 6개월 (75-75(L50)-70-70-65-50) NO KI` — 리자드가 **2차**, 노낙인에 **공백** | E04100 |
 * | `조기상환기회 총5회` — 계단이 없다 | E00795 |
 * | `만기1년 부스터콜 조기상환형\r\n(100)` — 계단이 **하나** | E01740 |
 *
 * 개월·배수·횟수는 **개수**이므로 `number`다(`Number.parseInt` 허용 — `decimal.ts`의 규약).
 * 백분율은 문자열로 둔다.
 */

/** 계단 묶음. 한 칸짜리 `(100)`도 받는다. 계단 값은 정수 백분율만 — 실측에 소수가 없다 */
const STEPS = /\((\d{1,3}(?:\(L\d{1,3}\))?(?:-\d{1,3}(?:\(L\d{1,3}\))?)*)\)/g
const STEP = /^(\d{1,3})(?:\(L(\d{1,3})\))?$/
const NO_KI = /\bNO\s?KI\b/gi
const KI_AFTER = /\bKI\s?(\d{1,3})\b/g
const KI_BEFORE = /\b(\d{1,3})\s?KI\b/g
const KI_BARE = /\bKI\b/g
const LIZARD_MULTIPLE = /리자드\s?(\d)\s?배/g
const LIZARD = /리자드형?/g
const MONTHLY_BARRIER = /월지급\s?배리어\s?(\d{1,3})/g
const MONTHLY = /월지급/g
const DOLLAR = /달러청약/g
const EARLY_CHANCES = /조기상환\s?기회\s?총\s?(\d{1,2})\s?회/g
/** 사다리·헤더에서 허용하는 채움 낱말. 뜻이 없어 보고하지 않는다 */
const FILLERS = new Set(['조기상환형', '★', ','])

export function parseLadder(text: string): KiwoomLadder {
  let rest = ` ${text.replace(/\s+/g, ' ')} `
  const take = (re: RegExp): RegExpMatchArray[] => {
    const hits = [...rest.matchAll(re)]
    rest = rest.replace(re, ' ')
    return hits
  }

  const stepGroups = take(STEPS)
  const steps = stepGroups.length === 1 ? parseSteps(stepGroups[0]![1]!) : null
  if (stepGroups.length > 1) {
    // 계단 묶음이 둘이면 어느 것이 정본인지 모른다 — 추측하지 않고 보고한다
    rest += stepGroups.map((g) => ` ${g[0]}`).join('')
  }

  const noKi = take(NO_KI).length > 0
  const kiValues = [...take(KI_AFTER), ...take(KI_BEFORE)].map((m) => m[1]!)
  const bare = take(KI_BARE).length > 0
  const distinctKi = [...new Set(kiValues)]

  const multiples = take(LIZARD_MULTIPLE).map((m) => Number.parseInt(m[1]!, 10))
  const lizardWord = take(LIZARD).length > 0
  const monthlyBarrier = take(MONTHLY_BARRIER).map((m) => m[1]!)
  const monthlyWord = take(MONTHLY).length > 0
  const dollar = take(DOLLAR).length > 0
  const chances = take(EARLY_CHANCES).map((m) => Number.parseInt(m[1]!, 10))

  const tenor = parseTenorFrom(rest)
  rest = tenor.rest

  return {
    steps,
    kiPct: distinctKi.length === 1 && !noKi ? distinctKi[0]! : null,
    noKi,
    kiUnspecified: bare && distinctKi.length === 0 && !noKi,
    kiConflict: distinctKi.length > 1 || (noKi && distinctKi.length > 0),
    lizard: multiples.length > 0 || lizardWord,
    lizardMultiple: new Set(multiples).size === 1 ? multiples[0]! : null,
    monthly: monthlyBarrier.length > 0 || monthlyWord,
    monthlyBarrierPct: new Set(monthlyBarrier).size === 1 ? monthlyBarrier[0]! : null,
    dollar,
    tenorMonths: tenor.tenorMonths,
    periodMonths: tenor.periodMonths,
    earlyChances: new Set(chances).size === 1 ? chances[0]! : null,
    unrecognized: rest
      .split(/[\s,]+/)
      .map((w) => w.replace(/★/g, ''))
      .filter((w) => w !== '' && !FILLERS.has(w)),
  }
}

function parseSteps(body: string): LadderStep[] | null {
  const out: LadderStep[] = []
  for (const token of body.split(/-(?![^(]*\))/)) {
    const m = STEP.exec(token)
    if (m == null) return null
    out.push({ barrierPct: m[1]!, lizardPct: m[2] ?? null })
  }
  return out
}

/**
 * 만기·주기 — 사다리 문장과 헤더 `만기/상환주기` 칸이 함께 쓴다.
 *
 * | 문장 | 만기 | 주기 | 표본 |
 * |---|---|---|---|
 * | `3년/ 6개월` · `2년/4개월` | 36 · 24 | 6 · 4 | E04000 · EM2046 |
 * | `3년 / 6개월마다` | 36 | 6 | E00795 헤더 |
 * | `3년 만기/ 6개월마다 조기상환 기회` | 36 | 6 | E03060 헤더 |
 * | `만기2년` · `만기 1년` | 24 · 12 | — | EM1039 사다리 · E90795 헤더 |
 */
export function parseTenor(text: string): { tenorMonths: number | null; periodMonths: number | null } {
  const { tenorMonths, periodMonths } = parseTenorFrom(` ${text.replace(/\s+/g, ' ')} `)
  return { tenorMonths, periodMonths }
}

const TENOR_PERIOD = /(\d{1,2})\s?년\s*(?:만기)?\s*\/\s*(\d{1,2})\s?개월(?:마다)?(?:\s?조기상환\s?기회)?/g
const TENOR_ONLY = /만기\s?(\d{1,2})\s?년/g

function parseTenorFrom(input: string): {
  tenorMonths: number | null
  periodMonths: number | null
  rest: string
} {
  let rest = input
  const pairs = [...rest.matchAll(TENOR_PERIOD)]
  rest = rest.replace(TENOR_PERIOD, ' ')
  const onlies = [...rest.matchAll(TENOR_ONLY)]
  rest = rest.replace(TENOR_ONLY, ' ')

  const tenors = [
    ...pairs.map((m) => Number.parseInt(m[1]!, 10) * 12),
    ...onlies.map((m) => Number.parseInt(m[1]!, 10) * 12),
  ]
  const periods = pairs.map((m) => Number.parseInt(m[2]!, 10))
  return {
    tenorMonths: new Set(tenors).size === 1 ? tenors[0]! : null,
    periodMonths: new Set(periods).size === 1 ? periods[0]! : null,
    rest,
  }
}
