import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { today } from '@/lib/db/today'
import {
  dDay,
  EVALUATION_DATE_OFFSET_DAYS,
  generateEvaluationDates,
} from '@/lib/domain'
import { GRADE_TEXT_CLASS } from '@/components/display/Badge'
import {
  ATTENTION_REASON_LABELS,
  EMPTY_STATES,
  EVALUATION_VERDICT_LABELS,
  GAP_TIER_GRADES,
  GAP_TIER_LABELS,
  PRICE_MISSING_LABEL,
  REDEMPTION_TYPE_LABELS,
  SCOPE_LABELS,
  SECTION_EMPTY,
  TAX_METHOD_VERDICT_LABELS,
  YEAR_TAX_TEXT,
  amount,
  barrierGap,
  dDayLabel,
  missingUpcomingNote,
  percent,
  signedWon,
  splitProductName,
  won,
  ymd,
} from '@/lib/format'
import { DASHBOARD_KEYS, SCHEDULE_KEYS } from '@/lib/forms/query'
import { PATHS, REDEEM_ROUND, TAX_PROFILE_SECTION } from '@/lib/routes/paths'

import { actionIdOf, formValuesFor, submitAction } from './helpers/actions'
import { authenticatedJar } from './helpers/auth'
import { destroySchedules, destroyUnderlyings } from './helpers/defects'
import {
  registerProduct,
  saveAssetPrice,
  type RegisteredProduct,
} from './helpers/register'
import { cookieJar, get } from './helpers/server'
import { DISPLAY_NAME, E2E_EMPTY, E2E_LIVE, E2E_PAST } from './helpers/users'
import { closeSeedConnection } from '../integration/helpers/seed'
import { issueDateForFirstRound } from './helpers/dates'

/**
 * SCR-101 홈 — **Next를 지나야 존재하는 것들** (P4 컷 9)
 *
 * ## 이 파일이 여기서만 확인할 수 있는 것
 *
 * | 무엇을 | 왜 여기인가 |
 * |---|---|
 * | **결정 F가 화면에 도달한다** | `SCHEDULE_MISSING` + KI 하회가 두 뱃지로 함께 보이는지는 렌더된 문서에만 있다. 일정 0건 상품은 SCR-301에 행이 없고 ①에서도 빠지므로 **이 목록이 유일한 창구다** |
 * | `PRICE_MISSING`이 결함에서 안 나온다 | 같은 자리의 **음성** 단언이며, 사유의 부재는 뷰를 읽어서는 확인되지만 **그 줄에 없음**은 렌더가 있어야 한다 |
 * | ~~임박 표식이 실제 데이터에서 갈린다~~ → ①의 행에 표식이 없고 날짜 · D-Day가 남는다 *(홈 피드백 컷 K4 · D2)* | 표식을 지운 것은 렌더된 문서에서만 보인다 — 상시 스위트에는 지운 상수의 부재밖에 없다 |
 * | 절 빈 상태가 한 줄이다 (K4) | 점선 상자의 부재와 h2의 존재는 마크업의 성질이다. 글자는 상시 스위트가 문서와 결속한다(`emptyState.test.ts`) |
 * | ①의 칸이 판정 없음 행에서도 남는다 · 상품명 끝의 회차가 따로 선다 · 링크 글자는 전체 이름이다 (K5) | 칸의 수와 노드의 경계는 마크업의 성질이다. 가르는 규칙은 상시 스위트가 본다(`productName.test.ts`). 정렬 자체(열이 맞는가)는 브라우저에만 있다 — 화면으로 확인한다 |
 * | ①의 판정 칸이 여유폭 단계다 — 근소 · 미충족 · 판정 없음, 숫자색은 단계를 따른다 (K6) | 함수(`gapTierOf`)가 화면에 닿았는지와 숫자 노드의 클래스는 렌더된 문서에만 있다. 경계(5%p · 리자드)와 색 표는 상시 스위트가 본다(`gapTier.test.ts` · `gradeColors.test.ts`) |
 * | v2.0의 `ownerName`이 표시된다 | 범위에 따라 나타나고 사라지는 값이므로 **두 주소의 응답을 비교**해야 한다 |
 * | ⑤가 자료원을 얻었다 | v1.9까지 이 요소는 DOC-008에만 있었다. 합계와 목록의 합이 같은지가 「창이 없다」의 형태다 |
 *
 * ## 전용 사용자 둘로 데이터를 전부 통제한다 (AQ-34)
 *
 * `scope = 'MINE'`의 집계는 그 소유자의 전 상품에서 나오므로, 다른 스위트의 상품이
 * 섞이면 「포함되어 있다」까지만 확인할 수 있다. `helpers/users.ts`의 두 전용 사용자는
 * 이 파일이 데이터를 전부 만들므로 **값으로** 단언한다 — 그리고 그 통제가
 * ①의 빈 줄(「다가오는 평가일 없음」)을 처음으로 렌더 가능하게 만든다.
 *
 * ## 시각에 의존하는 단언을 만들지 않는다
 *
 * 평가일은 `발행일 + n×주기`이므로 「가까운 평가일」·「먼 평가일」을 고정 발행일로 만들면 그
 * 성질이 **오늘이 언제인지에 따라 바뀐다**(컷 7의 「적용 차수는 시각에 의존한다」와
 * 같은 함정). 그래서 발행일을 **기준일에서 거꾸로 계산**하고 앱이 저장에 쓴 함수로
 * 검산한다(`generateEvaluationDates`). 세금도 같은 이유로 비과세 계좌를 쓴다 —
 * 미상환 상품의 기여는 적용 차수의 귀속연도에 달렸고 그 연도가 시각에 의존한다.
 */

// ---------------------------------------------------------------------------
// 픽스처 — 원금은 손으로 검산할 수 있는 값이다
// ---------------------------------------------------------------------------

const P_SOON = '20,000,000'
const P_CARRY = '10,000,000'
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

