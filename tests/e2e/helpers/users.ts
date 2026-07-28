import {
  ITG_EMAIL,
  ITG_PASSWORD,
  ITG_USER_A,
  ITG_USER_B,
} from '../../integration/helpers/fixtures'

/**
 * 이 스위트가 로그인하는 사용자 — **넷이다** (P4 컷 9)
 *
 * 앞의 둘은 `tests/integration/`과 공유한다(픽스처가 커밋되므로 그 데이터가 여기서도
 * 보인다). 뒤의 둘은 **이 스위트 전용**이며 `supabase/seed/04_e2e_user.sql`이 만든다.
 *
 * ## 왜 전용 사용자가 필요한가 — DOC-010 AQ-34
 *
 * 확인해야 하는 상태 둘이 **한 소유자의 데이터를 전부 통제해야** 성립한다.
 *
 * | 무엇 | 조건 |
 * |---|---|
 * | SCR-301 셋째 빈 상태 「예정 평가일 없음」 | 그 소유자의 전 차수가 경과했다 |
 * | SCR-101 ①의 「임박한 평가일이 없다」 | 같다(`upcomingEvaluations`가 빈 배열) |
 *
 * 앞의 둘로는 만들 수 없다 — 목록이 전역이고(모든 SELECT 정책이 `using (true)`)
 * `tests/integration/`의 커밋된 픽스처 중 하나가 미래 평가일을 갖는다. **다른
 * 스위트의 데이터가 이 상태의 성립을 막는다**는 것이 AQ-34가 등재한 내용이다.
 *
 * ## 왜 전용 사용자가 둘인가
 *
 * 위 상태는 「다가오는 차수가 하나도 없다」이고 SCR-101 ①의 **내용**(임박 표식·
 * `willMeet` 세 갈래·판정 없음)은 그 반대를 요구한다. 한 사용자로 둘을 만들려면
 * 테스트의 실행 순서에 의존해야 하는데, 그러면 「먼저 빈 상태를 보고 나중에 상품을
 * 만든다」가 단언의 전제가 된다 — 순서가 데이터인 초록색이다.
 *
 * 부수 효과가 더 크다: 두 사용자의 집계는 **값으로** 단언할 수 있다. `scope='MINE'`의
 * `activeCount`·`activePrincipal`·`realizedPnl`·`financialIncome`이 이 스위트가 만든
 * 상품만으로 결정되므로, 「포함되어 있다」가 아니라 「정확히 이 값이다」가 된다.
 *
 * **과세 프로필을 만들지 않는다.** SCR-101 ③의 단언이 폴백(전부 0)을 전제하며,
 * `resetFixtures()`가 지우는 대상도 101·102뿐이다(시드 파일 주석).
 */

/** 임박·먼 평가일·결함·상환을 갖는다 — ①④⑤의 **내용**을 만든다 */
export const E2E_LIVE = '00000000-0000-4000-8000-000000000103'

/** 전 차수가 경과한 상품 하나만 갖는다 — ①의 **빈 절**과 SCR-301 셋째 빈 상태 */
export const E2E_PAST = '00000000-0000-4000-8000-000000000104'

const E2E_PASSWORD = 'e2e-test-password'

const CREDENTIALS: Record<string, { email: string; password: string }> = {
  [ITG_USER_A]: { email: ITG_EMAIL[ITG_USER_A], password: ITG_PASSWORD },
  [ITG_USER_B]: { email: ITG_EMAIL[ITG_USER_B], password: ITG_PASSWORD },
  // `supabase/seed/04_e2e_user.sql`과 반드시 일치한다.
  [E2E_LIVE]: { email: 'e2e-live@example.test', password: E2E_PASSWORD },
  [E2E_PAST]: { email: 'e2e-past@example.test', password: E2E_PASSWORD },
}

export type SuiteUser = keyof typeof CREDENTIALS

/**
 * 표시 이름 — `scope = 'ALL'`에서 화면이 렌더하는 값이므로 단언에 쓴다.
 *
 * **두 전용 사용자의 이름이 서로의 부분문자열이 아니다.** 「서버 사용자」와
 * 「서버 사용자 B」로 두면 `toContain`이 둘을 구분하지 못한다 — 컷 4a의 「기초자산 1」,
 * 컷 5의 「상환 실적」과 같은 함정이며 시드 파일 주석에도 적혀 있다.
 */
export const DISPLAY_NAME: Record<string, string> = {
  [ITG_USER_A]: '계약 사용자 A',
  [ITG_USER_B]: '계약 사용자 B',
  [E2E_LIVE]: '실행 사용자',
  [E2E_PAST]: '경과 사용자',
}

export function credentialsOf(user: SuiteUser): { email: string; password: string } {
  const found = CREDENTIALS[user]
  if (found == null) {
    throw new Error(
      `시드되지 않은 사용자다: ${user}\n` +
        '  supabase/seed/에 넣고 이 표에 등재한다 — 두 곳이 갈리면 로그인이 400이다.',
    )
  }
  return found
}
