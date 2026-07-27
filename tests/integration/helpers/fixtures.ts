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
 */
export const FX = {
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
} as const

/** 이름 대역도 예약한다 — `assets_name_market_key`(NULLS NOT DISTINCT) 충돌 회피 */
export const FX_NAME_PREFIX = '[ITG]'

export const ALL_FIXTURE_IDS = Object.values(FX)
