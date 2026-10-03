import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { today } from '@/lib/db/today'
import { shiftDays } from '@/lib/domain'
import { COUPON_PAYMENT_IDS_FIELD, rowName } from '@/lib/forms/coupons'
import { MONTHLY_RATE_FIELD, couponCell } from '@/lib/forms/monthly'
import { SCHEDULE_KEYS } from '@/lib/forms/query'
import { EXCHANGE_RATE_INPUT_LINK_LABEL, EXCHANGE_RATE_MISSING_JOINER, exchangeRateMissingLead } from '@/lib/format'
import { MONTHLY_COUPON_ASSUMPTION, MONTHLY_COUPON_ESTIMATE_NOTE } from '@/lib/format/coupons'
import { COUPON_SECTION, EXCHANGE_RATE_SECTION, PATHS } from '@/lib/routes/paths'

import { ITG_USER_B } from '../integration/helpers/fixtures'
import { queryRows } from '../integration/helpers/seed'

import { actionIdOf, buttonField, formFieldsFor, formHtmlFor, formValuesFor, submitAction } from './helpers/actions'
import { authenticatedJar } from './helpers/auth'
import { E2E_EMPTY } from './helpers/users'
import { makeMonthly, monthsAround, monthsToMaturity } from './helpers/monthly'
import { registerProduct, type RegisteredProduct } from './helpers/register'
import { cookieJar, get, locationPath } from './helpers/server'

/**
 * SCR-202 ⑦ 월수익 · SCR-206 월수익 기록 (P8 컷 b3-3) — 프록시 · 서버 액션 · 리다이렉트는 Next를 지나야 존재한다
 *
 * 픽스처: 원화 1억 · 월 600,000원(연 7.2%) · 월수익 다섯 달 — 기준일(오늘) −70 · −40 · −10일 평가(1~3번째, 평가 끝),
 * +20 · +50일(4 · 5번째, 아직). 기본 목록은 1~3번째다(`recordable` — V-27과 한 술어).
 */

let jar: ReturnType<typeof cookieJar>
let monthly: RegisteredProduct
let plain: RegisteredProduct
const asOf = today()

async function detailHtml(productId: string): Promise<string> {
  return (await get(PATHS.product(productId), jar)).text()
}

/** 기록 화면의 폼을 그 화면에서 읽어 덮어쓴 값으로 제출한다 — 값은 렌더된 폼에서 나온다 */
async function submitRecordForm(productId: string, overrides: Record<string, string>): Promise<Response> {
  const path = PATHS.productCoupons(productId)
  const html = await (await get(path, jar)).text()
  const id = actionIdOf('recordCouponPaymentsAction')
  const rendered = formValuesFor(html, id).filter(([name]) => !(name in overrides))
  return submitAction(path, jar, [...rendered, ...Object.entries(overrides)])
}

async function recordIdsOf(productId: string): Promise<Record<number, string>> {
  const { rows } = await queryRows<{ id: string; coupon_no: number }>(
    'select id::text, coupon_no from public.monthly_coupon_payments where els_id = $1::uuid',
    [productId],
  )
  return Object.fromEntries(rows.map((row) => [row.coupon_no, row.id]))
}

beforeAll(async () => {
  jar = await authenticatedJar()
  monthly = await registerProduct(jar, { label: '월지급', principal: '100,000,000' })
  await makeMonthly(monthly.productId, monthsAround(asOf))
  plain = await registerProduct(jar, { label: '월지급대조', principal: '100,000,000' })
})

describe('SCR-202 ⑦ — 월지급식 상품에만', () => {
  it('① 「쿠폰 지급 월지급식」 · ⑦ 구획 · 미기록 셋 · 「기록」 링크', async () => {
    const html = await detailHtml(monthly.productId)
    expect(html).toContain('쿠폰 지급')
    expect(html).toContain('월지급식')
    expect(html).toContain(`id="${COUPON_SECTION.id}"`)
    expect(html).toContain(`1번째 · ${monthsAround(asOf)[0]?.evaluationDate}`)
    expect(html.match(/>미기록</g)).toHaveLength(3)
    expect(html).toContain(`href="${PATHS.productCoupons(monthly.productId)}"`)
  })

  it('★ 상환 시 지급 상품의 상세에는 ⑦도 「쿠폰 지급」도 없다 — 기존 상품의 상세는 그대로', async () => {
    const html = await detailHtml(plain.productId)
    expect(html).not.toContain(`id="${COUPON_SECTION.id}"`)
    expect(html).not.toContain('쿠폰 지급')
  })
})

