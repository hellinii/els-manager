-- ============================================================================
-- 표본 포트폴리오 — 로컬 개발 전용 (P4 컷 2·3)
--
--   docker exec -i supabase_db_els-manager psql -U postgres -d postgres \
--     -f - < supabase/dev/01_sample_portfolio.sql
--
-- `npm run db:reset`이 이 파일을 **지운다.** 격리가 규율이 아니라 구조인 이유다.
--
-- ---------------------------------------------------------------------------
-- ★ 왜 `supabase/seed/`가 아닌가 (CLAUDE.md·계획 §9)
--
--   `sql_paths = ["./seed/*.sql"]`가 **글롭**이므로 `seed/`에 두면 `db:reset`이
--   자동으로 싣는다. 그러면 `tests/integration/contracts.test.ts`의 **필터 없는
--   전역 건수 단언**(`expect(await s.asA.listProducts()).toHaveLength(5)`)이
--   깨진다 — 모든 SELECT 정책이 `using (true)`라 남의 상품도 세기 때문이다.
--   `resetFixtures()`는 `ALL_FIXTURE_IDS`만 지우므로 시드 상품은 매 실행에 남고,
--   그러면 **성장 불변 테스트가 잘못된 이유로 빨간불**이 된다.
--
--   실행 순서는 CLAUDE.md가 정한 대로다: `db:reset` → (이 파일) → 브라우저 →
--   `db:reset` → `test:rls`·`test:integration`·`test:e2e`.
--
-- ---------------------------------------------------------------------------
-- ★ 왜 `create_els_product`를 부르는가 — 손으로 INSERT하지 않는다
--
--   계약과 **같은 함수**를 지나므로 I-07(하위 행 ≥ 1건)과 테이블 CHECK 전부가
--   강제된다. `owner_id`는 함수가 `auth.uid()`로 박으므로 payload로 위조할 수
--   없다(실측: `ownerId`·`owner_id` 키를 넣어도 무시된다).
--
--   **함수가 보지 않는 것이 셋 있다** — V-04(차수 연속성)·V-07(평가일 증가)·
--   V-09(자산 중복)은 계약 계층에만 있다(DOC-011 AQ-29). 그래서 이 파일은 그
--   셋을 **구조로** 만족시킨다: 차수는 `generate_series(1, rounds)`로 만들고
--   평가일은 `발행일 + n×평가주기`이므로 연속성과 단조 증가가 계산 결과이며,
--   기초자산은 상품마다 서로 다른 자산 id를 쓴다. 손으로 적은 목록이 아니다.
--
-- ---------------------------------------------------------------------------
-- ★ 전제 둘을 스스로 확인한다 — 이 파일에서 가장 중요한 줄이다
--
--   ① `set local role authenticated`는 **트랜잭션 안에서만** 동작한다. 밖에서는
--      `WARNING: SET LOCAL can only be used in transaction blocks`만 남기고
--      `current_user`가 `postgres`로 남는다(실측). 그런데 `postgres`는
--      **`rolbypassrls = t`**이므로 그 상태에서는 RLS가 통째로 꺼진다 —
--      실측으로 남의 상품을 `update_els_product`로 고치는 데 성공했다.
--      즉 **빠뜨림이 실패가 아니라 조용한 성공으로 나타난다.**
--
--   ② `auth.uid()`는 롤이 아니라 GUC를 읽는다
--      (`current_setting('request.jwt.claims', true)::jsonb ->> 'sub'`).
--      롤만 바꾸면 `auth.uid()`가 NULL이고, 그러면 RLS의 WITH CHECK가 먼저
--      걸려 `42501`이 난다 — `owner_id`의 NOT NULL(`23502`)이 아니다. 원인이
--      정책 결함처럼 보인다.
--
--   두 절반이 서로를 가리지 못하므로 **양쪽을 단언한다.**
-- ============================================================================

begin;

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-4000-8000-000000000401","role":"authenticated"}';

