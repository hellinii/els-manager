import { dec, type DecimalInput, type DecimalValue } from '@/lib/decimal'
import { evaluateCondition } from './condition'
import { asActive, type Active, type RedemptionMark } from './redemption'
import { dDay, isWeekendDate, overdueEvaluations } from './schedule'
import { worstOf } from './worstOf'

/**
 * 평가일 판정 — DOC-007 §3.6 (P6 컷 7)
 *
 * **가장 최근에 지난 차수 하나를 그 평가일의 종가로 판정한다.** 조건 판정(`evaluateCondition` — §3.2·§3.3)을
 * 다시 쓰지 않는다. 바뀌는 것은 입력 둘뿐이다 — 차수(다음 도래가 아니라 최근 경과)와 시세(최신이 아니라
 * 평가일 종가).
 *
 * ```
 * L = 가장 최근 경과 차수 (평가일 < asOf — 당일은 경과가 아니다, §9.2와 같은 경계)
 * L 없음                          → null
 * L = 마지막 차수                  → MATURITY_REACHED   시세 무관 · 등록일 컷 없음
 * L.평가일 < 등록일                → null               D3
 * 기초자산 하나라도 평가일 종가 없음 → CLOSE_MISSING      E-11
 * evaluateCondition(평가일 종가)   → EARLY · LIZARD → CONDITION_MET / CARRY_OVER → null (D2)
 * ```
 *
 * ## 최근 차수 하나뿐이다 (D4 — 민서 2026-10-11)
 *
 * 지난 차수를 처음부터 걷지 않는다. 판정은 하루 종가의 근사이고(리자드 경로 RD-07) 휴장일 · 주말로 저장된
 * 평가일에는 종가가 영영 없는데(RD-21), 「이월이었다」를 저장하지 않으므로(D2) 틀린 결과를 끌 수단이 없다.
 * 최근 차수만 보면 그 결과는 **다음 평가일이 지나면** 저절로 내려간다 — 틀려도 길어야 한 평가 주기다.
 *
 * ## 만기에는 등록일 컷이 없다
 *
 * 등록일 컷(D3)의 근거는 「보유중으로 등록했다면 그 전 차수는 이월된 것」이다. 마지막 차수에는 이월이 없으므로
 * 그 근거가 성립하지 않는다 — 만기가 지난 뒤 등록한 상품도 상환을 기록해야 한다. 시세도 보지 않는다 — 만기
 * 평가일이 지났다는 사실만으로 상품은 끝났다(이익 · 손실은 3일 평균이라 하루 종가로 가르지 않는다, RD-08).
 *
 * ## 저장하지 않는다 · 세금에 쓰지 않는다
 *
 * 파생값이다(DOC-002 M-02). 적용 차수(`attributionOf`)도 바꾸지 않는다 — 바꾸면 시세가 세금을 움직인다.
 */

/** 판정에 필요한 차수의 최소 형태. 행을 붙여 넘기면 결과의 `schedule`이 그 행이다(`nextEvaluation`과 같은 패턴) */
export type VerdictRound = {
  roundNo: number
  evaluationDate: string
  barrier: DecimalInput
  lizardBarrier?: DecimalInput | null
  lizardRequiresNoKi?: boolean | null
}

/**
 * 마지막 차수 — **최대 차수 번호**다. 행 수로 판정하지 않는다.
 *
 * DB는 차수 번호 `1, 2, 99`를 허용한다(V-04 연속성은 계약 계층에만 있다 — DOC-011 AQ-29). DOC-002는 만기일을
 * 「마지막 차수의 평가일」로 정의하므로 차수 번호를 정본으로 둔다. 상환 처리 화면의 `isFinalRound`와 같은 정의다.
 */
export function finalRoundOf<T extends { roundNo: number }>(schedules: readonly T[]): T | null {
  let final: T | null = null
  for (const schedule of schedules) {
    if (final === null || schedule.roundNo > final.roundNo) final = schedule
  }
  return final
}

/** 판정할 차수. `MATURITY`는 시세를 보지 않는다 — 로더가 그 차수의 종가를 요청하지 않는다 */
export type RoundToJudge<T> = { kind: 'MATURITY'; schedule: T } | { kind: 'JUDGE'; schedule: T }

/**
 * 판정할 차수를 고른다 — **로더(평가일 종가 쌍 선택)와 판정 함수가 함께 쓴다.**
 *
 * 같은 필터(경과 · 비만기 · 등록일 이후)를 두 곳에서 따로 구현하면 하나만 어긋나도 판정이 요청하지 않은
 * 날짜를 조회하게 되고, 그 결과는 오류가 아니라 조용한 「평가일 종가 없음」이다.
 *
 * 상환 레코드를 받는 이유는 `overdueEvaluations`와 같다 — 상환 완료면 `null`(E-05).
 */
