/**
 * 환경변수 해석 — DOC-010 §7.2, SEC-05·SEC-06
 *
 * **`process.env`를 읽는 유일한 파일이다.** 린트가 `src/lib/db/**`의 나머지
 * 전부에서 `process`를 금지하므로, "조회 경로는 `service_role`을 쓰지 않는다"를
 * 이 파일 하나만 읽어서 감사할 수 있다. 규율이 아니라 경계다.
 *
 * 위의 두 변수는 **비밀이 아니다** — 브라우저 번들에 실린다. 공개 키로 얻는 것은
 * `anon` 롤이고 `anon`에는 어떤 테이블 권한도 없다(DOC-010 §7). `authenticated`가
 * 되려면 세션이 필요하고, 세션은 초대된 사용자의 로그인으로만 생긴다(SEC-03).
 *
 * **세 번째 변수는 비밀이다** — `CRON_SECRET`(P5b 컷 1). 그것이 이 파일에 들어오는
 * 이유는 **새 리더를 만들지 않는다**는 것이고(DOC-013 §5.2), 그 성질이 두 겹으로
 * 고정돼 있다: 린트 `els/db-layer-values-and-env` + `tests/db/no-service-role.test.ts`의
 * **정확 일치** 단언(읽는 파일 목록이 `['src/lib/db/env.ts']`와 같다).
 *
 * ★ **그래서 이 파일의 오류 메시지에도 규율이 하나 붙는다.** 위 단언은 주석을
 * 제거하되 **문자열 리터럴은 보존하므로**, 환경 접근자의 이름을 메시지 문구로 쓰면
 * 그것을 담은 파일이 「읽는 파일」로 세어진다. 이 파일은 목록에 있어야 하는 쪽이라
 * 무해하지만 **호출부에서 그 문구를 재현하면 그쪽이 빨간불이 된다** — 그래서 오류를
 * 만드는 자리를 여기 하나로 둔다(DOC-013 §5.2 각주).
 */

/** DOC-010 §7.2에 등재된 변수명. 이 목록 밖의 변수는 이 계층에서 읽지 않는다. */
const SUPABASE_URL = 'NEXT_PUBLIC_SUPABASE_URL'
const SUPABASE_ANON_KEY = 'NEXT_PUBLIC_SUPABASE_ANON_KEY'
const CRON_SECRET = 'CRON_SECRET'
const CRON_SERVICE_EMAIL = 'CRON_SERVICE_EMAIL'
const CRON_SERVICE_PASSWORD = 'CRON_SERVICE_PASSWORD'

export type SupabaseEnv = {
  url: string
  anonKey: string
}

/** 부재 메시지의 두 번째 문장. 변수마다 고치는 법이 다르므로 힌트를 인자로 받는다. */
const LOCAL_HINT =
  '.env.example을 참고해 .env.local을 만든다. 로컬 값은 `npm run db:status`가 출력한다.'

const CRON_HINT =
  '.env.example의 CRON_SECRET을 채운다 — 16자 이상 난수이며, 운영에서는 Vercel 환경변수로 넣는다 (DOC-013 §5.1·§6.3).'

/**
 * 부재 시 즉시 던진다. **빈 문자열도 부재로 취급한다** — 미설정 변수가 `''`로
 * 들어오면 "URL이 빈 클라이언트"가 만들어져 실패가 첫 조회까지 미뤄지고,
 * 그때의 오류 메시지는 원인을 가리키지 않는다.
 *
 * `tests/rls/helpers/env.ts`가 접속 문자열에 적용한 규율과 같다 — 잘못된 대상을
 * 향한 실행을 사고로 취급하고 구조로 막는다.
 *
 * **값을 메시지에 담지 않는다.** 셋 중 하나가 비밀이 된 뒤로는 그것이 규율이
 * 아니라 요구다 — 이 오류는 서버 로그로 나간다.
 */
function require_(name: string, hint: string): string {
  const value = process.env[name]
  if (value == null || value.trim() === '') {
    throw new Error(`환경변수 ${name}가 설정되지 않았다. ${hint}`)
  }
  return value
}

export function supabaseEnv(): SupabaseEnv {
  return {
    url: require_(SUPABASE_URL, LOCAL_HINT),
    anonKey: require_(SUPABASE_ANON_KEY, LOCAL_HINT),
  }
}

