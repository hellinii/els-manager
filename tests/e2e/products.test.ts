import { beforeAll, describe, expect, it } from 'vitest'

import {
  CONDITION_RESULT_LABELS,
  KI_STATUS_LABELS,
  STATUS_LABELS,
  percent,
  priceDisplay,
  won,
} from '@/lib/format'
import { percentToRatio } from '@/lib/forms/parse'
import { FILTER_KEYS } from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

import { authenticatedJar } from './helpers/auth'
import { registerProduct, type RegisteredProduct } from './helpers/register'
import { cookieJar, get } from './helpers/server'

/**
 * SCR-201 목록 · SCR-202 상세 — **Next를 지나야 존재하는 것들** (P4 컷 2·3)
 *
 * ## 이 스위트는 DB 상태를 전제하지 않는다 — 없으면 만든다
 *
 * 실행 시점의 DB 상태는 고정되어 있지 않다. CLAUDE.md의 순서는 `db:reset` →
 * `test:rls` → `test:integration`(픽스처를 **커밋한다**) → `test:e2e`이지만,
 * `test:integration`의 `resetFixtures()`가 자기 것을 지우므로 남는 것이 실행마다
 * 다르고, 이 스위트만 따로 돌리면 0건이다. 그래서 두 가지를 나눠 쓴다.
 *
 * | 무엇을 | 어떻게 |
 * |---|---|
 * | KI 필터 선택지 다섯 (AQ-24) | **데이터 무관** — 선택지는 라벨 표에서 나온다 |
 * | 빈 상태 **두 갈래의 구분** | **데이터 무관** — 실재하지 않는 소유자는 언제나 0건이다 |
 * | 오타 id → 404 | **데이터 무관** — `getProduct`가 던지는 경로다 |
 * | 상세가 열리고 판정이 보인다 | **화면으로 상품을 만든다** (`helpers/register.ts`) |
 *
 * 마지막 줄을 「상품이 있으면 열린다」로 두었다가 **잔재 2건 덕분에 우연히 통과하는
 * 상태**를 만들었다. 조건부 단언은 데이터가 없을 때 아무것도 확인하지 않고 초록이
 * 되므로, 그 자리에는 만들어 넣는 절차가 들어가야 한다 — 「아무것도 증명하지 않은
 * 초록색을 만들지 않는다」의 적용이다.
 *
 * > **컷 4b가 그 절차를 화면 왕복으로 바꿨다.** 컷 3의 씨앗은 PostgREST RPC였고
 * > (계약과 같은 함수였으나 화면과 어댑터를 지나지 않았다) 지금은 SCR-302로 자산·시세를
 * > 만들고 SCR-204의 네 단계를 지나 저장한다 — **이 파일이 보는 데이터가 앱이 만든
 * > 것**이다. 계획 §4가 예고한 대체이며 `helpers/seed.ts`는 지웠다.
 *
 * ## 왜 상시 스위트로는 부족한가
 *
 * `page.tsx`는 `server.ts`를 끌어오므로 어떤 스위트의 import 그래프에도 들어갈 수
 * 없다(AQ-23). 파싱은 `lib/forms/query.ts`로 빼서 상시 스위트가 보지만, **파싱
 * 결과가 화면에 닿는지**와 **`notFound()`가 실제로 404 응답이 되는지**는 렌더된
 * 응답에만 있다.
 */

/**
 * React가 넣는 빈 주석을 지운다 — **인접한 텍스트와 표현식 사이에 경계가 생긴다.**
 *
 * `예상 {LABEL}`은 `예상 <!-- -->조기상환`으로 렌더된다(두 자식 노드를 하이드레이션이
 * 구분해야 하므로). 화면에서는 보이지 않지만 `toContain('예상 조기상환')`은 실패한다 —
 * 렌더가 옳은데 단언이 틀리는 경우이고, 실측으로 한 번 걸렸다. `prices.test.ts`가
 * `$ACTION_*` 히든 필드에서 겪은 것과 같은 부류다: **HTML 문자열은 사용자가 보는
 * 것과 같지 않다.**
 */
