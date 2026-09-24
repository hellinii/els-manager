import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { dec } from '@/lib/decimal'
import {
  GB_RULES,
  NOT_READ,
  PROVIDER_ID,
  READ_FIELDS,
  type Gb,
} from '@/lib/providers/kiwoom/endpoints'
import { createKiwoomProvider, KIWOOM_ES040, previousDay } from '@/lib/providers/kiwoom'
import { parseAssetList, parseChart, parseStexCode } from '@/lib/providers/kiwoom/parse'
import { formatSymbol, parseSymbol } from '@/lib/providers/kiwoom/symbols'

import {
  ASSET_LIST_BODY,
  CHART_INDEX_DOMESTIC,
  CHART_INDEX_OVERSEAS,
  CHART_STOCK_DOMESTIC,
  CHART_STOCK_OVERSEAS,
  detailBody,
} from './fixtures/kiwoom'

/**
 * 키움 es040 어댑터 — DOC-010 ADR-008 · ADR-004(보정판)
 *
 * 상시 스위트다. **네트워크에 나가지 않는다**(ADR-003) — `fetchImpl`을 주입한다.
 * 전역 `fetch`를 스텁하지 않는 이유는 순서 의존을 만들지 않기 위해서다.
 */

const ASOF = '2026-08-05'
/** 어댑터는 상한을 `previousDay(asOf)`로 둔다 — 당일 행이 미확정이기 때문이다 */
const CEILING = '2026-08-04'

const ok = (o: unknown) => {
  expect(o, JSON.stringify(o)).toHaveProperty('price')
  return o as { asOfDate: string; price: ReturnType<typeof dec> }
}
const bad = (o: unknown) => {
  expect(o, JSON.stringify(o)).toHaveProperty('code')
  return o as { code: string; detail: string }
}

describe('전제 — 픽스처가 네 부류를 전부 담는다', () => {
  it('gb 규칙표의 키가 픽스처의 gb 집합과 일치한다', () => {
    const fixtures = [
      CHART_INDEX_DOMESTIC,
      CHART_INDEX_OVERSEAS,
      CHART_STOCK_DOMESTIC,
      CHART_STOCK_OVERSEAS,
    ]
    expect([...new Set(fixtures.map((f) => f.gb))].sort()).toEqual(
      Object.keys(GB_RULES).sort(),
    )
  })

  it('부류마다 나누는 지수와 날짜 길이가 실제로 다르다 — 표가 항진명제가 아니다', () => {
    expect(GB_RULES.A.divideByPowerOfTen).toBe(2)
    expect(GB_RULES.B.divideByPowerOfTen).toBe(0)
    expect(GB_RULES.B.dateLength).toBe(14)
    expect(GB_RULES.A.dateLength).toBe(8)
  })
})

describe('스케일 — 부류를 틀리면 조용히 100배 어긋난다', () => {
  it('gb=A(국내 지수)는 ÷100이다 — 독립 출처와 일치한다', () => {
    const q = ok(parseChart(CHART_INDEX_DOMESTIC, CEILING))
    expect(q.asOfDate).toBe('2026-08-04')
    // 원문 `100003` → 1000.03. 같은 날 신한 게시값이 1000.03이다
    expect(q.price.toString()).toBe('1000.03')
  })

  it('gb=B(해외 지수)는 나누지 «않는다» — 나누면 7736.52가 77.3652가 된다', () => {
    const q = ok(parseChart(CHART_INDEX_OVERSEAS, CEILING))
    expect(q.asOfDate).toBe('2026-08-04')
    expect(q.price.toString()).toBe('7736.52')
    // 음성 대조 — A의 규칙을 적용했다면 이 값이 됐을 것이다
    expect(q.price.toString()).not.toBe('77.3652')
  })

  it('gb=B의 선행 공백을 벗긴다', () => {
    // 픽스처의 원문이 실제로 공백을 담고 있어야 이 케이스가 뜻을 갖는다
    expect(CHART_INDEX_OVERSEAS.tao.grid.arRow[0]![1]).toBe(' 7736.52')
    expect(ok(parseChart(CHART_INDEX_OVERSEAS, CEILING)).price.toString()).toBe('7736.52')
  })

  it('gb=C(국내주식)는 정수 원화 그대로다', () => {
    expect(ok(parseChart(CHART_STOCK_DOMESTIC, CEILING)).price.toString()).toBe('240000')
  })

  it('gb=D(해외주식)는 소수 그대로다 — 독립 출처와 일치한다', () => {
    const q = ok(parseChart(CHART_STOCK_OVERSEAS, CEILING))
    expect(q.price.toString()).toBe('309.38')
    expect(q.asOfDate).toBe('2026-08-04')
  })

  it('★ 모르는 gb는 추측하지 않고 MALFORMED다', () => {
    const body = { ...CHART_STOCK_OVERSEAS, gb: 'Z' }
    expect(bad(parseChart(body, CEILING)).code).toBe('MALFORMED')
  })
})

