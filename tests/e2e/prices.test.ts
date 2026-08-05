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

/**
 * 매핑 `<details>`의 `<summary>`만 잘라낸다 — 거기에 «저장된 현재값»이 렌더된다.
 *
 * 행 전체로 심볼 문자열을 물으면 입력의 `placeholder`·안내 문구가 그 단언을 항상
 * 참으로 만든다(실제로 그렇게 빨간불이 났다). 행 단위로 좁히는 `rowFor`와 같은 논거를
 * 한 단계 더 적용한다.
 */
function summaryOf(row: string): string {
  return /<summary\b[\s\S]*?<\/summary>/.exec(row)?.[0] ?? ''
}

describe('자산 등록 → 시세 입력', () => {
  let jar: ReturnType<typeof cookieJar>
  let createAssetId: string
  let savePriceId: string
  let saveMappingId: string

  beforeAll(async () => {
    jar = await authenticatedJar()
    createAssetId = actionIdOf('createAssetAction')
    savePriceId = actionIdOf('saveManualPriceAction')
    saveMappingId = actionIdOf('saveProviderSymbolAction')
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

  it('매핑이 없으면 「자동 수집 안 함」 표식이 그 줄에 있다 — SQ-08의 자리', async () => {
    /*
     * ★ **표식이 «있는» 것이 확인 대상이다.** 없으면 「자동 수집되지 않는 것」과
     * 「자동 수집되는데 값이 아직 없는 것」이 화면에서 같게 보이고 사용자가 감시되고
     * 있다고 오해한다 — ST-06의 형태이며 DOC-008 SQ-08이 지목한 자리다.
     */
    const html = rowFor(await (await get(PATHS.prices, jar)).text(), ASSET_NAME)
    expect(html).toContain('자동 수집 안 함')
  })

  it('매핑을 저장하면 표식이 사라지고 값이 그 줄에 남는다', async () => {
    const html = rowFor(await (await get(PATHS.prices, jar)).text(), ASSET_NAME)
    const assetId = hiddenValue(html, saveMappingId, 'assetId')
    const provider = hiddenValue(html, saveMappingId, 'provider')
    // 히든이 실제로 공급자 id를 나른다 — 화면이 그 값을 만들어 낸다는 것의 확인
    expect(provider).toBe('KIWOOM_ES040')

    const res = await submitAction(PATHS.prices, jar, [
      ...formFieldsFor(html, saveMappingId),
      ['assetId', assetId],
      ['provider', provider],
      ['providerSymbol', '3:AAPL'],
    ])
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('공급자 매핑을 저장했다.')

    const after = rowFor(await (await get(PATHS.prices, jar)).text(), ASSET_NAME)
    /*
     * ★ **`<summary>`에서 «렌더된 현재값»을 읽는다 — 행 전체를 묻지 않는다.**
     * 처음에는 `after`에 `'3:AAPL'`이 있는지 물었는데, 그것은 입력의 `placeholder`
     * 예시에도 있어서 **저장 여부와 무관하게 항상 참**이었다(해제 케이스가 그것으로
     * 빨간불이 났다). 계기가 명제를 판별하지 못한 자리이며, 좁히는 것이 답이다.
     */
    expect(summaryOf(after)).toContain('3:AAPL')
    // 표식이 사라진다 — 저장된 상태가 화면에 반영된다
    expect(after).not.toContain('자동 수집 안 함')
  })

  it('★ 빈 칸으로 제출하면 «해제»다 — 지우기 버튼 없이 삭제된다', async () => {
    const html = rowFor(await (await get(PATHS.prices, jar)).text(), ASSET_NAME)
    const res = await submitAction(PATHS.prices, jar, [
      ...formFieldsFor(html, saveMappingId),
      ['assetId', hiddenValue(html, saveMappingId, 'assetId')],
      ['provider', hiddenValue(html, saveMappingId, 'provider')],
      ['providerSymbol', ''],
    ])
    expect(res.status).toBe(200)
    // 해제와 저장을 같은 문구로 말하지 않는다 — 사용자가 한 조작이 다르다
    expect(await res.text()).toContain('자동 수집을 해제했다.')

    const after = rowFor(await (await get(PATHS.prices, jar)).text(), ASSET_NAME)
    expect(summaryOf(after)).not.toContain('3:AAPL')
    expect(after).toContain('자동 수집 안 함')
  })

  it('두 번 해제해도 오류가 아니다 — 이미 없는 것을 없애는 요청', async () => {
    /*
     * §5.12가 해제에 `requireAffected`를 걸지 «않는» 이유의 확인이다. 걸면 0행이
     * `CONFLICT`가 되고 그 오류에는 사용자가 고칠 것이 없다(§5.9가 같은 판단).
     */
    const html = rowFor(await (await get(PATHS.prices, jar)).text(), ASSET_NAME)
    const res = await submitAction(PATHS.prices, jar, [
      ...formFieldsFor(html, saveMappingId),
      ['assetId', hiddenValue(html, saveMappingId, 'assetId')],
      ['provider', hiddenValue(html, saveMappingId, 'provider')],
      ['providerSymbol', ''],
    ])
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('자동 수집을 해제했다.')
  })

  it('모르는 공급자는 V-21이 거부한다 — 형식은 맞고 소속이 틀렸다', async () => {
    /*
     * 이 요청은 히든의 값을 «바꿔» 보낸다 — 화면은 옳은 값을 넣지만 계약이 그것에
     * 기대지 않는다는 것의 확인이다. 저장되면 그 매핑은 영구히 쓰이지 않는 행이 되고
     * 화면은 「자동 수집됨」으로 읽힌다.
     */
    const html = rowFor(await (await get(PATHS.prices, jar)).text(), ASSET_NAME)
    /*
     * ★ **히든을 «걸러내고» 넣는다 — 뒤에 덧붙이면 덮이지 않는다.**
     *
     * 처음에는 `...formFieldsFor(...)` 뒤에 `['provider', 'KIWOOM_ES04']`를 덧붙였다.
     * 그런데 `FormData`에 같은 키가 둘이면 `form.get()`은 **첫 번째**를 준다 —
     * 즉 화면의 «옳은» 값이 이기고 저장이 **성공**했다. 그 상태에서 이 케이스는
     * 「V-21이 거부한다」를 단언하면서 실제로는 정상 저장을 시험하고 있었다.
     *
     * **부류: 덮어쓰려는 의도가 조용히 무효가 됐다.** 빨간불이 난 것이 다행이며,
     * 만약 단언이 「저장되지 않았다」쪽만 있었다면 그것도 통과했을 수 있다.
     */
    const withoutProvider = formFieldsFor(html, saveMappingId).filter(
      ([key]) => key !== 'provider',
    )
    const res = await submitAction(PATHS.prices, jar, [
      ...withoutProvider,
      ['assetId', hiddenValue(html, saveMappingId, 'assetId')],
      ['provider', 'KIWOOM_ES04'], // 마지막 0이 빠졌다
      ['providerSymbol', '3:AAPL'],
    ])
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('아는 공급자가 아니다')

    // 저장되지 «않았다» — 요약에 심볼이 없고 표식이 그대로다
    const after = rowFor(await (await get(PATHS.prices, jar)).text(), ASSET_NAME)
    expect(summaryOf(after)).not.toContain('3:AAPL')
    expect(after).toContain('자동 수집 안 함')
  })

  it('★ 전체 갱신이 «실제로 수집한다» — 결과가 문구가 되고 경보가 아니다', async () => {
    /*
     * ★ **이 케이스는 종전 「공급자가 없으므로 폴백 안내다 — ST-03」이었다.**
     * §5.8이 `PROVIDER_UNAVAILABLE`을 주던 동안 「수동 입력으로 갱신한다」를 단언했고,
     * 컷 3이 키움을 등재하면서 **그 갈래가 사라졌다** — 이 케이스가 빨간불이 된 것이
     * 그 신호였다(`expected … to contain '수동 입력으로 갱신한다'`).
     *
     * ST-03의 요구는 살아 있다: 이 문구는 **경보가 아니다.** 부분 실패도 `ok`이므로
     * (CR-02) `role`이 `status`여야 하고, 그것을 `alert`로 바꾸면 **건강한 부분 실패가
     * 전면 실패로 보인다.**
     *
     * ## 건수를 단언하지 «않는다»
     *
     * `loadProducts`가 전역이므로(모든 SELECT 정책이 `using (true)`) 대상 수가 **다른 e2e
     * 파일의 실행 여부에 달려 있다.** 그것을 값으로 단언하면 파일 순서가 데이터가 되고,
     * 그것이 AQ-34가 전용 사용자를 만든 이유 그 자체다. 그래서 **문구의 «형태»만** 본다.
     */
    const html = await (await get(PATHS.prices, jar)).text()
    const refreshId = actionIdOf('refreshPricesAction')

    const res = await submitAction(PATHS.prices, jar, [
      ...formFieldsFor(html, refreshId),
    ])
    expect(res.status).toBe(200)
    const rendered = await res.text()

    // ① 폴백 갈래가 «사라졌다» — 공급자가 등재되어 있다는 것의 HTTP 관측
    expect(rendered).not.toContain('수동 입력으로 갱신한다')

    /*
     * ② `refreshSummary`가 낼 수 있는 형태 전부를 열거해 그중 하나인 `<p>`를 찾는다.
     *
     * **태그로 잡아야 한다** — 문구의 첫 등장은 `$ACTION_*` 히든 필드에 직렬화된
     * `FormState`일 수 있다(다음 제출을 위해 상태가 폼에 실린다). 그리고 열거를 손으로
     * 적으므로, `refreshSummary`에 다섯째 형태가 생기면 여기가 빨간불이 된다.
     */
    const SHAPES = /^(?:갱신 대상이 없다\.|새로 \d+건|이미 최신 \d+건|자동 수집 안 함 \d+건|실패 \d+건)/
    const paragraphs = [...rendered.matchAll(/<p\b[^>]*>([^<]*)<\/p>/g)]
    const summary = paragraphs.find((m) => SHAPES.test(m[1]!.trim()))

    expect(summary, `갱신 결과 문구를 찾지 못했다: ${paragraphs.map((m) => m[1]).join(' | ')}`)
      .toBeDefined()

    /*
     * ③ 폴백이든 성공이든 `status`다 — 이 문구가 `alert`로 나가면 스크린리더가 경보로
     * 읽고 사용자가 자기 잘못이라고 이해한다(ST-03이 막으려는 것).
     */
    expect(summary![0]).toContain('role="status"')
    expect(summary![0]).not.toContain('role="alert"')
  })
})
