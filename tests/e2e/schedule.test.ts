import { beforeAll, describe, expect, it } from 'vitest'

import {
  EVALUATION_DATE_OFFSET_DAYS,
  generateEvaluationDates,
} from '@/lib/domain'
import { STATUS_LABELS, korMonth, percent, ymd } from '@/lib/format'
import { percentToRatio } from '@/lib/forms/parse'
import { SCHEDULE_KEYS } from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

import { actionIdOf, formValuesFor, submitAction } from './helpers/actions'
import { authenticatedJar } from './helpers/auth'
import { registerProduct, type RegisteredProduct } from './helpers/register'
import { cookieJar, get } from './helpers/server'

/**
 * SCR-301 평가일정 — **Next를 지나야 존재하는 것들** (P4 컷 7)
 *
 * ## 이 컷이 여기서만 확인할 수 있는 것 셋
 *
 * | 무엇을 | 왜 여기인가 |
 * |---|---|
 * | v1.8의 `ownerId`가 **선택지가 되어 되돌아온다** | 필터의 입력과 출력이 한 계약 안에서 닫히는지는 렌더된 `<option value>`를 그 계약에 다시 넣어 봐야 안다 |
 * | v1.8의 `status`가 **표식으로 보인다** | 상환은 상태 전이이므로 두 요청의 상호작용이고, 「숨김」과 「표식」의 차이는 두 주소의 응답을 비교해야 나타난다 |
 * | 두 절과 월 그룹이 **실제 데이터에서 갈린다** | `splitByPast`·`groupByMonth`는 상시 스위트가 보지만, 그 결과가 절 머리글 사이에 놓이는지는 문서에만 있다 |
 *
 * ## 데이터를 전제하지 않는다 — 만든다
 *
 * `registerProduct`가 화면으로 자산·시세·상품을 만든다(컷 4b). 이 파일이 쓰는 상품은
 * **올해 1월 발행 + 6개월 주기 3차수**이므로 1차는 경과, 2·3차는 미래다 — 즉 **두 절이
 * 모두 채워진다.** 그 성질이 이 화면의 기본 상태를 만드는 조건이므로, 날짜를 손으로
 * 적지 않고 `generateEvaluationDates`로 파생시킨다(앱이 저장할 때 쓴 함수와 같다).
 *
 * 다만 목록은 **전역**이다(모든 SELECT 정책이 `using (true)`). 그래서 단언은 문서
 * 전체가 아니라 **내 상품의 줄**을 잘라 본다 — 다른 상품의 값에 우연히 맞는 단언을
 * 만들지 않는다(컷 4a의 「기초자산 1」, 컷 5의 「상환 실적」과 같은 함정).
 */

/** 존재할 수 없는 소유자. 어떤 DB 상태에서도 이 필터의 결과는 0건이다. */
const GHOST_OWNER = '00000000-0000-4000-8000-0000000000ff'

const EMPTY_NARROWED = '조건에 맞는 평가일이 없다'
const EMPTY_TOTAL = '등록된 평가일정이 없다'
const PAST_SECTION = '지난 평가일'
const UPCOMING_SECTION = '다가오는 평가일'

/**
 * React가 넣는 빈 주석을 지운다 — **인접한 텍스트와 표현식 사이에 경계가 생긴다.**
 *
 * ★ 실측으로 걸렸다: `{item.roundNo}차`는 `1<!-- -->차`로 렌더되므로
 * `toContain('1차')`가 실패한다(하이드레이션이 두 자식 노드를 구분해야 하기 때문이며
 * 화면에는 보이지 않는다). `products.test.ts`가 `예상 {LABEL}`에서 같은 것에 걸렸고
 * 같은 이유로 같은 함수를 둔다 — **HTML 문자열은 사용자가 보는 것과 같지 않다.**
 */
