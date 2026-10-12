import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { today } from '@/lib/db/today'
import { shiftDays } from '@/lib/domain'
import { EVALUATION_VERDICT_LABELS, REDEMPTION_TYPE_LABELS, redeemPrefillNote } from '@/lib/format'
import { DASHBOARD_KEYS } from '@/lib/forms/query'
import { REDEMPTION_DATE_OFFSET_DAYS } from '@/lib/forms/redemption'
import { PATHS, REDEEM_ROUND } from '@/lib/routes/paths'

import { ITG_USER_A, ITG_USER_B } from '../integration/helpers/fixtures'
import { closeSeedConnection, sql } from '../integration/helpers/seed'
import { actionIdOf, formValuesFor, submitAction } from './helpers/actions'
import { authenticatedJar } from './helpers/auth'
import { firstEvaluationDateOf, issueDateForFirstRound } from './helpers/dates'
import { registerProduct, saveAssetPrice, type RegisteredProduct } from './helpers/register'
import { get, type cookieJar } from './helpers/server'
import { DISPLAY_NAME } from './helpers/users'

/**
 * 평가일 판정 · 「상환 확인 필요」 종단 흐름 — 프록시 · 렌더 · 서버 액션을 지난다 (P6 컷 7-5 · DOC-008 SCR-101 ⑥ · SCR-202 ·
 * SCR-203)
 *
 * 민서의 요청(2026-10-07) 그대로다: 평가일이 지났는데 기록을 빠뜨렸다 → 다음 접속 때 홈 맨 위가 알린다 → [상환 처리]가 그
 * 차수로 채운 폼을 연다 → 저장하면 사라진다.
 *
 * ## 순서가 곧 흐름이다
 *
 * 이 파일의 `it`은 **한 상품의 상태 전이를 차례로 본다**(종가 없음 → 충족 → 기록). 앞이 실패하면 뒤도 실패한다 — 그것이
 * 정직한 신호다(앞 단계 없이 뒤 단계의 상태를 만들면 그 흐름을 시험한 것이 아니다). 상태를 공유하지 않는 단언(이월 · 남의
 * 보기)은 따로 둔다.
 *
 * ## 화면으로 만들 수 없는 상태 하나 — 등록일
 *
 * 등록일은 `created_at`이고(DOC-005 「등록일」) 계약이 쓰지 않는다. 오늘 등록한 상품의 지난 평가일은 「등록 전」이라 판정
 * 대상이 아니므로(D3) **SQL로 등록일을 발행일로 소급한다** — `defects.ts`의 「계약으로는 도달 불가」 선례와 같은 부류다.
 * 평가일 종가는 **화면으로 넣는다**(SCR-302 — V-17이 그대로 걸린다).
 *
 * 소유자는 통합 사용자 A(이 스위트의 기본 사용자), 남의 보기는 B다. 단언은 ~~상품명으로~~ → **상품 링크(`href="/products/{id}"`)로**
 * 행을 고른다 *(홈 피드백 컷 K1 — 회차 강조가 이름을 노드로 쪼갠다)* — 다른 파일이 A에 만든 상품이 ⑥에 함께 있어도 섞이지 않는다.
 */

const P_PRINCIPAL = '100,000,000'
/** 기준가와 같다 → 평가일 워스트오브 100% ≥ 1차 배리어 90% */
const CLOSE_MET = '99999999999.999999'
/** 70% — 1차 배리어 90% 미만 · 리자드는 2차에만 있다 → 이월. KI 50%보다 위 */
const CLOSE_CARRY = '70000000000.000000'

