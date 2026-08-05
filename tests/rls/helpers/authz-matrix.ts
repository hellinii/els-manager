/**
 * 권한 매트릭스 — DOC-010 v2.2 §7 권한 표가 정본이다
 *
 * **표를 바꾸면 이 파일을 바꾸고 그 반대는 하지 않는다.** 순서는
 * 문서 → 마이그레이션 → 이 파일이다(U-01).
 *
 * 이 파일이 존재하는 이유는 §7.1의 실패 사례다. 정책과 RLS 활성화만
 * 확인하는 검사로는 **권한 층의 유입**을 잡지 못했다 — 신규 테이블에서
 * `authenticated`가 TRUNCATE를 자동으로 받았고, RLS는 TRUNCATE에 적용되지
 * 않으므로 규약(`enable row level security`)을 지켜도 규약을 지킨 채로 전 행이
 * 삭제됐다.
 *
 * 마이그레이션의 기본 권한 회수만으로는 부족하다. `pg_default_acl`에는
 * `defaclrole = supabase_admin` 행이 따로 있고 거기에는 세 롤이 **여전히 전
 * 권한으로** 남아 있으므로(실측), 플랫폼이 기본값을 재시딩하면 회수가 신호
 * 없이 무효가 된다. **지속적인 방어 수단은 마이그레이션이 아니라 이
 * 매트릭스와 대조하는 테스트다.**
 *
 * ## 롤 차원이 왜 뒤늦게 들어왔는가 (P5b 컷 2)
 *
 * v2.1까지 이 파일은 **`authenticated` 하나만** 서술했고 대조 질의도
 * `grantee = 'authenticated'`로 박혀 있었다. 그래서 `service_role`이 전
 * 테이블에 8종 권한을 갖고 있다는 사실을 **어느 단언도 보지 않았다** —
 * 「0 DML」이라는 문서의 주장과 실제 GRANT가 갈려 있었고 그것을 판별할
 * 수단이 저장소에 없었다. 롤을 데이터 축으로 올리면 그 부류가 구조적으로
 * 사라진다: 새 롤이 생기면 `ROLES`에 넣어야 하고, 넣으면 12개 셀을 전부
 * 결정해야 한다.
 *
 * ## 축의 방향 — 테이블 major
 *
 * `Table → Role → Privs`다. DOC-010 §7 권한 표가 테이블 major이므로 이 파일이
 * 그 표와 같은 순서로 읽히고, 각 테이블의 근거 주석이 자기 행에 붙어 있다.
 * **가장 안쪽 축이 롤이다** — 셀 하나가 「이 테이블에서 이 롤이 갖는 것」이다.
 */

/** 테이블 단위로 부여될 수 있는 권한 중 **정상 범위** */
export const DML_PRIVILEGES = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'] as const

export type DmlPrivilege = (typeof DML_PRIVILEGES)[number]

/**
 * Data API가 노출하는 롤 전체 — `supabase/config.toml:20`이 셋을 이름으로 적는다.
 *
 * **이 배열이 대조의 열거 원천이다.** 여기 없는 롤은 어느 단언도 보지 않으므로,
 * 롤을 늘리는 변경은 반드시 이 줄을 지난다.
 */
export const ROLES = ['anon', 'authenticated', 'service_role'] as const

export type Role = (typeof ROLES)[number]

/** 권한이 하나도 없는 셀 — 의도를 이름으로 남긴다 */
const NONE: readonly DmlPrivilege[] = []

const ALL_DML: readonly DmlPrivilege[] = ['DELETE', 'INSERT', 'SELECT', 'UPDATE']

