import type { ActionResult } from '@/lib/db/mutations/result'
import type { CouponPaymentInput } from '@/lib/db/mutations/types'
import type { CouponObservationView, CouponRecordView, ProductDetailView } from '@/lib/db/queries/map'
import { couponMonthLabel } from '@/lib/format/coupons'

import { parseFieldPath } from './fieldPath'
import { checkbox, optionalText, text } from './parse'
import { countOf } from './rounds'

/**
 * SCR-206 월수익 기록 — 다행 폼의 칸 · 기본값 · 파싱 · 오류 자리 (P8 컷 b3, DOC-008 SCR-206 · DOC-011 §5.14 · §5.15)
 *
 * ## 칸 이름은 «화면 행» 번호다 — 계약의 `entries[i]`가 아니다
 *
 * 결과를 고르지 않은 행은 제출에 싣지 않으므로(빈칸이면 건너뛴다) 계약의 `i`는 화면의 행 번호가 아니다. 칸은
 * `rows[r].…`로 그리고, 실은 순서(`rowOf[i] = r`)로 계약의 `entries[i].…` 오류를 되돌려 붙인다(DOC-008 SCR-206
 * 「제출은 계약 한 번이다」). **색인 없는 키**(DB 제약이 마지막 그물로 거부한 경우 — `paymentDate` 등)는 어느 행의
 * 것인지 말하지 않으므로 옮기지 않는다 — 상단 오류 요약으로 간다(SQ-21 ⓘ b3 개정 · `FormState.unmatched`).
 */

/** 한 행의 입력 칸 — 순서가 화면의 칸 순서다 */
export const COUPON_ROW_FIELDS = [
  'outcome',
  'paymentDate',
  'grossAmount',
  'taxableIncome',
  'withholdingTax',
  // 적용 환율(참고) — 외화 상품에만 칸이 있다(V-24 ⓐ). 목록에 두는 이유는 오류 사상이다(REDEMPTION_FIELDS와 같다)
  'exchangeRate',
  'isConfirmed',
  'note',
] as const
export type CouponRowField = (typeof COUPON_ROW_FIELDS)[number]

/** 행의 숨은 칸 — 월수익 순번(기실현은 비어 있다) */
export const COUPON_NO_FIELD = 'couponNo'
/** 행 수 — 「빈 행 추가」가 늘린다(기실현). FULL은 기본 목록의 길이다 */
export const COUPON_ROW_COUNT_FIELD = 'rowCount'
/** §5.15 수정 · 삭제의 대상 — 기록 id */
export const COUPON_PAYMENT_ID_FIELD = 'couponPaymentId'
/** 「월수익 기록 전부 지우기」 · 행 삭제가 싣는 id들 — 같은 이름의 숨은 칸 여럿이다 */
export const COUPON_PAYMENT_IDS_FIELD = 'couponPaymentIds'
/** 페이지 안의 조작 — 제출이다(SCR-204 「남는 조작」의 규약 · JS 없이 동작한다) */
export const COUPON_INTENT_FIELD = 'intent'
export const ADD_ROW_INTENT = 'ADD_ROW'

export function rowName(row: number, field: CouponRowField | typeof COUPON_NO_FIELD): string {
  return `rows[${row}].${field}`
}

/** 한 행의 모양 — 머리(월수익 표기) · 순번 · 기본값 */
export type CouponRow = {
  couponNo: number | null
  /** 「5번째 · 2027-02-16」. 순번 없는 기실현 행은 `null` */
  label: string | null
  /** 그 행의 일정 지급일 — 힌트에 쓴다(기실현은 없다) */
  scheduledPaymentDate: string | null
  defaults: Partial<Record<CouponRowField, string>>
}

/**
 * 기본 목록 — **`recordable`로 고른다**(DOC-011 §4.3 — V-27과 한 술어). 화면은 「평가일 ≤ 기준일」을 비교하지 않는다.
 * 기실현 월지급은 일정이 없어 기본 목록을 만들 원천이 없으므로 순번 없는 빈 행 `extra`개다(최소 1 — 「빈 행 추가」).
 */
export function couponRowsOf(view: ProductDetailView, extra = 1): CouponRow[] {
  if (view.product.entryMode === 'REALIZED_ONLY') {
    return Array.from({ length: Math.max(1, extra) }, () => ({
      couponNo: null,
      label: null,
      scheduledPaymentDate: null,
      // 기실현은 지급만 받는다(I-27) — 결과의 기본값을 지급으로 두지 않는다: 빈 행이 건너뛰어지는 규칙이 같아야 한다
      defaults: {},
    }))
  }
  return (view.coupons ?? [])
    .filter((coupon) => coupon.recordable)
    .map((coupon) => ({
      couponNo: coupon.couponNo,
      label: couponMonthLabel(coupon.couponNo, coupon.evaluationDate),
      scheduledPaymentDate: coupon.paymentDate,
      defaults: couponDefaultsOf(view, coupon),
    }))
}

