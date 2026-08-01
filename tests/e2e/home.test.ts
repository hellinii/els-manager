import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { today } from '@/lib/db/today'
import {
  dDay,
  EVALUATION_DATE_OFFSET_DAYS,
  generateEvaluationDates,
  shiftDays,
} from '@/lib/domain'
import {
  ATTENTION_REASON_LABELS,
  IMMINENT_DAYS,
  IMMINENT_LABEL,
  PRICE_MISSING_LABEL,
  REDEMPTION_TYPE_LABELS,
  amount,
  dDayLabel,
  percent,
  signedWon,
  won,
  ymd,
} from '@/lib/format'
import { DASHBOARD_KEYS, SCHEDULE_KEYS } from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

import { actionIdOf, formValuesFor, submitAction } from './helpers/actions'
import { authenticatedJar } from './helpers/auth'
import { destroySchedules, destroyUnderlyings } from './helpers/defects'
import {
  registerProduct,
  saveAssetPrice,
  type RegisteredProduct,
} from './helpers/register'
import { cookieJar, get } from './helpers/server'
import { DISPLAY_NAME, E2E_LIVE, E2E_PAST } from './helpers/users'
import { closeSeedConnection } from '../integration/helpers/seed'

/**
 * SCR-101 홈 — **Next를 지나야 존재하는 것들** (P4 컷 9)
 *
 * ## 이 파일이 여기서만 확인할 수 있는 것
 *
 * | 무엇을 | 왜 여기인가 |
 * |---|---|
 * | **결정 F가 화면에 도달한다** | `SCHEDULE_MISSING` + KI 하회가 두 뱃지로 함께 보이는지는 렌더된 문서에만 있다. 일정 0건 상품은 SCR-301에 행이 없고 ①에서도 빠지므로 **이 목록이 유일한 창구다** |
 * | `PRICE_MISSING`이 결함에서 안 나온다 | 같은 자리의 **음성** 단언이며, 사유의 부재는 뷰를 읽어서는 확인되지만 **그 줄에 없음**은 렌더가 있어야 한다 |
 * | 임박 표식이 실제 데이터에서 갈린다 | `isImminent`는 상시 스위트가 보지만, 경계가 **행마다** 적용되어 한 줄에는 붙고 다른 줄에는 붙지 않는지는 한 문서 안의 대조다 |
 * | v2.0의 `ownerName`이 표시된다 | 범위에 따라 나타나고 사라지는 값이므로 **두 주소의 응답을 비교**해야 한다 |
 * | ⑤가 자료원을 얻었다 | v1.9까지 이 요소는 DOC-008에만 있었다. 합계와 목록의 합이 같은지가 「창이 없다」의 형태다 |
 *
 * ## 전용 사용자 둘로 데이터를 전부 통제한다 (AQ-34)
 *
 * `scope = 'MINE'`의 집계는 그 소유자의 전 상품에서 나오므로, 다른 스위트의 상품이
 * 섞이면 「포함되어 있다」까지만 확인할 수 있다. `helpers/users.ts`의 두 전용 사용자는
 * 이 파일이 데이터를 전부 만들므로 **값으로** 단언한다 — 그리고 그 통제가
 * 「임박한 평가일이 없다」를 처음으로 렌더 가능하게 만든다.
 *
 * ## 시각에 의존하는 단언을 만들지 않는다
 *
 * 평가일은 `발행일 + n×주기`이므로 「임박」·「먼 평가일」을 고정 발행일로 만들면 그
 * 성질이 **오늘이 언제인지에 따라 바뀐다**(컷 7의 「적용 차수는 시각에 의존한다」와
 * 같은 함정). 그래서 발행일을 **기준일에서 거꾸로 계산**하고 앱이 저장에 쓴 함수로
 * 검산한다(`generateEvaluationDates`). 세금도 같은 이유로 비과세 계좌를 쓴다 —
 * 미상환 상품의 기여는 적용 차수의 귀속연도에 달렸고 그 연도가 시각에 의존한다.
 */

// ---------------------------------------------------------------------------
// 픽스처 — 원금은 손으로 검산할 수 있는 값이다
// ---------------------------------------------------------------------------

const P_IMMINENT = '20,000,000'
const P_FAR = '30,000,000'
const P_DEFECT = '40,000,000'
const P_REDEEMED = '50,000,000'
const P_OVERDUE = '60,000,000'

/** 상환 실적 둘 — 수령 − 원금이 각각 +4,000,000 / +1,000,000이고 합이 5,000,000 */
const GROSS = '54,000,000'
const TAXABLE = '4,000,000'
const P_REDEEMED_OLD = '70,000,000'
const GROSS_OLD = '71,000,000'
const TAXABLE_OLD = '1,000,000'

/** 워스트오브를 KI 배리어(50%) 아래로 내리는 시세. 기준가 대비 0.4다 */
const LOW_PRICE = '40000000000.000000'

