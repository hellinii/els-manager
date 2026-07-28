-- ============================================================================
-- 무결성 결함 상품 — 로컬 개발 전용 (ST-06 검증)
--
--   docker exec -i supabase_db_els-manager psql -U postgres -d postgres \
--     -f - < supabase/dev/02_broken_fixtures.sql
--
-- `01_sample_portfolio.sql`을 먼저 적용한다(자산을 공유한다).
-- `npm run db:reset`이 지운다.
--
-- ---------------------------------------------------------------------------
-- ★ 왜 별 파일인가
--
--   이 두 행은 **정상 데이터가 아니다.** 표본 포트폴리오에 섞으면 「목록에 12건」
--   같은 눈대중이 14건이 되고, 결함이 데이터의 일부처럼 보인다. 결함을 보려고
--   적용하는 파일과 화면을 보려고 적용하는 파일을 가른다.
--
-- ---------------------------------------------------------------------------
-- ★ 「계약으로는 도달 불가」의 정확한 뜻 — 함수로도 만들 수 없다
--
--   `create_els_product`는 말미에서 하위 행 수를 검사하고 0건이면 `23514`로
--   되돌린다(I-07의 DB 층 방어). 즉 **만드는 경로**로는 결함 상품이 생기지 않는다.
--
--   그런데 **`authenticated`는 하위 테이블에 행 단위 DELETE 권한을 갖는다** —
--   `els_underlyings_delete_own`·`redemption_schedules_delete_own`이 자기 상품의
--   하위 행을 지우게 허용하며, 그 경로에는 아무 검사도 없다. 그래서 «정상 상품을
--   만든 뒤 하위 행을 지운다»가 성립한다. 이것이 DOC-010 AQ-14가 「행 단위 DELETE
--   권한은 여전히 열려 있으므로 계약 밖 경로의 예방은 아직 없다」고 적은 구멍이며,
--   이 파일은 그 구멍을 **재현하는 대신 문서화한 상태로 이용한다.**
--
--   그러므로 여기서 하는 일은 특권 조작이 아니다. `set local role authenticated`
--   그대로, 실제 사용자가 할 수 있는 두 문장을 부른다 — 그편이 손으로
--   `insert into els_products`를 하는 것보다 사실에 가깝고(그쪽은 owner_id를
--   위조할 수 있어 RLS를 지나지 않는다) 결함의 발생 경로를 정확히 보여 준다.
--
-- ---------------------------------------------------------------------------
-- ★ 화면에서 확인할 것 (ST-06 · DOC-011 §4.2 D1)
--
--   | 결함 | 파괴한 입력 | 죽는 값 | **사는** 값 |
--   |---|---|---|---|
--   | `UNDERLYING_MISSING` | 시세 | `worstOf`·`kiStatus`·`conditionResult` | `nextEvaluation`·`projection` |
--   | `SCHEDULE_MISSING` | 차수 | `nextEvaluation`·`conditionResult`·`projection` | `worstOf`·`kiStatus` |
--
--   두 카드가 「시세 없음」이 아니라 **서로 다른 문구**로 나와야 하고
--   (「기초자산 없음 — 수정 필요」/「평가일정 없음 — 수정 필요」) 뱃지 등급이
--   `defect`여야 한다. 같은 문구로 보이면 사용자가 영원히 오지 않을 시세를
--   기다린다 — ST-06이 막으려는 상태다.
--
--   `SCHEDULE_MISSING` 쪽에 **시세가 있는 자산**을 쓰는 것이 의도다. 시세가
--   없으면 「일정 0건」과 「시세 없음」이 뒤엉켜 어느 원인이 값을 죽였는지
--   갈리지 않는다(integration 스위트가 같은 이유로 픽스처를 하나 더 두었다).
-- ============================================================================

begin;

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-4000-8000-000000000401","role":"authenticated"}';

do $$
declare
  v_id  uuid;
  v_asset uuid;