/**
 * 여유폭 단계의 두 갈래 (홈 피드백 컷 K6 · D3) — 기준가(`registerProduct`의 99,999,999,999.999999) 대비 0.93 · 0.80.
 * 계약의 4자리 워스트오브가 정확히 `0.9300` · `0.8000`이 된다(기준가가 1e11보다 1e-6 작아 몫이 그 값 바로 위다).
 * 둘 다 1차(배리어 90% · 리자드 없음)가 적용 차수인 상품에 쓴다 — +3%p 충족(근소) · −10%p 이월(미충족). KI 50%의 근접
 * (55%)보다 위라 ④에 오르지 않는다
 */
const NARROW_PRICE = '93000000000.000000'
const CARRY_PRICE = '80000000000.000000'

const SECTIONS = {
  // P6 컷 7-4 — 맨 위. 0건이면 그리지 않으므로 머리의 부재가 곧 0건이다
  redemptionCheck: '상환 확인 필요',
  // 홈 피드백 컷 K4 · D2 — 종전 「임박 평가일」
  upcoming: '다가오는 평가일',
  totals: '총 자산 요약',
  attention: '주의 상태 상품',
  recent: '최근 상환 실적',
} as const

/**
 * 화면 빈 상태 둘 — ~~리터럴~~ → 화면이 쓰는 상수 그대로 *(홈 피드백 컷 K12)*. 리터럴을 따로 들면 화면 문구가 바뀌는 날 아래
 * 음성 단언(「빈 상태가 아니다」)이 조용히 헛돈다 — 종전 「내 상품이 없다」가 그 자리였다(K12에서 문구가 바뀌었다)
 */
const EMPTY_MINE = EMPTY_STATES.homeMine.title
const EMPTY_ALL = EMPTY_STATES.homeAll.title

/**
 * 정규식에 넣는 글자는 이스케이프한다 *(홈 피드백 컷 K12 · K10 검증 지적)* — 화면 글자(`YEAR_TAX_TEXT` · 판정 제목 · 절 제목)를
 * 그대로 `new RegExp`에 넣으면 그 글자의 `.` · `(` · `+`가 메타문자가 된다. 지금 글자의 마침표는 「아무 글자」로 읽혀도
 * 맞으므로 초록이지만, 그것은 단언이 **더 느슨하게** 맞는다는 뜻이다(괄호가 든 글자는 깨진다)
 */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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
  const at = html.search(new RegExp(`<h2[^>]*>${literal(title)}`))
  if (at < 0) return ''
  // 다음 `<h2`까지가 그 절이다. 문서 끝까지 자르면 뒤 절이 섞인다.
  const next = html.indexOf('<h2', at + 4)
  return next < 0 ? html.slice(at) : html.slice(at, next)
}

/** 절의 존재는 머리글로만 판정한다(빈 문자열을 반환하는 위 함수의 짝) */
function hasSection(html: string, title: string): boolean {
  return sectionOf(html, title) !== ''
}

/**
 * 그 상품의 상세 링크 속성 — 줄 고르기와 순서 단언의 열쇠다.
 *
 * 닫는 따옴표까지 넣는다: ⑥의 `href="/products/{id}/redeem?round=k"`와 겹치지 않는다(앞부분이 같다).
 */
function hrefOf(product: Pick<RegisteredProduct, 'productId'>): string {
  return `href="${PATHS.product(product.productId)}"`
}

/**
 * 그 상품의 줄만 모아 온다 — ~~상품명이 들어 있는 줄~~ → **상품 링크가 있는 줄** *(홈 피드백 컷 K1)*.
 *
 * 이름으로 고르면 이름을 노드로 쪼개는 순간(회차 강조 — 컷 K5) 줄을 잃는다. 그때 양성 단언은 빨강이 되지만 `toEqual([])` ·
 * `toBe('')` 꼴의 음성 단언은 **헛돌며 초록으로 남는다**(실측 — 컷 K1 커밋 본문). 상품 링크는 ①④⑤⑥과 SCR-301 시간순의
 * 어느 줄에나 있다(`coupons.test.ts`의 `timeRowsOf` 선례). ~~어느 줄에나 정확히 하나다~~ → **홈 ①④⑤⑥의 줄에서만 하나다**
 * *(컷 K5에서 바로잡았다)* — ⑥의 [상환 처리](`…/redeem?round=k`)는 닫는 따옴표 때문에 겹치지 않지만, SCR-301 시간순의 결함
 * 행은 판정 칸의 「고치기」도 같은 주소다(`ScheduleRow`의 `JudgmentCell`). 고르기는 포함 여부라 그 줄도 맞게 고르고,
 * 링크의 글자를 보는 `linkTextOf`는 홈의 줄에만 쓴다.
 */
function rowsOf(html: string, product: Pick<RegisteredProduct, 'productId'>): string[] {
  const href = hrefOf(product)
  return [...html.matchAll(/<li\b[\s\S]*?<\/li>/g)]
    .map((m) => m[0])
    .filter((row) => row.includes(href))
}

function rowOf(html: string, product: RegisteredProduct): string {
  const rows = rowsOf(html, product)
  expect(rows, `${product.productName}의 줄이 없다`).toHaveLength(1)
  return rows[0]!
}

/**
 * 그 줄에서 상품 링크의 **글자** — 태그를 벗긴 것 *(홈 피드백 컷 K5)*. 링크가 없으면 `null`.
 *
 * 줄을 링크로 고른 뒤(컷 K1)에는 「그 줄에 상품명이 보인다」를 고르기가 보장하지 않는다 — 이름으로 고를 때는 고르기
 * 자체가 그것이었다. 회차에서 이름을 두 노드로 쪼개도(`ProductNameLink`) 링크의 글자는 전체 상품명이어야 한다
 * (DOC-005 「회차」 — 접근성 이름이 바뀌지 않는다). 첫 링크만 본다(위 `rowsOf`의 각주 — 홈의 줄에서는 하나다).
 */
function linkTextOf(row: string, product: Pick<RegisteredProduct, 'productId'>): string | null {
  const href = literal(hrefOf(product))
  const m = new RegExp(`<a\\b[^>]*${href}[^>]*>([\\s\\S]*?)</a>`).exec(row)
  return m == null ? null : m[1]!.replace(/<[^>]*>/g, '')
}

