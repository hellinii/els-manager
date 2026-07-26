/**
 * 권한 매트릭스 — DOC-010 v0.3 §7 권한 표가 정본이다
 *
 * **표를 바꾸면 이 파일을 바꾸고 그 반대는 하지 않는다.** 순서는
 * 문서 → 마이그레이션 → 이 파일이다(U-01).
 *
 * 이 파일이 존재하는 이유는 §7.1의 실패 사례다. 정책과 RLS 활성화만
 * 확인하는 검사로는 **권한 층의 유입**을 잡지 못했다 — 신규 테이블에서
 * `authenticated`가 TRUNCATE를 자동으로 받았고, RLS는 TRUNCATE에 적용되지
 * 않으므로 규약(`enable row level security`)을 지켜도 전 행이 삭제됐다.
 *
 * 마이그레이션의 기본 권한 회수만으로는 부족하다. `pg_default_acl`에는
 * `defaclrole = supabase_admin` 행이 따로 있고 거기에는 `anon`·`authenticated`가
 * 여전히 전 권한으로 남아 있으므로, 플랫폼이 기본값을 재시딩하면 회수가
 * 신호 없이 무효가 된다. **지속적인 방어 수단은 마이그레이션이 아니라
 * 이 매트릭스와 대조하는 테스트다.**
 */

/** `authenticated`에게 부여될 수 있는 권한의 전체 집합 */
export const DML_PRIVILEGES = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'] as const

export type DmlPrivilege = (typeof DML_PRIVILEGES)[number]

/**
 * 테이블 단위 권한 — DOC-010 §7 권한 표
 *
 * `information_schema.role_table_grants`가 보여주는 것과 정확히 일치해야 한다.
 * 그 뷰는 **테이블 단위 GRANT만** 담으므로 `users.display_name`의 열 단위
 * UPDATE는 여기 나타나지 않는다 — 그것은 `COLUMN_UPDATE_PRIVILEGES`가 맡는다.
 */
export const TABLE_PRIVILEGES = {
  // 조회 전체 / 변경 본인의 display_name만 → 테이블 단위는 SELECT 하나
  users: ['SELECT'],
  // 유일하게 조회를 본인으로 제한하는 테이블. 권한 자체는 전 DML
  tax_profiles: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  // 공용 데이터. 삭제 제외
  assets: ['INSERT', 'SELECT', 'UPDATE'],
  // 공용 데이터. 삭제 제외. 좌표 불변은 I-16(트리거)이 맡으므로 권한은 그대로다
  asset_prices: ['INSERT', 'SELECT', 'UPDATE'],
  // 조회 전체 / 변경 없음 (마이그레이션·수집 배치 전용)
  asset_provider_symbols: ['SELECT'],
  // 조회 전체 / 변경 소유자
  els_products: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  els_underlyings: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  redemption_schedules: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  redemptions: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  // 참조 데이터. 조회 전체 / 변경 없음 (ADR-005)
  tax_years: ['SELECT'],
  tax_brackets: ['SELECT'],
  tax_constants: ['SELECT'],
} as const satisfies Record<string, readonly DmlPrivilege[]>

/**
 * 열 단위 UPDATE — `users.display_name` 하나뿐이다
 *
 * `pg_attribute.attacl`이 정본이다. `information_schema.column_privileges`는
 * **테이블 권한을 전 열로 펼쳐서** 보여주므로 "열 단위로만 부여됨"을 표현하지
 * 못한다.
 *
 * `asset_prices`는 여기 없다. 좌표 불변을 열 단위 GRANT로 강제하면
 * `supabase-js .upsert()`가 payload 전역을 `DO UPDATE SET`에 실어 42501로
 * 실패하므로, 무결성 규칙(I-16, 트리거)으로 옮겼다.
 */
export const COLUMN_UPDATE_PRIVILEGES = {
  users: ['display_name'],
} as const satisfies Record<string, readonly string[]>
