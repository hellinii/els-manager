import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/display/Badge'
import { DeleteProductForm } from '@/components/products/DeleteProductForm'
import { KiTouchForm } from '@/components/products/KiTouchForm'
import { RedemptionActions } from '@/components/products/RedemptionActions'
import { ScheduleTable } from '@/components/products/ScheduleTable'
import { UnderlyingTable } from '@/components/products/UnderlyingTable'
import { OwnerOnly } from '@/components/state/OwnerOnly'
import type { ProductDetailView } from '@/lib/db/queries/map'
import { redemptionValuesOf, roundOptionsOf } from '@/lib/forms/redemption'
import { getQueries } from '@/lib/db/server'
import {
  ACCOUNT_TYPE_LABELS,
  KI_OBSERVATION_LABELS,
  KI_STATUS_GRADES,
  KI_STATUS_LABELS,
  REDEMPTION_TYPE_LABELS,
  STATUS_GRADES,
  STATUS_LABELS,
  amount,
  barrierGap,
  deriveDisplay,
  korDate,
  percent,
  signedWon,
  won,
  ymd,
} from '@/lib/format'
import { isUuid } from '@/lib/forms/query'
import { PATHS } from '@/lib/routes/paths'

/**
 * SCR-202 ELS 상세 — 읽기 + **소유자 액션 다섯** (P4 컷 3·5·6, DOC-008 §5·DOC-011 §4.3)
 *
 * ## 액션은 그 액션을 만드는 컷에 붙었다
 *
 * DOC-008은 `수정`·`상환 처리`·`삭제`를 이 화면에 둔다. 컷 3은 셋 다 없었고, 컷 5가
 * `수정`·`삭제`를, 컷 6이 `상환 처리`(링크) + `상환 수정`·`상환 취소`·`KI 터치 확정`을
 * 붙였다. 없는 라우트로 가는 링크를 미리 두지 않는 규율이 그 순서를 정했다 — 404는
 * 사용자에게 「아직 없다」가 아니라 「주소가 틀렸다」로 읽힌다.
 *
 * **`OwnerOnly`의 첫 소비자가 여기다**(ST-04). 비활성화가 아니라 숨김이며, 그
 * 컴포넌트에는 `disabled`가 없다 — 선택지를 없앤 것이 방어다.
 *
 * `수정`·`상환 처리`는 링크이고 나머지는 폼이다. 상태를 바꾸는 것은 GET일 수 없다 —
 * 링크로 두면 프리페치·크롤러가 상품을 지운다.
 *
 * ## 조건부 노출 셋이 ST-04와 다른 이유
 *
 * | 무엇 | 언제 없는가 | 왜 |
 * |---|---|---|
 * | `상환 처리` | 이미 상환됨 | I-01. 링크가 있어도 SCR-203이 「이미 상환되었다」만 보여 준다 |
 * | 상환 수정·취소 | 미상환 | 대상 레코드가 없다 |
 * | KI 터치 확정 | 노낙인 | V-18이 그 설정을 거부한다(I-15) — 누를 수 있는데 항상 실패하는 칸을 두지 않는다 |
 *
 * 셋 다 「권한」이 아니라 **상태**의 문제이므로 `OwnerOnly` 안쪽에서 한 겹 더 가른다.
 *
 * ## 미존재는 `notFound()`다 — 계약은 `null`을 준다
 *
 * 조회 계약은 미존재에 `null`을 반환한다(§3.1 코딩 규약). 변환은 **화면의 일**이며
 * DOC-008 §6이 이 화면의 에러를 「미존재 → SCR-901」로 규정한다.
 *
 * **조회를 `try/catch`로 감싸지 않는다.** `notFound()`는
 * `NEXT_HTTP_ERROR_FALLBACK;404`를 던지므로 삼키면 빈 성공 페이지가 렌더된다.
 *
 * ## id 형식을 먼저 본다 — 그러지 않으면 오타가 500이 된다
 *
 * `getProduct('abc')`는 `null`이 아니라 **예외**다. PostgREST가 `uuid` 열에 대한
 * 비-UUID 비교를 `22P02`로 거부하고 조회 계층이 그것을 던지기 때문이다(실측).
 * 그러면 주소를 손으로 고쳐 들어온 사용자가 404 대신 일반 오류 화면을 본다 —
 * §6이 정한 「미존재 → SCR-901」과 다르고, 오류 표면이 넓어지면 진짜 결함의 신호가
 * 묻힌다. 형식 검사는 계약의 일이 아니다(계약의 입력 계약은 `string`이고 그
 * 문자열이 라우트 파라미터라는 사실을 모른다).
 */