/**
 * 그 값을 글자로 담은 span의 클래스 토큰 — 여유폭 숫자의 색을 노드로 본다 *(홈 피드백 컷 K6)*. 모바일 라벨 span(「여유폭 」)이
 * 앞에 끼어 있어도 같은 span이다. 없으면 빈 배열(그러면 `toContain` 단언이 빨개진다).
 */
function classesOfValue(row: string, value: string): string[] {
  const m = new RegExp(`<span class="([^"]*)">(?:<span[^>]*>[^<]*</span>)?${literal(value)}</span>`).exec(row)
  return m == null ? [] : m[1]!.split(/\s+/)
}

// ---------------------------------------------------------------------------
// 발행일을 기준일에서 거꾸로 만든다
// ---------------------------------------------------------------------------

// 발행일 역산(`issueDateForFirstRound`)은 `./helpers/dates`로 옮겼다(P6 컷 7-5 — 평가일 판정 흐름이 같은 역산을 쓴다).
// 그 함수도 앱의 함수로 검산한다 — 이 파일의 전제가 「앱이 저장할 때 쓴 함수와 같은 것으로 검산한다」다.

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

  /** 가까운 평가일(비과세 · 근소 충족) · 가까운 평가일 이월(비과세) · 먼 평가일 + 기초자산 결함(비과세) · 일정 결함 + KI 하회 · 상환완료 */
  let soon: RegisteredProduct
  /** 1차가 가깝고 그 차수를 못 맞춘다 — ①의 「예상 미충족」 갈래(홈 피드백 컷 K6). 비과세라 ③에 기여하지 않는다 */
  let carry: RegisteredProduct
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
    // ① 가까운 평가일 — 첫 평가일이 기준일 + 5~20일. 하한이 3 이상인 이유는 실행 중에
    //    그 날이 지나가지 않게 하려는 것이다. 이름에 「임박」을 넣지 않는다 — 종전 라벨 「홈임박」이
    //    「임박 표식이 있다」를 상품명으로 초록이 되게 했다(항진명제 · 홈 피드백 컷 K4)
    soon = await registerProduct(live, {
      label: '홈가까움',
      // 이름 끝을 「…{숫자}회」로 — ①의 회차 강조가 **갈리는** 갈래를 이 한 행이 렌더한다(홈 피드백 컷 K5). 나머지 픽스처는
      // 숫자로 끝나 한 조각이다 — 아래 「회차가 따로 선다」의 양방향 대조
      nameSuffix: '회',
      issueDate: issueDateForFirstRound(asOf, { min: 5, max: 20 }),
      principal: P_SOON,
      // 미상환 상품의 과세 기여는 적용 차수의 귀속연도에 달렸다 — 비과세로 두면
      // ③의 단언이 시각에 의존하지 않는다(`accountType` 옵션의 각주).
      accountType: 'TAX_FREE',
    })
    // 워스트오브 93% — 1차 배리어 90%보다 3%p 위라 「예상 근소 충족」이다(홈 피드백 컷 K6 · D3). 종전 120%(+30%p)는 「예상
    // 충족」이었고 그 낱말은 리터럴 시절부터 있었으므로 단계 배선을 증명하지 못한다
    await saveAssetPrice(live, soon.assetId, NARROW_PRICE)

    // ①′ 가까운 평가일 + 이월 — 1차(배리어 90%)를 워스트오브 80%로 못 맞춘다. 1차에는 리자드가 없다(2차에만 — `registerProduct`)
    carry = await registerProduct(live, {
      label: '홈이월',
      issueDate: issueDateForFirstRound(asOf, { min: 5, max: 20 }),
      principal: P_CARRY,
      accountType: 'TAX_FREE',
    })
    await saveAssetPrice(live, carry.assetId, CARRY_PRICE)

    // ② 먼 평가일 + 기초자산 결함 — 첫 평가일이 60~120일 뒤이므로 세 차수 전부
    //    미래이고, 그래서 ⑥(상환 확인 필요)에 오르지 않는다(시각 독립).
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
    // 늘 서는 절 넷 — ⑥ 상환 확인 필요는 0건이면 그리지 않으므로(알림이다) 여기서 요구하지 않는다(아래 ④ 케이스가 부재를 본다)
    for (const [key, title] of Object.entries(SECTIONS)) {
      if (key === 'redemptionCheck') continue
      expect(hasSection(html, title), `${title} 절이 없다`).toBe(true)
    }

    // 기본이 본인이므로 전환 링크의 「내 상품」이 현재 위치다.
    const nav = /<nav[^>]*aria-label="표시 범위"[\s\S]*?<\/nav>/.exec(html)?.[0]
    expect(nav, '범위 전환이 없다').toBeDefined()
    expect(nav).toMatch(/aria-current="true"[^>]*>내 상품/)
    // JS 없이 동작한다 — 링크이고 폼이 아니다.
    expect(nav).not.toContain('<form')
    expect(nav).toContain(`href="${PATHS.home}?${DASHBOARD_KEYS.scope}=ALL"`)
    // 둘째 링크의 글자는 「모든 사용자」다(홈 피드백 컷 K12 · 민서 결정(2026-10-12) D6) — 노드 단위로 본다. 「전체」는 다른 필터
    // 축에서 「좁히지 않음」이자 기본값이라 이 축(기본값이 좁힌 쪽)에서 반대로 읽혔다(피드백 #11)
    expect(nav).toContain(`>${SCOPE_LABELS.ALL}<`)
    expect(nav, '범위 전환에 「전체」가 남았다').not.toContain('>전체<')
  })

  it('② 머리의 범위 표식이 범위 전환과 같은 글자다 — 홈 피드백 컷 K12 · D6', async () => {
    /*
     * 종전 ② 머리는 「본인」 · 「전체」였다 — 범위 전환(「내 상품」 · 「전체」)과도 달랐다. 이제 한 상수(`SCOPE_LABELS`)다.
     * 「본인」은 ③ 「올해 금융소득(본인)」의 과세 주체 낱말로 남는다(SQ-03). 두 주소를 비교한다 — 한쪽만 보면 「범위를
     * 따른다」와 「늘 같은 글자다」가 갈리지 않는다
     */
    const mine = sectionOf(visible(await (await get(PATHS.home, live)).text()), SECTIONS.totals)
    const all = sectionOf(
      visible(await (await get(`${PATHS.home}?${DASHBOARD_KEYS.scope}=ALL`, live)).text()),
      SECTIONS.totals,
    )
    expect(mine, '② 절을 자르지 못했다').not.toBe('')
    expect(mine).toContain(`>${SCOPE_LABELS.MINE}<`)
    expect(all).toContain(`>${SCOPE_LABELS.ALL}<`)
    for (const section of [mine, all]) {
      expect(section, '② 머리에 종전 표식이 남았다').not.toContain('>본인<')
      expect(section, '② 머리에 종전 표식이 남았다').not.toContain('>전체<')
    }
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
     * (§4.4의 루트가 차수다) ①의 다가오는 평가일 목록에서도 빠지므로(다음 평가일이 없다) 그
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

    const row = rowOf(attention, defect)
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
    expect(rowsOf(sectionOf(html, SECTIONS.attention), defect)).toHaveLength(1)
    // 줄을 링크로 고르므로(컷 K1) 「그 줄에 상품명이 보인다」를 따로 본다 — ④도 `ProductNameLink`다(홈 피드백 컷 K5)
    expect(linkTextOf(rowOf(sectionOf(html, SECTIONS.attention), defect), defect)).toBe(defect.productName)
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
    const row = rowOf(sectionOf(html, SECTIONS.attention), far)

    expect(row).toContain(ATTENTION_REASON_LABELS.UNDERLYING_MISSING)
    expect(row, '결함 상품에 시세 없음이 붙었다').not.toContain(PRICE_MISSING_LABEL)
    // 경과 차수가 없으므로 ⑥도 없다 — 실행 사용자의 상품은 차수가 전부 미래이거나 상환됐다(P6 컷 7-4). 0건이면 절을
    // 그리지 않는다는 것의 관측이기도 하다
    expect(hasSection(html, SECTIONS.redemptionCheck)).toBe(false)
  })

  it('조치 목록이 두 상품이다 — 정상 상품은 올라오지 않는다', async () => {
    const attention = sectionOf(
      visible(await (await get(PATHS.home, live)).text()),
      SECTIONS.attention,
    )
    // 가까운 평가일 상품 둘은 워스트오브 93% · 80%이고 KI 배리어 50%(근접 55%)보다 위라 안전이고, 상환완료 상품은
    // E-05로 조치 대상이 아니다(§4.1이 결함만 남기고 나머지를 끊는다).
    expect(rowsOf(attention, soon)).toEqual([])
    expect(rowsOf(attention, carry)).toEqual([])
    expect(rowsOf(attention, redeemed)).toEqual([])
    expect(rowsOf(attention, redeemedOld)).toEqual([])
    expect(attention).toContain('2건')
  })

  // -------------------------------------------------------------------------
  // ① 다가오는 평가일 · 판정 없음
  // -------------------------------------------------------------------------

  it('★ ①에 「임박」 표식이 없고 행이 날짜 · D-Day를 담는다 — 홈 피드백 컷 K4 · D2', async () => {
    /*
     * ★ **종전 단언은 아무것도 검증하지 못했다.** 「가까운 행에 임박이 있다」를 `toContain('임박')`으로 봤는데
     * 상품명이 「…홈임박…」이라 표식을 지워도 초록이었다(항진명제). 표식은 노드 단위로 본다 — `>임박<`.
     *
     * 지운 근거(DOC-008 SCR-101 「화면이 정한 값」 표): 모든 행이 D-Day를 적으므로 표식이 행마다 같은 말을 했고(피드백 #3),
     * 계약에 창이 없어 30일 경계는 강조만 정했다. 그래서 확인할 것은 **D-Day가 두 행 모두에 남는다**이다.
     */
    const html = visible(await (await get(PATHS.home, live)).text())
    // 절 제목이 바뀌었다 — 종전 제목의 h2가 없고 새 제목의 절이 있다
    expect(html, '종전 절 제목이 남았다').not.toMatch(/<h2[^>]*>임박/)
    const upcoming = sectionOf(html, SECTIONS.upcoming)
    expect(upcoming, '다가오는 평가일 절을 자르지 못했다').not.toBe('')

    const near = rowOf(upcoming, soon)
    const distant = rowOf(upcoming, far)
    expect(upcoming, '「임박」 표식이 남았다').not.toContain('>임박<')
    // 항목이 있으면 머리에 건수가 선다 — 아래 빈 절 케이스(「0건」을 그리지 않는다 · 홈 피드백 컷 K12)의 반대 방향
    expect(upcoming).toMatch(/>\d+건(?: 중 \d+건)?</)

    // 두 행이 실제로 가깝고 멀다 — 같은 D-Day면 아래 D-Day 단언이 서로를 구분하지 못한다
    const nearDDay = dDay({ from: asOf, evaluationDate: firstRoundOf(soon) })
    const farDDay = dDay({ from: asOf, evaluationDate: firstRoundOf(far) })
    expect(nearDDay).toBeLessThan(farDDay)

    // 두 행 모두 날짜와 D-Day를 그대로 담는다 — 노드 단위로 본다(다른 칸의 숫자에 맞지 않게)
    expect(near).toContain(`>${ymd(firstRoundOf(soon))}<`)
    expect(near).toContain(`>${dDayLabel(nearDDay)}<`)
    expect(distant).toContain(`>${ymd(firstRoundOf(far))}<`)
    expect(distant).toContain(`>${dDayLabel(farDDay)}<`)
  })

  it('★ ① 상품명 끝의 회차가 따로 서고 링크 글자는 전체 이름이다 — 홈 피드백 컷 K5', async () => {
    /*
     * ★ **양방향으로 본다.** 회차로 끝나는 이름(`soon` — `nameSuffix: '회'`)은 두 노드로 갈리고, 숫자로 끝나는 이름(`far`)은
     * 종전처럼 한 노드다. 한쪽만 보면 「늘 가른다」 · 「늘 가르지 않는다」 구현이 각각 초록이다. 가르는 규칙의 경계(첫 숫자 ·
     * 공백 · 끝 공백 · 「n차」)는 상시 스위트가 본다(`productName.test.ts`) — 여기서는 그 함수가 화면에 닿았는지다.
     */
    const upcoming = sectionOf(visible(await (await get(PATHS.home, live)).text()), SECTIONS.upcoming)
    const near = rowOf(upcoming, soon)
    const distant = rowOf(upcoming, far)

    // 전제 — 두 이름이 실제로 두 갈래다(아니면 아래 단언이 서로를 구분하지 못한다)
    const { lead, series } = splitProductName(soon.productName)
    expect(series, `${soon.productName}이 회차로 끝나지 않는다 — nameSuffix 전제`).not.toBeNull()
    expect(splitProductName(far.productName).series, `${far.productName}이 회차로 끝난다`).toBeNull()

    // 갈린다 — 회차가 제 노드에 서고 앞부분도 제 노드다. 이름 전체가 한 노드로 남아 있지 않다
    expect(near, '회차가 따로 서지 않았다').toContain(`>${series}<`)
    expect(near).toContain(`>${lead}<`)
    expect(near, '이름이 한 노드로 남았다').not.toContain(`>${soon.productName}<`)
    // 안 갈린다 — 한 노드 그대로
    expect(distant, '회차 없는 이름이 쪼개졌다').toContain(`>${far.productName}<`)

    // 어느 쪽이든 링크의 글자는 전체 상품명이다 — 조각을 잃거나 덧붙이지 않는다
    expect(linkTextOf(near, soon)).toBe(soon.productName)
    expect(linkTextOf(distant, far)).toBe(far.productName)
  })

  it('★ ① 판정 없음 행도 칸을 잃지 않는다 — 홈 피드백 컷 K5', async () => {
    /*
     * ★ 판정 없음 행(`far` — 기초자산 결함으로 워스트오브가 없다)도 워스트오브 · 여유폭 자리에 「—」(장식)를 둔다 — 칸을
     * 빼면 그 행의 판정 칸이 왼쪽으로 밀려 열이 무너진다. 정렬 자체는 브라우저의 일이고, 문서에서 보이는 대리 지표는 그
     * 자리표시의 개수다. 시세가 있는 행에는 하나도 없다(반대 방향).
     */
    const upcoming = sectionOf(visible(await (await get(PATHS.home, live)).text()), SECTIONS.upcoming)
    const near = rowOf(upcoming, soon)
    const distant = rowOf(upcoming, far)

    expect(distant.match(/>—</g), '판정 없음 행의 칸이 빠졌다').toHaveLength(2)
    expect(distant).toContain(`>${percent('0.9000')}<`)
    expect(near.match(/>—</g), '판정이 있는 행에 자리표시가 섰다').toBeNull()
  })

  it('가까운 것이 먼저다 — 계약이 준 순서를 다시 정하지 않는다', async () => {
    const upcoming = sectionOf(
      visible(await (await get(PATHS.home, live)).text()),
      SECTIONS.upcoming,
    )
    // 상품 링크의 자리로 잰다(컷 K1 — 이름으로 재면 이름을 노드로 쪼갤 때 -1이 된다). 앞의 것이 -1이면 「먼저다」가
    // 거짓인 채 초록이므로 있음부터 본다 — 두 줄의 존재를 보는 다른 `it`에 기대지 않는다(실행 순서와 무관하게).
    const nearAt = upcoming.indexOf(hrefOf(soon))
    expect(nearAt, '가까운 평가일의 줄이 없다').toBeGreaterThan(-1)
    expect(nearAt).toBeLessThan(upcoming.indexOf(hrefOf(far)))
    // 세 건뿐이므로 자름이 없다 — 「N건 중 M건」이 아니라 「3건」이다(가까운 둘 + 먼 하나 — 홈 피드백 컷 K6이 이월 하나를 더했다).
    expect(upcoming).toContain('3건')
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
    const distant = rowOf(upcoming, far)

    expect(distant).toContain('판정 없음')
    // 여유폭 단계 셋 어느 것도 말하지 않는다(홈 피드백 컷 K6 — 낱말은 표에서 읽는다)
    for (const label of Object.values(GAP_TIER_LABELS)) expect(distant, label).not.toContain(label)

    // 반대 방향 — 시세가 있는 행은 판정을 말한다(위 단언이 항진명제가 아니다).
    const near = rowOf(upcoming, soon)
    expect(near).toContain(`>${GAP_TIER_LABELS.NARROW}<`) // 워스트오브 93% ≥ 1차 배리어 90% · 여유 3%p
    expect(near).toContain(`>${percent('0.9300')}<`)
  })

  it('★ ① 판정 칸이 여유폭 단계다 — 근소 · 미충족 · 판정 없음이 갈리고 숫자의 색은 부호가 아니라 단계다 (홈 피드백 컷 K6 · D3)', async () => {
    /*
     * ★ 피드백 #2 — 종전 「예상 충족」 하나가 +3%p와 +30%p를 같게 말했다. 세 행이 세 갈래다: `soon` +3%p 충족 → 「예상 근소
     * 충족」 · `carry` −10%p 이월 → 「예상 미충족」 · `far` 판정 없음 → 어느 것도 아님. 낱말과 숫자색은 `gapTierOf` 하나가
     * 정한다 — 경계(정확히 5%p · 리자드)는 상시 스위트가 본다(`gapTier.test.ts`). 「예상 충족」 갈래는 이 화면에서 관측하지
     * 않는다(SCR-201 · SCR-301 e2e가 그 색을 본다).
     *
     * 숫자색은 **노드로** 본다 — `+3%p`를 감싼 span의 클래스. 부호로 칠하는 구현이면 +3%p가 초록이 된다(그래서 근소의 앰버가
     * 판별력을 갖는다). 판정 없음 행에는 숫자가 없다(「—」 — 위 K5 단언).
     */
    const upcoming = sectionOf(visible(await (await get(PATHS.home, live)).text()), SECTIONS.upcoming)
    const near = rowOf(upcoming, soon)
    const carried = rowOf(upcoming, carry)
    const distant = rowOf(upcoming, far)

    // 전제 — 두 행의 여유폭이 계약 값대로다(부호가 다르다)
    const nearGap = barrierGap('0.9300', '0.9000')
    const carryGap = barrierGap('0.8000', '0.9000')
    expect([nearGap, carryGap]).toEqual(['+3%p', '-10%p'])

    expect(near).toContain(`>${GAP_TIER_LABELS.NARROW}<`)
    expect(near).not.toContain(`>${GAP_TIER_LABELS.MET}<`)
    expect(carried).toContain(`>${GAP_TIER_LABELS.UNMET}<`)
    expect(carried).not.toContain(`>${GAP_TIER_LABELS.NARROW}<`)
    for (const label of Object.values(GAP_TIER_LABELS)) expect(distant, label).not.toContain(`>${label}<`)

    // 숫자의 색 — 단계의 등급(근소 · 미충족 둘 다 caution). 양수인 +3%p도 앰버다
    expect(classesOfValue(near, nearGap), '+3%p의 색').toContain(GRADE_TEXT_CLASS[GAP_TIER_GRADES.NARROW])
    expect(classesOfValue(carried, carryGap), '-10%p의 색').toContain(GRADE_TEXT_CLASS[GAP_TIER_GRADES.UNMET])
    expect(classesOfValue(near, nearGap)).not.toContain(GRADE_TEXT_CLASS[GAP_TIER_GRADES.MET])
  })

  it('★ 다가오는 평가일이 없으면 그 절에 한 줄이 남는다 — AQ-34 · 홈 피드백 컷 K4', async () => {
    /*
     * ★ **전용 사용자가 없으면 만들 수 없던 상태다**(AQ-34). 이 사용자의 유일한
     * 상품은 전 차수가 경과했으므로(2년 전 발행 + 6개월 주기 3차수) `upcomingEvaluations`가
     * 빈 배열이다. 그때 다음 행동은 등록이 아니라 ~~상환 처리 또는 이월 확인~~ → **상환 처리**이며(⑥이 묻는다 —
     * P6 컷 7-4), 나머지 요소는 그대로 렌더된다 — 이 표의 빈 상태가 아니다(DOC-008 §6 각주).
     */
    const html = visible(await (await get(PATHS.home, past)).text())

    // 화면 전체의 빈 상태가 아니다 — 상품이 있으므로 다른 절이 살아 있다.
    expect(html).not.toContain(EMPTY_MINE)
    expect(hasSection(html, SECTIONS.totals)).toBe(true)
    expect(html).toContain(amount(P_OVERDUE.replace(/,/g, '')))
    /*
     * ~~그 상품은 조치 목록에 있다 — 경과했기 때문이다~~ → **⑥ 상환 확인 필요에 있다**(P6 컷 7-4). 전 차수가 경과했으므로
     * 평가일 판정은 「만기 평가일 경과」다 — 오늘 등록했어도(등록일 컷 없음 — 만기에는 이월이 없다) 그렇다. [상환 처리]는
     * 만기 차수(3차)를 `?round=3`으로 연다. ④에서는 「평가일 경과」 칩이 사라졌다
     */
    const checks = sectionOf(html, SECTIONS.redemptionCheck)
    const check = rowOf(checks, overdue)
    // ⑥도 `ProductNameLink`다(홈 피드백 컷 K5) — 링크의 글자가 전체 상품명이다. [상환 처리]의 주소는 닫는 따옴표 때문에 맞지 않는다
    expect(linkTextOf(check, overdue)).toBe(overdue.productName)
    expect(check).toContain(EVALUATION_VERDICT_LABELS.MATURITY_REACHED)
    expect(check).toContain(`href="${REDEEM_ROUND.href(overdue.productId, 3)}"`)
    expect(sectionOf(html, SECTIONS.attention)).not.toContain('평가일 경과')

    /*
     * ★ **① ④ ⑤가 모두 비어 있고 셋 다 한 줄이다** (홈 피드백 컷 K4 · 피드백 #10). 절 제목(h2)은 남는다 — 「없다」도
     * 그 물음의 답이다. 점선 상자의 부재는 문서 전체로 본다: 상품이 있는 홈에서 그 클래스를 쓰던 곳은 이 셋뿐이었다.
     *
     * ①의 뒷절은 ⑥에 항목이 있을 때만 붙는다(DOC-008 SQ-28) — 이 사용자의 ⑥은 위에서 본 한 건이다. ⑥이 빈 갈래는
     * 여기서 렌더되지 않는다(그 상태의 사용자가 없다) — 상시 스위트가 함수의 두 갈래를 본다(`emptyState.test.ts`).
     */
    expect(rowsOf(checks, overdue), '⑥이 한 건이 아니다 — 아래 뒷절의 전제').toHaveLength(1)
    const upcoming = sectionOf(html, SECTIONS.upcoming)
    expect(upcoming, '다가오는 평가일 절(h2)이 사라졌다').not.toBe('')
    expect(upcoming).toContain(`>${missingUpcomingNote('HOME', 1)}<`)
    expect(sectionOf(html, SECTIONS.attention)).toContain(`>${SECTION_EMPTY.attention}<`)
    expect(sectionOf(html, SECTIONS.recent)).toContain(`>${SECTION_EMPTY.recent}<`)
    expect(html, '절 빈 상태에 점선 상자가 남았다').not.toContain('border-dashed')

    /*
     * ★ **비었으면 머리에 건수를 적지 않는다** (홈 피드백 컷 K12 · DOC-005 §2.1 「한 사실에 한 문장」 · 피드백 #3). 종전에는
     * 「다가오는 평가일 0건」 아래 「다가오는 평가일 없음」이 와서 한 사실을 두 번 말했다. 노드 단위로 본다(`>0건<`) —
     * 「10건」 · 「20건」에 맞지 않게. 제목과 전체 링크는 남는다(§7의 화면 전이)
     */
    for (const title of [SECTIONS.upcoming, SECTIONS.attention, SECTIONS.recent]) {
      expect(sectionOf(html, title), `${title} 머리에 「0건」이 남았다`).not.toContain('>0건<')
    }
    expect(upcoming, '① 전체 일정 링크가 사라졌다').toContain(`href="${PATHS.schedule}"`)
  })

  // -------------------------------------------------------------------------
  // ② ③ ⑤ — 값으로 단언한다
  // -------------------------------------------------------------------------

  it('★ ②의 집계가 정확하다 — 전용 사용자의 데이터를 전부 통제한다', async () => {
    const totals = sectionOf(
      visible(await (await get(PATHS.home, live)).text()),
      SECTIONS.totals,
    )

    // 보유중 넷(가까운 평가일 둘·먼 평가일·결함). 상환완료 둘은 세지 않는다.
    expect(totals).toContain('4건')
    // 20,000,000 + 10,000,000 + 30,000,000 + 40,000,000
    expect(totals).toContain(amount('100000000'))
    // 실현손익 = (54,000,000 − 50,000,000) + (71,000,000 − 70,000,000).
    // **부호를 붙인다**(음수가 정상값이다)
    expect(totals).toContain(signedWon('5000000'))
  })

  it('★ ③의 금융소득이 상환 확정값 하나다 — 비과세 상품은 기여하지 않는다', async () => {
    /*
     * ★ 가까운 평가일·먼 평가일 상품은 비과세 계좌이므로 확정값이 있어도 과세소득이 0이고
     * (DOC-007 §4.2), 일정 0건 상품은 적용 차수가 없어 기여하지 않으며(결함이라서가
     * 아니다 — §4.2 입력 기준), 상환완료 상품만 남는다. 그래서 이 값이 정확히 하나의
     * 확정값이며 **시각에 의존하지 않는다.**
     */
    const html = visible(await (await get(PATHS.home, live)).text())
    const tax = sectionOf(html, '올해 금융소득')
    expect(tax, '금융소득 절을 자르지 못했다').not.toBe('')

    // 상환 둘의 확정 과세소득 합 = 4,000,000 + 1,000,000
    expect(tax).toContain(won('5000000'))
    /*
     * 2천만원 이하이므로 분리과세로 종결된다. 판정 제목은 SCR-401과 같은 상수이고(홈 피드백 컷 K10) **양성과 음성을 같은
     * 모양으로** 본다 — 맨 부분 문자열 「종합과세 대상」은 안내 문장과 겹칠 수 있어 음성이 엉뚱한 이유로 빨개지거나, 제목을
     * 바꿔도 다른 자리에 맞아 양성이 초록이 된다
     */
    const verdictTag = (label: string) => new RegExp(`<strong[^>]*>${literal(label)}</strong>`)
    expect(tax).toMatch(verdictTag(TAX_METHOD_VERDICT_LABELS.SEPARATE))
    expect(tax).not.toMatch(verdictTag(TAX_METHOD_VERDICT_LABELS.COMPREHENSIVE))
    expect(tax).toContain(YEAR_TAX_TEXT.verdictBody.SEPARATE)
    expect(tax).toContain(`${asOf.slice(0, 4)}년 귀속`)

    /*
     * ★ **이 사용자는 과세 프로필이 없다**(`helpers/users.ts` 머리 — 일부러 만들지 않는다). 그래서 추가납부 칸은 금액이
     * 아니라 「프로필 미입력」이다(홈 피드백 컷 K10 · 피드백 #6). 종전 단언 `toContain(won('0'))`은 **아무것도 가르지
     * 못했다** — 「0원」이 위 「5,000,000원」 안에 들어 있다. 그래서 노드 경계(`>…<`)로 본다: 금액 칸의 「0원」이 사라졌다.
     * 저장된 경로 · 「{금액} 이상」은 이 스위트가 관측하지 못한다(DOC-010 AQ-105 — 상시 진리표만 본다)
     */
    expect(tax).toContain(`>${YEAR_TAX_TEXT.profileMissing}<`)
    expect(tax, '프로필이 없는데 추가납부가 「0원」으로 적혔다').not.toContain(`>${won('0')}<`)

    /*
     * 프로필 미입력 안내는 **펼친 채** 있고(하한 신호) 링크는 SCR-401 과세 프로필 절로 간다. 「추정 기준 보기」는 접힌다 —
     * 서버가 그리므로 접힌 문장도 HTML에 있다. 링크가 `<details>` 안으로 들어가면 하한 신호가 접힌다(음성)
     */
    const detailsAt = tax.indexOf('<details')
    expect(detailsAt, '「추정 기준 보기」가 없다').toBeGreaterThan(-1)
    const details = tax.slice(detailsAt, tax.indexOf('</details>', detailsAt))
    const outside = tax.slice(0, detailsAt) + tax.slice(tax.indexOf('</details>', detailsAt))
    expect(details).toMatch(new RegExp(`<summary[^>]*>${literal(YEAR_TAX_TEXT.basisSummary)}</summary>`))
    expect(details).toContain(YEAR_TAX_TEXT.estimateBasis)
    expect(details).not.toContain(TAX_PROFILE_SECTION.href)
    expect(outside).toMatch(
      new RegExp(
        `${literal(YEAR_TAX_TEXT.profileMissingNote)} ${literal(YEAR_TAX_TEXT.profileMissingResolve)} <a\\b[^>]*href="${literal(TAX_PROFILE_SECTION.href)}"[^>]*>${literal(YEAR_TAX_TEXT.profileLink)}</a>`,
      ),
    )
  })

  it('③의 「과세 프로필 입력」이 닿는 자리가 있다 — SCR-401에 그 조각의 `id`', async () => {
    // 앵커를 달기 전에는 이 단언이 빨갛다 — 링크만 있고 목적지가 없으면 페이지 맨 위로 떨어진다
    const html = await (await get(PATHS.tax, live)).text()
    expect(html).toContain(`id="${TAX_PROFILE_SECTION.id}"`)
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

    const row = rowOf(recent, redeemed)
    expect(row).toContain(REDEMPTION_TYPE_LABELS.MATURITY_GAIN)
    expect(row).toContain(amount(GROSS.replace(/,/g, '')))
    expect(row).toContain(signedWon('4000000'))
    // ~~상세 링크가 있다~~ → 줄을 그 링크로 골랐으므로(컷 K1) 링크는 위 `rowOf`가 이미 단언한다 — 남기면 항진명제다.
    // 대신 반대 방향을 본다 — 이름으로 고를 때는 고르기 자체가 보장하던 「그 줄에 상품명이 보인다」(회차가 없는 이름이라 한 노드다)
    expect(row, '⑤ 줄에 상품명이 없다').toContain(`>${redeemed.productName}<`)
    // 확정값으로 저장했으므로 「미확인」이 없다(ST-05의 반대 방향)
    expect(row).not.toContain('미확인')

    // 둘째 상환도 자기 값을 낸다 — 두 줄이 같은 값을 렌더하지 않는다
    const older = rowOf(recent, redeemedOld)
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
    // 3월 상환이 1월 상환보다 위에 있다 — 상품 링크의 자리로 잰다(위 「가까운 것이 먼저다」와 같은 이유로 있음부터)
    const newerAt = recent.indexOf(hrefOf(redeemed))
    expect(newerAt, '3월 상환의 줄이 없다').toBeGreaterThan(-1)
    expect(newerAt).toBeLessThan(recent.indexOf(hrefOf(redeemedOld)))
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
    const allRow = rowOf(sectionOf(all, SECTIONS.attention), defect)
    expect(allRow, '전체 보기에 소유자가 없다').toContain(liveName)

    const mine = visible(await (await get(PATHS.home, live)).text())
    const mineRow = rowOf(sectionOf(mine, SECTIONS.attention), defect)
    expect(mineRow, '본인 보기에 소유자가 붙었다').not.toContain(liveName)
  })

  it('본인 보기가 남의 상품을 담지 않는다', async () => {
    const mine = visible(await (await get(PATHS.home, past)).text())
    expect(rowsOf(mine, defect)).toEqual([])
    expect(rowsOf(mine, soon)).toEqual([])

    const all = visible(
      await (await get(`${PATHS.home}?${DASHBOARD_KEYS.scope}=ALL`, past)).text(),
    )
    expect(rowsOf(sectionOf(all, SECTIONS.attention), defect)).toHaveLength(1)
  })

  it('조작된 범위가 오류가 되지 않고 본인 보기로 떨어진다', async () => {
    const res = await get(`${PATHS.home}?${DASHBOARD_KEYS.scope}=EVERYONE`, live)
    expect(res.status).toBe(200)
    const html = visible(await res.text())
    // 인식하지 못한 값은 버린다 — 그 결과가 기본값이고, 화면의 전환도 그 상태다.
    const nav = /<nav[^>]*aria-label="표시 범위"[\s\S]*?<\/nav>/.exec(html)?.[0]
    expect(nav).toMatch(/aria-current="true"[^>]*>내 상품/)
    expect(rowsOf(html, defect)).toHaveLength(1)
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
    const query = `${SCHEDULE_KEYS.owner}=${E2E_PAST}`
    const html = await (
      await get(`${PATHS.schedule}?${query}&${SCHEDULE_KEYS.view}=TIME`, past)
    ).text()

    expect(html).toContain('지난 평가일')
    // 홈 ①의 빈 줄과 한 함수다(홈 피드백 컷 K4). 이 화면은 ⑥의 건수를 모르므로 뒷절이 조건문이다(DOC-008 SQ-28)
    expect(html).toContain(`>${missingUpcomingNote('SCHEDULE')}<`)
    // 빈 상태 둘 중 어느 것도 아니다 — 목록이 비지 않았다(지난 차수가 셋 있다).
    expect(html).not.toContain(EMPTY_STATES.scheduleNarrowed.title)
    expect(html).not.toContain(EMPTY_STATES.scheduleAll.title)
    expect(rowsOf(html, overdue)).toHaveLength(overdue.barriers.length)

    /*
     * ★ **문구가 보기마다 갈리지 않는다** (DOC-008 §6). 자리만 다르다 — 시간순은
     * 「다가오는 평가일」 절의 자리이고 상품별은 카드 목록 위다. 한 상태에 두 문구를
     * 두면 사용자가 보기를 바꿀 때 **상태가 바뀐 것으로 읽는다.**
     */
    const byProduct = await (await get(`${PATHS.schedule}?${query}`, past)).text()
    expect(byProduct).toContain(`>${missingUpcomingNote('SCHEDULE')}<`)
    expect(byProduct).not.toContain(EMPTY_STATES.scheduleNarrowed.title)
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
     * 전체 보기에는 이 파일이 만든 상품이 있으므로 「등록된 상품 없음」이 나올 수 없다.
     */
    const all = visible(
      await (await get(`${PATHS.home}?${DASHBOARD_KEYS.scope}=ALL`, live)).text(),
    )
    expect(all).not.toContain(EMPTY_ALL)
    expect(all).not.toContain(EMPTY_MINE)
  })

  it('★ 상품이 없는 사용자의 홈 — 빈 상태가 「내 상품 없음」이고 넓히는 길은 「모든 사용자」다 — 홈 피드백 컷 K12', async () => {
    /*
     * ★ **이 갈래는 종전에 한 번도 렌더되지 않았다** — 위 케이스는 문구가 «없음»만 보고, `live` · `past`는 상품이 있다.
     * `E2E_EMPTY`는 어느 파일도 무엇도 만들지 않는 사용자라(`helpers/users.ts`) 본인 범위의 홈이 정확히 이 빈 상태다.
     *
     * 글자는 SCR-201의 같은 상태와 같은 상수다(`EMPTY_STATES` — DOC-008 §6 「화면 빈 상태의 글자」). 설명이 범위를 넓히는
     * 길을 표시 범위의 글자로 말하고, 다음 행동은 등록이다 — 범위 전환이 머리글에 늘 있으므로 넓히는 버튼을 또 두지 않는다
     */
    const empty = await authenticatedJar(E2E_EMPTY)
    const html = visible(await (await get(PATHS.home, empty)).text())

    expect(html).toContain(`>${EMPTY_STATES.homeMine.title}<`)
    expect(html).toContain(`>${EMPTY_STATES.homeMine.description}<`)
    expect(EMPTY_STATES.homeMine.description).toContain(`「${SCOPE_LABELS.ALL}」`)
    expect(html).not.toContain(EMPTY_STATES.homeAll.title)
    expect(html).toContain(`>${EMPTY_STATES.homeMine.action}<`)
    expect(html).toContain(`href="${PATHS.productNew}"`)
    expect(html, '홈 빈 상태에 범위를 넓히는 버튼이 섰다').not.toContain(EMPTY_STATES.productsMine.action)
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