describe('SCR-206 — 경로 · 권한', () => {
  it('상환 시 지급 상품의 기록 주소는 404다 — 기록할 것이 없다', async () => {
    expect((await get(PATHS.productCoupons(plain.productId), jar)).status).toBe(404)
  })

  it('★ 타인의 기록 주소는 SCR-902(200)다 — AQ-81: forbidden()을 켜지 않는다', async () => {
    const other = await authenticatedJar(ITG_USER_B)
    const res = await get(PATHS.productCoupons(monthly.productId), other)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('권한이 없다')
    expect(html).not.toContain(rowName(0, 'outcome'))
  })

  it('기본 목록은 평가가 끝난 무기록 달 셋 · 결과 빈칸 · 세전 600,000 · 원천징수 빈칸', async () => {
    const res = await get(PATHS.productCoupons(monthly.productId), jar)
    expect(res.status).toBe(200)
    const html = await res.text()
    const form = formHtmlFor(html, actionIdOf('recordCouponPaymentsAction'))
    expect(form).toContain(rowName(2, 'outcome'))
    expect(form).not.toContain(rowName(3, 'outcome'))
    const values = Object.fromEntries(formValuesFor(html, actionIdOf('recordCouponPaymentsAction')))
    expect(values[rowName(0, 'outcome')]).toBe('')
    expect(values[rowName(0, 'grossAmount')]).toBe('600000')
    expect(values[rowName(0, 'taxableIncome')]).toBe('600000')
    expect(values[rowName(0, 'withholdingTax')]).toBe('')
  })
})

