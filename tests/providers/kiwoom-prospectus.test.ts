import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { extractWithUnpdf, readProspectus } from '@/lib/providers/kiwoom/prospectus'
import { parseProspectusText, type ProspectusTerms } from '@/lib/providers/kiwoom/prospectus-parse'
import { parseSearchBody } from '@/lib/providers/kiwoom/search-parse'
import { createKiwoomProductSource } from '@/lib/providers/kiwoom/terms'
import { crossCheckTerms } from '@/lib/providers/kiwoom/terms-check'
import { PROSPECTUS_MAX_BYTES, TERMS_ENDPOINTS } from '@/lib/providers/kiwoom/terms-endpoints'
import { parseTermsHtml } from '@/lib/providers/kiwoom/terms-parse'
import type { KiwoomDocument, KiwoomProductCandidate, KiwoomProductTerms } from '@/lib/providers/kiwoom/terms-types'

import {
  PROSPECTUS_FIXTURES,
  SEARCH_FIXTURES,
  popupHtml,
  prospectusBytes,
  prospectusText,
  searchJson,
  type PopupCode,
  type ProspectusCode,
} from './fixtures/kiwoom-terms'

/**
 * 투자설명서 — 읽기 · 대조 · 어댑터 (P8 컷 b5′ · DOC-010 ADR-009 §8.4 · §8.5 · DOC-011 X-08)
 *
 * 상시 스위트다 — 네트워크에 나가지 않는다(ADR-003). 투자설명서는 **추출 텍스트 픽스처**로 들어오고(PDF를 싣지 않는다 —
 * 픽스처 머리 각주), PDF → 텍스트 단계는 맨 아래 「진짜 `unpdf`」 describe가 손으로 만든 작은 PDF로 지난다 — 라이브러리가
 * 캔버스 없이 이 런타임에서 적재되고 텍스트를 내는지까지가 이 층에서 잴 수 있는 것이다. Vercel 함수 안의 실행은 AQ-95다.
 */

const dec2 = (code: ProspectusCode) => parseProspectusText(prospectusText(code))!

/** ADR-009 §8.1 실측 표 — 다섯 상품의 지급금액 · 첫 · 마지막 월수익 평가일 · 조기상환 평가일 */
const EXPECTED: Record<
  ProspectusCode,
  { monthly: string; annual: string; first: string; last: string; early: string[] }
> = {
  EM2014: {
    monthly: '1.97',
    annual: '23.64',
    first: '2026-09-11',
    last: '2029-08-13',
    early: ['2027-02-12', '2027-08-13', '2028-02-11', '2028-08-11', '2029-02-09'],
  },
  EM2048: {
    monthly: '2.02',
    annual: '24.24',
    first: '2026-10-16',
    last: '2029-09-17',
    early: ['2027-03-17', '2027-09-17', '2028-03-17', '2028-09-15', '2029-03-16'],
  },
  EM2040: {
    monthly: '1.92',
    annual: '23.04',
    first: '2026-10-09',
    last: '2029-09-10',
    early: ['2027-03-10', '2027-09-10', '2028-03-10', '2028-09-08', '2029-03-09'],
  },
  EM2032: {
    monthly: '2.05',
    annual: '24.60',
    first: '2026-10-02',
    last: '2029-08-31',
    early: ['2027-03-03', '2027-09-03', '2028-03-03', '2028-09-01', '2029-03-02'],
  },
  EM2005: {
    monthly: '2.21',
    annual: '26.52',
    first: '2026-09-04',
    last: '2029-08-06',
    early: ['2027-02-05', '2027-08-06', '2028-02-04', '2028-08-04', '2029-02-06'],
  },
}

const CODES = Object.keys(PROSPECTUS_FIXTURES) as ProspectusCode[]

/* ================================================================== 전제 */

describe('전제 — 픽스처가 수집한 추출 텍스트 그대로다', () => {
  it.each(CODES)('%s — 바이트 수 · sha256이 기록과 같다', (code) => {
    const bytes = prospectusBytes(code)
    expect(bytes.length).toBe(PROSPECTUS_FIXTURES[code].textBytes)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(PROSPECTUS_FIXTURES[code].textSha256)
  })
})

/* ================================================================== 해석 (순수) */

