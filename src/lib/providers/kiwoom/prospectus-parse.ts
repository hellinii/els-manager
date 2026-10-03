import type { IsoDate, PctString } from './terms-types'

/**
 * 투자설명서(`B<code>.pdf`)의 **추출 텍스트** → 월수익 구간 — **순수**하다 — DOC-010 ADR-009 §8.4 (P8 컷 b5′)
 *
 * PDF를 여는 것은 어댑터(`terms.ts` — `unpdf`)이고 이 함수는 그 결과 문자열만 본다. 그래서 픽스처가 **추출 텍스트**다 —
 * PDF 바이너리를 저장소에 싣지 않고(표본 하나 약 650KB) 이 함수의 입력 그대로를 커밋한다.
 *
 * ## 읽는 구간 넷 — 문서 전체를 해석하지 않는다
 *
 * | 구간 | 원문 (EM2048 — 2026-10-03 실측) | 결과 |
 * |---|---|---|
 * | 월수익 평가일 표 | `월수익지급평가일(1차~36차)` 머리 뒤 `1회 2026년 10월 16일 2회 …` | `coupons` · `declaredCount` |
 * | 지급금액 | `월수익 지급금액` 뒤 `액면금액 ×  2.02%(연 24.24%)` | `monthlyPct` · `annualPct` |
 * | 지급일 규칙 | `월수익 지급일 : 해당 차수 월수익지급평가일 후 3영업일` | `paymentBusinessDays` |
 * | 조기상환 표 | `자동조기상환평가일 및 상환금액` 뒤 `1차 2027년 03월 17일 …` | `earlyRedemptionDates` (안내 화면과 대조) |
 *
 * ## 「읽었다」의 경계는 표 머리다
 *
 * 표 머리(`월수익지급평가일(1차~K차)`)를 찾지 못하면 `null` — 어댑터가 「못 읽음」으로 접는다(폴백 · 거부가 아니다).
 * 찾았으면 그 뒤가 어떻든 결과를 낸다 — 토큰이 모자라거나 순서가 틀리거나 지급금액 문장이 없으면 **빈 값 그대로** 내고
 * 판정은 대조(`terms-check.ts`)가 한다(읽고 어긋나면 거부 — 원천 둘이 다른 말을 한다는 신호다).
 *
 * ## 토큰으로 줍는다 — 행 순서가 아니다
 *
 * 표가 세 열(`회차 평가일자 회차 평가일자 회차 평가일자`)로 반복되고 **페이지 경계(`- 19 -`)가 표 한가운데 낀다**
 * (EM2048 · EM2040 · EM2032). 줄이나 열로 읽으면 그 경계에서 어긋난다 — `n회 YYYY년 MM월 DD일` 토큰을 순서대로 줍고
 * 순번과 날짜를 함께 낸다. 순번의 연속은 대조가 본다.
 *
 * ## 변형 낱말의 범위 — `couponSection`
 *
 * 「다. 월수익 지급」 ~ 「라. 만기상환」 구간의 원문이다(없으면 표 머리 ~ 지급일 규칙). 문서 전체를 주지 않는다 — 다섯
 * 표본 전부에 「메모리」가 있는데 마이크론의 사업 설명이다(ADR-009 ㉑).
 */
export type ProspectusTerms = {
  /** 표 머리가 말한 마지막 순번(`1차~36차` → 36) */
  declaredCount: number
  /** 표에서 주운 순서 그대로 — 순번이 1..K로 이어지는지는 대조가 본다 */
  coupons: Array<{ couponNo: number; evaluationDate: IsoDate }>
  /** `x%` — 월 지급률(퍼센트). 문장이 없으면 `null` */
  monthlyPct: PctString | null
  /** `(연 y%)` — 월수익 연쿠폰율(퍼센트). 문장이 없으면 `null` */
  annualPct: PctString | null
  /** `후 n영업일`의 n. 없으면 `null`(채움은 3영업일 기본값과 안내 — 거부가 아니다) */
  paymentBusinessDays: number | null
  /** 자동조기상환평가일 — 표에서 주운 순서 그대로 */
  earlyRedemptionDates: IsoDate[]
  /** 변형 낱말 검사의 범위(위 각주) */
  couponSection: string
}

