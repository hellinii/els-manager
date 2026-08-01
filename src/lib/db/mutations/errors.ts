import { fail, type ActionError, type ActionResult, type ErrorCode } from './result'

/**
 * DB 오류 → `ActionError` — DOC-011 §3.2.1
 *
 * ## SQLSTATE는 거부의 *형태*이고 `ErrorCode`는 *화면 처리*다
 *
 * 둘은 1:1이 아니다. 같은 `23514`가 "값을 고치면 되는 일"(CHECK)과 "상태가 충돌해
 * 다른 조작이 먼저 필요한 일"(상환 완료 상품 수정) 양쪽에서 나오고, 후자를
 * `VALIDATION_FAILED`로 내면 화면은 필드별 오류를 표시하려 하는데 **고칠 필드가
 * 없다.** 그래서 **제약 이름이 최종 판정자**이며, 그 규약은 DOC-002 §8에 있다.
 *
 * ## 제약 이름의 출처가 둘이다 (P3b 2단계 실측)
 *
 * | 형태 | 이름의 위치 |
 * |---|---|
 * | 표준 `CHECK`·`UNIQUE`·FK | `message`의 `constraint "<이름>"` |
 * | plpgsql `RAISE` | **`details`의 첫 줄** `constraint=<이름>` |
 *
 * `PostgrestError`에는 `pg`가 주는 `constraint` 필드가 **없다.** 그리고 plpgsql의
 * `using constraint = …`는 HTTP 경계를 넘지 못한다 — `tests/rls/`가 그 이름을
 * 단언할 수 있는 것은 그쪽이 `pg` 직결이기 때문이고, 같은 예외가 두 경로에서
 * 다른 정보를 준다. 그래서 트리거·쓰기 함수는 `detail`에도 이름을 싣는다.
 *
 * 전제는 `tests/integration/error-shape.test.ts`가 고정한다. 형태가 바뀌면 매핑이
 * 조용히 `INTERNAL`로 퇴화하는 대신 그 파일이 먼저 빨간불이 된다.
 */

/** `PostgrestError`의 구조. 라이브러리 타입에 묶지 않는다 — 형태만 쓴다. */
export type DbErrorLike = {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

// ---------------------------------------------------------------------------
// 이름 추출
// ---------------------------------------------------------------------------

const CONSTRAINT_IN_MESSAGE = /constraint "([^"]+)"/
/** plpgsql `RAISE … using detail`의 첫 줄. 나머지 줄은 사람이 읽는 설명이다. */
const CONSTRAINT_IN_DETAILS = /^constraint=([A-Za-z0-9_]+)/

export function constraintNameOf(error: DbErrorLike): string | null {
  const fromMessage = CONSTRAINT_IN_MESSAGE.exec(error.message ?? '')
  if (fromMessage != null) return fromMessage[1]

  const firstLine = (error.details ?? '').split('\n', 1)[0]
  return CONSTRAINT_IN_DETAILS.exec(firstLine)?.[1] ?? null
}

/** `23502`만 `message`에 열 이름을 담는다(실측). 나머지 값 오류는 열을 말하지 않는다. */
const NOT_NULL_COLUMN = /null value in column "([^"]+)"/

// ---------------------------------------------------------------------------
// SQLSTATE 기본값
// ---------------------------------------------------------------------------

/**
 * 제약 이름이 없거나 사상에 없을 때의 기본값.
 *
 * `42501`의 두 원인(RLS 위반·권한 미부여)을 구분하지 않는다 — 둘 다 "이 조회자는
 * 이 조작을 할 수 없다"이고 화면 처리가 같다(SCR-902). 다만 권한 미부여는
 * **배포 결함**이므로 로그에는 구분해 남긴다.
 */