do $$
begin
  if current_user <> 'authenticated' then
    raise exception
      '롤 전환이 일어나지 않았다(current_user=%). BEGIN 블록 밖에서 실행했을 '
      '가능성이 크다 — postgres는 rolbypassrls이므로 이대로 진행하면 RLS를 '
      '지나지 않은 데이터가 만들어진다.', current_user;
  end if;
  if (select auth.uid()) is null then
    raise exception
      'request.jwt.claims가 비어 있어 auth.uid()가 NULL이다. 롤만 바꾸면 '
      'owner_id를 박을 수 없고 RLS WITH CHECK가 42501을 낸다.';
  end if;
  if exists (select 1 from public.els_products where name like '[DEV]%') then
    raise exception
      '[DEV] 상품이 이미 있다. 이 파일은 멱등하지 않다 — npm run db:reset 후 '
      '다시 적용한다.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. 기초자산 · 시세
--
-- 이름에 `[DEV]` 접두사를 붙인다. `assets_name_market_key`가
-- **UNIQUE NULLS NOT DISTINCT**이므로 integration 픽스처의 이름 대역(`[ITG]`)과
-- 겹치면 23505가 된다 — 그쪽도 같은 이유로 접두사를 예약해 두었다.
--
-- `[DEV] 시세미확보지수`에는 시세 행을 **만들지 않는다.** E-01(시세 없음)과
-- ST-01은 그 상태에서만 확인된다.
-- ---------------------------------------------------------------------------
insert into public.assets (id, name, asset_type, market, currency) values
  ('00000000-0000-4000-8000-0000000004a1', '[DEV] 코스피200',      'INDEX', 'KRX',    'KRW'),
  ('00000000-0000-4000-8000-0000000004a2', '[DEV] S&P500',         'INDEX', 'NYSE',   'USD'),
  ('00000000-0000-4000-8000-0000000004a3', '[DEV] 삼성전자',       'STOCK', 'KRX',    'KRW'),
  ('00000000-0000-4000-8000-0000000004a4', '[DEV] HSCEI',          'INDEX', 'HKEX',   'HKD'),
  ('00000000-0000-4000-8000-0000000004a5', '[DEV] 테슬라',         'STOCK', 'NASDAQ', 'USD'),
  ('00000000-0000-4000-8000-0000000004a6', '[DEV] 시세미확보지수', 'INDEX', null,     'KRW'),
  ('00000000-0000-4000-8000-0000000004a7', '[DEV] 니케이225',      'INDEX', 'TSE',    'JPY');

-- 값을 고른 근거는 §2의 표에 있다 — 워스트오브가 KI 구간의 어디에 떨어지는지가
-- 곧 카드의 표시 상태이므로, 시세는 임의값이 아니라 **판정 입력**이다.
insert into public.asset_prices (asset_id, as_of_date, price, source, provider) values
  ('00000000-0000-4000-8000-0000000004a1', current_date,      385.000000, 'AUTO',   'dev-fixture'),
  ('00000000-0000-4000-8000-0000000004a2', current_date,     5432.100000, 'AUTO',   'dev-fixture'),
  ('00000000-0000-4000-8000-0000000004a3', current_date,    44000.000000, 'MANUAL', null),
  ('00000000-0000-4000-8000-0000000004a4', current_date,     2800.000000, 'MANUAL', null),
  ('00000000-0000-4000-8000-0000000004a5', current_date,      210.500000, 'AUTO',   'dev-fixture'),
  -- 9일 전 — §4.5 `isStale`(5일 기준)이 참이 되는 유일한 자산이다.
  ('00000000-0000-4000-8000-0000000004a7', current_date - 9, 39500.000000, 'MANUAL', null);

