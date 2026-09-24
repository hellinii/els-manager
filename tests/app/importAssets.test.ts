import { describe, expect, it } from 'vitest'

import type { AssetOption } from '@/lib/db/queries/prices'
import {
  ALIASES,
  normalizeAssetName,
  resolveImportAssets,
  type ImportedAsset,
} from '@/lib/forms/importAssets'
import type { ListedAsset } from '@/lib/providers/kiwoom/parse'

/**
 * 불러온 기초자산 → 앱 자산 (DOC-008 §5 SCR-204 v2.9)
 *
 * ## 픽스처
 *
 * `LISTED`는 키움 es040 `getBaseAssetJson`(`elsUnasTp=1·2·3`)을 **2026-09-24에 받은 전량**이다
 * (43종 — ADR-008이 적은 42종에서 국내 하나가 늘었다). 팝업 쪽 이름은 같은 날 받은 상세 픽스처
 * (`tests/providers/fixtures/kiwoom-terms/`)의 기초자산정보 표에서 옮겼다 — E00795
 * 「홍콩H지수 · 유로STOXX50 · KOSDAQ150 지수」, E03060 「S&P500 · 일본니케이225지수 · 유로STOXX50」.
 */

const row = (underlyingType: string, stkCode: string, name: string): ListedAsset => ({
  underlyingType,
  stkCode,
  name,
})

const LISTED: ListedAsset[] = [
  row('1', '201', 'KOSPI200지수'),
  row('1', '150', 'KOSDAQ150 지수'),
  row('1', '_SX5E', 'EuroStoxx50 지수'),
  row('1', '_SPX', 'S&P500 지수'),
  row('1', '_HK#HIDX', 'HSCEI 지수'),
  row('1', '_HK#HS', 'HSI 지수'),
  row('1', '_JP#NI225', 'Nikkei225 지수'),
  row('1', '_WTIF', 'WTI 선물'),
  row('1', '_BRENTF', '브렌트유 선물'),
  row('1', '_CD91', 'CD(91일)'),
  row('2', 'A005930', '삼성전자'),
  row('2', 'A000660', 'SK하이닉스'),
  row('2', 'A035420', 'NAVER'),
  row('2', 'A035720', '카카오'),
  row('2', 'A003550', 'LG'),
  row('2', 'A051900', 'LG생활건강'),
  row('2', 'A066570', 'LG전자'),
  row('2', 'A373220', 'LG에너지솔루션'),
  row('2', 'A051910', 'LG화학'),
  row('2', 'A005490', 'POSCO홀딩스'),
  row('2', 'A105560', 'KB금융'),
  row('2', 'A005380', '현대차'),
  row('2', 'A009150', '삼성전기'),
  row('2', 'A096770', 'SK이노베이션'),
  row('2', 'A090430', '아모레퍼시픽'),
  row('2', 'A012450', '한화에어로스페이스'),
  row('3', 'AAPL', '애플'),
  row('3', 'AMD', 'AMD'),
  row('3', 'GOOGL', '알파벳A(구글)'),
  row('3', 'AMZN', '아마존'),
  row('3', 'BAC', '뱅크오브아메리카'),
  row('3', 'AVGO', '브로드컴'),
  row('3', 'C', '씨티그룹'),
  row('3', 'INTC', '인텔'),
  row('3', 'META', '메타 플랫폼스(페이스북)'),
  row('3', 'MU', '마이크론 테크놀로지'),
  row('3', 'MSFT', '마이크로소프트'),
  row('3', 'NFLX', '넷플릭스'),
  row('3', 'NVDA', '엔비디아'),
  row('3', 'PLTR', '팔란티어 테크'),
  row('3', 'QCOM', '퀄컴'),
  row('3', 'TSLA', '테슬라'),
  row('3', 'UBER', '우버 테크놀로지스'),
]

const option = (id: string, symbols: Array<[string, string]> = []): AssetOption => ({
  id,
  name: `앱자산${id}`,
  market: null,
  currency: 'KRW',
  assetType: 'STOCK',
  hasPriceProvider: symbols.length > 0,
  providerSymbols: symbols.map(([provider, symbol]) => ({ provider, symbol })),
})

const resolve = (assets: ImportedAsset[], options: AssetOption[] = []) =>
  resolveImportAssets({ assets, listed: LISTED, options })

describe('전제 — 픽스처가 퇴화하지 않았다', () => {
  it('목록이 43종이고 분류가 셋이다', () => {
    expect(LISTED).toHaveLength(43)
    expect(new Set(LISTED.map((r) => r.underlyingType))).toEqual(new Set(['1', '2', '3']))
  })

  it('★ 별칭의 대상이 전부 목록에 실재한다 — 없는 코드를 가리키면 해석이 조용히 NO_ES040이 된다', () => {
    for (const [name, code] of Object.entries(ALIASES)) {
      expect(LISTED.map((r) => r.stkCode), `${name} → ${code}`).toContain(code)
    }
  })

  it('별칭의 키는 정규화된 형태다 — 정규화를 지나지 않은 키는 영원히 맞지 않는다', () => {
    for (const name of Object.keys(ALIASES)) expect(normalizeAssetName(name)).toBe(name)
  })
})

