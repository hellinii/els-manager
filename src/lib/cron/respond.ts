import type { CronRefusal } from './decide'
import type { ActionResult } from '@/lib/db/mutations/result'
import type { CronResult } from '@/lib/db/mutations/types'

/**
 * §5.8의 반환 → HTTP — **순수** — DOC-011 §7.1 CR-02·CR-07·CR-08·CR-09
 *
 * ## 이 파일이 미러를 대체한다
 *
 * 종전에는 `decide()`가 CR-07·CR-08의 문구를 §5.8과 **글자 단위로 같게** 유지해야 했다.
 * 이제 라우트가 §5.8을 «호출»하므로 남는 일은 **그 `ErrorCode`를 상태 코드로 옮기는 것**뿐이고,
 * 문구는 §5.8에만 있다 — 갈릴 수 있는 두 벌이 없다.
 *
 * ## 왜 라우트가 아니라 여기인가
 *
 * 라우트 파일은 어느 상시 스위트의 import 그래프에도 없다(AQ-23 — Next가 실행한다).
 * 사상표를 라우트에 두면 아무도 전수로 읽지 못한다 — `decide()`가 떼어져 있는 것과 같은 이유다.
 */

/** CR-09의 세 헤더. **여기가 정본이다** — 아래 ★ */
export const NO_STORE: Record<string, string> = {
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  Expires: '0',
  Pragma: 'no-cache',
}

export type CronResponse = {
  status: number
  body: Record<string, unknown>
  headers: Record<string, string>
}

/**
 * ★ **헤더를 «무조건» 싣는다** — 성공·실패 어느 갈래에서도 같다.
 *
 * CR-09가 그것을 요구하는 이유는 캐시되면 ⓐ 배치가 조용히 돌지 않고 ⓑ **Vercel 로그에도
 * 남지 않는다**(인용). 그래서 이 함수가 헤더를 «반환값의 일부»로 만들고, 라우트는 그것을
 * 그대로 싣는다 — 라우트가 갈래마다 헤더를 고르면 한 갈래에서 빠질 수 있다.
 */
export function refusalResponse(refusal: CronRefusal): CronResponse {
  return {
    status: refusal.status,
    /*
     * 본문의 스키마는 §7.1이 정의하지 않았다(성공의 `CronResult`만 있다). 그래서 **어휘를
     * 새로 만들지 않는다** — `code`는 §3.2의 것이고 `rule`은 §7.1의 ID다. 진단에 필요한
     * 것이 정확히 이 둘이다: 상태 코드는 CR-06과 CR-10을 구분하지 못한다.
     */
    body: { code: refusal.code, message: refusal.message, rule: refusal.rule },
    headers: NO_STORE,
  }
}

/**
 * §5.8의 결과를 옮긴다.
 *
 * | §5.8이 준 것 | HTTP | 규칙 |
 * |---|---|---|
 * | `ok` | **200** + `CronResult` | CR-02 — 부분 실패도 `ok`다 |
 * | `PROVIDER_UNAVAILABLE` | **503** | CR-07 — 200 + 빈 결과가 아니다 |
 * | 그 밖 (`INTERNAL` 등) | **500** | CR-08 — 배포 결함으로 다룬다 |
 *
 * ★ **`ok`인데 `failed[]`가 비어 있지 않은 것을 오류로 만들지 않는다** — CR-02가
 * 「부분 실패가 전체 배치를 중단시키지 않고 응답은 `ok`」로 정했다. 실패 목록은 본문에
 * 실려 진단에 쓰이며, 그것을 비2xx로 바꾸면 **건강한 부분 실패가 전면 실패로 보인다.**
 */
export function resultResponse(
  result: ActionResult<CronResult>,
  executedAt: string,
): CronResponse {
  if (result.ok) {
    return { status: 200, body: { ...result.data }, headers: NO_STORE }
  }

  const status = result.error.code === 'PROVIDER_UNAVAILABLE' ? 503 : 500
  return {
    status,
    body: {
      code: result.error.code,
      message: result.error.message,
      // 사전 판정이 아니므로 `rule`이 없다 — 어휘를 지어내지 않고 시점을 적는다
      at: executedAt,
    },
    headers: NO_STORE,
  }
}
