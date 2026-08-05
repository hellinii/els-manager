import { describe, expect, it } from 'vitest'

import { CRON_PATH, E2E_CRON_SECRET, NO_STORE_HEADERS, getCron } from './helpers/cron'
import { BASE_URL } from './helpers/server'

/**
 * 시세 배치 엔드포인트 — DOC-011 §7.1, DOC-013 §6 (P5b 컷 1)
 *
 * ## 여기서만 볼 수 있는 것 셋
 *
 * ① **매처 예외가 실제로 동작한다** — 프록시가 이 경로를 잡으면 307이고 CR-01은 영원히
 * 실행되지 않는다. Vercel Cron은 리다이렉트를 따라가지 않고 3xx는 **로그에도 남지
 * 않으므로**(ADR-006 실측 ⑤) 운영에서는 배치가 조용히 죽는다.
 *
 * ② **응답 헤더 3종의 실제 값**(CR-09). 이것이 이 파일의 **순이익 하나**다 — 저장소에
 * 그 세 헤더를 HTTP에서 **무조건** 단언하는 자리가 없었다. `proxy.test.ts`의 것은
 * `getSetCookie().length > 0` 조건 안에 있어 **아무것도 단언하지 않고 통과할 수 있다**
 * (갱신이 일어나지 않으면 그렇다. 그 조건은 정직하지만 보장은 아니다). cron 응답은
 * 핸들러가 **항상** 싣기 때문에 무조건 단언이 가능한 유일한 자리다.
 *
 * ③ **정적 최적화되지 않았다.** 같은 URL이 `Authorization`에 따라 401과 200으로 갈리는
 * 것이 그 증거다 — 빌드에 구워진 응답은 요청 헤더를 볼 수 없다.
 *
 * ## 여기서 보지 않는 것
 *
 * **「`CRON_SECRET` 미설정 → 500」(CR-06)은 이 층에서 결정적이지 않다** — `next start`가
 * `.env.local`을 읽으므로 개발자 기계에 달려 있다. 그래서 스위트가 값을 주입해 「설정됨」을
 * 고정하고(`helpers/cron.ts`) 그 갈래는 `tests/app/cron.decide.test.ts`가 전수로 본다.
 * **CR-10(자격증명 부재)도 같다** — 스위트가 시드 계정을 주입하므로 그쪽도 「설정됨」이다.
 *
 * ## ★ 이 파일은 «네트워크에 나갈 수 있다** — 그 사실을 숨기지 않는다 (P5a 컷 3)
 *
 * 200 경로는 실제 수집이므로, 매핑된 자산이 하나라도 있으면 라우트가 **키움 es040에
 * 실제로 요청한다.** 즉 이 파일은 다른 e2e 파일과 달리 **완전히 봉인되어 있지 않다.**
 *
 * 그래서 **단언을 네트워크 결과와 무관하게** 짠다: 상태 코드 · 본문의 «형태» · 불변식
 * (`targetCount === succeeded + skipped + unmapped + failed.length`) · 재호출의 멱등성.
 * 「몇 건이 성공했는가」는 단언하지 «않는다» — 그것을 단언하면 휴장일이나 원천 장애에
 * 스위트가 빨간불이 되고, 그 빨간불은 **우리 코드에 대해 아무것도 말하지 않는다.**
 *
 * 값의 검증은 다른 층이 한다: 어댑터 파싱은 `tests/providers/kiwoom.test.ts`(고정 픽스처),
 * 분기표는 `tests/cron/collect.test.ts`(스텁), 왕복은 `tests/integration/collect.test.ts`.
 */

type ErrorBody = { code: string; message: string; rule: string }