-- ---------------------------------------------------------------------------
-- 2. 상품 12건 — `create_els_product`를 한 루프에서 부른다
--
-- 명세를 VALUES 목록으로 두고 **한 번만** 순회한다. 소유자도 그 목록의 열이다 —
-- 소유자별로 루프를 나누면 차수 배열을 만드는 30줄이 두 벌이 되고, 실제로 그렇게
-- 썼다가 둘째 벌에서 실패했다(§아래 함정).
--
-- | 열 | 뜻 |
-- |---|---|
-- | `owner` | `request.jwt.claims`의 `sub`. 함수가 이 값을 `owner_id`에 박는다 |
-- | `issue_off` | 발행일 = `current_date − issue_off개월` |
-- | `b0`·`step` | n차 배리어 = `b0 − step × (n−1)` (스텝다운) |
-- | `lz_from` | 이 차수부터 리자드 조건이 있다. `null`이면 전 차수 없음 |
-- | `underlyings` | 자산 id와 **기준가**. 기준가가 워스트오브의 분모다 |
--
-- 표본이 덮는 표시 상태 (한 상품이 하나를 대표한다)
--
-- | # | 상품 | 워스트오브 | `kiStatus` | `conditionResult` | 확인 대상 |
-- |---|---|---|---|---|---|
-- | ① | 신한 1호 | 1.1 | `SAFE` | `EARLY` | 카드의 기본 모습 |
-- | ② | 미래에셋 2호 | 0.55 | `WARNING` | `CARRY_OVER` | 기초자산 2종·경과 차수·리자드 열 |
-- | ③ | KB 3호 | 0.4667 | **`BELOW`** | `LIZARD` | **AQ-24** — 3값 필터로는 못 골랐다 |
-- | ④ | 하나 4호 | 0.7017 | `TOUCHED` | `CARRY_OVER` | `ki_touched_at` 표시 |
-- | ⑤ | 삼성 5호 | 0.9625 | `NO_KI` | `EARLY` | 노낙인 · 비과세 계좌 |
-- | ⑥ | 대신 6호 | **`null`** | `null` | `null` | E-01 시세 없음 (ST-01) |
-- | ⑦ | 한투 7호 | 1.2833 | `null` | `null` | E-05 상환완료(조기상환) |
-- | ⑧ | NH 8호 | 0.44 | `null` | `null` | 실현손익 **음수** · 과세소득 0 (I-08) |
-- | ⑨ | 키움 9호 | 1.2031 | `SAFE` | **`null`** | E-07 전 차수 경과 → `projection` 없음 |
-- | ⑩ | 유안타 10호 | 1.0395 | `SAFE` | `EARLY` | **타인 소유** · 시세 9일 경과 |
-- | ⑪ | 신영 11호 | 1.1 | `NO_KI` | `EARLY` | **`isWorst` 동률** — 둘 다 참 |
-- | ⑫ | 교보 12호 | 1.0864 | `null` | `null` | 상환완료 · **확정값 아님**(ST-05) |
--
-- ★ 함정: VALUES의 어떤 열이 **모든 행에서 `null`**이면 타입이 `text`로 정해진다.
--   `n >= spec.lz_from`이 `integer >= text`로 죽는다(실측 — 소유자별로 루프를
--   나눴을 때 둘째 루프의 `lz_from`이 전부 `null`이어서 그렇게 실패했다).
--   행 순서에 의존하지 않도록 **사용 지점에서 캐스팅한다**.
-- ---------------------------------------------------------------------------
do $$
declare
  spec        record;
  v_id        uuid;
  v_issue     date;
  v_schedules jsonb;