const DETAIL_TITLE = 'ELS 상세 · 언제들어오나'

export const metadata: Metadata = { title: DETAIL_TITLE }

export default async function ProductDetailPage({
  params,
}: {
  // Next 16의 params는 Promise다.
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const queries = await getQueries()
  const view = await queries.getProduct(id)
  if (view == null) notFound()

  const { product, projection, redemption } = view
  const display = deriveDisplay(product)

  return (
    <article className="flex flex-col gap-6">
      {/* ── 머리글 ─────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-2">
        <Link href={PATHS.products} className="text-sm text-neutral-600 underline">
          ← 목록
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{product.name}</h1>
          <Badge grade={STATUS_GRADES[product.status]}>
            {STATUS_LABELS[product.status]}
          </Badge>
          {product.kiStatus != null && (
            <Badge grade={KI_STATUS_GRADES[product.kiStatus]}>
              {KI_STATUS_LABELS[product.kiStatus]}
            </Badge>
          )}
        </div>

        <p className="text-sm text-neutral-600">
          {product.issuer ?? '발행사 미입력'} · {product.ownerName}
          {!product.isOwner && (
            /*
             * 모든 SELECT 정책이 `using (true)`이므로 타인의 상품도 **읽는다**
             * (DOC-010 §7). 그것이 설계이므로 숨기지 않고 사실을 적는다 —
             * 액션이 왜 없는지가 여기서 설명된다(ST-04는 숨기라고만 했고
             * 이유를 감추라고 하지 않았다).
             */
            <> · 타인의 상품이다</>
          )}
        </p>

        <Summary display={display} product={product} />

        {/*
          ST-04 — 비소유자에게는 **아무것도 렌더되지 않는다.** 비활성화가 아니다:
          비활성화는 타인 데이터에 대한 조작 가능성을 암시한다. 위 머리글이 「타인의
          상품이다」를 적는 것이 그 부재의 설명이다.
        */}
        <OwnerOnly isOwner={product.isOwner}>
          <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3">
            <div className="flex flex-wrap gap-2">
              <Link
                href={PATHS.productEdit(product.id)}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100"
              >
                수정
              </Link>

              {/*
                상환 처리는 **미상환 상품에만** 있다(I-01). 상환된 상품에서 이 링크를
                두면 SCR-203이 「이미 상환 처리되었다」만 보여 주는 화면이 되고, 그
                조작의 다음 행동은 이 화면의 수정·취소다 — 왕복이 늘 뿐이다.
              */}
              {redemption == null && (
                <Link
                  href={PATHS.productRedeem(product.id)}
                  className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700"
                >
                  상환 처리
                </Link>
              )}
            </div>

            <DeleteProductForm productId={product.id} productName={product.name} />
          </div>
        </OwnerOnly>
      </header>

      {/*
        기실현 등재는 **계약 조건 절을 그리지 않는다** (DOC-008 SCR-205).

        발행일·평가주기·총 차수·연쿠폰율을 「—」·「0차」로 채우면 그 화면은
        「입력이 빠졌다」로 읽히고 사용자가 수정을 시도한다 — 그런데 저장은
        `CONFLICT`로 막혀 있다(상환 완료). 그러므로 **없는 칸을 보여주는 대신
        없는 이유를 적는다.** `integrityIssue`의 「수정 필요」와 다른 말이어야
        하는 것이 요점이다(DOC-005 §6 「기실현 등재」).
      */}
      {product.entryMode === 'REALIZED_ONLY' && (
        <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
          <strong>기실현 등재</strong> — 이미 상환이 끝난 상품을 과거 이력으로
          등재했다. 계약 조건(발행일·연쿠폰율·기초자산·배리어)은 입력받지 않았으므로
          조건 판정·평가일정이 없다. 세금 집계에는 아래 상환 실적이 그대로 반영된다.
        </p>
      )}

      {/* ── ① 기본 정보 ────────────────────────────────────────────────── */}
      <Section title="기본 정보">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="투자원금">{won(product.principal)}</Fact>
          <Fact label="계좌유형">{ACCOUNT_TYPE_LABELS[product.accountType]}</Fact>
          {product.entryMode === 'FULL' && (
            <>
              {/* I-18이 두 값의 존재를 `FULL`에서 보장한다 — 그래서 `??`가 없다 */}
              <Fact label="발행일">{korDate(product.issueDate ?? '')}</Fact>
              <Fact label="평가주기">{product.evaluationPeriodMonths}개월</Fact>
              {/* 정본은 행 수다. `max(round_no)`가 아니다(DOC-002 §4.6) */}
              <Fact label="총 차수">{product.totalRounds}차</Fact>
              <Fact label="연쿠폰율">{percent(product.annualCouponRate ?? '')}</Fact>
            </>
          )}
        </dl>
        {product.note != null && (
          <p className="mt-3 whitespace-pre-line rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
            {product.note}
          </p>
        )}
      </Section>

      {/* ── ② 기초자산 ─────────────────────────────────────────────────── */}
      <Section title="기초자산">
        <UnderlyingTable underlyings={view.underlyings} />
      </Section>

      {/* ── ④ KI 상태 ──────────────────────────────────────────────────── */}
      <Section title="KI 상태">
        <KiFacts product={product} />

        {/*
          §5.9의 조치. 노낙인 상품에는 두지 않는다 — V-18이 그 설정을 거부하므로
          (I-15) 폼을 두면 누를 수 있는데 저장이 항상 실패하는 칸이 된다.
          비활성화가 아니라 부재인 이유는 ST-04와 같다.
        */}
        {product.kiBarrier != null && (
          <OwnerOnly isOwner={product.isOwner}>
            <div className="rounded-lg border border-neutral-200 p-3">
              <KiTouchForm productId={product.id} touchedAt={product.kiTouchedAt} />
            </div>
          </OwnerOnly>
        )}
      </Section>

      {/* ── ③ 차수별 조건 ──────────────────────────────────────────────── */}
      <Section title="차수별 평가 조건">
        <ScheduleTable schedules={view.schedules} />
      </Section>

      {/* ── ⑤ 예상 수령액·과세소득 ─────────────────────────────────────── */}
      <Section title="예상 수령액 · 과세소득">
        <Projection projection={projection} product={product} />
      </Section>

      {/* ── ⑥ 상환 실적 ────────────────────────────────────────────────── */}
      {redemption != null && (
        <Section title="상환 실적">
          <Redemption redemption={redemption} />

          {/*
            §5.5의 두 계약. 상환 실적 **옆에** 있는 이유는 두 조작의 대상이 지금 보고
            있는 그 값이기 때문이다 — 별 라우트로 두면 §4에 없는 화면이 둘 생긴다.
          */}
          <OwnerOnly isOwner={product.isOwner}>
            <RedemptionActions
              redemption={redemption}
              rounds={roundOptionsOf(view)}
              initialValues={redemptionValuesOf(redemption)}
            />
          </OwnerOnly>
        </Section>
      )}
    </article>
  )
}