const BY_SQLSTATE: Record<string, ErrorCode> = {
  '23505': 'CONFLICT',
  '23503': 'CONFLICT',
  '23514': 'VALIDATION_FAILED',
  '42501': 'FORBIDDEN',
  // 값의 형태. 대부분 열을 특정할 수 없다 — V-19·V-20이 앞에서 잡는 이유다
  '22001': 'VALIDATION_FAILED', // 길이 초과 (타입만 말한다)
  '22003': 'VALIDATION_FAILED', // 자릿수 초과
  '22007': 'VALIDATION_FAILED', // 날짜 형식 — ★ 22P02가 아니다(실측)
  '22P02': 'VALIDATION_FAILED', // 그 밖의 형식(uuid·numeric 등)
  '23502': 'VALIDATION_FAILED', // 널 위반 — 유일하게 열 이름이 온다
}

const GENERIC_MESSAGE: Record<ErrorCode, string> = {
  UNAUTHENTICATED: '로그인이 필요하다.',
  FORBIDDEN: '이 작업을 수행할 권한이 없다.',
  NOT_FOUND: '대상을 찾을 수 없다.',
  VALIDATION_FAILED: '입력값을 확인한다.',
  CONFLICT: '현재 상태에서는 이 작업을 수행할 수 없다. 화면을 갱신한 뒤 다시 시도한다.',
  PROVIDER_UNAVAILABLE: '시세 공급자에 접근할 수 없다.',
  INTERNAL: '처리 중 오류가 발생했다.',
}

// ---------------------------------------------------------------------------
// 제약 이름 → 코드·메시지·필드
// ---------------------------------------------------------------------------

type ConstraintRule = {
  /** 생략하면 SQLSTATE 기본값을 쓴다. **`23514`를 `CONFLICT`로 올리는 자리**다 */
  code?: ErrorCode
  /** 계약 입력의 필드 이름. 배열이면 같은 메시지를 여러 필드에 붙인다 */
  fields?: readonly string[]
  message: string | ((error: DbErrorLike) => string)
  /** 대응 규칙 — 로그와 문서 대조용 */
  rule: string
}

/**
 * **배열 인덱스를 붙이지 않는다.** DB 오류는 몇 번째 원소가 위반했는지 말하지
 * 않는다. 인덱스가 있는 경로(`schedules[3].lizardBarrier`)는 계약 계층 검증이
 * 담당하고, 여기까지 온 것은 배열 단위로 표시한다 — 없는 정보를 지어내면
 * 사용자가 엉뚱한 행을 고친다.
 */
