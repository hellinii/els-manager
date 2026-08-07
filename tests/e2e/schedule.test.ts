import { beforeAll, describe, expect, it } from 'vitest'

import {
  EVALUATION_DATE_OFFSET_DAYS,
  generateEvaluationDates,
} from '@/lib/domain'
import { STATUS_LABELS, korMonth, percent, priceDisplay, ymd } from '@/lib/format'
import { percentToRatio } from '@/lib/forms/parse'
import { OWNER_ALL, SCHEDULE_KEYS } from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

import { actionIdOf, formValuesFor, submitAction } from './helpers/actions'
import { authenticatedJar } from './helpers/auth'
import { registerProduct, type RegisteredProduct } from './helpers/register'
import { cookieJar, get } from './helpers/server'
import { E2E_EMPTY } from './helpers/users'

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
 * ~~다만 목록은 **전역**이다(모든 SELECT 정책이 `using (true)`).~~ 그래서 단언은 문서
 * 전체가 아니라 **내 상품의 줄**을 잘라 본다 — 다른 상품의 값에 우연히 맞는 단언을
 * 만들지 않는다(컷 4a의 「기초자산 1」, 컷 5의 「상환 실적」과 같은 함정).
 *
 * ★ **v2.6에서 앞 절반이 정확하지 않게 됐다.** 계약과 정책은 여전히 전역이지만
 * (RLS는 한 줄도 바뀌지 않았다) **화면의 기본 소유자 축이 「본인」**이므로 맨 주소는
 * 내 것만 낸다. 전역 목록은 `ownerId=ALL`을 고른 주소에서만 나온다. 줄을 잘라 보는
 * 규율은 그대로 유지한다 — 「전체」 주소를 쓰는 단언이 여전히 있고, 무엇보다 그
 * 규율은 소유자 축과 무관한 이유(우연한 일치)로 서 있다.
 */

/** 존재할 수 없는 소유자. 어떤 DB 상태에서도 이 필터의 결과는 0건이다. */
const GHOST_OWNER = '00000000-0000-4000-8000-0000000000ff'

/**
 * ★ **이 describe의 단언은 전부 «시간순 보기»의 것이다** (P6 컷 6).
 *
 * 컷 6이 기본 보기를 「상품별」로 바꿨으므로 맨 주소는 카드 목록을 낸다. 이 파일의
 * 아래 단언들은 절 머리글·월 그룹·`<li>` 세기에 기대므로 그 형태를 요구한다 —
 * **한 글자도 고치지 않고 주소에만 축을 붙였다.** 그 자체가 「시간순 경로가
 * 손상되지 않았다」의 증명이다: 마크업이 바뀌었다면 어느 단언인가는 죽는다.
 *
 * `rowsOf`가 **페이지 전체의 `<li>`**를 세는 것이 두 보기를 동시에 렌더하면 안
 * 되는 실측 근거이기도 하다(DOC-008 §5) — 카드도 `<li>`이고 차수 행도 `<li>`다.
 */
const TIMELINE = `${PATHS.schedule}?${SCHEDULE_KEYS.view}=TIME`