describe('SCR-206 — 제출', () => {
  it('★ 오류는 화면 행에 붙는다 — 건너뛴 행 때문에 entries[0]이 rows[1]이다', async () => {
    // 1번째 행은 비우고 2번째 행만 지급 — 지급일을 미래로 두면 V-28이 entries[0].paymentDate로 거부한다
    const res = await submitRecordForm(monthly.productId, {
      [rowName(1, 'outcome')]: 'PAID',
      [rowName(1, 'paymentDate')]: shiftDays(asOf, 5),
    })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain(`id="${rowName(1, 'paymentDate')}-error"`)
    expect(html).not.toContain(`id="${rowName(0, 'paymentDate')}-error"`)
    // 입력값이 남는다 — 한 행이라도 거부되면 아무것도 저장되지 않는다(전부 아니면 전무)
    expect(html).toContain(`value="${shiftDays(asOf, 5)}"`)
    expect(Object.keys(await recordIdsOf(monthly.productId))).toHaveLength(0)
  })

  it('지급 · 미지급을 한 번에 — 미지급 행의 미리 채운 금액은 버리고, 저장 뒤 상세의 ⑦로 간다', async () => {
    const res = await submitRecordForm(monthly.productId, {
      [rowName(0, 'outcome')]: 'PAID',
      [rowName(1, 'outcome')]: 'UNPAID',
    })
    expect(res.status).toBe(303)
    expect(locationPath(res)).toBe(PATHS.product(monthly.productId))

    const { rows } = await queryRows<{ coupon_no: number; outcome: string; gross: string | null; withholding: string | null }>(
      `select coupon_no, outcome::text, gross_amount::text as gross, withholding_tax::text as withholding
         from public.monthly_coupon_payments where els_id = $1::uuid order by coupon_no`,
      [monthly.productId],
    )
    expect(rows).toEqual([
      // 원천징수세액은 서버가 지급일 연도의 분리과세율로 채웠다(600,000 × 15.4%)
      { coupon_no: 1, outcome: 'PAID', gross: '600000', withholding: '92400' },
      { coupon_no: 2, outcome: 'UNPAID', gross: null, withholding: null },
    ])

    const html = await detailHtml(monthly.productId)
    expect(html.match(/>미기록</g)).toHaveLength(1)
    expect(html).toContain('>지급<')
    expect(html).toContain('>미지급<')
  })

  it('한 기록 수정 — 저장값이 초기값이고(원천징수 92,400 그대로) 비고만 바꿔 저장한다', async () => {
    const id = (await recordIdsOf(monthly.productId))[1]!
    const editPath = COUPON_SECTION.editHref(monthly.productId, id)
    const html = await (await get(editPath, jar)).text()
    const actionId = actionIdOf('updateCouponPaymentAction')
    const values = Object.fromEntries(formValuesFor(html, actionId))
    expect(values[rowName(0, 'withholdingTax')]).toBe('92400')
    expect(values[rowName(0, 'outcome')]).toBe('PAID')

    const res = await submitAction(editPath, jar, [
      ...formValuesFor(html, actionId).filter(([name]) => name !== rowName(0, 'note')),
      [rowName(0, 'note'), '거래내역 확인'],
    ])
    expect(res.status).toBe(303)
    const { rows } = await queryRows<{ note: string | null; withholding: string }>(
      'select note, withholding_tax::text as withholding from public.monthly_coupon_payments where id = $1::uuid',
      [id],
    )
    expect(rows[0]).toEqual({ note: '거래내역 확인', withholding: '92400' })
  })

  it('행 삭제 — 그 달이 다시 미기록이 된다(같은 화면 · 리다이렉트 없음)', async () => {
    const id = (await recordIdsOf(monthly.productId))[2]!
    const path = PATHS.product(monthly.productId)
    const html = await detailHtml(monthly.productId)
    const actionId = actionIdOf('deleteCouponPaymentsAction')
    const fields = formFieldsFor(html, actionId).filter(([name]) => name !== COUPON_PAYMENT_IDS_FIELD)
    const res = await submitAction(path, jar, [...fields, [COUPON_PAYMENT_IDS_FIELD, id]])
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('월수익 기록을 지웠다.')
    expect(Object.keys(await recordIdsOf(monthly.productId))).toEqual(['1'])
  })

  it('밀린 달을 전부 적으면 빈 상태 — 다음 월수익과 상세로 가는 길', async () => {
    await submitRecordForm(monthly.productId, {
      [rowName(0, 'outcome')]: 'UNPAID',
      [rowName(1, 'outcome')]: 'PAID',
    })
    const html = await (await get(PATHS.productCoupons(monthly.productId), jar)).text()
    expect(html).toContain('기록할 밀린 달이 없다')
    expect(html).toContain(`4번째 · ${monthsAround(asOf)[3]?.evaluationDate}`)
    // 상세의 「기록」 링크도 사라진다 — 기록할 달이 있을 때만이다
    expect(await detailHtml(monthly.productId)).not.toContain(`href="${PATHS.productCoupons(monthly.productId)}"`)
  })
})