function visible(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

/** 존재할 수 없는 소유자. 어떤 DB 상태에서도 이 필터의 결과는 0건이다. */
const GHOST_OWNER = '00000000-0000-4000-8000-0000000000ff'

/** 형식은 맞지만 실재하지 않는 상품. `getProduct`가 `null`을 준다. */
const GHOST_PRODUCT = '00000000-0000-4000-8000-0000000000fe'

const EMPTY_NARROWED = '조건에 맞는 상품이 없다'
const EMPTY_TOTAL = '등록된 상품이 없다'

describe('SCR-201 목록', () => {
  let jar: ReturnType<typeof cookieJar>

  beforeAll(async () => {
    jar = await authenticatedJar()
  })

  it('200으로 서고 필터·정렬 폼이 GET이다', async () => {
    const res = await get(PATHS.products, jar)
    expect(res.status).toBe(200)
    const html = await res.text()

    expect(html).toContain('ELS 목록')
    /*
     * **`method="get"`이 이 화면의 설계다.** 폼이 POST가 되면 주소가 상태를 잃고,
     * 그러면 DOC-008 §7.4가 그린 「소유자 필터가 적용된 SCR-201로 이동」이 링크로
     * 표현되지 않는다 — SQ-01이 SCR-501을 만들지 않은 근거가 그 링크다.
     */
    const form = /<form[^>]*action="\/products"[^>]*>/.exec(html)?.[0]
    expect(form, '필터 폼이 없다').toBeDefined()
    expect(form?.toLowerCase()).toContain('method="get"')
  })

  it('KI 상태 선택지가 다섯이다 — AQ-24가 화면까지 왔다', async () => {
    /*
     * 3값이던 시절 `BELOW`·`NO_KI`는 어떤 필터로도 뽑을 수 없었다. 라벨 표를
     * 그대로 도는 것이 요점이다 — 값을 손으로 적으면 그 목록이 세 번째 사본이 되고,
     * AQ-24는 정확히 목록 둘이 갈려서 생긴 결함이었다.
     */
    const html = await (await get(PATHS.products, jar)).text()
    const select = /<select name="kiStatus"[\s\S]*?<\/select>/.exec(html)?.[0]
    expect(select, 'KI 상태 선택 상자가 없다').toBeDefined()

    for (const [value, label] of Object.entries(KI_STATUS_LABELS)) {
      expect(select, `${value} 선택지`).toContain(`value="${value}"`)
      expect(select, `${value} 라벨`).toContain(label)
    }
    // 「전체」 + 다섯
    expect([...select!.matchAll(/<option/g)]).toHaveLength(6)
  })

  it('`BELOW`로 좁힌 상태가 주소에서 폼으로 되살아난다', async () => {
    const res = await get(`${PATHS.products}?${FILTER_KEYS.kiStatus}=BELOW`, jar)
    expect(res.status).toBe(200)
    const select = /<select name="kiStatus"[\s\S]*?<\/select>/.exec(await res.text())?.[0]
    // 선택 상태가 유지되지 않으면 사용자가 지금 무엇으로 좁혀 보고 있는지 모른다.
    expect(select).toMatch(/value="BELOW"[^>]*selected/)
  })

  it('빈 상태 두 갈래를 구분한다 — 실재하지 않는 소유자로 좁힌다', async () => {
    /*
     * ★ 이 단언이 DOC-008 §6의 「조건에 맞는 상품 없음 / 전체 없음(**구분**)」을
     * 지킨다. 한 문구로 뭉치면 사용자가 필터가 걸린 것을 모른 채 상품을 하나 더
     * 만들고 그것도 목록에 나타나지 않는다.
     *
     * 결과 0건이 **데이터와 무관하게 보장된다**는 것이 이 픽스처를 고른 이유다.
     */
    const html = await (
      await get(`${PATHS.products}?${FILTER_KEYS.ownerId}=${GHOST_OWNER}`, jar)
    ).text()

    expect(html).toContain(EMPTY_NARROWED)
    expect(html).not.toContain(EMPTY_TOTAL)
    // ST-02 — 좁힌 쪽의 다음 행동은 필터 해제이고 등록이 아니다.
    expect(html).toContain('필터 초기화')
  })

  it('조작된 주소가 오류가 되지 않는다', async () => {
    // 링크 하나가 앱을 막지 않는다. 인식하지 못한 값은 그 축이 「전체」가 된다.
    const res = await get(
      `${PATHS.products}?status=BOGUS&kiStatus=NOPE&sortBy=NAME&ownerId=zzz`,
      jar,
    )
    expect(res.status).toBe(200)
    const html = await res.text()
    // 좁혀지지 않았으므로 「조건에 맞는 상품 없음」이 나올 수 없다.
    expect(html).not.toContain(EMPTY_NARROWED)
    expect(html).toContain(STATUS_LABELS.ACTIVE)
  })

  it('`+ 등록`이 404로 가지 않는다', async () => {
    /*
     * DOC-008 §5는 이 버튼을 「항상 노출」로 규정하고 §7.1은 SCR-201을 등록 흐름의
     * 유일한 출발점으로 그린다. 대상 화면은 컷 4a에 서지만 **주소는 지금 살아 있어야
     * 한다** — 404는 사용자에게 「아직 없다」가 아니라 「주소가 틀렸다」로 읽힌다.
     */
    expect(await (await get(PATHS.products, jar)).text()).toContain(
      `href="${PATHS.productNew}"`,
    )
    expect((await get(PATHS.productNew, jar)).status).toBe(200)
  })
})

describe('SCR-202 상세', () => {
  let jar: ReturnType<typeof cookieJar>
  let seeded: RegisteredProduct

  beforeAll(async () => {
    jar = await authenticatedJar()
    // ★ 컷 4b — **화면으로 만든다.** `helpers/seed.ts`(PostgREST RPC)를 지웠다.
    seeded = await registerProduct(jar)
  })

  it('미존재는 404다 — 계약의 `null`을 화면이 변환한다', async () => {
    // DOC-008 §6: SCR-202의 에러는 「미존재 → SCR-901」이다. 조회 계약은 예외를
    // 던지지 않고 `null`을 주므로(§3.1) 변환은 화면의 일이다.
    const res = await get(`/products/${GHOST_PRODUCT}`, jar)
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('페이지를 찾을 수 없다')
  })

  it('UUID가 아닌 id도 404다 — 500이 아니다', async () => {
    /*
     * ★ **음성 대조를 했다.** 형식 가드를 지우면 이 요청이 **500**이 된다(실측) —
     * `getProduct('abc')`는 `null`이 아니라 예외이고, PostgREST가 `uuid` 열에 대한
     * 비-UUID 비교를 `22P02`로 거부하기 때문이다. 같은 대조에서
     * `/products/<없는 uuid>`는 가드가 있든 없든 404였다. 즉 이 케이스만이 두
     * 구현을 가르며, 그래서 픽스처가 `abc`다.
     *
     * 주소를 손으로 고쳐 들어온 사용자가 일반 오류 화면을 보면 §6이 정한 표면과
     * 다르고, 오류 표면이 넓어지면 진짜 결함의 신호가 그 안에 묻힌다.
     */
    const res = await get('/products/abc', jar)
    expect(res.status).toBe(404)
  })

  it('목록에서 상세로 가는 링크가 실재한다', async () => {
    /*
     * **조건부로 두지 않는다.** 처음에는 「상품이 있으면 열린다」로 썼고 통과했는데,
     * 통과한 이유가 앞 스위트가 남긴 잔재 2건이었다(`resetFixtures()`가 자기 것을
     * 지우므로 순서에 따라 0건이 된다). 그 우연이 사라지는 실행에서는 아무것도
     * 확인하지 않고 초록이 되므로 화면으로 만들어 넣는다(`helpers/register.ts`).
     */
    const html = await (await get(PATHS.products, jar)).text()
    expect(html).toContain(`href="/products/${seeded.productId}"`)
    expect(html).toContain(seeded.productName)
  })

  it('상세가 200으로 서고 §5의 여섯 요소가 나온다', async () => {
    const res = await get(`/products/${seeded.productId}`, jar)
    expect(res.status).toBe(200)
    const detail = await res.text()

    // 제목이 있는 절 다섯. 절이 사라지면 여기서 걸린다.
    for (const heading of [
      '기본 정보',
      '기초자산',
      'KI 상태',
      '차수별 평가 조건',
      '예상 수령액 · 과세소득',
    ]) {
      expect(detail, heading).toContain(heading)
    }

    // 판정이 계약에서 와서 화면에 닿았다 — 워스트오브 120%, KI 배리어 50% → 안전
    expect(detail).toContain(percent(seeded.worstOfRatio))
    expect(detail).toContain(KI_STATUS_LABELS.SAFE)
    // 적용 차수의 판정. 1.2 ≥ 0.85이므로 조기상환이고 **추정값**이다(ST-05).
    expect(visible(detail)).toContain(`예상 ${CONDITION_RESULT_LABELS.EARLY}`)
    // 상환 실적이 없으므로 그 절은 렌더되지 않는다.
    expect(detail).not.toContain('상환 실적')
  })

  it('일괄 입력한 배리어가 차수마다 저장되어 상세에 나온다 — SQ-04', async () => {
    /*
     * ★ 이 상품의 배리어는 `90-85-80` **한 줄로** 입력되었다(SQ-04의 일괄 입력).
     * 그 문자열이 차수별 칸으로 펼쳐지고, 퍼센트가 소수로 정규화되어 저장되고,
     * 다시 퍼센트로 표시되기까지가 세 계층을 지난다 — 한 계층만 봐도 옳아 보이는
     * 경로다(`parseBarrierList` → `percentToRatio` → `ratioString` → `percent`).
     */
    const detail = await (await get(`/products/${seeded.productId}`, jar)).text()

    for (const barrier of seeded.barriers) {
      // 화면 표기는 포매터가 만든다 — 기대값을 손으로 적지 않는다.
      expect(detail, `${barrier}% 배리어`).toContain(percent(percentToRatio(barrier)))
    }
    // 2차의 리자드 조건도 함께 저장되었다(차수표의 `<details>` 안이다).
    expect(detail).toContain(percent(percentToRatio('60')))
  })

  it('기준가 18자리가 화면 왕복에서 보존된다 — AQ-30의 값 경로', async () => {
    /*
     * ★ **화면을 지나는 경로에서 처음 확인한다.** P3b 7단계의 실측은 계약 계층까지였다
     * (`asset_prices.price`에 JSON 수치로 실으면 `99999999999.999999`가
     * `100000000000.000000`으로 저장된다). 컷 4b가 그 앞에 두 계층을 더 붙였다 —
     * 사용자가 적은 문자열이 폼을 지나고(`amountText`가 쉼표를 지운다) `jsonb`로
     * 실려 `->>` + `::numeric`이 된다.
     *
     * `numeric(15,0)` 금액(원금)으로는 이 결함이 **영원히 드러나지 않는다** —
     * 15자리까지 float64로 정확하기 때문이다. 그래서 픽스처가 `numeric(18,6)`인
     * 기준가이고 유효숫자가 18자리다.
     */
    const detail = await (await get(`/products/${seeded.productId}`, jar)).text()
    expect(detail).toContain(priceDisplay(seeded.basePrice))

    // 원금도 왕복한다 — 쉼표를 적어 넣었고 15자리 그대로 저장되었다.
    expect(detail).toContain(won('123456789012345'))
  })

  it('액션 버튼이 아직 없다 — 컷 5·6이 붙인다', async () => {
    /*
     * 「없음」을 단언하는 이유는 **없는 라우트로 가는 링크를 미리 두지 않았다**는
     * 것을 고정하기 위해서다. 컷 5·6이 그 화면을 세우면 이 단언이 빨간불이 되어
     * 「이제 버튼을 달아라」고 말한다 — `NOT_YET_BUILT` 원장과 같은 형태다.
     *
     * ST-04(숨김 vs 비활성화)를 증명하는 것은 **아니다.** 요소의 부재는 HTML
     * 문자열로 `hidden` 클래스와 구분되지 않는다(AQ-32).
     */
    const detail = await (await get(`/products/${seeded.productId}`, jar)).text()
    expect(detail).not.toContain(`/products/${seeded.productId}/edit`)
    expect(detail).not.toContain(`/products/${seeded.productId}/redeem`)
  })
})