describe('상한 — 당일 행을 쓰지 않는다', () => {
  it('기준일 이후 행은 건너뛰고 그 이하의 최대를 고른다', () => {
    // 픽스처에 20260805가 있는데 상한이 08-04이므로 08-04가 선택되어야 한다
    expect(CHART_STOCK_OVERSEAS.tao.grid.arRow[0]![0]).toBe('20260805')
    expect(ok(parseChart(CHART_STOCK_OVERSEAS, CEILING)).asOfDate).toBe('2026-08-04')
  })

  it('행 순서를 신뢰하지 않고 최대를 고른다', () => {
    const shuffled = {
      ...CHART_STOCK_OVERSEAS,
      tao: {
        grid: {
          colNames: CHART_STOCK_OVERSEAS.tao.grid.colNames,
          arRow: [...CHART_STOCK_OVERSEAS.tao.grid.arRow].reverse(),
        },
      },
    }
    expect(ok(parseChart(shuffled, CEILING)).asOfDate).toBe('2026-08-04')
  })

  it('상한 이하의 행이 하나도 없으면 EMPTY다', () => {
    expect(bad(parseChart(CHART_STOCK_OVERSEAS, '2020-01-01')).code).toBe('EMPTY')
  })
})

describe('★ 0건과 「경로가 틀렸다」를 구별한다', () => {
  it('행이 0건이면 EMPTY다 (휴장·상장폐지·코드 오류)', () => {
    const body = { gb: 'D', stk_code: 'AAPL', tao: { grid: { colNames: ['FID_22', 'FID_10'], arRow: [] } } }
    expect(bad(parseChart(body, CEILING)).code).toBe('EMPTY')
  })

  it('tao.grid가 없으면 MALFORMED다 — 실제로 이 실수를 했다', () => {
    /*
     * `tao.arRow`는 항상 null이고 데이터는 `tao.grid.arRow`에 있다. 경로를 틀리면
     * 정상 응답이 0건으로 읽히고 EMPTY → NO_DATA → 「매핑을 고친다」가 되는데
     * **매핑은 멀쩡하다.** 그래서 둘을 갈라야 한다.
     */
    const body = { gb: 'D', stk_code: 'AAPL', tao: { arRow: null } }
    expect(bad(parseChart(body, CEILING)).code).toBe('MALFORMED')
  })

  it('colNames에 읽을 열이 없으면 MALFORMED다', () => {
    const body = {
      gb: 'D',
      stk_code: 'AAPL',
      tao: { grid: { colNames: ['X', 'Y', 'Z'], arRow: [['20260804', '1', '2']] } },
    }
    expect(bad(parseChart(body, CEILING)).code).toBe('MALFORMED')
  })

  it('열 순서가 바뀌어도 colNames를 따라 읽는다', () => {
    const body = {
      gb: 'D',
      stk_code: 'AAPL',
      tao: {
        grid: {
          colNames: ['FID_10', 'FID_12', 'FID_22'],
          arRow: [['309.3800', '+1.93', '20260804']],
        },
      },
    }
    const q = ok(parseChart(body, CEILING))
    expect(q.price.toString()).toBe('309.38')
    expect(q.asOfDate).toBe('2026-08-04')
  })
})

