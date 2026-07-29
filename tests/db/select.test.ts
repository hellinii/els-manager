import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  APP_MAX_ROWS,
  ELS_PRODUCT_COLUMNS,
  POSTGREST_MAX_ROWS,
  PRICE_COLUMNS,
  SCHEDULE_COLUMNS,
  TRUNCATION_PROBE_LIMIT,
  USER_COLUMNS,
  assertNotTruncated,
  defineColumns,
  embed,
  selectList,
} from '@/lib/db/select'

/**
 * 열 사양 → select 문자열·행 타입 — DOC-011 §4.0 Q-08
 *
 * **`@ts-expect-error`가 핵심 게이트다.** 캐스팅 누락은 값 단언으로 잡을 수
 * 없다 — `numeric(15,0)`은 15자리까지 float64로 정확히 표현되므로 값이 그럴싸하게
 * 맞아떨어진다. 그래서 타입으로만 막고, 그 방어가 사라지면 `npm run typecheck`가
 * "사용되지 않은 @ts-expect-error"로 실패한다.
 */

describe('캐스트 목록이 열 사양에서 파생된다', () => {
  it('text 열에만 ::text가 붙는다', () => {
    expect(selectList(SCHEDULE_COLUMNS)).toBe(
      'round_no,evaluation_date,barrier::text,lizard_barrier::text,lizard_coupon_rate::text,lizard_requires_no_ki',
    )
  })

  it('금액·비율 열 전부가 캐스팅된다', () => {
    const list = selectList(ELS_PRODUCT_COLUMNS)
    for (const column of ['principal', 'annual_coupon_rate', 'ki_barrier']) {
      expect(list).toContain(`${column}::text`)
    }
  })

  it('개수를 세는 정수는 캐스팅하지 않는다', () => {
    const list = selectList(ELS_PRODUCT_COLUMNS)
    expect(list).toContain('evaluation_period_months')
    expect(list).not.toContain('evaluation_period_months::text')
  })

  it('users는 email을 담지 않는다 (D9)', () => {
    const list = selectList(USER_COLUMNS)
    expect(list).toBe('id,display_name')
    expect(list).not.toContain('email')
  })

  it('별칭을 쓰지 않는다 — 응답 키가 열 이름과 같아야 행 타입과 어긋나지 않는다', () => {
    // `alias:column` 형태가 없어야 한다. `::text`는 캐스팅이므로 대상이 아니다.
    expect(selectList(PRICE_COLUMNS)).not.toMatch(/(?:^|,)[a-z_]+:[^:]/)
    expect(selectList(PRICE_COLUMNS)).toBe('as_of_date,price::text,source')
  })

  it('임베드는 안쪽 목록을 그대로 감싼다', () => {
    expect(embed('asset_prices', selectList(PRICE_COLUMNS))).toBe(
      'asset_prices(as_of_date,price::text,source)',
    )
    expect(embed('els_products', 'id', { modifier: '!inner' })).toBe(
      'els_products!inner(id)',
    )
  })
})

describe('캐스팅 누락은 타입이 막는다', () => {
  it('금액 열을 raw로 두면 호출 지점에서 거부된다', () => {
    // 오류는 인자 전체(교차 타입 불일치)에서 보고되므로 호출 줄에 붙는다.
    // 오류 메시지가 누락된 열 이름("principal")을 그대로 보여준다.
    // @ts-expect-error — principal은 numeric이므로 'text'여야 한다
    defineColumns('els_products', {
      id: 'raw',
      principal: 'raw',
    })

    expect(true).toBe(true)
  })

  it('존재하지 않는 열은 거부된다 — 스키마 드리프트 감지', () => {
    defineColumns('els_products', {
      // @ts-expect-error — total_rounds는 DQ-05로 삭제되었다
      total_rounds: 'raw',
    })

    expect(true).toBe(true)
  })

  it('개수를 세는 정수는 raw가 허용된다 — 방어가 정상 경로를 막지 않는지', () => {
    const spec = defineColumns('els_underlyings', {
      asset_id: 'raw',
      sequence: 'raw',
      base_price: 'text',
    })
    expect(selectList(spec)).toBe('asset_id,sequence,base_price::text')
  })
})

// ---------------------------------------------------------------------------
// 절단 감지 — Q-06 (DOC-011 §4.0 · §9 AQ-22)
//
// **v2.2의 네 케이스는 전부 상수에 상대적으로 적혀 있었다**(`SERVER_MAX_ROWS + 1`,
// `new Array(SERVER_MAX_ROWS)`). 그래서 임계가 서버 상한과 같아져 가드가 발화할 수
// 없게 된 뒤에도 넷 다 초록색이었다 — 임계를 999로 바꿔도, 1로 바꿔도, 10만으로
// 바꿔도 넷 다 초록색이다. 상수의 정의를 상수로 되풀어 말하는 단언이었다.
//
// **이 블록은 배열 길이와 부등호를 `config.toml`에서 온 수로 만든다.** 아래 ★ 둘이
// 그 차이이며, v2.2 값(임계 1000 · 요청 1001 · max_rows 1000)에서 실제로 빨간불이다.
// ---------------------------------------------------------------------------

