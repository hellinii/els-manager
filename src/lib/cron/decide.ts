/**
 * 배치 엔드포인트의 «사전» 판정 — DOC-011 §7.1 CR-01·CR-06·CR-10
 *
 * ## 판정이 셋으로 «줄었다» (P5a 컷 3)
 *
 * 종전에는 넷(CR-01·06·07·08)이었고 그중 CR-07·CR-08은 §5.8의 판정을 **미러**한 것이었다.
 * 미러가 필요했던 이유는 「라우트는 세션이 없어 §5.8을 호출할 수 없다」였고(§7.1 CR-08),
 * **AQ-57이 ⓐ(전용 서비스 계정)로 닫히면서 그 전제가 사라졌다** — 라우트가
 * `MutationContext`를 조립할 수 있으므로 §5.8을 **호출한다.**
 *
 * 그래서 이 모듈은 **세션을 얻기 «전»에 결정되는 것만** 다룬다:
 *   - CR-06 — `CRON_SECRET`이 없다 (배포 결함)
 *   - CR-01 — 토큰이 틀리다 (외부 호출)
 *   - CR-10 — 배치가 필요한 자격증명이 없다 (배포 결함)
 * 그 셋이 아니면 **`{ proceed: true }`**이고, 그 뒤의 판정(CR-02·07·08)은 §5.8의 반환을
 * `respond.ts`가 상태 코드로 옮긴다.
 *
 * ★ **미러가 사라진 것이 이 컷의 순이익이다.** 종전에는 같은 문구가 두 곳에 있었고
 * `tests/app/cron.decide.test.ts`가 그 둘을 **글자 단위로** 대조해야 했다. 이제 문구가
 * 한 곳에만 있으므로 그 대조가 «필요 없다» — 갈릴 수 있는 두 벌이 애초에 없다.
 *
 * ## 200을 여기서 «표현할 수 없다»
 *
 * 성공 갈래는 `status`를 갖지 않는 `{ proceed: true }`다. 그래서 「판정에 200이 없다」가
 * 케이스가 아니라 **타입**이 된다 — `decide(x).status`를 쓰면 컴파일이 실패한다.
 * 종전에는 그것을 런타임 케이스로 단언했는데 그 케이스는 `CASES`만 순회하므로
 * **200 갈래를 추가해도 초록이었다**(즉 아무것도 막지 못했다).
 *
 * ## 순수하다
 *
 * 환경도 시계도 레지스트리도 읽지 않는다 — 전부 인자다. 그것이 이 파일의 존재 이유이며
 * 라우트는 어느 상시 스위트의 import 그래프에도 없다(AQ-23).
 */

/** §7.1 동작 규칙의 ID. 문서에 없는 ID를 만들지 않는다 — 그 대조는 테스트가 한다. */
export type CronRule = 'CR-01' | 'CR-06' | 'CR-10'

/**
 * 사전 판정의 거부.
 *
 * **`rule`이 판별자다.** `status`만으로는 CR-06·CR-10이 같은 500이라 갈리지 않고,
 * 그 둘을 구분하는 것이 각 규칙의 존재 이유다 — 「비밀이 없다」와 「자격증명이 없다」는
 * 고치는 «변수»가 다르다. `code`는 §3.2의 어휘만 쓴다.
 */
export type CronRefusal =
  | { rule: 'CR-06'; status: 500; code: 'INTERNAL'; message: string }
  | { rule: 'CR-01'; status: 401; code: 'UNAUTHENTICATED'; message: string }
  | { rule: 'CR-10'; status: 500; code: 'INTERNAL'; message: string }

/** 사전 판정을 통과했다 — **`status`가 «없다»**(위 「200을 표현할 수 없다」) */
export type CronProceed = { proceed: true }

export type CronVerdict = CronRefusal | CronProceed