begin
  for spec in
    select *
      from (values
        -- ① 정상 · SAFE · 조기상환 판정
        ('00000000-0000-4000-8000-000000000401',
         '[DEV] 신한 코스피200 스텝다운 1호', '신한투자증권', 2, '50000000', 6, 6, '0.0850',
         '0.5000', 'CLOSING',    'GENERAL',  null,
         '0.9000', '0.0500', null,
         '[{"assetId":"00000000-0000-4000-8000-0000000004a1","basePrice":"350.000000","sequence":1}]'),

        -- ② WARNING · 이월 · 기초자산 2종 · 경과 차수 2건(정상적인 이월이다).
        --    리자드는 5차부터 — 다음 도래 차수(3차)에 없으므로 판정이 CARRY_OVER다.
        ('00000000-0000-4000-8000-000000000401',
         '[DEV] 미래에셋 S&P500·삼성전자 2호', '미래에셋증권', 14, '80000000', 6, 6, '0.0720',
         '0.5000', 'CLOSING',    'GENERAL',  '두 기초자산 중 삼성전자가 워스트오브다.',
         '0.9000', '0.0500', 5,
         '[{"assetId":"00000000-0000-4000-8000-0000000004a2","basePrice":"5300.000000","sequence":1},
            {"assetId":"00000000-0000-4000-8000-0000000004a3","basePrice":"80000.000000","sequence":2}]'),

        -- ③ **BELOW + 리자드 충족.** AQ-24가 지목한 상태 — 3값 필터로는 이 카드를
        --    목록에서 골라낼 수 없었다. 3차 리자드 배리어 0.4500 ≤ 0.4667이다.
        ('00000000-0000-4000-8000-000000000401',
         '[DEV] KB HSCEI 낙인 3호', 'KB증권', 8, '30000000', 3, 8, '0.0950',
         '0.5000', 'CONTINUOUS', 'GENERAL',  'KI 배리어를 하회했다 — 터치 확정은 사용자가 한다(D-04).',
         '0.8500', '0.0500', 3,
         '[{"assetId":"00000000-0000-4000-8000-0000000004a4","basePrice":"6000.000000","sequence":1}]'),

        -- ④ TOUCHED — `ki_touched_at`은 §3에서 따로 박는다(페이로드에 없다)
        ('00000000-0000-4000-8000-000000000401',
         '[DEV] 하나 테슬라 4호', '하나증권', 5, '20000000', 6, 4, '0.1100',
         '0.5500', 'CONTINUOUS', 'GENERAL',  null,
         '0.9000', '0.0500', 3,
         '[{"assetId":"00000000-0000-4000-8000-0000000004a5","basePrice":"300.000000","sequence":1}]'),

        -- ⑤ NO_KI · 비과세 계좌. 두 열거 라벨이 이 카드에서만 나온다.
        ('00000000-0000-4000-8000-000000000401',
         '[DEV] 삼성 노낙인 5호', '삼성증권', 1, '15000000', 12, 3, '0.0450',
         null,     null,         'TAX_FREE', '노낙인 상품 — KI 판정 대상이 아니다.',
         '0.9000', '0.0500', null,
         '[{"assetId":"00000000-0000-4000-8000-0000000004a1","basePrice":"400.000000","sequence":1}]'),

        -- ⑥ E-01 시세 없음 (ST-01). 워스트오브·KI·조건 판정이 모두 null이다.
        ('00000000-0000-4000-8000-000000000401',
         '[DEV] 대신 시세미확보 6호', '대신증권', 2, '10000000', 6, 6, '0.0800',
         '0.5000', 'CLOSING',    'GENERAL',  '기초자산 시세가 아직 수집되지 않았다.',
         '0.9000', '0.0500', null,
         '[{"assetId":"00000000-0000-4000-8000-0000000004a6","basePrice":"1000.000000","sequence":1}]'),

        -- ⑦ 상환완료(조기상환) — E-05. 판정은 생략되고 표시값은 상환 실적이다.
        ('00000000-0000-4000-8000-000000000401',
         '[DEV] 한투 조기상환 완료 7호', '한국투자증권', 8, '50000000', 6, 6, '0.0850',
         '0.5000', 'CLOSING',    'GENERAL',  null,
         '0.9000', '0.0500', null,
         '[{"assetId":"00000000-0000-4000-8000-0000000004a1","basePrice":"300.000000","sequence":1}]'),

        -- ⑧ 상환완료(만기손실) — 실현손익이 **음수**다. 과세 금융소득은 0이다(I-08).
        ('00000000-0000-4000-8000-000000000401',
         '[DEV] NH 만기손실 8호', 'NH투자증권', 38, '100000000', 6, 6, '0.0600',
         '0.5000', 'CLOSING',    'GENERAL',  null,
         '0.9000', '0.0500', null,
         '[{"assetId":"00000000-0000-4000-8000-0000000004a3","basePrice":"100000.000000","sequence":1}]'),

        -- ⑨ E-07 전 차수 경과 미상환 — 적용 차수가 없어 `projection`이 null이다.
        --    워스트오브·KI는 **산다**(억제 축이 다르다).
        ('00000000-0000-4000-8000-000000000401',
         '[DEV] 키움 전차수경과 9호', '키움증권', 40, '25000000', 6, 6, '0.0900',
         '0.5000', 'CLOSING',    'GENERAL',  '전 차수가 경과했는데 상환 실적이 없다 — 이월 확인 대상(§9.2).',
         '0.9000', '0.0500', null,
         '[{"assetId":"00000000-0000-4000-8000-0000000004a1","basePrice":"320.000000","sequence":1}]'),

        -- ⑩ **타인 소유** · 기초자산 하나의 시세가 9일 전이다(§4.5 `isStale`)
        ('00000000-0000-4000-8000-000000000402',
         '[DEV] 유안타 코스피·니케이 10호', '유안타증권', 2, '40000000', 6, 5, '0.0650',
         '0.5500', 'CLOSING',    'GENERAL',  null,
         '0.9000', '0.0500', null,
         '[{"assetId":"00000000-0000-4000-8000-0000000004a1","basePrice":"360.000000","sequence":1},
            {"assetId":"00000000-0000-4000-8000-0000000004a7","basePrice":"38000.000000","sequence":2}]'),

        -- ⑪ **워스트오브 동률.** 두 비율이 정확히 같으므로 `isWorst`가 둘 다 참이어야
        --    한다(§4.3 — 하나만 고르면 표시 순서에 의존하는 임의값이 된다).
        ('00000000-0000-4000-8000-000000000402',
         '[DEV] 신영 동률 워스트오브 11호', '신영증권', 2, '35000000', 6, 6, '0.0700',
         null,     null,         'GENERAL',  '두 기초자산의 기준가 대비 비율이 같다 — isWorst가 둘 다 참이다.',
         '0.9000', '0.0500', null,
         '[{"assetId":"00000000-0000-4000-8000-0000000004a1","basePrice":"350.000000","sequence":1},
            {"assetId":"00000000-0000-4000-8000-0000000004a3","basePrice":"40000.000000","sequence":2}]'),

        -- ⑫ 상환완료(만기이익) · **확정값이 아니다**(`is_confirmed = false`) — ST-05
        ('00000000-0000-4000-8000-000000000402',
         '[DEV] 교보 만기이익 12호', '교보증권', 38, '30000000', 6, 6, '0.0600',
         '0.5000', 'CLOSING',    'GENERAL',  null,
         '0.9000', '0.0500', null,
         '[{"assetId":"00000000-0000-4000-8000-0000000004a2","basePrice":"5000.000000","sequence":1}]')
      ) as t(owner, name, issuer, issue_off, principal, period, rounds, coupon,
             ki_barrier, ki_obs, account_type, note, b0, step, lz_from, underlyings)
  loop
    /*
     * 소유자를 **한 줄로** 바꾼다. `auth.uid()`가 GUC를 읽으므로 이것이 곧
     * `owner_id`가 되고, `els_products_insert_own`이 그 값을 다시 검사한다.
     * `is_local => true`이므로 커밋 시점에 되돌아간다.
     */
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', spec.owner, 'role', 'authenticated')::text,
      true);

    if (select auth.uid())::text <> spec.owner then
      raise exception 'claims 교체가 반영되지 않았다 — %가 엉뚱한 소유자로 생긴다.', spec.name;
    end if;

    v_issue := (current_date - (spec.issue_off || ' months')::interval)::date;

    v_schedules := (
      select jsonb_agg(
               jsonb_build_object(
                 'roundNo', n,
                 -- V-07: 발행일 + n×주기이므로 증가가 계산 결과다
                 'evaluationDate',
                   to_char((v_issue + (n * spec.period || ' months')::interval)::date,
                           'YYYY-MM-DD'),
                 -- numeric(6,4)로 캐스팅해 저장 정밀도와 같은 형식으로 만든다
                 'barrier',
                   ((spec.b0::numeric - spec.step::numeric * (n - 1))::numeric(6,4))::text,
                 -- 리자드 배리어는 그 차수 배리어보다 0.30 낮다 — V-05(배리어 이하)를
                 -- 계산으로 만족시킨다. 있으면 쿠폰율이 필수다(V-06).
                 'lizardBarrier',
                   case when n >= spec.lz_from::int
                     then ((spec.b0::numeric - spec.step::numeric * (n - 1)
                            - 0.30)::numeric(6,4))::text end,
                 'lizardCouponRate',
                   case when n >= spec.lz_from::int
                     then (0.0300::numeric(6,4))::text end,
                 'lizardRequiresNoKi',
                   case when n >= spec.lz_from::int then true end
               )
               order by n)
        from generate_series(1, spec.rounds) as n
    );

    v_id := public.create_els_product(jsonb_build_object(
      'name',                   spec.name,
      'issuer',                 spec.issuer,
      'issueDate',              to_char(v_issue, 'YYYY-MM-DD'),
      'principal',              spec.principal,
      'evaluationPeriodMonths', spec.period,
      'annualCouponRate',       spec.coupon,
      'kiBarrier',              spec.ki_barrier,
      'kiObservation',          spec.ki_obs,
      'accountType',            spec.account_type,
      'note',                   spec.note,
      'underlyings',            spec.underlyings::jsonb,
      'schedules',              v_schedules
    ));

    if v_id is null then
      raise exception '% 생성이 실패했다', spec.name;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. KI 터치 · 상환 실적
