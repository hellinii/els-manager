-- ============================================================================
-- 함수 실행 권한 — 운영의 기본 권한이 로컬과 다르다 (DOC-010 AQ-90 · AQ-28의 후속)
--
-- ★ 발견 (2026-09-30, P8 W1 ④ 확인 — Management API 읽기 전용 실측)
--
--   `pg_default_acl`의 `postgres · public · 함수(f)` 항목이 두 환경에서 다르다.
--
--     로컬(supabase CLI 스택)   {postgres=X/postgres}
--     운영(Supabase 플랫폼)     {postgres=X/postgres, anon=X/postgres,
--                               authenticated=X/postgres, service_role=X/postgres}
--
--   그래서 `postgres`가 만드는 함수는 운영에서 세 롤에 **명시적** EXECUTE를 받고 태어난다.
--   이 저장소의 규약(`revoke execute … from public` — CLAUDE.md 절대 규칙 6 · AQ-28)은
--   `PUBLIC`의 몫만 지우므로 **명시 부여가 그대로 남는다.** 실측: 운영 `public`의 함수
--   아홉이 전부 `anon=X`이고 트리거 함수까지 `authenticated=X`다. 로컬에서는 같은 마이그레이션이
--   `{postgres=X}`(+ RPC 셋에만 `authenticated`)를 만든다 — `tests/rls/functions.test.ts`의
--   「anon은 어떤 함수도 실행할 수 없다」는 **로컬에서만 참**이었다(7월부터).
--
--   새는 경로는 없었다 — 실측으로 확인했다:
--     · 트리거 함수 여섯(`returns trigger`)은 직접 호출이 거부된다(security definer 둘 포함)
--     · RPC 셋은 security invoker이고 `anon`은 `public`의 모든 테이블에 SELECT·INSERT·UPDATE·
--       DELETE가 0이다 — 첫 INSERT에서 42501로 막힌다
--   즉 두 겹 방어(함수 실행 권한 → 테이블 권한·RLS) 중 **앞 겹이 운영에만 없었다.**
--
-- 이 마이그레이션이 하는 일 셋:
--   ① 기존 함수의 세 롤 EXECUTE를 **명시적으로** 회수한다
--   ② 쓰기 RPC 셋에만 `authenticated`를 다시 준다(종전 마이그레이션의 의도 그대로)
--   ③ `postgres`의 기본 권한에서 세 롤을 뺀다 — 이후 함수가 운영에서도 로컬처럼 태어난다
--
-- 로컬에서는 ①③이 **무효과**다(뺄 부여가 없다). 그래서 이 파일의 효과는 로컬 스위트로
-- 판별되지 않는다 — `tests/rls/functions.test.ts`의 「운영의 기본 권한 아래에서」 케이스가
-- 롤백 트랜잭션 안에서 운영의 기본 권한을 **재현해** 규약의 빈틈과 ③의 효과를 보고, 운영
-- 적용 뒤에는 DOC-013 §10.2.1 ④의 함수 권한 질의가 본다.
--
-- 트리거는 영향을 받지 않는다 — 트리거 함수의 EXECUTE는 발화 시점에 검사되지 않는다
-- (AQ-28 ③의 실측: `security definer` 트리거 함수에서 회수해도 트리거가 돈다).
-- ============================================================================

-- ① 기존 함수 — `public`의 전부. 확장은 `extensions` 스키마에 있다(AQ-28 ②)
revoke execute on all functions in schema public from anon, authenticated, service_role;

-- ② 쓰기 RPC — 로그인한 사용자만 (DOC-011 §5.1 · §5.2 · §5.11)
grant execute on function public.create_els_product(jsonb)          to authenticated;
grant execute on function public.update_els_product(uuid, jsonb)    to authenticated;
grant execute on function public.create_realized_els_product(jsonb) to authenticated;

-- ③ 이후 함수 — 운영의 플랫폼 기본값을 로컬과 같게 만든다.
--    `for role postgres`를 명시한다: 기본 권한은 «누가 만드는가»별로 저장되고 운영의 그 항목의
--    주인이 `postgres`다(실측). 마이그레이션은 `postgres`로 적용된다
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
