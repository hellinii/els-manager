import { BASE_URL } from './server'

/**
 * 배치 엔드포인트를 실 HTTP로 부르는 helper — DOC-011 §7.1
 *
 * ## 비밀을 스위트가 정한다
 *
 * 「`CRON_SECRET` 미설정」 갈래는 e2e에서 **결정적으로 만들 수 없다** — `next start`가
 * `.env.local`을 읽으므로 그 갈래의 참·거짓이 개발자 기계에 달려 있다. 그래서 반대로
 * 한다: 스위트가 값을 **주입해** 「설정됨」을 고정하고, 미설정 갈래는 순수 판정
 * (`tests/app/cron.decide.test.ts`)이 본다. 각 층이 자기가 결정적으로 만들 수 있는 것만
 * 본다.
 *
 * **주입이 `.env.local`을 이긴다 *(실측)*.** `@next/env`의 `processEnv`는
 * `if (typeof u[t]==="undefined" && typeof l[t]==="undefined")`일 때만 키를 세우고 `l`은
 * **프로세스 최초의 `process.env` 사본**이다(`node_modules/@next/env/dist/index.js`).
 * 즉 이미 있는 키는 파일이 덮지 않는다 — 그래서 개발자 기계에 다른 값이 있어도 아래
 * 케이스의 결과가 같다. `dotenv`의 `populate`도 `override !== true`면 같은 규칙이다.
 */

/** 로컬 개발용 값과 겹치지 않게 둔다 — 16자 이상(DOC-013 §6.3). */
export const E2E_CRON_SECRET = 'e2e-cron-Kx7Qm2pR9vLn4Ts8'

export const CRON_PATH = '/api/cron/prices'

/**
 * 배치 서비스 계정 — `supabase/seed/05_cron_service_user.sql`이 만든다 (P5a 컷 3).
 *
 * ★ **비밀과 달리 이 둘은 스위트가 «정할» 수 없다** — 시드가 만든 계정과 «같아야» 하고,
 * 다르면 GoTrue가 `invalid_credentials`를 주어 라우트가 CR-08(500)로 답한다. 즉 이 상수는
 * 주입값이 아니라 **시드의 사본**이며, 갈리면 e2e가 「200이 아니다」로 그것을 말한다.
 *
 * 그래서 시드 파일과 여기 두 곳에 같은 값이 있다. 대안(시드를 파싱)은 SQL 파서를
 * 요구하므로 두지 않고, **갈림이 조용하지 않다는 것**으로 대신한다.
 */
export const CRON_SERVICE_EMAIL = 'cron@example.test'
export const CRON_SERVICE_PASSWORD = 'cron-service-password'

/** CR-09의 세 헤더 — §7.1이 문자 그대로 적은 값이다. */
export const NO_STORE_HEADERS: Record<string, string> = {
  'cache-control': 'private, no-cache, no-store, must-revalidate, max-age=0',
  expires: '0',
  pragma: 'no-cache',
}

/**
 * `Authorization`을 주지 않으면 헤더 없이 부른다.
 *
 * `redirect: 'manual'`이 요점이다 — 프록시가 이 경로를 잡으면 307이고, 따라가면 그것이
 * `/login`의 200으로 보인다. Vercel Cron은 리다이렉트를 따라가지 않으므로(실측 ⑤)
 * 여기서도 따라가지 않는 것이 실제 호출자의 행동이다.
 */
export function getCron(authorization?: string): Promise<Response> {
  return fetch(`${BASE_URL}${CRON_PATH}`, {
    redirect: 'manual',
    headers: authorization == null ? {} : { Authorization: authorization },
  })
}
