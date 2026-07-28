import { dec } from '@/lib/decimal'
import type { AssetInput, ManualPriceInput } from '@/lib/db/mutations/types'

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

/** 체크박스는 체크될 때만 전송된다. 부재가 곧 `false`다. */
export function checkbox(form: FormData, name: string): boolean {
  return form.get(name) != null
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