--
-- 둘 다 `create_els_product`의 페이로드에 없다. `kiTouchedAt`은 `ProductInput`에
-- 없고(§5.9 `setKiTouched`가 전담한다) 상환은 별 계약이다(§5.4).
--
-- **소유자만 넣을 수 있다** — `redemptions_insert_own`이 부모 상품의 소유를
-- 확인하므로 claims를 상품 소유자에 맞춰 바꾼다. 루프가 마지막 행(타인)의 값을
-- 남겨 두었으므로 여기서 명시적으로 되돌린다.
--
-- 실수령액은 DOC-007 §4.1의 `EARLY` 가정과 같은 산식으로 고른 값이고
-- (`원금 × (1 + 연쿠폰율 × 경과월/12)`), 원천징수세액은 분리과세율 15.4%다.
-- A-04에 따라 **실제 징수액이 정본**이므로 화면이 재계산하지 않는다.
--
-- ---------------------------------------------------------------------------
-- ★ 이 절은 계약을 우회한다 — AQ-33 (P4 컷 6에 등재)
--
--   상품은 `create_els_product`를 부르지만 상환은 그럴 수 없다: §5.4는 SQL 함수가
--   아니라 PostgREST `.insert()`이므로 psql에서 부를 대상이 없다. 그래서 아래 세
--   INSERT와 ④의 UPDATE는 **계약 계층을 지나지 않는다.**
--
--   DB `CHECK`가 막는 것은 그대로 걸린다(I-08 과세소득 0, I-14 차수 필수, I-13
--   복합 FK). 걸리지 않는 것은 **계약 계층에만 있는 둘**이다 —
--     · V-10  상환일 >= 발행일 (두 값이 다른 테이블에 있어 단일 행 CHECK로 표현 불가)
--     · §5.4  원천징수 산출 (미입력 시 `과세소득 × 분리과세율`)
--
--   현재 세 상환은 전부 계약으로 도달 가능하다(⑦ 327,250 = 2,125,000 × 0.154,
--   ⑧ 0 = 0 × 0.154, ⑫ 831,600 = 5,400,000 × 0.154, 상환일 모두 발행일 이후).
--   **그것을 확인하는 것은 사람뿐이다** — 값을 고칠 때 위 둘을 손으로 검산한다.
--
--   ★ **컷 6부터 네 상태(④⑦⑧⑫)를 앱으로 만들 수 있다.** `tests/e2e/redeem.test.ts`의
--   해당 절이 그것을 실측한다(KI 터치 확정·해제, EARLY + 차수, 만기손실의 음수
--   실현손익, 미확정 만기이익). 이 파일이 남는 이유는 「유일한 경로」가 아니라
--   **한 명령으로 12상태를 재현하는 편의**이며, 그 대가가 위 우회다.
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-4000-8000-000000000401","role":"authenticated"}';

