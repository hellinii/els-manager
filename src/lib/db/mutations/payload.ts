import type {
  CountingColumn,
  TableInsert,
  TableName,
  TableUpdate,
} from '../select'

/**
 * 쓰기 payload — DOC-011 §5.0 W-04 (AQ-30 종결)
 *
 * ## 읽기 방향만 막혀 있었다
 *
 * `select.ts`는 금액·비율 열을 `::text`로 캐스팅해 **읽기**에서 float64를
 * 배제한다. 그런데 생성 타입의 `Insert`·`Update`는 같은 열을 **`number`로
 * 요구한다.** 즉 타입을 그대로 따르는 쓰기 코드가 곧 절대 규칙 #2 위반이며,
 * 컴파일러는 그것을 정상이라고 말한다 — 방어가 한 방향에만 있으면 값은
 * 반대 방향으로 들어온다.
 *
 * ## 실측 — 가정이 아니다 (P3b 7단계)
 *
 * `asset_prices.price`(`numeric(18,6)`)에 같은 값을 두 형태로 넣고 `::text`로
 * 되읽었다.
 *
 * | 실은 형태 | 저장된 값 |
 * |---|---|
 * | 문자열 `"99999999999.999999"` | `99999999999.999999` — 정확 |
 * | JSON 수치 (생성 타입이 요구하는 형태) | **`100000000000.000000`** |
 *
 * 두 번째는 DB에 닿기 전에 이미 틀렸다. `JSON.stringify`가 float64를 직렬화하는
 * 순간 자릿수가 사라지고, PostgREST·Postgres는 받은 값을 성실히 저장한다.
 * **오류도 경고도 없다.** 그리고 `numeric(15,0)` 금액은 15자리까지 float64로
 * 정확하므로 값 단언으로는 영원히 드러나지 않는다 — `select.ts`가 읽기에서
 * "값이 아니라 구조로 막는다"고 쓴 것과 같은 이유로 여기서도 타입으로 막는다.
 *
 * ## 형태
 *
 * `defineColumns`의 대응물이다. 생성 타입에서 **파생**시키므로 목록을 손으로
 * 적지 않고, 새 금액 열이 생기면 그 열도 자동으로 `string`이 된다.
 *
 * | 방향 | 수단 | 결과 |
 * |---|---|---|
 * | 읽기 | `defineColumns` + `::text` | `numeric` → `string` |
 * | 쓰기 | `InsertPayload<T>` + `toInsert` | `string` → `numeric` (Postgres가 캐스팅) |
 *
 * PostgREST가 JSON 문자열을 `numeric` 열에 그대로 받는다는 것도 위 실측에서
 * 확인했다(HTTP 201, 값 정확). 캐스팅은 **경계 너머**에서 일어난다.
 */

/**
 * 금액·비율 열 — 즉 문자열로 실어야 하는 열.
 *
 * 판정은 읽기 쪽 `MustCastColumn`과 **글자 그대로 같다**: 생성 타입이 `number`인데
 * `CountingColumn`이 아닌 열. 두 방향이 `CountingColumn` 하나를 공유하므로 어느
 * 열이 금액인가에 대해 갈릴 수 없다.
 *
 * ★ `Shape`에 제약(`extends Record<string, unknown>`)을 걸지 않는다. 그 제약을
 *   만족시키려고 `TableInsert<T> & Record<string, unknown>`으로 교차시키면
 *   **인덱스 시그니처가 생기고** `keyof Shape`에 `string`이 들어온다. 그러면
 *   `number extends NonNullable<unknown>`(= `{}`)이 참이라 `string` 키가 금액으로
 *   분류되고, 결국 **모든 열이 `string`이 된다** — `round_no`도 `is_confirmed`도.
 *   실제로 그렇게 썼다가 타입 오류 5건으로 드러났다. 매핑 타입에는 제약이 필요
 *   없으므로 걸지 않는 것이 답이다.
 */
type MoneyColumnIn<Shape> = {
  [K in keyof Shape]-?: K extends CountingColumn
    ? never
    : number extends NonNullable<Shape[K]>
      ? K
      : never
}[keyof Shape]

/** 널 허용은 유지한다 — `Casted<V>`가 읽기 쪽에서 한 일과 같다 */
type AsString<V> = null extends V ? string | null : string

/**
 * 동형 사상이므로 `?`와 `readonly`가 보존된다. `id?: string`처럼 선택적인 열은
 * 선택적인 채로 남고, 생략하면 DB 기본값이 그대로 적용된다.
 */
type StringifyMoney<Shape> = {
  [K in keyof Shape]: K extends MoneyColumnIn<Shape> ? AsString<Shape[K]> : Shape[K]
}

/** 어느 열이 금액으로 분류되었는가 — 타입 수준 테스트가 이 이름을 읽는다 */
export type MoneyColumnOf<T extends TableName> = MoneyColumnIn<TableInsert<T>>

/** 생성 타입의 `Insert`에서 금액·비율 열만 `string`으로 바꾼 형태 */
export type InsertPayload<T extends TableName> = StringifyMoney<TableInsert<T>>

/** `Update`의 대응물. 전 열이 선택적인 것 외에는 `InsertPayload`와 같다 */
export type UpdatePayload<T extends TableName> = StringifyMoney<TableUpdate<T>>

/**
 * **이 파일에 단언이 두 개 있고 그것이 전부다.**
 *
 * 문자열이 실제로 전송되는 값이고 생성 타입의 `number`가 사실과 어긋나는 쪽이다.
 * 그 어긋남을 호출 지점마다 `as`로 덮으면 캐스팅이 계약 함수 수만큼 흩어지고,
 * 그중 하나가 `as` 없이 숫자를 넣어도 아무도 모른다. 그래서 **여기 한 곳에
 * 모으고**, 바깥에서 원시 객체 리터럴을 `.insert()`·`.upsert()`·`.update()`에
 * 넘기는 것은 린트가 막는다(`els/db-mutations`).
 *
 * 테이블 인자는 런타임에 쓰이지 않는다 — `T`를 추론시켜 payload가 **어느 테이블의
 * 것인지** 컴파일러가 검사하게 하려는 것이다. 없으면 아무 객체나 통과한다.
 */
export function toInsert<T extends TableName>(
  _table: T,
  payload: InsertPayload<T>,
): TableInsert<T> {
  return payload as unknown as TableInsert<T>
}

export function toUpdate<T extends TableName>(
  _table: T,
  payload: UpdatePayload<T>,
): TableUpdate<T> {
  return payload as unknown as TableUpdate<T>
}
