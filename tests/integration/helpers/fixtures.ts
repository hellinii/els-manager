/**
 * 조회 계약 스위트 고정값
 *
 * UUID·이름은 `supabase/seed/01_integration_users.sql`과 반드시 일치한다.
 * **RLS 스위트와 대역이 다르다** — 그 이유는 시드 파일 주석에 있다.
 */

/** 소유자 역할 */
export const ITG_USER_A = '00000000-0000-4000-8000-000000000101'

/** 타인 역할 — 남의 상품은 보고 남의 tax_profiles는 못 본다 */
export const ITG_USER_B = '00000000-0000-4000-8000-000000000102'

export const ITG_PASSWORD = 'itg-test-password'

export const ITG_EMAIL = {
  [ITG_USER_A]: 'itg-a@example.test',
  [ITG_USER_B]: 'itg-b@example.test',
} as const

/**
 * 픽스처 UUID는 **고정**이다. "만들고 지우기"가 아니라 **선삭제 후 삽입**으로
 * 멱등하게 만든다 — 테스트가 중간에 던지면 역순 정리는 실행되지 않고, 다음
 * 실행이 이전 실행의 잔재에 걸린다. 고정 UUID + 선삭제는 잔재가 있어도 낫는다.
 *
 * ## 두 계층이다 — 정본 시나리오와 파일 전용 추가분
 *
 * 위쪽은 `setupScenario()`가 세우는 **정본**이고, 각 상품이 판정 상태 하나를
 * 대표한다. 아래쪽은 **특정 파일만** 세우는 추가분으로, 정본에 넣으면 여러
 * 파일의 건수 단언(`activeCount`·`usedByActiveProducts`·`upcomingEvaluations`
 * 길이)이 그 한 상품의 인질이 되는 것들이다.
 *
 * **추가분도 반드시 여기 등재한다.** `els_underlyings.asset_id`가 RESTRICT라서
 * 상품 id가 `ALL_FIXTURE_IDS`에 없으면 다음 실행의 `resetFixtures()`가 자산
 * 삭제에서 `23503`으로 죽는다. 등재는 선택이 아니라 정리의 전제다.
 */
export const FX = {
  // ── 정본 시나리오 (setupScenario) ──────────────────────────────────────
  assetSolo: '00000000-0000-4000-8000-000000000201',
  assetPair1: '00000000-0000-4000-8000-000000000202',
  assetPair2: '00000000-0000-4000-8000-000000000203',
  assetNoPrice: '00000000-0000-4000-8000-000000000204',
  assetStale: '00000000-0000-4000-8000-000000000205',

  productA: '00000000-0000-4000-8000-000000000301',
  productB: '00000000-0000-4000-8000-000000000302',
  productRedeemed: '00000000-0000-4000-8000-000000000303',
  productNoUnderlying: '00000000-0000-4000-8000-000000000304',
  productNoSchedule: '00000000-0000-4000-8000-000000000305',

  // ── 파일 전용 추가분 (정본이 세우지 않는다) ─────────────────────────────
  /** `contracts.test.ts`의 성장 불변 — 데이터가 늘어도 왕복 구성이 그대로인가 */
  assetGrowth1: '00000000-0000-4000-8000-000000000206',
  assetGrowth2: '00000000-0000-4000-8000-000000000207',
  productGrowth: '00000000-0000-4000-8000-000000000306',

  /** `formats.test.ts`의 보강 — 정본이 닿지 않는 null/비-null 분기를 메운다 */
  assetFormat: '00000000-0000-4000-8000-000000000208',
  productFormat: '00000000-0000-4000-8000-000000000308',
} as const

/** 이름 대역도 예약한다 — `assets_name_market_key`(NULLS NOT DISTINCT) 충돌 회피 */
export const FX_NAME_PREFIX = '[ITG]'

export const ALL_FIXTURE_IDS = Object.values(FX)