describe('prospectus-parse — 네 구간 (표본 다섯)', () => {
  it.each(CODES)('★ %s — 36회 · 순번 1..36 · 지급금액 · 지급일 3영업일 · 조기상환 다섯', (code) => {
    const p = dec2(code)
    const e = EXPECTED[code]
    expect(p.declaredCount).toBe(36)
    expect(p.coupons.map((c) => c.couponNo)).toEqual(Array.from({ length: 36 }, (_, i) => i + 1))
    expect([p.coupons[0]!.evaluationDate, p.coupons[35]!.evaluationDate]).toEqual([e.first, e.last])
    expect([p.monthlyPct, p.annualPct, p.paymentBusinessDays]).toEqual([e.monthly, e.annual, 3])
    expect(p.earlyRedemptionDates).toEqual(e.early)
  })

  it.each(CODES)('★ %s — 조기상환 평가일이 6 · 12 · 18 · 24 · 30번째와 같은 날이다(RD-20 — 25/25)', (code) => {
    const p = dec2(code)
    expect([6, 12, 18, 24, 30].map((n) => p.coupons[n - 1]!.evaluationDate)).toEqual(p.earlyRedemptionDates)
  })

  it.each(CODES)('★ %s — 「메모리」는 문서에 있고 월수익 지급 구간에는 없다(마이크론 사업 설명 — ADR-009 ㉑)', (code) => {
    const text = prospectusText(code)
    const p = dec2(code)
    expect(text).toContain('메모리')
    expect(p.couponSection).toContain('월수익 지급조건')
    expect(p.couponSection).not.toContain('메모리')
  })

  it('EM2048 — 페이지 경계(「- 19 -」)가 표 한가운데 있어도 토큰으로 줍는다', () => {
    const text = prospectusText('EM2048')
    const at = text.indexOf('월수익지급평가일(1차')
    // 「월수익 지급금액」은 표 앞의 요약에도 있다 — 머리 뒤에서 찾는다(파서도 그렇게 자른다)
    const table = text.slice(at, text.indexOf('월수익 지급금액', at))
    expect(table).toMatch(/- 19 -/)
    expect(dec2('EM2048').coupons).toHaveLength(36)
  })

  it('표 머리가 없으면 null(못 읽음) · 머리 뒤가 깨져도 던지지 않고 있는 만큼 낸다(판정은 대조의 몫)', () => {
    const text = prospectusText('EM2048')
    expect(parseProspectusText(text.replace('월수익지급평가일(1차~36차)', '월수익 평가표'))).toBeNull()
    const broken = parseProspectusText(text.replace('7회 2027년 04월 16일', '7회 2027년 13월 16일'))!
    expect(broken.coupons).toHaveLength(35)
    const noAmount = parseProspectusText(text.replace(/액면금액\s*×\s*2\.02%\(연 24\.24%\)/, '액면금액의 일정 비율'))!
    expect([noAmount.monthlyPct, noAmount.annualPct]).toEqual([null, null])
  })
})

/* ================================================================== 대조 */

function termsOf(code: PopupCode & ProspectusCode, prospectus: KiwoomProductTerms['prospectus']): KiwoomProductTerms {
  const parsed = parseTermsHtml(popupHtml(code), code)
  if (!('status' in parsed)) throw new Error(parsed.detail)
  const fixture = code === 'EM2048' ? SEARCH_FIXTURES.q2048 : SEARCH_FIXTURES.q2014
  const listing = (parseSearchBody(searchJson(fixture)) as { candidates: KiwoomProductCandidate[] }).candidates.find(
    (c) => c.productCode === code,
  )!
  return { ...parsed, listing, listingMiss: null, prospectus }
}

const read = (p: ProspectusTerms) => ({ kind: 'READ' as const, ...p })
const blocking = (t: KiwoomProductTerms) => crossCheckTerms(t).filter((d) => d.severity === 'BLOCKING')

