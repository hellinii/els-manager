import { dec } from '@/lib/decimal'
import type {
  AssetInput,
  ManualPriceInput,
  ProductInput,
  RedemptionInput,
  ScheduleInput,
  TaxProfileInput,
  UnderlyingInput,
} from '@/lib/db/mutations/types'

import { path } from './fieldPath'
import { previewDatesOf } from './schedules'
import {
  SCHEDULE_SUBS,
  UNDERLYING_SUBS,
  countOf,
  roundCountOf,
  rowCountOf,
} from './steps'

/**
 * FormData → 계약 입력 — **순수**하다. `next`도 `react`도 모른다
 *
 * ## 왜 서버 액션 안에 두지 않는가
 *
 * 화면별 어댑터(`src/app/<route>/actions.ts`)는 `server.ts`를 끌어오므로 **어떤
 * 스위트의 import 그래프에도 들어갈 수 없다**(AQ-23). 파싱을 거기 두면 그만큼이
 * 영구 미검증으로 남는다. 어댑터에 남는 것은 「파서 호출 → 계약 호출 → 상태 변환」
 * 세 줄이고, 위험한 부분은 전부 여기 있다.
 *
 * ## 검증하지 않는다
 *
 * §6의 V-01~V-20은 계약 계층이 한다. 여기서 같은 검사를 하면 규칙이 두 곳에
 * 생기고, 두 곳이 갈리면 **어느 쪽이 정본인지 알 수 없다.** 여기서 하는 일은
 * `FormData`의 `string | File` 유니온을 계약의 입력 타입으로 좁히는 것뿐이며,
 * 빈 칸은 계약이 거부하도록 그대로 넘긴다 — 그래야 오류 문구가 한 곳에서 나온다.
 */

/** `FormData.get`은 `string | File | null`을 준다. 파일은 우리 폼에 없다. */
export function text(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

/** 빈 칸을 `undefined`로. 선택 필드는 "" 와 미입력을 구분해야 한다. */
export function optionalText(form: FormData, name: string): string | undefined {
  const value = text(form, name)
  return value === '' ? undefined : value
}

/**
 * 체크박스는 체크될 때만 전송된다. 부재가 곧 `false`다.
 *
 * **빈 문자열도 `false`다.** 부재만 보면 히든 이송(`carryNames`)이 값 없는 키를
 * 실었을 때 그것이 `true`가 된다 — 단계 폼에서 「체크를 풀었는데 다음 단계를
 * 지나 돌아오면 켜져 있다」가 되는 형태이며, 원인이 폼이 아니라 이송이라
 * 재현 조건을 찾기 어렵다.
 */
export function checkbox(form: FormData, name: string): boolean {
  return text(form, name) !== ''
}

/**
 * 퍼센트 입력 → 소수 비율 (CLAUDE.md 코딩 규약: "비율은 입력 계층에서 변환")
 *
 * 사용자는 배리어를 `90`으로 적고 DB는 `0.9`를 저장한다(DOC-002 M-04). 그 변환이
 * 화면마다 있으면 한 곳이 빠지고, **빠진 곳은 `barrier = 90`을 저장하려다 V-08
 * 상한(`x ≤ 2`)에 걸려 "배리어는 2 이하여야 한다"는 오류를 낸다** — 사용자가
 * 고칠 수 없는 문구다.
 *
 * **Decimal로 나눈다.** `Number(v) / 100`은 `88.5 → 0.885000000000000008`이 되는
 * 부류이고 그 값이 `numeric(6,4)`에 들어가면 반올림 방향이 입력에 따라 달라진다.
 * 4자리로 접는 것은 저장 정밀도와 같은 자리다.
 *
 * 빈 칸은 빈 칸으로 돌려준다 — 계약이 "필수 항목"이라고 말해야 하고, 여기서
 * `'0'`을 만들면 사용자가 적지 않은 값을 우리가 지어내는 것이 된다.
 */
export function percentToRatio(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '') return ''
  // 숫자로 읽을 수 없는 입력은 그대로 넘긴다 — 형식 오류의 문구는 계약이 낸다.
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
  return dec(trimmed).div(100).toDecimalPlaces(4).toFixed(4)
}

