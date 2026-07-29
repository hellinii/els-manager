import { dec, sum, ZERO, type DecimalInput, type DecimalValue } from '@/lib/decimal'

/**
 * 연도별 집계 — DOC-007 §7
 *
 * **집계 키는 항상 (소유자, 귀속연도)다.** 사용자 간 합산은 어떤 경우에도
 * 수행하지 않는다(D-02, CLAUDE.md 절대 규칙 #7).
 *
 * 집계는 평탄한 합산이 아니라 **키별 분할**로 정의한다(§7.1). 항목 배열만 받고
 * "호출부가 이미 필터링했다"고 가정하면 규칙이 주석으로만 존재한다. 키를 명시
 * 인자로 받으면 위반이 함수 경계에서 드러난다.
 */

/** (소유자, 귀속연도) — §7.1 집계 키 */
export type OwnerYearKey<Owner extends string = string, Year extends number = number> = {
  ownerId: Owner
  year: Year
}

/** 키에 귀속된 ELS 과세 금융소득 항목 */
export type TaxableIncomeItem<
  Owner extends string = string,
  Year extends number = number,
> = OwnerYearKey<Owner, Year> & {
  /** 계좌유형·손실 규칙이 이미 적용된 값 (`lib/domain/proceeds`의 `taxableIncome`) */
  taxableIncome: DecimalInput
}

/** 키에 귀속된 ELS 외 금융소득(이자·배당) — `tax_profiles.other_financial_income` */
export type OtherFinancialIncomeItem<
  Owner extends string = string,
  Year extends number = number,
> = OwnerYearKey<Owner, Year> & { amount: DecimalInput }

/**
 * 집계 결과. **키를 항상 동반한다.**
 *
 * 값만 반환하면 이후 단계에서 어느 소유자·연도의 값인지 알 수 없고, 두 사람의
 * 결과를 같은 변수에 담는 실수가 드러나지 않는다(§7.1).
 */
export type OwnerYearIncome<
  Owner extends string = string,
  Year extends number = number,
> = OwnerYearKey<Owner, Year> & {
  /** `F(owner, year)` */
  financialIncome: DecimalValue
}

function sameKey(a: OwnerYearKey, b: OwnerYearKey): boolean {
  return a.ownerId === b.ownerId && a.year === b.year
}

function keyOf(item: OwnerYearKey): string {
  return `${item.year}:${item.ownerId}`
}

/**
 * 단일 (소유자, 귀속연도)의 `F` — DOC-007 §7.3
 *
 * ```
 * F = Σ taxableIncome(els) + other_financial_income
 * ```
 *
 * 키와 다른 소유자·연도의 항목이 섞여 있으면 거부한다. 방어는 두 겹이다.
 *
 * 1. **타입 수준** — `items`의 키 타입이 `key`에서만 추론되므로(`NoInfer`),
 *    키가 컴파일 시점에 알려진 경우 다른 소유자의 항목은 컴파일되지 않는다.
 * 2. **런타임** — 운영에서 `ownerId`는 UUID 문자열이라 타입이 `string`으로
 *    넓어지고 1의 방어가 무력해진다. 같은 규칙을 실행 시점에 다시 검사한다.
 *
 * 두 방어는 대체 관계가 아니라 보완 관계다(§7.1).
 */
export function aggregateFinancialIncome<Owner extends string, Year extends number>(params: {
  key: OwnerYearKey<Owner, Year>
  items: readonly TaxableIncomeItem<NoInfer<Owner>, NoInfer<Year>>[]
  /** 해당 키의 ELS 외 금융소득 */
  otherFinancialIncome?: DecimalInput | null
}): OwnerYearIncome<Owner, Year> {
  const { key } = params

  for (const item of params.items) {
    if (!sameKey(item, key)) {
      throw new RangeError(
        `집계 키가 일치하지 않는다: 기대 (${key.ownerId}, ${key.year}), 입력 (${item.ownerId}, ${item.year}). ` +
          '사용자 간 금융소득을 합산할 수 없다(절대 규칙 #7).',
      )
    }
  }

  const elsTotal = sum(params.items.map((item) => dec(item.taxableIncome)))
  const other =
    params.otherFinancialIncome == null ? ZERO : dec(params.otherFinancialIncome)

  return {
    ownerId: key.ownerId,
    year: key.year,
    financialIncome: elsTotal.plus(other),
  }
}

