import { describe, expect, it } from 'vitest'

import { KI_STATUS_LABELS } from '@/lib/format'
import type { KiStatus } from '@/lib/domain'
import {
  FILTER_KEYS,
  SORT_DEFAULT,
  filterQuery,
  isNarrowed,
  parseProductFilter,
  toListParams,
  type ProductFilter,
} from '@/lib/forms/query'

/**
 * SCR-201의 필터 파서 — **주소가 상태다** (P4 컷 2)
 *
 * 이 파일이 보는 것은 「조작된 주소가 무엇이 되는가」다. 화면(`page.tsx`)은
 * `server.ts`를 끌어오므로 어떤 스위트도 import할 수 없으니(AQ-23), 파싱을 순수
 * 모듈로 뺀 만큼이 검증 가능한 전부다.
 *
 * `KI_STATUS_VALUES`를 **여기서도 라벨 표에서 만든다** — 테스트가 값을 손으로 적으면
 * 세 번째 목록이 생기고, AQ-24가 정확히 목록 둘이 갈려서 생긴 결함이었다.
 */

const KI_VALUES = Object.keys(KI_STATUS_LABELS) as KiStatus[]

function parse(values: Record<string, string | string[] | undefined>): ProductFilter {
  return parseProductFilter(values, KI_VALUES)
}

const NOTHING: ProductFilter = {
  ownerId: null,
  status: null,
  kiStatus: null,
  sortBy: SORT_DEFAULT,
}

describe('빈 주소', () => {
  it('아무 필터도 없고 정렬은 기본값이다', () => {
    expect(parse({})).toEqual(NOTHING)
  })

  it('좁히지 않았다 — 빈 상태 두 갈래를 가르는 값이다', () => {
    expect(isNarrowed(parse({}))).toBe(false)
    // 정렬만 바꾸는 것은 좁히는 것이 아니다. 여기가 참이 되면 「전체 없음」 빈
    // 상태가 영원히 나타나지 않는다(기본 정렬이 항상 걸려 있으므로).
    expect(isNarrowed(parse({ sortBy: 'PRINCIPAL' }))).toBe(false)
  })

  it('계약 입력에 선택 키를 넣지 않는다', () => {
    // `exactOptionalPropertyTypes`에서 `undefined`를 넘기는 것과 키가 없는 것이
    // 다르고, 계약의 `params.x != null` 분기는 후자를 전제한다.
    expect(Object.keys(toListParams(parse({})))).toEqual(['sortBy'])
  })
})

describe('인식하는 값', () => {
  it('상태·정렬·소유자를 그대로 좁힌다', () => {
    const filter = parse({
      [FILTER_KEYS.ownerId]: '00000000-0000-4000-8000-000000000401',
      [FILTER_KEYS.status]: 'REDEEMED',
      [FILTER_KEYS.sortBy]: 'PRINCIPAL',
    })

    expect(filter.ownerId).toBe('00000000-0000-4000-8000-000000000401')
    expect(filter.status).toBe('REDEEMED')
    expect(filter.sortBy).toBe('PRINCIPAL')
    expect(isNarrowed(filter)).toBe(true)
  })

  it('공백을 다듬는다', () => {
    expect(parse({ [FILTER_KEYS.status]: '  ACTIVE  ' }).status).toBe('ACTIVE')
  })

  it('`D_DAY`도 받는다 — 화면이 고를 수 없어도 링크는 살아 있다', () => {
    /*
     * 정렬 선택지는 둘이다(`ProductFilters`) — `D_DAY`와 `EVALUATION_DATE`가 같은
     * 순서를 만들기 때문이다. 그러나 계약 파라미터는 셋이고 기존 주소가 죽으면 안 된다.
     */
    expect(parse({ [FILTER_KEYS.sortBy]: 'D_DAY' }).sortBy).toBe('D_DAY')
  })
})

describe('AQ-24 — KI 상태 다섯 값이 전부 필터가 된다', () => {
  it('라벨 표의 키 전수가 파싱된다', () => {
    // 3값이던 시절 `BELOW`·`NO_KI`는 어떤 필터로도 뽑을 수 없었다. 전수로 묶어
    // 두면 도메인 열거값이 늘 때 이 단언이 함께 늘어난다.
    expect(KI_VALUES.length).toBe(5)
    for (const value of KI_VALUES) {
      expect(parse({ [FILTER_KEYS.kiStatus]: value }).kiStatus).toBe(value)
    }
  })

  it('`BELOW`가 계약 입력까지 간다', () => {
    /*
     * §4.1이 「사용자 확인이 필요한 유일한 상태」라고 규정한 값이다. 파서가
     * 받더라도 `toListParams`가 떨어뜨리면 목록은 그대로다 — 두 단계를 함께 본다.
     */
    expect(toListParams(parse({ [FILTER_KEYS.kiStatus]: 'BELOW' })).kiStatus).toBe(
      'BELOW',
    )
  })
})

