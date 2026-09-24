import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { dec } from '@/lib/decimal'
import { findSection, onlyTable, stripNoise } from '@/lib/providers/kiwoom/html'
import { parseLadder, parseTenor } from '@/lib/providers/kiwoom/ladder'
import { parseSearchBody } from '@/lib/providers/kiwoom/search-parse'
import { createKiwoomProductSource } from '@/lib/providers/kiwoom/terms'
import { crossCheckTerms } from '@/lib/providers/kiwoom/terms-check'
import {
  DISPLAY_SCALE,
  SEARCH_FORM_DEFAULTS,
  TERMS_ENDPOINTS,
  TERMS_NOT_READ,
} from '@/lib/providers/kiwoom/terms-endpoints'
import { parseTermsHtml, type ParsedTerms } from '@/lib/providers/kiwoom/terms-parse'
import type { KiwoomProductCandidate, KiwoomProductTerms } from '@/lib/providers/kiwoom/terms-types'

import {
  POPUP_CODES,
  popupHtml,
  RAW_CODES,
  rawPopupHtml,
  SEARCH_FIXTURES,
  searchBytes,
  searchJson,
  searchText,
  type PopupCode,
  type SearchFixture,
} from './fixtures/kiwoom-terms'
import { ASSET_LIST_BODY } from './fixtures/kiwoom'

/**
 * 키움 상품 조건 원천 — DOC-010 ADR-009 · DOC-011 §4.10
 *
 * 상시 스위트다. **네트워크에 나가지 않는다**(ADR-003) — `fetchImpl`을 주입하고, 입력은 전부
 * 2026-09-24에 받아 온 실응답이다(`fixtures/kiwoom-terms.ts`). 실제 키움 렌더가 오늘도 이
 * 모양인지는 이 스위트가 보지 못한다(DOC-010 AQ — 종단 실측 기록이 대신한다).
 */

type Failure = { code: string; detail: string }

const isFail = (v: unknown): v is Failure =>
  typeof v === 'object' && v !== null && 'code' in v && 'detail' in v

function parsed(code: PopupCode, html = popupHtml(code)): ParsedTerms {
  const p = parseTermsHtml(html, code)
  if (isFail(p)) throw new Error(`${code}: ${p.code} ${p.detail}`)
  return p
}

function failed(code: string, html: string): Failure {
  const p = parseTermsHtml(html, code)
  expect(isFail(p), JSON.stringify(p).slice(0, 300)).toBe(true)
  return p as Failure
}

const withListing = (p: ParsedTerms, listing: KiwoomProductCandidate | null = null): KiwoomProductTerms => ({
  ...p,
  listing,
  listingMiss: listing == null ? 'NOT_FOUND' : null,
})

/** 원문에 정확히 한 번 있는 조각을 바꾼다 — 없으면 테스트가 무효이므로 먼저 단언한다 */
function mutate(html: string, from: string | RegExp, to: string): string {
  const hits = typeof from === 'string' ? html.split(from).length - 1 : (html.match(new RegExp(from, 'g')) ?? []).length
  expect(hits, `조각이 정확히 한 번 있어야 한다: ${String(from)}`).toBe(1)
  return html.replace(from, to)
}

const blocking = (t: KiwoomProductTerms) => crossCheckTerms(t).filter((d) => d.severity === 'BLOCKING')

/* ================================================================== 픽스처 무결성 */

