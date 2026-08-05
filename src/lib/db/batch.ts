import { signInServiceAccount } from '@/lib/auth/session'

import { createTokenClient } from './client'
import { cronServiceAccount } from './env'
import type { MutationContext } from './mutations/context'
import { fail, ok, type ActionResult } from './mutations/result'

/**
 * 배치의 변경 컨텍스트 조립 — AQ-57 ⓐ, DOC-010 §7.2, DOC-013 §7
 *
 * ## 이 파일이 존재하는 이유가 «미러의 소멸»이다
 *
 * 종전 설계(AQ-57 미결)에서는 배치가 세션을 얻을 수 없었다. 그래서 라우트가 §5.8을
 * **호출하지 못하고** 그 판정을 `decide()`에 **베껴 두어야** 했고, 같은 문구가 두 곳에
 * 살면서 갈릴 수 있었다(§7.1 CR-08이 그 위험을 각주로 적었다).
 *
 * ⓐ를 택하면서 그 전제가 사라진다 — **배치가 GoTrue 계정을 가지므로 다른 사용자와
 * 정확히 같은 방식으로** `MutationContext`를 조립한다. 그 결과가 이 20여 줄이고,
 * 대가로 `cron.decide.test.ts`의 「글자까지 같다」 대조 블록이 **필요 없어졌다.**
 *
 * ## `service_role`이 여기 없다 — 그것이 영구 상태가 된다
 *
 * 배치는 `authenticated`로 돈다. 즉 **RLS 정책 32개가 배치에도 적용된다.**
 * `service_role`(`rolbypassrls = t`)을 쓰면 그 32개가 배치 경로에서 통째로 무효가 되고,
 * 그 사실은 **정책 테스트가 전부 초록인 채로** 참이 된다(테스트는 롤 안의 분리만 본다).
 *
 * ★ **다만 「최소권한」을 단서 없이 적지 않는다.** ⓐ는 **우회(bypass) 의미에서** 최소이고
 * **RLS 의미에서는 아니다** — 배치의 폭발 반경은 정확히 `authenticated`의 것이며,
 * 그 롤은 남의 상품을 `select`할 수 있다(모든 SELECT 정책이 `using (true)`다).
 * `service_role`-0권한보다 넓고 `service_role`-우회보다 훨씬 좁다. **AQ-68**에 등재했다
 * (DOC-013 §11 — 「대가를 단서 없이 두지 않는다」).
 *
 * ## 프레임워크를 import하지 않는다
 *
 * `next/headers`도 `next/cache`도 없다. 그래서 이 파일은 라우트와 달리 **테스트 그래프
 * 안**에 있고, 조립 순서가 바뀌면 타입이 잡는다.
 */

/**
 * 환경 → GoTrue → 토큰 클라이언트 → `MutationContext`.
 *
 * ## `Mutations`가 아니라 `MutationContext`를 돌려준다
 *
 * 배치가 부르는 것은 §5.8이 «아니라» 그 공통 코어(`collectAndRecord`)다 — 두 계약의 반환
 * 필드 집합이 갈리므로 한쪽이 다른 쪽을 부를 수 없다(`mutations/collect.ts`의 ★★★).
 * 그래서 필요한 것이 계약 묶음이 아니라 컨텍스트이고, **`viewerId`가 곧 `actor_id`다** —
 * 별도로 돌려주지 않는 이유는 두 값이 갈릴 자리를 만들지 않는 것이다.
 *
 * ★ **`missingCredentials`를 여기서 «판정하지 않는다».** 부재는 `cronServiceAccount()`가
 * 값으로 답하고, 그것을 CR-10으로 옮기는 것은 `decide()`다 — 즉 라우트가 **이 함수를
 * 부르기 전에** 이미 갈렸다. 여기서 다시 판정하면 같은 규칙이 두 곳에 살게 되고,
 * 그것이 이 파일이 없애려고 만들어진 형태 그 자체다.
 *
 * 그래도 **부재를 조용히 통과시키지는 않는다** — 아래 `INTERNAL`이 그 자리이며 정상
 * 경로에서는 도달하지 않는다(도달하면 라우트가 순서를 어겼다는 뜻이다).
 */
export async function batchContext(asOf: string): Promise<ActionResult<MutationContext>> {
  const { account } = cronServiceAccount()

  if (account == null) {
    console.error(
      '[cron] 서비스 계정 자격증명이 없는데 배치 컨텍스트를 조립하려 했다 — ' +
        'CR-10이 이 상태를 먼저 걸러야 한다 (DOC-011 §7.1).',
    )
    return fail('INTERNAL', '처리 중 오류가 발생했다.')
  }

  const signedIn = await signInServiceAccount(account)
  if (!signedIn.ok) return fail(signedIn.error.code, signedIn.error.message)

  /*
   * `createTokenClient`를 쓴다 — 쿠키가 없으므로 `createSessionClient`는 매 요청
   * 세션을 다시 얻으려 한다. 이쪽은 토큰을 그대로 싣고 `.auth`가 던지는 Proxy가 되는데
   * **배치에는 그 경로가 필요 없다**(id를 로그인 응답에서 이미 받았다).
   */
  const db = createTokenClient(signedIn.data.accessToken)

  return ok({ db, asOf, viewerId: signedIn.data.userId })
}
