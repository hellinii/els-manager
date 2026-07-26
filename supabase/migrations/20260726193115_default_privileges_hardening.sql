-- ============================================================================
-- 신규 객체의 기본 권한 회수 — DOC-010 v0.3 §7.1
--
-- §7.1 표의 둘째 줄("GRANT 있음 + RLS 켜짐 + 정책 없음 → 기본 거부")이
-- **TRUNCATE 에 대해 거짓이었다.** RLS 정책은 SELECT·INSERT·UPDATE·DELETE 에만
-- 적용되고 TRUNCATE 에는 적용되지 않는다.
--
-- 실측: public 에 새 테이블을 만들고 enable row level security 까지 켠 뒤
-- (즉 §7.1 의 첫 규약을 **지킨** 상태) authenticated 로 시도한 결과
--
--   SELECT / INSERT / DELETE → 42501
--   TRUNCATE                → 성공. 전 행 삭제
--
-- 원인은 기본 권한이다. 20260726171035 는 revoke all on all tables 로
-- **이미 만들어진** 테이블을 정리했고, alter default privileges 회수는
-- anon 에만 적용했다. 그래서 신규 테이블에는 authenticated 가 TRUNCATE ·
-- REFERENCES · TRIGGER 를 자동으로 받는다. 기존 12개 테이블은 그 회수가
-- 생성 이후 1회 돌았으므로 안전하다 — 문제는 회수가 일회성이라는 구조다.
--
-- ★ 이 마이그레이션만으로는 부족하다.
--
--   pg_default_acl 에는 defaclrole = supabase_admin 행이 따로 있고 거기에는
--   anon·authenticated 가 여전히 전 권한으로 남아 있다. 플랫폼이 기본값을
--   재시딩하면 이 회수는 신호 없이 무효가 된다. **지속적인 방어 수단은
--   마이그레이션이 아니라 테스트다** — tests/rls/catalog.test.ts 가 §7 권한
--   표를 데이터로 박고 실제 GRANT 와 대조한다.
--
-- ALTER DEFAULT PRIVILEGES 는 순수하게 prospective 이므로 20260726171035
-- 보다 늦게 실행되는 것 자체는 문제가 되지 않는다.
-- ============================================================================

alter default privileges in schema public revoke all on tables    from authenticated;

-- 시퀀스도 함께 회수한다. 현재 스키마에 시퀀스는 0개지만(전부
-- gen_random_uuid()) 실측한 기본 ACL 은 신규 시퀀스에 authenticated 에게
-- UPDATE(= setval)를 부여한다. 20260726171035 가 anon 에는 테이블·시퀀스
-- 양쪽을 회수했으므로 대칭을 맞춘다.
alter default privileges in schema public revoke all on sequences from authenticated;

-- ---------------------------------------------------------------------------
-- service_role 은 이 회수의 대상이 아니다.
--
-- 실측: 회수 후에도 service_role 은 신규 테이블에 Dxtm 을 유지한다. 즉 DML 이
-- 없으므로 시세 배치(§6.2)가 신규 테이블에 접근하면 42501 로 막힌다. 조용히
-- 열리는 방향이 아니라 시끄럽게 막히는 방향이므로 지금 위험은 낮으나,
-- 20260726171035 의 grant all 도 일회성이라는 점은 같다.
-- DOC-010 AQ-11 로 등재했다 — P5 에서 권한 축소와 함께 정한다.
-- ---------------------------------------------------------------------------
