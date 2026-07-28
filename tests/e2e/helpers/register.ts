import { PATHS } from '@/lib/routes/paths'

import {
  actionIdOf,
  buttonField,
  formFieldsFor,
  formHtmlFor,
  formValuesFor,
  hiddenValue,
  submitAction,
} from './actions'
import { cookieJar, get, locationPath } from './server'

/**
 * 상품 하나를 **화면으로** 만든다 — 등록 → 목록 → 상세의 왕복 (P4 컷 4b)
 *
 * ## `helpers/seed.ts`를 대체하고 그 파일을 지웠다
 *
 * 컷 3의 씨앗은 PostgREST RPC로 상품을 심었다. 계약과 같은 함수였으므로 I-07·CHECK는
 * 강제되었지만 **화면과 어댑터를 지나지 않았다** — 계획이 「SCR-204가 서면 그 자리에
 * 화면 왕복이 들어온다」고 예고한 대로 여기서 바뀐다.
 *
 * 바뀌는 것이 형식만은 아니다. 이 경로는 **폼 → 파서 → 계약 → 함수 → 화면** 전체를
 * 지나므로 다음 넷이 처음으로 실행된다.
 *
 * | 무엇이 | 왜 여기뿐인가 |
 * |---|---|
 * | 단계 폼의 값이 저장까지 살아 있다 | 히든 이송이 빠진 칸은 저장할 때까지 증상이 없다 |
 * | 일괄 배리어가 차수표를 채운다 (SQ-04) | `applyBarriers`는 순수하지만 그 결과가 칸에 닿는지는 렌더에만 있다 |
 * | 금액·비율의 18자리가 보존된다 (AQ-30) | 화면이 쉼표를 지우고 `jsonb`를 지나 `::numeric`이 되는 경로다 |
 * | 성공이 상세로 리다이렉트한다 | `redirect()`의 303은 실 HTTP 응답에만 있다 |
 *
 * ## 크래프트된 POST를 쓰지 않는다
 *
 * 단계를 건너뛰고 모든 필드를 한 번에 보내면 요청 수가 줄지만 **JS 없는 브라우저가
 * 만들 수 없는 요청**이 된다 — 그러면 사용자가 실제로 지나는 경로를 확인하지 못하고,
 * 컷 4a의 음성 대조가 드러낸 것과 같은 부류의 공백이 생긴다(테스트가 브라우저를
 * 흉내내며 브라우저가 그 값을 어디서 얻는지는 보지 않는다). 그래서 다섯 번 제출한다.
 *
 * ## 정리하지 않는다
 *
 * `prices.test.ts`·종전 씨앗과 같은 규율이다 — 이름에 타임스탬프를 붙이고 실행 후
 * `db:reset`으로 정리한다(CLAUDE.md의 순서가 integration → e2e → reset인 이유).
 */

export type RegisteredProduct = {
  productId: string
  productName: string
  assetId: string
  assetName: string
  /** 실제로 입력된 발행일. V-10(상환일 ≥ 발행일)을 만족하는 상환일을 고를 때 쓴다 */
  issueDate: string
  /**
   * 저장된 투자원금 — **쉼표 없는 정수 문자열이다.**
   *
   * 컷 9가 필요해졌다: SCR-101의 `activePrincipal`을 값으로 단언하려면 화면이 입력한
   * 값과 계약이 돌려준 값을 같은 형태로 비교해야 한다. 입력에 쉼표를 붙이는 것은
   * 사용자가 그렇게 적기 때문이고(파서가 지운다) 저장값은 그것이 아니다.
   */
  principal: string
  /** 기준가. **18자리 유효숫자다** — AQ-30의 값 경로를 화면에서 확인한다 */
  basePrice: string
  /** 워스트오브가 이 값이 된다 — 시세 ÷ 기준가 */
  worstOfRatio: string
  /** 일괄 입력으로 채운 배리어(퍼센트 표기) */
  barriers: readonly string[]
}

