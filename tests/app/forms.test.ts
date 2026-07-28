import { describe, expect, it } from 'vitest'

import { percent } from '@/lib/format'
import { parseFieldPath, path, splitFieldErrors } from '@/lib/forms/fieldPath'
import {
  checkbox,
  optionalText,
  parseAssetForm,
  parseManualPriceForm,
  parseTaxProfileForm,
  percentToRatio,
  text,
} from '@/lib/forms/parse'
import { initialFormState, toFormState, valuesOf } from '@/lib/forms/state'
import { assetDefaults, manualPriceDefaults } from '@/lib/forms/defaults'

/**
 * FormData ↔ 계약 입력 — DOC-011 §3.1 `fields` · §6 V-08
 *
 * `FormData`는 Node 20 전역이므로 node 환경에서 그대로 돈다(새 의존성 0).
 *
 * ## 여기서 검증하는 것이 어댑터에 남지 않는 이유
 *
 * 화면별 `actions.ts`는 `server.ts`를 끌어오므로 **어떤 스위트의 import 그래프에도
 * 들어갈 수 없다**(AQ-23). 파싱·상태 변환을 순수 모듈로 뺀 목적이 그것이며,
 * 이 파일이 그 목적의 회수 지점이다.
 */

function formData(entries: Record<string, string>): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(entries)) form.append(key, value)
  return form
}

describe('필드 경로 — 생성기와 파서가 한 문법을 공유한다', () => {
  it('배열 원소의 경로', () => {
    expect(path('underlyings', 1, 'assetId')).toBe('underlyings[1].assetId')
    expect(path('schedules', 0, 'lizardBarrier')).toBe('schedules[0].lizardBarrier')
    expect(path('principal')).toBe('principal')
    expect(path('underlyings', 2)).toBe('underlyings[2]')
  })

  it('왕복한다 — 생성한 것을 되읽는다', () => {
    /*
     * 두 곳에서 각자 조립하면 한쪽이 `underlyings.1.assetId` 같은 형태를 쓰는
     * 날이 온다. 그러면 `fieldErrors[name]` 조회가 빗나가고 **오류가 표시되지
     * 않는다** — 표시되지 않는 오류는 "저장이 안 되는데 아무 말도 없다"다.
     */
    for (const [field, index, sub] of [
      ['underlyings', 1, 'assetId'],
      ['schedules', 11, 'evaluationDate'],
      ['name', undefined, undefined],
      ['underlyings', 0, undefined],
    ] as Array<[string, number | undefined, string | undefined]>) {
      const generated = path(field, index, sub)
      expect(parseFieldPath(generated), generated).toEqual({
        field,
        index: index ?? null,
        sub: sub ?? null,
      })
    }
  })

  it('우리 문법이 아닌 키는 null이다 — 버리라는 뜻이 아니다', () => {
    expect(parseFieldPath('underlyings.1.assetId')).toBeNull()
    expect(parseFieldPath('')).toBeNull()
    expect(parseFieldPath('1abc')).toBeNull()
  })

  it('폼에 없는 키를 골라낸다 — 사라진 인덱스', () => {
    // 사용자가 행을 지우고 재제출하면 서버가 없는 인덱스를 가리킬 수 있다.
    const { matched, unmatched } = splitFieldErrors(
      {
        'underlyings[0].assetId': '필수',
        'underlyings[3].assetId': '필수',
        principal: '0보다 커야 한다',
      },
      ['underlyings[0].assetId', 'principal'],
    )
    expect(Object.keys(matched).sort()).toEqual(['principal', 'underlyings[0].assetId'])
    expect(unmatched).toEqual([
      { key: 'underlyings[3].assetId', message: '필수' },
    ])
  })

  it('fields가 없으면 둘 다 빈 값이다', () => {
    expect(splitFieldErrors(undefined, ['name'])).toEqual({ matched: {}, unmatched: [] })
  })
})