describe('인증 — CR-01', () => {
  it('토큰이 없으면 401이다 — 307도 404도 아니다', async () => {
    /*
     * ★ **세 단언이 서로를 보완한다.** 「307이 아니다」만 쓰면 **404여도 통과한다**
     * (라우트가 사라져도 초록이다). 「404가 아니다」만 쓰면 307이 통과한다. 그리고 401은
     * 그 둘을 배제하지만 매처 결함과 라우트 부재를 **구분해 주지 않는다** — 무엇이 틀렸는지가
     * 진단의 절반이므로 셋을 함께 남긴다.
     *
     * P5b 컷 1 이전에는 이 자리가 **404**였고 `proxy.test.ts`가 그것을 조건과 함께 적어
     * 두었다(「라우트는 아직 없으므로 404가 정답이며, 307이면 매처 결함이다」).
     */
    const res = await getCron()
    expect(res.status).not.toBe(307)
    expect(res.status).not.toBe(404)
    expect(res.status).toBe(401)

    const body = (await res.json()) as ErrorBody
    expect(body.rule).toBe('CR-01')
    expect(body.code).toBe('UNAUTHENTICATED')
  })

  it('틀린 토큰도 401이다 — 같은 응답이다', async () => {
    /*
     * 「비밀이 없다」와 달리 여기는 고칠 것이 없다. 두 상태의 응답이 갈리는 것이 CR-06이다.
     *
     * ★ **토큰을 ASCII로 쓴다 *(실측)*.** 초안은 `'Bearer 틀린값'`이었고 `fetch`가
     * **요청을 보내기도 전에** 던졌다 — `TypeError: Cannot convert argument to a ByteString
     * because the character at index 7 has a value of 53952 which is greater than 255`.
     * 헤더 값은 ByteString(latin1)이므로 한글이 들어갈 수 없다. 즉 **`CRON_SECRET`은
     * ASCII여야 한다** — 비ASCII 값을 넣으면 401이 아니라 호출자 쪽에서 죽고, Vercel
     * 로그에는 요청 자체가 남지 않는다. DOC-013 §6.3에 그 제약을 적었다.
     */
    const res = await getCron('Bearer wrong-token-value')
    expect(res.status).toBe(401)
    expect(((await res.json()) as ErrorBody).rule).toBe('CR-01')
  })

  it('스킴 없이 값만 보내면 401이다', async () => {
    const res = await getCron(E2E_CRON_SECRET)
    expect(res.status).toBe(401)
  })
})

type CronBody = {
  executedAt: string
  targetCount: number
  succeeded: number
  skipped: number
  unmapped: number
  failed: Array<{ assetId: string; reason: string; failure: string }>
}

describe('수집 — 200 경로 (P5a 컷 3)', () => {
  it('맞는 토큰은 200이고 본문이 `CronResult`다', async () => {
    /*
     * ★ **이 케이스는 종전 「503 · CR-07」이었고, 그것이 배포 첫날부터 P5a까지의
     * «설계된 정상 응답»이었다**(DOC-013 §6.4 — R-05의 의도된 이탈). 컷 3이 공급자를
     * 등재하면서 그 갈래가 사라졌고, **이 케이스가 빨간불이 된 것이 그 신호였다.**
     *
     * CR-07 자체는 살아 있다(레지스트리를 비우고 배포하는 경로가 있다). 그 사상표는
     * `tests/cron/respond.test.ts`가 전수로 보고, 여기서는 **실제 배포 형상**을 본다.
     */
    const res = await getCron(`Bearer ${E2E_CRON_SECRET}`)
    expect(res.status).toBe(200)

    const body = (await res.json()) as CronBody

    // 형태 — 여섯 필드가 «전부» 있다. 하나가 없으면 화면·모니터링이 조용히 갈린다
    expect(typeof body.executedAt).toBe('string')
    expect(typeof body.targetCount).toBe('number')
    expect(typeof body.succeeded).toBe('number')
    expect(typeof body.skipped).toBe('number')
    expect(typeof body.unmapped).toBe('number')
    expect(Array.isArray(body.failed)).toBe(true)

    /*
     * ★★ **불변식을 실 HTTP에서 본다.** DB는 이것을 **부등식으로만** 잡고(I-19 —
     * `failed`가 JSONB라 단일 행 CHECK에서 길이를 셀 수 없다) 등식을 강제하는 층이
     * `lib/cron/collect.ts`뿐이다. 즉 이 한 줄이 그 순수 함수가 **실제 배포 형상에서도**
     * 성립하는지 보는 유일한 자리다.
     */
    expect(body.succeeded + body.skipped + body.unmapped + body.failed.length).toBe(
      body.targetCount,
    )
  })

  it('★ 재호출이 «상태를 바꾸지 않는다» — 같은 응답이 아니다', async () => {
    /*
     * ★ **종전 문언은 「재호출이 같은 응답을 준다」였고 그것이 설계상 «거짓»이 됐다.**
     * ⓐ `executedAt`이 다르다 ⓑ CR-05가 첫 호출의 `succeeded`를 둘째 호출에서
     * `skipped`로 바꾼다. 그래서 **패치할 테스트가 아니라 증거다** — CR-04 ⓑ가 「지금」을
     * 알려 주고 「그때」를 알려 주지 않는다는 것의 실측이며, `cron_runs`의 첫 번째 근거를
     * 보강한다(응답은 재현되지 않고 기록만 남는다).
     *
     * 멱등성(CR-03)이 말하는 것은 **응답의 동일성이 아니라 상태의 불변**이다.
     * 관측 가능한 그 형태는 「대상 수가 같다」와 「새로 쓴 것이 늘지 않는다」다.
     */
    const first = (await (await getCron(`Bearer ${E2E_CRON_SECRET}`)).json()) as CronBody
    const second = (await (await getCron(`Bearer ${E2E_CRON_SECRET}`)).json()) as CronBody

    expect(second.targetCount).toBe(first.targetCount)
    /*
     * 둘째 호출은 **아무것도 새로 쓰지 않는다** — 첫 호출이 쓴 좌표가 이미 있으므로
     * CR-05의 사전 확인이 걸린다. 그래서 `succeeded`가 0이고, 첫 호출의 성공분이
     * `skipped`로 옮겨 간다.
     */
    expect(second.succeeded).toBe(0)
    expect(second.skipped).toBeGreaterThanOrEqual(first.skipped)
    expect(second.unmapped).toBe(first.unmapped)

    // `executedAt`은 «다르다» — 그것이 위 ★의 내용이다
    expect(second.executedAt).not.toBe(first.executedAt)
  })

  it('부분 실패도 200이다 — 비2xx로 바꾸지 않는다 (CR-02)', async () => {
    /*
     * `failed[]`가 비어 있지 않아도 응답은 `ok`다. 매핑이 없으면 `unmapped`이고 그것도
     * 실패가 아니다(ADR-007 — 수동 입력은 설계된 정상 경로). **어느 쪽이든 200이며**,
     * 그래서 이 단언은 네트워크 결과와 무관하다.
     */
    const res = await getCron(`Bearer ${E2E_CRON_SECRET}`)
    expect(res.status).toBe(200)
  })
})

