import { describe, expect, it } from 'vitest'

import { KI_STATUS_LABELS } from '@/lib/format'
import type { KiStatus } from '@/lib/domain'
import {
  FILTER_KEYS,
  OWNER_ALL,
  OWNER_MINE,
  SCHEDULE_KEYS,
  SCHEDULE_RANGE_DEFAULT,
  SCHEDULE_VIEW_DEFAULT,
  TAX_KEYS,
  SORT_DEFAULT,
  filterQuery,
  IMPORT_NEW,
  importHref,
  importTargetPath,
  isMineOnly,
  isNarrowed,
  isScheduleMineOnly,
  isScheduleNarrowed,
  isUuid,
  parseImportQuery,
  parseProductFilter,
  parseScheduleFilter,
  parseScheduleView,
  parseTaxFilter,
  scheduleQuery,
  toListParams,
  toScheduleParams,
  type ProductFilter,
  type ScheduleFilter,
} from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

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

/** 보는 사람. 파서는 이 값을 「본인」의 실체로 쓴다 (v2.6) */
const VIEWER = '00000000-0000-4000-8000-0000000000aa'

function parse(values: Record<string, string | string[] | undefined>): ProductFilter {
  return parseProductFilter(values, KI_VALUES, VIEWER)
}

/**
 * 빈 주소가 내는 값 — 이름이 ~~`NOTHING`~~ **`DEFAULTS`**가 됐다 (v2.6).
 *
 * 이름을 바꾼 것이 이 컷의 요약이다: **아무것도 고르지 않은 상태가 더 이상 「아무
 * 것도 좁히지 않음」이 아니다.** 소유자가 `MINE`이므로 좁혀져 있다.
 */
const DEFAULTS: ProductFilter = {
  owner: OWNER_MINE,
  status: null,
  kiStatus: null,
  sortBy: SORT_DEFAULT,
}

describe('빈 주소', () => {
  it('소유자는 본인이고 나머지는 없고 정렬은 기본값이다', () => {
    expect(parse({})).toEqual(DEFAULTS)
  })

  it('★ 기본값이 «좁힌다» — v2.6에서 뒤집힌 단언이다', () => {
    /*
     * 종전에는 `false`였다. 소유자 기본값이 본인이 되면서 **아무것도 고르지 않은
     * 화면이 이미 좁혀진 상태**이고, 그 결과로 두 번째 조회가 항상 돈다(왕복 2 → 4).
     * DOC-008 §5 SCR-201 ★★ ⓐ가 그 대가를 등재했다. 여기를 `false`로 되돌리려는
     * 변경은 그 결정을 되돌리는 것이므로 문서를 먼저 봐야 한다.
     */
    expect(isNarrowed(parse({}))).toBe(true)

    // 좁히지 않은 화면은 이제 「전체」를 고른 경우뿐이다.
    expect(isNarrowed(parse({ [FILTER_KEYS.owner]: OWNER_ALL }))).toBe(false)

    // 정렬만 바꾸는 것은 여전히 좁히는 것이 아니다 — 소유자를 「전체」로 두면
    // 정렬을 바꿔도 「좁히지 않음」이다(정렬이 축에 섞이지 않았다는 증거다).
    expect(
      isNarrowed(parse({ [FILTER_KEYS.owner]: OWNER_ALL, sortBy: 'PRINCIPAL' })),
    ).toBe(false)
  })

  it('★ 소유자만 기본값인 상태를 따로 가른다 — 빈 상태 셋째의 판정', () => {
    /*
     * `isNarrowed`가 이 상태를 **포함**하므로 화면은 이것을 먼저 봐야 한다. 순서를
     * 뒤집으면 「내 상품이 없다」가 영원히 나타나지 않고, 그 자리에 뜨는 「필터
     * 초기화」는 **초기화된 주소가 곧 본인 보기라 눌러도 같은 화면**이다.
     */
    expect(isMineOnly(parse({}))).toBe(true)
    expect(isNarrowed(parse({}))).toBe(true)

    // 다른 축이 하나라도 걸리면 이 상태가 아니다.
    expect(isMineOnly(parse({ [FILTER_KEYS.status]: 'ACTIVE' }))).toBe(false)
    expect(isMineOnly(parse({ [FILTER_KEYS.kiStatus]: 'BELOW' }))).toBe(false)
    // 「전체」도, 남의 것으로 좁힌 것도 아니다.
    expect(isMineOnly(parse({ [FILTER_KEYS.owner]: OWNER_ALL }))).toBe(false)
    expect(
      isMineOnly(parse({ [FILTER_KEYS.owner]: '00000000-0000-4000-8000-0000000000bb' })),
    ).toBe(false)

    // 정렬은 좁히지 않으므로 이 판정도 흔들지 않는다.
    expect(isMineOnly(parse({ sortBy: 'PRINCIPAL' }))).toBe(true)
  })

  it('계약 입력에 «본인»이 실린다 — 상징이 아니라 id다', () => {
    // `exactOptionalPropertyTypes`에서 `undefined`를 넘기는 것과 키가 없는 것이
    // 다르고, 계약의 `params.x != null` 분기는 후자를 전제한다.
    expect(toListParams(parse({}), VIEWER)).toEqual({
      sortBy: SORT_DEFAULT,
      ownerId: VIEWER,
    })

    // 「전체」일 때만 소유자 키가 빠진다.
    expect(
      Object.keys(toListParams(parse({ [FILTER_KEYS.owner]: OWNER_ALL }), VIEWER)),
    ).toEqual(['sortBy'])
  })
})

