-- ============================================================================
-- 상품 쓰기 함수 — DOC-011 §5.1·§5.2, DOC-010 §7 (P3b 6단계)
--
-- ★ 왜 함수인가. PostgREST는 요청당 하나의 트랜잭션이다.
--
--   §5.1은 "상품·기초자산·평가일정을 단일 트랜잭션으로 생성한다"고 규정하는데,
--   임베드된 관계에 쓰기를 지원하지 않으므로 요청 3개 = 트랜잭션 3개가 된다.
--   두 번째가 실패하면 **기초자산 0건인 상품이 남고**, 그것은 §5.3이 "계약을
--   경유하는 어떤 조작도 만들 수 없다"고 단언한 상태다(I-07). update는 더 나쁘다 —
--   하위 행을 지운 뒤 끊기면 되돌릴 원본이 없다.
--
-- ★ SECURITY INVOKER(기본값)를 유지한다.
--
--   함수 안의 INSERT·DELETE에도 RLS가 그대로 적용된다. DEFINER로 쓰면 소유자
--   권한으로 실행되어 **정책 32개를 통째로 우회하는 쓰기 경로**가 생긴다 —
--   뷰의 security_invoker가 꺼진 상태(AQ-20)와 같은 형태이며, 함수 쪽은 기본값이
--   안전한 방향이라는 점만 다르다. 그래서 위험은 "빠뜨림"이 아니라 "편의로 붙임"이다.
--
-- ★ owner_id를 함수가 auth.uid()로 박는다.
--
--   §5.1의 "입력값으로 받지 않는다"가 규율이 아니라 구조가 된다. payload에
--   ownerId가 있어도 읽지 않으며, els_products_insert_own 정책이 그 값을 다시
--   검사한다.
--
-- ★ I-07이 DB 층 방어를 처음 갖는다 (DOC-010 AQ-14 부분 해소).
--
--   말미에서 하위 행 수를 검사하고 0건이면 트랜잭션을 되돌린다. 계약 계층의
--   V-02·V-03과 2층 구조이며, **계약을 경유하는 경로**에 한한다 — 행 단위 DELETE
--   권한은 여전히 열려 있으므로 계약 밖 경로의 예방은 아직 없다.
--
-- ★ 금액·비율은 ->> 로 꺼내 ::numeric 으로 캐스팅한다 (W-04).
--
--   -> 로 JSON 수치를 쓰면 값이 이미 JS 쪽에서 float64를 경유했다는 뜻이다.
--   jsonb 자체는 numeric을 정확히 보존하지만, 경계 앞에서 이미 잃은 정밀도를
--   되살리지는 못한다.
--
-- ★ 하위 행 교체를 헬퍼로 빼지 않는다.
--
--   호출자 권한으로 실행되는 함수를 부르려면 그 함수에도 EXECUTE가 필요하므로,
--   헬퍼를 두면 authenticated 가 직접 부를 수 있는 함수가 하나 늘어난다(AQ-29의
--   표면이 넓어진다). 12줄 중복이 그 대가보다 싸다.
--
-- ★ 계약 계층 검증을 함수 안으로 옮기지 않는다.
--
--   V-04(차수 연속성)·V-07(평가일 증가)·V-09(자산 중복)는 여기서 검사하지 않는다.
--   규칙을 두 언어로 두 번 쓰면 두 사본이 갈리고, 갈린 순간 어느 쪽이 정본인지
--   알 수 없다. 대신 **함수를 직접 부르면 그 규칙을 지나지 않는다**는 사실을
--   DOC-011 AQ-29로 등재했다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 5.1 createProduct
-- ---------------------------------------------------------------------------
create function public.create_els_product(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.els_products (
    owner_id, name, issuer, issue_date, principal, evaluation_period_months,
    annual_coupon_rate, ki_barrier, ki_observation, account_type, note
  ) values (
    -- 입력값으로 받지 않는다 (§5.1)
    (select auth.uid()),
    payload->>'name',
    payload->>'issuer',
    (payload->>'issueDate')::date,
    (payload->>'principal')::numeric,
    (payload->>'evaluationPeriodMonths')::smallint,
    (payload->>'annualCouponRate')::numeric,
    (payload->>'kiBarrier')::numeric,
    (payload->>'kiObservation')::public.ki_observation,
    (payload->>'accountType')::public.account_type,
    payload->>'note'
  )
  returning id into v_id;

  insert into public.els_underlyings (els_id, asset_id, base_price, sequence)
  select v_id,
         (item->>'assetId')::uuid,
         (item->>'basePrice')::numeric,
         (item->>'sequence')::smallint
    from jsonb_array_elements(payload->'underlyings') as item;

  insert into public.redemption_schedules (
    els_id, round_no, evaluation_date, barrier,
    lizard_barrier, lizard_coupon_rate, lizard_requires_no_ki
  )
  select v_id,
         (item->>'roundNo')::smallint,
         (item->>'evaluationDate')::date,
         (item->>'barrier')::numeric,
         (item->>'lizardBarrier')::numeric,
         (item->>'lizardCouponRate')::numeric,
         (item->>'lizardRequiresNoKi')::boolean
    from jsonb_array_elements(payload->'schedules') as item;

  -- I-07 — 여기서 되돌리면 0건 상태가 커밋되지 않는다
  if not exists (select 1 from public.els_underlyings where els_id = v_id) then
    raise exception '상품은 최소 1개의 기초자산을 가진다 (DOC-002 I-07).'
      using errcode    = '23514',
            constraint = 'els_products_underlyings_required',
            detail     = 'constraint=els_products_underlyings_required',
            table      = 'els_products';
  end if;

  if not exists (select 1 from public.redemption_schedules where els_id = v_id) then
    raise exception '상품은 최소 1개의 평가 차수를 가진다 (DOC-002 I-07).'
      using errcode    = '23514',
            constraint = 'els_products_schedules_required',
            detail     = 'constraint=els_products_schedules_required',
            table      = 'els_products';
  end if;

  return v_id;
end;
$$;

comment on function public.create_els_product(jsonb) is
  'DOC-011 §5.1 createProduct. 상품·기초자산·평가일정을 한 트랜잭션에 만든다 — PostgREST는 요청당 1 트랜잭션이므로 요청 3개로는 §5.1이 성립하지 않고, 부분 실패가 I-07 위반 상태를 남긴다. SECURITY INVOKER이므로 RLS가 그대로 적용되며 owner_id는 auth.uid()로 고정된다. 말미의 하위 행 수 검사가 I-07의 DB 층 방어다(DOC-010 AQ-14 부분 해소). 계약 계층의 V-04·V-07·V-09는 여기서 검사하지 않는다(AQ-29).';

-- ---------------------------------------------------------------------------
-- 5.2 updateProduct — 하위 배열 전체 교체
--
-- ★ 반환이 NULL 이면 "영향 행 0"이다.
--
--   대상이 없거나 RLS 의 USING 이 감춘 경우다. 둘을 여기서 구분하지 않는 이유는
--   구분할 문맥이 계약 계층에 있기 때문이다 — 사전 조회가 NOT_FOUND 와 FORBIDDEN 을
--   가른다(W-05). 함수가 42501 을 던지게 만들면 "없는 상품"도 권한 오류가 된다.
--
-- ★ ki_touched_at 을 함께 비운다 (V-18, I-15).
--
--   ProductInput 에는 kiTouchedAt 이 없다. 낙인형을 해제하면서 터치 이력을 남기면
--   I-15 가 거부하므로(그리고 남으면 판정이 그 사실을 못 본다), 배리어가 비워질 때
--   여기서 함께 비운다 — 계약 계층이 기억해야 하는 규율을 구조로 옮긴다.
-- ---------------------------------------------------------------------------
create function public.update_els_product(p_id uuid, payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- 상태 충돌 — 이름이 계약 계층에서 23514를 CONFLICT로 올린다(DOC-002 §8 명명 규약)
  if exists (select 1 from public.redemptions r where r.els_id = p_id) then
    raise exception '상환 처리된 상품은 수정할 수 없다. 상환을 먼저 취소한다 (DOC-011 §5.2).'
      using errcode    = '23514',
            constraint = 'els_products_redeemed_immutable',
            detail     = 'constraint=els_products_redeemed_immutable',
            table      = 'els_products';
  end if;

  update public.els_products set
    name                     = payload->>'name',
    issuer                   = payload->>'issuer',
    issue_date               = (payload->>'issueDate')::date,
    principal                = (payload->>'principal')::numeric,
    evaluation_period_months = (payload->>'evaluationPeriodMonths')::smallint,
    annual_coupon_rate       = (payload->>'annualCouponRate')::numeric,
    ki_barrier               = (payload->>'kiBarrier')::numeric,
    ki_observation           = (payload->>'kiObservation')::public.ki_observation,
    account_type             = (payload->>'accountType')::public.account_type,
    note                     = payload->>'note',
    -- 낙인형 해제 시 터치 이력도 함께 비운다 (V-18, I-15)
    ki_touched_at            = case
                                 when (payload->>'kiBarrier') is null then null
                                 else ki_touched_at
                               end
  where id = p_id
  returning id into v_id;

  -- 영향 행 0 — 계약 계층이 사전 조회로 NOT_FOUND·FORBIDDEN을 가른다
  if v_id is null then
    return null;
  end if;

  delete from public.els_underlyings      where els_id = p_id;
  delete from public.redemption_schedules where els_id = p_id;

  insert into public.els_underlyings (els_id, asset_id, base_price, sequence)
  select p_id,
         (item->>'assetId')::uuid,
         (item->>'basePrice')::numeric,
         (item->>'sequence')::smallint
    from jsonb_array_elements(payload->'underlyings') as item;

  insert into public.redemption_schedules (
    els_id, round_no, evaluation_date, barrier,
    lizard_barrier, lizard_coupon_rate, lizard_requires_no_ki
  )
  select p_id,
         (item->>'roundNo')::smallint,
         (item->>'evaluationDate')::date,
         (item->>'barrier')::numeric,
         (item->>'lizardBarrier')::numeric,
         (item->>'lizardCouponRate')::numeric,
         (item->>'lizardRequiresNoKi')::boolean
    from jsonb_array_elements(payload->'schedules') as item;

  if not exists (select 1 from public.els_underlyings where els_id = p_id) then
    raise exception '상품은 최소 1개의 기초자산을 가진다 (DOC-002 I-07).'
      using errcode    = '23514',
            constraint = 'els_products_underlyings_required',
            detail     = 'constraint=els_products_underlyings_required',
            table      = 'els_products';
  end if;

  if not exists (select 1 from public.redemption_schedules where els_id = p_id) then
    raise exception '상품은 최소 1개의 평가 차수를 가진다 (DOC-002 I-07).'
      using errcode    = '23514',
            constraint = 'els_products_schedules_required',
            detail     = 'constraint=els_products_schedules_required',
            table      = 'els_products';
  end if;

  return v_id;
end;
$$;

comment on function public.update_els_product(uuid, jsonb) is
  'DOC-011 §5.2 updateProduct. 상품 열 갱신과 하위 배열 전체 교체를 한 트랜잭션에 수행한다 — 삭제와 삽입 사이에 끊기면 되돌릴 원본이 없으므로 원자성이 createProduct보다 더 필요하다. 상환 완료 상품은 els_products_redeemed_immutable로 거부하며 그 이름이 계약 계층에서 23514를 CONFLICT로 올린다. 반환 NULL은 영향 행 0(미존재 또는 RLS)이며 구분은 계약 계층이 한다(W-05). 낙인형 해제 시 ki_touched_at을 함께 비운다(V-18, I-15).';

-- ---------------------------------------------------------------------------
-- 함수 권한 — DOC-010 §7·§7.1, AQ-28
--
-- ★ 실측: EXECUTE는 테이블 권한과 달리 기본으로 PUBLIC에 부여된다.
--
--   적용 전 상태를 측정했다. has_function_privilege 로 확인한 결과
--
--     anon           → set_updated_at: true, handle_new_auth_user: true
--     authenticated  → 같음
--     신규 함수      → proacl = null 이고 anon 이 EXECUTE 가능
--
--   즉 `revoke all on all tables ... from anon, authenticated`(20260726171035)는
--   함수를 다루지 않았고, **SECURITY DEFINER 두 개까지 anon 이 부를 수 있는
--   상태**였다. 트리거 함수는 직접 호출 시 실패하므로 실제 피해는 없었으나,
--   그것은 방어가 아니라 우연이다 — anon 이 테이블 권한을 못 가진 것과 같은
--   부류의 우연이며, §7.1이 "암묵적 기본값에 의존하지 않는다"고 정한 이유다.
--
-- ★ 트리거 함수에는 EXECUTE를 부여하지 않는다.
--
--   트리거 실행은 함수의 EXECUTE 를 검사하지 않으므로 회수해도 동작한다.
--   회수하면 SECURITY DEFINER 함수를 사용자가 직접 부르는 경로가 사라진다.
--
-- ★ 함수에는 **예방적 방어가 없다** — 실측으로 확인했다.
--
--   §7.1은 테이블에서 `alter default privileges`로 신규 객체를 미리 막았다.
--   함수에는 그 수단이 이 스택에서 작동하지 않는다.
--
--   | 시도 | 신규 객체의 ACL | anon 접근 |
--   |---|---|---|
--   | 신규 **테이블** | `{postgres=arwdDxtm/postgres,service_role=Dxtm/postgres}` | TRUNCATE 불가 (기본 권한 적용됨) |
--   | 신규 **함수** | `(null)` | **EXECUTE 가능** |
--
--   `pg_default_acl`에는 `(postgres, public, 'f') = {postgres=X/postgres}` 항목이
--   이미 있고 PUBLIC 을 포함하지 않는데도, 새로 만든 함수의 `proacl`은 `null`로
--   남아 내장 기본값(owner + PUBLIC)이 적용된다. `revoke all on functions from
--   public`으로 바꾸고 트랜잭션 밖에서 실행해도 같았다. 그래서 그 문장을
--   **넣지 않는다** — 작동하지 않는 방어를 남기면 다음 사람이 그것이 지켜 준다고
--   믿는다.
--
--   **따라서 함수의 유일한 상시 방어는 카탈로그 테스트다.** 테이블에서는
--   테스트가 백스톱이었지만(§7.1) 함수에서는 그것이 방어의 전부다.
--   tests/rls/functions.test.ts 가 `public`의 전 함수를 열거해 PUBLIC 의 EXECUTE
--   부재와 `prosecdef` 화이트리스트를 양방향으로 단언한다. 새 함수를 추가하면
--   그 단언이 먼저 실패하므로 아래 revoke 를 빠뜨릴 수 없다.
-- ---------------------------------------------------------------------------
revoke execute on function public.set_updated_at()                 from public;
revoke execute on function public.freeze_asset_price_coordinates()  from public;
revoke execute on function public.handle_new_auth_user()            from public;
revoke execute on function public.handle_auth_user_email_change()   from public;
revoke execute on function public.create_els_product(jsonb)         from public;
revoke execute on function public.update_els_product(uuid, jsonb)   from public;

grant execute on function public.create_els_product(jsonb)       to authenticated;
grant execute on function public.update_els_product(uuid, jsonb) to authenticated;