begin
  -- 전제 — 근거는 01_sample_portfolio.sql의 주석에 있다(롤을 빠뜨리면 RLS가 꺼진다)
  if current_user <> 'authenticated' then
    raise exception '롤 전환이 일어나지 않았다(current_user=%).', current_user;
  end if;
  if (select auth.uid()) is null then
    raise exception 'request.jwt.claims가 비어 있다.';
  end if;
  if not exists (select 1 from public.els_products where name like '[DEV]%') then
    raise exception
      '[DEV] 상품이 없다. supabase/dev/01_sample_portfolio.sql을 먼저 적용한다 '
      '(자산을 공유한다).';
  end if;
  if exists (select 1 from public.els_products where name like '[DEV] 결함%') then
    raise exception '[DEV] 결함 상품이 이미 있다. npm run db:reset 후 다시 적용한다.';
  end if;

  -- ── ① UNDERLYING_MISSING ────────────────────────────────────────────────
  v_asset := '00000000-0000-4000-8000-0000000004a1';  -- 시세 있음(문제 없음)

  v_id := public.create_els_product(jsonb_build_object(
    'name',                   '[DEV] 결함 · 기초자산 없음',
    'issuer',                 '개발용',
    'issueDate',              to_char((current_date - interval '2 months')::date, 'YYYY-MM-DD'),
    'principal',              '10000000',
    'evaluationPeriodMonths', 6,
    'annualCouponRate',       '0.0800',
    'kiBarrier',              '0.5000',
    'kiObservation',          'CLOSING',
    'accountType',            'GENERAL',
    'note',                   '기초자산 행을 지운 상태다 — 계약으로는 만들 수 없다(I-07).',
    'underlyings', jsonb_build_array(
      jsonb_build_object('assetId', v_asset, 'basePrice', '350.000000', 'sequence', 1)),
    'schedules', jsonb_build_array(
      jsonb_build_object('roundNo', 1,
        'evaluationDate', to_char((current_date + interval '4 months')::date, 'YYYY-MM-DD'),
        'barrier', '0.9000',
        'lizardBarrier', null, 'lizardCouponRate', null, 'lizardRequiresNoKi', null),
      jsonb_build_object('roundNo', 2,
        'evaluationDate', to_char((current_date + interval '10 months')::date, 'YYYY-MM-DD'),
        'barrier', '0.8500',
        'lizardBarrier', null, 'lizardCouponRate', null, 'lizardRequiresNoKi', null))
  ));

  -- 여기가 구멍이다 — 정책도 제약도 이 문장을 막지 않는다(AQ-14)
  delete from public.els_underlyings where els_id = v_id;

  if exists (select 1 from public.els_underlyings where els_id = v_id) then
    raise exception '기초자산 행이 지워지지 않았다 — RLS가 막았다면 전제가 바뀐 것이다.';
  end if;

  -- ── ② SCHEDULE_MISSING ──────────────────────────────────────────────────
  v_id := public.create_els_product(jsonb_build_object(
    'name',                   '[DEV] 결함 · 평가일정 없음',
    'issuer',                 '개발용',
    'issueDate',              to_char((current_date - interval '2 months')::date, 'YYYY-MM-DD'),
    'principal',              '12000000',
    'evaluationPeriodMonths', 6,
    'annualCouponRate',       '0.0800',
    'kiBarrier',              '0.5000',
    'kiObservation',          'CLOSING',
    'accountType',            'GENERAL',
    'note',                   '평가일정 행을 지운 상태다. 시세는 온전하므로 워스트오브·KI가 산다.',
    'underlyings', jsonb_build_array(
      jsonb_build_object('assetId', v_asset, 'basePrice', '350.000000', 'sequence', 1)),
    'schedules', jsonb_build_array(
      jsonb_build_object('roundNo', 1,
        'evaluationDate', to_char((current_date + interval '4 months')::date, 'YYYY-MM-DD'),
        'barrier', '0.9000',
        'lizardBarrier', null, 'lizardCouponRate', null, 'lizardRequiresNoKi', null))
  ));

  delete from public.redemption_schedules where els_id = v_id;

  if exists (select 1 from public.redemption_schedules where els_id = v_id) then
    raise exception '평가일정 행이 지워지지 않았다 — 전제가 바뀐 것이다.';
  end if;
end $$;

select
  p.name as 상품,
  (select count(*) from public.els_underlyings     x where x.els_id = p.id) as 기초자산,
  (select count(*) from public.redemption_schedules s where s.els_id = p.id) as 차수
from public.els_products p
where p.name like '[DEV] 결함%'
order by p.name;

commit;