/**
 * 테이블 단위 권한 — DOC-010 §7 권한 표
 *
 * `aclexplode(pg_class.relacl)`가 보여주는 것과 정확히 일치해야 한다.
 * **`information_schema.role_table_grants`를 쓰지 않는다** — 그 뷰는 `MAINTAIN`을
 * 숨긴다(실측: 같은 `service_role`이 뷰로 7종, `aclexplode`로 **8종**). 뷰로
 * 대조하면 잔여 `MAINTAIN`이 「0」으로 통과한다.
 *
 * `relacl`은 **테이블 단위 GRANT만** 담으므로 `users`의 열 단위 권한은 여기
 * 나타나지 않는다 — 그것은 `COLUMN_PRIVILEGES`가 맡는다.
 *
 * ## `anon` 행은 왜 전부 비어 있는가
 *
 * 공개 가입이 없고(SEC-03) `anon` 키는 클라이언트 번들에 실리므로(SEC-06)
 * 권한 하나만 열려 있어도 키를 가진 누구나 접근한다. 정책을 `to authenticated`로
 * 만들어도 `anon`은 0행을 볼 뿐이지만, 권한 자체를 회수하면 `42501`로 시끄럽게
 * 실패하고 실수로 `to public` 정책이 추가되어도 데이터가 새지 않는다.
 *
 * ## `service_role` 행은 왜 전부 비어 있는가 (v2.2)
 *
 * **수집 배치가 없는 동안 필요 권한은 정말로 0이다** — 추측이 아니라 최소다.
 * 배치가 생기는 날(P5a 컷 4) 필요한 셀만 여기서 채운다. 그때 이 표를 고치는
 * 것이 유일한 경로이므로 「무엇을 왜 열었는가」가 diff에 남는다.
 *
 * `service_role`은 `rolbypassrls = t`이므로(실측) **정책은 이 롤에 아무런
 * 방어도 제공하지 않는다.** 권한 층이 유일한 방어선이며, 그래서 이 행이 비어
 * 있다는 사실이 정책 32개보다 중요하다.
 */
export const TABLE_PRIVILEGES = {
  /**
   * **표 단위 권한이 하나도 없다** (P3a 7단계).
   *
   * 조회를 `(id, display_name)` 열 단위로, 변경을 `display_name` 열 단위로
   * 좁혔으므로 표 단위 GRANT가 남지 않는다. 실측 결과 `relacl`에
   * `authenticated` 항목 자체가 없다.
   *
   * 빈 배열이 맞다는 것은 대조 단언이 카탈로그에서 테이블을 열거해 빈 배열로
   * 초기화하기 때문이다 — 항목이 없어도 키는 남으므로 이 값이 검사된다.
   */
  users: { anon: NONE, authenticated: NONE, service_role: NONE },
  // 유일하게 조회를 본인으로 제한하는 테이블. 권한 자체는 전 DML
  tax_profiles: { anon: NONE, authenticated: ALL_DML, service_role: NONE },
  // 공용 데이터. 삭제 제외
  assets: {
    anon: NONE,
    authenticated: ['INSERT', 'SELECT', 'UPDATE'],
    service_role: NONE,
  },
  // 공용 데이터. 삭제 제외. 좌표 불변은 I-16(트리거)이 맡으므로 권한은 그대로다
  asset_prices: {
    anon: NONE,
    authenticated: ['INSERT', 'SELECT', 'UPDATE'],
    service_role: NONE,
  },
  /**
   * **전 DML이 됐다 (P5a 컷 2a).** 종전 주석은 「조회 전체 / 변경 없음(마이그레이션
   * 전용). 배치는 읽기만 한다」였고 근거 둘이 다 무효가 됐다 —
   * ⓐ `service_role`이 0 DML이고 AQ-57이 ⓐ(전용 서비스 계정)로 닫혔으므로 배치는
   * `authenticated`로 돈다. 즉 「배치 전용」 경로가 없다
   * ⓑ 매핑 «화면»이 선다 (DOC-011 §5.12 `saveProviderSymbol`)
   *
   * ★ **DELETE를 포함한다 — `assets`·`asset_prices`와 비대칭이고 그것이 의도다.**
   * 매핑은 관측이 아니므로 지워도 잃는 것이 없고, 「이 자산은 자동 수집하지 않는다」로
   * 되돌릴 유일한 수단이다. `UNIQUE(asset_id, provider)` 아래에서 UPDATE로는 매핑을
   * 없앨 수 없다. 마이그레이션 주석이 그 표를 담는다.
   */
  asset_provider_symbols: {
    anon: NONE,
    authenticated: ALL_DML,
    service_role: NONE,
  },
  // 조회 전체 / 변경 소유자
  els_products: { anon: NONE, authenticated: ALL_DML, service_role: NONE },
  els_underlyings: { anon: NONE, authenticated: ALL_DML, service_role: NONE },
  redemption_schedules: { anon: NONE, authenticated: ALL_DML, service_role: NONE },
  redemptions: { anon: NONE, authenticated: ALL_DML, service_role: NONE },
  // 참조 데이터. 조회 전체 / 변경 없음 (ADR-005)
  tax_years: { anon: NONE, authenticated: ['SELECT'], service_role: NONE },
  tax_brackets: { anon: NONE, authenticated: ['SELECT'], service_role: NONE },
  tax_constants: { anon: NONE, authenticated: ['SELECT'], service_role: NONE },
  /**
   * 배치 실행 기록 (P5a 컷 2a — DOC-002 §4.11).
   *
   * ★ **`SELECT`·`INSERT`만이다. UPDATE·DELETE가 없는 것이 이 셀의 요점이다** —
   * 고칠 수 있는 관측 기록은 기록이 아니다. 정책도 두 개(SELECT 전체 · INSERT 본인)뿐이라
   * 두 겹이며, 위 「변경 정책이 없는 테이블」 목록에는 **넣지 않는다**(INSERT 정책이
   * 있으므로 그 명제가 거짓이 된다).
   *
   * `service_role`은 여전히 비어 있다 — 배치가 `authenticated`로 돌기 때문이고,
   * 그래서 P5b 컷 2의 「0 DML」이 **영구 상태**가 된다 (AQ-57 = ⓐ의 결과).
   */
  cron_runs: {
    anon: NONE,
    authenticated: ['INSERT', 'SELECT'],
    service_role: NONE,
  },
} as const satisfies Record<string, Record<Role, readonly DmlPrivilege[]>>