/**
 * 시세와 기준가 — **워스트오브가 딱 120%가 되게** 고른다.
 *
 * 기준가를 `numeric(18,6)`의 상한 근처로 두는 이유는 AQ-30이다. 실측(P3b 7단계)에서
 * JSON 수치로 실으면 `99999999999.999999`가 `100000000000.000000`으로 저장되었고,
 * 그 경로가 이제 **화면을 지난다**(사용자가 적은 쉼표까지 지나서). `numeric(15,0)`
 * 금액은 15자리까지 float64로 정확하므로 원금으로는 이 결함이 드러나지 않는다.
 */
const BASE_PRICE = '99999999999.999999'
const CURRENT_PRICE = '119999999999.999999' // 기준가 × 1.2 (정확히)

/**
 * 기본 원금 — 쉼표까지 사용자가 적는 형태로 넘긴다(파서가 지운다).
 *
 * 15자리인 이유는 `numeric(15,0)`의 상한 근처를 지나게 하려는 것이다. 컷 9처럼
 * **합계를 손으로 검산**해야 하는 곳은 `principal` 옵션으로 작은 값을 준다 —
 * 15자리 두 개의 합을 테스트에 적으면 그 자릿수가 단언의 주제를 가린다.
 */
const DEFAULT_PRINCIPAL = '123,456,789,012,345'

export async function registerProduct(
  jar: ReturnType<typeof cookieJar>,
  options: {
    /**
     * 발행일을 고정한다 — **컷 6이 필요해졌다.** §5.4의 「시드 이전 연도」는 상환일이
     * 2025년일 때 나오고 V-10이 상환일 ≥ 발행일을 요구하므로, 그 경로를 화면에서
     * 밟으려면 발행일도 2025년이어야 한다. 기본값은 아래 `issueYear()`의 각주 참조.
     */
    issueDate?: string
    /** 접두사. 한 실행에 여러 상품을 만들 때 어느 것인지 구분한다 */
    label?: string
    /**
     * 원금 — **컷 9가 필요해졌다.** SCR-101의 ②③⑤가 합계와 세액을 내므로 그 값을
     * 손으로 검산할 수 있어야 하고, 기본값(15자리)의 합은 단언의 주제를 가린다.
     * 쉼표를 포함해도 된다(사용자가 적는 형태이며 파서가 지운다).
     */
    principal?: string
    /**
     * 계좌유형 — **컷 9가 필요해졌다.** SCR-101 ③의 금융소득을 값으로 단언하려면
     * 「그 해에 기여하는 상품」이 정확히 정해져야 하는데, 미상환 상품의 기여는 적용
     * 차수의 귀속연도에 달려 그 값이 **오늘이 언제인지에 의존한다.** 비과세 계좌는
     * 확정값이 있어도 과세소득이 0이므로(DOC-007 §4.2 — `taxableIncome`의 첫 줄)
     * 그 상품을 `TAX_FREE`로 두면 시각에 의존하지 않는 단언이 된다.
     */
    accountType?: 'GENERAL' | 'TAX_FREE'
  } = {},
): Promise<RegisteredProduct> {
  const stamp = String(Date.now()).slice(-6)
  const suffix = options.label == null ? stamp : `${options.label}${stamp}`
  const assetName = `[E2E] 자산${suffix}`
  const productName = `[E2E] 상품${suffix}`
  const barriers = ['90', '85', '80'] as const
  const principal = options.principal ?? DEFAULT_PRINCIPAL

  const assetId = await createAssetViaScreen(jar, assetName)
  await savePriceViaScreen(jar, assetId)

  const actionId = actionIdOf('productFormAction')
  const issueDate = options.issueDate ?? `${issueYear()}-01-02`

  // ① 기본 정보 → ②
  let html = await (await get(PATHS.productNew, jar)).text()
  html = await advance(jar, html, actionId, 'NEXT', {
    name: productName,
    issuer: 'E2E증권',
    issueDate,
    // 쉼표를 적는다 — 사용자가 그렇게 적으며 파서가 지운다(값은 바뀌지 않는다)
    principal,
    accountType: options.accountType ?? 'GENERAL',
    note: '화면 왕복',
  })

  // ② 기초자산 → ③
  html = await advance(jar, html, actionId, 'NEXT', {
    'underlyings[0].assetId': assetId,
    'underlyings[0].basePrice': BASE_PRICE,
  })

  // ③ 평가 조건 — 일괄 배리어를 적용한다. **총 차수를 비워 개수로 채우게 한다**
  html = await advance(jar, html, actionId, 'APPLY_BARRIERS', {
    evaluationPeriodMonths: '6',
    totalRounds: '',
    annualCouponRate: '8',
    kiBarrier: '50',
    kiObservation: 'CLOSING',
    barriers: barriers.join('-'),
  })

  // 2차에 리자드 조건을 붙인다 — 차수표가 생긴 뒤에만 그 칸이 있다
  html = await advance(jar, html, actionId, 'NEXT', {
    'schedules[1].lizardBarrier': '60',
    'schedules[1].lizardCouponRate': '3',
    'schedules[1].lizardRequiresNoKi': 'on',
  })

  // ④ 확인 → 저장. 성공은 **상세로 가는 리다이렉트**다(DOC-008 §7.1)
  const saved = await submitAction(PATHS.productNew, jar, [
    ...formValuesFor(html, actionId),
    buttonField(formHtmlFor(html, actionId), 'SUBMIT'),
  ])

  if (saved.status !== 303 && saved.status !== 302) {
    throw new Error(
      `저장이 리다이렉트로 끝나지 않았다: ${saved.status}\n` +
        `  화면이 오류를 돌려주었을 수 있다.\n${excerpt(await saved.text())}`,
    )
  }

  const productId = locationPath(saved).replace('/products/', '')
  if (!/^[0-9a-f-]{36}$/.test(productId)) {
    throw new Error(`Location이 상세 경로가 아니다: ${locationPath(saved)}`)
  }

  return {
    productId,
    productName,
    assetId,
    assetName,
    issueDate,
    principal: principal.replace(/,/g, ''),
    basePrice: BASE_PRICE,
    worstOfRatio: '1.2000',
    barriers,
  }
}