describe('값 검증 — DB에 price > 0 CHECK가 없으므로 이 층이 유일한 방어다', () => {
  const withPrice = (price: string, gb = 'D', date = '20260804') => ({
    gb,
    stk_code: 'X',
    tao: { grid: { colNames: ['FID_22', 'FID_10'], arRow: [[date, price]] } },
  })

  it.each([
    ['0', 'BAD_VALUE'],
    ['-1', 'BAD_VALUE'],
    ['-0.0001', 'BAD_VALUE'],
    ['1e5', 'BAD_VALUE'],
    ['abc', 'BAD_VALUE'],
    ['', 'BAD_VALUE'],
    ['1000000000000', 'BAD_VALUE'],
  ])('가격 %s → %s', (price, code) => {
    expect(bad(parseChart(withPrice(price), CEILING)).code).toBe(code)
  })

  it('범위 경계 바로 아래는 통과한다 — 상한 검사가 항진명제가 아니다', () => {
    expect(ok(parseChart(withPrice('999999999999.999999'), CEILING)).price.toString()).toBe(
      '999999999999.999999',
    )
  })

  it.each([
    ['20260230', 8, 'BAD_DATE'],
    ['20261301', 8, 'BAD_DATE'],
    ['2026080', 8, 'BAD_DATE'],
    ['20260804000000', 8, 'BAD_DATE'],
  ])('날짜 %s (기대 %s자) → %s', (date, _len, code) => {
    expect(bad(parseChart(withPrice('1', 'D', date), CEILING)).code).toBe(code)
  })

  it('★ gb=B에서 8자 날짜는 거부한다 — 앞 8자가 «우연히» 유효해도 잘라 쓰지 않는다', () => {
    expect(bad(parseChart(withPrice('1', 'B', '20260804'), CEILING)).code).toBe('BAD_DATE')
  })

  it('윤년을 안다', () => {
    expect(bad(parseChart(withPrice('1', 'D', '20260229'), CEILING)).code).toBe('BAD_DATE')
    const leap = withPrice('1', 'D', '20240229')
    expect(ok(parseChart(leap, '2024-03-01')).asOfDate).toBe('2024-02-29')
  })
})

describe('심볼 표기', () => {
  it.each([
    ['3:AAPL', '3', 'AAPL'],
    ['2:A005930', '2', 'A005930'],
    ['1:201', '1', '201'],
    ['1:_HK#HIDX', '1', '_HK#HIDX'],
  ])('%s를 해석한다', (raw, tp, code) => {
    const t = parseSymbol(raw)
    expect(t).toEqual({ underlyingType: tp, stkCode: code })
    expect(formatSymbol(t as { underlyingType: '1' | '2' | '3'; stkCode: string })).toBe(raw)
  })

  it.each(['AAPL', '9:AAPL', '3:', '3:  ', ':AAPL', '3: AAPL'])(
    '%s는 SYMBOL_SCHEME이다',
    (raw) => {
      expect(bad(parseSymbol(raw)).code).toBe('SYMBOL_SCHEME')
    },
  )
})

describe('부수 응답 파싱', () => {
  it('거래소 코드를 읽는다', () => {
    expect(parseStexCode(detailBody('NDAAPL'))).toBe('NDAAPL')
    expect(parseStexCode(detailBody('NYBAC'))).toBe('NYBAC')
  })

  it('거래소 코드가 비면 EMPTY다 — 공급자가 모르는 코드다', () => {
    expect(bad(parseStexCode(detailBody('   '))).code).toBe('EMPTY')
    expect(bad(parseStexCode({})).code).toBe('EMPTY')
  })

  it('목록을 읽고 지수 넷이 실재한다 — ADR-007 §5가 「없다」고 한 것들이다', () => {
    const list = parseAssetList(ASSET_LIST_BODY)
    expect(Array.isArray(list)).toBe(true)
    const codes = (list as { stkCode: string }[]).map((a) => a.stkCode)
    expect(codes).toContain('_SPX')
    expect(codes).toContain('_HK#HIDX')
    expect(codes).toContain('_JP#NI225')
    expect(codes).toContain('_SX5E')
  })

  it('목록이 0건이면 MALFORMED다 — 형태 변경이 「자산이 없다」로 위장하지 않게', () => {
    expect(bad(parseAssetList({ result: { map: { g1: [] } } })).code).toBe('MALFORMED')
  })
})