describe('조작된 주소를 오류로 만들지 않는다', () => {
  it('열거값이 아니면 그 축이 「전체」가 된다', () => {
    // 링크 하나가 앱을 막지 않는다. 그리고 화면의 `<select>`도 파싱 결과로
    // 렌더되므로 표시와 계약이 같은 값을 본다.
    expect(parse({ [FILTER_KEYS.status]: 'BOGUS' }).status).toBeNull()
    expect(parse({ [FILTER_KEYS.kiStatus]: 'SAFE_ISH' }).kiStatus).toBeNull()
  })

  it('정렬이 인식 불가면 기본값으로 돌아간다 — null이 아니다', () => {
    // `null`이면 계약이 DB 순서를 주고, 그 순서는 의미가 없는데 안정적이라
    // 의미가 있는 것처럼 보인다.
    expect(parse({ [FILTER_KEYS.sortBy]: 'NAME' }).sortBy).toBe(SORT_DEFAULT)
  })

  it('UUID가 아닌 소유자를 버린다', () => {
    expect(parse({ [FILTER_KEYS.ownerId]: 'not-a-uuid' }).ownerId).toBeNull()
    expect(parse({ [FILTER_KEYS.ownerId]: "' or 1=1--" }).ownerId).toBeNull()
  })

  it('실재하지 않는 UUID는 통과시킨다 — 0건이 정상 경로다', () => {
    // 실재 확인은 조회 결과가 한다. 여기서 막으면 「조건에 맞는 상품 없음」이라는
    // 정상 상태가 오류가 된다.
    const ghost = '00000000-0000-4000-8000-0000000000ff'
    expect(parse({ [FILTER_KEYS.ownerId]: ghost }).ownerId).toBe(ghost)
  })

  it('같은 키가 두 번 오면 버린다 — 첫 값을 고르지 않는다', () => {
    /*
     * `?status=A&status=B`는 폼이 만들 수 없는 형태다. 어느 쪽을 골라도 사용자가
     * 고르지 않은 하나를 우리가 고르는 것이 된다.
     */
    expect(parse({ [FILTER_KEYS.status]: ['ACTIVE', 'REDEEMED'] }).status).toBeNull()
  })
})

describe('질의 문자열 되돌리기', () => {
  it('아무것도 없으면 빈 문자열이다', () => {
    expect(filterQuery(NOTHING)).toBe('')
  })

  it('기본 정렬은 주소에 싣지 않는다', () => {
    // 아무것도 고르지 않은 상태의 주소가 깨끗해야 「필터가 걸려 있다」는 인상을
    // 주지 않는다.
    expect(filterQuery({ ...NOTHING, sortBy: SORT_DEFAULT })).toBe('')
    expect(filterQuery({ ...NOTHING, sortBy: 'PRINCIPAL' })).toBe('?sortBy=PRINCIPAL')
  })

  it('축을 갈아 끼우고 지운다 — 같은 함수로', () => {
    const filtered: ProductFilter = { ...NOTHING, status: 'ACTIVE', kiStatus: 'BELOW' }

    expect(filterQuery(filtered, { kiStatus: 'TOUCHED' })).toBe(
      '?status=ACTIVE&kiStatus=TOUCHED',
    )
    // `null`은 그 축을 지운다 — 「해제」가 별 규칙을 갖지 않는다.
    expect(filterQuery(filtered, { kiStatus: null })).toBe('?status=ACTIVE')
  })

  it('왕복한다 — 되돌린 주소를 다시 파싱하면 같은 필터다', () => {
    const filter: ProductFilter = {
      ownerId: '00000000-0000-4000-8000-000000000402',
      status: 'REDEEMED',
      kiStatus: 'NO_KI',
      sortBy: 'PRINCIPAL',
    }

    const query = filterQuery(filter)
    const values = Object.fromEntries(new URLSearchParams(query.slice(1)).entries())
    expect(parse(values)).toEqual(filter)
  })
})
