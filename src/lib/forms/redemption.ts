import { amountString } from '@/lib/decimal'
import type { ProductDetailView, RedemptionView } from '@/lib/db/queries/map'
import { grossExpected, shiftDays, taxableIncome, type AccountType } from '@/lib/domain'

/**
 * SCR-203 상환 처리의 폼 값 — **순수**하다 (P4 컷 6, DOC-008 §5·DOC-011 §5.4·§5.5)
 *
 * ## 초기값이 이 파일의 이유다
 *
 * DOC-008은 「조건 판정 결과에 따라 유형·차수·예상 수령액을 자동 채움」을 요구한다.
 * 그 산출을 화면 안에 두면 어떤 스위트도 보지 못하고(AQ-23), 무엇보다 **자동 채움이
 * 틀리면 사용자가 그것을 확정값으로 저장한다** — 상환 실적은 세금 집계의 입력이므로
 * (§4.6) 틀린 기본값 하나가 그 해의 세액을 바꾼다.
 *
 * ## 채우는 것과 비우는 것을 나눈다
 *
 * | 칸 | 기본값 | 근거 |
 * |---|---|---|
 * | `roundNo`·`grossAmount`·`taxableIncome` | 적용 차수의 추정값 | 금액은 `roundFillOf`가 낸다(차수를 고쳤을 때와 같은 함수). 적용 차수가 없으면 비운다 |
 * | `redemptionType` | 판정이 **확정적일 때만**(`EARLY`·`LIZARD`) **그리고 적용 차수가 마지막이 아닐 때만** | `CARRY_OVER`는 「상환이 아니다」이므로 채우면 없는 판단을 지어낸다. 마지막 차수는 `isFinalRound`의 머리글 |
 * | `redemptionDate` | 기준일 | **적용 차수가 미래이므로 그 평가일을 넣으면 「아직 일어나지 않은 상환」이 기본값이 된다.** 계약이 미래 일자를 거부하지 않으므로(V-10은 발행일 이후만 본다) `max`도 두지 않는다 — 즉 막아 주는 층이 없다 |
 * | `withholdingTax` | **비운다** | 계약이 `taxableIncome × 분리과세율`로 산출한다(§5.4). 채우면 그 산출이 영원히 실행되지 않는다 |
 * | `isConfirmed` | 거짓 | 「증권사가 제공한 실제 값」이므로(DOC-005 §6) 기본 참이면 추정값이 확정값으로 저장된다(ST-05) |
 *
 * `note`는 비운다 — 안내 문구(§7 용어 대응)는 화면에 있고 값이 아니다.
 *
 * ## 그리고 첫 렌더가 끝이 아니다 (v2.7)
 *
 * 위 표는 **첫 렌더**이고, 사용자가 차수를 고치면 `roundFillOf`가 세 칸을 다시 낸다.
 * **적용 차수는 정의상 «다음 도래» 차수이므로**(DOC-007 RD-02) 평가가 일어난 뒤 기록하러
 * 온 사용자에게 폼은 이미 다음 차수를 가리킨다 — 차수를 옳게 고쳐도 금액이 따라오지
 * 않으면 「차수 2 / 1차의 금액」이 저장되고 그 행은 §4.6 집계의 입력이다.
 *
 * **그래서 두 경로가 «같은 함수»를 지난다.** `redemptionDefaults`도 `roundFillOf`로
 * 금액을 얻는다 — 따로 두면 판정이 `LIZARD`인 상품에서 첫 렌더는 조기상환 금액을,
 * 차수를 다시 고르면 리자드 금액을 내어 **「건드렸더니 금액이 바뀌었다」**가 된다.
 * (상환일만은 다르다 — 아래 `redemptionDefaults` 참조.)
 */

/** 상환 폼의 칸. `toFormState`가 미매칭 오류를 가르는 기준이다 */
export const REDEMPTION_FIELDS = [
  'redemptionType',
  'roundNo',
  'redemptionDate',
  'grossAmount',
  'taxableIncome',
  'withholdingTax',
  'isConfirmed',
  'note',
] as const

