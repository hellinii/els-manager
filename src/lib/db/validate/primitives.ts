import { dec } from '@/lib/decimal'

import type { ActionError } from '../mutations/result'

/**
 * 검증 조합기 — DOC-011 §6
 *
 * ## 도구를 쓰지 않는 이유 (AQ-10)
 *
 * ① 스키마 라이브러리의 `coerce`는 **구문 수준 강제 변환 금지를 우회한다.** Q-08의
 * 방어는 `Number()`·`parseFloat`·단항 `+`를 린트로 차단하는 것인데, 라이브러리
 * 호출은 그 규칙에 걸리지 않으므로 금액이 float64를 경유하는 경로가 규칙 밖에
 * 하나 생긴다. ② 타입 정본이 문서(§5)에서 스키마로 옮겨가 문서와 어긋나도
 * 컴파일이 통과한다. ③ V-03·V-04·V-05·V-07·V-09·V-12~V-14는 어느 도구에서도
 * 커스텀 코드이므로, 도구가 줄여 주는 것은 원시 타입 검사뿐이다.
 *
 * ## 형식은 문자열 그대로 검사한다
 *
 * 금액·비율은 **정규식으로 형태를 먼저 보고** 그 다음 `dec()`로 비교한다. 순서가
 * 반대면 `dec()`가 `RangeError`를 던지고, 그것을 §3.2.2로 변환하는 층이 하나 더
 * 필요해진다 — 여기서 막으면 그 예외가 애초에 나지 않는다.
 */

/**
 * §6 표의 ID 전체. **테스트가 이 목록을 순회해 케이스 누락을 잡는다.**
 *
 * **`rules.ts`가 아니라 여기 있는 이유.** `Problems.add`의 인자를 `RuleId`로
 * 좁히려면 이 모듈이 그 타입을 알아야 하는데, `rules.ts`는 이미 `Problems`를
 * import한다 — 반대 방향 import를 더하면 순환이 된다. ID는 위반 수집기의
 * 어휘이므로 수집기와 같은 모듈에 두고 `rules.ts`가 재export한다.
 *
 * **이 목록은 §6 표의 사본이며 그 사실이 검증된다.** `tests/db/docs-contract.test.ts`가
 * `docs/11_API_계약_명세.md` §6을 파싱해 **순서까지** 대조하므로 문서에 규칙이
 * 늘거나 줄면 실패한다 — v1.0까지는 손으로 옮긴 사본이라 §6이 앞서가도
 * 아무것도 실패하지 않았다.
 */
export const RULE_IDS = [
  'V-01',
  'V-02',
  'V-03',
  'V-04',
  'V-05',
  'V-06',
  'V-07',
  'V-08',
  'V-09',
  'V-10',
  'V-11',
  'V-12',
  'V-13',
  'V-14',
  'V-15',
  'V-16',
  'V-17',
  'V-18',
  'V-19',
  'V-20',
  'V-21',
] as const

export type RuleId = (typeof RULE_IDS)[number]

/**
 * 위반 1건. `rule`은 규칙 ID이며 전수 열거 단언의 근거다.
 *
 * **`string`이 아니라 `RuleId`다.** 좁히지 않으면 오타(`'V-2'`)나 없는 ID
 * (`'V-99'`)가 컴파일을 통과하고, 전수 열거 단언은 `CASES`가 선언한 ID만 보므로
 * `inputs.ts`가 실제로 붙인 문자열은 아무도 검사하지 않았다.
 *
 * > **예시를 `'V-21'`에서 `'V-99'`로 바꿨다 (P5a 컷 2b).** V-21이 **실재하게 됐으므로**
 * > 그 예시가 「없는 ID」를 가리키지 못한다 — 주석이 자기 예시로 거짓을 말하는 상태였다.
 * > 부류: **문서가 «없는 것»을 예시로 쓰면 그것이 생기는 날 조용히 틀린다.**
 *
 * **좁혀도 남는 것이 있다** — 스물한 개 *안에서* 잘못 고르는 것은 타입이 잡지 못한다
 * (§6 v1.1 각주). 셰이프 파싱이 형태 검사에 그 필드의 규칙 ID를 빌려 쓰므로,
 * 그 자리를 없애려면 §6에 형태 규칙을 신설해야 하고 그러면 `RULE_IDS`가 §6에서
 * 파생된다는 방향이 뒤집힌다.
 */