describe('★ 소유자 축이 셋이다 — 한 값이 두 뜻을 갖지 않는다 (v2.6)', () => {
  /*
   * 이 describe가 지키는 것은 **결함의 부류**다. 종전 `ownerId: string | null`은
   * `null`이 「전체」였고, 운영 계정이 하나인 동안 「본인」과 「전체」가 같은 화면을
   * 내므로 그 겹침이 관측되지 않았다. Secondary 계정이 서자마자 기본 화면이 남의
   * 상품을 섞어 보여 줬다(2026-08-07).
   */

  it('두 상수가 UUID와 «형식으로» 배타다 — 그것이 셋을 가르는 근거다', () => {
    /*
     * 축을 문자열 하나로 두면서 태그 유니온을 쓰지 않은 유일한 근거가 이것이다.
     * 상수를 UUID처럼 생긴 값으로 바꾸면 사용자 id와 충돌하고 여기가 빨간불이 된다.
     */
    expect(isUuid(OWNER_MINE)).toBe(false)
    expect(isUuid(OWNER_ALL)).toBe(false)
    expect(OWNER_MINE).not.toBe(OWNER_ALL)
  })

  it('자기 UUID는 `MINE`으로 정규화된다 — 같은 화면에 주소가 둘이면 안 된다', () => {
    /*
     * 정규화하지 않으면 `?ownerId=<내 id>`와 키 없는 주소가 같은 목록을 내면서
     * `<select>`의 선택 항목만 갈린다. 그리고 `filterQuery`가 기본값을 싣지 않는
     * 규약이 한쪽에서만 성립한다.
     */
    expect(parse({ [FILTER_KEYS.owner]: VIEWER }).owner).toBe(OWNER_MINE)
    expect(filterQuery(parse({ [FILTER_KEYS.owner]: VIEWER }))).toBe('')
  })

  it('남의 UUID는 그대로 남고 계약까지 간다', () => {
    const other = '00000000-0000-4000-8000-0000000000bb'
    expect(parse({ [FILTER_KEYS.owner]: other }).owner).toBe(other)
    expect(toListParams(parse({ [FILTER_KEYS.owner]: other }), VIEWER).ownerId).toBe(
      other,
    )
  })

  it('「전체」는 고른 값이며 계약에서 소유자 키가 사라진다', () => {
    expect(parse({ [FILTER_KEYS.owner]: OWNER_ALL }).owner).toBe(OWNER_ALL)
    expect(
      toListParams(parse({ [FILTER_KEYS.owner]: OWNER_ALL }), VIEWER).ownerId,
    ).toBeUndefined()
  })

  it('★ 「전체」는 오직 명시적으로만 된다 — 부재·쓰레기값은 전부 본인이다', () => {
    /*
     * 이 케이스가 사용자의 요구 그 자체다: **필터에서 「전체」를 눌렀을 때만 전체가
     * 보인다.** 인식하지 못한 값이 「전체」로 떨어지면 조작된 주소 하나가 기본값을
     * 무력화한다.
     */
    for (const raw of ['', 'ALL_USERS', 'all', 'not-a-uuid', "' or 1=1--", 'MINE']) {
      expect(parse({ [FILTER_KEYS.owner]: raw }).owner, raw).toBe(OWNER_MINE)
    }
    // 배열도 버린다 — 폼이 만들 수 없는 형태다(다른 축과 같은 규약).
    expect(parse({ [FILTER_KEYS.owner]: [OWNER_ALL, VIEWER] }).owner).toBe(OWNER_MINE)
  })
})