const CONFIG_TOML = readFileSync(
  join(process.cwd(), 'supabase', 'config.toml'),
  'utf8',
)

/**
 * `config.toml`의 `[api]` 테이블에서 키 하나의 값을 **전부** 모아 돌려준다.
 *
 * **TOML 파서를 의존성으로 들이지 않는다** — 대조 한 건 때문에 늘리지 않고, 대신
 * 파서의 전제를 스스로 단언한다(`validate.test.ts`의 `declaredLengths()`가 「열
 * 타입을 바꾸는 문장이 없다」를 단언한 것과 같은 자리). 파일시스템 읽기이지
 * DB·네트워크 접근이 아니므로 상시 스위트에 있어도 ADR-003의 전제를 깨지 않는다.
 *
 * 이 파일이 실제로 가진 함정 셋을 견뎌야 한다.
 *   ① **주석 처리된 키** — `[api]` 안에 `# auto_expose_new_tables = true`가 있다.
 *   ② **중첩 테이블** — `[api.tls]`가 `[api]` 바로 다음에 오고 **같은 키를 다른
 *      값으로** 갖는다(`[api].enabled = true` · `[api.tls].enabled = false`).
 *      경계에서 멈추지 않으면 조용히 남의 값을 읽는다.
 *   ③ **한글 산문 주석** — 키처럼 보이는 문장이 주석 안에 흩어져 있다.
 *
 * 텍스트를 인자로 받는 **순수 함수**다 — 합성 입력으로 파서 자체를 시험할 수 있다.
 * 개수를 줄이지 않고 전부 돌려주므로 **호출부가 「정확히 하나」를 단언**한다.
 */
function apiValues(toml: string, key: string): string[] {
  const found: string[] = []
  let inApi = false

  for (const raw of toml.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('#')) continue // ①③ 주석 줄은 통째로 버린다
    if (line.startsWith('[')) {
      inApi = line === '[api]' // ② 테이블 머리에서 경계를 다시 잡는다
      continue
    }
    if (!inApi) continue

    // `\s*=`가 키 이름의 경계다 — `enabled_foo`는 `enabled`에 걸리지 않는다.
    const matched = new RegExp(String.raw`^${key}\s*=\s*(\S+)`).exec(line)
    if (matched != null) found.push(matched[1]!)
  }
  return found
}

/** 파일 전체에서 주석이 아닌 `max_rows` 대입 줄 */
function maxRowsAssignments(toml: string): string[] {
  return toml.split('\n').filter((line) => /^\s*max_rows\s*=/.test(line))
}

/**
 * `[api].max_rows`. 전제가 깨지면 **던진다** — 0을 돌려주거나 기본값으로 넘어가면
 * 이 파일의 모든 대조가 조용히 무의미해진다.
 */
function configMaxRows(): number {
  const values = apiValues(CONFIG_TOML, 'max_rows')
  if (values.length !== 1) {
    throw new Error(
      `supabase/config.toml의 [api].max_rows가 정확히 하나여야 한다. 발견 ${values.length}개. ` +
        '형식이 바뀌어 파서가 0건을 찾은 것이라면 파서를 고친다 — 이 대조를 끄지 않는다.',
    )
  }
  return Number.parseInt(values[0]!, 10)
}