/**
 * 소수 비율 → 퍼센트 입력 — `percentToRatio`의 **역**이다 (P4 컷 5)
 *
 * 수정 모드가 이 방향을 요구한다. 계약은 비율을 소수 4자리로 주고(`ratioString`)
 * 폼의 모든 비율 칸은 퍼센트다(DOC-008 §5 SCR-204 v0.5) — 그 사이를 옮기지 않으면
 * 수정 화면이 `0.9`를 보여주고 사용자가 저장하는 순간 **배리어가 0.009가 된다.**
 * 값이 밀리는 부류의 결함이며 오류가 나지 않는다.
 *
 * **뒤따르는 0을 지운다.** `'0.9000'` → `'90'`이지 `'90.00'`이 아니다 —
 * 다시 `percentToRatio`를 지나면 같은 값이므로 왕복이 닫히고, 사용자가 적었을 형태와
 * 같다. `percent()`(표시용)와 다른 함수인 이유는 이쪽 결과가 **입력 칸의 값**이므로
 * `%` 기호가 붙으면 안 되기 때문이다.
 *
 * 형식이 아니면 원문을 그대로 돌려준다 — 계약이 준 값이 아닌 것이 오면 그것을
 * 화면에 보여야 사용자가 무엇이 저장되어 있는지 안다.
 */
export function ratioToPercent(ratio: string): string {
  const trimmed = ratio.trim()
  if (trimmed === '') return ''
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
  // Decimal로 곱한다 — `Number(v) * 100`은 `0.0885 → 8.850000000000001`이 되는
  // 부류이고 그 값이 다시 100으로 나뉘면 4자리에서 어긋난다(린트가 막는다).
  return dec(trimmed).times(100).toString()
}

/**
 * §5.7 수동 시세 입력 — SCR-302.
 *
 * `price`는 **변환하지 않는다.** 시세는 비율이 아니라 그 자산의 가격이고
 * (`numeric(18,6)`) 사용자가 적은 값이 그대로 저장 값이다.
 */
export function parseManualPriceForm(form: FormData): ManualPriceInput {
  return {
    assetId: text(form, 'assetId'),
    asOfDate: text(form, 'asOfDate'),
    price: text(form, 'price'),
  }
}

/**
 * 금액 입력 — **쉼표와 공백을 지운다.**
 *
 * DOC-005 §2가 금액 **표시**에 천단위 쉼표를 쓰므로 사용자는 `100,000,000`을
 * 그대로 적어 넣는다. 계약에 그대로 넘기면 `V-01`이 「정수로 입력한다」를 내는데,
 * 사용자에게는 자기가 적은 것이 정수이므로 고칠 방향이 보이지 않는다.
 *
 * **값을 바꾸지 않는다** — 쉼표 제거는 문자열 연산이고 float64를 경유하지 않는다.
 * 소수점은 남긴다(`base_price`는 `numeric(18,6)`이다).
 */
function amountText(form: FormData, name: string): string {
  return text(form, name).replace(/[,\s]/g, '')
}

/** 퍼센트로 적힌 선택 비율 — 빈 칸은 「없음」이며 `0`은 값이다(원금상환형 리자드) */
function optionalRatioText(form: FormData, name: string): string | undefined {
  const raw = optionalText(form, name)
  return raw == null ? undefined : percentToRatio(raw)
}

/**
 * §5.1·§5.2 상품 등록·수정 — SCR-204.
 *
 * ## 인덱스를 다시 붙이지 않는다
 *
 * 배열 행의 인덱스는 **폼의 `name`이 정본**이다(`underlyings[1].assetId`).
 * 빈 행을 걸러내며 번호를 다시 매기면 계약이 돌려주는 `fields` 키가 화면의 칸과
 * 어긋나고, 그러면 오류가 **다른 행에** 표시된다. 그것은 표시되지 않는 오류보다
 * 나쁘다 — 사용자가 채운 칸을 의심하게 된다. 빈 행은 그대로 넘겨 계약이 그 행을
 * 가리키게 하고, 행을 없애는 것은 삭제 버튼(`removeRow`)의 일이다.
 *
 * ## 차수 행 수는 `totalRounds`가 정한다
 *
 * 값 맵에는 지난 입력의 잔재가 남을 수 있다(총 차수를 6에서 3으로 줄이면
 * `schedules[3..5]`의 키가 남는다). 키에서 개수를 파생시키면 그 잔재가 되살아나
 * V-03이 「6건이 총 차수 3과 다르다」를 낸다 — 사용자가 지운 것을 우리가 되살린
 * 것이므로 원인이 화면에 없다. 그래서 **입력한 차수까지만** 읽는다.
 *
 * `MAX_ROUNDS`로 자르는 것은 렌더 상한과 같은 값이다. 조작된 `totalRounds`(V-20은
 * `smallint`까지 허용한다)에 대해 화면과 파서가 같은 수의 행을 보므로, 남는 차이는
 * V-03이 「N건이 총 차수 M과 다르다」로 설명한다.
 */