export type Violation = {
  rule: RuleId
  field: string
  message: string
}

/**
 * 위반 수집기.
 *
 * **필드당 첫 오류만 남긴다.** `ActionError.fields`가 `Record<string, string>`이므로
 * 한 필드에 여러 메시지를 담을 수 없다. 뒤의 것으로 덮으면 사용자가 보는 이유가
 * 검사 순서에 따라 달라지므로, 먼저 걸린 것을 유지한다 — 규칙 순서는 §6 표의
 * 순서이며 안정적이다.
 */
export class Problems {
  private readonly items: Violation[] = []

  add(rule: RuleId, field: string, message: string): void {
    this.items.push({ rule, field, message })
  }

  get isEmpty(): boolean {
    return this.items.length === 0
  }

  /** 걸린 규칙 ID(중복 없이). 전수 열거 단언과 로그가 쓴다 */
  rules(): RuleId[] {
    return [...new Set(this.items.map((item) => item.rule))]
  }

  all(): readonly Violation[] {
    return this.items
  }

  fields(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const item of this.items) {
      if (!(item.field in out)) out[item.field] = item.message
    }
    return out
  }

  /** §3.2의 `VALIDATION_FAILED`. 비어 있으면 부르지 않는다 */
  toError(): ActionError {
    return {
      code: 'VALIDATION_FAILED',
      message: '입력값을 확인한다.',
      fields: this.fields(),
    }
  }
}

// ---------------------------------------------------------------------------
// 형식
// ---------------------------------------------------------------------------

/**
 * 열 선언의 길이 상한 — V-19. **`supabase/migrations`의 스키마가 정본이다.**
 *
 * 타입에서 파생시킬 수 없다(생성 타입은 `string`일 뿐 길이를 담지 않는다). 그래서
 * 손으로 적고, `tests/db/validate.test.ts`가 마이그레이션 SQL을 파싱해 이 표와
 * 대조한다 — 열을 넓히거나 좁히면 그 대조가 먼저 실패한다.
 */
export const LENGTH_LIMITS = {
  productName: 200,
  issuer: 50,
  assetName: 100,
  market: 20,
  /** `char(3)` — 짧으면 공백으로 채워지므로 **정확히** 3이어야 한다 */
  currency: 3,
  /*
   * P5a 컷 2b — §5.12. **리터럴로 적지 «않는» 이유가 이 표의 존재 이유다.**
   * 초안은 `inputs.ts`에 `max: 30`·`max: 50`을 그대로 박았는데, 그러면 그 값이
   * 마이그레이션 대조(`tests/db/validate.test.ts`) **밖**에 있게 되어 열을 넓히거나
   * 좁혀도 **아무것도 실패하지 않는다.** 원장에 넣는 것이 그 대조에 들어가는 방법이다.
   */
  provider: 30,
  providerSymbol: 50,
} as const

/** `smallint`의 범위. 초과는 `22003`이 되고 그 코드는 열을 말하지 않는다 */
export const SMALLINT_MAX = 32_767

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
/** 부호 없는 정수. 지수 표기(`1e5`)를 허용하지 않는다 — 형식 규약이 문자열이다 */
const INTEGER = /^\d+$/
/** 정수 또는 소수. 지수 표기·선행 부호 없음 */
const DECIMAL = /^\d+(\.\d+)?$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UPPER_ALPHA = /^[A-Z]+$/

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 계약이 받은 **식별자**의 형태 검사. 필드 검증이 아니라 경로 검증이다.
 *
 * `id`는 사용자가 입력하는 값이 아니라 화면이 들고 있는 값이므로 위반은
 * `VALIDATION_FAILED`가 아니라 `NOT_FOUND`로 처리한다(§5.2·§5.3). 그대로 질의에
 * 넘기면 PostgREST가 `22P02`를 내고, 그 코드는 "고칠 필드"를 지목할 수 없다.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** 존재하지 않는 날짜(`2026-02-30`)까지 거부한다. 형식만 보면 DB가 `22007`을 낸다 */