describe('인식하는 값', () => {
  it('상태·정렬·소유자를 그대로 좁힌다', () => {
    const filter = parse({
      [FILTER_KEYS.owner]: '00000000-0000-4000-8000-000000000401',
      [FILTER_KEYS.status]: 'REDEEMED',
      [FILTER_KEYS.sortBy]: 'PRINCIPAL',
    })

    expect(filter.owner).toBe('00000000-0000-4000-8000-000000000401')
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
    expect(toListParams(parse({ [FILTER_KEYS.kiStatus]: 'BELOW' }), VIEWER).kiStatus).toBe(
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

  it('UUID가 아닌 소유자를 버린다 — ~~`null`~~ **기본값(본인)**이 된다', () => {
    // v2.6: 버린 결과가 「전체」가 아니라 「본인」이다. 위 ★ describe가 그 전수를 본다.
    expect(parse({ [FILTER_KEYS.owner]: 'not-a-uuid' }).owner).toBe(OWNER_MINE)
    expect(parse({ [FILTER_KEYS.owner]: "' or 1=1--" }).owner).toBe(OWNER_MINE)
  })

  it('실재하지 않는 UUID는 통과시킨다 — 0건이 정상 경로다', () => {
    // 실재 확인은 조회 결과가 한다. 여기서 막으면 「조건에 맞는 상품 없음」이라는
    // 정상 상태가 오류가 된다.
    const ghost = '00000000-0000-4000-8000-0000000000ff'
    expect(parse({ [FILTER_KEYS.owner]: ghost }).owner).toBe(ghost)
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
    expect(filterQuery(DEFAULTS)).toBe('')
  })

  it('기본 정렬은 주소에 싣지 않는다', () => {
    // 아무것도 고르지 않은 상태의 주소가 깨끗해야 「필터가 걸려 있다」는 인상을
    // 주지 않는다.
    expect(filterQuery({ ...DEFAULTS, sortBy: SORT_DEFAULT })).toBe('')
    expect(filterQuery({ ...DEFAULTS, sortBy: 'PRINCIPAL' })).toBe('?sortBy=PRINCIPAL')
  })

  it('축을 갈아 끼우고 지운다 — 같은 함수로', () => {
    const filtered: ProductFilter = { ...DEFAULTS, status: 'ACTIVE', kiStatus: 'BELOW' }

    expect(filterQuery(filtered, { kiStatus: 'TOUCHED' })).toBe(
      '?status=ACTIVE&kiStatus=TOUCHED',
    )
    // `null`은 그 축을 지운다 — 「해제」가 별 규칙을 갖지 않는다.
    expect(filterQuery(filtered, { kiStatus: null })).toBe('?status=ACTIVE')
  })

  it('왕복한다 — 되돌린 주소를 다시 파싱하면 같은 필터다', () => {
    const filter: ProductFilter = {
      owner: '00000000-0000-4000-8000-000000000402',
      status: 'REDEEMED',
      kiStatus: 'NO_KI',
      sortBy: 'PRINCIPAL',
    }

    const query = filterQuery(filter)
    const values = Object.fromEntries(new URLSearchParams(query.slice(1)).entries())
    expect(parse(values)).toEqual(filter)
  })

  it('★ 소유자 셋이 전부 왕복한다 — 「전체」가 주소를 지나 살아남는다', () => {
    /*
     * 「전체」만 왕복이 깨지면 사용자가 고른 값이 링크를 지나며 조용히 본인으로
     * 되돌아간다 — 페이지 이동·보기 전환이 전부 `filterQuery`를 재사용하므로
     * 그 한 곳이 깨지면 세 경로가 함께 깨진다.
     */
    const other = '00000000-0000-4000-8000-000000000402'
    for (const owner of [OWNER_MINE, OWNER_ALL, other]) {
      const query = filterQuery({ ...DEFAULTS, owner })
      const values = Object.fromEntries(new URLSearchParams(query.slice(1)).entries())
      expect(parse(values).owner, owner).toBe(owner)
    }
    // 기본값만 주소에서 사라진다.
    expect(filterQuery({ ...DEFAULTS, owner: OWNER_MINE })).toBe('')
    expect(filterQuery({ ...DEFAULTS, owner: OWNER_ALL })).toBe(
      `?${FILTER_KEYS.owner}=${OWNER_ALL}`,
    )
  })
})

// ---------------------------------------------------------------------------
// SCR-301 평가일정 — 컷 7
// ---------------------------------------------------------------------------

/**
 * 같은 파일에 두는 이유: **같은 규약을 공유한다.** 인식하지 못한 값은 버리고,
 * 배열은 버리고, 소유자는 UUID 형식만 본다. 파일을 나누면 그 셋이 두 파서에서
 * 같다는 사실을 아무도 대조하지 않는다.
 */
const ASOF = '2026-07-28'

const SCHEDULE_DEFAULTS: ScheduleFilter = {
  owner: OWNER_MINE,
  range: SCHEDULE_RANGE_DEFAULT,
  activeOnly: false,
}

/** 파서가 「본인」의 실체로 쓰는 값 — 상품 쪽 `VIEWER`와 같다 */
function parseSchedule(values: Record<string, string | string[] | undefined>) {
  return parseScheduleFilter(values, VIEWER)
}

describe('평가일정 필터 (SCR-301)', () => {
  it('빈 주소는 전체 기간 · 본인이고 ★ 좁힌다 (v2.6에서 뒤집혔다)', () => {
    /*
     * ★ **기간 기본값이 `ALL`인 것은 그대로다.** DOC-008 §5가 「과거/미래 구분」을
     * 주요 요소로 규정하므로 기본 화면에 둘 다 있어야 한다.
     *
     * 바뀐 것은 **소유자**다. 종전에는 기본 화면이 아무것도 좁히지 않아 조회가 한
     * 번이었는데, 소유자 기본값이 본인이 되면서 **항상 두 번**이 된다(왕복 2 → 4).
     * 이 파일의 종전 서술이 「기본을 「다가오는」으로 두면 항상 두 번 불러야 한다」로
     * 그 위험을 이미 적고 있었고 — **경고한 그대로 일어났으며 이번엔 의도한 것**이다.
     * DOC-008 §5 SCR-201 ★★ ⓐ가 대가를 등재했다.
     */
    expect(parseSchedule({})).toEqual(SCHEDULE_DEFAULTS)
    expect(isScheduleNarrowed(parseSchedule({}))).toBe(true)
    expect(toScheduleParams(parseSchedule({}), ASOF, VIEWER)).toEqual({
      ownerId: VIEWER,
    })

    // 좁히지 않은 화면은 소유자 「전체」 + 기본 기간뿐이다.
    const all = parseSchedule({ [SCHEDULE_KEYS.owner]: OWNER_ALL })
    expect(isScheduleNarrowed(all)).toBe(false)
    expect(toScheduleParams(all, ASOF, VIEWER)).toEqual({})
  })

  it('★ 소유자만 기본값인 상태를 따로 가른다 — 빈 상태 둘째의 판정', () => {
    // `isMineOnly`와 같은 근거·같은 순서다(뒤의 판정이 앞을 포함한다).
    expect(isScheduleMineOnly(parseSchedule({}))).toBe(true)
    expect(isScheduleMineOnly(parseSchedule({ [SCHEDULE_KEYS.range]: 'PAST' }))).toBe(
      false,
    )
    expect(
      isScheduleMineOnly(parseSchedule({ [SCHEDULE_KEYS.activeOnly]: 'on' })),
    ).toBe(false)
    expect(
      isScheduleMineOnly(parseSchedule({ [SCHEDULE_KEYS.owner]: OWNER_ALL })),
    ).toBe(false)
  })

  it('기간 셋이 각각 다른 계약 입력이 된다', () => {
    // `from`·`to`는 질의 조건이다(Q-05) — 행 단위가 차수여서 조회 후로 미루면
    // Q-06의 상한에 가장 먼저 닿는다(§4.4).
    const upcoming = parseSchedule({ [SCHEDULE_KEYS.range]: 'UPCOMING' })
    const past = parseSchedule({ [SCHEDULE_KEYS.range]: 'PAST' })

    // v2.6: 소유자 기본값이 본인이므로 `ownerId`가 «항상» 함께 실린다.
    expect(toScheduleParams(upcoming, ASOF, VIEWER)).toEqual({
      from: ASOF,
      ownerId: VIEWER,
    })
    expect(toScheduleParams(past, ASOF, VIEWER)).toEqual({ to: ASOF, ownerId: VIEWER })
    // 기간도 좁힌다 — 정렬과 다르다(순서를 바꾸는 것이 아니라 행을 뺀다).
    expect(isScheduleNarrowed(upcoming)).toBe(true)
    expect(isScheduleNarrowed(past)).toBe(true)
  })

  it('`PAST`의 `to`가 기준일 그 자체다 — 경계는 계약이 정한다', () => {
    /*
     * ★ 계약의 `to`는 포함(`lte`)이고 「경과」는 `dDay < 0`이므로(당일은 경과가
     * 아니다) 이 질의는 **당일 차수까지 실어 온다.** 그 한 줄을 여기서 빼려면
     * 「기준일의 하루 전」을 계산해야 하고, 그러면 경계 판정이 계약과 화면 두 곳에
     * 생긴다 — 화면은 `splitByPast`로 거른다(`tests/app/schedule.test.ts`).
     *
     * 즉 이 단언은 「하루를 빼지 않는다」를 고정한다. 빼는 구현으로 바꾸면 여기가
     * 빨간불이 되고, 그때 물어야 하는 것은 경계를 누가 정하는가다.
     */
    expect(toScheduleParams(parseSchedule({ range: 'PAST' }), ASOF, VIEWER).to).toBe(ASOF)
  })

  it('미상환만 보기는 체크박스 규약을 따른다 — 부재가 `false`다', () => {
    expect(parseSchedule({}).activeOnly).toBe(false)
    // 브라우저는 체크될 때 `on`을 보낸다. 값은 보지 않는다.
    expect(parseSchedule({ [SCHEDULE_KEYS.activeOnly]: 'on' }).activeOnly).toBe(true)
    /*
     * 주소를 손으로 적은 `activeOnly=0`도 「켬」이다 — 폼이 만들 수 없는 형태에
     * 특별한 뜻을 주지 않는다(`parse.ts`의 `checkbox`와 같은 규약이며, 그쪽은
     * 히든 이송이 값 없는 키를 실었을 때 `true`가 되는 것을 막기 위해 빈 문자열을
     * `false`로 둔다).
     */
    expect(parseSchedule({ [SCHEDULE_KEYS.activeOnly]: '0' }).activeOnly).toBe(true)
    expect(parseSchedule({ [SCHEDULE_KEYS.activeOnly]: '' }).activeOnly).toBe(false)
    expect(toScheduleParams(parseSchedule({ activeOnly: 'on' }), ASOF, VIEWER)).toEqual({
      activeOnly: true,
      ownerId: VIEWER,
    })
  })

  it('소유자 축이 SCR-201과 같은 키를 쓴다', () => {
    /*
     * 두 화면의 소유자 필터가 같은 뜻이므로 주소에서도 같아야 한다 — 키가 갈리면
     * 한쪽 링크를 다른 화면에 붙였을 때 그 축이 조용히 사라진다.
     */
    expect(SCHEDULE_KEYS.owner).toBe(FILTER_KEYS.owner)
    // 주소의 «키 이름»은 v2.6에서도 그대로다 — 바꾸면 §7.4가 그린 전이로 공유된
    // 링크가 전부 죽는다(타입의 필드명만 `owner`로 바뀌었다).
    expect(SCHEDULE_KEYS.owner).toBe('ownerId')

    const owner = '00000000-0000-4000-8000-000000000403'
    expect(parseSchedule({ ownerId: owner }).owner).toBe(owner)
    expect(toScheduleParams(parseSchedule({ ownerId: owner }), ASOF, VIEWER)).toEqual({
      ownerId: owner,
    })
  })

  it('조작된 주소가 오류가 되지 않는다 — 같은 규약이다', () => {
    expect(parseSchedule({ [SCHEDULE_KEYS.range]: 'YESTERDAY' }).range).toBe(
      SCHEDULE_RANGE_DEFAULT,
    )
    // v2.6: 버린 결과가 「전체」가 아니라 「본인」이다(상품 쪽과 같은 규약).
    expect(parseSchedule({ ownerId: 'not-a-uuid' }).owner).toBe(OWNER_MINE)
    // 같은 키가 두 번 오면 버린다 — 폼이 만들 수 없는 형태다.
    expect(parseSchedule({ [SCHEDULE_KEYS.range]: ['PAST', 'UPCOMING'] }).range).toBe(
      SCHEDULE_RANGE_DEFAULT,
    )
  })

  it('세 축이 함께 걸린다', () => {
    const owner = '00000000-0000-4000-8000-000000000404'
    const filter = parseSchedule({
      ownerId: owner,
      [SCHEDULE_KEYS.range]: 'UPCOMING',
      [SCHEDULE_KEYS.activeOnly]: 'on',
    })

    expect(toScheduleParams(filter, ASOF, VIEWER)).toEqual({
      from: ASOF,
      ownerId: owner,
      activeOnly: true,
    })
  })
})

/**
 * 보기 축 — SCR-301 상품별 / 시간순 (P6 컷 6)
 *
 * **`ScheduleFilter` 밖에 있다.** 그 사실 자체가 아래 첫 케이스가 지키는 것이며,
 * 이 describe가 위 것과 분리되어 있는 이유이기도 하다.
 */
describe('평가일정 보기 (SCR-301)', () => {
  it('★ 보기는 좁히지 않는다 — 빈 상태와 두 번째 조회가 여기 달려 있다', () => {
    /*
     * 이 파일에서 가장 값이 큰 단언이다. `view`가 `ScheduleFilter` 안에 있었다면
     * 누군가 `isScheduleNarrowed`의 OR에 더했을 것이고(필터처럼 보인다), 그러면
     * **필터를 하나도 걸지 않은 기본 화면이 「좁혀짐」이 된다** — 빈 상태가
     * 「등록된 평가일정이 없다 · 등록」에서 「조건에 맞는 평가일이 없다 · 필터
     * 초기화」로 바뀌고, 소유자 선택지를 위한 두 번째 조회가 항상 돈다.
     *
     * 타입을 갈랐으므로 그 필드는 OR의 사정거리에 들어올 수 없다. 이 케이스는
     * 그 분리가 유지되는지를 «값으로» 확인한다.
     */
    const values = { [SCHEDULE_KEYS.view]: 'TIME' }

    expect(parseScheduleView(values)).toBe('TIME')
    expect(parseSchedule(values)).toEqual(SCHEDULE_DEFAULTS)

    /*
     * ★★ **소유자를 「전체」로 열어 놓고 재야 이 단언이 «판별»한다** (v2.6).
     *
     * 기본 상태에서 재면 소유자 축 때문에 `isScheduleNarrowed`가 이미 `true`이고,
     * 그러면 `view`가 OR에 섞여 들어와도 값이 바뀌지 않아 **이 케이스가 초록인 채로
     * 아무것도 증명하지 못한다.** 다른 축을 전부 「좁히지 않음」으로 둔 상태에서만
     * `view`의 기여가 값으로 드러난다 — 관측 도구가 명제를 판별하는지 먼저 본다.
     */
    const opened = { ...values, [SCHEDULE_KEYS.owner]: OWNER_ALL }
    expect(isScheduleNarrowed(parseSchedule(opened))).toBe(false)
    // 계약 파라미터도 아니다 — 표현이지 조회 조건이 아니다
    expect(toScheduleParams(parseSchedule(opened), ASOF, VIEWER)).toEqual({})

    // 그리고 기본 상태에서 좁혀진 이유는 «소유자»뿐이다 — 보기가 아니다.
    expect(isScheduleMineOnly(parseSchedule(values))).toBe(true)
  })

  it('기본은 상품별이고 인식하지 못한 값은 기본값이다', () => {
    // `range`·`sortBy`와 같은 규약이다 — 손으로 적은 주소에 특별한 뜻을 주지 않는다.
    expect(parseScheduleView({})).toBe(SCHEDULE_VIEW_DEFAULT)
    expect(parseScheduleView({})).toBe('PRODUCT')
    expect(parseScheduleView({ [SCHEDULE_KEYS.view]: 'CALENDAR' })).toBe('PRODUCT')
    expect(parseScheduleView({ [SCHEDULE_KEYS.view]: '' })).toBe('PRODUCT')
    // 배열은 버린다 — 다른 축과 같은 규약이다(`one`이 문자열만 받는다).
    expect(parseScheduleView({ [SCHEDULE_KEYS.view]: ['TIME'] })).toBe('PRODUCT')
  })

  it('기본값은 주소에 싣지 않는다', () => {
    expect(scheduleQuery(SCHEDULE_DEFAULTS, SCHEDULE_VIEW_DEFAULT)).toBe('')
    expect(scheduleQuery(SCHEDULE_DEFAULTS, 'TIME')).toBe('?view=TIME')
  })

  it('★ 전환 링크가 현재 필터를 함께 싣는다', () => {
    /*
     * `dashboardQuery`는 축이 하나뿐이라 질의를 처음부터 조립하지만 여기는 넷이다.
     * 싣지 않으면 보기를 바꾸는 순간 소유자·기간·미상환 필터가 사라진다 —
     * `pageQuery`가 같은 자리에서 같은 일을 한다.
     */
    const owner = '11111111-2222-4333-8444-555555555555'
    const filter = parseSchedule({
      [SCHEDULE_KEYS.owner]: owner,
      [SCHEDULE_KEYS.range]: 'UPCOMING',
      [SCHEDULE_KEYS.activeOnly]: 'on',
    })

    const query = scheduleQuery(filter, 'TIME')
    expect(query).toContain(`${SCHEDULE_KEYS.owner}=${owner}`)
    expect(query).toContain('range=UPCOMING')
    expect(query).toContain('view=TIME')
  })

  it('★ 되돌린 주소를 다시 파싱하면 같은 필터·같은 보기다', () => {
    /*
     * 왕복이 항등이어야 전환이 필터를 보존한다. ⚠️ 함정은 `activeOnly`다 —
     * 파서가 `!== ''`로 읽으므로 `activeOnly=`(빈 문자열)로 직렬화하면 되읽을 때
     * **꺼진다.** `'on'`으로 적는 이유가 그것이고, 이 케이스가 그것을 잡는다.
     */
    const cases: Array<[ScheduleFilter, 'PRODUCT' | 'TIME']> = [
      [SCHEDULE_DEFAULTS, 'PRODUCT'],
      [SCHEDULE_DEFAULTS, 'TIME'],
      // 소유자 셋을 전부 태운다 — 「전체」가 왕복에서 살아남지 않으면 사용자가
      // 고른 값이 링크를 지나며 조용히 본인으로 되돌아간다 (v2.6).
      [{ ...SCHEDULE_DEFAULTS, owner: OWNER_ALL }, 'TIME'],
      [{ owner: OWNER_ALL, range: 'PAST', activeOnly: true }, 'TIME'],
      [
        {
          owner: '11111111-2222-4333-8444-555555555555',
          range: 'UPCOMING',
          activeOnly: true,
        },
        'PRODUCT',
      ],
    ]

    for (const [filter, view] of cases) {
      const parsed = Object.fromEntries(
        new URLSearchParams(scheduleQuery(filter, view)),
      )
      expect(parseSchedule(parsed)).toEqual(filter)
      expect(parseScheduleView(parsed)).toBe(view)
    }
  })

  it('보기 키가 필터 키와 충돌하지 않는다', () => {
    const filterKeys = Object.values(FILTER_KEYS)
    expect(filterKeys).not.toContain(SCHEDULE_KEYS.view)
  })
})

// ---------------------------------------------------------------------------
// SCR-401 세금 계산 — 컷 8
// ---------------------------------------------------------------------------

/**
 * **조정값이 주소에 있다는 것이 「저장되지 않는다」의 형태다** (DOC-011 §4.6).
 *
 * 조정 폼이 `<form method="GET">`이므로 변경 계약으로 가는 경로가 아예 없다. 이
 * 파서가 그 주소를 계약의 `override`로 옮기며, **`null`인지 아닌지가 화면의 문구를
 * 가른다** — 계약의 `isSaved = false`가 「저장된 프로필 없음」과 「조정 중」을 한
 * 거짓으로 접기 때문이다(§4.6). 그 구분을 만드는 자리가 여기다.
 */
const HEALTH_TYPES = ['EMPLOYEE', 'REGIONAL', 'DEPENDENT', 'NONE'] as const

describe('세금 필터 (SCR-401)', () => {
  it('빈 주소는 연도도 조정도 없다 — 화면이 기준일의 연도를 쓴다', () => {
    expect(parseTaxFilter({}, HEALTH_TYPES)).toEqual({ year: null, override: null })
  })

  it('연도는 4자리만 받는다 — 범위는 보지 않는다', () => {
    /*
     * 어느 연도가 유효한지는 세율 시드가 정하고(§4.6 `seededYears`) 그 지식은 조회
     * 결과에 있다. 여기서 범위를 정하면 시드가 늘 때 두 곳을 고쳐야 한다.
     */
    expect(parseTaxFilter({ year: '2026' }, HEALTH_TYPES).year).toBe(2026)
    // 시드보다 과거여도 파서는 통과시킨다 — 화면이 그 예외를 안내로 바꾼다.
    expect(parseTaxFilter({ year: '1999' }, HEALTH_TYPES).year).toBe(1999)
    for (const bogus of ['26', '20261', 'two-thousand', '', '-2026']) {
      expect(parseTaxFilter({ year: bogus }, HEALTH_TYPES).year, bogus).toBeNull()
    }
  })

  it('축 하나만 있어도 조정이다 — 계약의 `override`가 필드별 선택이다', () => {
    const filter = parseTaxFilter({ [TAX_KEYS.otherIncomeBase]: '50000000' }, HEALTH_TYPES)
    expect(filter.override).toEqual({ otherIncomeBase: '50000000' })
  })

  it('세 축이 함께 실린다', () => {
    const filter = parseTaxFilter(
      {
        [TAX_KEYS.otherIncomeBase]: '50000000',
        [TAX_KEYS.otherFinancialIncome]: '3000000',
        [TAX_KEYS.healthInsuranceType]: 'REGIONAL',
      },
      HEALTH_TYPES,
    )
    expect(filter.override).toEqual({
      otherIncomeBase: '50000000',
      otherFinancialIncome: '3000000',
      healthInsuranceType: 'REGIONAL',
    })
  })

  it('★ 빈 칸은 조정이 아니다 — `0`으로 읽지 않는다', () => {
    /*
     * ★ `'0'`으로 읽으면 **사용자가 적지 않은 값을 우리가 지어낸다.** 그리고 그
     * 상태가 `override`가 되어 「시뮬레이션 중」으로 표시되므로, 저장된 프로필이
     * 있는 사용자에게 「저장되지 않았다」가 뜬다 — 원인 둘을 가르는 값이 잘못 켜지는
     * 형태다(§4.6).
     */
    const filter = parseTaxFilter(
      { [TAX_KEYS.otherIncomeBase]: '', [TAX_KEYS.otherFinancialIncome]: '   ' },
      HEALTH_TYPES,
    )
    expect(filter.override).toBeNull()
  })

  it('주소에 실린 쉼표를 지운다 — 값은 바뀌지 않는다', () => {
    /*
     * 조정 폼이 GET이므로 직전 값이 주소를 지나 입력란으로 돌아온다. 쉼표가 섞이면
     * V-19가 「정수로 입력한다」를 내는데 사용자에게는 자기가 적은 것이 정수다 —
     * `parse.ts`의 `amountText`가 폼 경로에서 막는 것과 같은 함정이며 주소 경로에도
     * 있다. 15자리로 확인한다(`numeric(15,0)` 상한이며 그 위에서 float64가 값을 민다).
     */
    const filter = parseTaxFilter(
      { [TAX_KEYS.otherIncomeBase]: '123,456,789,012,345' },
      HEALTH_TYPES,
    )
    expect(filter.override?.otherIncomeBase).toBe('123456789012345')
  })

  it('인식하지 못한 가입 유형은 그 축을 조정하지 않는다', () => {
    // 조작된 주소가 오류가 되지 않는다(SCR-201·301과 같은 규약). 그 축은 저장값이
    // 그대로 쓰인다 — 계약의 `override`가 필드별 선택이므로 자연히 그렇게 된다.
    const filter = parseTaxFilter(
      { [TAX_KEYS.healthInsuranceType]: 'GOLD_MEMBER' },
      HEALTH_TYPES,
    )
    expect(filter.override).toBeNull()

    const mixed = parseTaxFilter(
      {
        [TAX_KEYS.healthInsuranceType]: 'GOLD_MEMBER',
        [TAX_KEYS.otherIncomeBase]: '1000',
      },
      HEALTH_TYPES,
    )
    expect(mixed.override).toEqual({ otherIncomeBase: '1000' })
  })

  it('같은 키가 두 번 오면 버린다 — 폼이 만들 수 없는 형태다', () => {
    const filter = parseTaxFilter(
      { [TAX_KEYS.healthInsuranceType]: ['EMPLOYEE', 'REGIONAL'], year: ['2026', '2025'] },
      HEALTH_TYPES,
    )
    expect(filter).toEqual({ year: null, override: null })
  })

  /**
   * ★ **금액 축도 인식할 때만 담는다** — P4.5.
   *
   * v1.1까지 금액 두 축은 쉼표·공백만 지우고 **그대로** 계약으로 갔다. 그 칸이
   * `type="text" inputMode="numeric"`이고 폼이 GET이므로, 글자를 적고 「조정 적용」을
   * 누르면 값이 `dec()`에 닿아 **오류 화면**이 됐다. 형식은 저장 축(V-19)과 같은
   * `/^\d+$/`이며 DOC-011 §4.6이 정본이다.
   *
   * ## 음성 대조 — 넓히는 방향으로 셋, 각각 다른 케이스가 갈린다
   *
   * `amountOr`의 정규식을 넓혀 실행하고 되돌렸다. **지우지 않고 넓힌다** — 통째로
   * 지우면(`return digits`) 9건이 깨지는데 그중 5건은 빈 칸 처리가 함께 무너져서이고
   * (이 리팩터가 빈 칸 검사를 `amountOr` 안으로 옮겼다) 그러면 「형식 검사가 무게를
   * 지는가」를 묻지 못한다. **대조가 빨간불이어도 넓으면 정밀하지 않다.**
   *
   * | 넓힌 것 | 실패한 케이스 |
   * |---|---|
   * | `/^-?\d+$/` — 부호 허용 | **2건** — 「형식이 아닌 금액」(부호 단언) · 「세 축이 전부 버려지면」 |
   * | `/^\d+(\.\d+)?$/` — 소수 허용 | **2건** — 「형식이 아닌 금액」(소수 단언) · 「세 축이 전부 버려지면」 |
   * | `/^[0-9a-fxe+.]+$/i` — 16진·지수 통과 | **4건** — 위 둘 + 「`dec()`를 통과하지만…」 + 「한 축이 형식 위반이어도…」 |
   *
   * 셋이 각각 다른 집합을 내므로 이 케이스들은 항진명제가 아니다. 셋째 줄이 넷을
   * 잡는 이유는 `'abc'`가 16진 문자로만 이루어져 그 변형에서 통과한다는 것이다 —
   * **비숫자 단언의 무게를 실제로 지는 것은 그 변형 하나다.**
   *
   * > **무효 대조 둘을 먼저 지났다는 것도 적는다.** ① `perl` 치환이 적용되지 않아
   * > 전부 초록이었다 — 초록을 결과로 읽었다면 「대조했다」는 거짓 기록이 남는다.
   * > `grep`으로 치환 결과를 눈으로 확인해 잡았다. ② 스크립트의 `argv` 인덱스를 틀려
   * > 정규식 자리에 미정의 식별자가 들어가 12건이 깨졌다 — **빨간불이지만 무효다**
   * > (측정한 것이 「넓혔을 때」가 아니라 `ReferenceError`다). 음성 대조는 빨간불의
   * > **유무가 아니라 원인**을 확인해야 한다.
   *
   * ## 무효 대조 세 유형을 순서대로 배제한다
   *
   * 이 프로젝트가 세 번 걸린 형태이므로 각각을 명시적으로 배제한다.
   *
   * ① **픽스처가 두 구현에서 일치한다** (`tests/integration/`의 상환 1건이 오름·내림을
   *    같게 만든 부류). 여기서는 **입력이 통과/거부를 가르는 값들**이다 — `'1000'`은
   *    두 구현에서 담기고 `'abc'`는 갈린다. 두 결과를 **같은 케이스 안에서** 대조하므로
   *    픽스처가 대조를 무효화할 수 없다.
   * ② **테스트가 값을 얹는다** (`intent=NEXT`를 손으로 붙였던 부류). 여기서는
   *    `TAX_KEYS`를 **모듈에서 가져온다** — 키 문자열을 손으로 적으면 화면·파서가
   *    합의한 키가 아니라 테스트가 지어낸 키를 검사하게 된다.
   * ③ **단언이 깨뜨림에 불변인 대리 지표를 본다** (`forms.length === 2`가 폼 병합에
   *    갈리지 않았던 부류). `override`의 **키 집합과 값**을 `toEqual`로 보고
   *    `toBeNull()`과 짝지운다 — 「담기지 않았다」와 「담겼는데 값이 다르다」가 다른
   *    단언이며, 개수만 보는 대리 지표를 쓰지 않는다.
   */
  it('★ 형식이 아닌 금액은 그 축을 조정하지 않는다 — 오류 화면이 아니다', () => {
    // 비숫자 — v1.1에서는 이 문자열이 계약의 `dec()`까지 갔다
    expect(parseTaxFilter({ [TAX_KEYS.otherIncomeBase]: 'abc' }, HEALTH_TYPES).override)
      .toBeNull()

    // 부호·소수 — 저장 축(V-19 `/^\d+$/`)이 거부하므로 조정 축도 거부한다.
    // 넓으면 「화면이 저장할 수 없는 숫자를 정상 결과로 렌더」하는 상태가 된다.
    expect(
      parseTaxFilter({ [TAX_KEYS.otherFinancialIncome]: '-5000000' }, HEALTH_TYPES)
        .override,
    ).toBeNull()
    expect(
      parseTaxFilter({ [TAX_KEYS.otherFinancialIncome]: '1.5' }, HEALTH_TYPES).override,
    ).toBeNull()
  })

  it('★ `dec()`를 통과하지만 틀린 값이 되는 둘도 거부한다', () => {
    /*
     * ★ **이 둘이 비숫자보다 나쁘다** — 오류 화면은 보이고 이것들은 보이지 않는다.
     * 실측(`node`): `new Decimal('0x1f')` → **31**, `new Decimal('1e999')` → `1e+999`
     * 이고 `isFinite()`가 참이므로 `dec()`의 검사를 통과한다. 즉 형식 검사가 없으면
     * 사용자가 적지 않은 금액이 조용히 정상 결과가 된다.
     */
    expect(parseTaxFilter({ [TAX_KEYS.otherIncomeBase]: '0x1f' }, HEALTH_TYPES).override)
      .toBeNull()
    expect(
      parseTaxFilter({ [TAX_KEYS.otherFinancialIncome]: '1e999' }, HEALTH_TYPES).override,
    ).toBeNull()
  })

  it('★ 한 축이 형식 위반이어도 나머지 축은 조정된다', () => {
    /*
     * ★ **버림이 축 단위임을 고정한다.** 계약의 `override`가 필드별 선택이므로
     * (§4.6 부분 지정) 한 축의 실패가 다른 축을 죽이면 안 된다. 열거 축이 이미
     * 같은 규약이며(바로 위 케이스) 이 단언이 금액 축을 그 규약에 붙인다.
     *
     * 이 케이스가 음성 대조에서 **셋째로** 갈린 자리다 — 형식 검사를 지우면
     * `otherIncomeBase`에 `'abc'`가 실려 `toEqual`이 깨진다.
     */
    const filter = parseTaxFilter(
      {
        [TAX_KEYS.otherIncomeBase]: 'abc',
        [TAX_KEYS.otherFinancialIncome]: '3,000,000',
        [TAX_KEYS.healthInsuranceType]: 'REGIONAL',
      },
      HEALTH_TYPES,
    )
    expect(filter.override).toEqual({
      otherFinancialIncome: '3000000',
      healthInsuranceType: 'REGIONAL',
    })
  })

  it('★ 세 축이 전부 버려지면 「조정하지 않은 상태」와 같아진다', () => {
    /*
     * ★ 정의된 결과다(DOC-011 §4.6). `override`가 `null`이므로 화면은
     * 「시뮬레이션 중」을 표시하지 않는다 — `isSaved`의 두 원인을 가르는 값이
     * **잘못 켜지지 않는다**는 것이 이 단언의 뜻이다. 빈 칸 케이스와 같은 결과이며
     * 그것이 옳다: 인식할 수 없는 값과 적지 않은 값은 둘 다 「조정하지 않음」이다.
     */
    const filter = parseTaxFilter(
      {
        [TAX_KEYS.otherIncomeBase]: '1.5',
        [TAX_KEYS.otherFinancialIncome]: '-1',
        [TAX_KEYS.healthInsuranceType]: 'GOLD_MEMBER',
        year: '2026',
      },
      HEALTH_TYPES,
    )
    expect(filter).toEqual({ year: 2026, override: null })
  })
})

describe('SCR-204 불러오기 주소 — 주소가 상태다 (DOC-008 v2.9)', () => {
  it('검색어와 상품 코드를 읽는다 — 코드는 대문자로 맞춘다', () => {
    expect(parseImportQuery({ q: ' 4000 ', code: 'e04000' })).toEqual({ query: '4000', code: 'E04000' })
    expect(parseImportQuery({ q: '1740', code: 'EM1740' })).toEqual({ query: '1740', code: 'EM1740' })
  })

  it('★ 형식이 아닌 코드는 버린다 — 네트워크에 나가지 않는다', () => {
    for (const code of ['bad!', 'E0400', 'E040000', 'X04000', '../x', 'E04000;', '']) {
      expect(parseImportQuery({ code }).code, code).toBeNull()
    }
  })

  it('검색어는 1~30자이고 제어 문자는 지운다', () => {
    expect(parseImportQuery({ q: '' }).query).toBeNull()
    expect(parseImportQuery({ q: '   ' }).query).toBeNull()
    expect(parseImportQuery({ q: 'a'.repeat(30) }).query).toHaveLength(30)
    expect(parseImportQuery({ q: 'a'.repeat(31) }).query).toBeNull()
    expect(parseImportQuery({ q: '40\u000000회' }).query).toBe('4000회')
    // 같은 키가 둘이면 버린다 — 폼이 만들 수 없는 형태이므로 조작된 주소다(이 파일의 `one` 규약)
    expect(parseImportQuery({ q: ['795', '1740'] }).query).toBeNull()
  })

  it('주소 왕복 — null은 싣지 않는다', () => {
    expect(importHref(IMPORT_NEW, { query: null, code: null })).toBe(PATHS.productNew)
    expect(importHref(IMPORT_NEW, { query: '4000회', code: null })).toBe(
      `${PATHS.productNew}?q=${encodeURIComponent('4000회').replace(/%20/g, '+')}`,
    )
    const href = importHref(IMPORT_NEW, { query: '4000', code: 'E04000' })
    const back = parseImportQuery(Object.fromEntries(new URL(href, 'http://x').searchParams))
    expect(back).toEqual({ query: '4000', code: 'E04000' })
  })

  it('★ 수정 화면의 주소는 대상 상품의 수정 경로다 — 쿼리 없는 주소가 「불러오기 취소」다 (DOC-008 v2.12)', () => {
    const id = '00000000-0000-4000-8000-000000000001'
    const target = { kind: 'EDIT', productId: id } as const
    expect(importTargetPath(target)).toBe(PATHS.productEdit(id))
    expect(importHref(target, { query: null, code: null })).toBe(PATHS.productEdit(id))
    expect(importHref(target, { query: '4000', code: 'E04000' })).toBe(`${PATHS.productEdit(id)}?q=4000&code=E04000`)
  })
})
