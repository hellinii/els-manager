/**
 * Q-07 형식 적합성 — DOC-011 §4.0
 *
 * ## 왜 값 단언으로는 부족한가
 *
 * P3a는 `expect(view.underlyings[0].currentPrice).toBe('95.000000')`처럼 필드마다
 * 리터럴을 박아 두었다. 그 방식은 **박아 둔 필드만** 지킨다 — 새 필드가 생기면
 * 아무도 보지 않고, 형식이 틀려도 그 리터럴을 새 값으로 갱신하면 초록색이 된다.
 * 실제로 시세 세 필드가 Q-07의 어느 분류에도 맞지 않는 채로 통과하고 있었고,
 * 그중 하나는 위 리터럴이 **틀린 형태를 고정**하고 있었다.
 *
 * 그래서 값이 아니라 **구조**로 검사한다. 반환 객체를 잎까지 걷고, 관측된 모든
 * 잎이 분류표에 있는지를 **양방향**으로 본다.
 *
 *   ① 모든 값이 자기 분류의 형식을 지킨다
 *   ② 관측된 잎 중 분류표에 없는 것이 없다  ← 새 필드가 생기면 여기서 죽는다
 *   ③ 분류표의 모든 경로가 비-null로 한 번 이상 관측된다
 *      ← 죽은 분류(필드 삭제)와, null로만 와서 형식이 실제로는 한 번도
 *        검증되지 않은 경로를 잡는다
 *
 * ②가 핵심이다. "검사 대상"을 손으로 나열하면 필드가 늘 때 조용히 낡지만,
 * **관측을 기준으로** 표를 검사하면 미분류가 곧 실패다.
 */

export const FORMAT = {
  /**
   * 과세 축 금액: 원화 정수 문자열 — 과세 금융소득·원천징수·세액·보험료 (DOC-011 Q-07 ⓑ).
   * 추가납부·차액은 음수가 될 수 있다. 종전 `AMOUNT`이며 상품 통화 금액은 아래 `MONEY`다
   */
  AMOUNT_KRW: /^-?\d+$/,
  /** 비율: 소수 4자리 고정 (`numeric(6,4)`) */
  RATIO: /^\d+\.\d{4}$/,
  /** 시세: 소수 6자리 고정 (`numeric(18,6)`) — v0.8에서 신설된 세 번째 분류 */
  PRICE: /^\d+\.\d{6}$/,
  DATE: /^\d{4}-\d{2}-\d{2}$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
} as const

export type FieldClass =
  | keyof typeof FORMAT
  /** 형식이 없는 문자열. `typeof === 'string'`만 본다 */
  | 'TEXT'
  /** 개수를 세는 정수 — 차수·개월수·연도 */
  | 'NUMBER'
  | 'BOOL'
  /**
   * 객체 또는 `null`인 자리. **`null`일 때만 잎으로 관측된다.**
   *
   * 이 분류가 커버리지 단언을 자동으로 강하게 만든다 — `projection`(NULL_OBJECT)과
   * `projection.appliedRoundNo`를 둘 다 등재하면, ③이 **양쪽 분기**를 모두
   * 요구하게 된다. 한쪽만 픽스처에 있으면 실패한다.
   */
  | 'NULL_OBJECT'
  /**
   * 상품 통화 금액 — 투자원금·실수령액과 그 파생 (DOC-011 Q-07 ⓐ · P8 SB-10).
   *
   * 형식이 **통화에 따라 갈린다** — 원화 `/^-?\d+$/` · 달러 `/^-?\d+\.\d{2}$/`. 통화는 같은 객체
   * 또는 조상 객체의 `currency`에서, 없으면 **루트의 `product.currency`**에서 읽는다(§4.3 —
   * `product`는 `schedules[]`·`projection`·`redemption`의 조상이 아니라 형제다). **둘 다 없으면
   * 던진다** — 원화로 떨어지면 달러 값이 원화 규칙으로 판정되어 `'10001'`이 초록이다.
   */
  | 'MONEY'

