-- ============================================================================
-- cron_runs — 시세 배치 실행 기록. 테이블 12 → 13 — P5a 컷 2a
-- DOC-002 §4.11 · I-19 · I-20 · DOC-013 §7.2 (AQ-51 종결) · DOC-011 §7.1
--
-- 근거가 «셋» 이고 서로 독립이다. 하나라도 빠지면 "있으면 좋다" 가 되므로 적어 둔다.
--   ① 지나간 중간 실패의 사후 진단 — 재호출은 "지금" 만 알려 주고 "그때" 를 모른다
--   ② 호출자 판별 — asset_prices 에 호출자 열이 없어 Cron·진단 curl·SCR-302 버튼이
--      갈리지 않는다
--   ③ "전면 실패" 의 관측 — P5a 착지 후 CR-04 ⓒ 의 실행 경로가 0이 된다
--      (CR-07 의 503 이 도달 불가가 되고 CR-02 가 부분 실패를 200 으로 답한다)
--
-- ★ ③ 이 시한을 만들었다 — 수집기(컷 3)보다 늦으면 잃는 것이 «미래의 관측이 아니라
--   그 구간의 과거» 다. 그래서 이 마이그레이션이 컷 3 «앞» 이다 (DOC-013 §7.1 ★★★).
--
-- ---------------------------------------------------------------------------
-- ★★ actor_id 가 ② 를 «사용자» 열로 닫는다 — caller 가 아니다.
--
--   AQ-57 이 ⓐ(전용 GoTrue 서비스 계정)로 닫혔으므로 배치가 자기 정체성을 갖는다.
--   그래서 아래 INSERT 정책이 actor_id = auth.uid() 를 강제할 수 있고, 그것이 귀속을
--   «위조 불가» 로 만든다. caller 는 요청이 스스로 주장하는 값이므로 편의상의 분류일
--   뿐 판별자가 아니다 — 그 비대칭을 여기 적어 둔다.
--
--   ★ service_role 로는 이 성질을 얻을 수 없다 — 그 롤은 rolbypassrls = t 라서 정책이
--     «아예 적용되지 않는다». 즉 이 열의 신뢰성이 AQ-57 의 답에 의존한다.
--
--   남는 공백: Cron 과 손으로 쏜 진단 curl 은 여전히 구별되지 않는다(같은 토큰·같은
--   정체성). x-vercel-cron 헤더가 후보이나 «미실측» 이므로 설계가 아니라 잔여다
--   (DOC-013 §11).
--
-- ---------------------------------------------------------------------------
-- ★ UPDATE·DELETE 를 부여하지 «않고» 정책도 두지 않는다 — 두 겹이다 (DOC-010 §7).
--
--   정책 부재만으로는 UPDATE·DELETE 가 «오류 없이 0행» 으로 끝나 버그가 은폐된다.
--   권한도 회수해 두면 42501 로 시끄럽게 실패한다.
--   고칠 수 있는 관측 기록은 기록이 아니다.
--
-- ---------------------------------------------------------------------------
-- ★ I-19 를 등식이 아니라 «부등식» 으로 쓴다.
--
--   DOC-011 §7.1 의 불변식은 등식이다:
--     target_count = succeeded + skipped + unmapped + length(failed)
--   그런데 failed 가 JSONB 이므로 그 길이를 단일 행 CHECK 에서 세면 «제약이 JSON
--   구조에 의존» 하게 된다 — 형태가 바뀌면 조용히 뜻을 잃거나 시끄럽게 깨진다.
--
--   그래서 DB 는 바닥만 잡고(넷의 합이 대상 수를 넘을 수 없다) 등식은 순수 모듈이
--   지킨다. I-07 과 같은 부류다 — 표현 가능한 절반만 DB 에 둔다.
--   ★ 그 등식을 단언하는 스위트는 컷 3에서 선다. 그때까지 등식은 어느 층도 강제하지
--     않는다는 사실을 DOC-002 §8 각주가 적는다.
--
-- ---------------------------------------------------------------------------
-- failed 를 14번째 테이블로 만들지 않는 이유: 그것은 DOC-011 §7.1 이 형태를 소유한
-- «보고» 이고 질의 대상 도메인 엔티티가 아니다. create_els_product(jsonb) 가 선례다.
-- 그리고 이것은 DQ-04(감사 로그)가 «아니다» — 그쪽은 도메인 데이터의 변경 이력이며
-- 여전히 미결이다. 둘을 같게 읽으면 DQ-04 가 닫힌 것으로 오해된다.
-- ============================================================================

create type public.cron_caller  as enum ('BATCH', 'MANUAL_REFRESH');
create type public.cron_outcome as enum ('OK', 'PROVIDER_UNAVAILABLE', 'INTERNAL');

create table public.cron_runs (
  id           uuid        primary key default gen_random_uuid(),

  -- 실행 주체. users 삭제가 CASCADE 이므로(§8.1) 그 사용자의 실행 기록도 함께
  -- 사라진다 — 관측 기록이지 과세 근거가 아니므로 그 전파를 받아들인다.
  actor_id     uuid        not null references public.users (id) on delete cascade,

  caller       public.cron_caller  not null,
  outcome      public.cron_outcome not null,

  started_at   timestamptz not null,
  finished_at  timestamptz not null,

  target_count integer     not null,
  succeeded    integer     not null,
  skipped      integer     not null,
  unmapped     integer     not null,

  -- DOC-011 §7.1 의 failed[]. 형태는 그 계약이 소유한다
  failed       jsonb       not null default '[]'::jsonb,

  created_at   timestamptz not null default now(),

  -- I-19 — 부등식이다. 위 ★ 참조
  constraint cron_runs_counts_check check (
    target_count >= 0
    and succeeded >= 0
    and skipped   >= 0
    and unmapped  >= 0
    and succeeded + skipped + unmapped <= target_count
  ),

  -- I-20
  constraint cron_runs_interval_check check (finished_at >= started_at)
);

-- 절대 규칙 #6 — 테이블을 추가하면 함께 쓴다. 빠뜨리면 정책·GRANT 와 무관하게
-- 전면 개방된다(fail-open).
alter table public.cron_runs enable row level security;

-- 조회는 전체(관측 기록은 공용) · 쓰기는 INSERT 뿐. UPDATE·DELETE 는 위 ★ 참조
grant select, insert on public.cron_runs to authenticated;

create policy cron_runs_select_all on public.cron_runs
  for select to authenticated using (true);

-- ★ (select auth.uid()) 로 감싼다 — 행마다 재평가되지 않게 하는 기존 규약이고,
--   무엇보다 이 조건이 actor_id 의 «위조 불가» 를 만든다.
create policy cron_runs_insert_self on public.cron_runs
  for insert to authenticated with check (actor_id = (select auth.uid()));