export function parseProductForm(form: FormData): ProductInput {
  // 화면과 같은 함수로 계수를 뽑는다 — 두 곳이 다른 수를 보면 V-03이 저장 시점에야
  // 그 어긋남을 말하고, 원인이 화면에 없다.
  const values = valuesOfForm(form)

  const underlyings: UnderlyingInput[] = []
  const rowCount = rowCountOf(values, 'underlyings')
  for (let index = 0; index < rowCount; index += 1) {
    underlyings.push({
      assetId: text(form, path('underlyings', index, UNDERLYING_SUBS[0])),
      basePrice: amountText(form, path('underlyings', index, UNDERLYING_SUBS[1])),
      // 순서는 입력이 아니라 행의 위치다 — 사용자가 정할 것이 없다.
      sequence: index + 1,
    })
  }

  const issueDate = text(form, 'issueDate')
  const evaluationPeriodMonths = countOf(values.evaluationPeriodMonths)
  const totalRounds = countOf(values.totalRounds)
  const rounds = roundCountOf(values)

  // 평가일은 생성값이다 — 화면의 미리보기와 **같은 함수**를 같은 값에 부른다.
  const dates = previewDatesOf(values)

  const schedules: ScheduleInput[] = []
  for (let index = 0; index < rounds; index += 1) {
    const at = (sub: (typeof SCHEDULE_SUBS)[number]): string =>
      path('schedules', index, sub)

    const lizardBarrier = optionalRatioText(form, at('lizardBarrier'))
    const schedule: ScheduleInput = {
      roundNo: index + 1,
      // 생성할 수 없으면 `''`이고 계약이 그 이유를 말한다(V-07). 화면은 그 전에
      // 「발행일·평가주기를 먼저 입력한다」를 표로 보여 준다.
      evaluationDate: dates[index] ?? '',
      barrier: percentToRatio(text(form, at('barrier'))),
    }

    /*
     * 리자드 조건은 **배리어가 정의한다.** 배리어가 없으면 나머지 둘을 보내지
     * 않는다 — DB에 그 조합을 막는 제약이 없으므로(I-10은 반대 방향만 본다)
     * 보내면 아무 판정도 읽지 않는 값이 저장된다. ④ 미리보기가 「리자드 없음」을
     * 보여주므로 이 누락은 사용자가 저장 전에 확인한다.
     */
    if (lizardBarrier != null) {
      schedule.lizardBarrier = lizardBarrier
      const couponRate = optionalRatioText(form, at('lizardCouponRate'))
      if (couponRate != null) schedule.lizardCouponRate = couponRate
      schedule.lizardRequiresNoKi = checkbox(form, at('lizardRequiresNoKi'))
    }

    schedules.push(schedule)
  }

  const input: ProductInput = {
    name: text(form, 'name'),
    issueDate,
    principal: amountText(form, 'principal'),
    evaluationPeriodMonths,
    totalRounds,
    annualCouponRate: percentToRatio(text(form, 'annualCouponRate')),
    accountType: text(form, 'accountType') as ProductInput['accountType'],
    underlyings,
    schedules,
  }

  const issuer = optionalText(form, 'issuer')
  if (issuer != null) input.issuer = issuer
  const kiBarrier = optionalRatioText(form, 'kiBarrier')
  if (kiBarrier != null) input.kiBarrier = kiBarrier
  const kiObservation = optionalText(form, 'kiObservation')
  if (kiObservation != null) {
    input.kiObservation = kiObservation as ProductInput['kiObservation']
  }
  const note = optionalText(form, 'note')
  if (note != null) input.note = note

  return input
}

/** 행 수 판정에만 쓰는 얕은 사본 — `rowCountOf`가 값 맵을 받는다 */
function valuesOfForm(form: FormData): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') values[key] = value
  }
  return values
}