function visible(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

/** 그 상품의 줄만 모아 온다 — `<li>` 단위이며 차수마다 하나다 */
function rowsOf(html: string, productName: string): string[] {
  return [...html.matchAll(/<li\b[\s\S]*?<\/li>/g)]
    .map((m) => m[0])
    .filter((row) => row.includes(productName))
}

/**
 * 절 머리글의 위치 — **`<h2>` 경계까지 본다.**
 *
 * ★ 처음에는 `html.indexOf('>지난 평가일')`이었고 **실측에서 걸렸다.** 같은 문자열이
 * 기간 선택 상자의 `<option>` 라벨로도 렌더되므로(「지난 평가일」·「다가오는 평가일」)
 * 그 인덱스가 목록보다 **앞의 폼**을 가리켰다 — 절을 자른 결과가 문서 전체에
 * 가까워져 「그 절에 있다」가 아무것도 확인하지 않게 되고, 「그 절이 없다」는 필터가
 * 렌더된 것만으로 실패했다.
 *
 * 컷 5의 `>상환 실적<`, 컷 4a의 「기초자산 1」과 같은 함정이다: **문서 전체에 대한
 * `toContain`은 다른 자리에 맞을 수 있다.** 절의 존재는 머리글로만 판정한다.
 */
function headingAt(html: string, title: string): number {
  return html.search(new RegExp(`<h2[^>]*>${title}`))
}

function hasSection(html: string, title: string): boolean {
  return headingAt(html, title) >= 0
}

/**
 * 절을 자른다 — 「지난」 머리글부터 「다가오는」 머리글까지가 앞 절이다.
 *
 * 두 절이 같은 문서에 있으므로 문서 전체에 대한 `toContain`으로는 **어느 절에
 * 있는지**를 확인할 수 없다. 이 화면의 요점이 그 구분이므로 잘라서 본다.
 */
function sectionOf(html: string, which: 'past' | 'upcoming'): string {
  const pastAt = headingAt(html, PAST_SECTION)
  const upcomingAt = headingAt(html, UPCOMING_SECTION)

  if (which === 'past') {
    if (pastAt < 0) return ''
    return upcomingAt < 0 ? html.slice(pastAt) : html.slice(pastAt, upcomingAt)
  }
  if (upcomingAt < 0) return ''
  /*
   * 뒤 절의 끝은 문서의 끝이 아니라 **RSC 페이로드 앞**이다. 그 뒤에는 같은 목록이
   * 직렬화되어 한 번 더 실려 있으므로(`self.__next_f.push`) 자르지 않으면 줄을 두 번
   * 세게 된다 — 지금은 `<li` 태그가 그 안에서 이스케이프되어 세지 않지만, 그것은
   * 인코딩의 성질이지 우리가 정한 경계가 아니다.
   */
  const scriptAt = html.indexOf('<script>self.__next_f', upcomingAt)
  return scriptAt < 0 ? html.slice(upcomingAt) : html.slice(upcomingAt, scriptAt)
}

/** 그 상품의 차수별 평가일. 앱이 저장할 때 쓴 함수와 같다 */
function evaluationDatesOf(product: RegisteredProduct): string[] {
  return generateEvaluationDates({
    issueDate: product.issueDate,
    evaluationPeriodMonths: 6,
    totalRounds: product.barriers.length,
    offsetDays: EVALUATION_DATE_OFFSET_DAYS,
  })
}

describe('SCR-301 평가일정', () => {
  let jar: ReturnType<typeof cookieJar>
  let seeded: RegisteredProduct
  let dates: string[]

  beforeAll(async () => {
    jar = await authenticatedJar()
    seeded = await registerProduct(jar, { label: '일정' })
    dates = evaluationDatesOf(seeded)
  })

  it('200으로 서고 필터 폼이 GET이다', async () => {
    const res = await get(PATHS.schedule, jar)
    expect(res.status).toBe(200)
    const html = await res.text()

    expect(html).toContain('평가일정')
    // 자리표시가 사라졌다 — 컷 7의 원장 이동이 화면에서 보이는 형태다.
    expect(html).not.toContain('아직 만들지 않은 화면이다')

    const form = /<form[^>]*action="\/schedule"[^>]*>/.exec(html)?.[0]
    expect(form, '필터 폼이 없다').toBeDefined()
    expect(form?.toLowerCase()).toContain('method="get"')
  })

  it('기간 선택지가 셋이고 기본값이 「전체 기간」이다', async () => {
    /*
     * ★ 기본값이 `ALL`인 것이 이 화면의 구조를 정한다 — DOC-008 §5가 「과거/미래
     * 구분」을 주요 요소로 규정하므로 기본 화면에 둘 다 있어야 한다. 기본이
     * 「다가오는」이면 그 구분은 눌러야 나타나는 기능이 된다.
     */
    const html = await (await get(PATHS.schedule, jar)).text()
    const select = /<select name="range"[\s\S]*?<\/select>/.exec(html)?.[0]

    expect(select, '기간 선택 상자가 없다').toBeDefined()
    expect([...select!.matchAll(/<option/g)]).toHaveLength(3)
    expect(select).toMatch(/value="ALL"[^>]*selected/)
  })

  it('★ 소유자 선택지의 값이 그 계약의 필터로 실제로 동작한다 — v1.8 `ownerId`', async () => {
    /*
     * ★ **필터의 입력과 출력이 한 계약 안에서 닫힌다.** v1.7까지 `ScheduleItem`에는
     * `ownerName`만 있어서 이 `<select>`의 **값을 만들 수 없었다** — 계약은
     * `params.ownerId`를 받는데 그 UUID가 어디에서도 오지 않았다(AQ-24와 같은 부류의
     * 비대칭이며 그쪽은 반대 방향이었다).
     *
     * 그래서 단언이 왕복이다: 화면이 제시한 값을 **그 화면에 다시 넣어** 내 상품이
     * 남는지 본다. `ownerId`를 렌더만 하고 필터로 쓰지 못하는 상태(예: 이름을 값으로
     * 실어 보내는 구현)는 이 단언에서 죽는다.
     */
    const html = await (await get(PATHS.schedule, jar)).text()
    const select = /<select name="ownerId"[\s\S]*?<\/select>/.exec(html)?.[0]
    expect(select, '소유자 선택 상자가 없다').toBeDefined()

    const values = [...select!.matchAll(/value="([^"]*)"/g)]
      .map((m) => m[1]!)
      .filter((value) => value !== '')
    expect(values.length, '소유자 선택지가 없다').toBeGreaterThan(0)
    // 값이 UUID다 — 이름이 실려 있으면 계약이 `22P02`로 죽는다(형식 가드가 버린다).
    for (const value of values) {
      expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    }

    // 그 값들 중 **정확히 하나**가 내 상품을 남긴다(나머지는 다른 소유자다).
    const kept: string[] = []
    for (const value of values) {
      const filtered = await (
        await get(`${PATHS.schedule}?${SCHEDULE_KEYS.ownerId}=${value}`, jar)
      ).text()
      if (rowsOf(filtered, seeded.productName).length > 0) kept.push(value)
    }
    expect(kept).toHaveLength(1)
  })

  it('★ 두 절이 갈리고 차수가 자기 절에 들어간다', async () => {
    /*
     * ★ **구획은 계약이 준 `isPast`로 나뉜다.** 이 상품은 올해 1월 발행 + 6개월
     * 주기이므로 1차는 경과이고 2·3차는 미래다 — 즉 한 상품이 두 절에 나뉘어
     * 나타난다. 날짜를 손으로 적지 않고 앱이 쓴 함수로 파생시킨다.
     */
    const html = await (await get(PATHS.schedule, jar)).text()

    expect(hasSection(html, PAST_SECTION), '지난 절이 없다').toBe(true)
    expect(hasSection(html, UPCOMING_SECTION), '다가오는 절이 없다').toBe(true)

    const past = sectionOf(html, 'past')
    const upcoming = sectionOf(html, 'upcoming')

    // 1차(경과)는 앞 절에, 2·3차(미래)는 뒤 절에
    expect(past).toContain(ymd(dates[0]!))
    expect(past).not.toContain(ymd(dates[1]!))
    for (const date of dates.slice(1)) {
      expect(upcoming, `${date}가 다가오는 절에 없다`).toContain(ymd(date))
    }
  })

  it('월 그룹 머리글이 차수의 달마다 있다', async () => {
    /*
     * 월 그룹의 키와 라벨을 같은 순수 함수가 내므로(`monthKey`·`korMonth`) 여기서는
     * 라벨이 문서에 닿는지만 본다. **해가 다른 같은 달**이 접히지 않는 것은 상시
     * 스위트가 본다(`tests/app/schedule.test.ts`) — 이 상품의 2·3차가 정확히 그
     * 경우다(2027년 1월·7월).
     */
    const html = await (await get(PATHS.schedule, jar)).text()
    for (const date of dates) {
      expect(html, `${date}의 월 머리글`).toContain(korMonth(date))
    }
  })

  it('DOC-008 §5의 항목 표시 여섯이 한 줄에 있다', async () => {
    const html = visible(await (await get(PATHS.schedule, jar)).text())
    const rows = rowsOf(html, seeded.productName)
    expect(rows).toHaveLength(dates.length)

    // 1차의 줄 — 평가일 · 상품명 · 차수 · 배리어 · 워스트오브 · 예상 충족
    const first = rows.find((row) => row.includes(ymd(dates[0]!)))!
    expect(first).toContain(seeded.productName)
    expect(first).toContain(`href="${PATHS.product(seeded.productId)}"`) // §7.2의 전이
    expect(first).toContain('1차')
    expect(first).toContain(percent(percentToRatio(seeded.barriers[0]!)))
    expect(first).toContain(percent(seeded.worstOfRatio))

    /*
     * 판정은 **적용 차수에만** 붙는다(§4.4 「`conditionResult`는 적용 차수 한 행에만
     * 값이 있다」 — 이 케이스의 기대값이 그 규칙에 의존하므로 인용이 참이어야 한다.
     * P4.5까지 §4.4에 그 문장이 없었고 P4.5가 넣었다). 적용 차수는 「다음 도래 평가일」
     * 이므로 1차가 아니라 2차이며, 워스트오브 1.2 ≥ 2차 배리어 0.85이므로 조기상환
     * 추정이다. 어느 차수인지를 시각에 의존하지 않게 **적용 차수를 찾아서** 본다.
     */
    const applied = rows.find((row) => row.includes('예상'))
    expect(applied, '판정이 어느 줄에도 없다').toBeDefined()
    expect(applied).toContain(ymd(dates[1]!))
  })

  it('★ 상환하면 표식이 붙고, 「미상환만 보기」는 줄을 없앤다 — v1.8 `status`', async () => {
    /*
     * ★ **필터로 숨기는 것과 표시로 구분하는 것은 다른 일이다.** 이 케이스가 그
     * 차이를 두 주소의 응답으로 고정한다.
     *
     * ① 상환 후 기본 화면: 차수 행이 **그대로 남고** `상환완료` 표식이 붙는다.
     *    I-01은 상환일 이후의 일정 행을 지우지 않으므로 「다가오는 평가일」에 도래하지
     *    않을 날짜가 남는데, 표식이 없으면 미상환 차수와 구별되지 않는다.
     * ② `activeOnly=on`: 그 줄이 **사라진다.** 사라진 것과 상환된 것을 구분할 수
     *    없으므로 필터는 표식을 대신하지 못한다.
     *
     * 상환할 상품을 이 케이스가 직접 만든다 — 다른 케이스가 쓰는 상품을 상환하면
     * 실행 순서가 결과를 정한다.
     */
    const doomed = await registerProduct(jar, { label: '일정상환' })
    const redeemPath = PATHS.productRedeem(doomed.productId)

    const form = await (await get(redeemPath, jar)).text()
    const actionId = actionIdOf('redemptionFormAction')
    const overrides: Record<string, string> = {
      redemptionType: 'MATURITY_GAIN',
      roundNo: '',
      redemptionDate: `${doomed.issueDate.slice(0, 4)}-07-02`,
      grossAmount: '104,000,000',
      taxableIncome: '4,000,000',
      withholdingTax: '',
      isConfirmed: 'on',
      note: '일정 화면 확인',
    }
    const saved = await submitAction(redeemPath, jar, [
      ...formValuesFor(form, actionId).filter(([name]) => !(name in overrides)),
      ...Object.entries(overrides),
    ])
    expect([302, 303], '상환이 리다이렉트로 끝나지 않았다').toContain(saved.status)

    // ① 기본 화면 — 줄이 남고 표식이 붙는다
    const all = await (await get(PATHS.schedule, jar)).text()
    const rows = rowsOf(all, doomed.productName)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row, '상환완료 표식이 없다').toContain(STATUS_LABELS.REDEEMED)
    }
    /*
     * 상환 후에도 **미래 차수가 남는다** — 이 필드가 생긴 이유가 그것이다.
     * 표식이 없다면 이 줄은 미상환 상품의 다가오는 평가일과 같은 모습이다.
     */
    const upcomingDates = evaluationDatesOf(doomed).slice(1)
    const upcoming = sectionOf(all, 'upcoming')
    expect(rowsOf(upcoming, doomed.productName).length).toBe(upcomingDates.length)

    // ② 미상환만 보기 — 줄이 사라진다
    const active = await (
      await get(`${PATHS.schedule}?${SCHEDULE_KEYS.activeOnly}=on`, jar)
    ).text()
    expect(rowsOf(active, doomed.productName)).toEqual([])
    // 다른 상품(미상환)은 남아 있다 — 필터가 전부를 지운 것이 아니다
    expect(rowsOf(active, seeded.productName).length).toBe(dates.length)
  })

  it('기간을 좁히면 그 절만 남는다', async () => {
    const upcomingOnly = await (
      await get(`${PATHS.schedule}?${SCHEDULE_KEYS.range}=UPCOMING`, jar)
    ).text()
    expect(hasSection(upcomingOnly, UPCOMING_SECTION)).toBe(true)
    // 지난 절이 아예 렌더되지 않는다 — 빈 절을 「없다」로 표시하지 않는다.
    expect(hasSection(upcomingOnly, PAST_SECTION)).toBe(false)
    expect(rowsOf(upcomingOnly, seeded.productName)).toHaveLength(dates.length - 1)

    const pastOnly = await (
      await get(`${PATHS.schedule}?${SCHEDULE_KEYS.range}=PAST`, jar)
    ).text()
    expect(hasSection(pastOnly, PAST_SECTION)).toBe(true)
    /*
     * ★ **「다가오는 평가일이 없다」를 여기서 말하지 않는다.** 사용자가 미래를 빼기로
     * 했는데 없다고 알리면 필터가 결함으로 읽힌다 — 그 문구는 §6의 「예정 평가일
     * 없음」(전 차수 경과 상태)을 위한 것이고 조건이 다르다.
     */
    expect(hasSection(pastOnly, UPCOMING_SECTION)).toBe(false)
    expect(rowsOf(pastOnly, seeded.productName)).toHaveLength(1)
  })

  it('★ `PAST`가 기준일 당일을 지난 절에 넣지 않는다', async () => {
    /*
     * ★ 계약의 `to`는 포함이므로 `range=PAST`의 질의는 **당일 차수까지 실어 온다.**
     * 그것을 거르는 것은 `splitByPast`이고, 그러지 않으면 「오늘 평가되는 차수」가
     * 이미 지난 일로 보인다.
     *
     * 당일 평가일을 가진 상품을 만들 수는 없으므로(발행일 + n×주기로 생성된다) 여기서
     * 고정하는 것은 **지난 절에 미래 차수가 섞이지 않는다**는 약한 형태다. 경계 자체는
     * 상시 스위트가 본다(`tests/app/schedule.test.ts`의 당일 케이스).
     */
    const pastOnly = await (
      await get(`${PATHS.schedule}?${SCHEDULE_KEYS.range}=PAST`, jar)
    ).text()
    const rows = rowsOf(pastOnly, seeded.productName)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain(ymd(dates[0]!))
  })

  it('빈 상태 두 갈래를 구분한다 — 실재하지 않는 소유자로 좁힌다', async () => {
    const html = await (
      await get(`${PATHS.schedule}?${SCHEDULE_KEYS.ownerId}=${GHOST_OWNER}`, jar)
    ).text()

    expect(html).toContain(EMPTY_NARROWED)
    expect(html).not.toContain(EMPTY_TOTAL)
    // ST-02 — 좁힌 쪽의 다음 행동은 필터 해제이고 등록이 아니다.
    expect(html).toContain('필터 초기화')
  })

  it('조작된 주소가 오류가 되지 않는다', async () => {
    const res = await get(
      `${PATHS.schedule}?range=YESTERDAY&ownerId=zzz&activeOnly=`,
      jar,
    )
    expect(res.status).toBe(200)
    const html = await res.text()
    // 좁혀지지 않았으므로 「조건에 맞는 평가일 없음」이 나올 수 없다.
    expect(html).not.toContain(EMPTY_NARROWED)
    expect(hasSection(html, UPCOMING_SECTION)).toBe(true)
  })
})
