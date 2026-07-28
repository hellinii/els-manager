import { resolveAnonKey, resolveApiUrl } from '../../integration/helpers/env'
import { ITG_EMAIL, ITG_PASSWORD, ITG_USER_A } from '../../integration/helpers/fixtures'

/**
 * 상품 하나를 **계약과 같은 함수로** 만든다 — SCR-202가 열리는지 보려면 상품이 있어야 한다
 *
 * ## 왜 씨앗이 필요한가
 *
 * 이 스위트는 픽스처를 가진 다른 스위트에 의존할 수 없다. `tests/integration/`의
 * `resetFixtures()`가 자기 것을 지우므로, 실행 순서에 따라 상품이 0건인 상태로
 * 이 스위트가 돌 수 있다. 그때 「상품이 있으면 상세가 열린다」류의 조건부 단언은
 * **조용히 아무것도 확인하지 않고 초록이 된다.** 실제로 그렇게 썼다가 남의 스위트가
 * 남긴 잔재 2건 덕분에 우연히 통과하는 상태를 만들었다 — 그 우연이 사라지는 실행이
 * 있다는 사실이 결함이다.
 *
 * ## 왜 화면으로 만들지 않는가
 *
 * `tests/e2e/prices.test.ts`는 자산·시세를 **화면으로** 만든다. 그편이 언제나
 * 낫지만 상품 등록 화면(SCR-204)은 컷 4b에 선다. 컷 4b가 오면 이 헬퍼의 자리에
 * 왕복(등록 → 목록 → 상세)이 들어오고 그때 이 파일은 지워진다.
 *
 * ## 계약이 쓰는 것과 같은 경로다
 *
 * `create_els_product`는 `authenticated`에게만 `EXECUTE`가 열려 있고
 * `SECURITY INVOKER`이므로 **RLS가 그대로 적용된다.** 실제 JWT로 부르므로
 * `owner_id`는 함수가 `auth.uid()`로 박는다 — 씨앗이 특권으로 만든 상태가 아니다.
 * 그래서 V-04·V-07·V-09는 함수가 보지 않으며(DOC-011 AQ-29) 페이로드가 구조로
 * 만족시킨다: 차수는 1부터 연속, 평가일은 발행일 뒤로 단조 증가, 자산은 하나.
 *
 * ## 정리하지 않는다
 *
 * `prices.test.ts`와 같은 규율이다 — 이름에 타임스탬프를 붙여 다른 스위트의 단언과
 * 충돌하지 않게 하고, 실행 후에는 `db:reset`으로 정리한다(CLAUDE.md의 실행 순서가
 * integration → e2e → reset인 이유). 이 스위트에는 전역 건수 단언이 없으므로
 * 누적이 다른 단언을 깨지 않는다.
 */

export type SeededProduct = {
  productId: string
  productName: string
  assetId: string
  assetName: string
  /** 워스트오브가 이 값이 된다 — `기준가 × 1.2` (기준가 100, 시세 120) */
  worstOfRatio: string
}

const STAMP = String(Date.now()).slice(-6)

async function accessToken(): Promise<string> {
  const res = await fetch(`${resolveApiUrl()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: resolveAnonKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ITG_EMAIL[ITG_USER_A], password: ITG_PASSWORD }),
  })
  if (!res.ok) {
    throw new Error(`씨앗용 로그인이 실패했다: ${res.status}\n  npm run db:reset`)
  }
  const body = (await res.json()) as { access_token?: string }
  if (body.access_token == null) throw new Error('access_token이 없다')
  return body.access_token
}

async function post(path: string, token: string, payload: unknown): Promise<Response> {
  return fetch(`${resolveApiUrl()}/rest/v1${path}`, {
    method: 'POST',
    headers: {
      apikey: resolveAnonKey(),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  })
}

/**
 * 발행일과 평가일 — **연도를 오늘에서 파생시킨다.**
 *
 * 고정 연도를 박으면 그 해가 지나는 순간 전 차수가 경과해 `nextEvaluation`이
 * `null`이 되고, 상세 화면의 `projection` 절이 조용히 다른 분기를 렌더한다.
 * 「시각이 데이터인 테스트」의 함정이며 `prices.test.ts`가 앞자리 0으로 한 번 겪었다.
 */
function dates(): { issueDate: string; evaluations: string[] } {
  const year = new Date().getUTCFullYear()
  return {
    issueDate: `${year}-01-02`,
    evaluations: [`${year + 1}-01-15`, `${year + 1}-07-15`, `${year + 2}-01-15`],
  }
}

export async function seedProduct(): Promise<SeededProduct> {
  const token = await accessToken()

  // 이름 대역을 예약한다 — `assets_name_market_key`는 UNIQUE NULLS NOT DISTINCT다.
  const assetId = crypto.randomUUID()
  const assetName = `[E2E] 자산${STAMP}`

  const asset = await post('/assets', token, {
    id: assetId,
    name: assetName,
    asset_type: 'INDEX',
    market: 'KRX',
    currency: 'KRW',
  })
  if (!asset.ok) throw new Error(`씨앗 자산 생성 실패: ${asset.status} ${await asset.text()}`)

  // 시세가 있어야 워스트오브가 나오고 상세의 `VALUED` 분기가 렌더된다.
  const price = await post('/asset_prices', token, {
    asset_id: assetId,
    as_of_date: new Date().toISOString().slice(0, 10),
    price: '120.000000',
    source: 'MANUAL',
  })
  if (!price.ok) throw new Error(`씨앗 시세 생성 실패: ${price.status} ${await price.text()}`)

  const productName = `[E2E] 상품${STAMP}`
  const { issueDate, evaluations } = dates()
  const rpc = await fetch(`${resolveApiUrl()}/rest/v1/rpc/create_els_product`, {
    method: 'POST',
    headers: {
      apikey: resolveAnonKey(),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payload: {
        name: productName,
        issuer: 'E2E증권',
        issueDate,
        // 금액·비율은 **문자열**이다 — JSON 수치로 보내면 float64를 경유한 값이
        // 되고, `->>`가 그것을 되살리지 못한다(W-04).
        principal: '10000000',
        evaluationPeriodMonths: 6,
        annualCouponRate: '0.0800',
        kiBarrier: '0.5000',
        kiObservation: 'CLOSING',
        accountType: 'GENERAL',
        note: null,
        underlyings: [{ assetId, basePrice: '100.000000', sequence: 1 }],
        schedules: evaluations.map((evaluationDate, index) => ({
          roundNo: index + 1,
          evaluationDate,
          barrier: index === 0 ? '0.9000' : index === 1 ? '0.8500' : '0.8000',
          lizardBarrier: index === 1 ? '0.6000' : null,
          lizardCouponRate: index === 1 ? '0.0300' : null,
          lizardRequiresNoKi: index === 1 ? true : null,
        })),
      },
    }),
  })
  if (!rpc.ok) throw new Error(`씨앗 상품 생성 실패: ${rpc.status} ${await rpc.text()}`)

  const productId = (await rpc.json()) as unknown
  if (typeof productId !== 'string') {
    throw new Error(`create_els_product가 uuid를 주지 않았다: ${String(productId)}`)
  }

  return { productId, productName, assetId, assetName, worstOfRatio: '1.2000' }
}