/**
 * §5.4·§5.5 상환 처리·수정 — SCR-203·SCR-202 (P4 컷 6).
 *
 * ## 비율이 없다
 *
 * 상환 입력은 전부 금액·날짜·열거값이므로 `percentToRatio`가 지나지 않는다. 그것이
 * 이 폼이 상품 폼보다 단순한 실제 이유다(배열도 없다).
 *
 * ## `withholdingTax`가 비면 **보내지 않는다**
 *
 * 계약은 `undefined`일 때만 산출한다(§5.4). `''`를 보내면 `optionalAmount`가 그것을
 * `undefined`로 읽어 같은 결과가 되지만, **그 동일성이 계약 쪽 구현의 성질**이므로
 * 여기서 기대지 않는다 — 빈 칸과 미입력의 구분은 `optionalText`가 이미 한다.
 *
 * ## `roundNo`는 개수를 세는 정수다
 *
 * `countOf`를 쓰므로 형식이 아니면 `NaN`이고, 그 값은 V-20이 「정수로 입력한다」로
 * 거부한다 — 화면이 같은 판정을 하지 않는 이유는 `parse.ts` 머리글과 같다.
 * 만기 상환은 차수가 없으므로 **빈 값이 정상**이다(I-14는 조기·리자드만 요구한다).
 */
export function parseRedemptionForm(form: FormData): RedemptionInput {
  const input: RedemptionInput = {
    redemptionType: text(form, 'redemptionType') as RedemptionInput['redemptionType'],
    redemptionDate: text(form, 'redemptionDate'),
    grossAmount: amountText(form, 'grossAmount'),
    taxableIncome: amountText(form, 'taxableIncome'),
    isConfirmed: checkbox(form, 'isConfirmed'),
  }

  const roundNo = optionalText(form, 'roundNo')
  if (roundNo != null) input.roundNo = countOf(roundNo)

  const withholdingTax = optionalText(form, 'withholdingTax')
  if (withholdingTax != null) {
    input.withholdingTax = amountText(form, 'withholdingTax')
  }

  const note = optionalText(form, 'note')
  if (note != null) input.note = note

  return input
}

/**
 * §5.6 과세 프로필 저장 — SCR-401 (P4 컷 8).
 *
 * ## 이 폼만 「보이는 칸」이 다른 폼에 있다
 *
 * SCR-401은 조정(GET)과 저장(POST)을 두 폼으로 가르므로(DOC-008 §5 v0.9) 사용자가
 * 값을 적는 칸은 조정 폼에 있고 이 폼은 **적용된 값을 히든으로** 들고 온다. 그래서
 * 파서 입장에서는 다른 폼과 다를 것이 없다 — 이름이 같으면 히든이든 아니든 같다.
 *
 * `year`는 `countOf`로 읽으므로 형식이 아니면 `NaN`이고 V-20이 「정수로 입력한다」로
 * 거부한다. 화면이 같은 판정을 하지 않는 이유는 이 파일 머리글과 같다.
 */
export function parseTaxProfileForm(form: FormData): TaxProfileInput {
  return {
    year: countOf(text(form, 'year')),
    otherIncomeBase: amountText(form, 'otherIncomeBase'),
    otherFinancialIncome: amountText(form, 'otherFinancialIncome'),
    healthInsuranceType: text(
      form,
      'healthInsuranceType',
    ) as TaxProfileInput['healthInsuranceType'],
  }
}

/**
 * §5.9 KI 터치 확정 — SCR-202.
 *
 * **빈 칸이 `null`(해제)이다.** 계약의 두 번째 인자가 `string | null`이고 `null`이
 * 해제이므로, 빈 칸을 `''`로 넘기면 「YYYY-MM-DD 형식이 아니다」가 되어 **해제할
 * 방법이 없어진다.** 의도를 버튼이 나르는 대신 값의 부재로 표현하는 이유는 해제가
 * 「비우고 저장」이라는 한 동작이기 때문이다.
 */
export function parseTouchedAtForm(form: FormData): string | null {
  return optionalText(form, 'kiTouchedAt') ?? null
}

/**
 * §5.10 자산 등록 — SCR-302·SCR-204.
 *
 * `market`은 선택이며 **빈 칸을 `undefined`로** 보낸다. `''`를 보내면 V-19가
 * 길이 검사를 통과시키고 `UNIQUE(name, market)`가 `''`와 `null`을 다른 값으로
 * 취급해(인덱스는 `nulls not distinct`이므로 `null`끼리는 같다) 같은 자산이 두
 * 번 등록될 수 있다.
 *
 * `assetType`·`currency`는 좁히지 않고 문자열로 넘긴다 — 열거 검사는 V-19가
 * 하고(`requireEnum`), 여기서 캐스팅하면 조작된 값이 타입만 통과한다.
 */
export function parseAssetForm(form: FormData): AssetInput {
  return {
    name: text(form, 'name'),
    assetType: text(form, 'assetType') as AssetInput['assetType'],
    market: optionalText(form, 'market'),
    currency: text(form, 'currency').toUpperCase(),
  }
}
