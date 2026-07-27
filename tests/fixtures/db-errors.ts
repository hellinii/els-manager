/**
 * PostgREST 오류 본문 — **실측값** (P3b 2단계)
 *
 * `tests/integration/error-shape.test.ts`가 실제 JWT로 각 형태를 위반시켜 측정한
 * 그대로다. 손으로 지은 오류만으로 매핑을 시험하면 **형태 가정이 다시 들어온다** —
 * 제약 이름이 `message`에 오는지, `details`가 채워지는지, 널 위반이 열 이름을
 * 주는지는 전부 측정으로만 알 수 있고, 그것이 곧 `errors.ts`의 전제다.
 *
 * 값을 고칠 일이 생기면 **여기가 아니라 그 통합 테스트를 먼저 돌린다.** 이 파일은
 * 사본이고 정본은 실행 결과다.
 */

export type MeasuredBody = {
  code: string
  message: string
  details: string | null
  hint: string | null
}

/** 표준 `CHECK` — 이름이 `message`에 있다 */
export const CHECK_KI_PAIR: MeasuredBody = {
  code: '23514',
  message:
    'new row for relation "els_products" violates check constraint "els_products_ki_pair_check"',
  details: null,
  hint: null,
}

/**
 * plpgsql 트리거 — **이름이 어디에도 없던 상태** (5단계 이전의 실측값)
 *
 * 지운 값이 아니라 남겨 둔다. 매핑이 이 형태에서 무엇을 하는지가 계약이다 —
 * 이름을 얻지 못하면 SQLSTATE 기본값(`VALIDATION_FAILED`)으로 내려가되 필드를
 * 만들지 않는다. 트리거를 고쳤어도 **다음에 추가되는 `RAISE`가 `detail`을 빠뜨리면
 * 정확히 이 형태가 된다.**
 */
export const TRIGGER_I16_BEFORE_FIX: MeasuredBody = {
  code: '23514',
  message:
    '시세 관측의 좌표(asset_id·as_of_date)는 변경할 수 없다. 좌표가 다른 시세는 정정이 아니라 새 관측이므로 UPSERT로 새 행을 넣는다 — DOC-002 I-16.',
  details: null,
  hint: null,
}

/**
 * plpgsql 트리거 — `detail` 첫 줄에 이름을 실은 뒤. **현재의 실측값이다**
 * (마이그레이션 `20260727143954`, `tests/integration/error-shape.test.ts`가 고정한다).
 */
export const TRIGGER_I16_AFTER_FIX: MeasuredBody = {
  ...TRIGGER_I16_BEFORE_FIX,
  details: 'constraint=asset_prices_coordinates_immutable',
}

export const UNIQUE_ASSET_NAME_MARKET: MeasuredBody = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "assets_name_market_key"',
  details: null,
  hint: null,
}

/** FK `RESTRICT` — 상환 완료 상품 삭제. `details`가 방향을 말한다 */
export const FK_REDEMPTION_RESTRICT: MeasuredBody = {
  code: '23503',
  message:
    'update or delete on table "els_products" violates foreign key constraint "redemptions_els_id_fkey" on table "redemptions"',
  details: 'Key is still referenced from table "redemptions".',
  hint: null,
}

/**
 * 같은 제약의 **반대 방향** — 상환을 없는 상품에 INSERT.
 *
 * 실측한 것은 삭제 방향뿐이므로 이 본문은 PostgreSQL의 표준 문구를 따른 **구성값**
 * 이다. 방향에 따라 메시지가 갈리는 사상을 시험하기 위한 것이며, 그 사실을 여기
 * 적어 실측값과 섞이지 않게 한다.
 */
export const FK_REDEMPTION_MISSING_PARENT: MeasuredBody = {
  code: '23503',
  message:
    'insert or update on table "redemptions" violates foreign key constraint "redemptions_els_id_fkey"',
  details: 'Key (els_id)=(00000000-0000-4000-8000-000000000999) is not present in table "els_products".',
  hint: null,
}

export const RLS_VIOLATION: MeasuredBody = {
  code: '42501',
  message: 'new row violates row-level security policy for table "els_underlyings"',
  details: null,
  hint: null,
}

/** 권한 미부여 — `hint`에 `GRANT` 문장이 온다. 사용자에게 노출하면 안 된다 */
export const PERMISSION_DENIED: MeasuredBody = {
  code: '42501',
  message: 'permission denied for table tax_constants',
  details: null,
  hint: 'Grant the required privileges to the current role with: GRANT UPDATE ON public.tax_constants TO authenticated;',
}

/** 길이 초과 — **열 이름이 없다.** 타입만 말한다 */
export const LENGTH_OVERFLOW: MeasuredBody = {
  code: '22001',
  message: 'value too long for type character varying(100)',
  details: null,
  hint: null,
}

/** 자릿수 초과 — 열 이름이 없다 */
export const NUMERIC_OVERFLOW: MeasuredBody = {
  code: '22003',
  message: 'numeric field overflow',
  details: 'A field with precision 18, scale 6 must round to an absolute value less than 10^12.',
  hint: null,
}

/** 날짜 형식 — **`22P02`가 아니라 `22007`이다** */
export const DATE_SYNTAX: MeasuredBody = {
  code: '22007',
  message: 'invalid input syntax for type date: "not-a-date"',
  details: null,
  hint: null,
}

/** 널 위반 — 유일하게 `message`에 열 이름이 있다 */
export const NOT_NULL_CURRENCY: MeasuredBody = {
  code: '23502',
  message:
    'null value in column "currency" of relation "assets" violates not-null constraint',
  details: null,
  hint: null,
}