/**
 * 상단 요약 — **`deriveDisplay()`의 소비자 셋 중 하나다**
 *
 * §4.2 우선순위(무결성 결함 > E-05 > E-01)를 여기서 다시 정하지 않는다. 목록과
 * 같은 함수에 **같은 세 필드**를 넘기므로(v1.4가 뷰에 담았다) 두 화면의 판정이
 * 갈릴 수 없고, 그 동일성은 `tests/db/map.test.ts`가 대조한다.
 *
 * > 종전 머리글은 「두 번째 소비자」였고 `ProductRow`도 **같은 커밋에서** 자기를
 * > 「두 번째」로 적었다. 정본 목록은 `lib/format/derived.ts`의 표다(P4.5 정정).
 */
function Summary({
  display,
  product,
}: {
  display: ReturnType<typeof deriveDisplay>
  product: ProductDetailView['product']
}) {
  if (display.kind === 'INTEGRITY') {
    return (
      <p className="flex flex-wrap items-center gap-2 rounded-md bg-neutral-800 px-3 py-2 text-sm text-white">
        <span className="font-medium">{display.label}</span>
        <span className="text-neutral-300">
          계약을 경유하는 조작으로는 만들 수 없는 상태다(I-07). 아래 표에서 0건인
          쪽을 고친다.
        </span>
      </p>
    )
  }

  if (display.kind === 'PRICE_MISSING') {
    return (
      <p className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <span className="font-medium">{display.label}</span>
        <span>
          기초자산 중 하나라도 시세가 없으면 워스트오브를 산출하지 않는다(E-01).
        </span>
        <Link href={PATHS.prices} className="font-medium underline">
          시세 관리
        </Link>
      </p>
    )
  }

  /*
   * `REDEEMED`와 `VALUED` 둘 다 워스트오브를 표시한다 — §4.2 v0.8이 「두 축
   * 어디에도 막히지 않는다」고 확인했고, 상환 완료 상품도 그 값을 갖는다.
   */
  if (product.worstOf == null) return null

  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <span className="text-neutral-600">워스트오브</span>
      <span className="text-base font-semibold tabular-nums">
        {percent(product.worstOf)}
      </span>
      {product.kiBarrier != null && (
        <span className="text-xs tabular-nums text-neutral-500">
          KI 배리어({percent(product.kiBarrier)}) 대비{' '}
          {barrierGap(product.worstOf, product.kiBarrier)}
        </span>
      )}
    </p>
  )
}

