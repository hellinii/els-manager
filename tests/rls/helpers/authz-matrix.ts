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
 * 그 뷰는 **테이블 단위 GRANT만** 담으므로 `users`의 열 단위 권한은 여기
 * 나타나지 않는다 — 그것은 `COLUMN_PRIVILEGES`가 맡는다.
 */
export const TABLE_PRIVILEGES = {
  /**
   * **표 단위 권한이 하나도 없다** (P3a 7단계).
   *
   * 조회를 `(id, display_name)` 열 단위로, 변경을 `display_name` 열 단위로
   * 좁혔으므로 표 단위 GRANT가 남지 않는다. 실측 결과
   * `information_schema.role_table_grants`에서 **`users` 행 자체가 사라진다.**
   *
   * 빈 배열이 맞다는 것은 위 단언이 카탈로그에서 테이블을 열거해 빈 배열로
   * 초기화하기 때문이다 — 행이 사라져도 키는 남으므로 이 값이 검사된다.
   */
  users: [],
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
 * 열 단위 권한 — **권한 종류를 함께 담는다** (P3a 7단계에서 형태 변경)
 *
 * `pg_attribute.attacl`이 정본이다. `information_schema.column_privileges`는
 * **테이블 권한을 전 열로 펼쳐서** 보여주므로 "열 단위로만 부여됨"을 표현하지
 * 못한다.
 *
 * ## 왜 형태를 바꿨는가
 *
 * 종전 `COLUMN_UPDATE_PRIVILEGES`는 열 이름 배열이었고, 대조 코드가 권한 종류를
 * `'UPDATE'`로 **하드코딩**했다. `users`의 SELECT가 열 단위로 들어오자 그 구조로는
 * 표현할 수 없게 되었다 — 실측한 `attacl`이 이유를 그대로 보여준다.
 *
 * ```
 * id            {authenticated=r/postgres}     ← r = SELECT
 * display_name  {authenticated=rw/postgres}    ← r + w, 한 항목 안에 둘
 * ```
 *
 * 한 열이 여러 권한을 가질 수 있으므로 `열 → 권한 종류 목록`이어야 한다.
 * 열 이름만 담는 형태를 복사하면 "SELECT만 있는데 UPDATE로 단언"하거나
 * 반대로 "UPDATE가 늘었는데 통과"하는 경로가 생긴다.
 *
 * `asset_prices`는 여기 없다. 좌표 불변을 열 단위 GRANT로 강제하면
 * `supabase-js .upsert()`가 payload 전역을 `DO UPDATE SET`에 실어 42501로
 * 실패하므로, 무결성 규칙(I-16, 트리거)으로 옮겼다.
 */
export const COLUMN_PRIVILEGES = {
  users: {
    // 조회 계약이 요구하는 것은 표시명과 그 키뿐이다
    id: ['SELECT'],
    display_name: ['SELECT', 'UPDATE'],
    // email·created_at·updated_at은 **의도적으로 없다.** 계약 어디도 쓰지 않는다.
  },
} as const satisfies Record<string, Record<string, readonly DmlPrivilege[]>>