describe('대조 — 읽었으면 안내 화면과 전부 맞아야 한다 (ADR-009 §8.4)', () => {
  it.each(['EM2048', 'EM2014'] as const)('★ %s — 자기 투자설명서와는 BLOCKING 0건', (code) => {
    expect(blocking(termsOf(code, read(dec2(code))))).toEqual([])
  })

  it('★ 다른 상품의 투자설명서(EM2048 팝업 ↔ EM2040 PDF)는 거부한다 — 겹치는 달 · 연율 · 조기상환 날짜가 어긋난다', () => {
    const kinds = new Set(blocking(termsOf('EM2048', read(dec2('EM2040')))).map((d) => d.kind))
    expect([...kinds].sort()).toEqual(['PROSPECTUS_COUPON_ANCHOR', 'PROSPECTUS_EARLY_DATE', 'PROSPECTUS_RATE'])
  })

  it('못 읽었으면 대조하지 않는다 — UNREAD는 BLOCKING이 아니다(산식 폴백)', () => {
    expect(blocking(termsOf('EM2048', { kind: 'UNREAD', reason: 'TABLE_NOT_FOUND', detail: '' }))).toEqual([])
  })

  /* 음성 대조 — 실제 투자설명서에서 한 칸만 바꿔 그 검사 하나만 빨개지는지 본다 */
  const mutate = (patch: (p: ProspectusTerms) => ProspectusTerms) => blocking(termsOf('EM2048', read(patch(dec2('EM2048')))))

  it('한 달이 빠지면 PROSPECTUS_COUPON_COUNT — 그 하나만(겹치는 달의 색인이 무의미해진다)', () => {
    expect(mutate((p) => ({ ...p, coupons: p.coupons.slice(1).map((c, i) => ({ ...c, couponNo: i + 1 })) }))).toEqual([
      { kind: 'PROSPECTUS_COUPON_COUNT', severity: 'BLOCKING', expected: '36', actual: '36/35' },
    ])
  })

  it('겹치는 달(6번째)이 다르면 PROSPECTUS_COUPON_ANCHOR · 순서가 깨지면 PROSPECTUS_COUPON_ORDER', () => {
    const anchor = mutate((p) => ({
      ...p,
      coupons: p.coupons.map((c) => (c.couponNo === 6 ? { ...c, evaluationDate: '2027-03-18' } : c)),
    }))
    expect(anchor).toEqual([
      { kind: 'PROSPECTUS_COUPON_ANCHOR', severity: 'BLOCKING', round: '6', expected: '2027-03-17', actual: '2027-03-18' },
    ])
    const order = mutate((p) => ({
      ...p,
      coupons: p.coupons.map((c) => (c.couponNo === 3 ? { ...c, evaluationDate: '2026-11-01' } : c)),
    }))
    expect(order.map((d) => [d.kind, d.round])).toEqual([['PROSPECTUS_COUPON_ORDER', '3']])
  })

  it('지급금액 — 문장이 없으면 · 월 × 12 ≠ 연이면 · 연 ≠ 헤드라인이면 PROSPECTUS_RATE', () => {
    expect(mutate((p) => ({ ...p, monthlyPct: null })).map((d) => [d.kind, d.round])).toEqual([['PROSPECTUS_RATE', 'ABSENT']])
    expect(mutate((p) => ({ ...p, monthlyPct: '2.03' })).map((d) => [d.kind, d.round])).toEqual([['PROSPECTUS_RATE', 'MONTHLY']])
    expect(mutate((p) => ({ ...p, monthlyPct: '2.03', annualPct: '24.36' }))).toEqual([
      { kind: 'PROSPECTUS_RATE', severity: 'BLOCKING', round: 'HEADLINE', expected: '24.24', actual: '24.36' },
    ])
  })

  it('조기상환 날짜가 다르면 PROSPECTUS_EARLY_DATE · 변형 낱말이 월수익 구간에 있으면 MONTHLY_VARIANT(PROSPECTUS)', () => {
    expect(
      mutate((p) => ({ ...p, earlyRedemptionDates: p.earlyRedemptionDates.map((d, i) => (i === 1 ? '2027-09-20' : d)) })),
    ).toEqual([{ kind: 'PROSPECTUS_EARLY_DATE', severity: 'BLOCKING', round: '2', expected: '2027-09-17', actual: '2027-09-20' }])
    expect(mutate((p) => ({ ...p, couponSection: `${p.couponSection} 미지급 월수익은 누적하여 지급` }))).toEqual([
      { kind: 'MONTHLY_VARIANT', severity: 'BLOCKING', expected: 'PROSPECTUS', actual: '누적' },
    ])
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

const PDF_HEAD = new TextEncoder().encode('%PDF-1.7\n')
const pdfResponse = () => new Response(PDF_HEAD, { status: 200, headers: { 'Content-Type': 'application/pdf' } })
const searchResponse = (code: 'EM2048' | 'EM2014') => () =>
  new Response(JSON.stringify(searchJson(code === 'EM2048' ? SEARCH_FIXTURES.q2048 : SEARCH_FIXTURES.q2014)), { status: 200 })

describe('어댑터 — 팝업 사다리가 월지급일 때만 · 목록 행과 나란히 · 실패는 값이다', () => {
  it('★ EM2048 — 투자설명서를 GET으로 받는다(쿠키 없음 · redirect manual · no-store) · READ', async () => {
    const { fetchImpl, calls } = router({
      fndElsDetailPopup: () => new Response(popupHtml('EM2048'), { status: 200 }),
      getEndElsMainJson: searchResponse('EM2048'),
      'BEM2048.pdf': pdfResponse,
    })
    const out = await createKiwoomProductSource({
      fetchImpl,
      extractPdfText: async () => prospectusText('EM2048'),
    }).getKiwoomProductTerms('EM2048')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.data.prospectus?.kind).toBe('READ')
    expect(out.data.prospectus?.kind === 'READ' && out.data.prospectus.coupons).toHaveLength(36)
    const pdf = calls.find((c) => c.url.endsWith('BEM2048.pdf'))!
    expect(pdf.url).toBe(`${TERMS_ENDPOINTS.documentBase}BEM2048.pdf`)
    expect(pdf.init).toMatchObject({ method: 'GET', redirect: 'manual', cache: 'no-store' })
    expect(pdf.init).not.toHaveProperty('credentials')
    expect(blocking(out.data)).toEqual([])
  })

  it('★ 목록 행 검색과 나란히 나간다 — 검색이 끝나기 전에 PDF 요청이 이미 나갔다', async () => {
    let pdfRequested = false
    let sequential = false
    const { fetchImpl } = router({
      fndElsDetailPopup: () => new Response(popupHtml('EM2048'), { status: 200 }),
      getEndElsMainJson: () =>
        new Promise<Response>((resolve) => {
          const started = Date.now()
          const tick = () => {
            if (pdfRequested) return resolve(searchResponse('EM2048')())
            // 순차라면 PDF 요청이 검색 뒤에야 나가므로 여기서 영원히 기다린다 — 0.5초 뒤 풀고 순차였다고 적는다
            if (Date.now() - started > 500) {
              sequential = true
              return resolve(searchResponse('EM2048')())
            }
            setTimeout(tick, 5)
          }
          tick()
        }),
      'BEM2048.pdf': () => {
        pdfRequested = true
        return pdfResponse()
      },
    })
    await createKiwoomProductSource({ fetchImpl, extractPdfText: async () => prospectusText('EM2048') }).getKiwoomProductTerms(
      'EM2048',
    )
    expect([pdfRequested, sequential]).toEqual([true, false])
  })

  it('★ 상환 시 지급 상품(E04000)은 투자설명서를 부르지 않는다 — 요청 수 그대로 · prospectus = null', async () => {
    const { fetchImpl, calls } = router({
      fndElsDetailPopup: () => new Response(popupHtml('E04000'), { status: 200 }),
      getEndElsMainJson: () => new Response(JSON.stringify(searchJson(SEARCH_FIXTURES.q4000)), { status: 200 }),
    })
    const out = await createKiwoomProductSource({ fetchImpl }).getKiwoomProductTerms('E04000')
    expect(out.ok && out.data.prospectus).toBeNull()
    expect(calls.map((c) => c.url)).toEqual([TERMS_ENDPOINTS.popup, TERMS_ENDPOINTS.search])
  })

  it('★ 투자설명서가 실패해도 조건 조회는 성공한다 — UNREAD(FETCH_FAILED)이고 BLOCKING이 아니다', async () => {
    const { fetchImpl } = router({
      fndElsDetailPopup: () => new Response(popupHtml('EM2048'), { status: 200 }),
      getEndElsMainJson: searchResponse('EM2048'),
    })
    const out = await createKiwoomProductSource({ fetchImpl }).getKiwoomProductTerms('EM2048')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.data.prospectus).toMatchObject({ kind: 'UNREAD', reason: 'FETCH_FAILED' })
    expect(blocking(out.data)).toEqual([])
  })
})

describe('readProspectus — 「못 읽음」의 사유 전부 (던지지 않는다)', () => {
  const DOC: KiwoomDocument = { kind: 'PROSPECTUS', fileName: 'BEM2048.pdf', url: `${TERMS_ENDPOINTS.documentBase}BEM2048.pdf` }
  const deadline = () => Date.now() + 15_000
  const run = (fetchImpl: typeof fetch, extractPdfText?: (b: Uint8Array) => Promise<string>, documents = [DOC]) =>
    readProspectus({ fetchImpl, timeoutMs: 8_000, extractPdfText }, documents, deadline())
  const fetching = (response: () => Response | Promise<Response>) => (async () => response()) as unknown as typeof fetch

  it('문서 목록에 투자설명서가 없으면 NO_DOCUMENT — 유도하지 않는다(요청 0)', async () => {
    const { fetchImpl, calls } = router({})
    expect(await run(fetchImpl, undefined, [])).toMatchObject({ kind: 'UNREAD', reason: 'NO_DOCUMENT' })
    expect(calls).toEqual([])
  })

  it('HTTP 404 · 리다이렉트 · 네트워크 예외는 FETCH_FAILED', async () => {
    expect(await run(fetching(() => new Response('x', { status: 404 })))).toMatchObject({ reason: 'FETCH_FAILED' })
    expect(await run(fetching(() => new Response(null, { status: 302, headers: { Location: '/' } })))).toMatchObject({
      reason: 'FETCH_FAILED',
    })
    expect(
      await run((async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch),
    ).toMatchObject({ reason: 'FETCH_FAILED', detail: expect.stringContaining('fetch failed') })
  })

  it('상한(5MB)을 넘으면 읽기를 멈추고 TOO_LARGE — 스트림으로 센다', async () => {
    const chunk = new Uint8Array(1_048_576)
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(chunk)
        if (pulled > 10) controller.close()
      },
    })
    expect(await run(fetching(() => new Response(body, { status: 200 })))).toMatchObject({ reason: 'TOO_LARGE' })
    // 상한 바로 뒤에서 멈췄다 — 끝까지 읽지 않았다
    expect(pulled).toBeLessThanOrEqual(Math.ceil(PROSPECTUS_MAX_BYTES / chunk.byteLength) + 2)
  })

  it('%PDF-로 시작하지 않으면 NOT_PDF — 추출을 부르지 않는다', async () => {
    let extracted = false
    const out = await run(fetching(() => new Response('<html>점검 중</html>', { status: 200 })), async () => {
      extracted = true
      return ''
    })
    expect(out).toMatchObject({ reason: 'NOT_PDF' })
    expect(extracted).toBe(false)
  })

  it('추출이 던지면 EXTRACT_FAILED · 텍스트에 표 머리가 없으면 TABLE_NOT_FOUND · 있으면 READ', async () => {
    expect(
      await run(fetching(pdfResponse), async () => {
        throw new Error('Cannot find module')
      }),
    ).toMatchObject({ reason: 'EXTRACT_FAILED', detail: expect.stringContaining('Cannot find module') })
    expect(await run(fetching(pdfResponse), async () => '투자설명서 본문')).toMatchObject({ reason: 'TABLE_NOT_FOUND' })
    expect(await run(fetching(pdfResponse), async () => prospectusText('EM2014'))).toMatchObject({ kind: 'READ', declaredCount: 36 })
  })
})