describe('SCR-204 월지급 블록 (b3-4)', () => {
  it('★ 기록 없는 월지급 상품 — 블록 · 율 · 행이 저장값으로 서고, 그대로 저장된다(b2~b3의 V-25 공백이 닫혔다)', async () => {
    const fresh = await registerProduct(jar, { label: '월지급수정', principal: '100,000,000' })
    // 저장을 시험하므로 만기까지 매월인 일정이다(V-26 행 수 — P8.5). 다섯 달 픽스처는 아래 「짧은 일정」 사례가 쓴다
    const months = await monthsToMaturity(fresh.productId)
    await makeMonthly(fresh.productId, months)
    const editPath = PATHS.productEdit(fresh.productId)
    const html = await (await get(editPath, jar)).text()
    const actionId = actionIdOf('productEditFormAction')
    const form = formHtmlFor(html, actionId)
    expect(form).toContain(`name="${MONTHLY_RATE_FIELD}"`)
    expect(form).toContain('value="7.2"')
    expect(form).toContain(`name="${couponCell(4, 'evaluationDate')}"`)
    // 연쿠폰율은 0이다(V-08′). **서버 HTML(= JS 없음)에서는 고정을 그리지 않는다**(DOC-008 v2.41 — P8.5): 고정은 화면의 지급방식
    // 선택을 따르므로 JS가 있을 때만 서고, JS가 없으면 전이가 월지급식 제출의 연쿠폰율을 0으로 둔다(아래 저장이 그것을 지난다)
    const rate = /<input[^>]*name="annualCouponRate"[^>]*>/.exec(form)?.[0] ?? ''
    expect(rate).toMatch(/value="0"/)
    expect(rate).not.toMatch(/readOnly|readonly/)
    // 기록이 없으므로 잠금이 없다 — 선택 상자가 그대로이고 산식 버튼이 있다
    expect(form).toContain('<select')
    expect(form).toContain('value="APPLY_COUPON_DATES"')

    const saved = await submitAction(editPath, jar, [...formValuesFor(html, actionId), buttonField(form, 'SUBMIT')])
    // 실패면 그 화면의 오류 문구 · 칸 오류를 단언 메시지에 싣는다 — 200만 보이면 원인을 찾을 수 없다
    const failure = saved.status === 200 ? alertTextOf(await saved.text()) : ''
    expect([302, 303], failure).toContain(saved.status)
    expect(locationPath(saved)).toBe(PATHS.product(fresh.productId))
    const { rows } = await queryRows<{ n: string }>(
      'select count(*)::text as n from public.monthly_coupon_schedules where els_id = $1::uuid',
      [fresh.productId],
    )
    expect(rows[0]?.n).toBe(String(months.length))
  })

  it('★ 만기보다 짧은 일정은 저장이 거부되고 블록의 일정 자리에 그 문구가 뜬다 — 행 수 = 평가주기 × 총 차수 (V-26 · P8.5)', async () => {
    const short = await registerProduct(jar, { label: '월지급짧음', principal: '100,000,000' })
    await makeMonthly(short.productId, monthsAround(asOf)) // 다섯 달 · 만기까지 18개월
    const editPath = PATHS.productEdit(short.productId)
    const html = await (await get(editPath, jar)).text()
    const actionId = actionIdOf('productEditFormAction')
    const res = await submitAction(editPath, jar, [...formValuesFor(html, actionId), buttonField(formHtmlFor(html, actionId), 'SUBMIT')])
    expect(res.status).toBe(200)
    expect((await res.text()).replace(/<!--[\s\S]*?-->/g, '')).toContain(
      '월수익 일정이 만기까지 이어지지 않는다 — 18개월이어야 한다(평가주기 × 총 차수). 평가일 산식으로 채우기를 누른다.',
    )
  })

  it('기록이 있는 상품 — 통화 · 지급방식은 값 글자 + 숨은 입력, 기록된 달은 readOnly, 산식 버튼은 「기록 뒤 달」뿐이다', async () => {
    const html = await (await get(PATHS.productEdit(monthly.productId), jar)).text()
    const form = formHtmlFor(html, actionIdOf('productEditFormAction'))
    expect(form).toContain('월수익 지급 기록이 있어 바꿀 수 없다')
    expect(form).not.toMatch(/<select[^>]*name="currency"/)
    expect(form).not.toMatch(/<select[^>]*name="couponPayout"/)
    expect(form).toMatch(/<input[^>]*type="hidden"[^>]*name="couponPayout"[^>]*value="MONTHLY"|<input[^>]*name="couponPayout"[^>]*type="hidden"/)
    // 1번째 달은 지급 기록이 있다 — 평가일 칸이 readOnly다
    expect(new RegExp(`<input[^>]*name="${couponCell(0, 'evaluationDate').replace(/[[\].]/g, '\\$&')}"[^>]*>`).exec(form)?.[0]).toMatch(/readOnly|readonly/)
    // 산식 버튼은 「기록 뒤 달」만 채운다(DOC-008 v2.41 · P8.5 — 종전에는 버튼이 없어 일정 길이를 맞출 길이 없었다)
    expect(form).toContain('기록 뒤 달 산식으로 채우기')
    const through = Number(/name="couponRecordedThrough"[^>]*value="(\d+)"|value="(\d+)"[^>]*name="couponRecordedThrough"/.exec(form)?.slice(1).find(Boolean))
    expect(through).toBeGreaterThanOrEqual(1)

    // 눌러 보면 — 기록된 달까지의 날짜는 그대로이고 일정이 만기까지(18행) 이어진다
    const editPath = PATHS.productEdit(monthly.productId)
    const actionId = actionIdOf('productEditFormAction')
    const res = await submitAction(editPath, jar, [...formValuesFor(html, actionId), buttonField(form, 'APPLY_COUPON_DATES')])
    expect(res.status).toBe(200)
    const after = formHtmlFor(await res.text(), actionId)
    expect(after).toContain(`name="${couponCell(17, 'evaluationDate')}"`)
    expect(after).not.toContain(`name="${couponCell(18, 'evaluationDate')}"`)
    expect(after).toContain(`value="${monthsAround(asOf)[0]!.evaluationDate}"`)
  })

  it('★ b4 — 상환 시 지급 상품의 폼에도 월지급 블록이 닫힌 채 있고 「월지급식」을 고를 수 있다(JS 없이 같은 렌더에서 채운다)', async () => {
    for (const path of [PATHS.productNew, PATHS.productEdit(plain.productId)]) {
      const html = await (await get(path, jar)).text()
      expect(html, path).toContain(`name="${MONTHLY_RATE_FIELD}"`)
      // 닫힌 채 — `<details>`에 open이 없다(월지급식이 아니다)
      const details = /<details[^>]*>\s*<summary[^>]*>월지급 — /.exec(html)?.[0] ?? ''
      expect(details, path).not.toBe('')
      expect(details, path).not.toMatch(/\bopen\b/)
      expect(html, path).toMatch(/<option value="MONTHLY">월지급식<\/option>/)
    }
  })

  it('★ 등록 화면에서 월지급식을 골라 그 렌더의 블록으로 저장한다 — 율 · 일정(18행 = 6개월 × 3차) · 연쿠폰율 0 · 상세 ⑦', async () => {
    const created = await registerProduct(jar, {
      label: '월지급폼',
      principal: '100,000,000',
      monthly: { annualRate: '7.2', barrier: '60' },
    })
    const { rows } = await queryRows<{ payout: string; annual: string; monthly: string; months: number }>(
      `select p.coupon_payout::text as payout, p.annual_coupon_rate::text as annual,
              p.monthly_coupon_annual_rate::text as monthly,
              (select count(*)::int from public.monthly_coupon_schedules s where s.els_id = p.id) as months
         from public.els_products p where p.id = $1::uuid`,
      [created.productId],
    )
    expect(rows[0]).toEqual({ payout: 'MONTHLY', annual: '0.0000', monthly: '0.0720', months: 18 })
    expect(await detailHtml(created.productId)).toContain(`id="${COUPON_SECTION.id}"`)
  })

  it('SCR-205 기실현 등재에도 「월지급식」 선택지가 있다', async () => {
    const html = await (await get(PATHS.productRealizedNew, jar)).text()
    expect(html).toMatch(/<option value="MONTHLY">월지급식<\/option>/)
  })
})