/**
 * 대상 상환 id — 수정·취소가 나른다.
 *
 * §5.5의 두 계약은 상품이 아니라 **상환 id**를 받는다(소유 판정은 부모 상품을
 * 경유한다). `PRODUCT_ID_FIELD`와 다른 이름인 이유가 그것이며, 무효화 맵이
 * 종전에 `/products/{id}`를 적을 수 없었던 이유와 같은 사실이다(컷 1b).
 */
export const REDEMPTION_ID_FIELD = 'redemptionId'

/**
 * 상환일 기본값의 기산 — 평가일 **+ 5일** (DOC-008 §5 v2.7)
 *
 * 평가일은 조건을 **판정**하는 날이고 지급은 그 뒤다. `EVALUATION_DATE_OFFSET_DAYS`(−1)와
 * 같은 부류의 전역 규약이며, 그쪽과 달리 **실측이 아니라 통상값**이다 — 그래서 화면이
 * 「연휴면 하루이틀 밀릴 수 있다」를 함께 말한다.
 *
 * **달력일이다.** 영업일 보정은 휴일 달력을 요구하고 이 저장소에 없다(ADR-003의 결정성도
 * 잃는다). 평가일 요일에 따라 주말에 떨어질 수 있고, 그것을 덮는 것이 위 안내 문구다.
 */
export const REDEMPTION_DATE_OFFSET_DAYS = 5

/**
 * 한 차수·한 가정의 금액 — **둘은 함께 있거나 함께 없다.**
 *
 * 독립 nullable로 흩으면 「실수령액은 있는데 과세소득만 없다」가 타입상 표현 가능해지는데
 * 그 조합은 실재하지 않는다. `ScheduleProceeds`(DOC-011 §4.4)와 같은 형태다.
 */
export type RoundAmounts = {
  /** 세전. DOC-007 §4.1 */
  grossAmount: string
  /** DOC-007 §4.3. `TAX_FREE`는 `'0'`이고 음수가 될 수 없다(절대 규칙 #8) */
  taxableIncome: string
}

/**
 * 차수 선택지 — 계약이 요구하는 것과 **그 차수를 고르면 채울 값**을 담는다.
 *
 * `hasLizard`가 필요한 이유는 V-14다: 리자드 상환은 **그 차수에 리자드 조건이
 * 정의되어 있어야** 한다. 화면이 그 사실을 보여주지 않으면 사용자가 조건 없는 차수에
 * 리자드를 붙이고, 오류 문구(「해당 차수에는 리자드 조건이 정의되어 있지 않다」)를
 * 받은 뒤에야 어느 차수를 골라야 하는지 알게 된다.
 *
 * **금액 둘이 여기 실리는 이유는 산출 지점을 하나로 두기 위해서다.** 화면이 계산하면
 * 첫 렌더(조회 계층)와 선택 이후(화면)가 **다른 산출**이 되고, 같은 차수에서 1원이라도
 * 갈리면 사용자는 「건드렸더니 금액이 바뀌었다」를 본다. 그리고 §4.1의 산식이 사본을
 * 하나 더 갖게 된다(AQ-67이 처리한 부류).
 */
export type RoundOption = {
  roundNo: number
  evaluationDate: string
  hasLizard: boolean
  /** 조기상환 가정 — DOC-007 §4.1의 `EARLY`. `null` = 연쿠폰율이 없다(기실현 등재, D-07) */
  early: RoundAmounts | null
  /** 리자드 가정. `null` = 그 차수에 리자드 쿠폰율이 없다 — V-14가 거부하는 조합이다 */
  lizard: RoundAmounts | null
}

/** 차수를 고르면 채울 세 칸 */
export type RoundFill = {
  roundNo: number
  /** 그 차수의 평가일 + `REDEMPTION_DATE_OFFSET_DAYS` */
  redemptionDate: string
  /** `null` = 이 유형의 금액은 계약 조건이 내지 않는다 (만기손실·리자드 미정의·쿠폰율 부재) */
  amounts: RoundAmounts | null
}