describe('★ adjclose 단언 — 허용 목록으로 쓴다 (ADR-007 §4)', () => {
  const SRC_DIR = join(process.cwd(), 'src', 'lib', 'providers')
  /*
   * ★ **목록을 손으로 적지 않고 디렉터리를 읽는다** — 종전 이 자리는 네 파일을 박아 둔
   * 배열이었고 `http.ts`가 생기는 커밋에서 **그 파일이 검사 밖에 있는 채로 초록**이었을
   * 것이다(CLAUDE.md 절대 규칙 #6의 다섯째와 같은 함정 — 「빠지지 않았는가」를 묻는 열거가
   * 스스로 자라지 않는다).
   *
   * 그리고 읽은 결과를 **정확한 집합으로 단언한다.** `readdirSync`만 두면 파일이 늘어도
   * 조용히 따라가므로 「새 파일이 이 검사를 지난다」는 보이지만 「누가 파일을 더했다」는
   * 보이지 않는다 — 여기가 빨간불이 되는 것이 새 파일을 이 목록에 «의식적으로» 올리는 계기다.
   */
  const KIWOOM_DIR = join(SRC_DIR, 'kiwoom')
  const sources = readdirSync(KIWOOM_DIR)
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map((f) => `kiwoom/${f}`)

  it('스캔 대상이 디렉터리의 .ts 전부이고 그 집합이 기대와 같다', () => {
    expect(sources).toEqual([
      'kiwoom/endpoints.ts',
      'kiwoom/html.ts',
      'kiwoom/http.ts',
      'kiwoom/index.ts',
      'kiwoom/ladder.ts',
      'kiwoom/parse.ts',
      'kiwoom/search-parse.ts',
      'kiwoom/symbols.ts',
      'kiwoom/terms-check.ts',
      'kiwoom/terms-endpoints.ts',
      'kiwoom/terms-parse.ts',
      'kiwoom/terms-types.ts',
      'kiwoom/terms.ts',
    ])
  })

  it('읽는 필드와 읽지 않는 필드가 겹치지 않는다', () => {
    const read = new Set(Object.values(READ_FIELDS))
    const notRead = new Set(Object.keys(NOT_READ))
    expect([...read].filter((f) => notRead.has(f))).toEqual([])
  })

  it('조정종가 계열의 이름이 소스에 없다', () => {
    for (const rel of sources) {
      const src = readFileSync(join(SRC_DIR, rel), 'utf8')
      // 주석에서 «금지»를 서술하는 것은 허용하되, 필드로 읽는 형태를 막는다
      expect(src, rel).not.toMatch(/\badjClose\b|\badj_close\b|\badjusted_close\b/)
    }
  })

  /*
   * ★ **강제 변환 검사를 여기 «두지 않는다» — 초안에 뒀다가 지웠고 그 사유가 이 주석이다.**
   *
   * `/\bNumber\s*\(/`로 소스를 훑는 케이스를 썼더니 **주석에서 걸렸다** — `endpoints.ts`가
   * 페이지 자신의 JS(`if(gb=="A"){ fid_10 = Number(item[1])/100 }`)를 근거로 인용하고
   * `parse.ts`가 「`Number()`를 쓰면 안 되는 이유」를 서술한다. 즉 **금지를 «설명하는» 문서가
   * 금지 위반으로 잡혔다.**
   *
   * 주석 제거기를 붙여 우회할 수도 있지만 그것은 **틀린 층에 계기를 두는 것**이다 —
   * `eslint.config.mjs`의 `els/provider-values`가 이미 **AST 수준**으로 같은 것을 막고
   * (`no-restricted-syntax`가 `CallExpression[callee.name='Number']`를 잡는다),
   * `tests/app/lint-coverage.test.ts`가 **이 디렉터리가 그 규칙에 덮여 있음을 파일 단위로
   * 단언한다.** 정규식 사본은 그보다 약하면서 거짓 양성을 낸다.
   *
   * **부류를 적어 둔다: 계기가 명제를 판별하지 못하는 자리였다** — 「값 경로에 강제 변환이
   * 있는가」를 물었는데 「그 낱말이 파일에 있는가」를 쟀다.
   */

  it('필드 상수가 문자열이고 소스에 박힌 인덱스를 쓰지 않는다', () => {
    // 열 위치를 상수로 박으면 `colNames` 순서가 바뀔 때 조용히 날짜와 가격이 뒤바뀐다
    expect(Object.values(READ_FIELDS).every((f) => /^FID_\d+$/.test(f))).toBe(true)
    const src = readFileSync(join(SRC_DIR, 'kiwoom/parse.ts'), 'utf8')
    expect(src).toContain('colNames.indexOf(READ_FIELDS.baseDate)')
  })
})