/** 응답 문서의 오류 요약(`role="alert"`)과 칸 오류(`…-error`)의 글자 */
function alertTextOf(html: string): string {
  const strip = (fragment: string) => fragment.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const alert = /<div[^>]*role="alert"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
  const fields = [...html.matchAll(/<p id="([^"]+)-error"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => `${m[1]}: ${strip(m[2] ?? '')}`)
  return [strip(alert), ...fields].join(' | ')
}

/** 목록에서 그 상품의 카드가 있는 페이지 — 「n / m」을 읽고 넘긴다(products.test.ts의 같은 헬퍼) */
async function listPageWith(productId: string): Promise<string> {
  const needle = `href="${PATHS.product(productId)}"`
  const first = await (await get(PATHS.products, jar)).text()
  if (first.includes(needle)) return first
  const shown = /(\d+) \/ (\d+)</.exec(first.replace(/<!-- -->/g, ''))
  const pageCount = shown == null ? 1 : Number.parseInt(shown[2]!, 10)
  for (let page = 2; page <= pageCount; page += 1) {
    const html = await (await get(`${PATHS.products}?page=${page}`, jar)).text()
    if (html.includes(needle)) return html
  }
  throw new Error(`목록 ${pageCount}페이지에 ${productId}가 없다`)
}

/** 그 상품의 카드(`<li>` 하나) — 상품 링크부터 다음 카드 앞까지 */
function cardOf(html: string, productId: string): string {
  const start = html.indexOf(`href="${PATHS.product(productId)}"`)
  const next = html.indexOf('<li', start)
  return html.slice(start, next === -1 ? undefined : next)
}