export function roundOptionsOf(view: ProductDetailView): RoundOption[] {
  const { principal, accountType, evaluationPeriodMonths } = view.product

  return view.schedules.map((schedule) => ({
    roundNo: schedule.roundNo,
    evaluationDate: schedule.evaluationDate,
    hasLizard: schedule.lizardBarrier != null,

    /*
     * **다시 계산하지 않고 조회가 낸 값을 그대로 쓴다.** 상세 화면의 차수별 표가
     * 같은 필드를 렌더하므로, 재계산은 「한 차수가 두 금액으로 보이는」 상태를
     * 만들 수 있는 자리를 하나 더 만든다. §4.1 산식의 사본을 늘리지 않는 것이기도
     * 하다(AQ-67이 처리한 부류).
     *
     * ★ **이 선택을 강제하는 스위트가 없다(실측).** `grossExpected`를 다시 부르는
     * 구현으로 바꿔도 `tests/app/redemption.test.ts` 40건이 전부 초록이다 — 같은
     * 입력에 같은 `amountString`을 지나므로 오늘은 값이 같기 때문이다. 즉 근거는
     * 이 주석이고, 「값이 일치한다」 케이스를 재사용의 증거로 읽으면 안 된다.
     */
    early: amountsOf(schedule.expectedGross, principal, accountType),

    /*
     * 리자드는 조회 계층에 없다 — §4.3의 차수별 값이 `EARLY` 가정 하나뿐이기 때문이다.
     *
     * **`applicableCouponRate`를 부르지 않는다.** 그 함수의 유일한 판단이 「리자드
     * 쿠폰율이 없으면 던진다」인데(§4.1 Q-04) 여기서 옳은 답은 **「없으면 채우지
     * 않는다」**다. 던지게 두면 폼 계층에 도메인 예외를 삼키는 `try/catch`가 생기고,
     * `onChange` 안에서 던지면 오류 경계로도 가지 않아 **화면이 조용히 멈춘다.**
     * 대신 `grossExpected`에 그 차수의 쿠폰율을 직접 주입한다 — §4.1이 「리자드 상환을
     * 가정하는 경우 `couponRate`에 그 차수의 값을 주입한다」고 규정한 형태 그대로이고,
     * `!= null` 가드 안에서만 부르므로 던지는 분기가 **도달 불가**다.
     *
     * `expectedGross == null`을 함께 보는 이유: 그 `null`의 뜻은 「계약 조건이 없다」이고
     * (`expectedGrossOf`) 그 상품에서는 리자드 금액도 의미가 없다.
     */
    lizard:
      schedule.expectedGross == null || schedule.lizardCouponRate == null
        ? null
        : amountsOf(
            amountString(
              grossExpected({
                principal,
                couponRate: schedule.lizardCouponRate,
                evaluationPeriodMonths,
                roundNo: schedule.roundNo,
              }),
            ),
            principal,
            accountType,
          ),
  }))
}

/**
 * 세전 → `{세전, 과세 금융소득}`.
 *
 * **빼기를 여기 적지 않는다.** `TAX_FREE` → 0과 `max(0, ·)`는 `taxableIncome`의 것이며
 * (절대 규칙 #8) 여기서 다시 적으면 §4.3이 사본을 갖는다.
 */
function amountsOf(
  gross: string | null,
  principal: string,
  accountType: AccountType,
): RoundAmounts | null {
  if (gross == null) return null
  return {
    grossAmount: gross,
    taxableIncome: amountString(
      taxableIncome({
        accountType,
        principal,
        // 이 축 전체가 「예상」이다 — 상환 확정값을 섞지 않는다(§4.5와 같은 규약)
        redemption: null,
        expectedGross: gross,
      }),
    ),
  }
}

/**
 * 차수를 고르면 채울 값 — 두 인자 모두 `<select>`의 **원문 문자열**이다.
 *
 * 빈 값·형식 아님·없는 차수는 전부 `null`이고 **던지지 않는다.** 화면은 조작 중의
 * 값을 넘기므로 예외를 내면 폼이 사라진다(`realized.ts`의 `attributionYearOf`와 같은
 * 규약이며, 그쪽은 「타이핑 중」이고 이쪽은 「없음이 정상값」이라는 점만 다르다).
 *
 * 빈 차수는 **만기 상환의 정상값**이다(V-13 — 조기·리자드만 차수가 필수다). 그때
 * `null`을 내는 것이 「채움이 풀린다」의 표현이다.
 */