const SECTIONS = {
  upcoming: '임박 평가일',
  totals: '총 자산 요약',
  attention: '주의 상태 상품',
  recent: '최근 상환 실적',
} as const

const EMPTY_UPCOMING = '임박한 평가일이 없다'
const EMPTY_MINE = '내 상품이 없다'
const EMPTY_ALL = '등록된 상품이 없다'

/**
 * React가 넣는 빈 주석을 지운다 — 인접한 텍스트와 표현식 사이에 경계가 생긴다.
 * `{item.roundNo}차`가 `1<!-- -->차`로 렌더되므로 `toContain('1차')`가 실패한다
 * (`schedule.test.ts`가 같은 것에 걸렸고 같은 함수를 둔다).
 */
function visible(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

/** 그 절만 잘라낸다 — 문서 전체에 대한 `toContain`은 다른 자리에 맞을 수 있다 */
function sectionOf(html: string, title: string): string {
  const at = html.search(new RegExp(`<h2[^>]*>${title}`))
  if (at < 0) return ''
  // 다음 `<h2`까지가 그 절이다. 문서 끝까지 자르면 뒤 절이 섞인다.
  const next = html.indexOf('<h2', at + 4)
  return next < 0 ? html.slice(at) : html.slice(at, next)
}

/** 절의 존재는 머리글로만 판정한다(빈 문자열을 반환하는 위 함수의 짝) */
function hasSection(html: string, title: string): boolean {
  return sectionOf(html, title) !== ''
}

/** 그 상품의 줄만 모아 온다 */
function rowsOf(html: string, productName: string): string[] {
  return [...html.matchAll(/<li\b[\s\S]*?<\/li>/g)]
    .map((m) => m[0])
    .filter((row) => row.includes(productName))
}

function rowOf(html: string, productName: string): string {
  const rows = rowsOf(html, productName)
  expect(rows, `${productName}의 줄이 없다`).toHaveLength(1)
  return rows[0]!
}

// ---------------------------------------------------------------------------
// 발행일을 기준일에서 거꾸로 만든다
// ---------------------------------------------------------------------------

// `shiftDays`는 `lib/domain`에서 온다 — 사본을 두면 앱과 갈릴 수 있고,
// 이 파일의 전제가 「앱이 저장할 때 쓴 함수와 같은 것으로 검산한다」다.

function monthsBefore(iso: string, months: number): string {
  const t = new Date(`${iso}T00:00:00Z`)
  t.setUTCMonth(t.getUTCMonth() - months)
  return t.toISOString().slice(0, 10)
}

/**
 * 첫 평가일이 `[min, max]`일 뒤에 오는 발행일 — **앱의 함수로 검산한다.**
 *
 * `발행일 + 6개월 = 목표일`의 역산이 정확히 성립하지 않을 수 있으므로(월말 보정)
 * 후보를 하루씩 밀며 `generateEvaluationDates`가 낸 첫 평가일의 D-Day를 본다.
 * 그 함수는 화면이 저장할 때 쓴 것과 같다 — 여기서 산술을 다시 쓰면 테스트가
 * 프로덕션 경로를 재구현하게 되고, 두 구현이 어긋나도 픽스처가 우연히 맞는다.
 */
function issueDateForFirstRound(
  asOf: string,
  window: { min: number; max: number },
): string {
  const base = monthsBefore(shiftDays(asOf, window.min), 6)
  for (let shift = 0; shift <= window.max - window.min; shift += 1) {
    const candidate = shiftDays(base, shift)
    const [first] = generateEvaluationDates({
      issueDate: candidate,
      evaluationPeriodMonths: 6,
      totalRounds: 3,
      offsetDays: EVALUATION_DATE_OFFSET_DAYS,
    })
    const d = dDay({ from: asOf, evaluationDate: first! })
    if (d >= window.min && d <= window.max) return candidate
  }
  throw new Error(
    `첫 평가일이 ${window.min}~${window.max}일 뒤에 오는 발행일을 찾지 못했다 (기준일 ${asOf}).`,
  )
}

function firstRoundOf(product: RegisteredProduct): string {
  return generateEvaluationDates({
    issueDate: product.issueDate,
    evaluationPeriodMonths: 6,
    totalRounds: product.barriers.length,
    offsetDays: EVALUATION_DATE_OFFSET_DAYS,
  })[0]!
}

// ---------------------------------------------------------------------------

describe('SCR-101 홈', () => {
  let live: ReturnType<typeof cookieJar>
  let past: ReturnType<typeof cookieJar>
  let asOf: string

  /** 임박(비과세) · 먼 평가일 + 기초자산 결함(비과세) · 일정 결함 + KI 하회 · 상환완료 */
  let imminent: RegisteredProduct
  let far: RegisteredProduct
  let defect: RegisteredProduct
  /**
   * 상환완료 **둘** — 정렬 방향을 확인할 수 있는 최소 개수다.
   *
   * ★ 하나로는 안 된다. `tests/integration/`에서 정렬을 뒤집는 음성 대조가 **초록**
   * 이었고 원인은 그 스위트의 상환이 1건이라는 것이었다 — 오름차순과 내림차순이 같은
   * 배열을 낸다(픽스처가 두 구현에서 일치하는 부류의 무효 대조). 여기서 날짜가 다른
   * 둘을 만들어 방향을 실제로 갈린 상태에서 본다.
   */
  let redeemed: RegisteredProduct
  let redeemedOld: RegisteredProduct
  /** 경과 사용자의 유일한 상품 — 전 차수가 경과했다 */
  let overdue: RegisteredProduct

  beforeAll(async () => {
    live = await authenticatedJar(E2E_LIVE)
    past = await authenticatedJar(E2E_PAST)
    // 앱과 같은 함수로 기준일을 얻는다 — 자정을 걸치지 않는 한 서버와 같은 값이다.
    asOf = today()

    // ── 실행 사용자 ──────────────────────────────────────────────────────
    // ① 임박 — 첫 평가일이 기준일 + 5~20일. 하한이 3 이상인 이유는 실행 중에
    //    그 날이 지나가지 않게 하려는 것이다.
    imminent = await registerProduct(live, {
      label: '홈임박',
      issueDate: issueDateForFirstRound(asOf, { min: 5, max: 20 }),
      principal: P_IMMINENT,
      // 미상환 상품의 과세 기여는 적용 차수의 귀속연도에 달렸다 — 비과세로 두면
      // ③의 단언이 시각에 의존하지 않는다(`accountType` 옵션의 각주).
      accountType: 'TAX_FREE',
    })

    // ② 먼 평가일 + 기초자산 결함 — 첫 평가일이 60~120일 뒤이므로 세 차수 전부
    //    미래이고, 그래서 `EVALUATION_PASSED`가 섞이지 않는다(시각 독립).
    far = await registerProduct(live, {
      label: '홈원거리',
      issueDate: issueDateForFirstRound(asOf, { min: 60, max: 120 }),
      principal: P_FAR,
      accountType: 'TAX_FREE',
    })
    await destroyUnderlyings(far.productId)

    // ③ 일정 결함 + KI 하회 — **결정 F의 관측 대상이다.** 시세를 낮춰 워스트오브를
    //    KI 배리어(50%) 아래로 옮긴 뒤 평가일정을 지운다. 차수 입력만 파괴되므로
    //    `worstOf`·`kiStatus`는 살아 있다(§4.2 입력 기준).
    defect = await registerProduct(live, { label: '홈결함', principal: P_DEFECT })
    await saveAssetPrice(live, defect.assetId, LOW_PRICE)
    await destroySchedules(defect.productId)

    // ④ 상환완료 둘 — ⑤와 ②의 실현손익, ③의 금융소득을 만든다. 상환일이 다르므로
    //    ⑤의 정렬 방향이 갈린다(위 `redeemedOld`의 각주).
    const twoYearsAgo = `${Number.parseInt(asOf.slice(0, 4), 10) - 2}-01-02`
    redeemedOld = await registerProduct(live, {
      label: '홈상환과거',
      issueDate: twoYearsAgo,
      principal: P_REDEEMED_OLD,
    })
    await redeem(live, redeemedOld, `${asOf.slice(0, 4)}-01-15`, {
      gross: GROSS_OLD,
      taxable: TAXABLE_OLD,
    })

    redeemed = await registerProduct(live, {
      label: '홈상환',
      issueDate: twoYearsAgo,
      principal: P_REDEEMED,
    })
    await redeem(live, redeemed, `${asOf.slice(0, 4)}-03-02`, {
      gross: GROSS,
      taxable: TAXABLE,
    })

    // ── 경과 사용자 ──────────────────────────────────────────────────────
    // 2년 전 발행 + 6개월 주기 3차수 → 마지막 평가일이 6개월 전이다(전 차수 경과).
    overdue = await registerProduct(past, {
      label: '홈경과',
      issueDate: `${Number.parseInt(asOf.slice(0, 4), 10) - 2}-01-02`,
      principal: P_OVERDUE,
    })
  })

  afterAll(async () => {
    await closeSeedConnection()
  })

  // -------------------------------------------------------------------------
  // 화면이 섰다 · SQ-03
  // -------------------------------------------------------------------------

  it('200으로 서고 기본 범위가 본인이다 — SQ-03', async () => {
    const res = await get(PATHS.home, live)
    expect(res.status).toBe(200)
    const html = await res.text()

    // 자리표시가 사라졌다 — 컷 9의 원장 이동이 화면에서 보이는 형태다.
    expect(html).not.toContain('아직 만들지 않은 화면이다')
    for (const title of Object.values(SECTIONS)) {
      expect(hasSection(html, title), `${title} 절이 없다`).toBe(true)
    }

    // 기본이 본인이므로 전환 링크의 「내 상품」이 현재 위치다.
    const nav = /<nav[^>]*aria-label="표시 범위"[\s\S]*?<\/nav>/.exec(html)?.[0]
    expect(nav, '범위 전환이 없다').toBeDefined()
    expect(nav).toMatch(/aria-current="true"[^>]*>내 상품/)
    // JS 없이 동작한다 — 링크이고 폼이 아니다.
    expect(nav).not.toContain('<form')
    expect(nav).toContain(`href="${PATHS.home}?${DASHBOARD_KEYS.scope}=ALL"`)
  })

  it('③이 두 범위 모두에서 「올해 금융소득(본인)」이다 — SQ-03', async () => {
    /*
     * ★ `scope='ALL'`이어도 세금은 합산하지 않으므로(D-02 · 절대 규칙 #7) 전체 보기는
     * **상단이 전원이고 세금이 본인인 화면**이 된다. 제목이 그 사실을 말하지 않으면
     * 사용자는 전체 보기의 금융소득을 가족 합계로 읽는다.
     */
    for (const url of [PATHS.home, `${PATHS.home}?${DASHBOARD_KEYS.scope}=ALL`]) {
      const html = visible(await (await get(url, live)).text())
      expect(html, url).toContain('올해 금융소득(본인)')
    }
  })

  // -------------------------------------------------------------------------
  // ④ 결정 F — 이 목록이 유일한 창구다
  // -------------------------------------------------------------------------

  it('★ 결함이 KI 하회를 가리지 않는다 — `SCHEDULE_MISSING` + `KI_BELOW`', async () => {
    /*
     * ★ **P3a.5 결정 F의 화면 실측이다.** 일정 0건 상품은 SCR-301에 행이 아예 없고
     * (§4.4의 루트가 차수다) ①의 임박 목록에서도 빠지므로(다음 평가일이 없다) 그
     * 상품의 KI 하회는 **이 목록에만** 나타난다. 결함으로 가리면 사용자 확인이 필요한
     * 유일한 상태(D-04)가 시스템 어디에서도 보이지 않는다.
     *
     * 순서까지 본다 — §4.1이 「결함 우선」으로 고정했고 화면은 그것을 다시 정하지
     * 않는다. 기대값을 손으로 적지 않고 **라벨 표를 색인한다**(문서 파싱 대조가 그
     * 표를 DOC-005 §6.1과 이미 묶고 있다).
     */
    const html = visible(await (await get(PATHS.home, live)).text())
    const attention = sectionOf(html, SECTIONS.attention)
    expect(attention, '조치 절을 자르지 못했다').not.toBe('')

    const row = rowOf(attention, defect.productName)
    const schedule = ATTENTION_REASON_LABELS.SCHEDULE_MISSING
    const kiBelow = ATTENTION_REASON_LABELS.KI_BELOW

    expect(row, '결함 사유가 없다').toContain(schedule)
    expect(row, 'KI 하회가 결함에 가려졌다').toContain(kiBelow)
    // 두 라벨이 서로 다르다 — 같으면 위 두 단언이 한 문자열에 대한 같은 말이 된다.
    expect(schedule).not.toBe(kiBelow)
    // 순서: 결함이 먼저다
    expect(row.indexOf(schedule)).toBeLessThan(row.indexOf(kiBelow))
  })

  it('★ 한 상품이 한 줄이다 — 사유가 둘이어도', async () => {
    // 접지 않으면 이 상품이 목록에 두 번 나타나고 사용자는 두 상품으로 읽는다.
    const html = visible(await (await get(PATHS.home, live)).text())
    expect(rowsOf(sectionOf(html, SECTIONS.attention), defect.productName)).toHaveLength(1)
  })

  it('★ `PRICE_MISSING`을 결함에서 내지 않는다 — 오지 않을 시세를 기다리게 하지 않는다', async () => {
    /*
     * ★ 기초자산 0건은 **시세 입력이 파괴된** 상태이므로 「시세 없음」은 영원히
     * 해소되지 않는 약속이 된다(DOC-007 §3.1 · ST-06). 판별은 결함 이름이 아니라
     * `destroyed`로 하며, 그 결정이 화면에 도달했는지는 **그 줄에 그 문구가 없음**으로만
     * 확인된다.
     *
     * 문서 전체가 아니라 그 줄을 본다 — 「시세 없음」은 다른 상품의 사유로도 나올 수
     * 있는 문구이고(진짜 E-01), 문서 전체에 대한 음성 단언은 그때 잘못된 이유로 깨진다.
     */
    const html = visible(await (await get(PATHS.home, live)).text())
    const row = rowOf(sectionOf(html, SECTIONS.attention), far.productName)

    expect(row).toContain(ATTENTION_REASON_LABELS.UNDERLYING_MISSING)
    expect(row, '결함 상품에 시세 없음이 붙었다').not.toContain(PRICE_MISSING_LABEL)
    // 사유가 정확히 하나다 — 세 차수 전부 미래이므로 `EVALUATION_PASSED`도 없다.
    expect(row).not.toContain(ATTENTION_REASON_LABELS.EVALUATION_PASSED)
  })

  it('조치 목록이 두 상품이다 — 정상 상품은 올라오지 않는다', async () => {
    const attention = sectionOf(
      visible(await (await get(PATHS.home, live)).text()),
      SECTIONS.attention,
    )
    // 임박 상품은 워스트오브 120%이고 KI 배리어 50%이므로 안전이고, 상환완료 상품은
    // E-05로 조치 대상이 아니다(§4.1이 결함만 남기고 나머지를 끊는다).
    expect(rowsOf(attention, imminent.productName)).toEqual([])
    expect(rowsOf(attention, redeemed.productName)).toEqual([])
    expect(rowsOf(attention, redeemedOld.productName)).toEqual([])
    expect(attention).toContain('2건')
  })

  // -------------------------------------------------------------------------
  // ① 임박 · 판정 없음
  // -------------------------------------------------------------------------

  it('★ 임박 표식이 행마다 갈린다 — 한 문서 안의 대조', async () => {
    /*
     * ★ 경계(30일)가 **행마다** 적용되는지는 한 문서 안에서 갈려야 확인된다. 전 행에
     * 붙는 구현도 하나도 안 붙는 구현도 상시 스위트를 통과하며, 그 둘의 차이가 여기다.
     *
     * D-Day 값은 두 행 모두에 있다 — 표식이 값을 **대신하지 않는다**는 것이
     * `IMMINENT_DAYS`가 근거가 약한 상수임을 감당하는 방식이다.
     */
    const html = visible(await (await get(PATHS.home, live)).text())
    const upcoming = sectionOf(html, SECTIONS.upcoming)
    expect(upcoming, '임박 절을 자르지 못했다').not.toBe('')

    const near = rowOf(upcoming, imminent.productName)
    const distant = rowOf(upcoming, far.productName)

    const nearDDay = dDay({ from: asOf, evaluationDate: firstRoundOf(imminent) })
    const farDDay = dDay({ from: asOf, evaluationDate: firstRoundOf(far) })
    expect(nearDDay).toBeLessThanOrEqual(IMMINENT_DAYS)
    expect(farDDay).toBeGreaterThan(IMMINENT_DAYS)

    expect(near).toContain(IMMINENT_LABEL)
    expect(distant, '먼 평가일에 임박 표식이 붙었다').not.toContain(IMMINENT_LABEL)

    // 두 행 모두 날짜와 D-Day를 그대로 담는다
    expect(near).toContain(ymd(firstRoundOf(imminent)))
    expect(near).toContain(dDayLabel(nearDDay))
    expect(distant).toContain(dDayLabel(farDDay))
  })

  it('가까운 것이 먼저다 — 계약이 준 순서를 다시 정하지 않는다', async () => {
    const upcoming = sectionOf(
      visible(await (await get(PATHS.home, live)).text()),
      SECTIONS.upcoming,
    )
    expect(upcoming.indexOf(imminent.productName)).toBeLessThan(
      upcoming.indexOf(far.productName),
    )
    // 두 건뿐이므로 자름이 없다 — 「N건 중 M건」이 아니라 「2건」이다.
    expect(upcoming).toContain('2건')
    expect(upcoming).not.toContain('중 ')
  })

  it('★ 판정할 수 없으면 「미충족」이라 말하지 않는다 — `willMeet = null`', async () => {
    /*
     * ★ 기초자산이 파괴된 상품은 워스트오브가 없으므로 충족 여부를 말할 수 없다.
     * `false`로 두면 「미충족」이라는 판정을 한 것이 되어 E-01과 구분되지 않는다 —
     * 계약이 세 값을 주는 이유이며 화면도 세 갈래로 받는다.
     */
    const upcoming = sectionOf(
      visible(await (await get(PATHS.home, live)).text()),
      SECTIONS.upcoming,
    )
    const distant = rowOf(upcoming, far.productName)

    expect(distant).toContain('판정 없음')
    expect(distant).not.toContain('예상 미충족')
    expect(distant).not.toContain('예상 충족')

    // 반대 방향 — 시세가 있는 행은 판정을 말한다(위 단언이 항진명제가 아니다).
    const near = rowOf(upcoming, imminent.productName)
    expect(near).toContain('예상 충족') // 워스트오브 120% ≥ 1차 배리어 90%
    expect(near).toContain(percent(imminent.worstOfRatio))
  })

  it('★ 임박한 평가일이 없으면 그 절에 문구가 남는다 — AQ-34', async () => {
    /*
     * ★ **전용 사용자가 없으면 만들 수 없던 상태다**(AQ-34). 이 사용자의 유일한
     * 상품은 전 차수가 경과했으므로(2년 전 발행 + 6개월 주기 3차수) `upcomingEvaluations`가
     * 빈 배열이다. 그때 다음 행동은 등록이 아니라 **상환 처리 또는 이월 확인**이며,
     * 나머지 요소는 그대로 렌더된다 — 이 표의 빈 상태가 아니다(DOC-008 §6 각주).
     */
    const html = visible(await (await get(PATHS.home, past)).text())

    expect(html).toContain(EMPTY_UPCOMING)
    // 화면 전체의 빈 상태가 아니다 — 상품이 있으므로 다른 절이 살아 있다.
    expect(html).not.toContain(EMPTY_MINE)
    expect(hasSection(html, SECTIONS.totals)).toBe(true)
    expect(html).toContain(amount(P_OVERDUE.replace(/,/g, '')))
    // 그 상품은 조치 목록에 있다 — 경과했기 때문이다
    expect(sectionOf(html, SECTIONS.attention)).toContain(
      ATTENTION_REASON_LABELS.EVALUATION_PASSED,
    )
  })

  // -------------------------------------------------------------------------
  // ② ③ ⑤ — 값으로 단언한다
  // -------------------------------------------------------------------------

  it('★ ②의 집계가 정확하다 — 전용 사용자의 데이터를 전부 통제한다', async () => {
    const totals = sectionOf(
      visible(await (await get(PATHS.home, live)).text()),
      SECTIONS.totals,
    )

    // 보유중 셋(임박·먼 평가일·결함). 상환완료 둘은 세지 않는다.
    expect(totals).toContain('3건')
    // 20,000,000 + 30,000,000 + 40,000,000
    expect(totals).toContain(amount('90000000'))
    // 실현손익 = (54,000,000 − 50,000,000) + (71,000,000 − 70,000,000).
    // **부호를 붙인다**(음수가 정상값이다)
    expect(totals).toContain(signedWon('5000000'))
  })

  it('★ ③의 금융소득이 상환 확정값 하나다 — 비과세 상품은 기여하지 않는다', async () => {
    /*
     * ★ 임박·먼 평가일 상품은 비과세 계좌이므로 확정값이 있어도 과세소득이 0이고
     * (DOC-007 §4.2), 일정 0건 상품은 적용 차수가 없어 기여하지 않으며(결함이라서가
     * 아니다 — §4.2 입력 기준), 상환완료 상품만 남는다. 그래서 이 값이 정확히 하나의
     * 확정값이며 **시각에 의존하지 않는다.**
     */
    const html = visible(await (await get(PATHS.home, live)).text())
    const tax = sectionOf(html, '올해 금융소득')
    expect(tax, '금융소득 절을 자르지 못했다').not.toBe('')

    // 상환 둘의 확정 과세소득 합 = 4,000,000 + 1,000,000
    expect(tax).toContain(won('5000000'))
    // 2천만원 이하이므로 분리과세로 종결되고 추가납부가 0이다(0이 정상이다)
    expect(tax).toContain('분리과세로 종결된다')
    expect(tax).not.toContain('종합과세 대상이다')
    expect(tax).toContain(won('0'))
    expect(tax).toContain(`${asOf.slice(0, 4)}년 귀속`)
  })

  it('★ ⑤가 상환 실적을 담고 합계와 어긋나지 않는다 — v2.0', async () => {
    /*
     * ★ **v1.9까지 이 요소는 DOC-008에만 있었다.** 계약에 자료원이 없었으므로 화면이
     * 만들 수 없었고, `totals.realizedPnl`은 합계라 「무엇이 상환되었는가」를 말하지
     * 못했다. 그 둘의 합이 같은 것이 **계약에 기간 창이 없다**는 사실의 형태다 —
     * 창을 넣으면 이 단언이 깨진다.
     */
    const html = visible(await (await get(PATHS.home, live)).text())
    const recent = sectionOf(html, SECTIONS.recent)
    expect(recent, '상환 실적 절을 자르지 못했다').not.toBe('')

    const row = rowOf(recent, redeemed.productName)
    expect(row).toContain(REDEMPTION_TYPE_LABELS.MATURITY_GAIN)
    expect(row).toContain(amount(GROSS.replace(/,/g, '')))
    expect(row).toContain(signedWon('4000000'))
    expect(row).toContain(`href="${PATHS.product(redeemed.productId)}"`)
    // 확정값으로 저장했으므로 「미확인」이 없다(ST-05의 반대 방향)
    expect(row).not.toContain('미확인')

    // 둘째 상환도 자기 값을 낸다 — 두 줄이 같은 값을 렌더하지 않는다
    const older = rowOf(recent, redeemedOld.productName)
    expect(older).toContain(signedWon('1000000'))
    expect(recent).toContain('2건')

    /*
     * **합계 = 목록의 합.** 상환이 둘이므로 이 단언은 1건일 때의 동일성이 아니다 —
     * ②가 5,000,000인데 두 줄이 4,000,000과 1,000,000이다. 창을 두면(예: 최근 1건만
     * 반환) 그 등식이 깨진다.
     */
    expect(sectionOf(html, SECTIONS.totals)).toContain(signedWon('5000000'))
  })

  it('★ ⑤가 상환일 내림차순이다 — 「최근」이 그 뜻이다', async () => {
    /*
     * ★ **정본 시나리오에서는 확인할 수 없는 성질이다.** `tests/integration/`의 상환이
     * 1건이므로 오름차순과 내림차순이 같은 배열을 낸다 — 정렬을 뒤집는 음성 대조가
     * 거기서 초록이었고(실측) 그것이 **픽스처가 두 구현에서 일치하는** 부류의 무효
     * 대조다. 전용 사용자에게 날짜가 다른 상환 둘이 있으므로 여기서 갈린다.
     */
    const recent = sectionOf(
      visible(await (await get(PATHS.home, live)).text()),
      SECTIONS.recent,
    )
    // 3월 상환이 1월 상환보다 위에 있다
    expect(recent.indexOf(redeemed.productName)).toBeLessThan(
      recent.indexOf(redeemedOld.productName),
    )
    expect(recent).toContain(ymd(`${asOf.slice(0, 4)}-03-02`))
    expect(recent).toContain(ymd(`${asOf.slice(0, 4)}-01-15`))
  })

  // -------------------------------------------------------------------------
  // 범위 — v2.0의 `ownerName`
  // -------------------------------------------------------------------------

  it('★ 전체 보기가 소유자를 적고 본인 보기는 적지 않는다 — v2.0 `ownerName`', async () => {
    /*
     * ★ ④의 조치는 전부 **소유자만 할 수 있는 일**이므로(ST-04) 전체 보기에서
     * 소유자를 적지 않으면 사용자는 자기가 할 수 없는 일이 목록에 있는 이유를 상세로
     * 들어가서야 안다. 같은 뷰의 `upcomingEvaluations`는 이미 그 값을 담고 있었으므로
     * **한 뷰 안에서 두 목록의 주어가 달랐다.**
     *
     * 두 주소를 비교한다 — 한쪽만 보면 「이름이 있다」와 「범위와 무관하게 늘 있다」가
     * 구분되지 않는다. ④는 자르지 않으므로 이 단언은 표시 건수에 의존하지 않는다.
     */
    const liveName = DISPLAY_NAME[E2E_LIVE]!

    const all = visible(
      await (await get(`${PATHS.home}?${DASHBOARD_KEYS.scope}=ALL`, past)).text(),
    )
    const allRow = rowOf(sectionOf(all, SECTIONS.attention), defect.productName)
    expect(allRow, '전체 보기에 소유자가 없다').toContain(liveName)

    const mine = visible(await (await get(PATHS.home, live)).text())
    const mineRow = rowOf(sectionOf(mine, SECTIONS.attention), defect.productName)
    expect(mineRow, '본인 보기에 소유자가 붙었다').not.toContain(liveName)
  })

  it('본인 보기가 남의 상품을 담지 않는다', async () => {
    const mine = visible(await (await get(PATHS.home, past)).text())
    expect(rowsOf(mine, defect.productName)).toEqual([])
    expect(rowsOf(mine, imminent.productName)).toEqual([])

    const all = visible(
      await (await get(`${PATHS.home}?${DASHBOARD_KEYS.scope}=ALL`, past)).text(),
    )
    expect(rowsOf(sectionOf(all, SECTIONS.attention), defect.productName)).toHaveLength(1)
  })

  it('조작된 범위가 오류가 되지 않고 본인 보기로 떨어진다', async () => {
    const res = await get(`${PATHS.home}?${DASHBOARD_KEYS.scope}=EVERYONE`, live)
    expect(res.status).toBe(200)
    const html = visible(await res.text())
    // 인식하지 못한 값은 버린다 — 그 결과가 기본값이고, 화면의 전환도 그 상태다.
    const nav = /<nav[^>]*aria-label="표시 범위"[\s\S]*?<\/nav>/.exec(html)?.[0]
    expect(nav).toMatch(/aria-current="true"[^>]*>내 상품/)
    expect(rowsOf(html, defect.productName)).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // SCR-301 — AQ-34의 다른 절반
  // -------------------------------------------------------------------------

  it('★ SCR-301의 셋째 빈 상태가 렌더된다 — AQ-34', async () => {
    /*
     * ★ **AQ-34가 등재한 바로 그 상태다.** 「좁힌 목록에 지난 차수가 있고 다가오는
     * 차수가 하나도 없다」이며, 그 조건은 한 소유자의 전 상품이 전 차수 경과여야
     * 성립한다. 전용 사용자로 소유자 축을 좁혀서 만든다 — 그때 다음 행동은 등록도
     * 필터 해제도 아니라 상환 처리·이월 확인이므로 문구가 따로 있어야 한다.
     */
    /*
     * ★ 주소에 `view=TIME`이 붙는다 (P6 컷 6). 아래 단언들은 **절 머리글과 `<li>`
     * 세기**에 기대므로 시간순 보기의 형태를 요구한다 — 컷 6이 기본을 상품별로
     * 바꿨으므로 맨 주소는 카드를 낸다(카드도 `<li>`이고 차수 행도 `<li>`이다).
     * **AQ-34가 관측하는 «상태»는 보기와 무관하다** — 아래 마지막 단언이 그것을
     * 상품별 주소에서 다시 확인한다.
     */
    const query = `${SCHEDULE_KEYS.ownerId}=${E2E_PAST}`
    const html = await (
      await get(`${PATHS.schedule}?${query}&${SCHEDULE_KEYS.view}=TIME`, past)
    ).text()

    expect(html).toContain('지난 평가일')
    expect(html).toContain('다가오는 평가일이 없다')
    // 빈 상태 둘 중 어느 것도 아니다 — 목록이 비지 않았다(지난 차수가 셋 있다).
    expect(html).not.toContain('조건에 맞는 평가일이 없다')
    expect(html).not.toContain('등록된 평가일정이 없다')
    expect(rowsOf(html, overdue.productName)).toHaveLength(overdue.barriers.length)

    /*
     * ★ **문구가 보기마다 갈리지 않는다** (DOC-008 §6). 자리만 다르다 — 시간순은
     * 「다가오는 평가일」 절의 자리이고 상품별은 카드 목록 위다. 한 상태에 두 문구를
     * 두면 사용자가 보기를 바꿀 때 **상태가 바뀐 것으로 읽는다.**
     */
    const byProduct = await (await get(`${PATHS.schedule}?${query}`, past)).text()
    expect(byProduct).toContain('다가오는 평가일이 없다')
    expect(byProduct).not.toContain('조건에 맞는 평가일이 없다')
  })

  // -------------------------------------------------------------------------
  // 빈 상태 — 범위가 가른다
  // -------------------------------------------------------------------------

  it('빈 상태가 범위에 따라 다른 것을 말한다', async () => {
    /*
     * `itg-b`는 이 스위트가 상품을 만들지 않는 사용자다. `tests/integration/`의
     * 픽스처가 남아 있으면 상품이 있으므로, **문구가 갈리는 것만** 본다 — 어느 쪽이
     * 나오는지는 앞선 스위트의 실행 여부에 달렸고 그것을 단언하면 순서가 데이터가 된다.
     *
     * 전체 보기에는 이 파일이 만든 상품이 있으므로 「등록된 상품이 없다」가 나올 수 없다.
     */
    const all = visible(
      await (await get(`${PATHS.home}?${DASHBOARD_KEYS.scope}=ALL`, live)).text(),
    )
    expect(all).not.toContain(EMPTY_ALL)
    expect(all).not.toContain(EMPTY_MINE)
  })
})

/**
 * 만기상환(이익)을 등록한다 — 화면의 상환 폼을 지난다.
 *
 * `withholdingTax`를 **비워 둔다**: §5.4가 미입력일 때만 산출하므로(4,000,000 × 0.154
 * = 616,000) 채우면 그 경로가 실행되지 않는다. 상환일은 올해로 둔다 — 시드 이전
 * 연도는 계약이 거부하고(§5.4), 귀속연도가 올해여야 ③의 단언이 성립한다.
 */
async function redeem(
  jar: ReturnType<typeof cookieJar>,
  product: RegisteredProduct,
  redemptionDate: string,
  amounts: { gross: string; taxable: string },
): Promise<void> {
  const path = PATHS.productRedeem(product.productId)
  const form = await (await get(path, jar)).text()
  const actionId = actionIdOf('redemptionFormAction')

  const overrides: Record<string, string> = {
    redemptionType: 'MATURITY_GAIN',
    // 만기상환은 차수를 갖지 않는다(V-13은 조기·리자드에만 요구한다)
    roundNo: '',
    redemptionDate,
    grossAmount: amounts.gross,
    taxableIncome: amounts.taxable,
    withholdingTax: '',
    isConfirmed: 'on',
    note: '홈 화면 확인',
  }

  const saved = await submitAction(path, jar, [
    ...formValuesFor(form, actionId).filter(([name]) => !(name in overrides)),
    ...Object.entries(overrides),
  ])
  if (saved.status !== 303 && saved.status !== 302) {
    throw new Error(`상환이 리다이렉트로 끝나지 않았다: ${saved.status}`)
  }
}
