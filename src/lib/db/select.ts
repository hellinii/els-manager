import type { Database } from '@/types/database.types'

/**
 * 열 목록 · 문자열 캐스팅 · 절단 감지 — DOC-011 §4.0 Q-06·Q-08
 *
 * ## 왜 캐스트 목록을 손으로 쓰지 않는가
 *
 * PostgREST는 `numeric`을 JSON **숫자**로 직렬화하므로 `JSON.parse`가 float64를
 * 만든다(절대 규칙 #2·M-03 위반. `DecimalInput`은 `number`를 아예 거부한다).
 * 그래서 모든 금액·비율 열을 `::text`로 캐스팅해 받는다.
 *
 * 문제는 **빠뜨렸을 때 드러나지 않는다**는 점이다. `numeric(15,0)`은 15자리까지
 * float64로 정확히 표현되므로 값 단언은 영원히 통과한다. 그래서 값이 아니라
 * 구조로 막는다 — 테이블별 열 상수 **하나**에서 select 문자열과 행 타입을 함께
 * 파생시켜 "캐스팅"과 "선언된 타입"이 어긋날 수 없게 하고, `'raw'`로 남은 열이
 * 수치형이면 `typecheck`가 거부한다(`assertAllNumericCast`).
 *
 * ## 실측: postgrest-js의 select 파서는 `::text`를 이해하지만 널 허용을 잃는다
 *
 * P3a에서 타입 추론을 직접 측정했다.
 *
 * | select | 추론된 타입 |
 * |---|---|
 * | `principal` | `number` — float64 위험 그대로 |
 * | `principal::text` | `string` |
 * | `ki_barrier::text` | **`string`** ← DB는 `numeric | null`인데 `| null`이 사라진다 |
 * | `els_underlyings(base_price::text)` | `string` — 임베드 안쪽도 이해한다 |
 *
 * `any`가 아니라 `string`이므로 "조용한 float64"는 아니다. 그러나 널 허용이
 * 사라지는 것은 **타입이 사실과 어긋나는** 별개의 결함이다 — 노낙인 상품의
 * `ki_barrier`는 실제로 `null`로 오는데 타입은 `string`이라고 말한다. 그래서
 * 행 타입을 postgrest의 추론에 맡기지 않고 **생성 타입에서 널 허용을 복원**해
 * `overrideTypes`로 덮는다. 두 값(문자열·타입) 모두 같은 상수에서 나오므로
 * 어긋날 수 없다.
 */

type PublicTables = Database['public']['Tables']
export type TableName = keyof PublicTables
type TableRow<T extends TableName> = PublicTables[T]['Row']

/** `'text'` = `::text` 캐스팅 후 문자열로 받는다. `'raw'` = 생성 타입 그대로. */
export type ColumnKind = 'text' | 'raw'

/**
 * 열 사양. **키는 생성 타입의 열로 제한된다** — 오타는 물론이고, 마이그레이션이
 * 열을 지우면 `npm run db:types` 직후 `typecheck`가 즉시 실패한다. 드리프트
 * 대조 테스트(AQ-19)보다 앞선 방어이며 그쪽은 수동 스위트에만 있다.
 */
export type ColumnSpec<T extends TableName> = {
  readonly [K in keyof TableRow<T>]?: ColumnKind
}

/** 캐스팅하면 문자열이 되지만 **널 허용은 유지한다** (위 실측). */
type Casted<V> = null extends V ? string | null : string

/** 사양에서 파생된 행 타입. 선언과 캐스팅이 같은 출처를 갖는다. */
export type SelectedRow<T extends TableName, S extends ColumnSpec<T>> = {
  -readonly [K in keyof S & keyof TableRow<T>]-?: S[K] extends 'text'
    ? Casted<TableRow<T>[K]>
    : TableRow<T>[K]
}

/**
 * 생성 타입이 `number`인 열 — 즉 캐스팅이 필수인 열.
 *
 * `smallint`·`integer`도 `number`로 생성되지만 그 열들(차수·개월수)은 개수를
 * 세는 정수이므로 float64 위험이 없다. 그래서 **예외 목록을 명시**한다 —
 * 예외를 열별로 적어 두면 새 수치 열이 자동으로 "캐스팅 필수"에 들어온다.
 */