/** `MONEY`의 통화별 형식 — 보조단위 고정 자릿수 (`MINOR_UNITS`와 같은 값) */
export const MONEY_FORMAT: Readonly<Record<string, RegExp>> = {
  KRW: /^-?\d+$/,
  USD: /^-?\d+\.\d{2}$/,
}

/** 열거값은 배열로 적는다 — 계약의 유니온을 테스트가 독립적으로 다시 진술한다 */
export type Spec = FieldClass | readonly string[]

export type Leaf = {
  path: string
  value: unknown
  /** 가장 가까운 조상(자신 포함)의 `currency`, 없으면 루트 `product.currency`. `MONEY`만 읽는다 */
  currency: string | undefined
}

/**
 * 반환 객체를 잎까지 걷는다.
 *
 * 배열은 인덱스를 지우고 `[]`로 접는다 — 경로가 픽스처 건수에 의존하면 분류표가
 * 데이터에 묶여, 상품을 하나 추가하는 것만으로 표를 고쳐야 한다.
 *
 * **`null`도 잎으로 기록한다.** 기록하지 않으면 "항상 `null`인 새 필드"가 ②의
 * 미분류 검사를 그대로 빠져나간다.
 */
export function walk(
  value: unknown,
  path: string,
  out: Leaf[],
  /** 조상에서 내려온 통화. 루트 호출에서는 생략한다 — 루트의 `product.currency`가 가장 바깥이다 */
  inherited: string | undefined = path === '' ? rootProductCurrency(value) : undefined,
): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, `${path}[]`, out, inherited)
    return
  }
  if (value !== null && typeof value === 'object') {
    // 가까운 조상이 먼 조상을 이긴다 — 루트 `product.currency`는 그래서 «마지막» 폴백이다
    const own = (value as Record<string, unknown>).currency
    const currency = typeof own === 'string' ? own : inherited
    for (const [key, inner] of Object.entries(value)) {
      walk(inner, path === '' ? key : `${path}.${key}`, out, currency)
    }
    return
  }
  out.push({ path, value, currency: inherited })
}

function rootProductCurrency(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const product = (value as Record<string, unknown>).product
  if (product === null || typeof product !== 'object') return undefined
  const currency = (product as Record<string, unknown>).currency
  return typeof currency === 'string' ? currency : undefined
}

/** 위반 사유. 통과면 `null`. `MONEY`인데 통화를 못 찾으면 **던진다** — 위반이 아니라 계기의 결함이다 */
export function checkLeaf(
  spec: Spec,
  value: unknown,
  currency?: string,
  path = '(경로 모름)',
): string | null {
  // null 허용 여부는 타입 층이 본다. 여기서는 형식만 본다.
  if (value === null) return null

  // `Array.isArray`는 `readonly string[]`을 유니온에서 걷어내지 못한다.
  // `FieldClass`가 전부 문자열 리터럴이므로 `typeof`로 가른다.
  if (typeof spec !== 'string') {
    return spec.includes(value as string)
      ? null
      : `열거 밖: ${JSON.stringify(value)} (허용: ${spec.join('|')})`
  }

  switch (spec) {
    case 'NULL_OBJECT':
      return `null이어야 하는데 잎으로 관측됨: ${JSON.stringify(value)}`
    case 'BOOL':
      return typeof value === 'boolean' ? null : `boolean이 아니다: ${typeof value}`
    case 'NUMBER':
      return Number.isInteger(value) ? null : `정수가 아니다: ${JSON.stringify(value)}`
    case 'TEXT':
      return typeof value === 'string' ? null : `문자열이 아니다: ${typeof value}`
    case 'MONEY': {
      const format = currency == null ? undefined : MONEY_FORMAT[currency]
      if (format == null) {
        // 원화로 떨어지지 않는다 — 그러면 달러 `'10001'`이 초록이다(DOC-011 Q-07′ · SB-10)
        throw new Error(
          `MONEY 경로 ${path}의 통화를 알 수 없다(${String(currency)}) — ` +
            '같은 객체·조상·루트 product 어디에도 currency가 없다 (DOC-011 §4.0 규칙 1)',
        )
      }
      if (typeof value !== 'string') return `문자열이 아니다(MONEY): ${typeof value}`
      return format.test(value) ? null : `MONEY(${currency}) 형식 위반: ${JSON.stringify(value)}`
    }
    default:
      if (typeof value !== 'string') {
        return `문자열이 아니다(${spec}): ${typeof value}`
      }
      return FORMAT[spec].test(value)
        ? null
        : `${spec} 형식 위반: ${JSON.stringify(value)}`
  }
}