export function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false

  const [y, m, d] = value.split('-').map((part) => Number.parseInt(part, 10))
  if (m < 1 || m > 12 || d < 1) return false

  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d <= lastDay
}

// ---------------------------------------------------------------------------
// 필드 단위 검사 — 값을 돌려주거나 위반을 기록하고 `null`을 준다
// ---------------------------------------------------------------------------

export function requireString(
  p: Problems,
  rule: RuleId,
  field: string,
  value: unknown,
  options: { label: string; max?: number; exact?: number; upperAlpha?: boolean },
): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    p.add(rule, field, `${options.label}을(를) 입력한다.`)
    return null
  }
  if (options.exact != null && value.length !== options.exact) {
    p.add(rule, field, `${options.label}은(는) ${options.exact}자여야 한다.`)
    return null
  }
  if (options.max != null && value.length > options.max) {
    p.add(rule, field, `${options.label}은(는) ${options.max}자 이내여야 한다.`)
    return null
  }
  if (options.upperAlpha === true && !UPPER_ALPHA.test(value)) {
    p.add(rule, field, `${options.label}은(는) 대문자 영문이어야 한다.`)
    return null
  }
  return value
}

export function optionalString(
  p: Problems,
  rule: RuleId,
  field: string,
  value: unknown,
  options: { label: string; max?: number },
): string | undefined | null {
  if (value == null || value === '') return undefined
  return requireString(p, rule, field, value, options)
}

export function requireUuid(
  p: Problems,
  rule: RuleId,
  field: string,
  value: unknown,
  label: string,
): string | null {
  if (typeof value !== 'string' || !UUID.test(value)) {
    p.add(rule, field, `${label}을(를) 선택한다.`)
    return null
  }
  return value
}

export function requireIsoDate(
  p: Problems,
  rule: RuleId,
  field: string,
  value: unknown,
  label: string,
): string | null {
  if (typeof value !== 'string' || !isRealIsoDate(value)) {
    p.add(rule, field, `${label}을(를) YYYY-MM-DD 형식으로 입력한다.`)
    return null
  }
  return value
}

/**
 * 금액 — 문자열 그대로 검사한다.
 *
 * `integer: true`면 소수점을 거부한다(V-01). **그 밖의 금액에서 소수 자릿수 초과의
 * 반올림은 여기서 닫지 않는다** — `numeric(15,0)`이 `1000.7`을 `1001`로 저장하는
 * 문제는 AQ-16이며 P3b의 범위 밖이다. 형태만 보고 통과시킨다.
 */
export function requireAmount(
  p: Problems,
  rule: RuleId,
  field: string,
  value: unknown,
  options: { label: string; min: 'positive' | 'zero'; integer?: boolean },
): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    p.add(rule, field, `${options.label}을(를) 입력한다.`)
    return null
  }

  const pattern = options.integer === true ? INTEGER : DECIMAL
  if (!pattern.test(value)) {
    p.add(
      rule,
      field,
      options.integer === true
        ? `${options.label}은(는) 0 이상의 정수로 입력한다.`
        : `${options.label}은(는) 숫자로 입력한다.`,
    )
    return null
  }

  const amount = dec(value)
  if (options.min === 'positive' && !amount.gt(0)) {
    p.add(rule, field, `${options.label}은(는) 0보다 커야 한다.`)
    return null
  }
  return value
}

export function optionalAmount(
  p: Problems,
  rule: RuleId,
  field: string,
  value: unknown,
  options: { label: string; min: 'positive' | 'zero'; integer?: boolean },
): string | undefined | null {
  if (value == null || value === '') return undefined
  return requireAmount(p, rule, field, value, options)
}