/**
 * ④ KI 상태 — **등급은 계약이 준다**(v1.4). 화면이 배리어와 시세를 비교하지 않는다.
 *
 * 비교를 여기서 하면 「주의」 임계 배수(DOC-007 §3.4)가 표시 계층으로 새고,
 * 그 값은 `lib/domain`의 상수다. 등급 판정의 사본이 둘이 되는 순간 어느 쪽이
 * 정본인지 알 수 없다.
 *
 * **터치 확정일은 시스템이 정하지 않는다**(D-04). 일 배치 종가 수집으로는
 * `CONTINUOUS` 관찰의 장중 터치를 확인할 수 없으므로 확정은 사용자의 조치이며
 * 그 조치가 컷 6에 붙는다(§5.9 `setKiTouched`).
 */
function KiFacts({ product }: { product: ProductDetailView['product'] }) {
  if (product.kiBarrier == null) {
    return (
      <p className="text-sm text-neutral-700">
        노낙인 상품이다 — KI 배리어가 없으므로 KI 판정 대상이 아니다(E-06).
      </p>
    )
  }

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      <Fact label="KI 배리어">{percent(product.kiBarrier)}</Fact>
      <Fact label="관찰 방식">
        {product.kiObservation == null
          ? '—'
          : KI_OBSERVATION_LABELS[product.kiObservation]}
      </Fact>
      <Fact label="터치 확정일">
        {product.kiTouchedAt == null ? (
          <span className="text-neutral-500">미확정</span>
        ) : (
          korDate(product.kiTouchedAt)
        )}
      </Fact>
    </dl>
  )
}