describe('캐시 금지 헤더 — CR-09 (무조건 단언)', () => {
  it.each([
    ['토큰 없음(401)', undefined],
    ['맞는 토큰(200)', `Bearer ${E2E_CRON_SECRET}`],
  ] as const)('%s 응답에 세 헤더가 실린다', async (_why, authorization) => {
    /*
     * ★ **조건 없이 단언한다.** 캐시되면 ⓐ 배치가 조용히 안 돌고 ⓑ **Vercel 로그에도
     * 남지 않는다**(실측 ⑤) — 즉 캐시 사고는 자기 흔적을 지운다. 그래서 이 세 줄이 이
     * 파일에서 가장 비싼 값을 갖는다.
     *
     * 갈래마다 본다: 헤더를 성공 경로에만 실으면 401·5xx가 캐시될 수 있다. 그래서
     * `respond.ts`가 헤더를 **반환값의 일부**로 만들고 라우트는 그것을 그대로 싣는다 —
     * 라우트가 갈래마다 고르면 한 갈래에서 빠질 수 있다(`tests/cron/respond.test.ts`가
     * 여섯 갈래 전부에서 같은 세 헤더를 단언한다).
     */
    const res = await getCron(authorization)
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
      expect(res.headers.get(name), `${name}`).toBe(value)
    }
  })

  it('같은 URL이 헤더에 따라 갈린다 — 응답이 요청마다 계산된다', async () => {
    /*
     * 빌드에 구워진 응답은 요청 헤더를 볼 수 없으므로 두 상태가 같아진다. 즉 이 단언은
     * **동적 렌더가 실제로 일어났음**을 증명한다.
     *
     * ★ **그러나 `export const dynamic = 'force-dynamic'`이 있음을 증명하지는 않는다
     * *(실측)*.** 그 줄을 지우고 이 파일을 돌리면 **10건이 전부 초록이다** — 핸들러가
     * `request.headers`를 읽으면 Next가 그것만으로 동적으로 판정하기 때문이다. 그래서
     * 선언의 유무는 **소스 단언**이 본다(`tests/app/invalidation.test.ts`의
     * `ROUTE_HANDLERS.forcesDynamic`). 두 층이 서로 다른 것을 증명하며, 그 구분을 적어 두지
     * 않으면 이 케이스가 있는 것만으로 선언이 지켜진다고 읽힌다.
     */
    const anonymous = await getCron()
    const authorized = await getCron(`Bearer ${E2E_CRON_SECRET}`)
    expect(anonymous.status).not.toBe(authorized.status)
  })

  it('본문이 JSON이다 — 진단이 본문에 있으므로 형식도 계약이다', async () => {
    const res = await getCron(`Bearer ${E2E_CRON_SECRET}`)
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})

describe('메서드', () => {
  it('`POST`는 정의되지 않았다 — 플랫폼이 `GET`으로 부른다', async () => {
    /*
     * `GET`만 내보낸다. `POST`를 함께 열어 두면 §7.1이 정의하지 않은 진입점이 생기고,
     * 그 경로는 프록시 매처 밖이므로 세션 판정도 지나지 않는다. Next가 미정의 메서드에
     * 무엇을 내는지는 **실측값**이며 여기서 고정한다.
     */
    const res = await fetch(`${BASE_URL}${CRON_PATH}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { Authorization: `Bearer ${E2E_CRON_SECRET}` },
    })
    expect(res.status).toBe(405)
  })
})
