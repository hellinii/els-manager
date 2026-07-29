import { beforeAll, describe, expect, it } from 'vitest'

import { FORECAST_DEFAULT_YEARS } from '@/lib/db/queries/forecast'
import { PATHS } from '@/lib/routes/paths'

import { authenticatedJar } from './helpers/auth'
import { registerProduct } from './helpers/register'
import { get } from './helpers/server'

/**
 * SCR-402 다년도 전망 — **자리표시가 실화면으로 바뀌었음을 렌더에서 본다** (P4b 컷 8)
 *
 * ## 이 파일이 여기 있는 이유
 *
 * 상시 스위트는 `isForecastEmpty`와 「문서의 ①~⑫ ↔ `keyof ForecastRow`」를 보고, 통합
 * 스위트는 왕복 셋과 필드 형식을 본다. **어느 쪽도 「그 열이 실제로 렌더되는가」를 보지
 * 못한다** — 화면 코드는 상시 스위트의 import 그래프 밖이고(AQ-32) 계약의 필드가 표의
 * 칸이 되는 것은 이 층에만 있다. 계약이 열둘을 담고 화면이 아홉만 렌더해도 저 둘은 전부
 * 초록이다.
 *
 * | 무엇을 | 어떻게 |
 * |---|---|
 * | 자리표시가 사라졌다 | 그 문구의 **부재**를 본다 |
 * | 열 열둘이 있다 | 표 머리글 열둘을 문자열로 본다 |
 * | 행이 여섯이다 | `<tr>` 수를 센다 (기본 `years`) |
 * | 행별 추정 표식이 붙는다 | 자기 상품을 등록한 뒤 본다 |
 * | 진입 링크가 있다 | `/tax`의 문서에서 `href="/forecast"`를 본다 |
 *
 * ## ★ 자기 픽스처를 자기 `beforeAll`에서 만든다 — 초안이 그러지 않았고 실측에서 걸렸다
 *
 * 처음에는 `E2E_PAST`(전 차수 경과 사용자)를 썼다. 그 사용자의 상품은 **`home.test.ts`의
 * `beforeAll`이 만들고** 시드가 만들지 않으므로, `db:reset` 직후 이 파일만 돌리면 그
 * 사용자는 상품이 0건이다. **실측했다** — 전체 스위트에서는 8건 전부 초록이었고
 * `db:reset` 뒤 이 파일만 돌리자 **5건이 빨간불**이 되었다. 즉 그 초록은 실행 순서가
 * 데이터였다.
 *
 * 그래서 `registerProduct`로 이 파일의 상품을 직접 만든다. 소유자는 **공유 사용자**
 * (`ITG_USER_A`)다 — 전용 둘(`E2E_LIVE`·`E2E_PAST`)에 상품을 더하면 `home.test.ts`가
 * 그 둘의 집계를 **값으로** 단언하는 것이 깨진다(AQ-34가 그 둘을 만든 이유가 정확히 그
 * 정확한 단언이었다). 공유 사용자는 이미 여러 파일이 상품을 더하므로 어느 파일도 그
 * 사용자의 전역 집계를 단언하지 않는다.
 *
 * ## 그 선택이 관측할 수 없게 만드는 것 둘 — 등재한다
 *
 * 공유 사용자에게는 **「그 사용자의 모든 상품이 …이다」** 형태를 만들 수 없다. 그래서 둘이
 * 빠진다.
 *
 * | 빠진 것 | 왜 |
 * |---|---|
 * | 빈 상태(`EmptyState`)의 렌더 | 상품 0건 + 금융소득 0인 사용자가 필요하다 |
 * | E-07 원금만으로 빈 상태가 아님 | 유량이 여섯 해 내내 0이어야 하므로 다른 상품이 없어야 한다 |
 *
 * 둘 다 판정은 순수 함수로 떼어져 있고 상시 스위트가 세 축을 전부 본다
 * (`isForecastEmpty` — 특히 잔여 원금 축은 「E-07 상품만 가진 사용자」케이스다). 남는
 * 미검증은 **「그 판정이 그 마크업으로 이어진다」** 한 줄이며, 그중 절반은 `EmptyState`의
 * `action`이 물음표 없는 필수 prop이라 타입이 강제한다(ST-02). 닫는 수단은 전용 시드
 * 사용자를 더하는 것이고 그것이 AQ-34가 쓴 수단이다 — **DOC-010 §9에 등재한다.**
 * 구현하지 않는 것과 분류하지 않는 것은 다르다.
 */

/** 열 열둘 — DOC-008 §5 SCR-402의 마커 순서다. 「표식」 칸은 열거된 열이 아니다. */
const COLUMNS = [
  '연도',
  '세전 회수',
  '그 해 금융소득',
  '종합과세 기준 대비',
  '종합과세 여부',
  '최종 부담률',
  '추가납부',
  '보험료 합계',
  '세후 회수',
  '누적 세후 회수',
  '누적 자산',
  '잔여 원금',
]

