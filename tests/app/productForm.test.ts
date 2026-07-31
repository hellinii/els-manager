import { describe, expect, it } from 'vitest'

import type { AssetOption } from '@/lib/db/queries/prices'
import {
  EVALUATION_DATE_OFFSET_DAYS,
  generateEvaluationDates,
} from '@/lib/domain'
import { narrowAssets } from '@/lib/forms/assets'
import { barrierNotice, parseBarrierList } from '@/lib/forms/barriers'
import { formOfValues, parseProductForm } from '@/lib/forms/parse'
import { previewDates } from '@/lib/forms/schedules'
import {
  INTENT_FIELD,
  MAX_ROUNDS,
  MAX_UNDERLYINGS,
  PENDING_PARTS,
  SCHEDULE_SUBS,
  UNDERLYING_SUBS,
  addRow,
  applyBarriers,
  intentState,
  parseIntent,
  productFieldNames,
  removeRow,
  roundCountOf,
  rowCountOf,
  submitState,
  transition,
  type RowCounts,
} from '@/lib/forms/productForm'
import { productDefaults } from '@/lib/forms/defaults'

/**
 * SCR-204의 폼 기계 — **화면 안에 두면 아무도 보지 못하는 것들** (P4 컷 4a, P6 컷 1)
 *
 * 행 추가·삭제·배리어 일괄 적용은 제출이고 그 규칙이 순수 모듈에 있다. `useState`로
 * 두면 브라우저 없이 확인할 수 없고(AQ-32) JS 없는 제출이 조용히 죽는다(컷 1b 실측).
 *
 * ## 단계 축이 사라졌다 (P6 컷 1)
 *
 * v0.5의 단계 기계를 철회했으므로(DOC-008 v1.8) 축 둘이 없어졌다 —
 *
 * | 없어진 축 | 왜 |
 * |---|---|
 * | 이송 | 모든 칸이 동시에 렌더된다. 이송할 것이 없다 |
 * | 오류 단계 | 보이지 않는 칸이 없다. 되돌릴 단계가 없다 |
 *
 * 남는 축은 셋이다.
 *
 * | 축 | 무엇이 틀렸을 때 실패하는가 |
 * |---|---|
 * | 행 | 삭제가 구멍을 남겨 오류가 다른 행에 붙는다 |
 * | 배리어 | 일괄 칸이 차수별 칸을 잘못 채우거나 적은 값을 덮는다 |
 * | 왕복 | 이름 생성기와 파서가 갈린다 |
 */

function formData(entries: Record<string, string>): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(entries)) form.append(key, value)
  return form
}

const COUNTS: RowCounts = { underlyings: 2, rounds: 3 }

// ---------------------------------------------------------------------------
// 폼의 이름과 원장
// ---------------------------------------------------------------------------

describe('폼의 이름 — DOC-008 §5 SCR-204 v1.8', () => {
  it('중복이 없고 구획 순서대로다', () => {
    const all = productFieldNames(COUNTS)
    expect(new Set(all).size).toBe(all.length)

    // 구획 순서 = 화면의 `<section>` 순서다: 기본 정보 → 기초자산 → 평가 조건
    expect(all.slice(0, 6)).toEqual([
      'name',
      'issuer',
      'issueDate',
      'principal',
      'accountType',
      'note',
    ])
    expect(all[6]).toBe('underlyings[0].assetId')
  })

  it('★ `step` 필드가 없다 — 단계 분리를 철회했다', () => {
    /*
     * 이 단언이 없으면 `step`이 되살아나도 아무도 보지 못한다. 그 이름이 폼에
     * 남아 있으면 `transition`이 그것을 값에 담고 계약 입력에도 실리며(어댑터가
     * `next.values`에서 파싱한다) 계약이 「모르는 필드」로 무시한다 — 조용하다.
     */
    expect(productFieldNames(COUNTS)).not.toContain('step')
  })

  it('배열 이름이 행·차수 수에 따라 늘어난다', () => {
    const names = productFieldNames({ underlyings: 3, rounds: 2 })
    expect(names).toContain('underlyings[2].basePrice')
    expect(names).not.toContain('underlyings[3].basePrice')
    expect(names).toContain('schedules[1].lizardCouponRate')
    expect(names).not.toContain('schedules[2].barrier')
  })

  it('원장의 항목이 무엇을·언제인지 말한다', () => {
    /*
     * `PENDING_PARTS`는 원장이다(`NOT_YET_BUILT`와 같은 형태). 컷 4a에 세 조각이
     * 있었고(③·④·저장) 컷 4b가 세우며 비웠고, 컷 5가 다시 채웠고 컷 6이 비웠다.
     *
     * ## 키 규약이 좁아졌다 (P6 컷 1)
     *
     * 컷 5는 「화면 id 또는 **단계 id**로 시작한다」였다. 단계가 없어졌으므로 화면
     * id 하나다 — 남겨 두면 실재하지 않는 집합을 허용하는 규약이 된다. 사유에
     * 컷 번호를 요구하는 것은 그대로다(「무엇이 없는가」만 있고 「언제 서는가」가
     * 없으면 다음 사람이 지울 시점을 모른다).
     *
     * **건수는 여기서 단언하지 않는다.** `tests/app/invalidation.test.ts`가 세 원장을
     * 함께 세며 그 자리에서 한다 — 두 곳에 적으면 한쪽만 고쳐진다.
     */
    for (const [key, why] of Object.entries(PENDING_PARTS)) {
      const head = key.split(' ')[0] ?? ''
      expect(/^SCR-\d{3}$/.test(head), `${key}: 화면 id로 시작하지 않는다`).toBe(true)
      expect(why, `${key}의 사유에 컷 번호가 없다`).toMatch(/컷 \d/)
    }
  })
})

// ---------------------------------------------------------------------------
// 의도 — 페이지 안의 조작 셋
// ---------------------------------------------------------------------------

