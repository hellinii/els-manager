import { message } from './http'
import { parseProspectusText } from './prospectus-parse'
import { PROSPECTUS_MAX_BYTES } from './terms-endpoints'
import type { KiwoomDocument, ProspectusOutcome } from './terms-types'

/**
 * 투자설명서 읽기 — **I/O** — DOC-010 ADR-009 §8.4 · §8.5 (P8 컷 b5′)
 *
 * 팝업 문서 목록의 `B<code>.pdf`를 내려받아 텍스트를 뽑고 월수익 구간을 읽는다. 해석은 순수 함수(`prospectus-parse.ts`)다.
 *
 * ## 실패는 값이다 — 「못 읽음」
 *
 * 무엇이 실패해도 `{ kind: 'UNREAD' }`를 돌려주고 던지지 않는다. 조건 조회(`getKiwoomProductTerms`)는 투자설명서 한 파일의
 * 사정으로 실패하지 않는다 — 채움이 산식 폴백으로 접힌다(DOC-011 X-08 ①). 특히 **추출이 던지는 경우**(번들 · 메모리 ·
 * 콜드 스타트 — Vercel 함수 안의 실행은 로컬에서 잴 수 없다, DOC-010 AQ-95)가 「덜 채운 값」으로 끝나야 한다.
 *
 * ## 요청 하나 — 팝업 요청과 같은 약속
 *
 * 쿠키를 싣지 않는다 · `redirect: 'manual'`(따라가 200 페이지를 받으면 PDF가 아닌 본문을 읽는다) · `cache: 'no-store'` ·
 * 본문을 **바이트로 세며** 읽어 상한을 넘으면 멈춘다(`text()`처럼 다 읽은 뒤에야 크기를 아는 방식을 쓰지 않는다).
 *
 * ## 추출 라이브러리 — `unpdf` (ADR-009 §8.4)
 *
 * 런타임 의존 0 · pdf.js의 서버리스 빌드를 품는다. 캔버스(`@napi-rs/canvas`)는 선택 peer이고 **설치하지 않는다** — 텍스트
 * 추출에 쓰이지 않고 네이티브 바이너리다. **동적으로 불러온다** — 월지급식 상세에서만 pdf.js를 적재하고(첫 호출 RSS +86MB
 * 실측), 상환 시 지급 상품의 렌더는 그 비용을 내지 않는다.
 */
export type ProspectusDeps = {
  fetchImpl: typeof fetch
  timeoutMs: number
  extractPdfText?: (bytes: Uint8Array) => Promise<string>
}

export async function readProspectus(
  deps: ProspectusDeps,
  documents: readonly KiwoomDocument[],
  deadline: number,
): Promise<ProspectusOutcome> {
  const unread = (reason: Extract<ProspectusOutcome, { kind: 'UNREAD' }>['reason'], detail: string): ProspectusOutcome => ({
    kind: 'UNREAD',
    reason,
    detail,
  })
  // 팝업이 목록으로 주는 파일명만 쓴다 — 코드에서 유도하지 않는다(ADR-009 §3 첫 겹과 같은 이름)
  const document = documents.find((d) => d.kind === 'PROSPECTUS')
  if (document == null) return unread('NO_DOCUMENT', '팝업 문서 목록에 투자설명서가 없다')
  if (Date.now() > deadline) return unread('FETCH_FAILED', '전체 데드라인 초과 — 호출하지 않았다')

  let bytes: Uint8Array
  try {
    const response = await deps.fetchImpl(document.url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(1, Math.min(deps.timeoutMs, deadline - Date.now()))),
    })
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => undefined)
      return unread('FETCH_FAILED', `리다이렉트를 따라가지 않는다 (HTTP ${response.status})`)
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return unread('FETCH_FAILED', `HTTP ${response.status}`)
    }
    const body = await readBytesCapped(response, PROSPECTUS_MAX_BYTES)
    if (body == null) return unread('TOO_LARGE', `본문이 ${PROSPECTUS_MAX_BYTES}B를 넘는다 — 읽기를 멈췄다`)
    bytes = body
  } catch (error) {
    return unread('FETCH_FAILED', message(error))
  }

  if (!startsWithPdfMagic(bytes)) return unread('NOT_PDF', `본문이 %PDF-로 시작하지 않는다 (${bytes.byteLength}B)`)

  let text: string
  try {
    text = await (deps.extractPdfText ?? extractWithUnpdf)(bytes)
  } catch (error) {
    return unread('EXTRACT_FAILED', message(error))
  }

  const terms = parseProspectusText(text)
  if (terms == null) return unread('TABLE_NOT_FOUND', `텍스트 ${text.length}자에 월수익지급평가일 표 머리가 없다`)
  return { kind: 'READ', ...terms }
}

/** 기본 추출 — `unpdf`. 페이지를 이어 붙인다(표가 페이지 경계를 넘는다 — `prospectus-parse.ts` 각주) */
export async function extractWithUnpdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(bytes)
  try {
    const { text } = await extractText(pdf, { mergePages: true })
    return text
  } finally {
    // 문서를 놓는다 — PDF.js에서 해제는 적재 작업(`loadingTask`)의 몫이다. 요청마다 문서가 메모리에 남지 않게
    await pdf.loadingTask.destroy().catch(() => undefined)
  }
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((b, i) => bytes[i] === b)
}

/** 상한을 넘으면 읽기를 멈추고 `null`이다 */
async function readBytesCapped(response: Response, limit: number): Promise<Uint8Array | null> {
  if (response.body == null) return new Uint8Array(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const joined = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    joined.set(chunk, at)
    at += chunk.byteLength
  }
  return joined
}