describe('FormData 좁히기', () => {
  it('공백을 다듬고 미입력을 구분한다', () => {
    const form = formData({ name: '  삼성전자  ', market: '  ', note: '' })
    expect(text(form, 'name')).toBe('삼성전자')
    expect(text(form, 'absent')).toBe('')
    expect(optionalText(form, 'market')).toBeUndefined()
    expect(optionalText(form, 'name')).toBe('삼성전자')
  })

  it('체크박스는 부재가 false다', () => {
    expect(checkbox(formData({ isConfirmed: 'on' }), 'isConfirmed')).toBe(true)
    expect(checkbox(formData({}), 'isConfirmed')).toBe(false)
  })
})

describe('비율 정규화 — V-08 · DOC-002 M-04', () => {
  it('퍼센트 입력을 소수로 옮긴다', () => {
    expect(percentToRatio('90')).toBe('0.9000')
    expect(percentToRatio('85')).toBe('0.8500')
    expect(percentToRatio('100')).toBe('1.0000')
    expect(percentToRatio('5')).toBe('0.0500')
  })

  it('V-08 경계 — 200%가 상한 2다', () => {
    /*
     * 변환이 빠진 화면은 `barrier = 90`을 저장하려다 상한(`x ≤ 2`)에 걸려
     * "배리어는 2 이하여야 한다"는 오류를 낸다 — 사용자가 고칠 수 없는 문구다.
     * 경계값이 정확히 상한에 닿는지 본다.
     */
    expect(percentToRatio('200')).toBe('2.0000')
    expect(percentToRatio('200.01')).toBe('2.0001') // 계약이 거부해야 한다
  })

  it('float64를 경유하지 않는다 — 반올림 경계에서 갈린다', () => {
    /*
     * **이 케이스를 찾는 데 실측이 필요했다.** 처음에는 `'88.5'`·`'12.35'`로
     * 단언했는데, `(Number('88.5')/100).toFixed(4)`도 `'0.8850'`을 준다 —
     * `toFixed`가 오차를 접어 버려서 **float 구현으로도 통과하는 항진명제**였다.
     *
     * 갈리는 조건은 정확한 값이 5로 끝나는 5자리 소수일 때다: 예컨대 `0.015%`는
     * 정확히 `0.00015`이고 HALF_UP은 `0.0002`로 올리는데, float 나눗셈은
     * `0.00015`보다 **작은** 값을 주어 `0.0001`로 내려간다. 아래 넷은 Decimal
     * 경로에서만 통과한다(200,000개를 훑어 갈리는 입력을 찾았다).
     */
    expect(percentToRatio('0.015')).toBe('0.0002')
    expect(percentToRatio('0.045')).toBe('0.0005')
    expect(percentToRatio('0.095')).toBe('0.0010')
    expect(percentToRatio('0.155')).toBe('0.0016')
  })

  it('표시 포매터와 왕복한다', () => {
    // 입력 계층과 표시 계층이 서로의 역이어야 한다 — 아니면 사용자가 저장한 뒤
    // 다른 숫자를 본다.
    for (const input of ['90', '85.5', '100', '5', '12.35']) {
      expect(percent(percentToRatio(input))).toBe(`${input}%`)
    }
  })

  it('빈 칸과 형식 오류는 그대로 넘긴다 — 문구는 계약이 낸다', () => {
    expect(percentToRatio('')).toBe('')
    expect(percentToRatio('  ')).toBe('')
    // `'0'`을 지어내면 사용자가 적지 않은 값을 우리가 만든 것이 된다.
    expect(percentToRatio('구십')).toBe('구십')
    expect(percentToRatio('90%')).toBe('90%')
  })
})