/**
 * 그 자산의 시세를 다시 저장한다 — **워스트오브를 원하는 값으로 옮기는 수단** (컷 9)
 *
 * §5.7이 `(asset_id, as_of_date)` UPSERT이므로 같은 날짜로 다시 저장하면 값이 갱신된다.
 * `registerProduct`는 기준가 × 1.2를 넣어 KI 안전 상태를 만들므로, KI 하회 상태가
 * 필요한 곳은 이 함수로 낮춘다 — **화면을 지나므로 V-15·V-17이 그대로 걸린다.**
 *
 * 자산이 상품마다 하나씩 새로 만들어지는 것이 이 함수가 안전한 이유다(이름에
 * 타임스탬프가 붙는다) — 다른 상품의 워스트오브가 함께 움직이지 않는다.
 */
export async function saveAssetPrice(
  jar: ReturnType<typeof cookieJar>,
  assetId: string,
  price: string,
): Promise<void> {
  await savePriceViaScreen(jar, assetId, price)
}

/** 한 단계 제출. 의도는 **렌더된 버튼에서** 읽는다(컷 4a의 음성 대조 참조) */
async function advance(
  jar: ReturnType<typeof cookieJar>,
  html: string,
  actionId: string,
  intent: string,
  fields: Record<string, string>,
): Promise<string> {
  /*
   * **보이는 칸까지 함께 보낸다.** 히든만 복제하면 그 단계에서 사용자가 적은 값이
   * `다음`을 누르는 순간 사라진다 — 실측으로 걸렸고 원인은 앱이 아니라 헬퍼였다
   * (`formValuesFor`의 각주).
   */
  const res = await submitAction(PATHS.productNew, jar, [
    ...formValuesFor(html, actionId),
    ...Object.entries(fields),
    buttonField(formHtmlFor(html, actionId), intent),
  ])

  if (res.status !== 200) {
    throw new Error(`${intent} 제출이 ${res.status}를 냈다`)
  }
  return res.text()
}