describe('SCR-201 ⑮ · SCR-101 ②④ (b3-5)', () => {
  it('★ 목록 — 월지급 카드는 연쿠폰 대신 월수익 요약(지급 2/5), 상환 시 지급 카드는 그대로', async () => {
    const card = cardOf(await listPageWith(monthly.productId), monthly.productId)
    expect(card).toContain('월 0.6% · 월수익 배리어 60% · 지급 2/5 · 다음 D-')
    expect(card).not.toContain('연쿠폰')
    const plainCard = cardOf(await listPageWith(plain.productId), plain.productId)
    expect(plainCard).toContain('연쿠폰')
    expect(plainCard).not.toContain('월수익')
  })

  it('홈 — 「받은 월수익」 줄(보유중 PAID 합) · 「월수익 미기록 · 3개월」 칩', async () => {
    const html = (await (await get(PATHS.home, jar)).text()).replace(/<!-- -->/g, '')
    expect(html).toContain('받은 월수익 +1,200,000원')
    // SCR-204 절의 새 월지급 상품 — 기록이 없고 평가가 끝난 달이 셋이다
    expect(html).toContain('월수익 미기록 · 3개월')
  })
})

describe('SCR-301 월수익 — ⑮ 상품별 카드의 하위 목록 · ⑯ 시간순의 월수익 행 · 「종류」 (b3-6)', () => {
  const TIME = `${PATHS.schedule}?${SCHEDULE_KEYS.view}=TIME`
  /** React의 빈 주석을 지운다 — `{n}번째`가 `4<!-- -->번째`로 렌더된다(schedule.test.ts의 `visible`) */
  const visible = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')
  const page = async (path: string) => visible(await (await get(path, jar)).text())

  /** 상품별 카드 — 상품 링크부터 다음 카드의 `<h2>` 앞까지(카드 안에 차수 · 월수익 `<li>`가 중첩되어 `<li>`로 자를 수 없다) */
  function scheduleCardOf(html: string, productId: string): string {
    const start = html.indexOf(`href="${PATHS.product(productId)}"`)
    expect(start, `카드가 없다: ${productId}`).toBeGreaterThan(-1)
    const next = html.indexOf('<h2', start)
    return html.slice(start, next === -1 ? undefined : next)
  }

  /** 시간순의 그 상품 행 — `<li>` 하나가 한 행이다(중첩 없음) */
  function timeRowsOf(html: string, productId: string): string[] {
    return [...html.matchAll(/<li\b[\s\S]*?<\/li>/g)]
      .map((m) => m[0])
      .filter((row) => row.includes(`href="${PATHS.product(productId)}"`))
  }

  it('★ 상품별 — 월지급 카드는 ⑧ 연쿠폰을 숨기고 다음 월수익 하나 + 「나머지 월수익 4건」을 단다, 상환 시 지급 카드는 그대로', async () => {
    const html = await page(PATHS.schedule)
    const card = scheduleCardOf(html, monthly.productId)
    expect(card).not.toContain('연쿠폰')
    expect(card).toMatch(/월수익 평가일 <span[^>]*>5건</)
    // 다음 = isPast가 거짓인 첫 행 — 4번째(+20일)다. 표기는 SCR-202 ⑦과 같다
    const fourth = monthsAround(asOf)[3]!
    const nextAt = card.indexOf(`4번째 · ${fourth.evaluationDate}`)
    const restAt = card.indexOf('나머지 월수익 4건')
    expect(nextAt).toBeGreaterThan(-1)
    // 다음 행은 접힘 «밖»(요약 앞)에 있다 — 나머지 넷은 `<details>` 안이다
    expect(restAt).toBeGreaterThan(nextAt)

    const plainCard = scheduleCardOf(html, plain.productId)
    expect(plainCard).toContain('연쿠폰')
    expect(plainCard).not.toContain('월수익 평가일')
  })

  it('★ 시간순 — 「종류」가 서고 행이 종류를 말한다 · 월수익만 · 조기상환만으로 좁힌다', async () => {
    const all = await page(TIME)
    expect(all).toContain(`name="${SCHEDULE_KEYS.kind}"`)
    expect(all).toContain('차수 · 월수익')
    const rows = timeRowsOf(all, monthly.productId)
    expect(rows.filter((row) => row.includes('월수익 평가일'))).toHaveLength(5)
    expect(rows.filter((row) => row.includes('조기상환 평가일'))).toHaveLength(3)

    const coupons = timeRowsOf(await page(`${TIME}&${SCHEDULE_KEYS.kind}=COUPON`), monthly.productId)
    expect(coupons).toHaveLength(5)
    expect(coupons.every((row) => row.includes('번째'))).toBe(true)

    const rounds = timeRowsOf(await page(`${TIME}&${SCHEDULE_KEYS.kind}=ROUND`), monthly.productId)
    expect(rounds).toHaveLength(3)
    expect(rounds.some((row) => row.includes('월수익 평가일'))).toBe(false)
  })

  it('★ 상품별 보기는 「종류」를 그리지도 적용하지도 않는다 — 주소의 kind=COUPON을 버린다(v2.33 ⓐ)', async () => {
    const html = await page(`${PATHS.schedule}?${SCHEDULE_KEYS.kind}=COUPON`)
    expect(html).not.toContain(`name="${SCHEDULE_KEYS.kind}"`)
    // 좁혔다면 상환 시 지급 카드는 사라졌을 것이다
    expect(scheduleCardOf(html, plain.productId)).toContain('연쿠폰')
  })

  it('월수익 행이 없는 사용자의 시간순에는 「종류」가 없다', async () => {
    const empty = await authenticatedJar(E2E_EMPTY)
    const html = await (await get(TIME, empty)).text()
    expect(html).not.toContain(`name="${SCHEDULE_KEYS.kind}"`)
  })

  it('ⓕ 기간이 차수를 다 자른 월지급 상품 — 상품별에는 「n건」 줄만, 시간순에는 그 상품의 월수익 행', async () => {
    // 발행 30일 전 — 차수가 전부 미래다. 월수익은 하나가 지났다(−10일)
    const orphan = await registerProduct(jar, {
      label: '월지급고아',
      principal: '100,000,000',
      issueDate: shiftDays(asOf, -30),
    })
    await makeMonthly(orphan.productId, [
      { couponNo: 1, evaluationDate: shiftDays(asOf, -10), paymentDate: shiftDays(asOf, -7) },
      { couponNo: 2, evaluationDate: shiftDays(asOf, 20), paymentDate: shiftDays(asOf, 23) },
    ])
    const past = `${PATHS.schedule}?${SCHEDULE_KEYS.range}=PAST`

    const product = await page(past)
    // 개수는 이 파일의 다른 월지급 상품의 첫 차수가 오늘 앞인지에 달린다 — 값은 순수 함수가 본다(`productsWithoutRounds`)
    expect(product).toMatch(/이 기간에 차수가 없어 상품별 보기에 없는 월지급 상품 \d+건/)
    expect(product).not.toContain(`href="${PATHS.product(orphan.productId)}"`)

    const time = await page(`${past}&${SCHEDULE_KEYS.view}=TIME`)
    const rows = timeRowsOf(time, orphan.productId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('1번째')
  })
})

describe('세금 · 전망 · 상세 · 상환 · 설정 — 월수익이 사건으로 든다 (b4)', () => {
  /*
   * 픽스처의 월수익 다섯 달은 기준일 −70 · −40 · −10 · +20 · +50일이다 — 어느 날 돌려도 올해에 추정 월수익이 하나 이상
   * 있다(연말이면 −10, 연초면 +20). 그래서 아래 단언은 시각에 기대지 않는다(배지 낱말만은 연초에 「추정」일 수 있어 둘 다 받는다)
   */
  const visible = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')
  const page = async (path: string) => visible(await (await get(path, jar)).text())

  it('★ SCR-401 — 월지급 상품 행에 기여 근거 배지 · 내역 줄 · 확정/추정 분할 · 월지급 가정 문장', async () => {
    const html = await page(PATHS.tax)
    const at = html.indexOf(`href="${PATHS.product(monthly.productId)}"`)
    expect(at).toBeGreaterThan(-1)
    const row = html.slice(at, html.indexOf('</li>', at))
    expect(row).toMatch(/>(확정 \+ 추정|추정)</)
    expect(row).toContain('월수익')
    expect(html).toContain('ELS 과세 금융소득 중 확정')
    expect(html).toContain(MONTHLY_COUPON_ESTIMATE_NOTE)
    // 상환 시 지급 상품 행에는 내역이 없다 — 종전 그대로
    const plainAt = html.indexOf(`href="${PATHS.product(plain.productId)}"`)
    if (plainAt > -1) expect(html.slice(plainAt, html.indexOf('</li>', plainAt))).not.toContain('월수익')
  })

  it('SCR-101 ③ · SCR-402 · SCR-502 — 같은 가정을 같은 문장으로(전망은 짧은 표식)', async () => {
    expect(await page(PATHS.home)).toContain(MONTHLY_COUPON_ESTIMATE_NOTE)
    expect(await page(PATHS.forecast)).toContain(MONTHLY_COUPON_ASSUMPTION)
    expect(await page(PATHS.settings)).toContain(MONTHLY_COUPON_ESTIMATE_NOTE)
  })

  it('SCR-202 ⑤ — 잔여 월수익 블록(월지급식에만) · SCR-203 — 과세 칸 0 고정 · 실수령액 힌트', async () => {
    expect(await page(PATHS.product(monthly.productId))).toContain('잔여 월수익')
    expect(await page(PATHS.product(plain.productId))).not.toContain('잔여 월수익')
    const redeem = await page(PATHS.productRedeem(monthly.productId))
    expect(redeem).toContain('투자원금 이하 — 그 달 월수익은 여기 넣지 않는다')
    expect(redeem).toMatch(/<input[^>]*name="taxableIncome"[^>]*readOnly|<input[^>]*readOnly[^>]*name="taxableIncome"/i)
  })
})

describe('달러 월지급 · 환율 없음 — ST-07이 무기록 달러 월수익에서도 뜬다 (b4 · DOC-008 v2.37)', () => {
  /*
   * **이 describe는 스스로 정리한다** — usd.test.ts와 같은 이유다. 미상환 달러 상품이 남으면 그 사용자의 세금 · 전망에 ST-07이
   * 생기고, 환율을 저장하는 usd.test.ts의 「n = 1」 단언이 이 파일이 먼저 돌았는가에 의존하게 된다. 환율은 쓰지 않는다 —
   * 이 describe가 보는 것이 환율이 없는 상태다(db:reset 직후 `exchange_rates`는 비어 있고 usd.test.ts가 자기 좌표를 지운다)
   */
  let usd: RegisteredProduct | null = null
  const visible = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '')

  beforeAll(async () => {
    usd = await registerProduct(jar, { label: '달러월지급', currency: 'USD', principal: '10,000.00' })
    await makeMonthly(usd.productId, monthsAround(asOf))
  })

  afterAll(async () => {
    if (usd == null) return
    const path = PATHS.product(usd.productId)
    await submitAction(path, jar, formFieldsFor(await detailHtml(usd.productId), actionIdOf('deleteProductAction')))
  })

  it('★ SCR-202 ⑤ — 잔여 월수익의 과세는 「환율 없음」이고 목록 아래 ST-07 한 상품 형태가 한 번 뜬다(링크까지)', async () => {
    const html = visible(await detailHtml(usd!.productId))
    // **스크립트 밖에서 본다** — RSC 페이로드(`self.__next_f.push`)가 같은 글자를 한 번 더 싣는다(실측: 전체 2 · 스크립트 밖 1).
    // 안을 보면 렌더에서 지워도 페이로드만으로 초록이 될 수 있다
    const rendered = html.replace(/<script\b[\s\S]*?<\/script>/g, '')
    expect(rendered).toContain('잔여 월수익')
    expect(rendered).toContain('환율 없음')
    const lead = exchangeRateMissingLead({ kind: 'PRODUCT' })
    // 한 번이다 — 상환 추정은 연쿠폰율 0이라 환율 없이 0원이므로 `Projection`의 같은 문구가 겹치지 않는다
    expect(rendered.split(lead).length - 1).toBe(1)
    expect(rendered).toMatch(
      new RegExp(
        `${lead}${EXCHANGE_RATE_MISSING_JOINER}<a\\b[^>]*href="${EXCHANGE_RATE_SECTION.href.replace(/[?]/g, '\\?')}"[^>]*>${EXCHANGE_RATE_INPUT_LINK_LABEL}</a>`,
      ),
    )
  })

  it('SCR-401 — 그 상품을 「달러 상품 1건」으로 센다(상품 수 — 월수익 추정 여럿이어도 하나)', async () => {
    const html = visible(await (await get(PATHS.tax, jar)).text())
    expect(html).toContain(exchangeRateMissingLead({ kind: 'COUNT', count: 1 }))
  })
})
