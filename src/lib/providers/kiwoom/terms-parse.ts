import { dec } from '@/lib/decimal'

import { cellText, decodeEntities, expandGrid, findSection, onlyTable, rowsOf, stripNoise } from './html'
import { parseLadder } from './ladder'
import { isRealDate, type ParseFailure } from './parse'
import { headlinePct, splitNames } from './search-parse'
import {
  ASSET_COLUMNS,
  ASSET_COLUMNS_NOT_READ,
  DOCUMENT_KINDS,
  HEADER_LABELS,
  IDENTITY_DOCUMENT,
  MATURITY_COLUMNS,
  MATURITY_PRICE_GROUP,
  NO_ROWS_TEXT,
  NOT_AUTOCALLABLE_MARKER,
  REQUIRED_HEADER_LABELS,
  ROUND_COLUMNS,
  ROUND_PRICE_GROUP,
  SECTION_HEADINGS,
  TERMS_ENDPOINTS,
  TICKER_CELL,
  TICKER_ROW,
} from './terms-endpoints'
import type {
  IsoDate,
  KiwoomAssetTerms,
  KiwoomDocument,
  KiwoomMaturity,
  KiwoomProductTerms,
  KiwoomRound,
  KiwoomTermsHeader,
  PctString,
  PriceString,
} from './terms-types'

/**
 * 키움 상세 팝업 HTML → 상품 조건 — **순수하다.** `fetch`를 모른다 — DOC-010 ADR-009
 *
 * ## 엄격하게 읽고 시끄럽게 실패한다
 *
 * 비공식 HTML이다. 마크업이 바뀌는 날 이 파서가 할 수 있는 최선은 **틀린 값 대신 빈 값**을
 * 내는 것이다 — `MALFORMED`는 폼이 비는 것으로 드러나지만 한 칸 밀린 열은 드러나지 않는다.
 * 그래서 열은 위치가 아니라 **머리 라벨**로 찾고, 라벨이 모자라도 **남아도** 실패한다.
 *
 * 둘째 방어선은 `terms-check.ts`다 — 팝업 표가 **안에서 일관된 채로 틀린** 사례가 있다(E03060).
 * 이 파일은 그것을 잡지 않는다(표 자체는 형식이 옳다). 셋째는 저장 전 사용자의 검토다.
 *
 * ## 상태를 가르는 순서
 *
 * ① 빈 템플릿(이름·문서·자산 행이 전부 없다) → `EMPTY`
 * ② 신원(`B<code>.pdf`) → 없으면 `MALFORMED`
 * ③ 기준가격이 **전부** 0 + 조기상환 표가 비었다 → `PRE_ISSUANCE` · 섞였다 → `BAD_VALUE`
 * ④ 기준가격이 있는데 조기상환 표가 비었다(ELB 등) → `MALFORMED`
 */

export type ParsedTerms = Omit<KiwoomProductTerms, 'listing' | 'listingMiss'>

/**
 * 가격 토큰. 쉼표는 **세 자리마다이거나 아예 없거나**다 — 공지의 오타 `1134,250.0000`을 거부한다.
 * 소수는 넷째 자리까지(`DISPLAY_SCALE.price`) — 다섯째가 오면 표시 규약이 바뀐 것이다.
 * 부호가 없으므로 음수는 형식 오류(`BAD_VALUE`)다.
 */
const PRICE_TOKEN = /^(?:[1-9]\d{0,2}(?:,\d{3})+|0|[1-9]\d*)(?:\.\d{1,4})?$/
/** 백분율 토큰. 둘째 자리까지 — `numeric(6,4)` 비율이 셋째 자리를 **조용히 반올림**한다 */
const PCT_TOKEN = /^\d{1,3}(?:\.\d{1,2})?$/
/** `numeric(18,6)`의 정수부 12자리 */
const PRICE_CEILING = dec('1000000000000')
const ROUND_LABEL = /^(\d{1,2})(?:-([12]))?$/

