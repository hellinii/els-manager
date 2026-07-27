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
  /** 금액: 정수 문자열. 실현손익·추가납부는 음수가 될 수 있다 */
  AMOUNT: /^-?\d+$/,
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

/** 열거값은 배열로 적는다 — 계약의 유니온을 테스트가 독립적으로 다시 진술한다 */
export type Spec = FieldClass | readonly string[]

export type Leaf = { path: string; value: unknown }

/**
 * 반환 객체를 잎까지 걷는다.
 *
 * 배열은 인덱스를 지우고 `[]`로 접는다 — 경로가 픽스처 건수에 의존하면 분류표가
 * 데이터에 묶여, 상품을 하나 추가하는 것만으로 표를 고쳐야 한다.
 *
 * **`null`도 잎으로 기록한다.** 기록하지 않으면 "항상 `null`인 새 필드"가 ②의
 * 미분류 검사를 그대로 빠져나간다.
 */
export function walk(value: unknown, path: string, out: Leaf[]): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, `${path}[]`, out)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      walk(inner, path === '' ? key : `${path}.${key}`, out)
    }
    return
  }
  out.push({ path, value })
}

/** 위반 사유. 통과면 `null`. */
export function checkLeaf(spec: Spec, value: unknown): string | null {
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

      const reason = checkLeaf(spec, leaf.value)
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
  }
}
