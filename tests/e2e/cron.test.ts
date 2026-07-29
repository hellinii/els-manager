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
 * ③ **정적 최적화되지 않았다.** 같은 URL이 `Authorization`에 따라 401과 503으로 갈리는
 * 것이 그 증거다 — 빌드에 구워진 응답은 요청 헤더를 볼 수 없다.
 *
 * ## 여기서 보지 않는 것
 *
 * **「`CRON_SECRET` 미설정 → 500」(CR-06)은 이 층에서 결정적이지 않다** — `next start`가
 * `.env.local`을 읽으므로 개발자 기계에 달려 있다. 그래서 스위트가 값을 주입해 「설정됨」을
 * 고정하고(`helpers/cron.ts`) 그 갈래는 `tests/app/cron.decide.test.ts`가 전수로 본다.
 * **CR-02(부분 실패)도 없다** — 공급자 0개에서는 부분 실패가 존재하지 않는다(P5a 컷 3).
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

describe('공급자 0개 — CR-07', () => {
  it('맞는 토큰은 503이다 — 200 + 빈 결과가 아니다', async () => {
    /*
     * 배포 첫날부터 P5a가 공급자를 등록할 때까지 **매일 이 응답**이며, 그것이 R-05의
     * 의도된 이탈이다(DOC-013 §6.4). 200으로 답하면 「할 일이 없었다」와 「공급자가
     * 없다」가 같게 보인다.
     */
    const res = await getCron(`Bearer ${E2E_CRON_SECRET}`)
    expect(res.status).toBe(503)

    const body = (await res.json()) as ErrorBody
    expect(body.rule).toBe('CR-07')
    expect(body.code).toBe('PROVIDER_UNAVAILABLE')
    // 이유가 본문에 있다 — 상태 코드만으로는 「무엇이 없는지」가 남지 않는다.
    expect(body.message).toContain('공급자')
  })

  it('재호출이 같은 응답을 준다 — CR-04 ⓑ의 진단이 여기 기댄다', async () => {
    /*
     * 로그 보존이 1시간이므로 진단은 **재호출**이다(멱등성, CR-03). 그 재호출이 상태를
     * 바꾸지 않는다는 것이 전제이며, 공급자 0개 경로는 **DB를 아예 건드리지 않는다**
     * (그것이 DOC-013 §9의 일시정지 위험과 같은 사실의 다른 면이다).
     */
    const first = await getCron(`Bearer ${E2E_CRON_SECRET}`)
    const second = await getCron(`Bearer ${E2E_CRON_SECRET}`)
    expect(second.status).toBe(first.status)
    expect(await second.json()).toEqual(await first.json())
  })
})

describe('캐시 금지 헤더 — CR-09 (무조건 단언)', () => {
  it.each([
    ['토큰 없음(401)', undefined],
    ['맞는 토큰(503)', `Bearer ${E2E_CRON_SECRET}`],
  ] as const)('%s 응답에 세 헤더가 실린다', async (_why, authorization) => {
    /*
     * ★ **조건 없이 단언한다.** 캐시되면 ⓐ 배치가 조용히 안 돌고 ⓑ **Vercel 로그에도
     * 남지 않는다**(실측 ⑤) — 즉 캐시 사고는 자기 흔적을 지운다. 그래서 이 세 줄이 이
     * 파일에서 가장 비싼 값을 갖는다.
     *
     * 갈래마다 본다: 헤더를 성공 경로에만 실으면 401·503이 캐시될 수 있고, cron이 받는
     * 응답은 (P5a 전까지) **전부 그 둘**이다.
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