/**
 * 비율 — V-08. 상한은 전부 `2`, **하한은 필드별로 다르다.**
 *
 * `lizardCouponRate`는 `0`이 정상 입력이다(원금상환형 리자드, DOC-007 §4.1). 그
 * 사실을 v0.8까지의 V-08(`0 < x ≤ 2`)이 거부하고 있었고, 그러면 그 상품은 `0`도
 * `null`도 저장할 수 없어 **어떤 값으로도 표현되지 않는 상태**가 된다.
 */
export function requireRatio(
  p: Problems,
  rule: RuleId,
  field: string,
  value: unknown,
  options: { label: string; min: 'positive' | 'zero' },
): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    p.add(rule, field, `${options.label}을(를) 입력한다.`)
    return null
  }
  if (!DECIMAL.test(value)) {
    p.add(rule, field, `${options.label}은(는) 소수로 입력한다(90% → 0.9).`)
    return null
  }

  const ratio = dec(value)
  if (options.min === 'positive' && !ratio.gt(0)) {
    p.add(rule, field, `${options.label}은(는) 0보다 커야 한다.`)
    return null
  }
  if (ratio.gt(2)) {
    // 사용자가 90을 그대로 넣으면 배리어가 9000%가 된다(M-04 정규화 누락)
    p.add(rule, field, `${options.label}은(는) 2 이하여야 한다. 90%는 0.9로 입력한다.`)
    return null
  }
  return value
}

export function optionalRatio(
  p: Problems,
  rule: RuleId,
  field: string,
  value: unknown,
  options: { label: string; min: 'positive' | 'zero' },
): string | undefined | null {
  if (value == null || value === '') return undefined
  return requireRatio(p, rule, field, value, options)
}

/** 개수를 세는 정수 — V-20. `smallint` 범위를 넘으면 DB가 `22003`을 낸다 */
export function requireInt(
  p: Problems,
  rule: RuleId,
  field: string,
  value: unknown,
  options: { label: string; min: number; max?: number },
): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    p.add(rule, field, `${options.label}은(는) 정수로 입력한다.`)
    return null
  }
  const max = options.max ?? SMALLINT_MAX
  if (value < options.min || value > max) {
    p.add(rule, field, `${options.label}은(는) ${options.min}부터 ${max} 사이여야 한다.`)
    return null
  }
  return value
}

export function optionalInt(
  p: Problems,
  rule: RuleId,
  field: string,
  value: unknown,
  options: { label: string; min: number; max?: number },
): number | undefined | null {
  if (value == null) return undefined
  return requireInt(p, rule, field, value, options)
}

export function requireEnum<T extends string>(
  p: Problems,
  rule: RuleId,
  field: string,
  value: unknown,
  allowed: readonly T[],
  label: string,
): T | null {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    p.add(rule, field, `${label}을(를) 선택한다.`)
    return null
  }
  return value as T
}

export function optionalEnum<T extends string>(
  p: Problems,
  rule: RuleId,
  field: string,
  value: unknown,
  allowed: readonly T[],
  label: string,
): T | undefined | null {
  if (value == null || value === '') return undefined
  return requireEnum(p, rule, field, value, allowed, label)
}

export function requireBoolean(
  p: Problems,
  rule: RuleId,
  field: string,
  value: unknown,
  label: string,
): boolean | null {
  if (typeof value !== 'boolean') {
    p.add(rule, field, `${label}을(를) 선택한다.`)
    return null
  }
  return value
}

export function optionalBoolean(
  p: Problems,
  rule: RuleId,
  field: string,
  value: unknown,
  label: string,
): boolean | undefined | null {
  if (value == null) return undefined
  return requireBoolean(p, rule, field, value, label)
}

export function requireArray(
  p: Problems,
  rule: RuleId,
  field: string,
  value: unknown,
  label: string,
): unknown[] | null {
  if (!Array.isArray(value)) {
    p.add(rule, field, `${label}을(를) 1개 이상 입력한다.`)
    return null
  }
  return value
}
