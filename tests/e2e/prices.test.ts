import { beforeAll, describe, expect, it } from 'vitest'

import { priceDisplay } from '@/lib/format'
import { PATHS } from '@/lib/routes/paths'

import { actionIdOf, formFieldsFor, hiddenValue, submitAction } from './helpers/actions'
import { authenticatedJar } from './helpers/auth'
import { cookieJar, get } from './helpers/server'

/**
 * SCR-302 시세 관리 — **폼 → 어댑터 → 계약 → 화면의 왕복** (P4 컷 1b)
 *
 * 이 컷의 종료 조건이 「자산·시세를 앱으로 입력할 수 있다」이고, 그 주장을 실행으로
 * 확인하는 층이 여기뿐이다 — 상시 스위트는 렌더하지 않고 PostgREST 스위트는 Next를
 * 지나지 않으므로 **어댑터(`app/(app)/prices/actions.ts`)는 어느 쪽 import 그래프에도
 * 들어가지 못한다**(AQ-23). 브라우저는 쓰지 않는다(`helpers/actions.ts`).
 *
 * > **이 파일은 DB에 쓴다.** `tests/integration/`과 같은 규율을 따른다 — 이름에
 * > 타임스탬프를 붙여 다른 스위트의 단언과 충돌하지 않게 하고, 실행 후 `db:reset`으로
 * > 정리한다(CLAUDE.md의 실행 순서가 integration → e2e → reset인 이유).
 * >
 * > 자산은 삭제 계약이 없으므로(§5에 `deleteAsset`이 없다) 고정 이름을 쓰면 두 번째
 * > 실행이 `CONFLICT`가 된다. 그것을 「스위트가 불안정하다」로 읽지 않도록 매 실행이
 * > 새 이름을 쓴다.
 */

/**
 * 그 자산의 줄만 잘라낸다.
 *
 * **문서 전체에 대한 단언을 쓰지 않는다.** 「시세 없음이 없다」를 페이지 전체로
 * 물으면 다른 픽스처의 시세 없는 자산이 그 단언을 깨뜨린다 — 실제로 integration
 * 스위트를 먼저 돌린 실행에서 그렇게 실패했다. 행 단위 성질은 행에서 묻는다
 * (CLAUDE.md가 "필터 없는 전역 건수 단언"을 경고하는 것과 같은 부류다).
 */
function rowFor(html: string, assetName: string): string {
  const row = [...html.matchAll(/<li\b[\s\S]*?<\/li>/g)]
    .map((m) => m[0])
    .find((candidate) => candidate.includes(assetName))
  if (row == null) throw new Error(`${assetName}의 줄이 목록에 없다`)
  return row
}

/**
 * **앞자리 0을 지운다.** `numeric`은 앞자리 0을 정규화하므로 `045771.5`를 넣으면
 * `45771.500000`이 돌아오고, 기대값을 `045,771.5`로 만들면 6분마다 한 번씩 실패하는
 * 테스트가 된다(실제로 그렇게 한 번 실패했다 — 시각이 데이터인 테스트의 함정이다).
 */
const STAMP = String(Date.now()).slice(-6).replace(/^0+/, '') || '1'
const ASSET_NAME = `e2e시세${STAMP}`
const PRICE = `${STAMP}.5`
/**
 * 화면에 나오는 형태는 **자릿수 쉼표가 붙은** 값이다(`priceDisplay`).
 *
 * 처음에는 입력한 문자열(`716260.5`) 그대로를 문서 전체에서 찾았고 **통과했다** —
 * 그런데 그것이 맞은 곳은 렌더된 칸이 아니라 RSC 페이로드 안의 원본
 * (`"latestPrice":"716260.500000"`)이었다. 줄 단위로 좁히자 드러났다: 렌더된 칸은
 * `716,260.5`다. 포매터를 그대로 불러 기대값을 만든다 — 표시 규칙을 테스트에
 * 두 번 적지 않는다.
 */
const PRICE_SHOWN = priceDisplay(`${PRICE}00000`)