-- ④ KI 터치 확정 — 20일 전. I-15(배리어 없이 터치 이력 금지)를 만족한다.
update public.els_products
   set ki_touched_at = current_date - 20
 where name = '[DEV] 하나 테슬라 4호';

-- ⑦ 조기상환 — 1차 평가일(발행 8개월 전 + 6개월 = 2개월 전)에 상환되었다.
--    50,000,000 × (1 + 0.085 × 6/12) = 52,125,000
insert into public.redemptions
  (els_id, redemption_type, round_no, redemption_date,
   gross_amount, taxable_income, withholding_tax, is_confirmed, note)
select p.id, 'EARLY', 1,
       (select s.evaluation_date from public.redemption_schedules s
         where s.els_id = p.id and s.round_no = 1),
       52125000, 2125000, 327250, true, '증권사 지급명세서 확인'
  from public.els_products p
 where p.name = '[DEV] 한투 조기상환 완료 7호';

-- ⑧ 만기손실 — `round_no`를 두지 않는다(만기 상환). 과세 금융소득은 0이다(I-08).
--    실현손익 = 62,000,000 − 100,000,000 = **−38,000,000**
insert into public.redemptions
  (els_id, redemption_type, round_no, redemption_date,
   gross_amount, taxable_income, withholding_tax, is_confirmed, note)