/**
 * 발행일 — **올해 1월 2일.** 연도를 오늘에서 파생시킨다.
 *
 * 고정 연도를 박으면 그 해가 지나는 순간 전 차수가 경과해 `nextEvaluation`이 `null`이
 * 되고(E-07) 상세 화면이 **다른 분기를 렌더한다** — 「시각이 데이터인 테스트」의
 * 함정이며 종전 씨앗이 같은 이유로 오늘에서 파생했다.
 *
 * ★ 처음에는 **작년** 1월 2일로 잡았고 실측에서 걸렸다. 6개월 주기 3차수면 마지막
 * 평가일이 발행 + 18개월이므로 작년 1월 발행은 올해 7월에 전부 경과한다(오늘이
 * 7월 28일이었다). 올해 1월 발행이면 마지막 차수가 **내년 7월**이므로 올해의 어느
 * 날에 돌려도 미래 차수가 남는다 — 첫 차수만 경과한 「보유중이며 다음 평가일이 있는」
 * 상품이 되고, 그것이 SCR-202가 판정을 렌더하는 상태다.
 */
function issueYear(): number {
  return new Date().getUTCFullYear()
}

async function createAssetViaScreen(
  jar: ReturnType<typeof cookieJar>,
  assetName: string,
): Promise<string> {
  const createAssetId = actionIdOf('createAssetAction')
  const before = await (await get(PATHS.prices, jar)).text()

  const res = await submitAction(PATHS.prices, jar, [
    ...formFieldsFor(before, createAssetId),
    ['name', assetName],
    ['assetType', 'INDEX'],
    ['market', 'KRX'],
    ['currency', 'KRW'],
  ])
  const after = await res.text()
  if (!after.includes(assetName)) {
    throw new Error(`자산 등록이 목록에 나타나지 않았다\n${excerpt(after)}`)
  }

  // 그 줄의 시세 폼이 자기 `assetId`를 들고 있다 — 목록에서 고르는 방식이 아니다.
  const savePriceId = actionIdOf('saveManualPriceAction')
  return hiddenValue(rowFor(after, assetName), savePriceId, 'assetId')
}

async function savePriceViaScreen(
  jar: ReturnType<typeof cookieJar>,
  assetId: string,
  price: string = CURRENT_PRICE,
): Promise<void> {
  const savePriceId = actionIdOf('saveManualPriceAction')
  const html = await (await get(PATHS.prices, jar)).text()
  const row = rowsFor(html, assetId, savePriceId)

  // 기준일은 화면이 들고 있다(V-17의 `max`) — 우리가 오늘을 계산하지 않는다.
  const dateTag = /<input[^>]*name="asOfDate"[^>]*>/.exec(row)?.[0] ?? ''
  const asOf = /max="(\d{4}-\d{2}-\d{2})"/.exec(dateTag)?.[1]
  if (asOf == null) throw new Error('asOfDate 입력에 max가 없다 — getAsOf()가 화면에 닿지 않았다')

  const res = await submitAction(PATHS.prices, jar, [
    ...formFieldsFor(row, savePriceId),
    ['assetId', assetId],
    ['price', price],
    ['asOfDate', asOf],
  ])
  const after = await res.text()
  if (!after.includes('시세를 저장했다.')) {
    throw new Error(`시세 저장이 실패했다\n${excerpt(after)}`)
  }
}

/** 그 자산의 줄만 잘라낸다 — 문서 전체에 대한 단언을 쓰지 않는다 */
function rowFor(html: string, assetName: string): string {
  const row = [...html.matchAll(/<li\b[\s\S]*?<\/li>/g)]
    .map((m) => m[0])
    .find((candidate) => candidate.includes(assetName))
  if (row == null) throw new Error(`${assetName}의 줄이 목록에 없다`)
  return row
}

function rowsFor(html: string, assetId: string, actionId: string): string {
  const row = [...html.matchAll(/<li\b[\s\S]*?<\/li>/g)]
    .map((m) => m[0])
    .find((candidate) => candidate.includes(assetId) && candidate.includes(actionId))
  if (row == null) throw new Error(`assetId ${assetId}의 줄이 목록에 없다`)
  return row
}

/** 실패 메시지에 붙일 발췌 — 전체 문서는 읽을 수 없다 */
function excerpt(html: string): string {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '')
  const alert = /<div[^>]*role="alert"[^>]*>[\s\S]*?<\/div>/.exec(body)?.[0]
  return (alert ?? body).slice(0, 600)
}
