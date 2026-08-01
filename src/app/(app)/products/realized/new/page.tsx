import type { Metadata } from 'next'
import Link from 'next/link'

import { RealizedProductForm } from '@/components/products/RealizedProductForm'
import { realizedDefaults } from '@/lib/forms/realized'
import { PATHS } from '@/lib/routes/paths'

import { realizedFormAction } from '../actions'

/**
 * SCR-205 기실현 등재 — 이미 상환이 끝난 ELS를 과거 이력으로 (DOC-008 §5)
 *
 * ## 조회를 하나도 하지 않는다
 *
 * `ROUTE_QUERIES`에 이 라우트가 `[]`로 적히는 이유다(`/settings`와 같은 자리).
 * SCR-204는 `searchAssets`를 읽지만 이 화면은 기초자산을 입력받지 않으므로 읽을
 * 것이 없다 — **어느 변경도 이 화면을 낡게 하지 않는다.**
 *
 * ## 소유자 검사가 없다
 *
 * 만들어지는 상품의 소유자를 쓰기 함수가 `auth.uid()`로 박으므로(§5.11) 남의
 * 소유로 만들 경로가 없다. SCR-204의 등록 쪽과 같고, 그래서 소유자 전용 라우트
 * 셋(수정·상환 처리)에 이 화면이 더해지지 않는다.
 *
 * ## 상환 처리(SCR-203)를 지나지 않는다
 *
 * 저장 한 번이 상품과 상환을 함께 만든다(§7.1의 기실현 전이). §7.2의 두 단계를
 * 한 번으로 접는 것이 이 화면의 존재 이유이며, 그 접힘은 계약 쪽에서 **한
 * 트랜잭션**으로 성립한다 — 두 요청으로 나누면 부분 실패가 계약 조건도 상환도
 * 없는 상품을 남긴다.
 */

export const metadata: Metadata = {
  title: '기실현 등재 · 언제들어오나',
}

export default function RealizedProductNewPage() {
  return (
    <section className="flex flex-col gap-5">
      <header>
        <Link href={PATHS.products} className="text-sm text-neutral-600 underline">
          ← 목록
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">기실현 등재</h1>
        <p className="mt-1 text-sm text-neutral-600">
          이미 상환이 끝난 ELS를 과거 이력으로 등재한다. 증권사 거래내역의 한 줄을
          그대로 옮긴다.
        </p>
      </header>

      {/*
        입력받지 않는 것을 화면이 먼저 말한다 — 사용자가 「빠진 칸」을 찾지 않게
        하는 것이 목적이다. 뒤에 붙는 문장이 그 대가를 적는다: 조건 판정이 없다.
      */}
      <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
        <p>
          <strong>계약 조건은 입력받지 않는다</strong> — 발행일 · 연쿠폰율 ·
          기초자산 · 기준가 · 배리어 · KI 조건. 거래내역에 없는 값이므로 지어내지
          않는다.
        </p>
        <p>
          그래서 이 상품에는 <strong>조건 판정과 평가일정이 없다.</strong> 세금
          계산·다년도 전망에는 아래 상환 실적이 귀속연도에 따라 그대로 반영된다.
        </p>
        <p className="text-neutral-500">
          아직 보유 중인 상품은 여기가 아니라{' '}
          <Link href={PATHS.productNew} className="underline">
            ELS 등록
          </Link>
          으로 넣는다 — 조건 판정을 받으려면 계약 조건이 필요하다.
        </p>
      </div>

      <RealizedProductForm
        action={realizedFormAction}
        initialValues={realizedDefaults()}
      />
    </section>
  )
}