export type Coverage = {
  /** 형식을 어긴 잎 */
  violations: string[]
  /** 분류표에 없는 경로 — ② */
  unclassified: string[]
  /** 분류표에 있으나 한 번도 관측되지 않은 경로 — ③ */
  unobserved: string[]
  /** 관측은 됐으나 전부 `null`이라 형식이 검증된 적 없는 경로 — ③ */
  neverNonNull: string[]
  /**
   * `MONEY` 경로마다 비-null로 관측된 통화 — ③′. 경로 단위 `neverNonNull`은 원화 한 번으로 채워지므로
   * 「달러 분기가 한 번이라도 판정되었는가」에 답하지 못한다(반박 검토 지적). 픽스처가 옮겨져 어느 경로의
   * 달러 관측이 사라지면 그 경로의 달러 형식 결함이 보이지 않는다
   */
  moneyCurrencies: Record<string, string[]>
}

/**
 * 여러 계약의 반환값을 누적해 한 번에 판정한다.
 *
 * 계약별로 쪼개 단언하면 커버리지(②③)가 **실행 순서에 의존**하게 된다 —
 * `it.only`나 `-t` 필터 한 번에 거짓 실패가 난다. 그래서 수집은 `beforeAll`에서
 * 끝내고 `it`은 누적 결과만 본다.
 */
export function collect(
  table: Readonly<Record<string, Spec>>,
  samples: ReadonlyArray<{ label: string; value: unknown }>,
  /** `null`로만 와도 되는 경로. **사유를 주석으로 남긴다** */
  nullOnly: readonly string[] = [],
): Coverage {
  const violations: string[] = []
  const unclassified = new Set<string>()
  const seen = new Set<string>()
  const nonNull = new Set<string>()
  const money = new Map<string, Set<string>>()

  for (const sample of samples) {
    const leaves: Leaf[] = []
    walk(sample.value, '', leaves)

    for (const leaf of leaves) {
      const spec = table[leaf.path]
      if (spec === undefined) {
        unclassified.add(`${leaf.path} (${sample.label})`)
        continue
      }
      seen.add(leaf.path)
      if (leaf.value !== null) nonNull.add(leaf.path)
      if (spec === 'MONEY' && leaf.value !== null && leaf.currency != null) {
        const set = money.get(leaf.path) ?? new Set<string>()
        set.add(leaf.currency)
        money.set(leaf.path, set)
      }

      const reason = checkLeaf(spec, leaf.value, leaf.currency, leaf.path)
      if (reason != null) violations.push(`${leaf.path}: ${reason} (${sample.label})`)
    }
  }

  const paths = Object.keys(table)
  return {
    violations,
    unclassified: [...unclassified].sort(),
    unobserved: paths.filter((path) => !seen.has(path)).sort(),
    neverNonNull: paths
      .filter(
        (path) =>
          seen.has(path) &&
          !nonNull.has(path) &&
          table[path] !== 'NULL_OBJECT' &&
          !nullOnly.includes(path),
      )
      .sort(),
    moneyCurrencies: Object.fromEntries(
      paths
        .filter((path) => table[path] === 'MONEY')
        .map((path) => [path, [...(money.get(path) ?? [])].sort()]),
    ),
  }
}
