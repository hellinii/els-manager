/**
 * RLS 테스트 고정값
 *
 * UUID는 `supabase/seed/00_rls_test_users.sql`과 반드시 일치한다. 두 곳이
 * 어긋나면 프리플라이트가 "테스트 사용자가 없다"로 알린다.
 */

/** 소유자 역할. 대부분의 데이터를 소유한다 */
export const USER_A = '00000000-0000-4000-8000-00000000000a'

/** 침입자 역할. A의 데이터를 건드리려 시도한다 */
export const USER_B = '00000000-0000-4000-8000-00000000000b'

/**
 * `public` 스키마의 실테이블 전체 — DOC-002 §3 엔티티 목록
 *
 * 프리플라이트가 존재 여부를 확인하고, 카탈로그 테스트가 이 목록 전부에
 * RLS가 켜져 있는지 확인한다.
 */
export const RLS_TABLES = [
  'users',
  'tax_profiles',
  'assets',
  'asset_provider_symbols',
  'asset_prices',
  'els_products',
  'els_underlyings',
  'redemption_schedules',
  'redemptions',
  'tax_years',
  'tax_brackets',
  'tax_constants',
] as const
