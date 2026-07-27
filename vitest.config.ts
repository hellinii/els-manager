import { configDefaults, defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * 기본 스위트 — DB·네트워크에 접근하지 않는다.
 *
 * TC-01~22가 인프라 없이 재현되는 것이 P1의 전제이며(ADR-003), 그 성질을
 * 규율이 아니라 설정으로 지킨다. DB에 붙는 스위트는 **둘**이며 각각 전용 설정을
 * 갖는다 — `tests/rls/`(`vitest.rls.config.ts`, `pg` 직결)와
 * `tests/integration/`(`vitest.integration.config.ts`, PostgREST 경유).
 * 둘 다 여기서 제외한다. 빠뜨리면 `npm run test`가 DB를 요구하게 되고
 * ADR-003의 전제가 조용히 깨진다.
 *
 * `configDefaults.exclude`를 펼치는 이유: `exclude`를 직접 지정하면 기본값
 * (`node_modules` 등)이 병합이 아니라 **대체**된다.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/rls/**', 'tests/integration/**'],
    environment: 'node',
  },
})