export function roundFillOf(
  rounds: readonly RoundOption[],
  roundNo: string,
  redemptionType: string,
): RoundFill | null {
  const wanted = roundNo.trim()
  if (wanted === '') return null

  // 강제 변환을 쓰지 않는다(`els/form-values`) — 비교를 문자열 쪽으로 넘긴다.
  const round = rounds.find((option) => String(option.roundNo) === wanted)
  if (round == null) return null

  return {
    roundNo: round.roundNo,
    redemptionDate: shiftDays(round.evaluationDate, REDEMPTION_DATE_OFFSET_DAYS),
    amounts: assumedAmountsOf(round, redemptionType),
  }
}

/**
 * 어느 «가정»의 금액인가 — DOC-007 §4.1을 실적 축(`redemptionType`)으로 옮긴다.
 *
 * 판정 축은 셋(`EARLY`·`LIZARD`·`CARRY_OVER`)이고 실적 축은 넷이므로 대응이 항등이
 * 아니다. 그 차이를 흡수하는 자리가 이 파일이라는 것은 `isFinalRound`가 이미 세운 규약이다.
 *
 * | 유형 | 쿠폰율 |
 * |---|---|
 * | `EARLY`·`MATURITY_GAIN`·(비어 있음) | 연쿠폰율. 만기이익은 산식이 조기상환과 **같다** |
 * | `LIZARD` | 그 차수의 리자드 쿠폰율 |
 * | `MATURITY_LOSS` | **없다** |
 *
 * **만기손실을 채우지 않는 이유**는 마지막 차수에서 상환 유형을 비우는 것과 같다:
 * 실제 수령액이 `P × W`이므로 **시세가 정하고 화면이 알 수 없다.** 그리고 `r ≥ 0`이라
 * 예상 수령액은 언제나 `≥ P`이므로 손실 상환에 채우는 것은 **항상 틀린 방향**이다.
 *
 * 유형이 비어 있으면 `EARLY`를 가정한다 — 조회 계층의 차수별 값과 같은 가정이다(§4.3).
 */
function assumedAmountsOf(
  round: RoundOption,
  redemptionType: string,
): RoundAmounts | null {
  if (redemptionType === 'MATURITY_LOSS') return null
  if (redemptionType === 'LIZARD') return round.lizard
  return round.early
}

/** 판정이 상환 유형을 확정하는 두 경우. `CARRY_OVER`·`null`은 채우지 않는다 */
const DECISIVE: Record<string, string> = { EARLY: 'EARLY', LIZARD: 'LIZARD' }

/**
 * 마지막 차수인가 — **행 수(`totalRounds`)로 판정하지 않는다**
 *
 * `product.totalRounds`는 `schedules.length`이고(DQ-05가 정본을 행 수로 정했다)
 * DB는 차수 번호 `1, 2, 99`를 허용한다 — V-04(연속성)는 **계약 계층에만** 있고
 * 쓰기 함수는 보지 않는다(DOC-011 AQ-29). 그 상품에서 `totalRounds`는 3이므로
 * `appliedRoundNo === totalRounds`로 판정하면 **99차(실제 마지막)를 마지막이 아니라고
 * 답한다** — 아래 가드가 통째로 새는 형태다. 최대 차수와 비교한다.
 *
 * 차수가 아니라 평가일로 판정할 수도 있으나(V-07이 둘의 순서를 일치시킨다) DOC-002는
 * 만기일을 「**마지막 차수** 평가일」로 정의하므로 차수를 정본으로 둔다. 두 값이
 * 갈리는 상품은 계약을 우회해 만들어진 것이며 그때도 이 판정은 문서의 정의를 따른다.
 */