/**
 * 여러 소유자·연도가 섞인 항목을 키별로 **분할하여** 집계한다 — DOC-007 §7.1
 *
 * 섞인 입력을 거부하지 않고 나누는 것이 이 함수의 역할이다. 합산이 키를 넘지
 * 않는 것은 구조적으로 보장되며, 호출부의 사전 필터링에 의존하지 않는다.
 *
 * ELS 항목이 없고 ELS 외 금융소득만 있는 키도 결과에 포함된다. 이자·배당만
 * 있는 연도에도 종합과세는 성립한다.
 *
 * 반환 순서는 `(귀속연도, 소유자)` 오름차순으로 고정한다. 입력 순서에 따라
 * 결과가 흔들리면 서버·클라이언트 재계산이 어긋난다(ADR-003).
 *
 * ## 다년도 전망은 이 함수를 쓰지 않는다 (§7.5, P4b)
 *
 * 이름으로는 맞아 보이지만 두 가지가 어긋난다.
 *
 * 1. **섞인 입력을 거부하지 않고 나눈다.** 그것이 이 함수의 역할이므로 분할은
 *    구조적으로 옳아지지만 **귀속연도 산출의 버그를 잡지 못한다.** 전망은
 *    `attributionYear`를 판정으로 얻으므로 그 오프바이원이 조용히 통과하면 안 되고,
 *    그래서 연도마다 `aggregateFinancialIncome`을 키와 함께 부른다(위 두 겹 방어).
 * 2. **항목 없는 연도의 행을 만들지 않는다.** 전망은 상환이 없는 해에도 잔여 원금과
 *    누적 행이 필요하므로 연도 목록이 항목이 아니라 **구간**에서 와야 한다.
 *
 * 즉 이 함수는 **§7.1의 `groupByOwnerYear`를 그대로 옮긴 것**이고 그 자리의 정본으로
 * 남는다(단위 시험이 그 성질을 고정한다). 프로덕션 호출부가 아직 없다.
 */
export function aggregateFinancialIncomeByOwnerYear(params: {
  items: readonly TaxableIncomeItem[]
  otherFinancialIncome?: readonly OtherFinancialIncomeItem[]
}): OwnerYearIncome[] {
  const buckets = new Map<string, OwnerYearIncome>()

  const bucketFor = (key: OwnerYearKey): OwnerYearIncome => {
    const id = keyOf(key)
    const existing = buckets.get(id)
    if (existing !== undefined) return existing

    const created: OwnerYearIncome = {
      ownerId: key.ownerId,
      year: key.year,
      financialIncome: ZERO,
    }
    buckets.set(id, created)
    return created
  }

  for (const item of params.items) {
    const bucket = bucketFor(item)
    bucket.financialIncome = bucket.financialIncome.plus(dec(item.taxableIncome))
  }

  for (const item of params.otherFinancialIncome ?? []) {
    const bucket = bucketFor(item)
    bucket.financialIncome = bucket.financialIncome.plus(dec(item.amount))
  }

  return [...buckets.values()].sort(
    (a, b) => a.year - b.year || (a.ownerId < b.ownerId ? -1 : a.ownerId > b.ownerId ? 1 : 0),
  )
}

/**
 * 세후 회수액 — DOC-007 §7.4
 *
 * ```
 * netProceeds = Σ gross(els) − F × effectiveRate(F, A)
 * ```
 *
 * 비과세 계좌 상품은 `taxableIncome = 0`이므로 `F`에 기여하지 않고 `gross`가
 * 전액 반영된다.
 *
 * 세 인자는 **같은 (소유자, 귀속연도)의 값이어야 한다.** `income`을 집계 결과
 * 타입으로 받아 키를 함께 전달받는다.
 *
 * 건강보험료는 차감하지 않는다. §7.4의 정의가 세액만 반영하며, DOC-011
 * `ForecastRow`도 `healthInsurance`를 별 항목으로 둔다.
 */
export function netProceeds(params: {
  income: OwnerYearIncome
  /** 해당 키의 세전 실수령액 합계 */
  grossTotal: DecimalInput
  /** §5.4의 최종 부담률 */
  effectiveRate: DecimalInput
}): DecimalValue {
  return dec(params.grossTotal).minus(
    params.income.financialIncome.times(dec(params.effectiveRate)),
  )
}