describe('의도', () => {
  it('읽는다 — 인식하지 못한 값은 NONE이다', () => {
    expect(parseIntent('SUBMIT')).toEqual({ kind: 'SUBMIT' })
    expect(parseIntent('ADD_UNDERLYING')).toEqual({ kind: 'ADD_UNDERLYING' })
    expect(parseIntent('APPLY_BARRIERS')).toEqual({ kind: 'APPLY_BARRIERS' })
    expect(parseIntent('REMOVE_UNDERLYING:2')).toEqual({
      kind: 'REMOVE_UNDERLYING',
      index: 2,
    })
    // 조작된 값이 폼을 막지 않는다 — `lib/forms/query.ts`가 URL에 내린 판단과 같다.
    expect(parseIntent('REMOVE_UNDERLYING:-1')).toEqual({ kind: 'NONE' })
    expect(parseIntent('REMOVE_UNDERLYING:abc')).toEqual({ kind: 'NONE' })
    expect(parseIntent('DROP TABLE')).toEqual({ kind: 'NONE' })
    expect(parseIntent(null)).toEqual({ kind: 'NONE' })
  })

  it('★ 단계 이동 의도가 없다 — 철회된 이름은 NONE으로 떨어진다', () => {
    /*
     * 낡은 링크나 캐시된 문서가 `NEXT`를 보낼 수 있다. `NONE`이 되면 값만 좁혀
     * 다시 렌더하므로 아무 해가 없다 — 인식하지 못한 의도를 오류로 만들지 않는
     * 규약(`parseIntent`의 각주)이 그 경로를 이미 덮는다.
     */
    expect(parseIntent('NEXT')).toEqual({ kind: 'NONE' })
    expect(parseIntent('BACK')).toEqual({ kind: 'NONE' })
  })
})

// ---------------------------------------------------------------------------
// 축 3 — 행 연산
// ---------------------------------------------------------------------------

describe('행 — 값에서 개수를 파생시킨다', () => {
  it('최소 1행이다', () => {
    expect(rowCountOf({}, 'underlyings')).toBe(1)
    expect(rowCountOf(productDefaults(), 'underlyings')).toBe(1)
  })

  it('가장 큰 인덱스가 개수를 정한다', () => {
    expect(
      rowCountOf(
        { 'underlyings[0].assetId': '', 'underlyings[2].assetId': '' },
        'underlyings',
      ),
    ).toBe(3)
    // 다른 필드의 인덱스는 세지 않는다.
    expect(rowCountOf({ 'schedules[5].barrier': '' }, 'underlyings')).toBe(1)
  })

  it('차수는 `totalRounds`가 정한다 — 잔재를 되살리지 않는다', () => {
    /*
     * ★ 총 차수를 6에서 3으로 줄이면 `schedules[3..5]`의 키가 값 맵에 남는다.
     * 키에서 개수를 파생시키면 그 잔재가 되살아나 V-03이 「6건이 총 차수 3과
     * 다르다」를 내고, 사용자는 자기가 지운 차수를 화면에서 볼 수 없다.
     */
    const stale = {
      totalRounds: '3',
      'schedules[0].barrier': '90',
      'schedules[5].barrier': '65',
    }
    expect(roundCountOf(stale)).toBe(3)
    expect(productFieldNames({ underlyings: 1, rounds: roundCountOf(stale) })).not.toContain(
      'schedules[5].barrier',
    )
  })

  it('차수를 정하지 않았으면 0이고 상한을 넘지 않는다', () => {
    expect(roundCountOf({})).toBe(0)
    expect(roundCountOf({ totalRounds: '' })).toBe(0)
    expect(roundCountOf({ totalRounds: 'abc' })).toBe(0)
    // V-20이 smallint까지 허용하므로 화면 상한이 따로 필요하다.
    expect(roundCountOf({ totalRounds: '32767' })).toBe(MAX_ROUNDS)
  })

  it('추가는 빈 이름을 만들고 상한에서 멈춘다', () => {
    const one = addRow(productDefaults(), 'underlyings', UNDERLYING_SUBS, MAX_UNDERLYINGS)
    expect(one['underlyings[1].assetId']).toBe('')
    expect(rowCountOf(one, 'underlyings')).toBe(2)

    let many = productDefaults()
    for (let i = 0; i < MAX_UNDERLYINGS + 5; i += 1) {
      many = addRow(many, 'underlyings', UNDERLYING_SUBS, MAX_UNDERLYINGS)
    }
    expect(rowCountOf(many, 'underlyings')).toBe(MAX_UNDERLYINGS)
  })

  it('삭제는 뒤의 행을 당긴다 — 구멍을 남기지 않는다', () => {
    /*
     * ★ 구멍을 남기면 파서가 그것을 빈 행으로 읽고, 계약이 「기초자산을 선택한다」를
     * **존재하지 않는 행에** 붙인다. 인덱스는 폼의 `name`이 정본이므로 값이 움직여야
     * 한다.
     */
    const three = {
      'underlyings[0].assetId': 'a',
      'underlyings[0].basePrice': '1',
      'underlyings[1].assetId': 'b',
      'underlyings[1].basePrice': '2',
      'underlyings[2].assetId': 'c',
      'underlyings[2].basePrice': '3',
    }
    const after = removeRow(three, 'underlyings', UNDERLYING_SUBS, 1)

    expect(rowCountOf(after, 'underlyings')).toBe(2)
    expect(after['underlyings[0].assetId']).toBe('a')
    expect(after['underlyings[1].assetId']).toBe('c')
    expect(after['underlyings[1].basePrice']).toBe('3')
    expect(after['underlyings[2].assetId']).toBeUndefined()
  })

  it('마지막 한 행은 지우지 않는다 — V-02가 0건을 거부한다', () => {
    const one = { 'underlyings[0].assetId': 'a', 'underlyings[0].basePrice': '1' }
    expect(removeRow(one, 'underlyings', UNDERLYING_SUBS, 0)).toEqual(one)
    // 범위 밖 인덱스도 아무것도 바꾸지 않는다(조작된 버튼 값).
    expect(removeRow(one, 'underlyings', UNDERLYING_SUBS, 7)).toEqual(one)
  })
})