describe('전제 — 픽스처가 실응답 그대로다', () => {
  it.each(POPUP_CODES)('%s의 머리 주석이 요청과 원본을 적는다', (code) => {
    const head = popupHtml(code).slice(0, 800)
    expect(head).toContain(`body: salFundCd=${code}`)
    expect(head).toContain(`request: POST ${TERMS_ENDPOINTS.popup}`)
    expect(head).toMatch(/original: \d+ bytes · sha256 [0-9a-f]{64}/)
  })

  it.each(RAW_CODES)('%s — 원본의 sha256이 절단본 머리 주석과 같다', (code) => {
    const raw = rawPopupHtml(code)
    const sha = createHash('sha256').update(raw).digest('hex')
    expect(popupHtml(code).slice(0, 800)).toContain(`original: ${raw.length} bytes · sha256 ${sha}`)
  })

  it.each(RAW_CODES)('%s — 원본과 절단본의 파싱 결과가 같다 (절단이 결과를 바꾸지 않았다)', (code) => {
    expect(parseTermsHtml(rawPopupHtml(code).toString('utf8'), code)).toEqual(parsed(code))
  })

  it.each(Object.entries(SEARCH_FIXTURES))('검색 %s — 바이트 수·sha256이 기록과 같다', (_k, f) => {
    const bytes = searchBytes(f)
    expect(bytes.length).toBe(f.bytes)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.sha256)
  })

  it('★ 절단본에 NAV 탭의 표가 «남아 있다» — 구획 경계 규칙이 실제로 시험된다', () => {
    /*
     * 음성 대조다. 「다음 제목까지」만 경계로 쓰면 E00795의 조기상환 구획이 공지 제목 전까지
     * 늘어나고 그 사이에 NAV 표가 있다 — 그 표가 이 픽스처에 없다면 아래 파싱 케이스들이
     * 경계 규칙을 증명하지 않는다.
     */
    const clean = stripNoise(popupHtml('E00795'))
    const start = clean.indexOf('>조기상환 평가정보</h1>')
    const notices = clean.indexOf('>ELS/DLS 공지사항</h1>')
    expect(start).toBeGreaterThan(0)
    expect(notices).toBeGreaterThan(start)
    expect((clean.slice(start, notices).match(/<table\b/g) ?? []).length).toBeGreaterThanOrEqual(2)
    // 그리고 규칙이 그 표를 구획 밖에 둔다
    const section = findSection(clean, '조기상환 평가정보')
    expect(typeof section).toBe('string')
    expect(onlyTable(section as string)).not.toBeNull()
  })

  it('★ E04000도 만기 구획 뒤에 제목 없는 표가 있다', () => {
    const clean = stripNoise(popupHtml('E04000'))
    const start = clean.indexOf('>만기상환 평가정보</h1>')
    const notices = clean.indexOf('>ELS/DLS 공지사항</h1>')
    expect((clean.slice(start, notices).match(/<table\b/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})

/* ================================================================== 팝업 파싱 — 픽스처별 */

describe('팝업 — E04000 (국내주식 · 만기 사흘 평균)', () => {
  const p = parsed('E04000')

  it('헤더·자산·차수·만기를 읽는다', () => {
    expect(p.name).toBe('키움 ELS 4000회')
    expect(p.status).toBe('ISSUED')
    expect(p.header).toMatchObject({
      headlineText: '최대 연 32.10%',
      headlineAnnualPct: '32.10',
      ladderText: '3년/ 6개월 (85-85-85-80-75-70) KI35',
      underlyingNames: ['삼성전자', 'SK하이닉스'],
      issueDate: '2026-05-29',
      maturityDate: '2029-05-31',
      subscription: { start: '2026-05-21', end: '2026-05-29' },
      redeemedText: '미상환',
    })
    expect(p.assets).toEqual([
      { name: '삼성전자', ticker: null, basePrice: '317000', kiPrice: '110950' },
      { name: 'SK하이닉스', ticker: null, basePrice: '2333000', kiPrice: '816550' },
    ])
    expect(p.rounds.map((r) => [r.label, r.evaluationDate, r.cumulativeYieldPct, r.barrierPct])).toEqual([
      ['1', '2026-11-30', '16.05', '85'],
      ['2', '2027-05-31', '32.1', '85'],
      ['3', '2027-11-29', '48.15', '85'],
      ['4', '2028-05-29', '64.2', '80'],
      ['5', '2028-11-29', '80.25', '75'],
    ])
    expect(p.rounds[0]!.barrierPrices).toEqual(['269450', '1983050'])
    expect(p.maturity).toEqual({
      evaluationDates: ['2029-05-25', '2029-05-28', '2029-05-29'],
      paymentDate: '2029-05-31',
      cumulativeYieldPct: '96.3',
      barrierPct: '70',
      barrierPrices: ['221900', '1633100'],
    })
  })

  it('문서 넷을 링크 문구로 가르고 공지 id를 싣는다', () => {
    expect(p.documents.map((d) => [d.kind, d.fileName])).toEqual([
      ['KEY', 'QE04000.pdf'],
      ['PROSPECTUS', 'BE04000.pdf'],
      ['SIMPLE', 'CE04000.pdf'],
      ['GUIDE', 'AE04000.pdf'],
    ])
    expect(p.documents[1]!.url).toBe(`${TERMS_ENDPOINTS.documentBase}BE04000.pdf`)
    expect(p.noticeIds).toEqual(['6503', '17944'])
  })

  it('★ 누적 수익률 16.05 × 12/6 = 헤드라인 32.10 — 키움 「수익률」은 누적이다', () => {
    expect(dec(p.rounds[0]!.cumulativeYieldPct).times(12).div(6).eq(dec(p.header.headlineAnnualPct!))).toBe(true)
  })

  it('대조가 아무것도 내지 않는다', () => {
    expect(crossCheckTerms(withListing(p))).toEqual([])
  })
})

describe('팝업 — EM1740 (해외 티커 · 리자드 1배 · 휴일로 당겨진 평가일)', () => {
  const p = parsed('EM1740')

  it('티커를 해외기초자산 정보의 거래소 행에서 읽는다', () => {
    expect(p.assets.map((a) => [a.name, a.ticker, a.basePrice, a.kiPrice])).toEqual([
      ['팔란티어 테크', 'PLTR', '151.86', '53.151'],
      ['AMD', 'AMD', '252.18', '88.263'],
    ])
  })

  it('3-1·3-2가 같은 차수 3의 두 행이고 리자드 행의 배리어가 낮다', () => {
    const [a, b] = p.rounds.filter((r) => r.round === 3)
    expect([a!.label, a!.variant, a!.barrierPct, a!.cumulativeYieldPct]).toEqual(['3-1', 1, '75', '21.63'])
    expect([b!.label, b!.variant, b!.barrierPct, b!.cumulativeYieldPct]).toEqual(['3-2', 2, '50', '21.63'])
    expect(b!.barrierPrices).toEqual(['75.93', '126.09']) // 뒤 0이 지워진다(75.9300)
  })

  it('★ 4차 평가일은 산식(토요일)이 아니라 실제 날짜(금요일)다', () => {
    expect(p.rounds.find((r) => r.label === '4')!.evaluationDate).toBe('2027-05-28')
  })

  it('사다리가 리자드 1배·L50·KI35를 말하고 대조가 비었다', () => {
    expect(p.ladder).toMatchObject({ lizard: true, lizardMultiple: 1, kiPct: '35', tenorMonths: 24, periodMonths: 4 })
    expect(p.ladder.steps![2]).toEqual({ barrierPct: '75', lizardPct: '50' })
    expect(crossCheckTerms(withListing(p))).toEqual([])
  })
})

describe('팝업 — EM2046 (리자드 2배)', () => {
  const p = parsed('EM2046')

  it('3-2 누적 수익률 = 2 × 3-1', () => {
    const r31 = p.rounds.find((r) => r.label === '3-1')!
    const r32 = p.rounds.find((r) => r.label === '3-2')!
    expect([r31.cumulativeYieldPct, r32.cumulativeYieldPct]).toEqual(['16.62', '33.24'])
    expect(p.ladder.lizardMultiple).toBe(2)
    expect(crossCheckTerms(withListing(p))).toEqual([])
  })

  it('음성 대조 — 3-2를 1배 값으로 바꾸면 LIZARD_MULTIPLE이다', () => {
    const html = mutate(
      popupHtml('EM2046'),
      /<td>3-2<\/td>(\s*<td>[^<]*<\/td>){2}\s*<td>33\.24<\/td>/,
      '<td>3-2</td><td>2027.09.17</td><td>2027.09.22</td><td>16.62</td>',
    )
    expect(blocking(withListing(parsed('EM2046', html))).map((d) => [d.kind, d.round])).toEqual([
      ['LIZARD_MULTIPLE', '3-2'],
    ])
  })
})

describe('팝업 — E03060 (★ 표가 안에서 일관된 채로 틀렸다)', () => {
  const p = parsed('E03060')

  it('파싱은 성공한다 — 표 자체는 형식이 옳다', () => {
    expect(p.rounds.map((r) => r.barrierPct)).toEqual(['85', '85', '85', '80', '80'])
    // 조기상환가격까지 85로 계산되어 있다 — 5,399.22 × 0.85 = 4,589.337
    expect(p.rounds[0]!.barrierPrices[0]).toBe('4589.337')
    expect(p.maturity!.evaluationDates).toEqual(['2027-07-23']) // rowspan="1"
  })

  it('★ 대조가 사다리 88/88과 표 85/85의 불일치를 BLOCKING으로 낸다', () => {
    expect(blocking(withListing(p))).toEqual([
      { kind: 'LADDER_BARRIER', severity: 'BLOCKING', round: '1', expected: '88', actual: '85' },
      { kind: 'LADDER_BARRIER', severity: 'BLOCKING', round: '2', expected: '88', actual: '85' },
    ])
  })

  it('헤더 자산명이 표와 달라도 NOTE다(⑪) — 개수는 같다', () => {
    const notes = crossCheckTerms(withListing(p)).filter((d) => d.kind === 'HEADER_ASSET_NAME')
    expect(notes.map((d) => [d.severity, d.expected, d.actual])).toEqual([
      ['NOTE', 'NIKKEI225', '일본니케이225지수'],
      ['NOTE', 'EUROSTOXX50', '유로STOXX50'],
    ])
  })
})

describe('팝업 — EM2048 (달러·월지급)', () => {
  const p = parsed('EM2048')

  it('수익률이 전부 0이고 사다리가 월지급·달러·KI25를 말한다', () => {
    expect(p.rounds.every((r) => r.cumulativeYieldPct === '0')).toBe(true)
    expect(p.maturity!.cumulativeYieldPct).toBe('0')
    expect(p.ladder).toMatchObject({ monthly: true, monthlyBarrierPct: '50', dollar: true, kiPct: '25' })
  })

  it('★ 값이 서로 맞아도 거부한다 — 월지급식·외화가 BLOCKING이다 (DOC-008 SCR-204)', () => {
    /*
     * 음성 대조의 반대편이다. 이 상품은 불일치가 **하나도 없다**(수익률 대조는 월지급식이라 건너뛴다).
     * 불일치만 셌다면 BLOCKING 0건으로 폼이 채워졌을 것이다. 목록 없이도 사다리의 `월지급`·`달러청약`이
     * 증인이므로 `actual`(목록 통화)은 null이다.
     */
    expect(crossCheckTerms(withListing(p))).toEqual([
      { kind: 'MONTHLY_PAY', severity: 'BLOCKING', expected: null, actual: null },
      { kind: 'FOREIGN_CURRENCY', severity: 'BLOCKING', expected: 'KRW', actual: null },
    ])
  })

  it('목록 사다리(`…) KI`)는 팝업(`KI25`)과 달라 NOTE다 — 팝업이 정본이다(⑩)', () => {
    const listing = (parseSearchBody(searchJson(SEARCH_FIXTURES.q2048)) as { candidates: KiwoomProductCandidate[] })
      .candidates[0]!
    expect(listing.ladder.kiUnspecified).toBe(true)
    expect(listing.monthlyPay).toBe(true)
    expect(listing.currency).toBe('USD')
    const d = crossCheckTerms(withListing(p, listing))
    expect(d.filter((x) => x.severity === 'BLOCKING')).toEqual([
      { kind: 'MONTHLY_PAY', severity: 'BLOCKING', expected: null, actual: null },
      { kind: 'FOREIGN_CURRENCY', severity: 'BLOCKING', expected: 'KRW', actual: 'USD' },
    ])
    expect(d.filter((x) => x.kind === 'LISTING_LADDER_TEXT').map((x) => x.severity)).toEqual(['NOTE'])
  })

  it('맨 `KI`를 사다리로 쓰면 KI_PCT_UNKNOWN이다 — 비율 없는 KI를 건너뛰지 않는다', () => {
    const t = withListing({ ...p, ladder: parseLadder('달러청약, 월지급배리어 50, 3년/6개월\r\n(85-85-80-75-70-65) KI') })
    expect(blocking(t).map((d) => d.kind)).toEqual(['MONTHLY_PAY', 'FOREIGN_CURRENCY', 'KI_PCT_UNKNOWN'])
  })
})

describe('팝업 — E04262 (청약 중 → PRE_ISSUANCE)', () => {
  const p = parsed('E04262')

  it('기준가는 null, 차수는 비고, 만기는 날짜·수익률만 있다', () => {
    expect(p.status).toBe('PRE_ISSUANCE')
    expect(p.assets.map((a) => [a.basePrice, a.kiPrice])).toEqual([
      [null, null],
      [null, null],
    ])
    expect(p.rounds).toEqual([])
    expect(p.maturity).toEqual({
      evaluationDates: ['2029-09-27', '2029-09-28', '2029-10-01'],
      paymentDate: '2029-10-04',
      cumulativeYieldPct: '73.8',
      barrierPct: '70',
      barrierPrices: [null, null],
    })
    expect(p.header.subscription).toEqual({ start: '2026-09-17', end: '2026-10-01' })
    expect(p.header.redeemedText).toBeNull() // 이 상품에는 상환여부 칸이 없다
    expect(p.documents.map((d) => d.fileName)).toContain('BE04262.pdf') // 청약 중에도 신원 문서가 있다
  })

  it('대조는 만기와 계단 수만 본다 — 비어 있다', () => {
    expect(crossCheckTerms(withListing(p))).toEqual([])
  })

  it('기준가가 일부만 0이면 BAD_VALUE다', () => {
    const html = mutate(popupHtml('EM2046'), /<td>977\.5<\/td>/, '<td>0</td>')
    expect(failed('EM2046', html).code).toBe('BAD_VALUE')
  })
})

describe('팝업 — E99999 (없는 코드도 200)', () => {
  it('EMPTY다 — 표식 문구는 진단에만 싣는다', () => {
    const f = failed('E99999', popupHtml('E99999'))
    expect(f.code).toBe('EMPTY')
    expect(f.detail).toContain('조기상환형 상품이 아닙니다')
  })
})

describe('팝업 — E00795 (옛 상품 · 만기 구획 없음)', () => {
  const p = parsed('E00795')

  it('★ 주석에 「만기상환」이 있어도 구획이 없으면 maturity는 null이다', () => {
    expect(popupHtml('E00795')).toContain('만기상환')
    expect(p.maturity).toBeNull()
    expect(p.rounds).toHaveLength(5)
    expect(p.assets.map((a) => a.name)).toEqual(['홍콩H지수', '유로STOXX50', 'KOSDAQ150 지수'])
  })

  it('계단이 없는 사다리(`조기상환기회 총5회`)·만기 구획 없음·KI 표기 부재가 BLOCKING이다', () => {
    expect(p.ladder).toMatchObject({ steps: null, earlyChances: 5, kiPct: null })
    expect(blocking(withListing(p)).map((d) => d.kind)).toEqual([
      'LADDER_STEPS_ABSENT',
      'MATURITY_ABSENT',
      'KI_PCT_UNKNOWN',
    ])
  })

  it('★ 만기 구획이 없으면 그것만으로도 거부다 — 다른 사유를 다 지워도 남는다', () => {
    // 만기는 `redemption_schedules`의 마지막 행인데 그 평가일·상환조건이 페이지에 없다
    const t = withListing({ ...parsed('E04000'), maturity: null })
    expect(blocking(t)).toEqual([{ kind: 'MATURITY_ABSENT', severity: 'BLOCKING', expected: null, actual: null }])
  })

  it('헤더 `3년 / 6개월마다`에서 주기를 읽어 수익률을 대조한다 — 3.8 = 7.60 × 6/12', () => {
    expect(parseTenor(p.header.tenorText)).toEqual({ tenorMonths: 36, periodMonths: 6 })
    const kinds = crossCheckTerms(withListing(p)).map((d) => d.kind)
    expect(kinds).not.toContain('PERIOD_UNKNOWN')
    expect(kinds).not.toContain('CUMULATIVE_YIELD')
  })
})

describe('팝업 — EM1039 (★ 4자리 절사)', () => {
  const p = parsed('EM1039')

  it('측정 근거 — 엔비디아 85.905 × 0.75 = 64.42875가 64.4287로 표시된다', () => {
    const exact = dec('85.905').times('0.75')
    expect(exact.toString()).toBe('64.42875')
    expect(p.rounds.find((r) => r.label === '3-1')!.barrierPrices[1]).toBe('64.4287')
    expect(DISPLAY_SCALE).toEqual({ price: 4, percent: 2 })
  })

  it('절사 규칙으로 통과한다 — 리자드 배수 미기재만 NOTE다', () => {
    expect(crossCheckTerms(withListing(p))).toEqual([
      { kind: 'LIZARD_MULTIPLE_UNSTATED', severity: 'NOTE', round: '3-2', expected: null, actual: '21' },
    ])
  })

  it('음성 대조 — 반올림 값(64.4288)이 오면 BARRIER_PRICE다', () => {
    const html = popupHtml('EM1039').replaceAll('<td>64.4287</td>', '<td>64.4288</td>')
    const d = blocking(withListing(parsed('EM1039', html)))
    expect(d.map((x) => [x.kind, x.round, x.expected, x.actual])).toEqual([
      ['BARRIER_PRICE', '3-1', '64.4287', '64.4288'],
      ['BARRIER_PRICE', '4', '64.4287', '64.4288'],
    ])
  })

  it('음성 대조 — 한 단위 모자란 값(64.4286)도 BARRIER_PRICE다 — 허용폭은 한 단위 미만이다', () => {
    const html = popupHtml('EM1039').replaceAll('<td>64.4287</td>', '<td>64.4286</td>')
    expect(blocking(withListing(parsed('EM1039', html))).map((x) => x.kind)).toEqual([
      'BARRIER_PRICE',
      'BARRIER_PRICE',
    ])
  })
})

/* ================================================================== 합성 변형 — 엄격성 */

describe('엄격성 — 형식이 어긋나면 틀린 값 대신 실패한다', () => {
  const E = popupHtml('E04000')

  it('★ 주석 처리된 「기초자산 현재가」 열을 풀면 MALFORMED다 — 열이 한 칸 밀린 채 통과하지 않는다', () => {
    let html = E.replace(
      '<!-- <th scope="col">기초자산 현재가</th> -->',
      '<th scope="col">기초자산 현재가</th>',
    )
    expect(html).not.toBe(E)
    html = html.replaceAll('<!-- 기초자산 현재가 숨김처리 -->', '<td>1</td>')
    expect(failed('E04000', html)).toMatchObject({ code: 'MALFORMED', detail: expect.stringContaining('기초자산 현재가') })
  })

  it('필수 헤더 라벨이 없으면 MALFORMED다', () => {
    const html = mutate(E, '<strong>발행일</strong>', '<strong>발행 일자</strong>')
    expect(failed('E04000', html)).toMatchObject({ code: 'MALFORMED', detail: expect.stringContaining('발행일') })
  })

  it('헤더 라벨이 둘이면 MALFORMED다', () => {
    const html = mutate(E, '<strong>만기일</strong>', '<strong>발행일</strong>')
    expect(failed('E04000', html).code).toBe('MALFORMED')
  })

  it('차수 표의 자산 열 이름이 기초자산정보와 다르면 MALFORMED다', () => {
    const html = mutate(E, /<th scope="col">SK하이닉스<\/th>(?=[\s\S]*만기상환 평가정보)/, '<th scope="col">SK하이닉스우</th>')
    expect(failed('E04000', html).detail).toContain('자산 열')
  })

  it('신원 문서(B<code>.pdf)가 없으면 MALFORMED다', () => {
    const html = mutate(E, 'data-filenm="BE04000.pdf"', 'data-filenm="BE04001.pdf"')
    expect(failed('E04000', html).detail).toContain('BE04000.pdf')
  })

  it('★ 다른 코드로 물었는데 이 팝업이 오면 MALFORMED다 — 팝업은 코드를 되돌려 주지 않는다', () => {
    expect(failed('E04001', E)).toMatchObject({ code: 'MALFORMED', detail: expect.stringContaining('BE04001.pdf') })
  })

  it('만기 병합 칸이 줄마다 다르면 MALFORMED다', () => {
    const html = mutate(E, '<tr><td>2029.05.28</td></tr>', '<tr><td>2029.05.28</td><td>X</td></tr>')
    expect(failed('E04000', html).code).toBe('MALFORMED')
  })

  it('만기 평가일이 증가하지 않으면 BAD_DATE다', () => {
    const html = mutate(E, '<tr><td>2029.05.28</td></tr>', '<tr><td>2029.05.20</td></tr>')
    expect(failed('E04000', html).code).toBe('BAD_DATE')
  })

  it('실재하지 않는 날짜는 BAD_DATE다', () => {
    const html = mutate(E, '<td>2026.11.30</td>', '<td>2026.02.30</td>')
    expect(failed('E04000', html).code).toBe('BAD_DATE')
  })

  it('차수 평가일이 거꾸로 가면 BAD_DATE다', () => {
    const html = mutate(E, '<td>2027.05.31</td>', '<td>2026.10.30</td>')
    expect(failed('E04000', html).code).toBe('BAD_DATE')
  })

  it('차수에 빈틈이 있으면 MALFORMED다', () => {
    const html = mutate(E, /<td>3<\/td>(?=\s*<td>2027\.11\.29)/, '<td>7</td>')
    expect(failed('E04000', html).code).toBe('MALFORMED')
  })

  it.each([
    ['1134,250.0000', '쉼표가 세 자리마다가 아니다(공지의 실제 오타)'],
    ['-317,000', '음수'],
    ['317,000.12345', '소수 다섯째 자리'],
    ['31,7000', '묶음이 틀렸다'],
    ['1,000,000,000,000', 'numeric(18,6) 범위 밖'],
  ])('가격 토큰 %s는 BAD_VALUE다 — %s', (token) => {
    const html = mutate(E, '<td>317,000</td>', `<td>${token}</td>`)
    expect(failed('E04000', html).code).toBe('BAD_VALUE')
  })

  it('★ 가격 0은 `\'0.0000\'`도 null이다 — 문자열 비교가 아니라 dec().isZero()다', () => {
    const html = mutate(E, '<td>110,950</td>', '<td>0.0000</td>')
    expect(parsed('E04000', html).assets[0]!.kiPrice).toBeNull()
  })

  it.each([
    ['16.055', '셋째 자리 — numeric(6,4)가 조용히 반올림한다'],
    ['-16.05', '음수'],
    ['1,605', '쉼표'],
  ])('백분율 토큰 %s는 BAD_VALUE다 — %s', (token) => {
    const html = mutate(E, '<td>16.05</td>', `<td>${token}</td>`)
    expect(failed('E04000', html).code).toBe('BAD_VALUE')
  })

  it.each(['0', '201'])('상환조건 %s는 BAD_VALUE다 — (0, 200] 밖', (token) => {
    const row1 = /(<td>16\.05<\/td>\s*)<td>85<\/td>/
    const html = mutate(E, row1, `$1<td>${token}</td>`)
    expect(failed('E04000', html).code).toBe('BAD_VALUE')
  })

  it('모르는 엔티티는 풀지 않는다 — 토큰 정규식이 시끄럽게 실패한다', () => {
    const html = mutate(E, '<td>317,000</td>', '<td>317&thinsp;000</td>')
    expect(failed('E04000', html).code).toBe('BAD_VALUE')
  })

  it('ELB처럼 기준가가 있는데 조기상환 표가 비면 MALFORMED다(⑫)', () => {
    const html = E.replace(/(<h1 class="head-sub-title">조기상환 평가정보<\/h1>[\s\S]*?<tbody>)[\s\S]*?(<\/tbody>)/, '$1<tr><td colspan="7">해당 내용이 없습니다.</td></tr>$2')
    expect(html).not.toBe(E)
    expect(failed('E04000', html).code).toBe('MALFORMED')
  })

  it('문서 파일명이 한글이면 URL은 encodeURIComponent다', () => {
    const html = mutate(
      E,
      'data-filenm="AE04000.pdf" class="btn-download">',
      'data-filenm="ELS1회_퀵가이드.pdf" class="btn-download">',
    )
    const doc = parsed('E04000', html).documents.find((d) => d.kind === 'GUIDE')!
    expect(doc.fileName).toBe('ELS1회_퀵가이드.pdf')
    expect(doc.url).toBe(`${TERMS_ENDPOINTS.documentBase}ELS1%ED%9A%8C_%ED%80%B5%EA%B0%80%EC%9D%B4%EB%93%9C.pdf`)
  })

  it('티커 열 수가 자산 수와 다르면 티커를 전부 null로 둔다 — 위치로 남의 티커를 붙이지 않는다', () => {
    const html = mutate(
      popupHtml('EM1740'),
      /<td>\s*<a class="blank-link" href="http:\/\/www\.nasdaq\.com\/symbol\/amd\/stock-chart" target="_blank">시세보기 AMD<\/a>\s*<\/td>/,
      '',
    )
    expect(parsed('EM1740', html).assets.map((a) => a.ticker)).toEqual([null, null])
  })
})

/* ================================================================== 대조 — 앞 방향 절사 */

describe('대조 — 앞 방향 · 절사 (거꾸로 나누면 맞는 상품이 거부된다)', () => {
  /*
   * 합성이다 — 측정한 7개 상품의 누적 수익률은 전부 나누어떨어졌다(`DISPLAY_SCALE` 각주).
   * 연 24.25% · 6개월이면 1차 정확값은 12.125다. 절사 표시는 12.12이고 반올림 표시는 12.13이다.
   */
  const base = parsed('E04000')
  const synthetic = (first: string): KiwoomProductTerms =>
    withListing({
      ...base,
      header: { ...base.header, headlineAnnualPct: '24.25' },
      rounds: base.rounds.map((r) => ({
        ...r,
        cumulativeYieldPct: r.round === 1 ? first : dec('24.25').times(6 * r.round).div(12).toDecimalPlaces(2, 1).toString(),
      })),
      maturity: { ...base.maturity!, cumulativeYieldPct: '72.75' },
    })

  it('절사 표시 12.12는 통과한다', () => {
    expect(crossCheckTerms(synthetic('12.12')).filter((d) => d.kind === 'CUMULATIVE_YIELD')).toEqual([])
  })

  it('반올림 표시 12.13은 BLOCKING이다 — 규약이 다르면 시끄럽게 드러난다', () => {
    expect(crossCheckTerms(synthetic('12.13')).filter((d) => d.kind === 'CUMULATIVE_YIELD')).toEqual([
      { kind: 'CUMULATIVE_YIELD', severity: 'BLOCKING', round: '1', expected: '12.12', actual: '12.13' },
    ])
  })

  it('노낙인인데 KI 가격이 있으면 KI_PRICE다', () => {
    const t = withListing({ ...base, ladder: { ...base.ladder, kiPct: null, noKi: true } })
    expect(blocking(t).map((d) => [d.kind, d.asset])).toEqual([
      ['KI_PRICE', '삼성전자'],
      ['KI_PRICE', 'SK하이닉스'],
    ])
  })

  it('계단 수가 차수 + 1이 아니면 LADDER_STEP_COUNT다', () => {
    const t = withListing({ ...base, ladder: parseLadder('3년/ 6개월 (85-85-85-80-70) KI35') })
    expect(blocking(t).map((d) => d.kind)).toEqual(['LADDER_STEP_COUNT'])
  })

  it('(Lxx) 계단과 n-2 행이 어긋나면 LIZARD_POSITION이다', () => {
    const p = parsed('EM1740')
    const t = withListing({ ...p, ladder: parseLadder('★리자드1배★ 2년/ 4개월 (80-80-75(L55)-75-70-60) KI35') })
    expect(blocking(t)).toEqual([
      { kind: 'LIZARD_POSITION', severity: 'BLOCKING', round: '3-2', expected: '55', actual: '50' },
    ])
    const moved = withListing({ ...p, ladder: parseLadder('★리자드1배★ 2년/ 4개월 (80-80(L50)-75-75-70-60) KI35') })
    expect(blocking(moved).map((d) => [d.kind, d.round])).toEqual([
      ['LIZARD_POSITION', '2-2'],
      ['LIZARD_POSITION', '3-2'],
    ])
  })

  it('★ K ≥ L이면 KI_NOT_BELOW_LIZARD다 — 경계 K = L 포함 (DQ-09)', () => {
    const p = parsed('EM1740') // L50 · KI35
    const ladderWith = (ki: string) => parseLadder(`★리자드1배★ 2년/ 4개월 (80-80-75(L50)-75-70-60) KI${ki}`)
    const of = (ki: string) =>
      crossCheckTerms(withListing({ ...p, ladder: ladderWith(ki) })).filter((d) => d.kind === 'KI_NOT_BELOW_LIZARD')
    // 계단 `(L50)`과 표의 3-2 행이 같은 값이므로 한 번만 낸다
    expect(of('50')).toEqual([
      { kind: 'KI_NOT_BELOW_LIZARD', severity: 'BLOCKING', round: '3-2', expected: '50', actual: '50' },
    ])
    expect(of('55').map((d) => [d.expected, d.actual])).toEqual([['50', '55']])
    expect(of('49')).toEqual([])
  })

  it('청약 중(표 없음)에도 계단의 (Lxx)로 K ≥ L을 본다', () => {
    const p = parsed('E04262')
    const t = withListing({ ...p, ladder: parseLadder('리자드1배, 3년/6개월 (85-85(L50)-85-80-75-70) KI50') })
    expect(blocking(t).filter((d) => d.kind === 'KI_NOT_BELOW_LIZARD').map((d) => d.round)).toEqual(['2-2'])
  })

  it('노낙인 리자드는 K ≥ L 판정 밖이다 — KI가 없다', () => {
    const p = parsed('EM1740')
    const t = withListing({ ...p, ladder: parseLadder('★리자드1배★ 2년/ 4개월 (80-80-75(L50)-75-70-60) NoKI') })
    expect(crossCheckTerms(t).map((d) => d.kind)).not.toContain('KI_NOT_BELOW_LIZARD')
  })

  it('월지급·외화는 목록 하나만 말해도 거부다 — 팝업 사다리에 낱말이 없어도', () => {
    const listing = (parseSearchBody(searchJson(SEARCH_FIXTURES.q4000)) as { candidates: KiwoomProductCandidate[] })
      .candidates[0]!
    expect(listing.currency).toBe('KRW')
    expect(blocking(withListing(base, { ...listing, monthlyPay: true })).map((d) => d.kind)).toEqual(['MONTHLY_PAY'])
    expect(blocking(withListing(base, { ...listing, currency: 'USD' }))).toEqual([
      { kind: 'FOREIGN_CURRENCY', severity: 'BLOCKING', expected: 'KRW', actual: 'USD' },
    ])
    // 통화를 읽지 못했으면(null) 판정하지 않는다 — 사다리의 `달러청약`이 남은 증인이다
    expect(blocking(withListing(base, { ...listing, currency: null }))).toEqual([])
  })

  it('헤더 자산 개수가 표와 다르면 BLOCKING이다', () => {
    const t = withListing({ ...base, header: { ...base.header, underlyingNames: ['삼성전자'] } })
    expect(blocking(t).map((d) => d.kind)).toEqual(['HEADER_ASSET_COUNT'])
  })

  it('목록 발행일이 팝업과 다르면 BLOCKING이다', () => {
    const listing = (parseSearchBody(searchJson(SEARCH_FIXTURES.q4000)) as { candidates: KiwoomProductCandidate[] })
      .candidates[0]!
    expect(crossCheckTerms(withListing(base, listing))).toEqual([])
    const wrong = { ...listing, issueDate: '2026-05-28' }
    expect(blocking(withListing(base, wrong)).map((d) => d.kind)).toEqual(['LISTING_ISSUE_DATE'])
  })

  it('결과에 사용자 문구가 없다 — 판별값과 두 값뿐이다', () => {
    for (const d of crossCheckTerms(withListing(parsed('E03060')))) {
      expect(Object.keys(d).sort()).toEqual(
        ['actual', 'expected', 'kind', 'severity', ...('round' in d ? ['round'] : []), ...('asset' in d ? ['asset'] : [])].sort(),
      )
    }
  })
})

/* ================================================================== 사다리 */

describe('사다리 — 실측 표기 전부', () => {
  it.each([
    ['3년/ 6개월\r\n(85-85-85-80-75-70) KI35', { kiPct: '35', tenorMonths: 36, periodMonths: 6, stepCount: 6 }],
    ['★리자드1배★ 2년/ 4개월\r\n(80-80-75(L50)-75-70-60) KI35', { kiPct: '35', lizardMultiple: 1, stepCount: 6 }],
    ['리자드2배, 2년/4개월\r\n(75-75-75(L50)-70-70-60) KI30', { kiPct: '30', lizardMultiple: 2, periodMonths: 4 }],
    ['만기2년 리자드형 조기상환형\r\n(80-80-75(L50)-75-70-60) KI40', { kiPct: '40', lizard: true, lizardMultiple: null, tenorMonths: 24, periodMonths: null }],
    ['만기3년 조기상환형\r\n(85-85-80-75-70-65) 25KI', { kiPct: '25', tenorMonths: 36 }],
    ['3년/ 6개월 (75-75(L50)-70-70-65-50) NO KI', { noKi: true, kiPct: null, stepCount: 6 }],
    ['조기상환기회 총5회', { earlyChances: 5, stepCount: null }],
    ['만기1년 부스터콜 조기상환형\r\n(100)', { stepCount: 1, tenorMonths: 12 }],
  ])('%s', (text, expected) => {
    const l = parseLadder(text)
    const { stepCount, ...rest } = expected as Record<string, unknown>
    expect(l).toMatchObject(rest)
    if (stepCount !== undefined) expect(l.steps?.length ?? null).toBe(stepCount)
  })

  it('NoKI(붙여 씀)도 노낙인이다', () => {
    expect(parseLadder('(85-80-75) NoKI')).toMatchObject({ noKi: true, kiPct: null, kiConflict: false })
  })

  it('맨 KI는 kiUnspecified다 — EM2048 목록', () => {
    expect(parseLadder('달러청약, 월지급배리어 50, 3년/6개월\r\n(85-85-80-75-70-65) KI')).toMatchObject({
      kiPct: null,
      kiUnspecified: true,
      monthly: true,
      monthlyBarrierPct: '50',
      dollar: true,
    })
  })

  it('모순은 kiConflict다 — NoKI와 KI35 · 비율 둘', () => {
    expect(parseLadder('(85-80) NoKI KI35')).toMatchObject({ kiConflict: true, kiPct: null })
    expect(parseLadder('(85-80) KI35 40KI')).toMatchObject({ kiConflict: true, kiPct: null })
  })

  it('계단 묶음이 둘이면 steps가 null이고 둘 다 보고한다', () => {
    const l = parseLadder('(85-80) (90-85) KI35')
    expect(l.steps).toBeNull()
    expect(l.unrecognized).toEqual(['(85-80)', '(90-85)'])
  })

  it('모르는 낱말은 실패시키지 않고 보고한다', () => {
    expect(parseLadder('기초자산 1개, 3년/6개월 (65-65-65-65-65-60) KI45').unrecognized).toEqual(['기초자산', '1개'])
  })
})

/* ================================================================== 검색 */

describe('검색 — es020 응답', () => {
  const ok = (f: SearchFixture) => {
    const r = parseSearchBody(searchJson(f))
    if (isFail(r)) throw new Error(r.detail)
    return r
  }

  it('100000 — 후보 하나를 읽는다(4000회)', () => {
    const r = ok(SEARCH_FIXTURES.q4000)
    expect(r.truncated).toBe(false)
    expect(r.candidates).toHaveLength(1)
    expect(r.candidates[0]).toMatchObject({
      productCode: 'E04000',
      isin: 'KR6KW0005FS1',
      name: '키움 ELS 4000회',
      roundNumber: '4000',
      issueDate: '2026-05-29',
      maturityDate: '2029-05-31',
      headlineAnnualPct: '32.10',
      underlyingNames: ['삼성전자', 'SK하이닉스'],
      currency: 'KRW',
      monthlyPay: false,
      redeemed: false,
    })
  })

  it('★ ki_yn을 읽지 않는다 — 「KI 터치 여부」가 불리언으로 새지 않는다', () => {
    const c = ok(SEARCH_FIXTURES.q795).candidates.find((x) => x.productCode === 'E00795')!
    expect(Object.keys(c)).not.toContain('kiTouched')
    expect(JSON.stringify(c)).not.toMatch(/ki_?yn|kiTouched/i)
    expect(TERMS_NOT_READ).toHaveProperty('KI여부')
  })

  it('100000 — 부분 일치를 받은 순서대로 둔다(795 → 3795회가 먼저)', () => {
    const r = ok(SEARCH_FIXTURES.q795)
    expect(r.candidates.map((c) => [c.productCode, c.roundNumber])).toEqual([
      ['E03795', '3795'],
      ['E02795', '2795'],
      ['EM0795', '795'],
      ['E00795', '795'],
    ])
    expect(r.candidates.find((c) => c.productCode === 'EM0795')!.ladder.kiPct).toBe('25') // `25KI`
  })

  it('505065 — 0건이다(g1이 없다)', () => {
    expect(ok(SEARCH_FIXTURES.q3060)).toEqual({ candidates: [], truncated: false, dropped: 0 })
  })

  it('100001 — truncated다. 다음 페이지를 따라가지 않는다', () => {
    const r = ok(SEARCH_FIXTURES.q100jo)
    expect(r.truncated).toBe(true)
    expect(r.candidates).toHaveLength(40)
  })

  it('520050 — HTTP다. 코드와 문구를 detail에 싣는다', () => {
    const r = parseSearchBody(searchJson(SEARCH_FIXTURES.qEls3))
    expect(r).toMatchObject({ code: 'HTTP', detail: expect.stringContaining('520050') })
  })

  it('resultMap이 없거나 g1이 배열이 아니면 MALFORMED다', () => {
    expect(parseSearchBody({})).toMatchObject({ code: 'MALFORMED' })
    expect(parseSearchBody({ result: { resultMap: { resp_code: '100000', g1: {} } } })).toMatchObject({ code: 'MALFORMED' })
  })

  it('코드·이름이 형식이 아닌 행은 버리고 센다 — 전부 버려지면 MALFORMED다', () => {
    const good = (searchJson(SEARCH_FIXTURES.q4000) as { result: { resultMap: { g1: unknown[] } } }).result.resultMap.g1[0]
    const body = (rows: unknown[]) => ({ result: { resultMap: { resp_code: '100000', g1: rows } } })
    expect(parseSearchBody(body([good, { stk_code: 'X1', stk_nm: 'a' }, { stk_code: 'E04001', stk_nm: '' }]))).toMatchObject({
      dropped: 2,
      candidates: [{ productCode: 'E04000' }],
    })
    expect(parseSearchBody(body([{ stk_code: 'nope' }]))).toMatchObject({ code: 'MALFORMED' })
  })
})

/* ================================================================== 어댑터 (I/O) */

type Call = { url: string; init: RequestInit | undefined }

function router(routes: Record<string, (body: string) => Response | Promise<Response>>) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const key = Object.keys(routes).find((k) => String(url).includes(k))
    if (key == null) return new Response('not routed', { status: 404 })
    return routes[key]!(String(init?.body ?? ''))
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const html200 = (code: PopupCode) => () => new Response(popupHtml(code), { status: 200 })
const json200 = (f: SearchFixture) => () => new Response(searchText(f), { status: 200 })

describe('어댑터 — 던지지 않는다 · 쿠키 없음 · no-store', () => {
  it('성공 경로 — 팝업 다음 목록을 부르고 코드로 행을 붙인다', async () => {
    const { fetchImpl, calls } = router({ fndElsDetailPopup: html200('E04000'), getEndElsMainJson: json200(SEARCH_FIXTURES.q4000) })
    const out = await createKiwoomProductSource({ fetchImpl }).getKiwoomProductTerms('E04000')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.data.name).toBe('키움 ELS 4000회')
    expect(out.data.listing?.isin).toBe('KR6KW0005FS1')
    expect(out.data.listingMiss).toBeNull()
    expect(calls.map((c) => c.url)).toEqual([TERMS_ENDPOINTS.popup, TERMS_ENDPOINTS.search])
    expect(String(calls[0]!.init?.body)).toBe('salFundCd=E04000')
    // 목록 조회는 팝업의 «정확한» 상품명으로 한다
    expect(new URLSearchParams(String(calls[1]!.init?.body)).get('salFundNm')).toBe('키움 ELS 4000회')
    expect(crossCheckTerms(out.data)).toEqual([])
  })

  it('요청 모양 — POST · form-urlencoded · credentials 없음 · redirect manual · no-store', async () => {
    const { fetchImpl, calls } = router({ getEndElsMainJson: json200(SEARCH_FIXTURES.q4000) })
    await createKiwoomProductSource({ fetchImpl }).searchKiwoomProducts('4000회')
    const init = calls[0]!.init!
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' })
    expect(init).not.toHaveProperty('credentials')
    expect(init.redirect).toBe('manual')
    expect(init.cache).toBe('no-store')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it.each(Object.values(SEARCH_FIXTURES))('★ 검색 본문이 픽스처를 받아 온 본문과 바이트 단위로 같다 — %s', async (f) => {
    const { fetchImpl, calls } = router({ getEndElsMainJson: json200(f) })
    await createKiwoomProductSource({ fetchImpl }).searchKiwoomProducts(f.query)
    expect(String(calls[0]!.init?.body)).toBe(f.body)
    expect(Object.keys(SEARCH_FORM_DEFAULTS)).toContain('elsTp')
  })

  it('검색 결과 — 505065는 ok([]) · 100001은 truncated · 520050은 HTTP(CALL_FAILED)', async () => {
    const src = (f: SearchFixture) => createKiwoomProductSource({ fetchImpl: router({ getEndElsMainJson: json200(f) }).fetchImpl })
    expect(await src(SEARCH_FIXTURES.q3060).searchKiwoomProducts('3060회')).toEqual({ ok: true, data: [] })
    const t = await src(SEARCH_FIXTURES.q100jo).searchKiwoomProducts('100조')
    expect(t.ok && t.truncated).toBe(true)
    expect(await src(SEARCH_FIXTURES.qEls3).searchKiwoomProducts('키움 ELS 3')).toMatchObject({
      ok: false,
      code: 'HTTP',
      failure: 'CALL_FAILED',
    })
  })

  it.each(['', '   ', 'x'.repeat(31), '40\u000000회'])('검색어 %j는 네트워크에 나가지 않고 SYMBOL_SCHEME(NO_DATA)다', async (q) => {
    const { fetchImpl, calls } = router({})
    const out = await createKiwoomProductSource({ fetchImpl }).searchKiwoomProducts(q)
    expect(calls).toHaveLength(0)
    expect(out).toMatchObject({ ok: false, code: 'SYMBOL_SCHEME', failure: 'NO_DATA' })
  })

  it.each(['', 'e04000', 'E0400', 'E040000', 'X04000', '../E04000'])('상품 코드 %j는 네트워크에 나가지 않는다', async (code) => {
    const { fetchImpl, calls } = router({})
    const out = await createKiwoomProductSource({ fetchImpl }).getKiwoomProductTerms(code)
    expect(calls).toHaveLength(0)
    expect(out).toMatchObject({ ok: false, code: 'SYMBOL_SCHEME' })
  })

  it('빈 템플릿은 EMPTY(NO_DATA)다 — 목록을 부르지 않는다', async () => {
    const { fetchImpl, calls } = router({ fndElsDetailPopup: html200('E99999') })
    const out = await createKiwoomProductSource({ fetchImpl }).getKiwoomProductTerms('E99999')
    expect(out).toMatchObject({ ok: false, code: 'EMPTY', failure: 'NO_DATA' })
    expect(calls).toHaveLength(1)
  })

  it('목록 조회가 실패해도 조건은 실패하지 않는다 — listingMiss로 말한다', async () => {
    const down = router({ fndElsDetailPopup: html200('E04000'), getEndElsMainJson: () => new Response('x', { status: 500 }) })
    const a = await createKiwoomProductSource({ fetchImpl: down.fetchImpl }).getKiwoomProductTerms('E04000')
    expect(a.ok && [a.data.listing, a.data.listingMiss]).toEqual([null, 'CALL_FAILED'])

    const miss = router({ fndElsDetailPopup: html200('E04000'), getEndElsMainJson: json200(SEARCH_FIXTURES.q3060) })
    const b = await createKiwoomProductSource({ fetchImpl: miss.fetchImpl }).getKiwoomProductTerms('E04000')
    expect(b.ok && [b.data.listing, b.data.listingMiss]).toEqual([null, 'NOT_FOUND'])
  })

  it('fetch가 던지면 NETWORK다', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('연결 실패')
    }) as unknown as typeof fetch
    const src = createKiwoomProductSource({ fetchImpl })
    expect(await src.getKiwoomProductTerms('E04000')).toMatchObject({ ok: false, code: 'NETWORK', failure: 'CALL_FAILED' })
    expect(await src.searchKiwoomProducts('4000회')).toMatchObject({ ok: false, code: 'NETWORK' })
    expect(await src.listKiwoomAssets()).toMatchObject({ ok: false, code: 'NETWORK' })
  })

  it.each([
    [301, 'HTTP'],
    [302, 'HTTP'],
    [400, 'BLOCKED'],
    [401, 'AUTH'],
    [429, 'QUOTA'],
    [500, 'HTTP'],
  ])('HTTP %s → %s', async (status, code) => {
    const { fetchImpl } = router({ fndElsDetailPopup: () => new Response(status < 400 ? null : 'x', { status }) })
    expect(await createKiwoomProductSource({ fetchImpl }).getKiwoomProductTerms('E04000')).toMatchObject({ ok: false, code })
  })

  it('★ 3xx가 opaqueredirect로 와도 HTTP다 — 따라간 200 페이지를 빈 템플릿(EMPTY)으로 읽지 않는다', async () => {
    const opaque = { type: 'opaqueredirect', status: 0, ok: false, body: null } as unknown as Response
    const { fetchImpl } = router({ fndElsDetailPopup: () => opaque })
    expect(await createKiwoomProductSource({ fetchImpl }).getKiwoomProductTerms('E04000')).toMatchObject({ ok: false, code: 'HTTP' })
  })

  it('WAF 차단 본문은 BLOCKED다 — 정상 팝업의 evfw 스크립트는 표식이 아니다', async () => {
    const blocked = router({ fndElsDetailPopup: () => new Response('{"eversafeThreat":true}', { status: 200 }) })
    expect(await createKiwoomProductSource({ fetchImpl: blocked.fetchImpl }).getKiwoomProductTerms('E04000')).toMatchObject({
      code: 'BLOCKED',
    })
    const raw = rawPopupHtml('E04000').toString('utf8')
    expect(raw).toContain('evfw')
    const normal = router({ fndElsDetailPopup: () => new Response(raw, { status: 200 }), getEndElsMainJson: json200(SEARCH_FIXTURES.q4000) })
    expect((await createKiwoomProductSource({ fetchImpl: normal.fetchImpl }).getKiwoomProductTerms('E04000')).ok).toBe(true)
  })

  it('JSON이 아닌 검색 본문은 MALFORMED다', async () => {
    const { fetchImpl } = router({ getEndElsMainJson: () => new Response('<html>', { status: 200 }) })
    expect(await createKiwoomProductSource({ fetchImpl }).searchKiwoomProducts('4000회')).toMatchObject({ code: 'MALFORMED' })
  })

  it('본문이 1MB를 넘으면 스트림 도중에 멈추고 MALFORMED다', async () => {
    let pulled = 0
    const chunk = new Uint8Array(256 * 1024)
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        if (pulled > 100) controller.close()
        else controller.enqueue(chunk)
      },
    })
    const { fetchImpl } = router({ fndElsDetailPopup: () => new Response(stream, { status: 200 }) })
    const out = await createKiwoomProductSource({ fetchImpl }).getKiwoomProductTerms('E04000')
    expect(out).toMatchObject({ ok: false, code: 'MALFORMED' })
    expect(pulled).toBeLessThan(10) // 전부 읽지 않았다
  })

  it('데드라인이 지났으면 호출하지 않고 NETWORK로 답한다', async () => {
    const { fetchImpl, calls } = router({ fndElsDetailPopup: html200('E04000') })
    const src = createKiwoomProductSource({ fetchImpl, deadlineAt: 0 })
    expect(await src.getKiwoomProductTerms('E04000')).toMatchObject({ ok: false, code: 'NETWORK' })
    expect(await src.searchKiwoomProducts('4000회')).toMatchObject({ ok: false, code: 'NETWORK' })
    expect(await src.listKiwoomAssets()).toMatchObject({ ok: false, code: 'NETWORK' })
    expect(calls).toHaveLength(0)
  })

  it('타임아웃은 NETWORK다', async () => {
    const fetchImpl = ((_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      })) as unknown as typeof fetch
    const out = await createKiwoomProductSource({ fetchImpl, timeoutMs: 5 }).getKiwoomProductTerms('E04000')
    expect(out).toMatchObject({ ok: false, code: 'NETWORK' })
  })
})