function visible(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

/** 표 본문의 줄. 머리글은 `<thead>`에 있으므로 `<tbody>`를 먼저 자른다. */
function bodyRows(html: string): string[] {
  const body = /<tbody\b[\s\S]*?<\/tbody>/.exec(html)?.[0] ?? ''
  return [...body.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map((m) => m[0])
}

describe('SCR-402 — 자리표시가 실화면이 되었다', () => {
  let html = ''
  let taxHtml = ''

  beforeAll(async () => {
    const jar = await authenticatedJar()

    /*
     * **이 파일의 상품을 이 파일이 만든다.** 미상환이므로 적용 차수가 있고(다음 도래
     * 평가일) 그 해에 유량이 생겨 빈 상태 분기를 타지 않는다 — 동시에 연도 말에 남는
     * 미상환 상품이므로 행별 추정 표식이 붙는다. 기본 발행일이 미래 차수를 만든다.
     */
    await registerProduct(jar, { label: '전망', principal: '100,000,000' })

    const res = await get(PATHS.forecast, jar)
    expect(res.status).toBe(200)
    html = visible(await res.text())

    // 진입 링크 케이스도 같은 jar를 쓴다 — 로그인 왕복을 두 번 하지 않는다.
    taxHtml = visible(await (await get(PATHS.tax, jar)).text())
  })

  it('자리표시 문구가 없다', () => {
    /*
     * ★ **부재를 단언하는 것이 이 컷의 종료 조건이다.** `placeholderRoutes()`는 `page.tsx`가
     * `PendingScreen`을 담는지 **소스에서** 세므로, 컴포넌트를 지우고도 같은 문구를 손으로
     * 적으면 원장은 비고 화면은 자리표시로 남는다. 그 갈림은 렌더에만 있다.
     */
    expect(html).not.toContain('아직 만들지 않은 화면')
    expect(html).toContain('다년도 전망')
  })

  it('열 열둘이 표 머리글에 있다', () => {
    const head = /<thead\b[\s\S]*?<\/thead>/.exec(html)?.[0] ?? ''
    expect(head, '<thead>를 찾지 못했다').not.toBe('')

    for (const column of COLUMNS) {
      expect(head, `열 「${column}」`).toContain(column)
    }
  })

  it('행이 기본 연수만큼이다', () => {
    // 상품 0건에서도 `years`개 행이 온다(§4.7) — 행 수가 데이터에 의존하지 않는다.
    expect(bodyRows(html)).toHaveLength(FORECAST_DEFAULT_YEARS)
  })

  it('행별 추정 표식이 붙는다 — 미상환 상품을 가진 사용자다', () => {
    /*
     * 화면 전체 고지와 **다른 축이다**(§7.5). 전체 고지는 「미상환 상품이 하나라도
     * 있다」이고 행 표식은 「그 행의 값이 적용 차수 가정에 의존한다」다. 둘을 하나로 두면
     * 행 표식의 정보량이 0이 되므로 **양쪽이 문서에 함께 있는 것**을 본다.
     */
    expect(html, '화면 전체 고지').toContain('미상환 상품의 회수 시점은 추정이다')
    expect(bodyRows(html).some((row) => row.includes('추정')), '행별 표식').toBe(true)
  })

  it('누적 자산이 건보료 차감 전임을 화면이 말한다', () => {
    // 비준된 결정이다 — 차감하지 않고 **명시한다**. 「보험료 합계」가 옆 칸에 있으므로
    // 적지 않으면 같은 행의 두 숫자가 서로를 부정하는 것으로 보인다.
    expect(html).toContain('건강보험료 차감 전')
  })

  it('세무 신고 자료가 아님을 고지한다 — C-04', () => {
    expect(html).toContain('세무 신고 자료가 아니다')
  })

  it('빈 상태 분기를 타지 않았다 — 표가 있다는 것이 그 증거다', () => {
    /*
     * 위 케이스들의 **전제**를 명시한다. 빈 상태 분기는 표를 통째로 지우므로, 이 파일이
     * 「열 열둘이 있다」·「행이 여섯이다」를 확인했다는 것은 그 분기를 타지 않았다는 뜻이다.
     * 그 사실을 케이스로 박아 두면, 픽스처 등록이 조용히 실패해 빈 상태가 렌더된 날
     * 「`<thead>`를 찾지 못했다」가 아니라 원인을 가리키는 실패가 먼저 나온다.
     */
    expect(html).not.toContain('전망할 데이터가 없다')
  })

  it('`/tax`가 전망으로 가는 링크를 렌더한다 — 사이트맵의 실선이 그 링크다', () => {
    /*
     * ★ **DOC-008 §3의 각주가 이 조건을 먼저 적었다**: 「점선을 실선으로 바꾸는 조건은
     * SCR-401에 진입 링크가 서는 것이다.」 그 전까지 `/forecast`는 UI 링크가 하나도 없어
     * 주소를 직접 적을 때만 도달했고, P4 종료 대조가 그것을 「그 자리표시는 사용자 경로가
     * 아니라 테스트를 만족시키기 위해 있다」로 지목했다.
     *
     * 라우트가 200이라는 것으로는 이 사실을 확인할 수 없다 — 그것이 그 지적의 내용이었다.
     */
    expect(taxHtml).toContain(`href="${PATHS.forecast}"`)
  })
})