describe('§5.7 수동 시세 입력 폼', () => {
  it('세 필드를 그대로 좁힌다', () => {
    expect(
      parseManualPriceForm(
        formData({
          assetId: 'e2f1c7a4-0000-4000-8000-000000000000',
          asOfDate: '2026-07-28',
          price: ' 70000.5 ',
        }),
      ),
    ).toEqual({
      assetId: 'e2f1c7a4-0000-4000-8000-000000000000',
      asOfDate: '2026-07-28',
      price: '70000.5',
    })
  })

  it('시세는 비율이 아니므로 변환하지 않는다', () => {
    // 100으로 나누면 `70000`이 `700`이 된다. 자산의 가격은 그 자산의 단위다.
    expect(parseManualPriceForm(formData({ price: '70000' })).price).toBe('70000')
  })

  it('기본값의 날짜가 기준일이다 — V-17', () => {
    // 계약이 `asOfDate ≤ 기준일`을 요구하므로 기본값과 `max`가 같은 값이어야 한다.
    expect(manualPriceDefaults('2026-07-28').asOfDate).toBe('2026-07-28')
  })
})

describe('§5.10 자산 등록 폼', () => {
  it('통화를 대문자로 올린다 — V-19', () => {
    // `char(3)` 대문자 3자. 소문자를 그대로 보내면 계약이 거부하는데 사용자는
    // 왜인지 모른다(`'krw'`도 3자다).
    expect(parseAssetForm(formData({ currency: 'krw' })).currency).toBe('KRW')
  })

  it('시장 미입력은 undefined다 — nulls not distinct', () => {
    /*
     * `''`를 보내면 `UNIQUE(name, market)`가 `''`와 `null`을 다른 값으로 취급해
     * (인덱스는 `nulls not distinct`이므로 `null`끼리만 같다) 같은 자산이 두 번
     * 등록될 수 있다.
     */
    expect(parseAssetForm(formData({ name: '코스피200', market: '' })).market)
      .toBeUndefined()
    expect(parseAssetForm(formData({ market: 'KRX' })).market).toBe('KRX')
  })

  it('열거값을 캐스팅으로 검증하지 않는다', () => {
    // 조작된 값이 타입만 통과해 계약에 닿아야 한다 — 열거 검사는 V-19가 한다.
    expect(parseAssetForm(formData({ assetType: 'BOND' })).assetType).toBe('BOND')
  })

  it('자산 유형에는 기본값이 없다', () => {
    // 「지수」를 「종목」으로 등록하는 실수가 조용히 통과하지 않게 한다.
    expect(assetDefaults().assetType).toBe('')
    expect(assetDefaults().currency).toBe('KRW')
  })
})

describe('ActionResult → FormState', () => {
  const NAMES = ['name', 'currency'] as const

  it('초기 상태는 오류도 성공도 아니다', () => {
    const state = initialFormState({ currency: 'KRW' })
    expect(state.status).toBe('INITIAL')
    expect(state.code).toBeNull()
    expect(state.values.currency).toBe('KRW')
  })

  it('성공은 코드가 없고 입력값을 유지한다', () => {
    const state = toFormState({ ok: true, data: { id: 'x' } }, { name: '코스피200' }, NAMES, '저장했다')
    expect(state.status).toBe('OK')
    expect(state.code).toBeNull()
    expect(state.message).toBe('저장했다')
    expect(state.values.name).toBe('코스피200')
  })

  it('실패는 코드를 보존한다 — 문자열 비교로 분기하지 않게', () => {
    /*
     * §3.2의 화면 처리가 코드마다 다르고 `PROVIDER_UNAVAILABLE`은 **오류가
     * 아니다**(ST-03 폴백). 코드를 버리면 그 판단을 문구로 하게 된다.
     */
    const state = toFormState(
      {
        ok: false,
        error: { code: 'PROVIDER_UNAVAILABLE', message: '공급자가 없다.' },
      },
      {},
      NAMES,
    )
    expect(state.status).toBe('ERROR')
    expect(state.code).toBe('PROVIDER_UNAVAILABLE')
  })

  it('필드 오류를 칸과 상단으로 가른다', () => {
    const state = toFormState(
      {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: '입력을 확인한다.',
          fields: { name: '필수', 'underlyings[9].assetId': '필수' },
        },
      },
      { name: '' },
      NAMES,
    )
    expect(state.fieldErrors).toEqual({ name: '필수' })
    expect(state.unmatched).toEqual([{ key: 'underlyings[9].assetId', message: '필수' }])
  })

  it('입력값 보존 — 실패해도 values가 남는다', () => {
    // W-03이 미인증에서 던지지 않는 이유가 이것이다. 여기서 잃으면 무의미해진다.
    const state = toFormState(
      { ok: false, error: { code: 'UNAUTHENTICATED', message: '로그인이 필요하다.' } },
      { name: '코스피200', currency: 'KRW' },
      NAMES,
    )
    expect(state.values).toEqual({ name: '코스피200', currency: 'KRW' })
  })

  it('valuesOf는 제외 목록을 지운다', () => {
    const values = valuesOf(formData({ email: 'a@b.c', password: 'secret' }), [
      'password',
    ])
    expect(values).toEqual({ email: 'a@b.c' })
  })

  it('FormState는 직렬화를 넘는다', () => {
    /*
     * `useActionState`의 값은 서버·클라이언트 경계를 넘는다. `undefined`는
     * 넘어가지만 JSON 왕복에서 사라지므로 없음을 `null`로 표현했다 —
     * `tests/db/brand.test.ts`가 뷰에 걸었던 규율과 같다.
     */
    const state = toFormState(
      { ok: false, error: { code: 'INTERNAL', message: '오류' } },
      { name: '' },
      NAMES,
    )
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })
})