export const BY_CONSTRAINT: Record<string, ConstraintRule> = {
  // ── I-01 상품당 상환 1건 ────────────────────────────────────────────────
  redemptions_els_id_key: {
    rule: 'I-01',
    message: '이미 상환 처리된 상품이다.',
  },

  // ── I-02·I-03 하위 행의 중복 ────────────────────────────────────────────
  els_underlyings_els_id_asset_id_key: {
    rule: 'I-02 / V-09',
    fields: ['underlyings'],
    message: '같은 기초자산을 두 번 넣을 수 없다.',
  },
  redemption_schedules_els_id_round_no_key: {
    rule: 'I-03 / V-04',
    fields: ['schedules'],
    message: '차수 번호가 중복된다.',
  },

  // ── I-04·I-10 리자드 짝 ─────────────────────────────────────────────────
  redemption_schedules_lizard_barrier_check: {
    rule: 'I-04 / V-05',
    fields: ['schedules'],
    message: '리자드 배리어는 해당 차수의 조기상환 배리어 이하여야 한다.',
  },
  redemption_schedules_lizard_coupon_check: {
    rule: 'I-10 / V-06',
    fields: ['schedules'],
    message:
      '리자드 배리어가 있는 차수는 리자드 쿠폰율이 필요하다. 원금상환형은 0으로 입력한다.',
  },

  // ── I-11·I-15 KI 세 필드 ────────────────────────────────────────────────
  els_products_ki_pair_check: {
    rule: 'I-11 / V-16',
    fields: ['kiObservation'],
    message: 'KI 배리어와 관찰 방식은 함께 설정하거나 함께 비운다.',
  },
  els_products_ki_touched_check: {
    rule: 'I-15 / V-18',
    fields: ['kiTouchedAt'],
    message: '노낙인 상품에는 KI 터치 이력을 둘 수 없다.',
  },

  // ── I-08·I-12 과세 금융소득 ─────────────────────────────────────────────
  redemptions_maturity_loss_check: {
    rule: 'I-08 / V-12',
    fields: ['taxableIncome'],
    message: '만기상환(손실)의 과세 금융소득은 0이어야 한다.',
  },
  redemptions_taxable_income_check: {
    rule: 'I-12 / V-11',
    fields: ['taxableIncome'],
    message: '과세 금융소득은 0 이상이어야 한다.',
  },

  // ── I-13·I-14 상환의 차수 ───────────────────────────────────────────────
  // **이름에서 `_check`가 빠진 것은 트리거로 내려갔기 때문이다** — 면제 조건이
  // 부모 상품의 `entry_mode`라 단일 행 `CHECK`로 표현할 수 없다(DOC-002 §8 I-14).
  // `*_required`(교차 행)가 정확한 부류이고 처리는 두 접미사에서 같다.
  redemptions_round_no_required: {
    rule: 'I-14 / V-13',
    fields: ['roundNo'],
    message: '조기상환·리자드 상환은 차수가 필요하다.',
  },
  redemptions_els_id_round_no_fkey: {
    rule: 'I-13 / V-14',
    fields: ['roundNo'],
    message: '해당 차수가 이 상품에 없다. 평가일정을 먼저 확인한다.',
  },

  // ── I-16 시세 좌표 (plpgsql 트리거 — 이름이 details로 온다) ──────────────
  asset_prices_coordinates_immutable: {
    rule: 'I-16',
    fields: ['assetId', 'asOfDate'],
    message:
      '시세의 자산·일자는 바꿀 수 없다. 좌표가 다른 시세는 정정이 아니라 새 관측이다.',
  },

  // ── I-17 값 범위 (P3b 5단계) ────────────────────────────────────────────
  els_products_principal_check: {
    rule: 'I-17 / V-01',
    fields: ['principal'],
    message: '투자원금은 0보다 커야 한다.',
  },
  els_products_evaluation_period_check: {
    rule: 'I-17 / V-20',
    fields: ['evaluationPeriodMonths'],
    message: '평가주기는 1개월 이상이어야 한다.',
  },

  // ── I-18 계약 조건 두 열의 짝 (P6 컷 5) ─────────────────────────────────
  //
  // 계약 경로로는 도달하기 어렵다 — `createProduct`는 두 값을 필수로 받고
  // (V-07·V-08) `createRealizedProduct`는 `REALIZED_ONLY`를 박는다. 사상을 두는
  // 이유는 **역방향 전이**다: `REALIZED_ONLY → FULL` UPDATE가 이 제약에 걸리며
  // (DOC-010 AQ-65) 그것이 계약 밖 경로의 유일한 자동 방어다.
  els_products_full_terms_check: {
    rule: 'I-18',
    fields: ['issueDate', 'annualCouponRate'],
    message: '계약 조건을 갖는 상품은 발행일과 연쿠폰율이 필요하다.',
  },
  redemption_schedules_barrier_check: {
    rule: 'I-17 / V-08',
    fields: ['schedules'],
    message: '배리어는 0보다 커야 한다.',
  },
  redemptions_gross_amount_check: {
    rule: 'I-17',
    fields: ['grossAmount'],
    message: '실수령액은 0 이상이어야 한다.',
  },

  // ── I-07 하위 행 최소 개수 (쓰기 함수, P3b 6단계) ────────────────────────
  els_products_underlyings_required: {
    rule: 'I-07 / V-02',
    fields: ['underlyings'],
    message: '기초자산은 1개 이상이어야 한다.',
  },
  els_products_schedules_required: {
    rule: 'I-07 / V-03',
    fields: ['schedules'],
    message: '평가일정은 1개 이상이어야 한다.',
  },

  // ── 상태 충돌 — 이름이 코드를 올린다 (DOC-002 §8 명명 규약) ──────────────
  els_products_redeemed_immutable: {
    rule: '상태 충돌',
    // ★ SQLSTATE는 23514(VALIDATION_FAILED)인데 CONFLICT로 올린다. 상환 완료
    //   상품의 수정은 어떤 값을 바꿔도 실패하므로 고칠 필드가 없다.
    code: 'CONFLICT',
    message: '상환 처리된 상품은 수정할 수 없다. 상환을 먼저 취소한다.',
  },

  // ── 상품 삭제를 막는 FK — 방향에 따라 뜻이 다르다 ────────────────────────
  redemptions_els_id_fkey: {
    rule: 'I-01 / §5.3',
    message: (error) =>
      (error.details ?? '').includes('still referenced')
        ? '상환 실적이 있는 상품은 삭제할 수 없다. 상환을 먼저 취소한다.'
        : '대상 상품을 찾을 수 없다.',
  },

  // ── 사용 중인 자산은 사라질 수 없다 ──────────────────────────────────────
  els_underlyings_asset_id_fkey: {
    rule: '§8.1',
    fields: ['underlyings'],
    message: '해당 기초자산을 찾을 수 없다.',
  },

  // ── 공용 데이터의 중복 ───────────────────────────────────────────────────
  assets_name_market_key: {
    rule: '§5.10',
    fields: ['name', 'market'],
    message: '같은 이름·시장의 자산이 이미 있다.',
  },
  tax_profiles_user_id_tax_year_key: {
    rule: 'I-06',
    fields: ['year'],
    message: '해당 연도의 과세 프로필이 이미 있다.',
  },
  asset_prices_asset_id_as_of_date_key: {
    rule: 'I-05',
    fields: ['asOfDate'],
    message: '해당 자산·일자의 시세가 이미 있다.',
  },
}