select p.id, 'MATURITY_LOSS', null,
       (select max(s.evaluation_date) from public.redemption_schedules s
         where s.els_id = p.id),
       62000000, 0, 0, true, '기초자산이 만기 배리어를 하회했다.'
  from public.els_products p
 where p.name = '[DEV] NH 만기손실 8호';

set local "request.jwt.claims" =
  '{"sub":"00000000-0000-4000-8000-000000000402","role":"authenticated"}';

-- ⑫ 만기이익 — **확정값이 아니다.** ST-05(추정/확정 구분)가 화면에서 확인된다.
--    30,000,000 × (1 + 0.06 × 36/12) = 35,400,000, 원천징수 5,400,000 × 15.4%
insert into public.redemptions
  (els_id, redemption_type, round_no, redemption_date,
   gross_amount, taxable_income, withholding_tax, is_confirmed, note)
select p.id, 'MATURITY_GAIN', null,
       (select max(s.evaluation_date) from public.redemption_schedules s
         where s.els_id = p.id),
       35400000, 5400000, 831600, false, '지급명세서 미수령 — 추정값이다.'
  from public.els_products p
 where p.name = '[DEV] 교보 만기이익 12호';

-- ---------------------------------------------------------------------------
-- 4. 결과 확인 — 커밋 전에 사람이 읽는다
--
-- 12행이 아니거나 소유자가 한 명이면 위의 전제 확인 중 하나가 헛돌았다는 뜻이다.
-- ---------------------------------------------------------------------------
select
  u.display_name                                          as 소유자,
  p.name                                                  as 상품,
  case when r.id is null then '보유중' else '상환완료' end as 상태,
  (select count(*) from public.els_underlyings      x where x.els_id = p.id) as 기초자산,
  (select count(*) from public.redemption_schedules s where s.els_id = p.id) as 차수,
  p.ki_barrier,
  p.ki_touched_at
from public.els_products p
join public.users u on u.id = p.owner_id
left join public.redemptions r on r.els_id = p.id
where p.name like '[DEV]%'
order by u.display_name, p.name;

commit;