const timeline = (query = ''): string => (query === '' ? TIMELINE : `${TIMELINE}&${query}`)

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
    const res = await get(timeline(), jar)
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
    const html = await (await get(timeline(), jar)).text()
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
    /*
     * ## ★★ 보는 쪽이 «일정이 없는 사용자»다 — 전제를 이 파일이 만든다
     *
     * `jar`로 보면 선택지의 「다른 소유자」가 **다른 파일이 무엇을 먼저 만들었는지**에
     * 달린다. `db:reset` 직후에는 0이었다(실측). 방향을 뒤집으면 전제가 구조가 된다:
     * 이 describe의 `beforeAll`이 `jar`의 상품을 **반드시** 만들었으므로, 자기 일정이
     * 0인 사용자에게는 다른 소유자가 **적어도 하나** 실재한다.
     *
     * 선택지는 좁히지 않은 목록에서 나오므로 어느 주소에서 읽어도 같지만, 아래에서
     * 「그 값으로 좁히면 그 사람 것이 남는다」를 확인하려면 대상이 보이는 주소가
     * 편하다 — `ownerId=ALL`에서 읽는다.
     */
    const empty = await authenticatedJar(E2E_EMPTY)
    const html = await (
      await get(timeline(`${SCHEDULE_KEYS.owner}=${OWNER_ALL}`), empty)
    ).text()
    const select = /<select name="ownerId"[\s\S]*?<\/select>/.exec(html)?.[0]
    expect(select, '소유자 선택 상자가 없다').toBeDefined()

    const values = [...select!.matchAll(/value="([^"]*)"/g)].map((m) => m[1]!)

    /*
     * ★ 선택지의 «모양»이 v2.6에서 바뀌었다 — 값이 셋이다.
     *
     * 빈 값 = 「내 일정」(기본) · `ALL` = 「전체」 · 나머지 = 다른 소유자의 UUID.
     * **보는 사람 자신은 없다** — 기본 항목이 이미 그 사람이므로 두면 같은 뜻의
     * 항목이 둘이 된다(`page.tsx`의 `ownersOf`가 뺀다).
     */
    expect(values.filter((v) => v === '')).toHaveLength(1)
    expect(values.filter((v) => v === OWNER_ALL)).toHaveLength(1)

    const others = values.filter((v) => v !== '' && v !== OWNER_ALL)
    /*
     * 이 단언이 아래 셋을 «항진명제가 아니게» 만든다. `others`가 0이면 「남으로
     * 좁히면 내 것이 사라진다」가 한 번도 실행되지 않는데 초록이다 — 픽스처가
     * 다른 소유자를 실제로 만들고 있는지를 먼저 못박는다.
     */
    expect(others.length, '다른 소유자 선택지가 없다 — 픽스처를 확인한다').toBeGreaterThan(0)
    // 값이 UUID다 — 이름이 실려 있으면 계약이 `22P02`로 죽는다(형식 가드가 버린다).
    for (const value of others) {
      expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    }

    /*
     * ★★ 그 값들 중 **정확히 하나**가 `beforeAll`이 만든 상품을 남긴다. 이 왕복이
     * 「`ownerId`를 렌더만 하고 필터로 쓰지 못하는 구현」을 죽인다 — 이름을 값으로
     * 실어 보내면 계약이 `22P02`로 죽고 어느 값도 그 상품을 남기지 못한다.
     */
    const kept: string[] = []
    for (const value of others) {
      const filtered = await (
        await get(timeline(`${SCHEDULE_KEYS.owner}=${value}`), empty)
      ).text()
      if (rowsOf(filtered, seeded.productName).length > 0) kept.push(value)
    }
    expect(kept).toHaveLength(1)
  })

  it('★ 기본 화면이 남의 일정을 «섞지 않는다» — v2.6의 요구 그 자체다', async () => {
    /*
     * 이 케이스가 없으면 소유자 기본값이 되돌아가도 스위트가 초록이다. 위 케이스는
     * 「고른 값이 필터로 동작하는가」를 보고, 이것은 **아무것도 고르지 않았을 때
     * 무엇이 보이는가**를 본다 — 서로 다른 명제다.
     *
     * ★ 보는 쪽이 **일정이 없는 사용자**인 것이 요점이다. `jar`로 「전체가 본인보다
     * 많다」를 재면 `db:reset` 직후 다른 소유자가 없어 두 값이 같고(실측 3 = 3),
     * 결과가 **다른 파일의 실행 순서에 달린다.** 이 방향에서는 전제(`jar`의 상품)를
     * 이 describe의 `beforeAll`이 **반드시** 만든다.
     */
    const empty = await authenticatedJar(E2E_EMPTY)

    const mine = await (await get(timeline(), empty)).text()
    const all = await (
      await get(timeline(`${SCHEDULE_KEYS.owner}=${OWNER_ALL}`), empty)
    ).text()

    expect(rowsOf(mine, seeded.productName)).toHaveLength(0)
    expect(rowsOf(all, seeded.productName).length).toBeGreaterThan(0)

    // 그리고 그 사용자에게는 빈 상태 «둘째»가 뜬다 — 다음 행동이 전체 보기다.
    expect(mine).toContain('내 평가일정이 없다')
    expect(mine).not.toContain(EMPTY_TOTAL)
    expect(mine).not.toContain(EMPTY_NARROWED)
    expect(mine).toContain('전체 보기')
  })

  it('★ 두 절이 갈리고 차수가 자기 절에 들어간다', async () => {
    /*
     * ★ **구획은 계약이 준 `isPast`로 나뉜다.** 이 상품은 올해 1월 발행 + 6개월
     * 주기이므로 1차는 경과이고 2·3차는 미래다 — 즉 한 상품이 두 절에 나뉘어
     * 나타난다. 날짜를 손으로 적지 않고 앱이 쓴 함수로 파생시킨다.
     */
    const html = await (await get(timeline(), jar)).text()

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
    const html = await (await get(timeline(), jar)).text()
    for (const date of dates) {
      expect(html, `${date}의 월 머리글`).toContain(korMonth(date))
    }
  })

  it('DOC-008 §5의 항목 표시 여섯이 한 줄에 있다', async () => {
    const html = visible(await (await get(timeline(), jar)).text())
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
    const all = await (await get(timeline(), jar)).text()
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
      await get(timeline(`${SCHEDULE_KEYS.activeOnly}=on`), jar)
    ).text()
    expect(rowsOf(active, doomed.productName)).toEqual([])
    // 다른 상품(미상환)은 남아 있다 — 필터가 전부를 지운 것이 아니다
    expect(rowsOf(active, seeded.productName).length).toBe(dates.length)
  })

  it('기간을 좁히면 그 절만 남는다', async () => {
    const upcomingOnly = await (
      await get(timeline(`${SCHEDULE_KEYS.range}=UPCOMING`), jar)
    ).text()
    expect(hasSection(upcomingOnly, UPCOMING_SECTION)).toBe(true)
    // 지난 절이 아예 렌더되지 않는다 — 빈 절을 「없다」로 표시하지 않는다.
    expect(hasSection(upcomingOnly, PAST_SECTION)).toBe(false)
    expect(rowsOf(upcomingOnly, seeded.productName)).toHaveLength(dates.length - 1)

    const pastOnly = await (
      await get(timeline(`${SCHEDULE_KEYS.range}=PAST`), jar)
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
      await get(timeline(`${SCHEDULE_KEYS.range}=PAST`), jar)
    ).text()
    const rows = rowsOf(pastOnly, seeded.productName)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain(ymd(dates[0]!))
  })

  it('빈 상태 두 갈래를 구분한다 — 실재하지 않는 소유자로 좁힌다', async () => {
    const html = await (
      await get(timeline(`${SCHEDULE_KEYS.owner}=${GHOST_OWNER}`), jar)
    ).text()

    expect(html).toContain(EMPTY_NARROWED)
    expect(html).not.toContain(EMPTY_TOTAL)
    // ST-02 — 좁힌 쪽의 다음 행동은 필터 해제이고 등록이 아니다.
    expect(html).toContain('필터 초기화')
  })

  it('조작된 주소가 오류가 되지 않는다', async () => {
    const res = await get(
      timeline('range=YESTERDAY&ownerId=zzz&activeOnly='),
      jar,
    )
    expect(res.status).toBe(200)
    const html = await res.text()
    // 좁혀지지 않았으므로 「조건에 맞는 평가일 없음」이 나올 수 없다.
    expect(html).not.toContain(EMPTY_NARROWED)
    expect(hasSection(html, UPCOMING_SECTION)).toBe(true)
  })
})