describe('어댑터 — listKiwoomAssets (es040 목록 셋)', () => {
  const body = (type: string, rows: { els_unas_tp: string; stk_nm: string; stk_code: string }[]) =>
    new Response(JSON.stringify({ result: { map: { g1: rows.filter((r) => r.els_unas_tp === type) } } }), { status: 200 })
  const rows = ASSET_LIST_BODY.result.map.g1

  it('부류 셋을 순서대로 묻고 합친다', async () => {
    const { fetchImpl, calls } = router({
      getBaseAssetJson: (b) => body(new URLSearchParams(b).get('elsUnasTp')!, rows),
    })
    const out = await createKiwoomProductSource({ fetchImpl }).listKiwoomAssets()
    expect(calls.map((c) => String(c.init?.body))).toEqual(['elsUnasTp=1', 'elsUnasTp=2', 'elsUnasTp=3'])
    expect(out.ok && out.data.map((a) => a.stkCode)).toEqual(rows.map((r) => r.stk_code))
  })

  it('한 부류의 응답에 다른 부류 행이 섞이면 MALFORMED다 — provider_symbol 접두가 틀린다', async () => {
    const { fetchImpl } = router({
      getBaseAssetJson: () => new Response(JSON.stringify(ASSET_LIST_BODY), { status: 200 }),
    })
    expect(await createKiwoomProductSource({ fetchImpl }).listKiwoomAssets()).toMatchObject({ ok: false, code: 'MALFORMED' })
  })
})

