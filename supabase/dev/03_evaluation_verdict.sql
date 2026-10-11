-- ============================================================================
-- 평가일 판정 표본 — 로컬 개발 전용 (P6 컷 7-5 · DOC-007 §3.6 · DOC-008 SCR-101 ⑥)
--
--   docker exec -i supabase_db_els-manager psql -U postgres -d postgres \
--     -f - < supabase/dev/03_evaluation_verdict.sql
--
-- 01 · 02와 독립이다(먼저 적용하지 않아도 된다). `npm run db:reset`이 지우므로 멱등하지 않다 — 다시 적용하려면 리셋한다.
-- `supabase/seed/`에 두지 않는 이유와 롤 · claims 자기 단언의 이유는 01 파일 머리글 그대로다.
--
-- ---------------------------------------------------------------------------
-- 홈 ⑥ 「상환 확인 필요」에 서는 셋과 서지 않는 하나 — dev-a(…401) 소유
--
-- | # | 상품 | 최근 경과 차수 | 평가일 종가 | 평가일 판정 | 확인 대상 |
-- |---|---|---|---|---|---|
-- | V1 | 판정 충족 | 1차(평일 · 약 열흘 전) | 자산A 95 · 자산B 100 (기준가 100) | EARLY · W 0.95 | ⑥ 행 · SCR-202 안내 · SCR-203 `?round=1` |
-- | V2 | 판정 종가 없음 | 1차(같은 날) | 자산C 행 없음 | CLOSE_MISSING | ⑥ 「시세 입력」 · 결측 자산 이름 |
-- | V3 | 판정 이월 | 1차(같은 날) | 자산A 95 (기준가 150 → W 0.6333) | 없음 | ⑥에도 ④에도 없다(D2) |
-- | V4 | 판정 만기 | 2차 = 마지막(열흘 전) | — | MATURITY_REACHED | 등록일 컷 없음 · 유형 빈칸 · 금액 이익 가정 |
--
-- ★ 등록일(`created_at`)은 계약이 쓰지 않는다 — V1~V3은 **이 파일이 발행일로 소급한다**(같은 롤 · RLS 소유자 UPDATE).
--   소급하지 않으면 지난 1차가 「등록 전」이라 판정 대상이 아니다(D3). V4는 소급하지 않는다 — 만기에는 등록일 컷이 없다.
-- ★ 평가일이 주말이면 「주말로 저장된 평가일」 갈래로 간다 — 1차 평가일을 평일로 고른다(아래 `d1`).
-- ============================================================================

begin;

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-4000-8000-000000000401","role":"authenticated"}';

do $$
begin
  if current_user <> 'authenticated' then
    raise exception '롤 전환이 일어나지 않았다(current_user=%). BEGIN 블록 밖에서 실행했을 가능성이 크다.', current_user;
  end if;
  if (select auth.uid()) is null then
    raise exception 'request.jwt.claims가 비어 있어 auth.uid()가 NULL이다.';
  end if;
  if exists (select 1 from public.els_products where name like '[DEV] 판정%') then
    raise exception '[DEV] 판정 상품이 이미 있다. 이 파일은 멱등하지 않다 — npm run db:reset 후 다시 적용한다.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. 자산 셋 — 오늘 시세는 셋 다 둔다(카드가 「시세 없음」 소음 없이 서게). 평가일 종가는 §3
-- ---------------------------------------------------------------------------
insert into public.assets (id, name, asset_type, market, currency) values
  ('00000000-0000-4000-8000-0000000004c1', '[DEV] 판정자산A', 'INDEX', 'KRX', 'KRW'),
  ('00000000-0000-4000-8000-0000000004c2', '[DEV] 판정자산B', 'INDEX', 'KRX', 'KRW'),
  ('00000000-0000-4000-8000-0000000004c3', '[DEV] 판정자산C', 'INDEX', 'KRX', 'KRW');

insert into public.asset_prices (asset_id, as_of_date, price, source, provider) values
  ('00000000-0000-4000-8000-0000000004c1', current_date, 100.000000, 'AUTO', 'dev-fixture'),
  ('00000000-0000-4000-8000-0000000004c2', current_date, 105.000000, 'AUTO', 'dev-fixture'),
  ('00000000-0000-4000-8000-0000000004c3', current_date,  98.000000, 'AUTO', 'dev-fixture');

-- ---------------------------------------------------------------------------
-- 2. 상품 넷 — `create_els_product`(계약과 같은 함수). 차수는 6개월 주기로 계산한다(V-04 · V-07을 구조로 만족)
-- ---------------------------------------------------------------------------
do $$
declare
  d1    date := current_date - 10;   -- V1~V3의 1차 평가일(평일로 민다)
  spec  record;
  v_id  uuid;