// ---------------------------------------------------------------------------
// 전이 → 폼 상태 — 어댑터 둘이 공유한다 (컷 5)
// ---------------------------------------------------------------------------

describe('폼 상태 — 등록과 수정이 같은 두 함수를 쓴다', () => {
  /**
   * 이 둘이 순수 모듈에 있는 이유는 어댑터가 둘이 되었다는 것이다(컷 5). 어댑터는
   * `server.ts`를 끌어오므로 어떤 스위트의 import 그래프에도 없고(AQ-23), 거기 있으면
   * **두 화면의 오류 표시가 갈려도 아무도 보지 못한다.**
   */
  function submitting(values: Record<string, string>): FormData {
    return formData({ ...values, [INTENT_FIELD]: 'SUBMIT' })
  }

  it('제출이 아닌 의도는 오류를 나르지 않는다', () => {
    const state = intentState(transition(formData({ name: '상품' })))
    expect(state.status).toBe('INITIAL')
    expect(state.fieldErrors).toEqual({})
    expect(state.message).toBeNull()
    expect(state.values.name).toBe('상품')
  })

  it('안내는 오류가 아니다 — `status`를 바꾸지 않는다', () => {
    const next = transition(
      formData({ [INTENT_FIELD]: 'APPLY_BARRIERS', barriers: '90-85' }),
    )
    const state = intentState(next)
    expect(state.status).toBe('INITIAL')
    expect(state.message).toBe(next.notice)
    expect(state.message).not.toBeNull()
  })

  it('★ 오류가 전부 그 칸에 붙는다 — 되돌릴 단계가 없다', () => {
    /*
     * 종전에는 「오류가 있는 가장 앞 단계로 되돌린다」였다(`stepForErrors`). 그
     * 장치는 **보이지 않는 칸의 오류를 화면에 가져오는** 수단이었고, 모든 칸이
     * 동시에 렌더되므로 보이지 않는 칸이 없다.
     *
     * `totalRounds`가 차수표의 행 수를 정한다 — 없으면 `schedules[0].*`가 폼의
     * 이름이 아니고 그 오류는 미매칭으로 상단에 간다(다음 케이스가 그 경우다).
     */
    const next = transition(submitting({ name: '', totalRounds: '1' }))
    const state = submitState(
      {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: '입력을 확인한다.',
          fields: { name: '상품명을 입력한다.', 'schedules[0].barrier': '배리어를 입력한다.' },
        },
      },
      next,
    )

    expect(state.fieldErrors.name).toBe('상품명을 입력한다.')
    expect(state.fieldErrors['schedules[0].barrier']).toBe('배리어를 입력한다.')
    expect(state.unmatched).toEqual([])
    // 단계를 나르는 값이 상태에 없다 — 있으면 폼이 그것을 다시 제출한다
    expect(state.values.step).toBeUndefined()
  })

  it('어느 칸과도 짝지어지지 않은 오류는 상단으로 간다', () => {
    const next = transition(submitting({}))
    const state = submitState(
      {
        ok: false,
        error: { code: 'CONFLICT', message: '이미 상환 처리된 상품이다.', fields: { zzz: '?' } },
      },
      next,
    )

    expect(state.unmatched).toEqual([{ key: 'zzz', message: '?' }])
    expect(state.code).toBe('CONFLICT')
  })

  it('입력값이 실패 경로에서 보존된다 — W-03의 존재 이유', () => {
    const next = transition(submitting({ name: '상품', principal: '1,000' }))
    const state = submitState(
      { ok: false, error: { code: 'UNAUTHENTICATED', message: '로그인이 필요하다.' } },
      next,
    )

    expect(state.values.name).toBe('상품')
    // 쉼표는 그대로 남는다 — 파서가 지우고 표시는 원문을 보존한다.
    expect(state.values.principal).toBe('1,000')
    expect(state.code).toBe('UNAUTHENTICATED')
  })
})

// ---------------------------------------------------------------------------
// transition — 액션이 부르는 유일한 함수
// ---------------------------------------------------------------------------

