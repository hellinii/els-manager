-- ============================================================================
-- cron_runs.job — 환율 자동 수집의 배치 둘째 단계를 가른다. P8 컷 c2 (W6, expand)
-- DOC-010 ADR-010(분기 A) · DOC-011 CR-11 · DOC-013 §10.2.1 「W6」
--
-- ★ 이 파일은 expand 다. 기본값 'PRICES' 는 영구히 남는다 — P8 안에서 contract 하지
--   않는다(DOC-013 §10.2.1 「되돌리기」). 기존 행은 전부 시세 배치의 기록이므로 그
--   기본값으로 채우는 것이 참이다. 새 행(환율 단계)은 c2 의 오케스트레이션 코드가
--   job = 'EXCHANGE_RATE' 를 명시해 쓴다.
--
-- 이 마이그레이션은 CHECK 를 더하지 않는다 — 단순 ENUM 열 추가이므로 기존 행을
-- 위반시킬 수 없고, W6 ② 감사에 새 분모 행이 필요 없다(DOC-013 §10.2.1 이 미뤄 둔
-- 질문의 답).
-- ============================================================================

create type public.cron_job as enum ('PRICES', 'EXCHANGE_RATE');

comment on type public.cron_job is
  'DOC-002 §4.11. cron_runs 행이 시세 배치인지 환율 배치인지 (P8 컷 c2).';

alter table public.cron_runs
  add column job public.cron_job not null default 'PRICES';

comment on column public.cron_runs.job is
  'DOC-010 ADR-010 — 기존 행은 전부 시세 배치이므로 기본값 PRICES 가 참이다. P8 안에서 contract 하지 않는다(되돌리기 대상 보존, DOC-013 §10.2.1).';
