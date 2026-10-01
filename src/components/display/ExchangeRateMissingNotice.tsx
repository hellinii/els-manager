import Link from 'next/link'

import {
  EXCHANGE_RATE_INPUT_LINK_LABEL,
  EXCHANGE_RATE_MISSING_JOINER,
  exchangeRateMissingLead,
  type ExchangeRateMissing,
} from '@/lib/format'
import { EXCHANGE_RATE_SECTION } from '@/lib/routes/paths'

/**
 * ST-07 「환율 없음」 — 앞절 — **뒷절은 SCR-302 환율 절로 가는 링크** (DOC-008 §6 ST-07 · 컷 a3-3)
 *
 * 문구의 정본은 `lib/format/exchangeRate.ts`(앞절 · 뒷절 글자)이고, 여기는 뒷절에 주소를 붙인다. 주소는
 * `EXCHANGE_RATE_SECTION.href` — 쿼리(`rate=open`)가 절을 열고 조각이 그 자리로 스크롤한다(SQ-20 결정).
 * 조각만이면 JS 없이 `<details>`가 열리지 않아 상환된 달러 상품만 있는 사용자(미상환 0건 — 절이 접혀 온다)가
 * 링크를 눌러도 입력 칸을 보지 못한다.
 *
 * 서버 컴포넌트다(상태가 없다). 감싸는 `<p>`·색은 부르는 화면이 정한다 — 네 화면의 자리가 서로 다르다.
 */
export function ExchangeRateMissingNotice({ missing }: { missing: ExchangeRateMissing }) {
  return (
    <>
      {exchangeRateMissingLead(missing)}
      {EXCHANGE_RATE_MISSING_JOINER}
      <Link href={EXCHANGE_RATE_SECTION.href} className="font-medium underline underline-offset-2">
        {EXCHANGE_RATE_INPUT_LINK_LABEL}
      </Link>
    </>
  )
}