describe('transition', () => {
  it('값을 원문 그대로 보존한다', () => {
    const next = transition(
      formData({
        name: '상품',
        principal: '100,000,000',
        'underlyings[0].assetId': '',
        'underlyings[0].basePrice': '',
      }),
    )

    expect(next.values.name).toBe('상품')
    // 원문 그대로 보존한다 — 쉼표 제거는 파싱의 일이고 표시의 일이 아니다.
    expect(next.values.principal).toBe('100,000,000')
  })

  it('폼의 이름만 남긴다 — `$ACTION_*`·`intent`·`step`은 상태에 담지 않는다', () => {
    /*
     * 상태는 다음 제출을 위해 **폼에 다시 직렬화된다**(컷 1b에서 `$ACTION_*`가
     * 히든 필드로 렌더되는 것을 실측했다). 액션 필드가 상태에 들어오면 그 왕복이
     * 커지고 무엇보다 상태에 무엇이 있는지가 흐려진다.
     *
     * `step`을 함께 보는 이유는 그것이 **낡은 문서에서 올 수 있다**는 것이다 —
     * 단계 분리를 철회했으므로 폼의 이름이 아니고, 좁힘이 그것을 버린다.
     */
    const next = transition(
      formData({
        step: 'BASIC',
        [INTENT_FIELD]: 'ADD_UNDERLYING',
        $ACTION_REF_1: '',
        'user-search-box': '코스피',
        name: '상품',
      }),
    )

    expect(next.values.$ACTION_REF_1).toBeUndefined()
    expect(next.values[INTENT_FIELD]).toBeUndefined()
    expect(next.values['user-search-box']).toBeUndefined()
    expect(next.values.step).toBeUndefined()
    expect(Object.keys(next.values).sort()).toEqual(
      [...productFieldNames(next.counts)].sort(),
    )
  })

  it('행 추가·삭제가 계수를 바꾼다', () => {
    const added = transition(
      formData({
        [INTENT_FIELD]: 'ADD_UNDERLYING',
        'underlyings[0].assetId': 'a',
        'underlyings[0].basePrice': '1',
      }),
    )
    expect(added.counts.underlyings).toBe(2)
    expect(added.values['underlyings[1].assetId']).toBe('')
    expect(added.notice).toBeNull()

    const removed = transition(
      formData({
        [INTENT_FIELD]: 'REMOVE_UNDERLYING:0',
        'underlyings[0].assetId': 'a',
        'underlyings[0].basePrice': '1',
        'underlyings[1].assetId': 'b',
        'underlyings[1].basePrice': '2',
      }),
    )
    expect(removed.counts.underlyings).toBe(1)
    expect(removed.values['underlyings[0].assetId']).toBe('b')
  })

  it('상한과 하한에서 안내를 낸다 — 오류가 아니다', () => {
    const single = transition(
      formData({
        [INTENT_FIELD]: 'REMOVE_UNDERLYING:0',
        'underlyings[0].assetId': 'a',
      }),
    )
    expect(single.notice).toContain('1종 이상')

    const entries: Record<string, string> = { [INTENT_FIELD]: 'ADD_UNDERLYING' }
    for (let i = 0; i < MAX_UNDERLYINGS; i += 1) {
      entries[`underlyings[${i}].assetId`] = ''
    }
    expect(transition(formData(entries)).notice).toContain(`${MAX_UNDERLYINGS}종`)
  })
})

// ---------------------------------------------------------------------------
// SQ-04 — 배리어 일괄 입력
// ---------------------------------------------------------------------------

