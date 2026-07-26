import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * RLS 정책 검증 스위트 — DOC-010 §7, CLAUDE.md `npm run test:rls`
 *
 * **이 설정만 데이터베이스에 접속한다.** 설정 파일을 둘로 나눈 이유는
 * "어느 스위트가 DB를 쓰는가"를 파일 경계로 드러내기 위해서다. 단일 설정에
 * 프로젝트 두 개를 두면 같은 분리를 얻지만 경계가 눈에 덜 띈다.
 *
 * 실행 전제: `npm run db:start` → `npm run db:reset`.
 * DB가 없으면 건너뛰지 않고 실패한다 — `tests/rls/global-setup.ts` 참조.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/rls/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/rls/global-setup.ts'],
    setupFiles: ['tests/rls/setup.ts'],
    /**
     * 각 테스트는 트랜잭션 롤백으로 격리되지만, 파일이 병렬로 돌면 서로 다른
     * 워커가 같은 고정 UUID 행을 동시에 건드려 잠금 대기가 생긴다.
     */
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