function isFinalRound(roundNo: number, schedules: readonly { roundNo: number }[]): boolean {
  // 도달 불가 가드 — 호출부가 `round != null`일 때만 부르고 그 `round`는
  // `view.schedules.find(...)`의 결과이므로 배열이 비어 있으면 `round`가 `null`이다.
  // `Math.max()`가 `-Infinity`를 내는 것을 막는 값싼 방어로 남긴다.
  if (schedules.length === 0) return false
  // 스프레드의 인자 수 상한이 문제되지 않는다. **`MAX_ROUNDS`(=60)가 근거가 아니다** —
  // 그것은 폼 계층의 렌더·미리보기 상한일 뿐이고 계약도 조회도 `schedules.length`를
  // 묶지 않는다(V-03은 `totalRounds`와의 일치만 보고 `max`가 없으며, 임베드 배열이라
  // Q-06의 행 상한도 세지 않는다). 실제 상한은 **스키마**가 준다: `round_no`가
  // `smallint`이고 `unique (els_id, round_no)`이므로 상품당 최대 32,767차다 —
  // 실측으로 그 수의 스프레드가 정상이고 파열점(약 20만)의 1/6이다.
  return roundNo === Math.max(...schedules.map((s) => s.roundNo))
}

/**
 * §5.4 상환 처리의 기본값 — 조건 판정에서 나온다.
 *
 * `asOf`를 인자로 받는다 — 화면이 `new Date()`를 부르면 요청당 한 번이라는 규약이
 * 깨진다(Q-02). `getAsOf()`가 계약과 같은 값을 준다.
 */
export function redemptionDefaults(
  view: ProductDetailView,
  asOf: string,
): Record<string, string> {
  const applied = view.projection
  const round =
    applied == null
      ? null
      : (view.schedules.find((s) => s.roundNo === applied.appliedRoundNo) ?? null)

  /*
   * ★ **마지막 차수에서는 유형을 비운다** (P4.5, DOC-008 §5 SCR-203의 별 각주).
   *
   * 두 축의 값 집합이 다르다 — 판정 축 `conditionResult`는 셋(`EARLY`·`LIZARD`·
   * `CARRY_OVER`)이고 실적 축 `redemptionType`은 **넷**이다(+ `MATURITY_GAIN`·
   * `MATURITY_LOSS`). DOC-005 §2는 두 축이 같은 코드 값을 갖는 것이 의도라고 적지만
   * **값 집합이 같다고는 적지 않는다.** v0.7의 이 줄은 그 차이를 보지 않고 확정 판정
   * 둘을 항등으로 옮겼다.
   *
   * `evaluateCondition`(DOC-007 §3.2)은 차수가 마지막인지 보지 않으므로 마지막 차수에서
   * `W ≥ B(n)`이면 `EARLY`를 낸다. DOC-005는 `EARLY`를 「만기 **전** 평가일에」로
   * 정의하므로 그 상환은 정의상 `MATURITY_GAIN`이고, 기본값을 그대로 저장하면
   * **만기상환이 조기상환으로 기록된다** — 그 기록은 §4.6 집계의 입력이다.
   *
   * **채우지 않고 비운다.** 마지막 차수에서 `MATURITY_GAIN`·`MATURITY_LOSS`를 가르는
   * 것은 손익 판정이므로 실수령액을 알아야 하고, 그 값은 사용자가 입력할 칸에 있다 —
   * 화면이 미리 알 수 없으므로 비우는 것이 차선이 아니라 정확한 답이다.
   *
   * **판정 축은 건드리지 않는다.** 만기 개념을 `evaluateCondition`에 넣는 것은
   * DOC-007의 변경이고 TC-01~22가 정본이다(절대 규칙 #1). 두 축의 차이를 실적 축으로
   * 옮기는 이 자리에서 흡수한다.
   */
  const finalRound = round != null && isFinalRound(round.roundNo, view.schedules)

  // 판정이 확정적일 때만, 그리고 마지막 차수가 아닐 때만 채운다 —
  // 없는 판단을 지어내지 않는다.
  const redemptionType = finalRound ? '' : (DECISIVE[round?.conditionResult ?? ''] ?? '')
  const roundNo = applied == null ? '' : String(applied.appliedRoundNo)

  /*
   * ★ **금액은 `roundFillOf`가 낸다 — 차수를 고쳤을 때와 «같은 함수»다** (v2.7).
   *
   * 종전에는 `projection.expectedGross`·`expectedTaxableIncome`을 직접 읽었다. 값은
   * 대개 같지만 **판정이 `LIZARD`인 상품에서 갈린다**: `projection`은 §4.1의 `EARLY`
   * 가정 위에 있으므로 조기상환 금액(과대)을 채우는데, 같은 폼에서 차수를 다시 고르면
   * 리자드 쿠폰율 기준 금액이 나온다. 즉 **아무것도 바꾸지 않고 차수를 되돌리기만 해도
   * 금액이 변한다** — 사용자에게는 「건드렸더니 바뀌었다」이고, 둘 중 하나는 틀린 값이다.
   *
   * `projection`과 어긋나지 않는다: 적용 차수의 `early`는 `schedules[].expectedGross`를
   * 그대로 쓰고, 과세소득은 `principal`이 정수라 `round(g) − P = round(g − P)`이므로
   * `projectionOf`(반올림 전에 뺀다)와 **글자까지 같다.** 파생 테스트가 그것을 고정한다.
   */
  const fill = roundFillOf(roundOptionsOf(view), roundNo, redemptionType)

  return {
    redemptionType,
    roundNo,
    /*
     * ★ **상환일만은 «차수에서 파생하지 않는다».** `fill.redemptionDate`를 쓰지 않는 것이
     * 의도다 — 적용 차수는 정의상 **다음 도래** 차수이므로(RD-02) 그 평가일을 넣으면
     * 첫 렌더의 기본값이 **미래 날짜**가 된다. V-10은 그것을 거부하지 않고(발행일
     * 이후만 본다) 귀속연도는 상환일이 정하므로, 사용자가 고치지 않으면 「아직 일어나지
     * 않은 상환」이 그 해의 금융소득에 들어간다. 차수를 **고르는 순간**에는 그것이
     * 사용자의 의사이므로 그때 평가일 + 5일로 바뀐다(DOC-008 §5 v2.7).
     */
    redemptionDate: asOf,
    grossAmount: fill?.amounts?.grossAmount ?? '',
    taxableIncome: fill?.amounts?.taxableIncome ?? '',
    // 비운다 — 계약이 산출한다(§5.4). 채우면 그 산출이 영원히 실행되지 않는다.
    withholdingTax: '',
    isConfirmed: '',
    note: '',
  }
}