/**
 * 사상에 있는 제약 이름 — 두 대조가 이 목록을 쓴다.
 *
 * | 축 | 어디서 |
 * |---|---|
 * | 이름이 `pg_constraint`에 실재하는가 | `tests/rls/constraint-names.test.ts` |
 * | 문서 §3.2.1 표와 양방향으로 같은가 | `tests/db/docs-contract.test.ts` |
 *
 * 후자가 P3b.5에서 생겼다 — 그전까지 문서 대조는 손으로 옮긴 15개 배열에
 * `arrayContaining`을 걸어서, 코드에 9개가 더 있어도 통과했다.
 */
export const MAPPED_CONSTRAINTS = Object.keys(BY_CONSTRAINT)

/**
 * `23502`가 말하는 열 → 계약 입력 필드.
 *
 * **자동 변환(snake → camel)을 쓰지 않는다.** 열 이름과 입력 필드 이름이 항상
 * 대응하지는 않고(입력에 없는 열도 `NOT NULL`이다), 자동 변환이면 대응이 없는
 * 열에 그럴싸한 필드 이름이 붙어 화면이 존재하지 않는 입력을 가리킨다.
 * `lib/db/taxConstants.ts`가 키 매핑을 손으로 적은 것과 같은 논거다.
 */
const NOT_NULL_FIELD: Record<string, string> = {
  name: 'name',
  currency: 'currency',
  asset_type: 'assetType',
  issue_date: 'issueDate',
  principal: 'principal',
  annual_coupon_rate: 'annualCouponRate',
  account_type: 'accountType',
  base_price: 'basePrice',
  barrier: 'barrier',
  evaluation_date: 'evaluationDate',
  redemption_type: 'redemptionType',
  redemption_date: 'redemptionDate',
  gross_amount: 'grossAmount',
  taxable_income: 'taxableIncome',
  is_confirmed: 'isConfirmed',
  price: 'price',
  as_of_date: 'asOfDate',
  tax_year: 'year',
  other_income_base: 'otherIncomeBase',
  other_financial_income: 'otherFinancialIncome',
  health_insurance_type: 'healthInsuranceType',
}