describe('SQ-04 배리어 일괄 입력', () => {
  it('구분자는 숫자·점이 아닌 모든 연속이다', () => {
    /*
     * 목록을 열거하지 않는 이유: 열거하면 목록 밖의 글자가 **숫자에 붙어 토큰이
     * 된다.** `90 / 85`에서 슬래시만 허용하면 `90 `·` 85`가 되거나 한 토큰이 되고,
     * 그 결과는 「배리어는 2 이하여야 한다」 같은 고칠 수 없는 오류로 나타난다.
     */
    for (const raw of [
      '90-85-80',
      '90 85 80',
      '90/85/80',
      '90, 85, 80',
      '90 | 85 | 80',
      '90\n85\n80',
      '  90--85  ,, 80 ',
      '90%-85%-80%',
    ]) {
      expect(parseBarrierList(raw).tokens, raw).toEqual(['90', '85', '80'])
    }
  })

  it('음수 부호가 구분자로 흡수된다 — 문서의 예시가 그대로 동작한다', () => {
    // `90-85`의 `-`가 뺄셈이나 음수로 읽히면 V-08 하한(`x > 0`)에 걸린다.
    expect(parseBarrierList('90-85').tokens.every((t) => !t.startsWith('-'))).toBe(true)
  })

  it('토큰 하나라도 2를 넘으면 전부 퍼센트로 읽는다', () => {
    const list = parseBarrierList('90-85-80')
    expect(list.readAs).toBe('PERCENT')
    expect(list.mixed).toBe(false)
  })

  it('전부 2 이하면 소수로 읽어 퍼센트로 바꾼다', () => {
    const list = parseBarrierList('0.9-0.85-0.8')
    expect(list.readAs).toBe('RATIO')
    expect(list.tokens).toEqual(['90', '85', '80'])
  })

  it('경계는 2다 — V-08의 상한과 같은 값', () => {
    /*
     * `2`는 비율로 200%이고 V-08이 허용하는 최대다. 그 값까지는 소수로 읽고 넘으면
     * 퍼센트로 읽는다 — 경계를 다른 값에 두면 V-08이 거부하는 비율을 우리가 만들거나
     * (2.5 → 250%) 허용하는 비율을 퍼센트로 격하한다.
     */
    expect(parseBarrierList('2').readAs).toBe('RATIO')
    expect(parseBarrierList('2').tokens).toEqual(['200'])
    expect(parseBarrierList('2.0001').readAs).toBe('PERCENT')
    expect(parseBarrierList('1-2').tokens).toEqual(['100', '200'])
  })

  it('소수점 곱셈이 정확하다 — float64를 경유하지 않는다', () => {
    // `0.885 × 100`이 `88.50000000000001`이 되는 부류다. Decimal로 곱한다.
    expect(parseBarrierList('0.885-0.8825').tokens).toEqual(['88.5', '88.25'])
    // 사람이 적는 `.9`도 받는다.
    expect(parseBarrierList('.9-.85').tokens).toEqual(['90', '85'])
  })

  it('혼합 입력을 신호로 남긴다 — 계약이 잡지 못하는 자리다', () => {
    /*
     * ★ `90-0.85-80`은 퍼센트로 읽히므로 둘째가 **0.85%**가 되고, 그 값은
     * V-08(`0 < x ≤ 2`)을 통과한다 — 계약은 거부할 근거가 없고 표에는 값이 보이지만
     * 「왜」가 없으면 오타로 읽히지 않는다. 그래서 화면이 경고한다.
     */
    const list = parseBarrierList('90-0.85-80')
    expect(list.readAs).toBe('PERCENT')
    expect(list.tokens).toEqual(['90', '0.85', '80'])
    expect(list.mixed).toBe(true)
    expect(barrierNotice(list, 3)).toContain('2 이하인 값이 섞여')
  })

  it('숫자를 품은 비-형식 토큰은 그대로 통과한다 — 차수가 밀리지 않는다', () => {
    /*
     * 버리면 뒤의 값이 앞 차수로 당겨져 **다른 차수의 배리어**가 된다. 남기면 그
     * 칸에 형식 오류가 붙는다 — 문구는 계약이 낸다(`parse.ts` 머리글의 규칙).
     */
    const list = parseBarrierList('90-8.5.3-80')
    expect(list.tokens).toEqual(['90', '8.5.3', '80'])
    // 형식이 아닌 토큰은 해석 모드 투표에 참여하지 않는다.
    expect(list.readAs).toBe('PERCENT')
  })

  it('숫자가 없는 글자는 사라진다 — 결정 ①의 대가이며 개수가 그것을 드러낸다', () => {
    /*
     * ★ **처음 쓴 케이스가 틀렸고 구현이 옳았다.** 「구분자는 숫자·점이 아닌 모든
     * 연속」이므로 `팔십오`는 토큰이 아니라 **구분자**다. 즉 숫자 없는 오타는 조용히
     * 사라지고 값이 밀리지도 않는다 — 남는 신호는 **개수**이며 그것을 세 곳이 본다:
     * 안내 문구(`barrierNotice`)·차수표의 빈 칸·V-03(저장 시점).
     *
     * 이 대가를 감수하는 이유는 대안이 더 나쁘다는 것이다. 구분자를 열거하면 목록
     * 밖의 글자가 숫자에 **붙어** `90팔십오`가 한 토큰이 되고, 그때는 값이 밀린다.
     */
    const list = parseBarrierList('90-팔십오-80')
    expect(list.tokens).toEqual(['90', '80'])
    expect(barrierNotice(list, 3)).toContain('총 차수 3과 개수가 다르다')
  })

  it('빈 입력은 토큰 0건이다', () => {
    for (const raw of ['', '   ', '---', '%']) {
      expect(parseBarrierList(raw).tokens, raw).toEqual([])
    }
  })

  it('일괄 적용이 차수별 칸을 채운다 — 정본은 그 칸이다', () => {
    const applied = applyBarriers({ totalRounds: '3', barriers: '90-85-80' })
    expect(applied.values['schedules[0].barrier']).toBe('90')
    expect(applied.values['schedules[2].barrier']).toBe('80')
    expect(applied.notice).toContain('퍼센트로 읽었다')
  })

  it('총 차수가 비어 있으면 개수로 채운다 — 적은 값은 바꾸지 않는다', () => {
    expect(applyBarriers({ barriers: '90-85-80' }).values.totalRounds).toBe('3')
    // 이미 적혀 있으면 그대로 두고 다르다고 알린다(V-03이 저장 시점에 같은 사실을 낸다).
    const kept = applyBarriers({ totalRounds: '6', barriers: '90-85-80' })
    expect(kept.values.totalRounds).toBe('6')
    expect(kept.notice).toContain('총 차수 6과 개수가 다르다')
    // 넘치는 토큰은 없는 차수에 쓰지 않는다.
    const over = applyBarriers({ totalRounds: '2', barriers: '90-85-80' })
    expect(over.values['schedules[2].barrier']).toBeUndefined()
  })

  it('빈 입력에 적용하면 아무것도 바꾸지 않고 예시를 안내한다', () => {
    const before = { totalRounds: '3', barriers: '' }
    const after = applyBarriers(before)
    expect(after.values).toEqual(before)
    expect(after.notice).toContain('90-85-80')
  })

  it('전이가 일괄 적용을 처리한다 — 화면을 옮기지 않는다', () => {
    const next = transition(
      formData({
        [INTENT_FIELD]: 'APPLY_BARRIERS',
        totalRounds: '',
        barriers: '0.9/0.85',
      }),
    )
    expect(next.counts.rounds).toBe(2)
    expect(next.values['schedules[1].barrier']).toBe('85')
    expect(next.notice).toContain('소수로 읽어')
  })

  it('★ FILL_EMPTY는 이미 적힌 칸을 건드리지 않는다 — OVERWRITE는 덮는다', () => {
    const before = {
      totalRounds: '3',
      barriers: '90-85-80',
      'schedules[0].barrier': '',
      // 차수별로 직접 적은 값. 스텝다운이 아닌 구조가 이렇게 들어온다
      'schedules[1].barrier': '77',
      'schedules[2].barrier': '  ',
    }

    const filled = applyBarriers(before, 'FILL_EMPTY').values
    expect(filled['schedules[0].barrier']).toBe('90')
    expect(filled['schedules[1].barrier']).toBe('77')
    // 공백만 있는 칸은 「적히지 않은 것」이다 — 사용자가 지운 흔적이다
    expect(filled['schedules[2].barrier']).toBe('80')

    const overwritten = applyBarriers(before, 'OVERWRITE').values
    expect(overwritten['schedules[1].barrier']).toBe('85')
  })

  it('★ 저장 제출이 빈 배리어 칸을 일괄 칸에서 채운다', () => {
    /*
     * 차수표는 **마지막으로 제출된** 총 차수를 보고 그려지므로 타이핑만으로는
     * 생기지 않는다. 즉 「총 차수와 일괄 칸을 채우고 곧바로 저장」은 차수 칸이
     * DOM에 없는 상태의 제출이며, 채우지 않으면 보이지 않던 칸에 배리어 필수
     * 오류 N개가 뜬다 — 값을 다 맞게 넣었는데도.
     */
    const next = transition(
      formData({
        [INTENT_FIELD]: 'SUBMIT',
        totalRounds: '3',
        barriers: '90-85-80',
        // 차수 칸이 하나도 없다 — 차수표가 렌더된 적이 없다
      }),
    )
    expect(next.counts.rounds).toBe(3)
    expect(next.values['schedules[0].barrier']).toBe('90')
    expect(next.values['schedules[1].barrier']).toBe('85')
    expect(next.values['schedules[2].barrier']).toBe('80')
  })

  it('저장 제출은 차수별로 적은 배리어를 덮지 않는다', () => {
    const next = transition(
      formData({
        [INTENT_FIELD]: 'SUBMIT',
        totalRounds: '3',
        barriers: '90-85-80',
        'schedules[0].barrier': '95',
        'schedules[1].barrier': '',
        'schedules[2].barrier': '70',
      }),
    )
    expect(next.values['schedules[0].barrier']).toBe('95')
    expect(next.values['schedules[1].barrier']).toBe('85')
    expect(next.values['schedules[2].barrier']).toBe('70')
  })

  it('★ 계약 입력의 정본이 하나다 — 전이가 채운 값이 파서까지 간다', () => {
    /*
     * 어댑터가 `parseProductForm(formOfValues(next.values))`를 부르는 이유다.
     * 원본 `FormData`를 읽으면 화면이 렌더하는 것과 저장되는 것의 출처가 둘이
     * 되고, 위 두 케이스가 만든 채움이 계약에 도달하지 않는다.
     */
    const form = formData({
      [INTENT_FIELD]: 'SUBMIT',
      name: '테스트 ELS',
      issueDate: '2026-01-02',
      principal: '10,000,000',
      accountType: 'GENERAL',
      evaluationPeriodMonths: '6',
      annualCouponRate: '8',
      totalRounds: '2',
      barriers: '90-85',
      'underlyings[0].assetId': '00000000-0000-4000-8000-0000000000a1',
      'underlyings[0].basePrice': '2489.55',
    })

    const next = transition(form)

    // 원본 폼으로 파싱하면 채움이 없다 — 음성 대조
    expect(parseProductForm(form).schedules.map((s) => s.barrier)).toEqual([
      '',
      '',
    ])
    // 전이의 값으로 파싱하면 있다
    expect(
      parseProductForm(formOfValues(next.values)).schedules.map((s) => s.barrier),
    ).toEqual(['0.9000', '0.8500'])
  })
})

