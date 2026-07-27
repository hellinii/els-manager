-- ============================================================================
-- I-16 트리거가 제약 이름을 detail 에도 싣는다 — DOC-011 §3.2.1 (P3b 2단계 실측)
--
-- ★ 실측: plpgsql RAISE 의 constraint 옵션은 HTTP 경계를 넘지 못한다.
--
--   같은 예외를 두 경로에서 측정한 결과가 다르다.
--
--   | 경로 | 제약 이름 |
--   |---|---|
--   | pg 직결 (tests/rls) | error.constraint = 'asset_prices_coordinates_immutable' |
--   | PostgREST (실제 계약 경로) | **없다** — message 는 한글 문구, details·hint 는 null |
--
--   PostgrestError 는 {code, message, details, hint} 넷뿐이고 pg 가 주는
--   constraint 필드가 아예 없다. 표준 CHECK·UNIQUE·FK 는 이름이 message 에
--   문자열로 들어오지만("violates check constraint \"…\"") 커스텀 RAISE 는
--   그 문구를 쓰지 않으므로 파싱할 대상이 없다.
--
-- ★ 그대로 두면 saveManualPrice 의 유일한 23514 경로가 fields 를 잃는다.
--
--   DOC-011 §5.7 은 좌표 불변 위반에 assetId·asOfDate 를 필드 오류로 표시하도록
--   요구한다. 이름을 얻지 못하면 §3.2.1 의 사상이 기본값으로 떨어져 "입력값을
--   확인한다"만 남고, 사용자는 **어느 칸을 고쳐야 하는지 알 수 없다.**
--
-- ★ 두 채널을 모두 채운다.
--
--   constraint 옵션은 **그대로 유지한다** — tests/rls/constraints.test.ts 가
--   error.constraint 를 단언하고 있고, 그 단언은 pg 직결에서 유효하다. detail 을
--   더하는 것은 HTTP 경로를 위한 것이며, 어느 한쪽을 골라 다른 쪽을 깨뜨리지
--   않는 유일한 형태다.
--
--   detail 의 **첫 줄**을 `constraint=<이름>`으로 고정한다. 계약 계층은 message
--   에서 표준 형태를 먼저 찾고, 없으면 이 줄을 읽는다. 둘째 줄 이후는 사람이
--   읽는 설명이므로 파서가 무시한다.
--
-- 함수 본문만 바꾸므로 트리거를 다시 만들지 않는다 — 트리거는 함수 oid 를
-- 참조하고 create or replace 는 그 oid 를 유지한다.
-- ============================================================================

create or replace function public.freeze_asset_price_coordinates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.asset_id   is distinct from old.asset_id
  or new.as_of_date is distinct from old.as_of_date then
    raise exception
      '시세 관측의 좌표(asset_id·as_of_date)는 변경할 수 없다. 좌표가 다른 시세는 정정이 아니라 새 관측이므로 UPSERT로 새 행을 넣는다 — DOC-002 I-16.'
      using errcode    = '23514',
            constraint = 'asset_prices_coordinates_immutable',
            -- 첫 줄이 계약 계층의 파싱 대상이다(DOC-011 §3.2.1). PostgREST는
            -- constraint 옵션을 버리고 detail 은 그대로 전달한다.
            detail     = 'constraint=asset_prices_coordinates_immutable',
            table      = 'asset_prices';
  end if;
  return new;
end;
$$;

comment on trigger asset_prices_freeze_coordinates on public.asset_prices is
  'I-16: 관측 좌표(asset_id·as_of_date)를 동결한다. 관측값(price·source·provider)의 정정은 공용 데이터 원칙대로 전체에 열려 있다. 동일값 재대입은 통과하므로 supabase-js .upsert()가 payload 전역을 SET에 실어도 동작한다(DOC-011 §5.7). created_at·id는 좌표가 아니므로 제외한다. 거부 시 제약 이름을 constraint(pg 경로)와 detail 첫 줄(PostgREST 경로) 양쪽에 싣는다 — 후자가 없으면 계약 계층이 이름을 얻지 못해 필드 오류를 만들 수 없다.';