describe('자산 등록 → 시세 입력', () => {
  let jar: ReturnType<typeof cookieJar>
  let createAssetId: string
  let savePriceId: string

  beforeAll(async () => {
    jar = await authenticatedJar()
    createAssetId = actionIdOf('createAssetAction')
    savePriceId = actionIdOf('saveManualPriceAction')
  })

  it('자산을 등록하면 목록에 나타난다', async () => {
    const before = await (await get(PATHS.prices, jar)).text()
    expect(before).not.toContain(ASSET_NAME)

    const res = await submitAction(PATHS.prices, jar, [
      ...formFieldsFor(before, createAssetId),
      ['name', ASSET_NAME],
      ['assetType', 'INDEX'],
      ['currency', 'KRW'],
    ])

    expect(res.status).toBe(200)
    // 액션 응답이 곧 재렌더된 문서다 — 제출 직후 사용자가 보는 화면이다.
    const rendered = await res.text()
    expect(rendered).toContain(ASSET_NAME)
    expect(rendered).toContain('자산을 등록했다.')

    // 그리고 새 문서 요청에도 남는다(저장되었다는 뜻이다).
    expect(await (await get(PATHS.prices, jar)).text()).toContain(ASSET_NAME)
  })

  it('빈 상태가 사라지고 줄마다 시세 폼이 생긴다', async () => {
    const html = await (await get(PATHS.prices, jar)).text()
    // ST-02의 빈 상태는 자산이 하나라도 있으면 나오지 않는다.
    expect(html).not.toContain('등록된 기초자산이 없다')
    // 줄의 폼이 **그 줄의** `assetId`를 들고 있다 — 목록에서 고르는 방식이 아니다.
    expect(hiddenValue(rowFor(html, ASSET_NAME), savePriceId, 'assetId')).toMatch(
      /^[0-9a-f-]{36}$/,
    )
  })

  it('시세를 저장하면 값·출처·기준일이 표시된다', async () => {
    const html = rowFor(await (await get(PATHS.prices, jar)).text(), ASSET_NAME)
    const assetId = hiddenValue(html, savePriceId, 'assetId')
    /*
     * 화면이 계약과 같은 기준일을 보고 있다는 것을 폼의 `max`에서 읽는다(V-17).
     * **태그 전체를 먼저 잡고 그 안에서 찾는다** — React의 속성 순서는 JSX 순서가
     * 아니고(`class`·`value`가 뒤로 간다) `name` 뒤에 `max`가 온다고 가정하면
     * 렌더 결과가 옳은데도 실패한다(첫 시도가 그랬다).
     */
    const dateTag = /<input[^>]*name="asOfDate"[^>]*>/.exec(html)?.[0] ?? ''
    const asOf = /max="(\d{4}-\d{2}-\d{2})"/.exec(dateTag)?.[1]
    expect(asOf, 'asOfDate 입력에 max가 없다 — getAsOf()가 화면에 닿지 않았다').toBeDefined()

    const res = await submitAction(PATHS.prices, jar, [
      ...formFieldsFor(html, savePriceId),
      ['assetId', assetId],
      ['price', PRICE],
      ['asOfDate', asOf!],
    ])
    expect(res.status).toBe(200)

    /*
     * 성공 문구는 **액션 응답에만** 있다. `FormState`는 `useActionState`의 상태이고
     * 새 문서 요청은 초기 상태로 렌더한다 — 처음에 새 GET에서 찾다가 실패했고,
     * 그것이 잘못된 단언이었다(저장은 되었는데 문구의 수명을 오해했다).
     */
    expect(await res.text()).toContain('시세를 저장했다.')

    // 값과 출처는 저장된 것이므로 새 문서에도 남는다 — **그 줄에서** 묻는다.
    const after = rowFor(await (await get(PATHS.prices, jar)).text(), ASSET_NAME)
    expect(after).toContain(PRICE_SHOWN)
    // `source = 'MANUAL'`의 라벨(DOC-005 §6.1). 「시세 없음」은 그 줄에서 사라진다.
    expect(after).toContain('수동')
    expect(after).not.toContain('시세 없음')
    // 갱신 시각도 그 줄에 있다(§4.5 `asOfDate`).
    expect(after).toContain('2026년')
  })

  it('미래 일자는 계약이 거부한다 — V-17이 화면까지 온다', async () => {
    /*
     * `max` 속성은 브라우저의 방어이고 우리는 브라우저가 아니다 — 그래서 이 요청은
     * 계약 계층까지 간다. 거부 문구가 **그 칸에** 붙는 것이 확인 대상이다
     * (§3.2 `VALIDATION_FAILED`의 화면 처리는 "필드별 오류 표시, 입력값 보존").
     */
    const html = rowFor(await (await get(PATHS.prices, jar)).text(), ASSET_NAME)
    const res = await submitAction(PATHS.prices, jar, [
      ...formFieldsFor(html, savePriceId),
      ['assetId', hiddenValue(html, savePriceId, 'assetId')],
      ['price', '123.456'],
      ['asOfDate', '2099-12-31'],
    ])

    const rendered = await res.text()
    expect(res.status).toBe(200) // 오류는 결과 객체다 — 화면을 갈아치우지 않는다
    expect(rendered).toContain('기준일')
    // 입력값 보존 — 거부된 값이 칸에 남는다(W-03의 존재 이유).
    expect(rendered).toContain('2099-12-31')
  })

  it('공급자가 없으므로 전체 갱신은 폴백 안내다 — ST-03', async () => {
    /*
     * §5.8은 공급자 0개인 동안 `PROVIDER_UNAVAILABLE`을 준다. 그것이 **오류로
     * 표시되면 안 된다** — 문구가 수동 입력을 가리키고 `role`이 `alert`가 아니어야
     * 한다. 「오류 = 빨간 박스」를 먼저 만들면 되돌려야 하는 자리였다(계획 §3).
     */
    const html = await (await get(PATHS.prices, jar)).text()
    const refreshId = actionIdOf('refreshPricesAction')

    const res = await submitAction(PATHS.prices, jar, [
      ...formFieldsFor(html, refreshId),
    ])
    const rendered = await res.text()

    expect(rendered).toContain('수동 입력으로 갱신한다')

    /*
     * 폴백 안내는 `status`다 — 이 문구가 `alert`로 나가면 스크린리더가 경보로 읽고
     * 사용자가 자기 잘못이라고 이해한다(ST-03이 막으려는 것).
     *
     * **렌더된 요소를 잡아야 한다.** 처음에는 문구의 첫 등장 앞 300자를 봤는데,
     * 그 첫 등장은 `$ACTION_*` 히든 필드에 직렬화된 `FormState`였다 — 다음 제출을
     * 위해 상태가 폼에 실리기 때문이다. 태그로 잡으면 그 혼동이 없다.
     */
    const paragraph = /<p[^>]*>[^<]*수동 입력으로 갱신한다[^<]*<\/p>/.exec(rendered)?.[0]
    expect(paragraph, '문구가 렌더된 <p>에 없다 — 히든 필드에만 있다').toBeDefined()
    expect(paragraph).toContain('role="status"')
    expect(paragraph).not.toContain('role="alert"')
  })
})
