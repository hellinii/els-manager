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
import { PRODUCT_ID_FIELD, productFieldNames } from '@/lib/forms/productForm'
import { PATHS } from '@/lib/routes/paths'

import { ITG_USER_B } from '../integration/helpers/fixtures'

import {
  actionIdOf,
  buttonField,
  formFieldsFor,
  formHtmlFor,
  formValuesFor,
  inputNamesOf,
  submitAction,
} from './helpers/actions'
import { authenticatedJar } from './helpers/auth'
import { registerProduct, type RegisteredProduct } from './helpers/register'
import { cookieJar, get, locationPath } from './helpers/server'

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
  /**
   * 계약 조건이 카드에 닿는지 보려면 **값을 아는 상품**이 하나 필요하다 (P6 컷 2).
   * 화면으로 만든다 — 그 경로가 배리어·리자드·기준가를 실제로 저장하는 경로다.
   */
  let product: RegisteredProduct

  beforeAll(async () => {
    jar = await authenticatedJar()
    product = await registerProduct(jar, { label: '목록' })
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

  it('★ 카드가 계약 조건 다섯을 함께 보여준다 — DOC-008 §5 ⑧~⑫', async () => {
    /*
     * ★ **여기서만 보이는 것**: `terms`가 계약에 담기는 것은 `tests/db/map.test.ts`가
     * 보고 표기 규칙은 `tests/app/productList.test.ts`가 본다. 그 둘이 **렌더된
     * 문서에 닿는지**는 이 층에만 있다 — 매퍼가 값을 담고 컴포넌트가 그것을 그리지
     * 않으면 두 파일은 그대로 초록이다.
     *
     * 픽스처는 `registerProduct`가 화면으로 만든 상품이다(배리어 90-85-80, 자산 1종,
     * 연쿠폰 8%, KI 50% 종가, 2차 리자드 60%/쿠폰 3%/KI 미터치).
     */
    const html = await (await get(PATHS.products, jar)).text()

    // ⑧ 기초자산 · 기준가격 — 18자리가 표시 경로에서도 밀리지 않는다(AQ-30)
    expect(html).toContain(product.assetName)
    expect(html).toContain(priceDisplay(product.basePrice))

    /*
     * ⑨⑩ — **요소 경계까지 포함해 단언한다.** `toContain('8%')`는 `'58%'`에도
     * 걸리므로 값이 틀려도 통과할 수 있다. 각 `<dd>`가 문자열 하나를 자식으로
     * 가지므로(React가 사이에 주석을 넣지 않는다) `>…<`가 그 경계다.
     */
    expect(html).toContain('연쿠폰')
    expect(html).toContain(`>${percent(percentToRatio('8'))}<`)
    expect(html).toContain(`>${percent(percentToRatio('50'))} 종가<`)

    // ⑪ 스텝다운 — 토큰마다 요소이므로 문자열 전체가 아니라 라벨과 토큰을 본다
    expect(html).toContain('스텝다운')
    for (const barrier of product.barriers) {
      expect(html, `배리어 ${barrier}`).toContain(`>${barrier}<`)
    }

    // ⑫ 리자드 — 붙은 차수만. 1건이므로 배리어·쿠폰·KI 요구가 함께 나온다
    expect(html).toContain('리자드')
    expect(html).toContain(
      `>2차 ${percent(percentToRatio('60'))} · 쿠폰 ${percent(
        percentToRatio('3'),
      )} · KI 미터치<`,
    )
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
    /*
     * 상환 실적이 없으므로 그 **절**이 렌더되지 않는다.
     *
     * ★ 컷 5에서 이 단언이 잘못된 이유로 빨간불이 되었다 — 삭제 공개의 안내 문구가
     * 「상환 실적이 있으면 삭제되지 않는다」를 적으므로 문서에 그 문자열이 실재한다.
     * 절의 부재는 **제목**으로 봐야 한다(`<h2>상환 실적</h2>`). 문서 전체에 대한
     * `toContain`이 다른 자리에 맞는 부류이며 컷 4a의 「기초자산 1」과 같은 함정이다.
     */
    expect(detail).not.toContain('>상환 실적<')
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

  it('소유자에게 액션 셋이 있다 — `OwnerOnly`의 첫 소비자 (컷 5·6)', async () => {
    /*
     * ★ **이 케이스가 두 번 방향을 바꿨다.** 컷 4b까지는 「액션 버튼이 아직 없다」였고,
     * 컷 5가 수정·삭제를 붙이자 빨간불이 되어 반대 방향으로 고치라고 말했다. 컷 6이
     * 상환 처리를 붙이자 「그것은 여전히 없다」가 다시 빨간불이 되었다 —
     * `NOT_YET_BUILT` 원장과 같은 형태이며, 「미노출」이 ST-04의 적용인지 미구현인지가
     * 그 전환마다 구분된다.
     */
    const detail = await (await get(`/products/${seeded.productId}`, jar)).text()

    expect(detail).toContain(`href="${PATHS.productEdit(seeded.productId)}"`)
    // 미상환 상품이므로 상환 처리가 있다(I-01 — 상환되면 사라진다).
    expect(detail).toContain(`href="${PATHS.productRedeem(seeded.productId)}"`)
    // 삭제는 폼이다 — 링크로 두면 프리페치·크롤러가 상품을 지운다.
    expect(detail).toContain('정말 삭제한다')
  })

  it('타인에게는 그 셋이 없다 — 조회는 되고 액션만 사라진다 (ST-04)', async () => {
    /*
     * ST-04(숨김 vs 비활성화)를 **증명하지는 않는다** — 요소의 부재는 HTML 문자열로
     * `hidden` 클래스와 구분되지 않는다(AQ-32). 여기서 고정하는 것은 `OwnerOnly`가
     * 실제로 소유 판정을 받고 있다는 것이다: 같은 문서에서 조회는 200이고 액션만 없다.
     *
     * **음성 대조가 가능한 픽스처다** — `OwnerOnly`를 벗기면 이 케이스만 빨간불이 되고
     * 위 케이스는 초록으로 남는다(둘의 차이가 소유자 여부 하나다).
     */
    const otherJar = await authenticatedJar(ITG_USER_B)
    const res = await get(`/products/${seeded.productId}`, otherJar)

    expect(res.status).toBe(200)
    const detail = await res.text()
    // 읽기는 허용이다 — 모든 SELECT 정책이 `using (true)`다(DOC-010 §7).
    expect(detail).toContain(seeded.productName)
    expect(detail).toContain('타인의 상품이다')

    expect(detail).not.toContain(`href="${PATHS.productEdit(seeded.productId)}"`)
    expect(detail).not.toContain(`href="${PATHS.productRedeem(seeded.productId)}"`)
    expect(detail).not.toContain('정말 삭제한다')
  })
})

describe('SCR-204 수정 모드 (컷 5)', () => {
  let jar: ReturnType<typeof cookieJar>
  let seeded: RegisteredProduct

  beforeAll(async () => {
    jar = await authenticatedJar()
    seeded = await registerProduct(jar)
  })

  it('★ 저장된 값이 폼의 **모든 칸**에 채워져 온다', async () => {
    /*
     * ★ **이 단언이 §5.2의 전체 교체를 화면에서 막는다.** 수정 저장은 폼이 보내지
     * 않은 필드를 비우므로, 초기값이 닿지 않은 칸이 하나라도 있으면 그 값이 **조용히
     * 사라진다** — 증상은 저장 후 상세 화면에서야 보인다.
     *
     * 상시 스위트가 보는 것은 `productValuesOf`가 `productFieldNames`를 덮는다는
     * 것뿐이다(`tests/app/values.test.ts`). 그 값이 **DOM에 닿는지**는 렌더된 문서에만
     * 있다 — 컴포넌트가 그리지 않으면 값 맵이 옳아도 사라진다. 두 층의 합집합이 방어다.
     *
     * 좌변을 순수 모듈에서 읽어 오므로 테스트에 이름 목록이 다시 적히지 않는다.
     */
    const res = await get(PATHS.productEdit(seeded.productId), jar)
    expect(res.status).toBe(200)
    const html = await res.text()

    const actionId = actionIdOf('productEditFormAction')
    const form = formHtmlFor(html, actionId)
    const rendered = inputNamesOf(form)

    // `registerProduct`가 만드는 형태 — 기초자산 1종, 배리어 3개 = 차수 3
    for (const name of productFieldNames({ underlyings: 1, rounds: 3 })) {
      expect(rendered, `${name}이 렌더되지 않았다`).toContain(name)
    }
    // 대상 id도 폼에 있다 — 없으면 어댑터가 무엇을 고칠지 모른다.
    expect(rendered).toContain(PRODUCT_ID_FIELD)

    // 값이 비어 있지 않다. 「+ 등록 직후의 빈 폼」과 이 화면이 갈리는 지점이다.
    expect(form).toContain(`value="${seeded.productName}"`)
    expect(form).toContain('value="123456789012345"') // 원금 — 쉼표 없이 저장된 값
    expect(form).toContain(`value="${seeded.basePrice}"`) // 18자리 기준가
  })

  it('비율이 퍼센트로 되돌아 온다 — 소수로 보이면 저장이 값을 100으로 나눈다', async () => {
    /*
     * 계약은 `0.9000`을 주고 폼의 칸은 퍼센트다. 옮기지 않으면 화면이 `0.9`를
     * 보여주고 저장이 그것을 다시 나눠 **배리어가 0.009가 된다** — 오류가 나지 않고
     * 값만 밀리는 부류다. ③의 차수표까지 가서 확인한다(그 칸은 히든으로 실려 있다).
     */
    const html = await (await get(PATHS.productEdit(seeded.productId), jar)).text()
    const form = formHtmlFor(html, actionIdOf('productEditFormAction'))

    for (const [index, barrier] of seeded.barriers.entries()) {
      const tag =
        new RegExp(`<input[^>]*name="schedules\\[${index}\\]\\.barrier"[^>]*>`).exec(
          form,
        )?.[0] ?? ''
      expect(tag, `${index + 1}차 배리어`).toContain(`value="${barrier}"`)
    }
    expect(form).toContain('value="8"') // 연쿠폰율 8%
    expect(form).toContain('value="50"') // KI 배리어 50%
  })

  it('★ 상품명만 고쳐 저장하면 나머지가 그대로 남는다', async () => {
    /*
     * ★ **전체 교체의 실측이다.** 한 칸만 고치고 저장한 뒤 상세에서 나머지를 확인한다 —
     * 비고·배리어·기준가·리자드가 그대로면 초기값이 폼을 온전히 지났다는 뜻이다.
     * 「값이 사라졌다」가 이 컷의 유일한 조용한 실패 형태이므로 여기서 실행으로 본다.
     */
    const actionId = actionIdOf('productEditFormAction')
    const editPath = PATHS.productEdit(seeded.productId)
    const html = await (await get(editPath, jar)).text()

    const renamed = `${seeded.productName} 수정됨`
    const saved = await submitAction(editPath, jar, [
      // 브라우저가 보내는 것 전부 — 히든만 보내면 ①의 보이는 칸이 사라진다.
      ...formValuesFor(html, actionId).filter(([name]) => name !== 'name'),
      ['name', renamed],
      buttonField(formHtmlFor(html, actionId), 'SUBMIT'),
    ])

    // 성공은 상세로 가는 리다이렉트다(§7.1) — 등록과 같은 도착지다.
    expect([302, 303]).toContain(saved.status)
    expect(locationPath(saved)).toBe(PATHS.product(seeded.productId))

    const detail = await (await get(PATHS.product(seeded.productId), jar)).text()
    expect(detail).toContain(renamed)
    expect(detail).toContain('화면 왕복') // 비고 — ①에 칸이 있어 살아남았다
    expect(detail).toContain(priceDisplay(seeded.basePrice))
    expect(detail).toContain(won('123456789012345'))
    for (const barrier of seeded.barriers) {
      expect(detail, `${barrier}% 배리어`).toContain(percent(percentToRatio(barrier)))
    }
    // 2차의 리자드 조건도 남았다.
    expect(detail).toContain(percent(percentToRatio('60')))
  })

  it('없는 상품·오타 id는 404다 — 상세와 같은 규칙이다', async () => {
    expect((await get(`/products/${GHOST_PRODUCT}/edit`, jar)).status).toBe(404)
    // 형식 가드가 없으면 500이다(컷 3의 음성 대조가 상세에서 확인한 것과 같은 경로).
    expect((await get('/products/abc/edit', jar)).status).toBe(404)
  })

  it('★ 타인의 수정 주소는 SCR-902다 — 403 화면의 첫 도달 경로', async () => {
    /*
     * ★ 계획 §5는 「902에 도달하는 유일한 길은 소유자 전용 URL을 직접 타이핑하는
     * 것」이라고 적었고 **그 라우트가 컷 5에 처음 생겼다.** 컷 0c가 만든 컴포넌트가
     * 지금까지 소비자 없이 있었으므로 여기서 처음 실행된다.
     *
     * 404가 아니라 902인 것이 요점이다 — 상품은 실재하고 읽을 수도 있다(모든 SELECT
     * 정책이 `using (true)`). 「없다」로 답하면 사용자가 주소를 의심한다.
     */
    const otherJar = await authenticatedJar(ITG_USER_B)
    const res = await get(PATHS.productEdit(seeded.productId), otherJar)

    // 상태 코드는 200이다 — `forbidden()`을 쓰지 않기로 한 결정의 관측 가능한 형태다
    // (`experimental.authInterrupts` 없이는 403을 낼 수 없고, 그 속성은 측정 불가다).
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('권한이 없다')
    expect(html).toContain('이 상품을 수정할')
    // 폼이 렌더되지 않는다 — 채워진 폼을 보여 준 뒤 저장에서 막으면 입력이 버려진다.
    expect(html).not.toContain(PRODUCT_ID_FIELD)
  })
})

describe('SCR-202 삭제 (컷 5)', () => {
  let jar: ReturnType<typeof cookieJar>

  beforeAll(async () => {
    jar = await authenticatedJar()
  })

  it('★ 삭제가 목록으로 보내고 상세가 404가 된다', async () => {
    /*
     * ★ **성공 뒤 상세에 머물면 안 된다.** 그 화면의 `getProduct`가 `null`을 주고
     * `notFound()`가 404를 내므로, 사용자가 방금 한 일의 결과가 「페이지를 찾을 수
     * 없다」로 보인다. DOC-008 §7.1이 삭제의 이탈을 SCR-201로 그린 이유다.
     *
     * 지울 상품을 **이 케이스가 직접 만든다** — 다른 케이스가 쓰는 상품을 지우면
     * 실행 순서가 결과를 정한다.
     *
     * ★ 히든 id를 손으로 적지 않는다(`formFieldsFor`가 렌더된 폼에서 읽는다) — 컷 4a의
     * 음성 대조가 드러낸 함정이 그것이다: 테스트가 값을 얹으면 **화면이 그 값을 어디서
     * 얻는지**를 확인하지 않게 된다.
     */
    const doomed = await registerProduct(jar)
    const detailPath = PATHS.product(doomed.productId)

    const html = await (await get(detailPath, jar)).text()
    const actionId = actionIdOf('deleteProductAction')
    const res = await submitAction(detailPath, jar, formFieldsFor(html, actionId))

    expect([302, 303]).toContain(res.status)
    expect(locationPath(res)).toBe(PATHS.products)

    expect((await get(detailPath, jar)).status).toBe(404)
    expect(await (await get(PATHS.products, jar)).text()).not.toContain(doomed.productName)
  })
})
