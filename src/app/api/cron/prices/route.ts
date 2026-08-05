import { decide, isRefusal } from '@/lib/cron/decide'
import { toCronResult } from '@/lib/cron/report'
import { refusalResponse, resultResponse } from '@/lib/cron/respond'
import { batchContext } from '@/lib/db/batch'
import { cronSecret, cronServiceAccount, missingProviderCredentials } from '@/lib/db/env'
import { collectAndRecord } from '@/lib/db/mutations/collect'
import { fail, ok } from '@/lib/db/mutations/result'
import { today } from '@/lib/db/today'
import { PRICE_PROVIDERS, PROVIDER_CREDENTIALS } from '@/lib/providers/types'

/**
 * 시세 배치 수집 — DOC-011 §7.1, DOC-013 §6
 *
 * **저장소의 첫 Route Handler다.** 그래서 이 파일에는 이 엔드포인트의 규칙보다
 * **부류의 규칙**이 더 많이 적혀 있다 — 다음 핸들러가 같은 함정을 다시 밟지 않게.
 *
 * ## `GET`인 것은 플랫폼 강제다
 *
 * 「To trigger a cron job, Vercel makes an HTTP **GET** request to your project's
 * **production deployment** URL」(ADR-006 실측 ①). `POST`로 정의하면 Cron이 이 경로를
 * 부를 수 없다. `GET`이 부수 효과를 갖는 예외의 정당화 셋은 §7.1 각주에 있다 —
 * ⓐ 메서드를 플랫폼이 고른다 ⓑ 멱등이다(CR-03·CR-05) ⓒ 토큰 없이는 401이다.
 *
 * ## 조용한 죽음 셋을 이 파일이 막는다
 *
 * ① **`dynamic = 'force-dynamic'`.** 없으면 이 라우트가 정적 최적화 대상이 되어
 * 401/503 **본문이 빌드에 구워진다.** 그러면 cron이 영원히 캐시 응답을 받고, 더 나쁘게는
 * **캐시 응답이 Vercel 로그에도 남지 않는다**(실측 ⑤) — 배치가 안 도는데 흔적도 없다.
 *
 * ★ **오늘 이 선언은 잉여다 *(실측)*** — 아래 `GET`이 `request.headers`를 읽으므로 Next가
 * 그것만으로 동적으로 판정한다. 지우고 e2e를 돌리면 10건이 전부 초록이었다. 그래도
 * **남긴다**: 요청을 읽지 않는 핸들러(상수를 돌려주는 것)가 오는 날 그 잉여가 사라지고,
 * 그때 이 줄이 없으면 조용히 구워진다. 선언의 유무는 행동으로 관측되지 않으므로
 * `tests/app/invalidation.test.ts`가 **소스로** 단언한다.
 *
 * ② **캐시 금지 헤더 3종을 직접 싣는다**(CR-09). 서버 액션은 응답이 POST라 Next가
 * 캐시하지 않아 생략이 허용되지만 Route Handler에는 그 보호가 없다(`lib/db/server.ts`의
 * `actionCookies` 주석이 그 비대칭을 적는다). 프록시는 `responseCookieAdapter`로 싣는데
 * **이 경로는 프록시 매처 밖이므로**(그래야 CR-01이 401을 낼 수 있다) 그 경로로도 오지
 * 않는다 — 즉 여기서 싣지 않으면 아무도 싣지 않는다.
 *
 * ③ **비밀을 모듈 스코프에서 읽지 않는다.** 읽으면 `next build`가 프리렌더 수집 시점에
 * 그 코드를 평가해 **변수가 없는 기계에서만 빌드가 깨진다.** 운영에는 변수가 있으므로
 * 그 비대칭이 스스로를 숨긴다 — 로컬에서 「빌드가 왜 깨지지」로 보이고 운영에서는
 * 아무 신호가 없다. 요청 안에서 읽고, 부재는 **응답으로** 답한다(CR-06).
 *
 * ## 판정도 사상도 여기 없다 → `lib/cron/decide.ts` · `lib/cron/respond.ts`
 *
 * 이 파일은 어느 상시 스위트의 import 그래프에도 없다(Next가 실행한다). 분기표를 여기
 * 두면 아무도 전수로 읽지 못하므로 **판정은 순수 모듈**이고 이 파일은 ⓐ 환경 읽기
 * ⓑ 시계 읽기 ⓒ 조립 순서만 한다. 응답의 형태는 `respond.ts`가 값으로 만든다.
 *
 * ## 200 경로가 생겼다 (P5a 컷 3)
 *
 * 배포 첫날부터 이 라우트는 401·500·503만 냈다 — 공급자가 0개였기 때문이다. 지금은
 * ⓐ 서비스 계정으로 로그인해 `MutationContext`를 조립하고 ⓑ §5.8과 **같은 구현**
 * (`collectAndRecord`)을 부르고 ⓒ 그 결과를 `CronResult`로 투영한다.
 *
 * ★ **「§5.8을 호출한다」보다 정확한 서술은 「둘이 같은 구현을 호출한다」다.** 두 계약의
 * 반환 필드 집합이 갈리므로(`targetCount` vs `assetName`) 한쪽이 다른 쪽을 부를 수 없고,
 * 공통 코어 하나 + 투영 둘이 §5.8 각주가 요구한 형태다.
 *
 * ★★ **`revalidatePath`를 부르지 않는다.** 이 라우트는 화면을 렌더하지 않고, `server.ts`의
 * 실측이 그대로다 — 라우트 핸들러에서 부르면 그 무효화가 어느 요청의 캐시에도 닿지
 * 않는다. 화면은 다음 방문에서 `asOf` 기준으로 다시 읽는다. **빠뜨린 것이 아니라 뺀
 * 것이므로 사유를 적는다.**
 */