// ---------------------------------------------------------------------------
// 매핑
// ---------------------------------------------------------------------------

/**
 * 사용자에게 보이지 않는 진단을 남긴다.
 *
 * 원문 메시지를 `ActionError.message`에 싣지 않는다 — 열 이름·제약 이름·`hint`의
 * `GRANT` 문장이 그대로 노출되고, 그것은 사용자가 할 수 있는 일과 무관하다.
 */
function report(what: string, error: DbErrorLike): void {
  console.error(
    `[DB] ${what}: code=${error.code ?? '-'} message=${error.message ?? '-'}` +
      `${error.details == null ? '' : ` details=${error.details}`}`,
  )
}

/** DB 오류를 `ActionError`로 바꾼다. 어느 경로에서도 예외를 던지지 않는다. */
export function mapDbError(error: DbErrorLike, what: string): ActionError {
  const sqlstate = error.code ?? ''
  const constraint = constraintNameOf(error)
  const rule = constraint == null ? undefined : BY_CONSTRAINT[constraint]

  if (rule != null) {
    const code = rule.code ?? BY_SQLSTATE[sqlstate] ?? 'INTERNAL'
    const message = typeof rule.message === 'function' ? rule.message(error) : rule.message
    const fields =
      rule.fields == null
        ? undefined
        : Object.fromEntries(rule.fields.map((field) => [field, message]))

    // 제약이 거부한 것은 정상 동작이므로 오류로 남기지 않는다. 다만 매핑이
    // 상태 충돌로 올린 경우는 경로가 드물어 흔적을 남긴다.
    if (rule.code != null) report(`${what} — ${rule.rule}로 거부됨`, error)

    return fields == null ? { code, message } : { code, message, fields }
  }

  // 제약 이름이 없거나 사상에 없다. SQLSTATE 기본값으로 내려가되 **조용히
  // 넘기지 않는다** — 사상에 없는 이름은 매핑에 구멍이 있다는 신호다.
  const fallback = BY_SQLSTATE[sqlstate]
  if (fallback == null) {
    report(`${what} — 분류되지 않은 DB 오류`, error)
    return { code: 'INTERNAL', message: GENERIC_MESSAGE.INTERNAL }
  }

  if (constraint != null) {
    report(`${what} — 사상에 없는 제약(${constraint})`, error)
  } else if (sqlstate === '42501') {
    // RLS 위반은 정상 방어다. 권한 미부여는 배포 결함이므로 구분해 남긴다.
    if (!/row-level security/i.test(error.message ?? '')) {
      report(`${what} — 권한 미부여(GRANT 결함)`, error)
    }
  }

  if (sqlstate === '23502') {
    const column = NOT_NULL_COLUMN.exec(error.message ?? '')?.[1]
    const field = column == null ? undefined : NOT_NULL_FIELD[column]
    const message = '필수 입력값이 비어 있다.'
    if (field != null) return { code: fallback, message, fields: { [field]: message } }
    report(`${what} — 널 위반의 열을 필드로 사상할 수 없다(${column ?? '?'})`, error)
    return { code: fallback, message }
  }

  return { code: fallback, message: GENERIC_MESSAGE[fallback] }
}

/** `mapDbError`를 실패 결과로 감싼다. 계약 함수의 호출 형태를 짧게 유지한다. */
export function failDb<T = never>(error: DbErrorLike, what: string): ActionResult<T> {
  const mapped = mapDbError(error, what)
  return fail<T>(mapped.code, mapped.message, mapped.fields)
}