/** React가 넣는 빈 주석을 지운다 — `home.test.ts`의 같은 함수 */
function visible(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

/** 그 절만 잘라낸다(다음 `<h2`까지) */
function sectionOf(html: string, title: string): string {
  const at = html.search(new RegExp(`<h2[^>]*>${title}`))
  if (at < 0) return ''
  const next = html.indexOf('<h2', at + 4)
  return next < 0 ? html.slice(at) : html.slice(at, next)
}

/**
 * 그 상품의 줄 — 없으면 빈 문자열. ~~상품명이 들어 있는 줄~~ → **상품 링크가 있는 줄** *(홈 피드백 컷 K1 — `home.test.ts`의
 * `rowsOf`와 같은 열쇠)*. 닫는 따옴표까지 넣으므로 같은 줄의 `href="/products/{id}/redeem?round=k"`와 겹치지 않는다.
 *
 * `find ?? ''`를 유지한다 — 「이월이면 어디에도 없다」와 ⑤ 「저장하면 ⑥에서 사라진다」가 빈 문자열을 단언한다. 없음을
 * 실패로 바꾸면(`toHaveLength(1)` 꼴) 그 둘이 성립하지 않는다.
 */
function rowIn(html: string, product: Pick<RegisteredProduct, 'productId'>): string {
  const href = `href="${PATHS.product(product.productId)}"`
  return [...html.matchAll(/<li\b[\s\S]*?<\/li>/g)].map((m) => m[0]).find((row) => row.includes(href)) ?? ''
}

const CHECK = '상환 확인 필요'

async function homeOf(jar: ReturnType<typeof cookieJar>, scope?: 'ALL'): Promise<string> {
  const url = scope == null ? PATHS.home : `${PATHS.home}?${DASHBOARD_KEYS.scope}=ALL`
  return visible(await (await get(url, jar)).text())
}

/** 등록 → 등록일을 발행일로 소급(SQL) — 지난 1차 평가일이 판정 대상이 된다 */
async function registerBackdated(
  jar: ReturnType<typeof cookieJar>,
  label: string,
  issueDate: string,
): Promise<RegisteredProduct> {
  const product = await registerProduct(jar, { label, issueDate, principal: P_PRINCIPAL })
  // `date`를 `timestamptz`로 — 세션 시간대(UTC) 자정 = KST 09시, 같은 날짜다
  await sql('update public.els_products set created_at = $2::date::timestamptz where id = $1::uuid', [
    product.productId,
    issueDate,
  ])
  return product
}

describe('평가일 판정 · 상환 확인 필요 — 종단 흐름', () => {
  let a: ReturnType<typeof cookieJar>
  let b: ReturnType<typeof cookieJar>
  let asOf: string
  let firstRound: string
  let met: RegisteredProduct
  let carry: RegisteredProduct

  beforeAll(async () => {
    a = await authenticatedJar(ITG_USER_A)
    b = await authenticatedJar(ITG_USER_B)
    asOf = today()
    // 1차 평가일이 3~12일 전 · 평일 — 「다음 날 오후」 덧붙임(경과 2일 이내)과 주말 갈래를 피한다
    const issueDate = issueDateForFirstRound(asOf, { min: -12, max: -3 }, { weekday: true })
    firstRound = firstEvaluationDateOf(issueDate)

    met = await registerBackdated(a, '판정흐름', issueDate)
    carry = await registerBackdated(a, '판정이월', issueDate)
    // 이월 상품의 평가일 종가는 처음부터 넣는다 — 이 상품은 어느 단계에서도 묻지 않아야 한다
    await saveAssetPrice(a, carry.assetId, CLOSE_CARRY, firstRound)
  })

  afterAll(async () => {
    await closeSeedConnection()
  })

  it('① 평가일 종가가 없으면 ⑥에 「평가일 종가 없음 — 직접 확인」 · 시세 입력 · [상환 처리](?round=1)', async () => {
    const home = await homeOf(a)
    const row = rowIn(sectionOf(home, CHECK), met)
    expect(row, '⑥에 그 상품의 줄이 없다').not.toBe('')
    expect(row).toContain(EVALUATION_VERDICT_LABELS.CLOSE_MISSING)
    expect(row).toContain(`1차 · ${firstRound}`)
    expect(row).toContain(`href="${PATHS.prices}"`)
    expect(row).toContain(`href="${REDEEM_ROUND.href(met.productId, 1)}"`)
    // 결측 자산의 이름이 안내에 있다
    expect(row).toContain(met.assetName)
  })

  it('★ ①′ 종가 없음 — 버튼(?round=1)은 1차를 열고 유형을 비운다 · 쿼리 없이 열면 종전대로 다음 차수다', async () => {
    /*
     * 이 단계가 `?round`의 배선을 판별한다 — 판정이 충족이면 쿼리 없이도 판정 차수(1차)로 열리므로(⑤) 쿼리를 무시하는
     * 구현도 그 단계는 통과한다. 종가 없음은 판정이 없으므로 두 주소가 다른 차수를 고른다
     */
    const actionId = actionIdOf('redemptionFormAction')
    const requested = Object.fromEntries(
      formValuesFor(await (await get(REDEEM_ROUND.href(met.productId, 1), a)).text(), actionId),
    )
    expect(requested).toMatchObject({
      roundNo: '1',
      redemptionType: '',
      redemptionDate: shiftDays(firstRound, REDEMPTION_DATE_OFFSET_DAYS),
    })
    const plain = Object.fromEntries(
      formValuesFor(await (await get(PATHS.productRedeem(met.productId), a)).text(), actionId),
    )
    expect(plain).toMatchObject({ roundNo: '2', redemptionDate: asOf })
  })

  it('★ 이월이면 어디에도 없다 — ⑥에도 ④에도(D2 · 「평가일 경과」 칩은 사라졌다)', async () => {
    const home = await homeOf(a)
    expect(rowIn(sectionOf(home, CHECK), carry)).toBe('')
    expect(sectionOf(home, '주의 상태 상품')).not.toContain('평가일 경과')
  })

  it('② SCR-302에서 그날 종가를 넣으면 「조기상환 조건 충족」으로 바뀐다 — 평가일 W 대 배리어', async () => {
    await saveAssetPrice(a, met.assetId, CLOSE_MET, firstRound)
    const row = rowIn(sectionOf(await homeOf(a), CHECK), met)
    expect(row).toContain(EVALUATION_VERDICT_LABELS.EARLY)
    expect(row).toContain('평가일 워스트오브 100% · 배리어 90%')
    // 종가가 생겼으므로 「시세 입력」은 없다
    expect(row).not.toContain(`href="${PATHS.prices}"`)
  })

  it('③ 남의 전체 보기에는 행이 있고 [상환 처리]가 없다 — 이름과 사실만(ST-04 · D1)', async () => {
    const row = rowIn(sectionOf(await homeOf(b, 'ALL'), CHECK), met)
    expect(row).toContain(EVALUATION_VERDICT_LABELS.EARLY)
    expect(row).toContain(DISPLAY_NAME[ITG_USER_A])
    expect(row).not.toContain('/redeem?round=')
  })

  it('④ 상세에 같은 안내 · 머리 「상환 처리」가 ?round=1을 단다', async () => {
    const html = visible(await (await get(PATHS.product(met.productId), a)).text())
    expect(html).toContain('조기상환 조건을 충족했다(워스트오브 100% ≥ 배리어 90% · 추정)')
    expect(html).toContain(`href="${REDEEM_ROUND.href(met.productId, 1)}"`)
  })

  it('★ ⑤ [상환 처리]가 1차 · 조기상환 · 1차 금액 · 평가일 + 5일로 채운 폼을 연다 → 저장하면 ⑥에서 사라진다', async () => {
    const actionId = actionIdOf('redemptionFormAction')
    const form = await (await get(REDEEM_ROUND.href(met.productId, 1), a)).text()
    // 안내는 실제로 채운 것을 말한다(DOC-008 SCR-203 v2.46) — 유형을 판정에서 채웠고 금액은 비우지 않았다
    expect(form).toContain(redeemPrefillNote({ typeFilled: true, amountsBlankedByKiTouch: false }))

    const values = Object.fromEntries(formValuesFor(form, actionId))
    expect(values).toMatchObject({
      roundNo: '1',
      redemptionType: 'EARLY',
      // 1억 × (1 + 0.08 × 6/12)
      grossAmount: '104000000',
      taxableIncome: '4000000',
      redemptionDate: shiftDays(firstRound, REDEMPTION_DATE_OFFSET_DAYS),
      withholdingTax: '',
    })

    const saved = await submitAction(PATHS.productRedeem(met.productId), a, formValuesFor(form, actionId))
    expect([302, 303]).toContain(saved.status)

    const home = await homeOf(a)
    expect(rowIn(sectionOf(home, CHECK), met), '기록했는데 ⑥에 남았다').toBe('')
    /*
     * 기록의 관측은 **상세**에서 한다 — 홈 ⑤ 「최근 상환 실적」은 세 건만 보이므로(`RECENT_VISIBLE`) 같은 사용자 A에 다른
     * e2e 파일이 더 최근 날짜의 상환을 만들면 이 상품이 잘려 나간다(반박 검토 — 실행 순서 · 날짜에 의존하는 단언이었다)
     */
    const detail = visible(await (await get(PATHS.product(met.productId), a)).text())
    expect(detail).toContain('>상환 실적<')
    expect(detail).toContain(REDEMPTION_TYPE_LABELS.EARLY)
    expect(detail, '상환했는데 상세의 안내가 남았다').not.toContain('aria-label="상환 확인 필요"')
  })
})