type CountingColumn = 'round_no' | 'evaluation_period_months' | 'tax_year'

type MustCastColumn<T extends TableName> = {
  [K in keyof TableRow<T>]-?: K extends CountingColumn
    ? never
    : number extends NonNullable<TableRow<T>[K]>
      ? K
      : never
}[keyof TableRow<T>]

/** `'raw'`로 남았는데 캐스팅이 필수인 열. `never`가 아니면 타입 오류가 된다. */
export type MissingCast<T extends TableName, S extends ColumnSpec<T>> = {
  [K in keyof S]-?: K extends MustCastColumn<T>
    ? S[K] extends 'text'
      ? never
      : K
    : never
}[keyof S]

/**
 * 열 사양을 등록한다. 캐스팅을 빠뜨리면 **호출 지점에서** 타입 오류가 난다.
 *
 * 두 번째 인자의 교차 타입이 그 장치다 — `MissingCast`가 `never`가 아니면
 * 사양 객체에 절대 만족할 수 없는 필드를 요구하게 되고, 오류 메시지가 누락된
 * 열 이름을 그대로 보여준다.
 */
export function defineColumns<
  T extends TableName,
  const S extends ColumnSpec<T>,
>(
  _table: T,
  spec: MissingCast<T, S> extends never
    ? S
    : S & {
        __금액_비율_열에_text_캐스팅이_누락되었다: MissingCast<T, S>
      },
): S {
  return spec as S
}

/**
 * select 문자열. `'text'` 열에 `::text`를 붙인다.
 *
 * PostgREST는 `col::text`의 응답 키를 `col`로 유지하므로 별칭이 필요하지 않다
 * (별칭을 쓰면 행 타입의 키와 어긋날 여지가 생긴다).
 */
export function selectList<T extends TableName, S extends ColumnSpec<T>>(
  spec: S,
): string {
  return Object.entries(spec)
    .map(([column, kind]) => (kind === 'text' ? `${column}::text` : column))
    .join(',')
}

/** 임베드 한 단계. 안쪽 캐스팅도 같은 상수에서 나온다. */
export function embed(
  relation: string,
  inner: string,
  options?: { modifier?: string },
): string {
  const modifier = options?.modifier ?? ''
  return `${relation}${modifier}(${inner})`
}

/**
 * 서버 상한 — `supabase/config.toml`의 `[api].max_rows`.
 *
 * 값을 코드에 두는 것이 아니라 **한 곳에 두고 감지에만 쓴다.** 설정이 바뀌어
 * 이 값이 낡으면 상한보다 먼저 감지가 걸리므로 안전한 방향으로 틀린다.
 */
export const SERVER_MAX_ROWS = 1000

/**
 * 절단 감지용 요청 상한. **`=== SERVER_MAX_ROWS`로 감지하지 않는다** — 정확히
 * 1000행인 정상 결과를 오탐한다. 하나 더 요청해서 `> 1000`을 본다.
 */
export const TRUNCATION_PROBE_LIMIT = SERVER_MAX_ROWS + 1

/**
 * Q-06 — 잘린 목록을 반환하지 않고 **던진다.**
 *
 * 조용히 넘기면 화면은 정상으로 보이고 목록만 짧아진다. 현재 규모(A-01: 사용자
 * 10명 이하)에서는 도달 불가하며, **도달했다면 그것은 AQ-09(페이지네이션)를
 * 닫아야 한다는 신호**다. `listSchedule`은 행 단위가 차수라 가장 먼저 닿는다.
 */
export function assertNotTruncated(rows: readonly unknown[], what: string): void {
  if (rows.length > SERVER_MAX_ROWS) {
    throw new Error(
      `${what}의 결과가 서버 상한(${SERVER_MAX_ROWS}행)에 도달했다. ` +
        '잘린 목록을 반환하지 않는다 — 페이지네이션(AQ-09)을 도입해야 한다는 신호다.',
    )
  }
}