/**
 * 열 단위 권한 — **권한 종류와 롤을 함께 담는다**
 *
 * `pg_attribute.attacl`이 정본이다. `information_schema.column_privileges`는
 * **테이블 권한을 전 열로 펼쳐서** 보여주므로 "열 단위로만 부여됨"을 표현하지
 * 못한다.
 *
 * ## 왜 형태를 두 번 바꿨는가
 *
 * ① P3a 7단계 — 종전 `COLUMN_UPDATE_PRIVILEGES`는 열 이름 배열이었고, 대조
 * 코드가 권한 종류를 `'UPDATE'`로 **하드코딩**했다. `users`의 SELECT가 열
 * 단위로 들어오자 그 구조로는 표현할 수 없게 되었다 — 실측한 `attacl`이 이유를
 * 그대로 보여준다.
 *
 * ```
 * id            {authenticated=r/postgres}     ← r = SELECT
 * display_name  {authenticated=rw/postgres}    ← r + w, 한 항목 안에 둘
 * ```
 *
 * ② P5b 컷 2 — 롤이 축이 되었다. 열 단위 GRANT를 갖는 롤은 지금
 * `authenticated` 하나이므로 다른 둘은 빈 객체이며, **그 빈 객체가 단언
 * 대상이다**(대조가 양방향이므로 `service_role`에 열 GRANT가 생기면 빨간불이다).
 *
 * `asset_prices`는 여기 없다. 좌표 불변을 열 단위 GRANT로 강제하면
 * `supabase-js .upsert()`가 payload 전역을 `DO UPDATE SET`에 실어 42501로
 * 실패하므로, 무결성 규칙(I-16, 트리거)으로 옮겼다.
 */
export const COLUMN_PRIVILEGES = {
  users: {
    // 조회 계약이 요구하는 것은 표시명과 그 키뿐이다
    id: { anon: NONE, authenticated: ['SELECT'], service_role: NONE },
    display_name: {
      anon: NONE,
      authenticated: ['SELECT', 'UPDATE'],
      service_role: NONE,
    },
    // email·created_at·updated_at은 **의도적으로 없다.** 계약 어디도 쓰지 않는다.
  },
} as const satisfies Record<string, Record<string, Record<Role, readonly DmlPrivilege[]>>>