/**
 * 한 달의 기본값 — DOC-007 §4.7 「월수익 기록 화면의 입력 기본값」 · DOC-008 SCR-206 칸 표.
 *
 * - 결과: **기본값이 없다** — 지난 달의 결과를 시세로 제안하지 않는다(RD-14 · §3.5)
 * - 지급일: 일정의 월수익 지급일 — 거래내역의 날짜로 고친다
 * - 세전: `q_k`(이미 보조단위 절사값 — `expectedAmount`). 화면이 다시 계산하지 않는다
 * - 과세 금융소득: 원화 일반계좌 = 세전 · 비과세 = 0 · **달러는 빈칸**(U1 — 지급일 환율은 거래내역만 안다)
 * - 원천징수세액: **비운다** — 서버가 지급일 연도의 분리과세율로 채운다(화면이 채우면 그 산출이 실행되지 않는다)
 * - 확정: **끈다**(SCR-203 · ST-05)
 */
export function couponDefaultsOf(
  view: Pick<ProductDetailView, 'product'>,
  coupon: Pick<CouponObservationView, 'paymentDate' | 'expectedAmount'>,
): Partial<Record<CouponRowField, string>> {
  const { currency, accountType } = view.product
  return {
    outcome: '',
    paymentDate: coupon.paymentDate,
    grossAmount: coupon.expectedAmount,
    // 비과세가 통화보다 먼저다 — 달러 비과세도 환율 없이 0을 안다(DOC-007 §4.8 · DOC-008 v2.41). 달러 일반계좌만 비운다(U1)
    taxableIncome: accountType === 'TAX_FREE' ? '0' : currency !== 'KRW' ? '' : coupon.expectedAmount,
    withholdingTax: '',
    exchangeRate: '',
    isConfirmed: '',
    note: '',
  }
}

/** 초기 폼 값 — 행마다의 기본값을 `rows[r].…` 이름으로 펼친다. 숨은 칸(순번 · 행 수)도 여기 싣는다 */
export function couponFormValuesOf(rows: readonly CouponRow[]): Record<string, string> {
  const values: Record<string, string> = { [COUPON_ROW_COUNT_FIELD]: String(rows.length) }
  rows.forEach((row, r) => {
    values[rowName(r, COUPON_NO_FIELD)] = row.couponNo == null ? '' : String(row.couponNo)
    for (const field of COUPON_ROW_FIELDS) values[rowName(r, field)] = row.defaults[field] ?? ''
  })
  return values
}

/** 오류를 칸에 붙일 수 있는 이름 전부 — `toFormState`의 `knownNames` */
export function couponFieldNames(rowCount: number): string[] {
  return Array.from({ length: rowCount }, (_, r) => COUPON_ROW_FIELDS.map((field) => rowName(r, field))).flat()
}

function amountOf(form: FormData, name: string): string | undefined {
  const raw = optionalText(form, name)
  return raw == null ? undefined : raw.replace(/[,\s]/g, '')
}

/**
 * 한 행을 계약의 입력으로 — `PAID` · `UNPAID` 공통. 결과가 빈칸이면 `null`(그 행은 싣지 않는다).
 *
 * **미지급 행은 금액 · 지급일 · 과세 · 원천징수 · 적용 환율을 버린다**(DOC-008 SCR-206 · SQ-21 ⓘ b3 개정). 화면이 채운
 * 기본값이므로 오류로 만들면 JS 없는 폼에서 미지급을 고를 때마다 다섯 칸을 지워야 한다. 계약의 V-28은 그대로 서서
 * 직접 호출을 막는다. 지급 행의 빈 칸은 보내지 않는다 — 필수 칸이면 V-28이 그 행의 칸 오류로 돌려준다.
 */
function entryOf(
  form: FormData,
  row: number,
  couponNo: number | null,
): CouponPaymentInput | null {
  const outcome = text(form, rowName(row, 'outcome'))
  if (outcome === '') return null

  const entry: CouponPaymentInput = {
    couponNo,
    // 값 집합의 검사는 계약의 일이다(V-27) — 화면이 다시 판정하지 않는다
    outcome: outcome as CouponPaymentInput['outcome'],
    isConfirmed: checkbox(form, rowName(row, 'isConfirmed')),
  }
  const note = optionalText(form, rowName(row, 'note'))
  if (note != null) entry.note = note
  if (outcome === 'UNPAID') return entry

  const paymentDate = optionalText(form, rowName(row, 'paymentDate'))
  if (paymentDate != null) entry.paymentDate = paymentDate
  const grossAmount = amountOf(form, rowName(row, 'grossAmount'))
  if (grossAmount != null) entry.grossAmount = grossAmount
  const taxableIncome = amountOf(form, rowName(row, 'taxableIncome'))
  if (taxableIncome != null) entry.taxableIncome = taxableIncome
  const withholdingTax = amountOf(form, rowName(row, 'withholdingTax'))
  if (withholdingTax != null) entry.withholdingTax = withholdingTax
  const exchangeRate = amountOf(form, rowName(row, 'exchangeRate'))
  if (exchangeRate != null) entry.exchangeRate = exchangeRate
  return entry
}