/**
 * SCR-301 상품별 보기 — P6 컷 6
 *
 * ## 위 describe와 «같은 데이터, 다른 주소»다
 *
 * 그래서 이 파일이 「보기 전환이 마크업만 바꾼다」를 통째로 증명한다 — 위쪽은
 * `view=TIME`을 붙이고 단언을 한 글자도 바꾸지 않았고, 여기는 맨 주소를 읽는다.
 *
 * ## 여기서만 확인할 수 있는 것 넷
 *
 * | 무엇을 | 왜 여기인가 |
 * |---|---|
 * | 기본 보기가 상품별이다 | 기본값은 파서에 있으나 **그 값이 화면을 고르는가**는 렌더를 지나야 안다 |
 * | 접힘이 «제거»가 아니다 | 지난 날짜가 DOM에 남아 있다는 것은 HTML 문자열로만 보인다 |
 * | 전환·제출이 축을 잃지 않는다 | 링크의 `href`와 폼의 히든 칸은 두 요청의 왕복으로만 확인된다 |
 * | 세후 = 세전 − 원천징수 | 계약 → 매퍼 → 세율 왕복 → 포매터 → HTML **전 사슬**이 여기서만 한 번에 지나간다 |
 */
describe('SCR-301 상품별 보기', () => {
  let jar: ReturnType<typeof cookieJar>
  /** 원금을 작게 잡는다 — 금액을 손으로 검산하기 위해서다(`registerProduct`의 각주) */
  let seeded: RegisteredProduct
  let dates: string[]

  const PRINCIPAL = 100_000_000

  beforeAll(async () => {
    jar = await authenticatedJar()
    seeded = await registerProduct(jar, { label: '상품별', principal: '100,000,000' })
    dates = evaluationDatesOf(seeded)
  })

  /**
   * 그 상품의 카드를 자른다 — 카드 제목이 `<h2>`인 것이 이 함수의 전제다.
   *
   * 절 자르기(`sectionOf`)와 같은 기법이며 같은 함정을 피한다: 끝을 문서의 끝이
   * 아니라 **RSC 페이로드 앞**으로 둔다(그 뒤에 같은 목록이 한 번 더 실린다).
   */
  function cardOf(html: string, productName: string): string {
    /*
     * ★ **정규식을 쓰지 않는다** — 상품명이 `[E2E] 상품…`이고 `[`·`]`가 메타문자다.
     * 실측으로 걸렸다: `new RegExp(name)`이 문자 클래스로 해석되어 다섯 케이스가
     * 빈 문자열을 잘라 왔다. `headingAt`이 무사한 것은 그쪽 인자가 고정 한글
     * 문자열이기 때문이며, **그 안전이 이 함수로 전이되지 않는다.**
     */
    const nameAt = html.indexOf(productName)
    if (nameAt < 0) return ''
    const at = html.lastIndexOf('<h2', nameAt)
    if (at < 0) return ''
    const nextHeading = html.indexOf('<h2', at + 3)
    const script = html.indexOf('<script>self.__next_f', at)
    const ends = [nextHeading, script].filter((i) => i >= 0)
    return ends.length === 0 ? html.slice(at) : html.slice(at, Math.min(...ends))
  }

  it('기본 주소가 상품별이다 — 절 머리글이 없다', async () => {
    /*
     * ★ **음성 대조가 이 케이스의 절반이다.** 카드가 있다는 단언만 두면 기본이
     * 시간순으로 되돌아가도(두 보기가 동시에 렌더되면) 초록으로 남는다. 절
     * 머리글의 부재가 「대체했다」를 말하며, 그것이 §9 SQ-02가 캘린더를 버린
     * 근거를 이 보기가 피하는 조건이다(DOC-008 §5).
     */
    const res = await get(PATHS.schedule, jar)
    expect(res.status).toBe(200)
    const html = await res.text()

    expect(html).toContain(seeded.productName)
    expect(hasSection(html, PAST_SECTION)).toBe(false)
    expect(hasSection(html, UPCOMING_SECTION)).toBe(false)
    // 같은 요청에서 시간순은 살아 있다 — 대체이지 삭제가 아니다
    const timelineHtml = await (await get(timeline(), jar)).text()
    expect(hasSection(timelineHtml, UPCOMING_SECTION)).toBe(true)
  })

  it('한 카드가 그 상품의 차수를 전부 담는다', async () => {
    const html = visible(await (await get(PATHS.schedule, jar)).text())
    const card = cardOf(html, seeded.productName)

    expect(card, '카드를 찾지 못했다').not.toBe('')
    // 1차는 경과(접힘 안), 2·3차는 미래 — 셋 다 카드 안에 있다
    for (const date of dates) expect(card).toContain(ymd(date))
    for (const round of ['1차', '2차', '3차']) expect(card).toContain(round)
    // 카드 머리의 상품 단위 값 둘
    expect(card).toContain('투자원금')
    expect(card).toContain('연쿠폰')
    expect(card).toContain(percent(percentToRatio('8')))
  })

  it('★ 카드 머리가 기초자산과 KI를 적는다 — DOC-008 §5 ⑨⑩', async () => {
    /*
     * ★ P6 컷 7. 이 화면은 「언제 오는가」에는 답하면서 **「무엇에 걸려 있는가」에는
     * 답하지 않았다** — ⑤가 워스트오브 하나를 적을 뿐이어서 그 숫자를 만든 자산도
     * KI가 어디 있는지도 SCR-202를 열어야 나왔다.
     *
     * **표기가 SCR-201과 같다는 것이 이 항목의 조건이다**(§5) — 같은 순수 함수와 같은
     * 컴포넌트를 지나므로, 두 화면 중 한쪽만 바뀌면 `products.test.ts`의 짝 단언과
     * 여기가 함께 빨간불이 된다.
     */
    const html = visible(await (await get(PATHS.schedule, jar)).text())
    const card = cardOf(html, seeded.productName)

    expect(card).toContain('기초자산')
    expect(card).toContain(seeded.assetName)
    // 기준가 → 현재가. 둘 다 18자리이므로 서로 구별된다(AQ-30의 값 경로)
    expect(card).toContain(priceDisplay(seeded.basePrice))
    expect(card).toContain(priceDisplay(seeded.currentPrice))
    expect(card).toContain('> → <')
    // KI — 배리어와 관찰방식은 함께 온다(I-11의 짝)
    expect(card).toContain(`>${percent(percentToRatio('50'))} 종가<`)
  })

  it('★ 지난 차수는 접히되 «제거되지 않는다»', async () => {
    /*
     * DOC-008 §5가 「접힌 것과 필터로 빠진 것은 다르다」로 P4 컷 7의 구획 결정을
     * 유지한 자리다. 그 차이는 **HTML에 남아 있는가**로만 관측된다 — 화면에서는
     * 둘 다 보이지 않기 때문이다.
     */
    const html = visible(await (await get(PATHS.schedule, jar)).text())
    const card = cardOf(html, seeded.productName)

    expect(card).toContain('지난 차수 1건')
    // 다가오는 차수가 있으므로 «닫혀» 있다
    expect(card).toMatch(/<details(?![^>]*\bopen\b)[^>]*>/)
    // 그런데 그 날짜는 DOM에 있다
    expect(card).toContain(ymd(dates[0]!))
  })

  it('다가오는 차수만 남기면 접기 자체가 사라진다', async () => {
    const html = visible(
      await (
        await get(`${PATHS.schedule}?${SCHEDULE_KEYS.range}=UPCOMING`, jar)
      ).text(),
    )
    const card = cardOf(html, seeded.productName)

    expect(card).not.toContain('지난 차수')
    expect(card).toContain(ymd(dates[1]!))
    // 기간 필터가 3차수 중 2차수만 남겼다 — 카드가 그 사실을 적는다
    expect(card).toContain('전체 3차수 중 2차수')
  })

  it('지난 차수만 남기면 «열린 채» 렌더된다', async () => {
    /*
     * 다가오는 차수가 없으면 펼친다 — 접으면 카드가 비어 보이고 그 상품이 화면에서
     * 사라진 것처럼 읽힌다. 열림이 **데이터**에 의존하고 폭에 의존하지 않는 것이
     * 규약이며(§8), 그래서 서버 HTML에 그대로 나타난다.
     */
    const html = visible(
      await (await get(`${PATHS.schedule}?${SCHEDULE_KEYS.range}=PAST`, jar)).text(),
    )
    const card = cardOf(html, seeded.productName)

    expect(card).toContain('지난 차수 1건')
    expect(card).toMatch(/<details[^>]*\bopen\b/)
  })

  it('★ 세후 = 세전 − 원천징수를 화면의 숫자로 검산한다', async () => {
    /*
     * 계약 → 매퍼 → **세율 왕복** → 포매터 → HTML의 전 사슬이 여기서만 한 번에
     * 지나간다. 상시 스위트는 픽스처 상수를 주입하므로 「DB의 세율이 실제로
     * 쓰이는가」를 보지 못한다.
     *
     * P = 100,000,000 · r = 8% · m = 6이므로 1차 세전 104,000,000이고 과세
     * 금융소득 4,000,000에 15.4%를 적용해 세후 103,384,000이다(DOC-007 §4.5).
     */
    const html = visible(await (await get(PATHS.schedule, jar)).text())
    const card = cardOf(html, seeded.productName)

    const won = (n: number) => n.toLocaleString('en-US')
    const gross = PRINCIPAL * 1.04
    const withheld = (gross - PRINCIPAL) * 0.154

    expect(card).toContain(won(gross)) // 104,000,000
    expect(card).toContain(won(gross - withheld)) // 103,384,000
    expect(card).toContain(`+${won(gross - PRINCIPAL)}`) // +4,000,000
    // 각주가 세율을 «계약이 준 값으로» 렌더한다 — 절대 규칙 #5
    expect(html).toContain('15.4% 분리과세 기준')
  })

  it('★ 보기 전환 링크가 현재 필터를 싣고, 그 주소가 왕복한다', async () => {
    const narrowed = `${PATHS.schedule}?${SCHEDULE_KEYS.range}=UPCOMING`
    const html = await (await get(narrowed, jar)).text()

    // 시간순으로 가는 링크가 `range`를 잃지 않는다
    const href = /href="(\/schedule\?[^"]*view=TIME[^"]*)"/.exec(html)?.[1]
    expect(href, '보기 전환 링크가 없다').toBeDefined()
    expect(href).toContain('range=UPCOMING')

    // 그 주소를 다시 열면 시간순이고 필터가 살아 있다
    const back = await (await get(href!.replace(/&amp;/g, '&'), jar)).text()
    expect(hasSection(back, UPCOMING_SECTION)).toBe(true)
    expect(hasSection(back, PAST_SECTION)).toBe(false)
    expect(back).toContain(seeded.productName)
  })

  it('★ 필터 폼이 보기를 히든으로 나른다 — 기본값은 싣지 않는다', async () => {
    /*
     * 칸이 없으면 필터를 적용하는 순간 보기가 **조용히 기본값으로 되돌아간다.**
     * SCR-201의 `page`와 정반대 방향이고(그쪽은 지워져야 한다) 그 대비가 DOC-008
     * §7의 각주다.
     */
    const timelineHtml = await (await get(timeline(), jar)).text()
    expect(timelineHtml).toMatch(
      /<input[^>]*type="hidden"[^>]*name="view"[^>]*value="TIME"/,
    )

    const defaultHtml = await (await get(PATHS.schedule, jar)).text()
    expect(defaultHtml).not.toMatch(/<input[^>]*name="view"/)
  })

  it('보기 전환이 주 네비게이션의 활성 표식을 쓰지 않는다', async () => {
    /*
     * ★ `aria-current="page"`는 `tests/e2e/shell.test.ts`가 활성 탭을 세는 표식이다.
     * `ScopeSwitch`가 실측으로 이 함정에 걸렸다(홈의 활성 표식이 2건 → 3건).
     */
    const html = await (await get(PATHS.schedule, jar)).text()
    const nav = /<nav[^>]*aria-label="보기"[\s\S]*?<\/nav>/.exec(html)?.[0]

    expect(nav, '보기 전환이 없다').toBeDefined()
    expect(nav).toContain('aria-current="true"')
    expect(nav).not.toContain('aria-current="page"')
  })

  it('조작된 보기는 기본값으로 떨어진다', async () => {
    const res = await get(`${PATHS.schedule}?${SCHEDULE_KEYS.view}=CALENDAR`, jar)
    expect(res.status).toBe(200)

    const html = await res.text()
    expect(html).toContain(seeded.productName)
    // `range`·`sortBy`와 같은 규약이다 — 인식하지 못한 값은 버린다
    expect(hasSection(html, UPCOMING_SECTION)).toBe(false)
  })
})