/* ================================================================== 진짜 unpdf */

/** 손으로 만든 한 쪽짜리 PDF — 표준 글꼴(Helvetica) · ASCII 한 줄. xref 오프셋을 정확히 계산한다 */
function tinyPdf(line: string): Uint8Array {
  const content = `BT /F1 12 Tf 20 100 Td (${line}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

describe('진짜 unpdf — 캔버스 없이 이 런타임에서 적재되고 텍스트를 낸다 (ADR-009 §8.5 · AQ-95의 로컬 절반)', () => {
  it('★ 작은 PDF에서 글자를 뽑는다 — @napi-rs/canvas가 설치되어 있지 않아도', async () => {
    const text = await extractWithUnpdf(tinyPdf('UNPDF SMOKE 36'))
    expect(text).toContain('UNPDF SMOKE 36')
  })

  it('어댑터의 기본 추출 경로 전체(내려받기 → %PDF- → unpdf → 해석)를 지나 표 머리가 없으면 TABLE_NOT_FOUND', async () => {
    const doc: KiwoomDocument = { kind: 'PROSPECTUS', fileName: 'B.pdf', url: 'https://example.invalid/B.pdf' }
    const out = await readProspectus(
      { fetchImpl: (async () => new Response(new Blob([tinyPdf('NO TABLE HERE') as BlobPart]), { status: 200 })) as unknown as typeof fetch, timeoutMs: 8_000 },
      [doc],
      Date.now() + 15_000,
    )
    expect(out).toMatchObject({ kind: 'UNREAD', reason: 'TABLE_NOT_FOUND' })
  })
})