/** 순번 칸 — 개수를 세는 정수다. 빈칸은 순번 없음(기실현) */
function couponNoOf(form: FormData, row: number): number | null {
  const raw = optionalText(form, rowName(row, COUPON_NO_FIELD))
  // 형식이 아니면 NaN이 계약의 V-20′에 걸린다 — 화면이 같은 판정을 하지 않는다(parse.ts 머리글)
  return raw == null ? null : countOf(raw)
}

/** 다행 제출 → `entries`와 실은 순서의 화면 행 번호 */
export function parseCouponRecordForm(
  form: FormData,
  rowCount: number,
): { entries: CouponPaymentInput[]; rowOf: number[] } {
  const entries: CouponPaymentInput[] = []
  const rowOf: number[] = []
  for (let row = 0; row < rowCount; row += 1) {
    const entry = entryOf(form, row, couponNoOf(form, row))
    if (entry == null) continue
    entries.push(entry)
    rowOf.push(row)
  }
  return { entries, rowOf }
}

/** §5.15 수정 — 한 행 폼(행 번호 0). 순번 · 상품은 입력에 없다(전체 교체) */
export function parseCouponEditForm(form: FormData): Omit<CouponPaymentInput, 'couponNo'> | null {
  const entry = entryOf(form, 0, null)
  if (entry == null) return null
  const { couponNo: _ignored, ...input } = entry
  return input
}


/**
 * 계약의 `entries[i].x`를 화면의 `rows[rowOf[i]].x`로 — 색인 없는 키 · 범위 밖 색인은 그대로 둔다(상단 요약).
 * 다른 결과는 손대지 않는다.
 */
export function toRowErrors<T>(result: ActionResult<T>, rowOf: readonly number[]): ActionResult<T> {
  if (result.ok || result.error.fields == null) return result
  const fields: Record<string, string> = {}
  for (const [key, message] of Object.entries(result.error.fields)) {
    const parsed = parseFieldPath(key)
    const row = parsed?.field === 'entries' && parsed.index != null ? rowOf[parsed.index] : undefined
    // `couponNo`는 숨은 칸이라 그 이름으로는 붙일 자리가 없다 — 그 행의 결과 칸에 붙인다(V-27 · DOC-008 v2.41)
    const sub = parsed?.sub === COUPON_NO_FIELD ? 'outcome' : parsed?.sub
    fields[row == null || sub == null ? key : `rows[${row}].${sub}`] = message
  }
  return { ...result, error: { ...result.error, fields } }
}

/** 결과를 고른 행이 없는 제출 — 계약을 부르지 않고 이 문구다(DOC-008 SCR-206 v2.41) */
export const EMPTY_RECORD_MESSAGE = '기록할 행이 없다 — 결과를 고른 행만 저장한다.'

/** §5.15 수정 폼의 초기값 — 저장된 기록 그대로다(추정이 아니다). 행 번호 0 */
export function couponEditValuesOf(record: CouponRecordView): Record<string, string> {
  return {
    [COUPON_PAYMENT_ID_FIELD]: record.id,
    [rowName(0, 'outcome')]: record.outcome,
    [rowName(0, 'paymentDate')]: record.paymentDate ?? '',
    [rowName(0, 'grossAmount')]: record.grossAmount ?? '',
    [rowName(0, 'taxableIncome')]: record.taxableIncome ?? '',
    // 저장된 원천징수세액을 그대로 싣는다 — 비우면 수정 저장이 그 값을 분리과세율로 재산출한다(A-04를 뒤집는 조용한 변경)
    [rowName(0, 'withholdingTax')]: record.withholdingTax ?? '',
    [rowName(0, 'exchangeRate')]: record.exchangeRate ?? '',
    [rowName(0, 'isConfirmed')]: record.isConfirmed ? 'on' : '',
    [rowName(0, 'note')]: record.note ?? '',
  }
}

/** 기록 id로 그 기록 · 그 달을 찾는다 — 순번 있는 기록은 `coupons[].record`, 없는 기록은 `unnumberedCouponRecords` */
export function findCouponRecord(
  view: Pick<ProductDetailView, 'coupons' | 'unnumberedCouponRecords'>,
  id: string,
): { record: CouponRecordView; coupon: CouponObservationView | null } | null {
  for (const coupon of view.coupons ?? []) {
    if (coupon.record?.id === id) return { record: coupon.record, coupon }
  }
  const unnumbered = view.unnumberedCouponRecords.find((record) => record.id === id)
  return unnumbered == null ? null : { record: unnumbered, coupon: null }
}

/** 지울 수 있는 기록 id 전부 — 「월수익 기록 전부 지우기」(1..60 — V-26 · V-27) */
export function recordedCouponIds(view: Pick<ProductDetailView, 'coupons' | 'unnumberedCouponRecords'>): string[] {
  return [
    ...(view.coupons ?? []).flatMap((coupon) => (coupon.record == null ? [] : [coupon.record.id])),
    ...view.unnumberedCouponRecords.map((record) => record.id),
  ]
}