// ---------------------------------------------------------------------------
// 자동완성 — 검색은 표시를 좁히고 값을 바꾸지 않는다
// ---------------------------------------------------------------------------

describe('자산 좁힘', () => {
  const option = (id: string, name: string): AssetOption => ({
    id,
    name,
    market: 'KRX',
    currency: 'KRW',
    hasPriceProvider: false,
  })
  const ASSETS = [option('a1', '코스피200'), option('a2', 'S&P500'), option('a3', '테슬라')]

  it('빈 검색어는 전량이다', () => {
    expect(narrowAssets({ assets: ASSETS, query: '  ', selected: '' })).toEqual(ASSETS)
  })

  it('이름 부분일치 · 대소문자 무관', () => {
    expect(
      narrowAssets({ assets: ASSETS, query: 's&p', selected: '' }).map((a) => a.id),
    ).toEqual(['a2'])
  })

  it('★ 선택된 자산은 검색어와 무관하게 남는다', () => {
    /*
     * 필터가 선택된 항목을 숨기면 `<select>`의 값이 **조용히 다른 자산으로 바뀐다.**
     * 사용자는 검색어를 지웠을 뿐인데 기초자산이 달라지고, 기준가는 그대로이므로
     * 저장 후에도 값이 그럴싸하다 — 상세 화면의 워스트오브로만 드러난다.
     *
     * 음성 대조: `asset.id === selected` 절을 지우면 이 케이스만 실패한다
     * (앞의 두 케이스는 선택이 없거나 일치하므로 두 구현을 가르지 못한다).
     */
    const shown = narrowAssets({ assets: ASSETS, query: '테슬라', selected: 'a1' })
    expect(shown.map((asset) => asset.id)).toEqual(['a1', 'a3'])
  })
})

// ---------------------------------------------------------------------------
// 평가일 생성 — 화면과 파서가 같은 함수를 부른다
// ---------------------------------------------------------------------------

describe('평가일 미리보기', () => {
  it('발행일 + 주기 × n − 1일이다 — 기산 규약이 실려 있다', () => {
    expect(
      previewDates({ issueDate: '2026-01-02', evaluationPeriodMonths: 6, totalRounds: 3 }),
    ).toEqual(['2026-07-01', '2027-01-01', '2027-07-01'])
  })

  it('★ 규약을 이 계층에서 다시 정하지 않는다 — 상수를 그대로 쓴다', () => {
    /*
     * 기대값을 손으로 적으면 규약이 바뀔 때 이 파일이 조용히 낡는다. 상수에서
     * 파생시키면 「폼이 도메인의 규약을 그대로 나른다」가 명제가 된다 — 화면과
     * 파서가 같은 함수를 부르는 성질(`schedules.ts` 머리글)의 테스트 판이다.
     */
    const input = { issueDate: '2026-06-26', evaluationPeriodMonths: 6, totalRounds: 6 }
    expect(previewDates(input)).toEqual(
      generateEvaluationDates({ ...input, offsetDays: EVALUATION_DATE_OFFSET_DAYS }),
    )
    // 음성 대조 — 규약이 실리지 않았다면 이 단언이 통과한다
    expect(previewDates(input)).not.toEqual(
      generateEvaluationDates({ ...input, offsetDays: 0 }),
    )
  })

  it('말일 클램핑 뒤에 일 이동이 온다 — `lib/domain`의 규칙 하나를 쓴다', () => {
    // 1/31 + 1개월 → 2/28(클램프) → −1일 → 2/27.
    // 일 이동이 먼저면 1/30 + 1개월 = 2/28이 되어 갈린다
    expect(
      previewDates({ issueDate: '2026-01-31', evaluationPeriodMonths: 1, totalRounds: 2 }),
    ).toEqual(['2026-02-27', '2026-03-30'])
  })

  it('덜 채운 폼에서 던지지 않는다', () => {
    /*
     * ★ 폼은 **아직 다 채우지 않은 상태로 렌더되는 것이 정상**이다. 순수 모듈은
     * `RangeError`를 던지므로(규약) 그것이 그대로 나가면 사용자가 발행일을 지우는
     * 순간 화면이 오류 경계로 간다.
     */
    for (const input of [
      { issueDate: '', evaluationPeriodMonths: 6, totalRounds: 3 },
      { issueDate: '2026-1-2', evaluationPeriodMonths: 6, totalRounds: 3 },
      { issueDate: '2026-02-30', evaluationPeriodMonths: 6, totalRounds: 3 },
      { issueDate: '2026-13-01', evaluationPeriodMonths: 6, totalRounds: 3 },
      { issueDate: '2026-01-02', evaluationPeriodMonths: Number.NaN, totalRounds: 3 },
      { issueDate: '2026-01-02', evaluationPeriodMonths: 0, totalRounds: 3 },
      { issueDate: '2026-01-02', evaluationPeriodMonths: 6, totalRounds: 0 },
    ]) {
      expect(previewDates(input), JSON.stringify(input)).toEqual([])
    }
  })

  it('상한을 넘겨 부르지 않는다', () => {
    expect(
      previewDates({ issueDate: '2026-01-02', evaluationPeriodMonths: 1, totalRounds: 500 }),
    ).toHaveLength(MAX_ROUNDS)
  })
})