begin
  while extract(isodow from d1) in (6, 7) loop
    d1 := d1 - 1;
  end loop;

  for spec in
    select *
      from (values
        ('[DEV] 판정 충족 V1',     (d1 - interval '6 months')::date,  d1,
         '[{"assetId":"00000000-0000-4000-8000-0000000004c1","basePrice":"100.000000","sequence":1},
            {"assetId":"00000000-0000-4000-8000-0000000004c2","basePrice":"100.000000","sequence":2}]'),
        ('[DEV] 판정 종가 없음 V2', (d1 - interval '6 months')::date,  d1,
         '[{"assetId":"00000000-0000-4000-8000-0000000004c1","basePrice":"100.000000","sequence":1},
            {"assetId":"00000000-0000-4000-8000-0000000004c3","basePrice":"100.000000","sequence":2}]'),
        ('[DEV] 판정 이월 V3',     (d1 - interval '6 months')::date,  d1,
         '[{"assetId":"00000000-0000-4000-8000-0000000004c1","basePrice":"150.000000","sequence":1}]'),
        -- V4 — 2차가 마지막이고 열흘 전이다(1차는 반년 전). 전 차수 경과 미상환(E-07)
        ('[DEV] 판정 만기 V4',     (current_date - 10 - interval '12 months')::date, (current_date - 10 - interval '6 months')::date,
         '[{"assetId":"00000000-0000-4000-8000-0000000004c1","basePrice":"100.000000","sequence":1}]')
      ) as t(name, issue_date, first_round, underlyings)
  loop
    v_id := public.create_els_product(jsonb_build_object(
      'name',                   spec.name,
      'issuer',                 '키움증권',
      'issueDate',              to_char(spec.issue_date, 'YYYY-MM-DD'),
      'principal',              '100000000',
      'currency',               'KRW',
      'evaluationPeriodMonths', 6,
      'annualCouponRate',       '0.0800',
      'kiBarrier',              '0.5000',
      'kiObservation',          'CLOSING',
      'accountType',            'GENERAL',
      'couponPayout',           'AT_REDEMPTION',
      'note',                   '평가일 판정 표본(supabase/dev/03).',
      'underlyings',            spec.underlyings::jsonb,
      -- V4는 2차(마지막), 나머지는 3차까지 — 1차 평가일 + 6개월 × (n − 1)
      'schedules', (
        select jsonb_agg(jsonb_build_object(
                 'roundNo', n,
                 'evaluationDate', to_char((spec.first_round + ((n - 1) * 6 || ' months')::interval)::date, 'YYYY-MM-DD'),
                 'barrier', ((0.90 - 0.05 * (n - 1))::numeric(6,4))::text,
                 'lizardBarrier', null, 'lizardCouponRate', null, 'lizardRequiresNoKi', null)
               order by n)
          from generate_series(1, case when spec.name like '%V4' then 2 else 3 end) as n)
    ));
    if v_id is null then
      raise exception '% 생성이 실패했다', spec.name;
    end if;
  end loop;

  -- 등록일 소급(V1~V3) — 발행일. `date`를 `timestamptz`로(세션 UTC 자정 = KST 09시, 같은 날짜)
  update public.els_products
     set created_at = (d1 - interval '6 months')::date::timestamptz
   where name in ('[DEV] 판정 충족 V1', '[DEV] 판정 종가 없음 V2', '[DEV] 판정 이월 V3');

  -- ---------------------------------------------------------------------------
  -- 3. 평가일 종가 — V1(자산A 95 · 자산B 100) · V3(자산A 95 — 같은 행을 기준가 150으로 본다) · V2의 자산C는 «없다»
  -- ---------------------------------------------------------------------------
  insert into public.asset_prices (asset_id, as_of_date, price, source, provider) values
    ('00000000-0000-4000-8000-0000000004c1', d1,  95.000000, 'AUTO', 'dev-fixture'),
    ('00000000-0000-4000-8000-0000000004c2', d1, 100.000000, 'AUTO', 'dev-fixture');
end $$;

-- ---------------------------------------------------------------------------
-- 4. 결과 확인 — 커밋 전에 사람이 읽는다. 등록일(KST)이 V1~V3은 발행일, V4는 오늘이어야 한다
-- ---------------------------------------------------------------------------
select
  p.name                                                   as 상품,
  (p.created_at at time zone 'Asia/Seoul')::date           as 등록일,
  string_agg(s.round_no || '차 ' || s.evaluation_date, ' · ' order by s.round_no) as 차수,
  (select count(*) from public.asset_prices ap
     join public.els_underlyings u on u.asset_id = ap.asset_id and u.els_id = p.id
    where ap.as_of_date = (select min(s2.evaluation_date) from public.redemption_schedules s2 where s2.els_id = p.id)
  )                                                        as 일차_평가일_종가_행수
from public.els_products p
join public.redemption_schedules s on s.els_id = p.id
where p.name like '[DEV] 판정%'
group by p.id, p.name, p.created_at
order by p.name;

commit;