/**
 * §5.5 상환 수정의 초기값 — **저장된 값이다. 추정이 아니다.**
 *
 * `updateRedemption`도 전체 교체이므로(모든 열을 실어 보낸다) 여기서 한 칸을
 * 빠뜨리면 수정이 그 값을 지운다 — `productValuesOf`와 같은 위험이며 같은 방식으로
 * 파생 테스트가 잡는다(`REDEMPTION_FIELDS` 전수).
 *
 * **`withholdingTax`는 저장된 값을 그대로 보여준다.** 비우면 재산출되는데, 사용자가
 * 「비고만 고치려던」 수정에서 증권사가 확정한 징수액이 우리 산출값으로 바뀐다 —
 * A-04를 뒤집는 조용한 변경이다.
 */
export function redemptionValuesOf(redemption: RedemptionView): Record<string, string> {
  return {
    redemptionType: redemption.redemptionType,
    roundNo: redemption.roundNo == null ? '' : String(redemption.roundNo),
    redemptionDate: redemption.redemptionDate,
    grossAmount: redemption.grossAmount,
    taxableIncome: redemption.taxableIncome,
    withholdingTax: redemption.withholdingTax ?? '',
    isConfirmed: redemption.isConfirmed ? 'on' : '',
    note: redemption.note ?? '',
  }
}

/**
 * 만기손실은 과세 금융소득이 **0으로 고정**된다 — DOC-008 §5, V-12, 절대 규칙 #8.
 *
 * 화면이 그 칸을 읽기 전용으로 만드는 판단이 여기 있다. 컴포넌트에 두면 「어느
 * 유형이 고정인가」가 마크업 안의 문자열 비교가 되고, 유형이 늘면 한쪽만 고쳐진다.
 */
export function taxableIncomeLocked(redemptionType: string): boolean {
  return redemptionType === 'MATURITY_LOSS'
}
