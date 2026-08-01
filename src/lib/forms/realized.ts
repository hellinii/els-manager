import { dec } from '@/lib/decimal'

/**
 * SCR-205 기실현 등재의 폼 값 — **순수**하다 (DOC-008 §5 SCR-205 · DOC-011 §5.11)
 *
 * ## 왜 이 파일이 있는가
 *
 * 화면은 어떤 스위트의 import 그래프에도 없다(AQ-23). 「무엇이 칸이고 무엇이 파생인가」를
 * 마크업 안에 두면 그 판단을 시험할 층이 없고, 이 화면에서는 그 판단이 **세액에
 * 닿는다** — 아래 `attributionYearOf`가 그 자리다.
 *
 * ## 표시만 하는 값 셋 — 칸이 아니다
 *
 * | 값 | 산출 | 칸으로 두면 |
 * |---|---|---|
 * | 귀속연도 | `year(상환일)` | **상환일과 갈릴 수 있고 그때 세액이 조용히 틀린다** |
 * | 실현손익 | `실수령액 − 투자원금` | 두 입력과 어긋난 값이 저장될 수 있다 |
 * | 원천징수세액 | 비우면 계약이 산출 | 미리 채우면 그 산출이 영원히 실행되지 않는다 |
 *
 * 셋째는 **칸이 있고 비어 있는 것**이 정상이다(SCR-203과 같은 규약). 앞의 둘은
 * 칸 자체가 없다.
 *
 * 사용자의 스프레드시트에는 귀속연도가 **열로** 있으므로 이 결정이 눈에 보여야
 * 한다 — 화면이 그 값을 계산해 보여주는 것이 「받지 않는다」의 표현이다.
 */

/** 기실현 등재 폼의 칸. `toFormState`가 미매칭 오류를 가르는 기준이다 */
export const REALIZED_FIELDS = [
  'name',
  'issuer',
  'principal',
  'accountType',
  'redemptionType',
  'redemptionDate',
  'grossAmount',
  'taxableIncome',
  'withholdingTax',
  'isConfirmed',
  'note',
] as const

/**
 * 초기값 — **전부 비운다.**
 *
 * `redemptionDate`에 기준일을 넣지 않는 것이 SCR-203과 다른 점이다. 그 화면은
 * 「지금 상환을 처리한다」이므로 오늘이 그럴듯한 기본값이지만, 이 화면은 **과거
 * 이력을 옮긴다** — 오늘을 채워 두면 그 값이 그대로 저장될 수 있고 상환일은
 * 귀속연도를 결정한다(DOC-007 §7.2). 즉 틀린 기본값 하나가 그 해의 세액을 바꾼다.
 *
 * `accountType`도 비운다. 「일반」이 흔하지만 비과세 계좌를 일반으로 저장하면
 * 과세 금융소득이 0이어야 할 상품이 합산에 들어간다(DOC-007 §4.3).
 */
export function realizedDefaults(): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of REALIZED_FIELDS) values[field] = ''
  return values
}

/**
 * 귀속연도 — `year(상환일)`. DOC-007 §7.2의 상환 완료 분기와 **같은 규칙**이다.
 *
 * `lib/domain`의 `attributionYear`를 부르지 않는 이유는 그 함수가 형식 오류에
 * `RangeError`를 던지기 때문이다 — 여기는 **사용자가 타이핑하는 중**의 값을 받으므로
 * 절반만 적힌 날짜가 정상 입력이고, 그때 예외로 화면을 갈아치우면 입력이 사라진다.
 * 판정의 정본은 계약 계층이며 이것은 **표시**다.
 */
export function attributionYearOf(redemptionDate: string): number | null {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(redemptionDate.trim())
  if (match == null) return null
  // 연도는 **세는 값**이다(금액이 아니다) — `countOf`와 같은 규약으로 읽는다.
  return Number.parseInt(match[1]!, 10)
}

/**
 * 실현손익 — `실수령액 − 투자원금`. **음수가 정상이다**(DOC-005 §6 포트폴리오 손익).
 *
 * 두 칸 중 하나라도 숫자가 아니면 `null`이다. `0`으로 접으면 「손익이 0이다」와
 * 「아직 못 셌다」가 같은 화면이 된다.
 */
export function realizedPnlOf(
  grossAmount: string,
  principal: string,
): string | null {
  const gross = numeric(grossAmount)
  const invested = numeric(principal)
  if (gross == null || invested == null) return null
  return gross.minus(invested).toFixed(0)
}

/**
 * 폼 문자열 → 정수. **쉼표를 지운다** — `amountText`와 같은 규약이다.
 *
 * `dec()`가 `'0x1f'`를 31로, `'1e999'`를 유한값으로 읽으므로(DOC-011 §4.6의 실측)
 * 형식을 먼저 본다. 표시 계산이 저장 계층보다 넓은 값을 받으면 **화면이 저장할 수
 * 없는 숫자를 정상 결과로 렌더한다.**
 */
function numeric(raw: string): ReturnType<typeof dec> | null {
  const cleaned = raw.replace(/,/g, '').trim()
  if (!/^-?\d+$/.test(cleaned)) return null
  return dec(cleaned)
}