export type CronRequest = {
  /** `Authorization` 헤더의 원문. 없으면 `null` */
  header: string | null
  /** `CRON_SECRET`. 읽기가 던졌으면 `null`(라우트가 잡아서 넘긴다) */
  secret: string | null
  /**
   * **부재한 자격증명의 «이름»들** — 값은 절대 넘기지 않는다.
   *
   * 두 출처가 있다: ⓐ 전용 서비스 계정(`CRON_SERVICE_EMAIL`·`CRON_SERVICE_PASSWORD`)
   * ⓑ 자격증명을 요구하는 공급자의 키. **둘 다 배포 결함이고 고치는 사람이 같으므로**
   * 한 규칙(CR-10)으로 답한다.
   *
   * 비어 있으면 통과다.
   */
  missingCredentials: readonly string[]
}

/** Vercel이 붙이는 형태. 접두사를 상수로 두는 이유는 비교가 한 자리여야 하기 때문이다. */
const SCHEME = 'Bearer '

/** 사전 판정을 통과했는지 — 호출부가 `'proceed' in v`를 쓰지 않게 한다 */
export function isRefusal(verdict: CronVerdict): verdict is CronRefusal {
  return !('proceed' in verdict)
}

/**
 * ★ **순서가 규칙이다.** CR-06 → CR-01 → CR-10.
 *
 * ① **비밀 부재를 먼저 본다.** 뒤집으면 「비밀이 없는 배포」에 토큰 없이 온 요청이 **401**을
 * 받는데 그것이 CR-06이 금지한 상태 그 자체다(배포 결함이 외부 호출처럼 보인다). 그리고
 * 빈 비밀에서는 더 나쁘다: `Bearer ` 로 시작하는 아무 헤더나 통과해 **인증이 조용히 사라진다.**
 *
 * ② **CR-10을 인증 «뒤»에 둔다.** 앞에 두면 토큰 없는 외부 호출에 **부재한 변수 이름을
 * 알려 주게 된다** — 그 목록은 배포 구성의 정보이고 미인증 호출자에게 줄 것이 아니다.
 * (응답 본문에는 이름을 싣지 않지만 상태 코드가 500/401로 갈리는 것 자체가 신호가 된다.)
 *
 * 그 상호작용 셀들을 `tests/app/cron.decide.test.ts`가 직접 본다 — 순서에 의존하는
 * 초록색을 만들지 않는다.
 */
export function decide({
  header,
  secret,
  missingCredentials,
}: CronRequest): CronVerdict {
  if (secret == null || secret.trim() === '') {
    return {
      rule: 'CR-06',
      status: 500,
      code: 'INTERNAL',
      message: '배치 비밀이 설정되지 않았다. 배포 설정을 확인한다.',
    }
  }

  /*
   * 상수 시간 비교를 쓰지 않는다 — `node:crypto`가 필요하고 그러면 이 모듈이 순수하지
   * 않게 된다. 근거는 규모다(A-01): 비밀은 16자 이상 난수이고 호출자는 하루 한 번이며
   * 응답 시간에 실린 정보로 그것을 복원하려면 수만 번의 요청이 필요하다. **막지 않기로
   * 한 것을 적어 두는 것이 이 주석의 목적이다** — 조용히 빠진 방어와 구분되게.
   */
  if (header !== `${SCHEME}${secret}`) {
    return {
      rule: 'CR-01',
      status: 401,
      code: 'UNAUTHENTICATED',
      message: '인증되지 않았다.',
    }
  }

  /*
   * CR-10 — 「공급자가 없다」와 「자격증명이 없다」는 다른 상태다. 후자를 503
   * (`PROVIDER_UNAVAILABLE`)로 답하면 사용자는 「수동 입력으로 갱신한다」를 듣는데
   * **고칠 것은 환경변수 하나**이고, 그러면 영구히 수동 입력을 하게 된다.
   * CR-06과 같은 명제의 다른 비밀이므로 같은 부류의 답을 준다.
   */
  if (missingCredentials.length > 0) {
    return {
      rule: 'CR-10',
      status: 500,
      code: 'INTERNAL',
      message: '처리 중 오류가 발생했다.',
    }
  }

  return { proceed: true }
}
