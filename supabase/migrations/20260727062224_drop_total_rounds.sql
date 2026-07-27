-- ============================================================================
-- els_products.total_rounds 삭제 — DOC-002 §4.6, DQ-05 해결 (P3a)
--
-- 유도 가능한 값을 저장하면서 정합성을 강제하는 층이 어디에도 없었다(M-02).
-- `total_rounds = 99`인데 `redemption_schedules`가 0건인 상태가 계속 저장
-- 가능했고, 어떤 제약도 트리거도 두 값을 대조하지 않았다.
--
-- **총 차수의 정본은 `redemption_schedules`의 행 수다.**
-- `max(round_no)`가 아니다 — 차수 번호의 연속성(DOC-011 V-04)은 계약 계층에만
-- 있어 DB는 `1, 2, 99`를 허용하므로 두 값이 갈린다. DOC-002 §4.6이 만기일
-- 정본을 이미 일정의 마지막 차수로 정했으므로 차수 정본도 같은 곳으로 통일한다.
--
-- 총 차수는 **입력 계층에는 남는다** — DOC-011 §5.1 `ProductInput.totalRounds`가
-- `generateEvaluationDates`의 인자이고 V-03이 `schedules.length`와 대조한다.
-- 저장된 참조 대상이 없는 자기 검증이며, 배리어 스케줄 파서의 오류를 잡는다.
--
-- DOC-002 DQ-06의 미결 CHECK 목록에 있던 `total_rounds >= 1`은 v0.5에서
-- 함께 제거했다 — 컬럼이 사라지므로 조용히 무효화하지 않고 명시적으로 지웠다.
-- 차수 0건은 이제 값 범위 문제가 아니라 I-07(교차 행)의 문제이고, 조회 계층이
-- `integrityIssue = 'SCHEDULE_MISSING'`으로 드러낸다(DOC-011 §4.2).
-- ============================================================================

alter table public.els_products drop column total_rounds;

comment on table public.els_products is
  'D-01: status 컬럼을 두지 않는다. 상태는 redemptions 레코드의 존재로 유도한다 — 보유중은 레코드 없음, 상환완료는 레코드 있음. UNIQUE(redemptions.els_id)가 이중 상환·이중 집계를 스키마 수준에서 불가능하게 한다(K-04). DQ-05: total_rounds 컬럼도 두지 않는다. 총 차수와 만기일의 정본은 모두 redemption_schedules이며, 총 차수는 행 수다(max(round_no)가 아니다 — 차수 연속성은 계약 계층에만 있다).';