export const dynamic = 'force-dynamic'

/**
 * 부재를 예외에서 값으로 바꾼다 — `decide()`의 CR-06 갈래가 그것을 받는다.
 *
 * **삼키지만 남긴다.** 메시지에 값은 없고 변수명과 고치는 법만 있다(`env.ts`).
 * 이 로그가 배치 실패의 수단은 아니다 — 보존이 1시간이므로 CR-04는 감지를 데이터에
 * 두고 진단을 재호출에 둔다(§7.1 CR-04 · DOC-013 §7.1).
 */
function readSecret(): string | null {
  try {
    return cronSecret()
  } catch (error) {
    console.error('[cron] 비밀을 읽을 수 없다:', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * 부재한 자격증명의 **이름들** — CR-10의 두 출처를 합친다.
 *
 * ⓐ 전용 서비스 계정 ⓑ 자격증명을 요구하는 공급자의 키. **둘 다 배포 결함이고 고치는
 * 사람이 같으므로** 한 규칙으로 답한다. 오늘 ⓑ는 비어 있다(키움 es040은 자격증명이
 * 없다) — 그 사실이 `PROVIDER_CREDENTIALS`에 값으로 적혀 있다.
 *
 * ★ **응답 본문에 이 이름들을 싣지 않는다.** 배포 구성의 정보이므로 서버 로그로만 간다.
 */
function missingCredentials(): readonly string[] {
  const providerNames = PRICE_PROVIDERS.flatMap((f) => PROVIDER_CREDENTIALS[f.id] ?? [])
  return [...cronServiceAccount().missing, ...missingProviderCredentials(providerNames)]
}

export async function GET(request: Request): Promise<Response> {
  const startedAt = new Date().toISOString()

  const verdict = decide({
    header: request.headers.get('authorization'),
    secret: readSecret(),
    missingCredentials: missingCredentials(),
  })

  if (isRefusal(verdict)) {
    /*
     * 500만 로그한다. 401은 외부 호출이므로 고칠 것이 없고(로그하면 스캐너가 로그를
     * 채운다), 500 둘은 배포 결함이므로 `rule`을 함께 남긴다 — CR-06과 CR-10이 같은
     * 상태 코드이고 `code`도 같은 `INTERNAL`이라 **`rule` 없이는 갈리지 않는다.**
     */
    if (verdict.status === 500) {
      console.error(`[cron] ${verdict.rule}: ${verdict.message}`)
      if (verdict.rule === 'CR-10') {
        // 이름만 남긴다(값이 아니다 — SEC-05). 이것이 CR-10의 진단 내용 전부다.
        console.error(`[cron] 부재한 자격증명: ${missingCredentials().join(', ')}`)
      }
    }

    const response = refusalResponse(verdict)
    return Response.json(response.body, {
      status: response.status,
      headers: response.headers,
    })
  }

  /*
   * ★ **기준일을 여기서 «한 번» 읽는다** — Q-02·W-02가 요구하는 「요청당 한 번」이다.
   * `today()`가 KST를 준다(`lib/db/today.ts`). 공급자가 주는 `as_of_date`와는 다른 값이며
   * 그것이 설계다: 이 값은 **창의 상한**이고 저장되는 날짜는 **관측된 것**이다.
   */
  const asOf = today()

  const result = await (async () => {
    const ctx = await batchContext(asOf)
    if (!ctx.ok) return fail(ctx.error.code, ctx.error.message)

    /*
     * `loadTargets`가 던지면(대상을 열거하지 못했다) 여기서 잡아 CR-08로 답한다 —
     * 부분이 없는 실행은 CR-02의 대상이 아니다. **삼키지 않고 남긴다.**
     */
    try {
      const collected = await collectAndRecord(ctx.data, 'BATCH', {
        startedAt,
        finishedAt: () => new Date().toISOString(),
      })
      if (!collected.ok) return fail(collected.error.code, collected.error.message)
      return ok(toCronResult(collected.data, startedAt))
    } catch (error) {
      console.error(
        `[cron] 수집이 예외로 끝났다: ${error instanceof Error ? error.message : String(error)}`,
      )
      return fail('INTERNAL', '처리 중 오류가 발생했다.')
    }
  })()

  const response = resultResponse(result, startedAt)
  return Response.json(response.body, {
    status: response.status,
    headers: response.headers,
  })
}