describe('전일 산출 — Date를 쓰지 않는다', () => {
  it.each([
    ['2026-08-05', '2026-08-04'],
    ['2026-08-01', '2026-07-31'],
    ['2026-01-01', '2025-12-31'],
    ['2026-03-01', '2026-02-28'],
    ['2024-03-01', '2024-02-29'],
    ['2100-03-01', '2100-02-28'],
    ['2000-03-01', '2000-02-29'],
  ])('%s → %s', (input, expected) => {
    expect(previousDay(input)).toBe(expected)
  })
})

describe('어댑터 — 던지지 않는다 (계약 의무 ①)', () => {
  const route = (bodies: Record<string, unknown>): typeof fetch =>
    (async (url: string | URL | Request) => {
      const href = String(url)
      const key = Object.keys(bodies).find((k) => href.includes(k))
      if (key == null) return new Response('not routed', { status: 404 })
      const body = bodies[key]
      if (body instanceof Response) return body
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch

  const happy = route({
    getBaseAssetDtlJson: detailBody('NDAAPL'),
    getBaseAssetChartJson: CHART_STOCK_OVERSEAS,
  })

  it('id가 계약이 요구하는 문자열이고 varchar(30) 이내다', () => {
    expect(KIWOOM_ES040.id).toBe(PROVIDER_ID)
    expect(PROVIDER_ID.length).toBeLessThanOrEqual(30)
    expect(PROVIDER_ID).toMatch(/^[A-Z0-9_]+$/)
    expect(createKiwoomProvider({ fetchImpl: happy }).id).toBe(PROVIDER_ID)
  })

  it('성공 경로가 확정 종가를 준다', async () => {
    const p = createKiwoomProvider({ fetchImpl: happy })
    const out = await p.fetchDailyClose(['3:AAPL'], ASOF)
    expect(out).toHaveLength(1)
    expect(out[0]!.ok).toBe(true)
    if (out[0]!.ok) {
      expect(out[0]!.asOfDate).toBe('2026-08-04')
      expect(out[0]!.price.toString()).toBe('309.38')
      expect(out[0]!.symbol).toBe('3:AAPL')
    }
  })

  it('입력 심볼당 정확히 하나를 낸다 (계약 의무 ②)', async () => {
    const p = createKiwoomProvider({ fetchImpl: happy })
    const symbols = ['3:AAPL', 'bad-symbol', '3:AAPL']
    const out = await p.fetchDailyClose(symbols, ASOF)
    expect(out).toHaveLength(symbols.length)
    expect(out.map((o) => o.symbol)).toEqual(symbols)
  })

  it('fetch가 던져도 값이 된다 → NETWORK', async () => {
    const p = createKiwoomProvider({
      fetchImpl: (async () => {
        throw new TypeError('연결 실패')
      }) as unknown as typeof fetch,
    })
    const out = await p.fetchDailyClose(['3:AAPL'], ASOF)
    expect(out[0]!.ok).toBe(false)
    if (!out[0]!.ok) {
      expect(out[0]!.code).toBe('NETWORK')
      expect(out[0]!.failure).toBe('CALL_FAILED')
    }
  })

  it.each([
    [429, 'QUOTA'],
    [401, 'AUTH'],
    [403, 'AUTH'],
    [400, 'BLOCKED'],
    [500, 'HTTP'],
    [503, 'HTTP'],
  ])('HTTP %s → %s', async (status, code) => {
    const p = createKiwoomProvider({
      fetchImpl: route({ getBaseAssetDtlJson: new Response('x', { status }) }),
    })
    const out = await p.fetchDailyClose(['3:AAPL'], ASOF)
    expect(out[0]!.ok).toBe(false)
    if (!out[0]!.ok) expect(out[0]!.code).toBe(code)
  })

  it('WAF 차단 본문이 오면 BLOCKED다 — MALFORMED로 뭉개지 않는다', async () => {
    const p = createKiwoomProvider({
      fetchImpl: route({
        getBaseAssetDtlJson: new Response('{"eversafeThreat":true}!!', { status: 200 }),
      }),
    })
    const out = await p.fetchDailyClose(['3:AAPL'], ASOF)
    expect(out[0]!.ok).toBe(false)
    if (!out[0]!.ok) expect(out[0]!.code).toBe('BLOCKED')
  })

  it('JSON이 아닌 본문은 MALFORMED다', async () => {
    const p = createKiwoomProvider({
      fetchImpl: route({ getBaseAssetDtlJson: new Response('<html>', { status: 200 }) }),
    })
    const out = await p.fetchDailyClose(['3:AAPL'], ASOF)
    expect(out[0]!.ok).toBe(false)
    if (!out[0]!.ok) expect(out[0]!.code).toBe('MALFORMED')
  })

  it('데드라인이 지나면 남은 심볼을 호출하지 않고 값으로 답한다', async () => {
    let calls = 0
    const counting = (async (...args: Parameters<typeof fetch>) => {
      calls += 1
      return happy(...args)
    }) as unknown as typeof fetch
    const p = createKiwoomProvider({ fetchImpl: counting, deadlineAt: 0 })
    const out = await p.fetchDailyClose(['3:AAPL', '3:NVDA'], ASOF)
    expect(calls).toBe(0)
    expect(out.every((o) => !o.ok)).toBe(true)
    expect(out.map((o) => (o.ok ? null : o.code))).toEqual(['NETWORK', 'NETWORK'])
  })

  it('심볼 표기 오류는 네트워크에 나가지 않는다', async () => {
    let calls = 0
    const counting = (async (...args: Parameters<typeof fetch>) => {
      calls += 1
      return happy(...args)
    }) as unknown as typeof fetch
    const p = createKiwoomProvider({ fetchImpl: counting })
    const out = await p.fetchDailyClose(['nope'], ASOF)
    expect(calls).toBe(0)
    expect(out[0]!.ok).toBe(false)
    if (!out[0]!.ok) {
      expect(out[0]!.code).toBe('SYMBOL_SCHEME')
      // 조치가 「매핑을 고친다」이므로 NO_DATA다
      expect(out[0]!.failure).toBe('NO_DATA')
    }
  })

  it('쿠키를 싣지 않는다 — credentials를 만지지 않는 것이 이행이다', async () => {
    let seen: RequestInit | undefined
    const spy = (async (_u: unknown, init?: RequestInit) => {
      seen = init
      return happy('https://x/getBaseAssetDtlJson')
    }) as unknown as typeof fetch
    await createKiwoomProvider({ fetchImpl: spy }).fetchDailyClose(['3:AAPL'], ASOF)
    expect(seen).toBeDefined()
    expect(seen).not.toHaveProperty('credentials')
    expect(seen?.method).toBe('POST')
  })

  it('gb 네 부류 전부가 어댑터를 통과한다', async () => {
    const cases: [string, string, string][] = [
      ['1:201', 'A', '1000.03'],
      ['1:_SPX', 'B', '7736.52'],
      ['2:A005930', 'C', '240000'],
      ['3:AAPL', 'D', '309.38'],
    ]
    const charts = {
      A: CHART_INDEX_DOMESTIC,
      B: CHART_INDEX_OVERSEAS,
      C: CHART_STOCK_DOMESTIC,
      D: CHART_STOCK_OVERSEAS,
    } as Record<Gb, unknown>

    for (const [symbol, gb, expected] of cases) {
      const p = createKiwoomProvider({
        fetchImpl: route({
          getBaseAssetDtlJson: detailBody('X'),
          getBaseAssetChartJson: charts[gb as Gb],
        }),
      })
      const out = await p.fetchDailyClose([symbol], ASOF)
      expect(out[0]!.ok, `${symbol}: ${JSON.stringify(out[0])}`).toBe(true)
      if (out[0]!.ok) expect(out[0]!.price.toString(), symbol).toBe(expected)
    }
  })
})

describe('레지스트리 — 컷 3이 등재했다', () => {
  it('PRICE_PROVIDERS에 키움 하나가 있다', async () => {
    const { PRICE_PROVIDERS } = await import('@/lib/providers/types')
    /*
     * ★ **종전 이 케이스는 `toEqual([])`이었고, 그것이 결정의 기록이었다.**
     * 컷 1 시점에 등재하면 `providerCount > 0`이 되고 수집기가 없으므로 §5.8이
     * CR-08(`INTERNAL`)로 끝난다 — 「배포 결함」 상태이며 503(설계된 상태)보다 나쁘다.
     * R-05를 지키려면 등재가 수집기와 **같은 컷**이어야 했고 그것이 컷 3이다.
     *
     * 즉 이 케이스가 빨간불이 된 것이 「컷 3이 왔다」의 신호였다. 뒤집어 적는다.
     */
    expect(PRICE_PROVIDERS.map((f) => f.id)).toEqual(['KIWOOM_ES040'])
  })

  it('★ 하나뿐이다 — 둘이 되는 순간 대조 원천의 처리가 정의되어야 한다', async () => {
    const { PRICE_PROVIDERS } = await import('@/lib/providers/types')
    /*
     * `[0]`이 주 원천이고 두 번째는 «대조»다(컷 1c의 `data.go.kr`). `collectAndRecord`가
     * 둘 이상이면 **수집하지 않고 `INTERNAL`을 낸다** — 조용히 첫 것만 쓰면 컷 1c의
     * 등재가 아무 일도 하지 않으면서 초록이 된다. 이 단언이 그 시점을 잡는다.
     */
    expect(PRICE_PROVIDERS).toHaveLength(1)
  })

  it('PRICE_PROVIDERS ⊆ KNOWN_PROVIDER_IDS — 두 명부가 반대로 자라지 않는다', async () => {
    const { PRICE_PROVIDERS, KNOWN_PROVIDER_IDS } = await import('@/lib/providers/types')
    for (const factory of PRICE_PROVIDERS) {
      expect(KNOWN_PROVIDER_IDS, factory.id).toContain(factory.id)
    }
  })

  it('아는 공급자 전부가 자격증명 원장에 있다 — 빠지면 CR-10에 세어지지 않는다', async () => {
    const { KNOWN_PROVIDER_IDS, PROVIDER_CREDENTIALS } = await import('@/lib/providers/types')
    /*
     * ★ **양방향이다.** 원장에 항목이 없는 공급자는 그 키 부재가 `missingCredentials`에
     * 들어가지 않으므로 CR-10이 도달하지 않고, 배치는 매일 `AUTH` 실패를 낸다 —
     * 「고칠 것이 환경변수 하나인데 사용자는 공급자 장애로 읽는다」가 CR-10의 존재 이유다.
     * 반대로 원장에만 있는 id는 낡은 항목이다.
     */
    expect(Object.keys(PROVIDER_CREDENTIALS).sort()).toEqual([...KNOWN_PROVIDER_IDS].sort())

    // 키움 es040은 자격증명이 «없다» — 미인증 공개 엔드포인트다(ADR-008 §2.3)
    expect(PROVIDER_CREDENTIALS.KIWOOM_ES040).toEqual([])
  })
})