/**
 * ⑤ 예상 수령액·과세소득 — `projection`은 **두 경우에 `null`**이다(§4.3).
 *
 * ① 상환 완료 ② 적용 차수가 없다(전 차수 경과 미상환 또는 평가일정 0건).
 * **무결성 결함 자체는 사유가 아니다** — 이 값은 계약 조건에서만 나오고 시세를
 * 하나도 쓰지 않으므로 `UNDERLYING_MISSING` 상품에서도 산출된다(v0.8의 정정).
 * 그래서 화면은 「왜 없는가」를 결함으로 설명하지 않고 **적용 차수의 부재**로
 * 설명한다 — 그러지 않으면 시세를 기다리게 된다.
 */
function Projection({
  projection,
  product,
}: {
  projection: ProductDetailView['projection']
  product: ProductDetailView['product']
}) {
  if (projection == null) {
    return (
      <p className="text-sm text-neutral-700">
        {product.status === 'REDEEMED'
          ? '상환이 완료되어 추정하지 않는다 — 아래 상환 실적이 확정값이다(E-05).'
          : '적용 차수가 없어 추정할 수 없다 — 전 차수가 경과했거나 평가일정이 0건이다(§9.2).'}
      </p>
    )
  }

  return (
    <>
      {/*
        ST-05 — **추정값이다.** 상환 실적과 같은 형태로 금액을 나열하므로, 문자로
        구분하지 않으면 두 절이 같은 확실성을 가진 것처럼 보인다.
      */}
      <p className="mb-3 text-sm text-neutral-600">
        {projection.appliedRoundNo}차 평가일에 조기상환된다고{' '}
        <em className="font-medium not-italic">가정한</em> 추정값이다. 사용자가
        지정하지 않으면 다음 도래 평가일의 차수를 쓴다.
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="적용 차수">{projection.appliedRoundNo}차</Fact>
        <Fact label="예상 세전 수령액">{won(projection.expectedGross)}</Fact>
        <Fact label="예상 과세 금융소득">
          {won(projection.expectedTaxableIncome)}
        </Fact>
        <Fact label="귀속연도">{projection.attributionYear}년</Fact>
      </dl>
    </>
  )
}

/** ⑥ 상환 실적 — **확정값이다.** `isConfirmed`가 그 안에서 한 단계 더 가른다(ST-05). */
function Redemption({
  redemption,
}: {
  redemption: NonNullable<ProductDetailView['redemption']>
}) {
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge grade="positive">
          {REDEMPTION_TYPE_LABELS[redemption.redemptionType]}
        </Badge>
        {redemption.roundNo != null && (
          <span className="text-sm text-neutral-600">{redemption.roundNo}차</span>
        )}
        {/*
          `is_confirmed`는 「증권사가 제공한 실제 값」이다(DOC-005 §6). 거짓이면
          입력된 금액이 사용자의 추정이므로 확정값과 같은 무게로 보이면 안 된다.
        */}
        <Badge grade={redemption.isConfirmed ? 'neutral' : 'caution'}>
          {redemption.isConfirmed ? '확정값' : '추정값 — 지급명세서 미확인'}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="상환일">{ymd(redemption.redemptionDate)}</Fact>
        <Fact label="실수령액">{won(redemption.grossAmount)}</Fact>
        {/* 음수가 정상값이다 — 만기손실 상환의 손익(DOC-005 §6 포트폴리오 손익) */}
        <Fact label="실현손익">{signedWon(redemption.realizedPnl)}</Fact>
        <Fact label="과세 금융소득">{won(redemption.taxableIncome)}</Fact>
        <Fact label="원천징수세액">
          {redemption.withholdingTax == null
            ? '—'
            : `${amount(redemption.withholdingTax)}원`}
        </Fact>
      </dl>

      {redemption.note != null && (
        <p className="mt-3 whitespace-pre-line rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
          {redemption.note}
        </p>
      )}
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
      {children}
    </section>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="mt-0.5 truncate text-sm tabular-nums">{children}</dd>
    </div>
  )
}
