import { configDefaults, defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * 기본 스위트 — DB·네트워크에 접근하지 않는다.
 *
 * TC-01~22가 인프라 없이 재현되는 것이 P1의 전제이며(ADR-003), 그 성질을
 * 규율이 아니라 설정으로 지킨다. `tests/rls/`는 로컬 Postgres가 필요하므로
 * 여기서 제외하고 `vitest.rls.config.ts`가 담당한다.
 *
 * `configDefaults.exclude`를 펼치는 이유: `exclude`를 직접 지정하면 기본값
 * (`node_modules` 등)이 병합이 아니라 **대체**된다.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/rls/**'],
    environment: 'node',
  },
})