const TABLE_HEAD = /월수익지급평가일\s*\(\s*1\s*차\s*~\s*(\d{1,2})\s*차\s*\)/
const COUPON_TOKEN = /(\d{1,2})\s*회\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g
const AMOUNT = /월수익\s*지급금액\s*액면금액\s*×\s*(\d{1,2}(?:\.\d{1,4})?)\s*%\s*\(\s*연\s*(\d{1,3}(?:\.\d{1,4})?)\s*%\s*\)/
const PAYMENT_RULE = /월수익\s*지급일\s*:\s*[^\n]*?후\s*(\d{1,2})\s*영업일/
const EARLY_HEAD = /자동조기상환평가일\s*및\s*상환금액/
const EARLY_END = /자동조기상환일\s*:/
const EARLY_TOKEN = /(\d{1,2})\s*차\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g
const SECTION_START = /다\.\s*월수익\s*지급/
const SECTION_END = /라\.\s*만기상환/

/** 표 머리를 찾지 못했으면 `null`이다(「못 읽음」). 던지지 않는다 */
export function parseProspectusText(text: string): ProspectusTerms | null {
  const head = TABLE_HEAD.exec(text)
  if (head == null) return null
  const declaredCount = Number.parseInt(head[1]!, 10)

  // 표는 머리 뒤에서 지급금액 문장 앞까지다 — 그 앞에서 끝나지 않으면 머리 뒤 전부(토큰 형태가 다른 글을 거른다)
  const afterHead = text.slice(head.index + head[0].length)
  const amountAt = afterHead.search(/월수익\s*지급금액/)
  const table = amountAt < 0 ? afterHead : afterHead.slice(0, amountAt)
  const coupons: ProspectusTerms['coupons'] = []
  for (const m of table.matchAll(COUPON_TOKEN)) {
    const date = isoOf(m[2]!, m[3]!, m[4]!)
    // 달력에 없는 날짜는 토큰이 아니다 — 줍지 않으면 개수가 모자라 대조가 거부한다
    if (date != null) coupons.push({ couponNo: Number.parseInt(m[1]!, 10), evaluationDate: date })
  }

  const amount = AMOUNT.exec(afterHead)
  const rule = PAYMENT_RULE.exec(text)

  const earlyHead = EARLY_HEAD.exec(text)
  const earlyRedemptionDates: IsoDate[] = []
  if (earlyHead != null) {
    const rest = text.slice(earlyHead.index + earlyHead[0].length)
    const end = rest.search(EARLY_END)
    for (const m of (end < 0 ? rest.slice(0, 2000) : rest.slice(0, end)).matchAll(EARLY_TOKEN)) {
      const date = isoOf(m[2]!, m[3]!, m[4]!)
      if (date != null) earlyRedemptionDates.push(date)
    }
  }

  return {
    declaredCount,
    coupons,
    monthlyPct: amount?.[1] ?? null,
    annualPct: amount?.[2] ?? null,
    paymentBusinessDays: rule == null ? null : Number.parseInt(rule[1]!, 10),
    earlyRedemptionDates,
    couponSection: couponSectionOf(text, head.index, rule),
  }
}

function couponSectionOf(text: string, headAt: number, rule: RegExpExecArray | null): string {
  const start = SECTION_START.exec(text)
  if (start != null) {
    const rest = text.slice(start.index)
    const end = rest.search(SECTION_END)
    if (end > 0) return rest.slice(0, end)
  }
  const stop = rule == null ? Math.min(text.length, headAt + 4000) : rule.index + rule[0].length
  return text.slice(headAt, stop)
}

/** `2026` · `10` · `9` → `'2026-10-09'`. 달력에 없으면 `null` — 수로 바꾸지 않고 문자열로 맞춘다 */
function isoOf(year: string, month: string, day: string): IsoDate | null {
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  const parsed = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso
}