describe('§5.6 과세 프로필 폼 — SCR-401 (컷 8)', () => {
  it('네 칸을 계약 입력으로 좁힌다', () => {
    const input = parseTaxProfileForm(
      formData({
        year: '2026',
        otherIncomeBase: '50000000',
        otherFinancialIncome: '3000000',
        healthInsuranceType: 'REGIONAL',
      }),
    )

    expect(input).toEqual({
      year: 2026,
      otherIncomeBase: '50000000',
      otherFinancialIncome: '3000000',
      healthInsuranceType: 'REGIONAL',
    })
  })

  it('쉼표를 지운다 — 값은 바뀌지 않는다', () => {
    /*
     * 이 폼의 칸은 전부 히든이고 값은 **조정 폼(GET)에서** 온다. 그런데 그 경로에도
     * 쉼표가 실릴 수 있으므로(사용자가 적거나 주소에 남아 있다) 같은 방어가 필요하다 —
     * 없으면 V-19가 「정수로 입력한다」를 내고 사용자에게는 자기가 적은 것이 정수다.
     *
     * 문자열 연산이므로 float64를 경유하지 않는다(15자리로 확인한다 —
     * `numeric(15,0)` 상한이며 그 위에서 float64가 값을 밀기 시작한다).
     */
    const input = parseTaxProfileForm(
      formData({
        year: '2026',
        otherIncomeBase: '123,456,789,012,345',
        otherFinancialIncome: ' 1,000 ',
        healthInsuranceType: 'EMPLOYEE',
      }),
    )
    expect(input.otherIncomeBase).toBe('123456789012345')
    expect(input.otherFinancialIncome).toBe('1000')
  })

  it('연도가 형식이 아니면 `NaN`이다 — 계약이 거부한다', () => {
    /*
     * V-20이 「정수로 입력한다」를 낸다. 여기서 기본값을 채우면 사용자가 보고 있던
     * 연도가 아닌 해의 프로필이 조용히 저장된다 — 집계 키가 `(owner_id, year)`이므로
     * (절대 규칙 #7) 그 저장은 다른 연도의 계산을 바꾼다.
     */
    const input = parseTaxProfileForm(formData({ year: '', healthInsuranceType: 'NONE' }))
    expect(Number.isNaN(input.year)).toBe(true)
  })

  it('가입 유형을 좁히지 않는다 — 열거 검사는 V-19가 한다', () => {
    // 여기서 캐스팅만 하므로 조작된 값이 타입만 통과한다. 그것이 의도다 —
    // 규칙이 두 곳에 생기면 어느 쪽이 정본인지 알 수 없다(이 파일 머리글).
    const input = parseTaxProfileForm(formData({ year: '2026', healthInsuranceType: 'BOGUS' }))
    expect(input.healthInsuranceType).toBe('BOGUS')
  })
})
