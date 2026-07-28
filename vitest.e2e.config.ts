import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * Next 서버 스위트 — CLAUDE.md `npm run test:e2e`
 *
 * **네 번째 스위트다.** 앞의 셋이 구조적으로 볼 수 없는 것이 있어서 생겼다.
 *
 * | 스위트 | 보지 못하는 것 |
 * |---|---|
 * | `npm run test` | 프레임워크가 실행하는 코드 전부 — `src/proxy.ts`·`server.ts`는 `next`를 import해 import 그래프 밖이다(AQ-23) |
 * | `test:rls` | Next를 아예 지나지 않는다 (pg 직결) |
 * | `test:integration` | PostgREST에 직접 붙으므로 **응답 헤더도 리다이렉트도 없다** |
 *
 * 특히 **`NextResponse.redirect()`가 쿠키를 떨어뜨리는지**는 실제 HTTP 응답에서만
 * 드러난다. 누산기 단위 시험(`tests/auth/responseCookies.test.ts`)은 우리 코드가
 * 옮기는 것까지만 보고, 그 뒤에 Next가 무엇을 하는지는 보지 못한다.
 *
 * **브라우저를 쓰지 않는다.** `fetch(…, { redirect: 'manual' })`와 손으로 만든
 * 쿠키 jar면 리다이렉트·헤더·상태 코드가 전부 관측된다. 그것으로 증명할 수 없는
 * 것(ST-04의 숨김 여부 등)은 증명하지 않고 **등재한다**(AQ-32) — 싸고 결정적인
 * 층에서 최대한 하고, 나머지는 공백으로 남기되 이름을 붙인다.
 *
 * 실행 전제: `npm run db:start` → `npm run db:reset`. 없으면 건너뛰지 않고
 * 실패한다 — `tests/e2e/global-setup.ts`.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/e2e/global-setup.ts'],
    // 서버가 하나뿐이고 쿠키 jar를 파일 간에 공유하지 않으므로 병렬로 돌려도
    // 되지만, integration과 같은 이유로(고정 시드 사용자) 순차로 둔다.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000, // next build가 여기 들어간다
  },
})
