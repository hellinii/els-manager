import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * 조회 계약 ↔ PostgREST 스위트 — CLAUDE.md `npm run test:integration`
 *
 * **DB에 붙는 두 번째 스위트다.** `tests/rls/`와 나누는 이유는 접속 방식이
 * 다르기 때문이다 — 그쪽은 `pg` 직결 + `set local role` 가장 + 트랜잭션 롤백,
 * 이쪽은 실제 JWT + HTTP(PostgREST)다. `tests/rls`에는 커밋 경로가 아예 없으므로
 * 거기서 준비한 데이터는 HTTP 클라이언트에 보이지 않는다. 두 스위트를 한 설정에
 * 합칠 수 없는 구조적 이유다.
 *
 * 실행 전제: `npm run db:start` → `npm run db:reset`.
 * DB가 없으면 건너뛰지 않고 실패한다 — `tests/integration/global-setup.ts`.
 *
 * **이 스위트의 픽스처는 커밋된다.** 실행 후에는 `npm run db:reset`으로
 * 정리하는 편이 안전하다(CLAUDE.md).
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/integration/global-setup.ts'],
    /**
     * 픽스처가 커밋되므로 파일 간 격리가 롤백으로 보장되지 않는다. 고정 UUID를
     * 쓰는 파일들이 병렬로 돌면 서로의 선삭제에 걸린다.
     */
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