export function roundToJudge<T extends { roundNo: number; evaluationDate: string }>(params: {
  schedules: readonly T[]
  /** 등록일 — `els_products.created_at`의 Asia/Seoul 날짜(`YYYY-MM-DD`). 변환은 `lib/db`가 한다 */
  registrationDate: string
  asOf: string
  redemption: RedemptionMark
}): RoundToJudge<T> | null {
  const overdue = overdueEvaluations({
    schedules: params.schedules,
    asOf: params.asOf,
    redemption: params.redemption,
  })
  // 평가일 오름차순(같은 날이면 차수 오름차순)이므로 마지막 원소가 가장 최근 경과 차수다
  const latest = overdue.at(-1)?.schedule
  if (latest === undefined) return null

  if (latest.roundNo === finalRoundOf(params.schedules)?.roundNo) {
    return { kind: 'MATURITY', schedule: latest }
  }

  // D3 — 등록일보다 앞선 평가일은 판정하지 않는다. 등록일 당일의 평가는 판정한다
  if (dDay({ from: params.registrationDate, evaluationDate: latest.evaluationDate }) < 0) {
    return null
  }

  return { kind: 'JUDGE', schedule: latest }
}

export type EvaluationVerdictParams<R extends VerdictRound> = {
  /** 전 차수(미래 포함) — 마지막 차수 판별에 쓴다 */
  schedules: readonly R[]
  /** 기초자산(sequence 순). 0건이면 `worstOf`가 거부한다(I-07) */
  underlyings: readonly { assetId: string; basePrice: DecimalInput }[]
  /** **정확한 날짜의** 종가. 없으면 `null` — 직전 종가로 대체하지 않는다(DQ-02) */
  closeOn: (assetId: string, date: string) => DecimalInput | null
  kiBarrier: DecimalInput | null
  /** KI 최초 터치일 */
  kiTouchedAt: string | null
  registrationDate: string
  asOf: string
}

export type EvaluationVerdict<R> =
  | {
      kind: 'CONDITION_MET'
      schedule: R
      result: 'EARLY' | 'LIZARD'
      /** 평가일 종가로 낸 W — 반올림하지 않은 값 */
      worstOf: DecimalValue
      /** EARLY면 B(n), LIZARD면 L(n) */
      barrier: DecimalValue
    }
  | { kind: 'MATURITY_REACHED'; schedule: R }
  | {
      kind: 'CLOSE_MISSING'
      schedule: R
      /** 평가일 종가가 없는 기초자산 — `underlyings` 순서 */
      missingAssetIds: string[]
      /** 평가일이 토 · 일 — 종가가 영영 오지 않으므로 할 일은 일정 수정이다 */
      weekend: boolean
    }

/**
 * KI 터치일이 평가일 «이후»면 그 차수의 판정에서는 터치가 아니다.
 *
 * `isKiNotTouched`는 날짜를 보지 않는다 — 다음 도래 차수(평가일 ≥ 기준일 ≥ 기록된 터치일)만 판정하던 때에는
 * 필요 없었다. 지난 차수를 판정하면 그 뒤에 일어난 터치가 이미 일어난 리자드를 부정한다(DOC-002 DQ-09 ⓑ).
 * 평가일 당일의 터치는 터치다.
 */
function kiTouchedBy(kiTouchedAt: string | null, evaluationDate: string): string | null {
  if (kiTouchedAt == null) return null
  return dDay({ from: evaluationDate, evaluationDate: kiTouchedAt }) <= 0 ? kiTouchedAt : null
}

/**
 * 평가일 판정. 물을 것이 없으면 `null`이다(경과 차수 없음 · 등록 전 · 이월).
 *
 * **입력은 `asActive`를 거친 값만 받는다**(E-05, §9.1) — 상환 완료 상품에는 물을 것이 없다.
 */
export function evaluationVerdictOf<R extends VerdictRound>(
  params: Active<EvaluationVerdictParams<R>>,
): EvaluationVerdict<R> | null {
  const target = roundToJudge({
    schedules: params.schedules,
    registrationDate: params.registrationDate,
    asOf: params.asOf,
    redemption: null,
  })
  if (target === null) return null

  const schedule = target.schedule
  if (target.kind === 'MATURITY') return { kind: 'MATURITY_REACHED', schedule }

  const date = schedule.evaluationDate
  const closes = params.underlyings.map((u) => ({ ...u, close: params.closeOn(u.assetId, date) }))

  const missingAssetIds = closes.filter((c) => c.close == null).map((c) => c.assetId)
  if (missingAssetIds.length > 0) {
    return { kind: 'CLOSE_MISSING', schedule, missingAssetIds, weekend: isWeekendDate(date) }
  }

  const w = worstOf(closes.map((c) => ({ basePrice: c.basePrice, currentPrice: c.close })))
  // 도달 불가 — 결측을 위에서 걸렀다. `worstOf`가 null을 내는 경우는 현재가 결측뿐이다
  if (w === null) return null

  // 바깥 입력이 `Active`로 보유중을 이미 증명했다 — 같은 상품의 판정 입력이다
  const result = evaluateCondition(
    asActive(
      {
        worstOf: w,
        barrier: schedule.barrier,
        lizardBarrier: schedule.lizardBarrier ?? null,
        lizardRequiresNoKi: schedule.lizardRequiresNoKi ?? null,
        kiBarrier: params.kiBarrier,
        kiTouchedAt: kiTouchedBy(params.kiTouchedAt, date),
      },
      null,
    ),
  )

  if (result === 'EARLY') {
    return { kind: 'CONDITION_MET', schedule, result, worstOf: w, barrier: dec(schedule.barrier) }
  }
  if (result === 'LIZARD' && schedule.lizardBarrier != null) {
    return { kind: 'CONDITION_MET', schedule, result, worstOf: w, barrier: dec(schedule.lizardBarrier) }
  }
  // CARRY_OVER — 묻지 않는다(D2). 확정이 아니라 질문 생략이다
  return null
}