/* ================================================================== 레지스트리 · 소스 */

describe('★ 레지스트리 — 조건 원천은 PriceProvider가 아니다', () => {
  it('세 명부 어디에도 없다', async () => {
    const { PRICE_PROVIDERS, KNOWN_PROVIDER_IDS, PROVIDER_CREDENTIALS } = await import('@/lib/providers/types')
    /*
     * 들어가면 §5.8 `refreshPrices`가 이것을 수집 대상으로 세고, V-21이 조건 원천 이름의
     * `provider` 매핑을 받아 준다. 명부가 es040 하나뿐임을 «정확히» 단언한다 — 부분 단언이면
     * 새 항목이 조용히 통과한다.
     */
    expect(PRICE_PROVIDERS.map((f) => f.id)).toEqual(['KIWOOM_ES040'])
    expect([...KNOWN_PROVIDER_IDS]).toEqual(['KIWOOM_ES040'])
    expect(Object.keys(PROVIDER_CREDENTIALS)).toEqual(['KIWOOM_ES040'])
  })

  it('조건 원천 모듈은 ProviderFactory를 내보내지 않는다', async () => {
    const mod = await import('@/lib/providers/kiwoom/terms')
    expect(Object.keys(mod)).toEqual(['createKiwoomProductSource'])
  })

  it('조건 원천 소스가 레지스트리를 «값으로» import하지 않는다 — 타입만 쓴다', () => {
    /*
     * 낱말 검색으로 하지 않는다 — 주석이 「레지스트리에 없다」를 서술하느라 그 이름들을 쓴다
     * (`kiwoom.test.ts`의 강제 변환 각주와 같은 함정). import 문의 모양만 본다.
     */
    for (const f of ['terms.ts', 'terms-parse.ts', 'terms-check.ts', 'search-parse.ts', 'terms-types.ts']) {
      const src = readFileSync(join(process.cwd(), 'src/lib/providers/kiwoom', f), 'utf8')
      expect(src, f).not.toMatch(/^import \{[^}]*\} from '\.\.\/types'/m)
    }
  })
})
