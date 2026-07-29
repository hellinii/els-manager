/**
 * 배치 엔드포인트의 응답 판정 — DOC-011 §7.1 CR-01·CR-06·CR-07·CR-08
 *
 * ## 왜 라우트 안이 아니라 여기인가
 *
 * 이유가 둘이고, 둘 다 「관측할 수 있는가」다.
 *
 * ① **라우트 파일은 어느 스위트의 import 그래프에도 없다.** 상시·rls·integration은
 * Next를 지나지 않고 e2e는 HTTP로만 본다. 판정을 라우트에 두면 그 분기표를 아무도
 * 전수로 읽지 못한다 — `queriesFor`·`isNavActive`가 같은 이유로 떼어져 있다(AQ-23).
 *
 * ② **「`CRON_SECRET` 미설정」 갈래는 주변 환경으로 결정적으로 만들 수 없다.**
 * `next start`는 `.env.local`을 읽고 e2e의 `injectEnv()`는 `NEXT_PUBLIC_*` 둘만
 * 넣는다. 즉 「미설정」이 지금 참인 것은 **우연**이며 `.env.example`에 변수가 들어간
 * 뒤로는 기계마다 갈린다. 값으로 넘기면 그 갈래가 인자 하나가 된다.
 *
 * ## 갈래는 넷이고 200은 여기 없다
 *
 * §7.1의 응답 표가 넷이다 — 401(CR-01) · 500(CR-06) · 503(CR-07) · INTERNAL 상당
 * (CR-08). **정상(200)이 없는 것은 누락이 아니다:** `CronResult`를 조립하려면 수집기가
 * 필요하고 그것은 P5a 컷 3이다. 도달 불가한 갈래를 지금 표현하면 그 갈래를 시험하는
 * 케이스가 아무것도 증명하지 않는다.
 *
 * ## §5.8과의 관계 — 정본은 저쪽이다
 *
 * `PROVIDER_UNAVAILABLE` 판정은 `lib/db/mutations/prices.ts`(§5.8)에 이미 있고 **세
 * 갈래**다(공급자 0개 / 등록됐으나 수집 로직 없음 / 그 밖). 라우트는 세션이 없어
 * §5.8을 **호출할 수 없으므로**(`mutationsFor(user, ctx)`를 요구한다) 구조적 분기가
 * 실재한다. 그래서 이 모듈은 **같은 상태에 같은 코드와 같은 문구**를 낸다 — 둘만
 * 미러하면 같은 상태가 UI에서 `INTERNAL`, cron에서 503이 된다. 그 일치를
 * `tests/app/cron.decide.test.ts`가 §5.8의 실제 반환값과 대조한다.
 *
 * ## 순수하다
 *
 * 환경도 시계도 레지스트리도 읽지 않는다 — 셋 다 인자다. 그래서 분기표를 전수로 볼 수
 * 있고, 그것이 이 파일의 존재 이유다.
 */

/** §7.1 동작 규칙의 ID. 문서에 없는 ID를 만들지 않는다 — 그 대조는 테스트가 한다. */
export type CronRule = 'CR-01' | 'CR-06' | 'CR-07' | 'CR-08'

/**
 * 판정 결과.
 *
 * **`rule`이 판별자다.** `status`만으로는 CR-06과 CR-08이 같은 500이라 갈리지 않고,
 * 그 둘을 구분하는 것이 CR-06의 존재 이유 그 자체다(「비밀이 없다」와 「그 밖의 배포
 * 결함」의 조치가 다르다). `code`는 §3.2의 어휘만 쓴다 — §7.1이 오류 본문의 스키마를
 * 정의하지 않았으므로 **새 어휘를 만들지 않는다.**
 */
export type CronVerdict =
  | { rule: 'CR-06'; status: 500; code: 'INTERNAL'; message: string }
  | { rule: 'CR-01'; status: 401; code: 'UNAUTHENTICATED'; message: string }
  | { rule: 'CR-07'; status: 503; code: 'PROVIDER_UNAVAILABLE'; message: string }
  | { rule: 'CR-08'; status: 500; code: 'INTERNAL'; message: string }

export type CronRequest = {
  /** `Authorization` 헤더의 원문. 없으면 `null` */
  header: string | null
  /** `CRON_SECRET`. 읽기가 던졌으면 `null`(라우트가 잡아서 넘긴다) */
  secret: string | null
  /** 등록된 시세 공급자 수 — `PRICE_PROVIDERS.length` */
  providerCount: number
}

/** Vercel이 붙이는 형태. 접두사를 상수로 두는 이유는 비교가 한 자리여야 하기 때문이다. */
const SCHEME = 'Bearer '

/**
 * ★ **순서가 규칙이다.** 비밀 부재를 **먼저** 본다.
 *
 * 뒤집으면 「비밀이 없는 배포」에 토큰 없이 온 요청이 **401**을 받는다 — 그것이 CR-06이
 * 금지한 상태 그 자체다(배포 결함이 외부 호출처럼 보인다). 그리고 빈 비밀에서는 더
 * 나쁘다: `Bearer ` 로 시작하는 아무 헤더나 통과해 **인증이 조용히 사라진다.**
 *
 * 그 상호작용 셀을 `tests/app/cron.decide.test.ts`가 직접 본다 — 순서에 의존하는
 * 초록색을 만들지 않는다.
 */
export function decide({ header, secret, providerCount }: CronRequest): CronVerdict {
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
   * `<= 0`이다. 음수는 실재하지 않지만(`Array.length`) 만약 온다면 그것은 「공급자가
   * 없다」에 가깝고, `=== 0`으로 쓰면 CR-08(배포 결함 판정)로 새어 원인에서 먼 곳을
   * 가리킨다.
   */
  if (providerCount <= 0) {
    return {
      rule: 'CR-07',
      status: 503,
      code: 'PROVIDER_UNAVAILABLE',
      // §5.8과 **같은 문구**다. 대조는 테스트가 한다.
      message: '시세 공급자가 등록되어 있지 않다. 수동 입력으로 갱신한다.',
    }
  }

  /*
   * 공급자는 있는데 수집기가 없다 — 배포 결함이다. 스텁 값을 저장해 「성공」을 만들지
   * 않는 것이 ADR-004 v0.7의 결정이며, §5.8이 같은 상태에 `INTERNAL`을 낸다.
   * 이 갈래는 P5a 컷 3에서 **정상(200)으로 대체된다.**
   */
  return {
    rule: 'CR-08',
    status: 500,
    code: 'INTERNAL',
    message: '처리 중 오류가 발생했다.',
  }
}