/**
 * 배치 엔드포인트의 비밀 토큰 — SEC-04, DOC-011 §7.1 CR-01·CR-06.
 *
 * **부재와 빈 문자열이 같이 던진다**(`require_`의 기존 규약). 비밀에서 이 구분이
 * 특히 중요하다: 빈 값이면 `Bearer `로 **시작하는 모든 헤더**가 일치하므로 인증이
 * 조용히 사라진다. 그것이 CR-06을 401이 아니라 **500**으로 둔 이유의 절반이고,
 * 나머지 절반은 「비밀이 없다」(배포 결함)와 「토큰이 틀리다」(외부 호출)의 조치가
 * 다르다는 것이다(ST-06이 금지한 형태).
 *
 * **던지는 것을 응답으로 바꾸는 자리는 라우트다** — `src/app/api/cron/prices/route.ts`가
 * 이 예외를 잡아 `decide()`에 `null`로 넘기고, 그 순수 판정이 500을 만든다.
 * 여기서 `null`을 반환하지 않는 이유: 부재를 값으로 돌려주면 호출부가 그것을 검사할
 * 의무를 갖게 되고, 검사를 빠뜨린 경로가 `Bearer null`을 비교하게 된다.
 */
export function cronSecret(): string {
  return require_(CRON_SECRET, CRON_HINT)
}

/**
 * 부재를 **던지지 않고** `null`로 답한다 — `require_`와 짝인 반대편.
 *
 * 빈 문자열을 부재로 다루는 규약은 같다. 비밀번호가 `''`이면 GoTrue가 그것을
 * `invalid_credentials`로 답하는데, 그 문구는 「변수를 채워라」가 아니라 「비밀번호가
 * 틀렸다」로 읽힌다 — 부재를 여기서 잡아야 CR-10이 그 원인을 말할 수 있다.
 */
function optional_(name: string): string | null {
  const value = process.env[name]
  return value == null || value.trim() === '' ? null : value
}

/** 배치가 로그인할 GoTrue 계정 — AQ-57 ⓐ */
export type CronServiceAccount = { email: string; password: string }

/**
 * 배치의 정체성 — AQ-57 ⓐ, DOC-010 §7.2, DOC-011 §7.1 CR-10.
 *
 * ## 던지지 않는다 — `cronSecret()`과 «반대»이며 그것이 의도다
 *
 * `cronSecret()`은 던지고 라우트가 잡는다. 이쪽은 **부재한 변수의 이름들을 값으로**
 * 돌려준다. 이유는 CR-10의 답이 CR-06과 다르기 때문이다: CR-06은 「비밀이 없다」 하나이고
 * 여기는 **어느 변수가 없는지**가 진단의 내용이다. 예외로 만들면 그 목록이 문구 안으로
 * 들어가고, 문구를 파싱하는 소비자가 생긴다.
 *
 * ★ **이름만 나간다. 값은 절대 나가지 않는다**(SEC-05). 반환된 이름들은 서버 로그로만
 * 가고 **응답 본문에는 실리지 않는다** — 미인증 호출자가 배포 구성을 알게 될 이유가 없고,
 * 그래서 `decide()`가 CR-10을 인증 «뒤»에 둔다.
 *
 * ★★ **부분 설정을 성공으로 만들지 않는다.** 하나만 있으면 `account`가 `null`이고
 * `missing`에 그 하나가 남는다 — 이메일만 넣고 비밀번호를 빠뜨린 배포가 「로그인 실패」가
 * 아니라 「변수 하나가 없다」로 보고되는 것이 이 형태의 목적이다.
 */
export function cronServiceAccount(): {
  account: CronServiceAccount | null
  missing: readonly string[]
} {
  const email = optional_(CRON_SERVICE_EMAIL)
  const password = optional_(CRON_SERVICE_PASSWORD)

  const missing = [
    ...(email == null ? [CRON_SERVICE_EMAIL] : []),
    ...(password == null ? [CRON_SERVICE_PASSWORD] : []),
  ]

  if (email == null || password == null) return { account: null, missing }
  return { account: { email, password }, missing }
}

/**
 * 공급자가 요구하는 변수 중 **설정되지 않은 것들의 이름** — CR-10의 두 번째 출처.
 *
 * 목록 자체는 `providers/types.ts`의 `PROVIDER_CREDENTIALS`가 소유한다(그쪽이 어느 공급자가
 * 무엇을 요구하는지 아는 자리다). 이 함수는 **읽기만** 한다 — `process.env`에 닿는 파일이
 * 하나여야 하므로 그 판정이 여기 있고, 그 성질은 `tests/db/no-service-role.test.ts`의
 * 정확 일치 단언이 지킨다.
 *
 * ★ 오늘 이 함수는 **빈 배열을 받아 빈 배열을 돌려준다**(키움 es040은 자격증명이 없다).
 * 그래도 두는 이유는 다음 공급자가 키를 요구하는 날 **여기를 만들지 않아도 되게** 하는
 * 것이고, 그 상태에서 이 함수가 없으면 그 공급자의 키 부재가 CR-10에 세어지지 않는다.
 */
export function missingProviderCredentials(names: readonly string[]): readonly string[] {
  return names.filter((name) => optional_(name) == null)
}
