import { decide } from '@/lib/cron/decide'
import { cronSecret } from '@/lib/db/env'
import { PRICE_PROVIDERS } from '@/lib/providers/types'

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
 * ## 판정은 여기 없다 → `lib/cron/decide.ts`
 *
 * 이 파일은 어느 상시 스위트의 import 그래프에도 없다(Next가 실행한다). 분기표를 여기
 * 두면 아무도 전수로 읽지 못하므로 **판정은 순수 모듈**이고 이 파일은 ⓐ 환경 읽기
 * ⓑ 레지스트리 세기 ⓒ 헤더 싣기만 한다. 그 셋이 e2e가 HTTP로 보는 전부다.
 */

export const dynamic = 'force-dynamic'

/**
 * CR-09의 세 헤더. **값을 여기 박는 것이 옳다** — `@supabase/ssr`이 쿠키를 실을 때
 * 주는 것과 같은 세 값이지만(`lib/db/client.ts`) 그것은 라이브러리의 것이고 이 응답에는
 * 쿠키가 없다. 같은 값을 두 곳에서 쓰는 대가로 **계약이 요구하는 값**을 계약 문서와
 * 나란히 읽을 수 있게 둔다(§7.1 CR-09가 이 세 줄을 문자 그대로 적는다).
 */
const NO_STORE: Record<string, string> = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Expires: '0',
  Pragma: 'no-cache',
}

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

export async function GET(request: Request): Promise<Response> {
  const verdict = decide({
    header: request.headers.get('authorization'),
    secret: readSecret(),
    providerCount: PRICE_PROVIDERS.length,
  })

  /*
   * 500만 로그한다. 401은 외부 호출이므로 고칠 것이 없고(로그하면 스캐너가 로그를
   * 채운다), 503은 **설계된 상태**이며 그 보고는 응답 상태 자체다(DOC-013 §6.4).
   * 500 둘은 배포 결함이므로 `rule`을 함께 남긴다 — CR-06과 CR-08이 같은 상태 코드다.
   */
  if (verdict.status === 500) {
    console.error(`[cron] ${verdict.rule}: ${verdict.message}`)
  }

  /*
   * 본문의 스키마는 §7.1이 정의하지 않았다(성공의 `CronResult`만 있다). 그래서 **어휘를
   * 새로 만들지 않는다** — `code`는 §3.2의 것이고 `rule`은 §7.1의 ID다. 진단에 필요한
   * 것이 정확히 이 둘이다: 상태 코드는 CR-06과 CR-08을 구분하지 못한다.
   */
  return Response.json(
    { code: verdict.code, message: verdict.message, rule: verdict.rule },
    { status: verdict.status, headers: NO_STORE },
  )
}
