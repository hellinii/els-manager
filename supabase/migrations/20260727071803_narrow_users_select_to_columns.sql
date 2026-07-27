-- ============================================================================
-- users 조회를 열 단위로 좁힌다 — DOC-010 §7 (P2 이월 판단 종결)
--
-- 조회 계약 8개 어디도 `email`을 쓰지 않는다(`display_name`만). 표 단위 SELECT를
-- 유지하면 인증 사용자 전원이 서로의 **로그인 식별자**를 읽을 수 있는데, 그
-- 권한을 쓰는 계약이 하나도 없다. §7.1의 "전부 회수한 뒤 필요한 것만 명시
-- 부여"를 열 수준까지 적용한다.
--
-- P2가 이 판단을 미룬 이유는 "열 단위로 좁히면 `select *`가 42501이 된다"였다.
-- 조회 계층이 `src/lib/db/select.ts`의 명시 열 목록만 쓰므로 그 부작용은 정상
-- 경로에 나타나지 않으며, `select *`를 쓰는 코드가 조용히 늘어나는 것을 막는
-- 장치로 오히려 유용하다.
--
-- ---------------------------------------------------------------------------
-- 실측 (P3a 7단계) — 적용 전에 롤백 트랜잭션으로 측정했다
--
-- `pg_attribute.attacl` (적용 후)
--   id            {authenticated=r/postgres}
--   display_name  {authenticated=rw/postgres}    ← r(SELECT) + w(UPDATE) 한 항목
--   email         (null)
--   created_at    (null)
--   updated_at    (null)
--
-- **SELECT와 UPDATE는 한 ACL 항목 안의 `r`·`w`로 구분된다.** 그래서 권한
-- 매트릭스를 "열 목록"이 아니라 "열 → 권한 종류 목록"으로 바꿨다. 종전
-- `COLUMN_UPDATE_PRIVILEGES`는 권한 종류를 `UPDATE`로 하드코딩했으므로 SELECT가
-- 열 단위로 들어오면 그 구조로는 표현되지 않는다.
--
-- `information_schema.role_table_grants` (적용 후)
--   users 행이 **사라진다** (NO ROWS). 표 단위 GRANT가 없기 때문이다.
--   → 카탈로그 테스트의 표 단위 단언에서 `users: []`가 되어야 한다. 그 단언은
--     카탈로그에서 테이블을 열거해 빈 배열로 초기화하므로 이 변화를 잡는다.
--
-- `has_column_privilege('authenticated', 'public.users', …, 'SELECT')`
--   id = true, display_name = true, email = **false**, created_at = false
-- ---------------------------------------------------------------------------
-- ============================================================================

revoke select on public.users from authenticated;

-- display_name에는 UPDATE가 이미 열 단위로 있다(20260726171035). SELECT를
-- 더하면 같은 ACL 항목이 `rw`가 된다.
grant select (id, display_name) on public.users to authenticated;

comment on column public.users.email is
  'auth.users와 동기화되는 로그인 식별자. authenticated에게 SELECT를 부여하지 않는다 — 조회 계약(DOC-011 §4) 어디도 이 열을 쓰지 않는다. 트리거(security definer)가 채우고 관리자만 읽는다.';
