-- ============================================================================
-- 2026년 세율·요율 — ADR-005, M-05, DOC-002 §4.10, DOC-007 §2·§5.1
--
-- 기존 연도 행은 수정하지 않는다. 정정이 필요해도 신규 마이그레이션으로
-- 처리하여 이력을 보존한다(ADR-005). 그래야 과거 연도 계산이 영구히
-- 재현되고, 회귀 테스트(K-08)의 전제가 성립한다.
--
-- 연도가 추가되면 이 파일을 고치지 않고 _tax_rates_2027.sql을 새로 만든다.
--
-- ※ tests/seed/parse-seed-sql.ts가 이 파일을 정규식으로 파싱한다(AQ-05).
--   VALUES 튜플을 한 줄에 하나씩 유지한다. 형식이 바뀌면 튜플 개수 단언이
--   먼저 실패하므로 조용히 통과하는 경로는 없다.
--
-- 소수 리터럴은 PostgreSQL에서 numeric이다. 0.0719는 정확하며 이진
-- 부동소수점을 경유하지 않는다(M-03).
-- ============================================================================

insert into public.tax_years (tax_year, note) values
  (2026, '2026년 귀속. 종합소득세 누진세율 8구간(DOC-007 §5.1), 주입 상수 9개(DOC-007 §2)');

-- DOC-007 §5.1 — 종합소득세 누진세율
insert into public.tax_brackets (tax_year, lower_bound, rate, progressive_deduction) values
  (2026,          0, 0.06,        0),
  (2026,   14000000, 0.15,  1260000),
  (2026,   50000000, 0.24,  5760000),
  (2026,   88000000, 0.35, 15440000),
  (2026,  150000000, 0.38, 19940000),
  (2026,  300000000, 0.40, 25940000),
  (2026,  500000000, 0.42, 35940000),
  (2026, 1000000000, 0.45, 65940000);

-- DOC-002 §4.10 키 목록 — DOC-007 §2의 주입 상수와 1:1 대응
--
-- separate_taxation_rate(15.4%)와 separate_taxation_income_tax_rate(14%)는
-- 별개 키다. 전자는 지방세를 포함한 원천징수 총액, 후자는 소득세분이며
-- 비교과세는 소득세만 산출한 뒤 지방소득세를 따로 가산한다.
--
-- 건보 문턱 3개가 종합과세 기준금액과 같은 2,000만원인 것은 우연이다.
-- 근거 법령이 국민건강보험법과 소득세법으로 나뉘어 한쪽만 개정될 수 있다.
insert into public.tax_constants (tax_year, key, value) values
  (2026, 'separate_taxation_rate',             0.154),
  (2026, 'separate_taxation_income_tax_rate',  0.14),
  (2026, 'comprehensive_taxation_threshold',   20000000),
  (2026, 'local_income_tax_rate',              0.1),
  (2026, 'health_insurance_rate',              0.0719),
  (2026, 'long_term_care_rate',                0.1314),
  (2026, 'regional_income_threshold',          10000000),
  (2026, 'employee_non_wage_income_threshold', 20000000),
  (2026, 'dependent_income_threshold',         20000000);