describe('절단 감지 — Q-06', () => {
  /**
   * 파서의 전제를 스스로 검사한다 — **이 저장소의 실제 파일 내용**과 합성 입력을
   * 함께 쓴다. 실제 파일만 보면 형식이 바뀌었을 때 무엇이 깨졌는지 모르고, 합성
   * 입력만 보면 파일 형식이 바뀐 것을 못 본다.
   */
  describe('config.toml 파서의 전제', () => {
    const SAMPLE = [
      '[api]',
      'enabled = true',
      '# max_rows = 999',
      'max_rows = 1000',
      '',
      '[api.tls]',
      'enabled = false',
      'max_rows = 7',
    ].join('\n')

    it('전제 1 — 읽은 파일이 이 저장소의 config.toml이다', () => {
      // 경로가 틀리면 readFileSync가 던지지만, **다른 프로젝트의** config를 읽는
      // 경우는 던지지 않는다.
      expect(CONFIG_TOML).toContain('project_id = "els-manager"')
    })

    it('전제 2 — [api] 테이블 머리가 정확히 하나다', () => {
      const heads = CONFIG_TOML.split('\n').filter((l) => l.trim() === '[api]')
      expect(heads).toHaveLength(1)
    })

    it('전제 3 — max_rows 대입이 파일 전체에서 정확히 하나다', () => {
      // [api] 안에서 하나인 것만으로는 부족하다 — 다른 테이블이 같은 키를 갖고
      // 있으면 어느 쪽이 유효값인지 이 파서가 판단하지 못한다.
      expect(maxRowsAssignments(CONFIG_TOML)).toHaveLength(1)
      expect(apiValues(CONFIG_TOML, 'max_rows')).toHaveLength(1)
    })

    it('전제 4 — 주석 처리된 키를 값으로 읽지 않는다', () => {
      // `# auto_expose_new_tables = true`가 [api] 안에 **실재한다.**
      expect(apiValues(CONFIG_TOML, 'auto_expose_new_tables')).toEqual([])
      expect(apiValues(SAMPLE, 'max_rows')).toEqual(['1000'])
    })

    it('전제 5 — [api.tls]에서 멈춘다. 같은 키가 중첩 테이블에 다른 값으로 있다', () => {
      // **실제 파일이 이 대조군을 이미 갖고 있다** — `enabled`가 `[api]`에 true,
      // `[api.tls]`에 false다. 멈추지 않으면 두 건이 되어 이 단언이 깨진다.
      expect(apiValues(CONFIG_TOML, 'enabled')).toEqual(['true'])
      expect(apiValues(SAMPLE, 'enabled')).toEqual(['true'])
    })

    it('전제 6 — 없는 키는 빈 배열이다. 그래서 호출부가 개수를 단언한다', () => {
      expect(apiValues(SAMPLE, 'schemas')).toEqual([])
      expect(() => configMaxRows()).not.toThrow()
      expect(configMaxRows()).toBeGreaterThan(0)
    })
  })

  it('상수가 config.toml의 [api].max_rows와 같다 — 사본의 낡음을 막는다', () => {
    // `POSTGREST_MAX_ROWS`는 스스로 설정의 사본이라고 선언한다. 사본이 아니게 되면
    // 그 주석이 거짓이 되므로 `<=`가 아니라 **정확히 같음**을 본다.
    expect(POSTGREST_MAX_ROWS).toBe(configMaxRows())
  })

  it('부등호 사슬 — APP_MAX_ROWS < TRUNCATION_PROBE_LIMIT <= [api].max_rows', () => {
    expect(APP_MAX_ROWS).toBeLessThan(TRUNCATION_PROBE_LIMIT)
    expect(TRUNCATION_PROBE_LIMIT).toBeLessThanOrEqual(configMaxRows())
  })

  it('요청 상한을 서버 상한보다 크게 두지 않는다 — 넘겨 요청해도 서버가 깎는다', () => {
    // 실측(P4.5): 1,201행에 limit=1001·limit=1200 → 둘 다 1000행(0-999/*, 200).
    expect(TRUNCATION_PROBE_LIMIT).toBe(configMaxRows())
  })

  it('★ 서버가 건넬 수 있는 최대 행수로 실제로 던진다 — 가드가 사문화되지 않았다', () => {
    // ★ **이 블록에서 가장 중요한 케이스다.** 배열 길이가 상수에서 파생되지 않고
    // `config.toml`에서 온다. v2.2 값(임계 1000 · 요청 1001 · max_rows 1000)에서
    // 이 길이는 min(1001, 1000) = 1000이고 임계도 1000이므로 던지지 않는다 → RED.
    // **그것이 AQ-22가 실측한 사문화다.**
    const deliverable = Math.min(TRUNCATION_PROBE_LIMIT, configMaxRows())
    expect(() =>
      assertNotTruncated(new Array(deliverable).fill(0), '평가일정'),
    ).toThrow(/평가일정.*상한/)
  })

  it('★ 서버가 깎지 않고 건넨 목록은 통과한다 — 오탐 구간을 한 행으로 묶는다', () => {
    // 요청 상한이 max_rows인데 그보다 하나 적게 받았다면 서버가 깎지 않은 것이므로
    // **전량이다.** 그것이 던지면 온전한 목록이 500 화면이 된다.
    // 이 케이스가 여유를 넓히는 것을 막는다 — 임계를 `max_rows − 2`로 두면 RED다.
    // 위 ★와 함께 여유를 **정확히 한 행**으로 고정한다.
    const full = configMaxRows() - 1
    expect(() =>
      assertNotTruncated(new Array(full).fill(0), '테스트'),
    ).not.toThrow()
  })

  it('오류가 AQ-09를 가리킨다 — 도달했다면 페이지네이션 신호다', () => {
    const deliverable = Math.min(TRUNCATION_PROBE_LIMIT, configMaxRows())
    expect(() =>
      assertNotTruncated(new Array(deliverable).fill(0), '목록'),
    ).toThrow(/AQ-09/)
  })

  it('임계 바로 아래·바로 위의 경계 — 이 둘만 상수에 대해 상대적이다', () => {
    // ★ 이 케이스는 **항진명제다**(`map.test.ts`가 같은 사실을 자기 `it.each`에
    // 대해 기록한 것과 같은 형태). 비교 연산자가 `>=`로 바뀌는 것만 잡으며 임계
    // 자체가 옳은지는 아무것도 말하지 않는다 — 그 일은 위 ★ 둘이 한다.
    // 지우지 않는 이유는 오프바이원의 **방향**을 고정하기 때문이다.
    expect(() =>
      assertNotTruncated(new Array(APP_MAX_ROWS).fill(0), 'x'),
    ).not.toThrow()
    expect(() =>
      assertNotTruncated(new Array(APP_MAX_ROWS + 1).fill(0), 'x'),
    ).toThrow()
  })
})