describe('키움 목록의 행 찾기', () => {
  it('해외 종목은 티커로 — 이름이 꾸며져 있어도(알파벳A(구글))', () => {
    const out = resolve([{ name: '아무 이름', ticker: 'GOOGL' }])
    expect(out['아무 이름']).toEqual({
      kind: 'NO_MAPPING',
      symbol: '3:GOOGL',
      listed: row('3', 'GOOGL', '알파벳A(구글)'),
    })
  })

  it('★ 티커와 이름이 목록의 다른 행을 가리키면 모호다 — 열 순서가 어긋난 티커를 조용히 받지 않는다', () => {
    // 두 자산의 티커가 바뀌어 왔다(해외기초자산 정보 표의 열 순서가 자산 표와 다르다)
    const out = resolve([
      { name: '팔란티어 테크', ticker: 'AMD' },
      { name: 'AMD', ticker: 'PLTR' },
    ])
    expect(out['팔란티어 테크']).toMatchObject({ kind: 'AMBIGUOUS' })
    expect(out['AMD']).toMatchObject({ kind: 'AMBIGUOUS' })
    // 이름과 티커가 같은 행이면 그대로다
    expect(resolve([{ name: '팔란티어 테크', ticker: 'PLTR' }])['팔란티어 테크']).toMatchObject({
      symbol: '3:PLTR',
    })
  })

  it('★ 티커가 목록에 없으면 이름으로 넘어가지 않는다', () => {
    // 이름은 목록에 있지만(테슬라) 티커가 다르다 — 이름으로 넘어가면 티커가 가리킨 것과 다른 행이다
    expect(resolve([{ name: '테슬라', ticker: 'XXXX' }])['테슬라']).toEqual({ kind: 'NO_ES040' })
  })

  it('국내 종목·지수는 정규화한 이름의 정확 일치', () => {
    expect(resolve([{ name: '삼성전자', ticker: null }])['삼성전자']).toMatchObject({ symbol: '2:A005930' })
    expect(resolve([{ name: 'KOSDAQ150 지수', ticker: null }])['KOSDAQ150 지수']).toMatchObject({
      symbol: '1:150',
    })
    // 끝의 「지수」 제거 — E03060의 S&P500이 목록에서 「S&P500 지수」다
    expect(resolve([{ name: 'S&P500', ticker: null }])['S&P500']).toMatchObject({ symbol: '1:_SPX' })
  })

  it('실측한 별칭 셋 — 언어가 다른 쌍', () => {
    const out = resolve([
      { name: '홍콩H지수', ticker: null },
      { name: '유로STOXX50', ticker: null },
      { name: '일본니케이225지수', ticker: null },
    ])
    expect(out['홍콩H지수']).toMatchObject({ symbol: '1:_HK#HIDX' })
    expect(out['유로STOXX50']).toMatchObject({ symbol: '1:_SX5E' })
    expect(out['일본니케이225지수']).toMatchObject({ symbol: '1:_JP#NI225' })
  })

  it('★ 근접 오답은 맞추지 않는다 — 퍼지 매칭이 없다', () => {
    for (const name of ['삼성전자우', 'SK하이닉스우', '삼성', 'LG전자우', '코스피200', 'HSI', '홍콩항셍']) {
      const out = resolve([{ name, ticker: null }])[name]
      // HSI는 「HSI 지수」의 정규화와 같다 — 그 하나만 맞는 것이 옳다
      if (name === 'HSI') expect(out).toMatchObject({ symbol: '1:_HK#HS' })
      else expect(out, name).toEqual({ kind: 'NO_ES040' })
    }
  })
})

describe('심볼 → 앱 자산', () => {
  it('그 심볼을 가진 앱 자산 하나면 RESOLVED', () => {
    const out = resolve([{ name: '삼성전자', ticker: null }], [option('a1', [['KIWOOM_ES040', '2:A005930']])])
    expect(out['삼성전자']).toMatchObject({ kind: 'RESOLVED', assetId: 'a1', symbol: '2:A005930' })
  })

  it('없으면 NO_MAPPING — 자산 추가·연결의 제안 재료다', () => {
    const out = resolve([{ name: '삼성전자', ticker: null }], [option('a1')])
    expect(out['삼성전자']).toMatchObject({ kind: 'NO_MAPPING', symbol: '2:A005930' })
  })

  it('다른 공급자의 같은 문자열은 세지 않는다', () => {
    const out = resolve([{ name: '삼성전자', ticker: null }], [option('a1', [['OTHER', '2:A005930']])])
    expect(out['삼성전자']).toMatchObject({ kind: 'NO_MAPPING' })
  })

  it('★ 같은 심볼을 가진 앱 자산이 둘이면 AMBIGUOUS — 고르지 않는다 (AQ-73)', () => {
    const out = resolve(
      [{ name: '삼성전자', ticker: null }],
      [option('a1', [['KIWOOM_ES040', '2:A005930']]), option('a2', [['KIWOOM_ES040', '2:A005930']])],
    )
    expect(out['삼성전자']).toMatchObject({ kind: 'AMBIGUOUS' })
  })

  it('같은 이름이 둘 오면 둘 다 AMBIGUOUS다 — 뒤의 것이 앞의 것을 덮지 않는다', () => {
    const out = resolve([
      { name: '삼성전자', ticker: null },
      { name: '삼성전자', ticker: null },
    ])
    expect(out['삼성전자']).toMatchObject({ kind: 'AMBIGUOUS' })
  })
})