export function parseTermsHtml(html: string, productCode: string): ParsedTerms | ParseFailure {
  const clean = stripNoise(html)

  const names = [...clean.matchAll(/<h1\s+class="small-text"\s*>([\s\S]*?)<\/h1>/g)]
  if (names.length !== 1) {
    return fail('MALFORMED', `상품명 제목(small-text)이 ${names.length}개다`)
  }
  const name = cellText(names[0]![1]!)

  const links = [...clean.matchAll(/<a\b[^>]*\bdata-filenm="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(
    (m) => ({ fileName: decodeEntities(m[1]!).trim(), text: cellText(m[2]!) }),
  )

  const assetTable = sectionTable(clean, SECTION_HEADINGS.assets, true)
  if (isFailure(assetTable)) return assetTable
  const assetRows = assetRowsOf(assetTable!)
  if (isFailure(assetRows)) return assetRows

  // ① 빈 템플릿 — 셋이 «전부» 비어야 한다. 표식 문구만으로 가르지 않는다(⑫)
  if (name === '' && links.length === 0 && assetRows.length === 0) {
    const marker = clean.includes(NOT_AUTOCALLABLE_MARKER) ? ` · 「${NOT_AUTOCALLABLE_MARKER}」` : ''
    return fail('EMPTY', `빈 템플릿이다 — 키움이 모르는 코드다 (${productCode})${marker}`)
  }
  if (name === '') {
    return fail('MALFORMED', '상품명이 비었는데 문서·자산 행이 있다')
  }

  // ② 신원 — 팝업은 코드를 되돌려 주지 않는다. 파일명만이 코드를 말한다
  const identity = `${IDENTITY_DOCUMENT.prefix}${productCode}${IDENTITY_DOCUMENT.suffix}`
  if (!links.some((l) => l.fileName === identity)) {
    return fail(
      'MALFORMED',
      `신원 문서 ${identity}가 없다 — 이 팝업이 ${productCode}의 것인지 확인할 수 없다 (문서 ${links.length}개)`,
    )
  }

  const header = headerOf(clean)
  if (isFailure(header)) return header

  if (assetRows.length === 0) {
    return fail('MALFORMED', '상품명·문서가 있는데 기초자산 행이 없다')
  }
  const assets: KiwoomAssetTerms[] = []
  for (const row of assetRows) {
    const base = priceToken(row.base, `${row.name} 최초기준가격`)
    if (isFailure(base)) return base
    const ki = priceToken(row.ki, `${row.name} Knock-In 가격`)
    if (isFailure(ki)) return ki
    assets.push({ name: row.name, ticker: null, basePrice: base, kiPrice: ki })
  }

  // ③ 상태 — 날짜가 아니라 «내용»으로 가른다(E04200은 발행일이 지나도 0이다)
  const zeroBases = assets.filter((a) => a.basePrice == null).length
  if (zeroBases > 0 && zeroBases < assets.length) {
    return fail('BAD_VALUE', `최초기준가격이 일부만 0이다 (${zeroBases}/${assets.length})`)
  }
  const status = zeroBases === assets.length ? 'PRE_ISSUANCE' : 'ISSUED'

  const tickers = tickersOf(clean, assets.length)
  if (isFailure(tickers)) return tickers
  tickers.forEach((t, i) => {
    assets[i]!.ticker = t
  })

  const roundTable = sectionTable(clean, SECTION_HEADINGS.rounds, true)
  if (isFailure(roundTable)) return roundTable
  const rounds = roundsOf(roundTable!, assets)
  if (isFailure(rounds)) return rounds

  if (status === 'PRE_ISSUANCE' && rounds.length > 0) {
    return fail('MALFORMED', '최초기준가격이 전부 0인데 조기상환 차수 행이 있다')
  }
  // ④ ELB(E90795)가 여기로 온다 — 기준가격이 있고 조기상환 표가 비었다. 범위 밖이다
  if (status === 'ISSUED' && rounds.length === 0) {
    return fail('MALFORMED', '최초기준가격이 있는데 조기상환 평가정보가 비었다 — 조기상환형이 아닐 수 있다')
  }

  const maturityTable = sectionTable(clean, SECTION_HEADINGS.maturity, false)
  if (isFailure(maturityTable)) return maturityTable
  const maturity =
    maturityTable == null ? null : maturityOf(maturityTable, assets, status === 'PRE_ISSUANCE')
  if (isFailure(maturity)) return maturity

  const invariant = checkInvariants(header, rounds, maturity)
  if (invariant != null) return invariant

  return {
    productCode,
    name,
    status,
    header,
    ladder: parseLadder(header.ladderText),
    assets,
    rounds,
    maturity,
    documents: documentsOf(links),
    noticeIds: noticeIdsOf(clean),
  }
}

/* ------------------------------------------------------------------ 헤더 */

/**
 * 헤더 블록 — 제목 `<div class="els-block-title"><strong>X</strong></div>`의 값은 그 뒤 **형제**
 * `<div class="els-block-bold">`의 텍스트다.
 *
 * ★ 「다음 `class="els-block`까지」로 자르면 **모든 값이 빈 문자열**이 된다 — `els-block-bold`가
 * 바로 그 접두를 갖기 때문이다. 그리고 기초자산 블록에는 제목과 값 사이에 해외 자산 툴팁
 * (`div` 여러 겹)이 끼어 있다(EM1740). 그래서 값은 **다음 제목 전의 첫 `els-block-bold`**이고,
 * 그 칸 안에 `<div`가 있으면 첫 `</div>`에서 자른 값이 잘렸을 수 있으므로 `MALFORMED`다.
 */
function headerOf(clean: string): KiwoomTermsHeader | ParseFailure {
  const titles = [...clean.matchAll(/<div\s+class="els-block-title"\s*>\s*<strong>([\s\S]*?)<\/strong>/g)]
  const values = new Map<string, string>()
  for (let i = 0; i < titles.length; i += 1) {
    const label = cellText(titles[i]![1]!)
    const from = titles[i]!.index! + titles[i]![0].length
    const until = i + 1 < titles.length ? titles[i + 1]!.index! : clean.length
    const bold = /<div\s+class="els-block-bold"\s*>([\s\S]*?)<\/div>/g
    bold.lastIndex = from
    const m = bold.exec(clean)
    if (m == null || m.index >= until) return fail('MALFORMED', `헤더 「${label}」의 값 칸이 없다`)
    if (/<div\b/i.test(m[1]!)) return fail('MALFORMED', `헤더 「${label}」의 값 칸 안에 div가 있다`)
    if (values.has(label)) return fail('MALFORMED', `헤더 「${label}」가 둘이다`)
    values.set(label, cellText(m[1]!))
  }
  for (const label of REQUIRED_HEADER_LABELS) {
    const v = values.get(label)
    if (v == null || v === '' || v === '-') return fail('MALFORMED', `헤더 「${label}」가 없거나 비었다`)
  }

  const issueDate = dotDate(values.get(HEADER_LABELS.issueDate)!, '발행일')
  if (isFailure(issueDate)) return issueDate
  const maturityDate = dotDate(values.get(HEADER_LABELS.maturityDate)!, '만기일')
  if (isFailure(maturityDate)) return maturityDate

  const headlineText = nonEmpty(values.get(HEADER_LABELS.headline))
  return {
    headlineText,
    headlineAnnualPct: headlineText == null ? null : headlinePct(headlineText),
    ladderText: values.get(HEADER_LABELS.ladder)!,
    underlyingNames: splitNames(values.get(HEADER_LABELS.underlyings)!),
    maxLossText: nonEmpty(values.get(HEADER_LABELS.maxLoss)),
    issueDate,
    maturityDate,
    tenorText: values.get(HEADER_LABELS.tenor)!,
    subscription: subscriptionOf(values.get(HEADER_LABELS.subscription) ?? ''),
    redeemedText: nonEmpty(values.get(HEADER_LABELS.redeemed)),
  }
}

/** `청약마감 D-7 2026.09.17 ~ 2026.10.01 (13:00까지)`(E04262)에서도 두 날짜만 읽는다. 표시용이다 */
function subscriptionOf(text: string): { start: IsoDate; end: IsoDate } | null {
  const m = /(\d{4}\.\d{2}\.\d{2})\s*~\s*(\d{4}\.\d{2}\.\d{2})/.exec(text)
  if (m == null) return null
  const start = dotDate(m[1]!, '청약 시작일')
  const end = dotDate(m[2]!, '청약 종료일')
  return isFailure(start) || isFailure(end) ? null : { start, end }
}

/* ------------------------------------------------------------------ 자산 */

type AssetRow = { name: string; base: string; ki: string }

function assetRowsOf(table: string): AssetRow[] | ParseFailure {
  const head = grid(table, 'thead', '기초자산정보 머리')
  if (isFailure(head)) return head
  if (head.length !== 1) return fail('MALFORMED', `기초자산정보 머리가 ${head.length}줄이다`)
  const labels = head[0]!

  const col = (label: string) => labels.filter((l) => l === label).length === 1 ? labels.indexOf(label) : -1
  const name = col(ASSET_COLUMNS.name)
  const base = col(ASSET_COLUMNS.basePrice)
  const ki = col(ASSET_COLUMNS.kiPrice)
  if (name < 0 || base < 0 || ki < 0) {
    return fail('MALFORMED', `기초자산정보 열 라벨이 모자란다: ${JSON.stringify(labels)}`)
  }
  const known = new Set([name, base, ki])
  const extra = labels.filter(
    (l, i) => !known.has(i) && !ASSET_COLUMNS_NOT_READ.some((prefix) => l.startsWith(prefix)),
  )
  if (extra.length > 0 || labels.length !== 3 + ASSET_COLUMNS_NOT_READ.length) {
    return fail('MALFORMED', `기초자산정보에 모르는 열이 있다: ${JSON.stringify(extra)}`)
  }

  const body = bodyGrid(table, labels.length, '기초자산정보')
  if (isFailure(body)) return body
  return body.map((r) => ({ name: r[name]!, base: r[base]!, ki: r[ki]! }))
}

/**
 * 해외주식 티커(⑯) — 「해외기초자산 정보」 표의 거래소 행. 열 수가 자산 수와 **같을 때만** 읽는다.
 *
 * 지수·국내주식이 섞인 상품에서 이 표가 해외 자산의 열만 가질 수 있는데, 그때 위치로 붙이면
 * **다른 자산에 티커가 붙는다** — 그 자산은 남의 시세로 판정된다. 그래서 개수가 다르면
 * 전부 `null`로 두고 이름으로 푸는 쪽(사상 층)에 맡긴다. 셀 하나라도 형식이 아니면 역시 전부 `null`.
 */
function tickersOf(clean: string, count: number): (string | null)[] | ParseFailure {
  const none = Array.from({ length: count }, () => null)
  const table = sectionTable(clean, SECTION_HEADINGS.overseasAssets, false)
  if (isFailure(table)) return table
  if (table == null) return none
  const rows = rowsOf(table, 'tbody')
  const row = rows?.find((r) => r[0]?.text === TICKER_ROW)
  if (row == null) return none
  const cells = row.slice(1).map((c) => TICKER_CELL.exec(c.text)?.[1] ?? null)
  if (cells.length !== count || cells.some((c) => c == null)) return none
  return cells
}

/* ------------------------------------------------------------------ 차수 */

function roundsOf(table: string, assets: readonly KiwoomAssetTerms[]): KiwoomRound[] | ParseFailure {
  const cols = columnsOf(table, ROUND_COLUMNS, ROUND_PRICE_GROUP, assets, '조기상환 평가정보')
  if (isFailure(cols)) return cols

  const body = bodyGrid(table, cols.width, '조기상환 평가정보')
  if (isFailure(body)) return body

  const out: KiwoomRound[] = []
  for (const r of body) {
    const label = r[cols.fixed.label]!
    const m = ROUND_LABEL.exec(label)
    if (m == null) return fail('MALFORMED', `차수 라벨이 형식이 아니다: ${show(label)}`)
    const where = `${label}차`

    const evaluationDate = dotDate(r[cols.fixed.evaluationDate]!, `${where} 평가일`)
    if (isFailure(evaluationDate)) return evaluationDate
    const paymentDate = dotDate(r[cols.fixed.paymentDate]!, `${where} 상환지급일`)
    if (isFailure(paymentDate)) return paymentDate
    const cumulativeYieldPct = pctToken(r[cols.fixed.cumulativeYield]!, `${where} 수익률`, 'yield')
    if (isFailure(cumulativeYieldPct)) return cumulativeYieldPct
    const barrierPct = pctToken(r[cols.fixed.barrier]!, `${where} 상환조건`, 'barrier')
    if (isFailure(barrierPct)) return barrierPct

    const barrierPrices: PriceString[] = []
    for (const [i, c] of cols.assets.entries()) {
      const p = priceToken(r[c]!, `${where} ${assets[i]!.name} 조기상환가격`)
      if (isFailure(p)) return p
      if (p == null) return fail('BAD_VALUE', `${where} ${assets[i]!.name} 조기상환가격이 0이다`)
      barrierPrices.push(p)
    }

    out.push({
      label,
      round: Number.parseInt(m[1]!, 10), // 차수는 개수다
      variant: m[2] === '1' ? 1 : m[2] === '2' ? 2 : null,
      evaluationDate,
      paymentDate,
      cumulativeYieldPct,
      barrierPct,
      barrierPrices,
    })
  }
  return out
}

/* ------------------------------------------------------------------ 만기 */

/**
 * 만기상환 평가정보 — 평가일이 `rowspan`으로 여러 줄이다(④). 펼친 뒤 **첫 열만** 줄마다 다르고
 * 나머지 열은 전부 같아야 한다 — 다르면 표를 잘못 펼쳤거나 마크업이 바뀐 것이다.
 */
function maturityOf(
  table: string,
  assets: readonly KiwoomAssetTerms[],
  preIssuance: boolean,
): KiwoomMaturity | ParseFailure {
  const cols = columnsOf(table, MATURITY_COLUMNS, MATURITY_PRICE_GROUP, assets, '만기상환 평가정보')
  if (isFailure(cols)) return cols
  const body = bodyGrid(table, cols.width, '만기상환 평가정보')
  if (isFailure(body)) return body
  if (body.length === 0) return fail('MALFORMED', '만기상환 평가정보 구획이 있는데 행이 없다')

  const first = body[0]!
  for (const r of body) {
    for (let c = 0; c < cols.width; c += 1) {
      if (c !== cols.fixed.evaluationDate && r[c] !== first[c]) {
        return fail('MALFORMED', `만기상환 평가정보의 병합 칸이 줄마다 다르다 (열 ${c})`)
      }
    }
  }

  const evaluationDates: IsoDate[] = []
  for (const r of body) {
    const d = dotDate(r[cols.fixed.evaluationDate]!, '만기상환평가일')
    if (isFailure(d)) return d
    if (evaluationDates.length > 0 && d <= evaluationDates[evaluationDates.length - 1]!) {
      return fail('BAD_DATE', `만기상환평가일이 증가하지 않는다: ${d}`)
    }
    evaluationDates.push(d)
  }

  const paymentDate = dotDate(first[cols.fixed.paymentDate]!, '만기 상환지급일')
  if (isFailure(paymentDate)) return paymentDate
  const cumulativeYieldPct = pctToken(first[cols.fixed.cumulativeYield]!, '만기 수익률', 'yield')
  if (isFailure(cumulativeYieldPct)) return cumulativeYieldPct
  const barrierPct = pctToken(first[cols.fixed.barrier]!, '만기 상환조건', 'barrier')
  if (isFailure(barrierPct)) return barrierPct

  const barrierPrices: (PriceString | null)[] = []
  for (const [i, c] of cols.assets.entries()) {
    const p = priceToken(first[c]!, `만기 ${assets[i]!.name} 만기상환가격`)
    if (isFailure(p)) return p
    // 청약 중에는 0이 «정상»이다(②). 발행 뒤의 0은 값이 거짓이다
    if (p == null && !preIssuance) return fail('BAD_VALUE', `만기 ${assets[i]!.name} 만기상환가격이 0이다`)
    if (p != null && preIssuance) return fail('BAD_VALUE', `청약 중인데 만기 ${assets[i]!.name} 가격이 있다`)
    barrierPrices.push(p)
  }

  return { evaluationDates, paymentDate, cumulativeYieldPct, barrierPct, barrierPrices }
}

/* ------------------------------------------------------------------ 불변식 */

/**
 * 표가 형식은 옳은데 **구조가 성립하지 않는** 경우. 대조(`terms-check.ts`)와 다르다 — 이것은
 * 다른 증인 없이도 거짓임을 아는 것들이다.
 */
function checkInvariants(
  header: KiwoomTermsHeader,
  rounds: readonly KiwoomRound[],
  maturity: KiwoomMaturity | null,
): ParseFailure | null {
  // 차수는 1..k 빈틈없이, 각 차수는 한 행이거나 `n-1` 바로 뒤 `n-2`
  let expected = 1
  for (let i = 0; i < rounds.length; i += 1) {
    const r = rounds[i]!
    if (r.round !== expected) return fail('MALFORMED', `차수가 ${expected}이어야 하는데 ${r.label}이다`)
    if (r.variant === 2) return fail('MALFORMED', `${r.label} 앞에 ${r.round}-1이 없다`)
    if (r.variant === 1) {
      const lizard = rounds[i + 1]
      if (lizard == null || lizard.round !== r.round || lizard.variant !== 2) {
        return fail('MALFORMED', `${r.label} 바로 뒤에 ${r.round}-2가 없다`)
      }
      if (lizard.evaluationDate !== r.evaluationDate || lizard.paymentDate !== r.paymentDate) {
        return fail('MALFORMED', `${r.round}-1과 ${r.round}-2의 날짜가 다르다`)
      }
      if (!dec(lizard.barrierPct).lt(dec(r.barrierPct))) {
        return fail('MALFORMED', `${r.round}-2(리자드)의 상환조건이 ${r.round}-1보다 낮지 않다`)
      }
      i += 1
    }
    expected += 1
  }

  const distinct = rounds.filter((r) => r.variant !== 2)
  for (const r of rounds) {
    if (r.paymentDate < r.evaluationDate) {
      return fail('BAD_DATE', `${r.label}차 상환지급일이 평가일보다 앞선다`)
    }
  }
  for (let i = 1; i < distinct.length; i += 1) {
    if (distinct[i]!.evaluationDate <= distinct[i - 1]!.evaluationDate) {
      return fail('BAD_DATE', `${distinct[i]!.label}차 평가일이 앞 차수보다 늦지 않다`)
    }
  }
  const firstEval = distinct[0]?.evaluationDate ?? maturity?.evaluationDates[0]
  if (firstEval != null && firstEval <= header.issueDate) {
    return fail('BAD_DATE', `첫 평가일(${firstEval})이 발행일(${header.issueDate}) 이후가 아니다`)
  }
  if (header.maturityDate <= header.issueDate) {
    return fail('BAD_DATE', '만기일이 발행일 이후가 아니다')
  }
  if (maturity != null) {
    const lastEarly = distinct[distinct.length - 1]?.evaluationDate
    if (lastEarly != null && maturity.evaluationDates[0]! <= lastEarly) {
      return fail('BAD_DATE', '만기상환평가일이 마지막 조기상환 평가일보다 늦지 않다')
    }
    const lastEval = maturity.evaluationDates[maturity.evaluationDates.length - 1]!
    if (lastEval > header.maturityDate) return fail('BAD_DATE', '만기상환평가일이 만기일보다 늦다')
    if (maturity.paymentDate < lastEval) return fail('BAD_DATE', '만기 상환지급일이 평가일보다 앞선다')
  }
  return null
}

/* ------------------------------------------------------------------ 표 공통 */

type Columns<K extends string> = { fixed: Record<K, number>; assets: number[]; width: number }

/**
 * 두 줄 머리를 펼쳐 **잎 라벨**로 열을 찾는다. 자산 가격 열은 부모 라벨(`조기상환가격`·
 * `만기상환가격`) 아래의 잎이고, 그 이름이 기초자산정보 표의 이름과 **순서까지** 같아야 한다.
 * 알 수 없는 열이 하나라도 있으면 `MALFORMED`다.
 */
function columnsOf<K extends string>(
  table: string,
  fixedLabels: Record<K, string>,
  priceGroup: string,
  assets: readonly KiwoomAssetTerms[],
  where: string,
): Columns<K> | ParseFailure {
  const head = grid(table, 'thead', `${where} 머리`)
  if (isFailure(head)) return head
  if (head.length === 0) return fail('MALFORMED', `${where} 머리가 비었다`)
  const top = head[0]!
  const leaf = head[head.length - 1]!

  const fixed = {} as Record<K, number>
  const used = new Set<number>()
  for (const key of Object.keys(fixedLabels) as K[]) {
    const hits = leaf.flatMap((l, i) => (l === fixedLabels[key] ? [i] : []))
    if (hits.length !== 1) {
      return fail('MALFORMED', `${where}에 「${fixedLabels[key]}」 열이 ${hits.length}개다`)
    }
    fixed[key] = hits[0]!
    used.add(hits[0]!)
  }
  const priceCols = top.flatMap((t, i) => (t === priceGroup && !used.has(i) ? [i] : []))
  const unknown = leaf.filter((_, i) => !used.has(i) && !priceCols.includes(i))
  if (unknown.length > 0) {
    return fail('MALFORMED', `${where}에 모르는 열이 있다: ${JSON.stringify(unknown)}`)
  }
  const priceNames = priceCols.map((i) => leaf[i]!)
  const assetNames = assets.map((a) => a.name)
  if (JSON.stringify(priceNames) !== JSON.stringify(assetNames)) {
    return fail(
      'MALFORMED',
      `${where}의 자산 열 ${JSON.stringify(priceNames)} ≠ 기초자산정보 ${JSON.stringify(assetNames)}`,
    )
  }
  return { fixed, assets: priceCols, width: leaf.length }
}

function grid(table: string, part: 'thead' | 'tbody', where: string): string[][] | ParseFailure {
  const rows = rowsOf(table, part)
  if (rows == null) return fail('MALFORMED', `${where}: <${part}>가 없다`)
  const g = expandGrid(rows)
  if (g == null) return fail('MALFORMED', `${where}: 병합 칸을 펼치면 직사각형이 아니다`)
  return g
}

/** 본문 격자. 「해당 내용이 없습니다.」 한 줄은 **행 0개**다. 폭이 머리와 다르면 `MALFORMED` */
function bodyGrid(table: string, width: number, where: string): string[][] | ParseFailure {
  const body = grid(table, 'tbody', `${where} 본문`)
  if (isFailure(body)) return body
  if (body.length === 1 && body[0]!.every((c) => c === NO_ROWS_TEXT)) return []
  for (const r of body) {
    if (r.length !== width) return fail('MALFORMED', `${where} 본문 폭(${r.length})이 머리(${width})와 다르다`)
  }
  return body
}

/**
 * `required`면 없을 때 `MALFORMED`, 아니면 `null`. 있으면 구획 안의 **유일한** 표다 —
 * 표가 둘 이상이면 경계가 틀린 것이다(`html.ts` `findSection`의 NAV 각주).
 */
function sectionTable(clean: string, title: string, required: boolean): string | null | ParseFailure {
  const section = findSection(clean, title)
  if (section === 'DUPLICATE') return fail('MALFORMED', `「${title}」 구획이 둘이다`)
  if (section == null) return required ? fail('MALFORMED', `「${title}」 구획이 없다`) : null
  const table = onlyTable(section)
  if (table == null) return fail('MALFORMED', `「${title}」 구획에 표가 정확히 하나가 아니다`)
  return table
}

/* ------------------------------------------------------------------ 문서·공지 */

function documentsOf(links: readonly { fileName: string; text: string }[]): KiwoomDocument[] {
  const out: KiwoomDocument[] = []
  for (const l of links) {
    const kind = Object.prototype.hasOwnProperty.call(DOCUMENT_KINDS, l.text)
      ? DOCUMENT_KINDS[l.text as keyof typeof DOCUMENT_KINDS]
      : null
    if (kind == null || l.fileName === '') continue
    // 파일명이 한글일 수 있다(`ELS1회_퀵가이드.pdf`) — 경로 조각으로 인코딩한다
    out.push({ kind, fileName: l.fileName, url: `${TERMS_ENDPOINTS.documentBase}${encodeURIComponent(l.fileName)}` })
  }
  return out
}

function noticeIdsOf(clean: string): string[] {
  const section = findSection(clean, SECTION_HEADINGS.notices)
  if (section == null || section === 'DUPLICATE') return []
  return [...section.matchAll(/<tr\b[^>]*\bdata-sqno="(\d+)"/g)].map((m) => m[1]!)
}

/* ------------------------------------------------------------------ 토큰 */

/** 가격 → 쉼표를 지운 토큰. **0은 `null`**이다 — `dec().isZero()`로 가른다(`'0.0000'`도 0이다) */
function priceToken(raw: string, where: string): PriceString | null | ParseFailure {
  if (!PRICE_TOKEN.test(raw)) return fail('BAD_VALUE', `${where}이 가격 형식이 아니다: ${show(raw)}`)
  const token = raw.replaceAll(',', '')
  const value = dec(token)
  if (value.isZero()) return null
  if (value.gte(PRICE_CEILING)) return fail('BAD_VALUE', `${where}이 numeric(18,6) 범위를 넘는다: ${show(raw)}`)
  return token
}

/**
 * 백분율 → 토큰. 상환조건은 `(0, 200]`, 누적 수익률은 `[0, 1000)` — 월지급식의 수익률 `0`(⑨)이
 * 정상이므로 수익률만 0을 받는다.
 */
function pctToken(raw: string, where: string, kind: 'barrier' | 'yield'): PctString | ParseFailure {
  if (!PCT_TOKEN.test(raw)) return fail('BAD_VALUE', `${where}이 백분율 형식이 아니다(소수 둘째 자리까지): ${show(raw)}`)
  const v = dec(raw)
  if (kind === 'barrier' && (v.lte(0) || v.gt(200))) return fail('BAD_VALUE', `${where}이 (0, 200] 밖이다: ${raw}`)
  return raw
}

/** `YYYY.MM.DD` → `YYYY-MM-DD`. 실재하는 날짜만 */
function dotDate(raw: string, where: string): IsoDate | ParseFailure {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(raw)
  if (m == null) return fail('BAD_DATE', `${where}이 YYYY.MM.DD가 아니다: ${show(raw)}`)
  const iso = `${m[1]}-${m[2]}-${m[3]}`
  if (!isRealDate(iso)) return fail('BAD_DATE', `${where}이 실재하지 않는 날짜다: ${show(raw)}`)
  return iso
}

/* ------------------------------------------------------------------ 유틸 */

function nonEmpty(v: string | undefined): string | null {
  return v == null || v === '' ? null : v
}

function fail(code: ParseFailure['code'], detail: string): ParseFailure {
  return { code, detail }
}

function isFailure(v: unknown): v is ParseFailure {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'code' in v && 'detail' in v
}

function show(value: string): string {
  return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)
}