// ---------------------------------------------------------------------------
// 왕복 — 이름 생성기 → FormData → 파서
// ---------------------------------------------------------------------------

describe('상품 폼 왕복 — 생성기와 파서가 갈리지 않는다', () => {
  /** 화면이 그리는 그대로의 폼. 값은 **퍼센트**이고 금액에는 쉼표가 있다 */
  function filled(): FormData {
    return formData({
      name: 'OO증권 ELS 1234회',
      issuer: 'OO증권',
      issueDate: '2026-01-02',
      principal: '100,000,000',
      accountType: 'GENERAL',
      note: '증권사 통지 기준',
      evaluationPeriodMonths: '6',
      totalRounds: '3',
      annualCouponRate: '8',
      kiBarrier: '50',
      kiObservation: 'CLOSING',
      'underlyings[0].assetId': '00000000-0000-4000-8000-0000000000a1',
      'underlyings[0].basePrice': '2,489.55',
      'underlyings[1].assetId': '00000000-0000-4000-8000-0000000000a2',
      'underlyings[1].basePrice': '13500',
      'schedules[0].barrier': '90',
      'schedules[1].barrier': '85',
      'schedules[1].lizardBarrier': '60',
      'schedules[1].lizardCouponRate': '3',
      'schedules[1].lizardRequiresNoKi': 'on',
      'schedules[2].barrier': '80',
    })
  }

  it('계약 입력으로 정확히 복원된다', () => {
    expect(parseProductForm(filled())).toEqual({
      name: 'OO증권 ELS 1234회',
      issuer: 'OO증권',
      issueDate: '2026-01-02',
      // 쉼표는 표시 형식이다 — 값이 아니라 문자열에서만 사라진다(float64 미경유).
      principal: '100000000',
      evaluationPeriodMonths: 6,
      totalRounds: 3,
      annualCouponRate: '0.0800',
      kiBarrier: '0.5000',
      kiObservation: 'CLOSING',
      accountType: 'GENERAL',
      note: '증권사 통지 기준',
      underlyings: [
        {
          assetId: '00000000-0000-4000-8000-0000000000a1',
          basePrice: '2489.55',
          sequence: 1,
        },
        {
          assetId: '00000000-0000-4000-8000-0000000000a2',
          basePrice: '13500',
          sequence: 2,
        },
      ],
      schedules: [
        // 발행일 2026-01-02 + 6n − 1일 (기산 규약)
        { roundNo: 1, evaluationDate: '2026-07-01', barrier: '0.9000' },
        {
          roundNo: 2,
          evaluationDate: '2027-01-01',
          barrier: '0.8500',
          lizardBarrier: '0.6000',
          lizardCouponRate: '0.0300',
          lizardRequiresNoKi: true,
        },
        { roundNo: 3, evaluationDate: '2027-07-01', barrier: '0.8000' },
      ],
    })
  })

  it('생성기가 만든 이름만으로 폼이 채워진다', () => {
    /*
     * 파서가 읽는 이름이 `productFieldNames`에 없으면 그 칸은 **이송되지 않으므로**
     * 다음 단계로 가면 값이 사라진다. 반대 방향(이름은 있는데 파서가 안 읽는다)은
     * 조용히 무시되므로 여기서 좌변을 고정한다.
     */
    const names = new Set(productFieldNames({ underlyings: 2, rounds: 3 }))
    for (const key of filled().keys()) {
      expect(names, `${key}가 폼의 이름 목록에 없다`).toContain(key)
    }
  })

  it('빈 선택 필드는 보내지 않는다 — 「비었다」와 「안 보냈다」가 다르다', () => {
    const input = parseProductForm(
      formData({
        name: '노낙인 상품',
        issueDate: '2026-01-02',
        principal: '10000000',
        accountType: 'TAX_FREE',
        evaluationPeriodMonths: '3',
        totalRounds: '1',
        annualCouponRate: '5',
        issuer: '',
        kiBarrier: '',
        kiObservation: '',
        note: '',
        'underlyings[0].assetId': '00000000-0000-4000-8000-0000000000a1',
        'underlyings[0].basePrice': '100',
        'schedules[0].barrier': '95',
      }),
    )

    expect('issuer' in input).toBe(false)
    expect('kiBarrier' in input).toBe(false)
    expect('kiObservation' in input).toBe(false)
    expect('note' in input).toBe(false)
    expect(input.schedules[0]).toEqual({
      roundNo: 1,
      evaluationDate: '2026-04-01',
      barrier: '0.9500',
    })
  })

  it('리자드 배리어가 없으면 나머지 둘을 보내지 않는다', () => {
    /*
     * DB에 그 조합을 막는 제약이 없다(I-10은 반대 방향만 본다). 보내면 **아무
     * 판정도 읽지 않는 값**이 저장되고, 그 사실은 어디에도 나타나지 않는다.
     * 차수표가 「리자드 없음」을 보여주므로 이 누락은 저장 전에 확인된다.
     */
    const input = parseProductForm(
      formData({
        issueDate: '2026-01-02',
        evaluationPeriodMonths: '6',
        totalRounds: '1',
        'schedules[0].barrier': '90',
        'schedules[0].lizardBarrier': '',
        'schedules[0].lizardCouponRate': '3',
        'schedules[0].lizardRequiresNoKi': 'on',
      }),
    )
    expect(input.schedules[0]).toEqual({
      roundNo: 1,
      evaluationDate: '2026-07-01',
      barrier: '0.9000',
    })
  })

  it('원금상환형 리자드의 `0`은 값이다 — 빈 칸이 아니다', () => {
    // DOC-007 §4.1: 원금만 상환되는 변형은 `'0'`으로 표기하며 `null`이 아니다.
    const input = parseProductForm(
      formData({
        issueDate: '2026-01-02',
        evaluationPeriodMonths: '6',
        totalRounds: '1',
        'schedules[0].barrier': '90',
        'schedules[0].lizardBarrier': '60',
        'schedules[0].lizardCouponRate': '0',
      }),
    )
    expect(input.schedules[0].lizardCouponRate).toBe('0.0000')
    // 체크하지 않은 상자는 `false`다(부재가 곧 거짓).
    expect(input.schedules[0].lizardRequiresNoKi).toBe(false)
  })

  it('값 없는 빈 체크박스는 `false`다 — 부재만 보면 켜진다', () => {
    /*
     * ★ **이 케이스가 없으면 `checkbox`의 방어가 미검증이다.** 값 없는 이름을
     * `''`로 싣는 경로가 있으면 `form.get(name) != null`만 보는 구현이 그것을
     * `true`로 읽는다 — 「체크를 풀었는데 저장하면 켜져 있다」가 되고 원인이 폼이
     * 아니라 직렬화라 재현 조건을 찾기 어렵다. 종전 서식지는 히든 이송이었고
     * 지금은 `formOfValues`다(어댑터가 그 폼으로 계약 입력을 만든다).
     *
     * 음성 대조로 확인했다: `checkbox`를 `form.get(name) != null`로 되돌리면 이
     * 케이스만 실패하고 나머지 왕복 단언은 전부 통과한다(다른 픽스처는 키가 아예
     * 없거나 `'on'`이라 두 구현을 가르지 못한다).
     */
    const input = parseProductForm(
      formData({
        issueDate: '2026-01-02',
        evaluationPeriodMonths: '6',
        totalRounds: '1',
        'schedules[0].barrier': '90',
        'schedules[0].lizardBarrier': '60',
        'schedules[0].lizardCouponRate': '0',
        'schedules[0].lizardRequiresNoKi': '',
      }),
    )
    expect(input.schedules[0].lizardRequiresNoKi).toBe(false)
  })

  it('빈 행을 지우거나 번호를 다시 매기지 않는다', () => {
    /*
     * ★ 걸러내며 번호를 다시 매기면 계약의 `fields` 키가 화면의 칸과 어긋나고
     * **오류가 다른 행에 표시된다.** 그것은 표시되지 않는 오류보다 나쁘다 —
     * 사용자가 채운 칸을 의심하게 된다.
     */
    const input = parseProductForm(
      formData({
        totalRounds: '0',
        'underlyings[0].assetId': '',
        'underlyings[0].basePrice': '',
        'underlyings[1].assetId': '00000000-0000-4000-8000-0000000000a2',
        'underlyings[1].basePrice': '100',
      }),
    )
    expect(input.underlyings).toHaveLength(2)
    expect(input.underlyings[0]).toEqual({ assetId: '', basePrice: '', sequence: 1 })
    expect(input.underlyings[1].sequence).toBe(2)
  })

  it('총 차수를 정하지 않으면 일정이 0건이다 — V-03이 그 이유를 말한다', () => {
    const input = parseProductForm(formData({ name: '상품', totalRounds: '' }))
    expect(input.schedules).toEqual([])
    // 정수가 아닌 입력은 그대로 넘어가 V-20이 「정수로 입력한다」를 낸다.
    expect(Number.isNaN(input.totalRounds)).toBe(true)
    expect(Number.isNaN(input.evaluationPeriodMonths)).toBe(true)
  })

  it('차수 상한을 넘으면 상한까지 읽는다 — 화면과 파서가 같은 수를 본다', () => {
    const input = parseProductForm(
      formData({
        issueDate: '2026-01-02',
        evaluationPeriodMonths: '1',
        totalRounds: '200',
      }),
    )
    expect(input.schedules).toHaveLength(MAX_ROUNDS)
    // 남는 차이는 V-03이 「N건이 총 차수 200과 다르다」로 설명한다.
    expect(input.totalRounds).toBe(200)
  })

  it('차수표의 하위 이름이 파서와 같다', () => {
    // 목록이 갈리면 그 칸만 조용히 저장되지 않는다.
    expect([...SCHEDULE_SUBS]).toEqual([
      'barrier',
      'lizardBarrier',
      'lizardCouponRate',
      'lizardRequiresNoKi',
    ])
    expect([...UNDERLYING_SUBS]).toEqual(['assetId', 'basePrice'])
  })
})
