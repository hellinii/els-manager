'use client'

import type { AssetOption } from '@/lib/db/queries/prices'
import { ACCOUNT_TYPE_LABELS, KI_OBSERVATION_LABELS, korDate, won } from '@/lib/format'
import { path } from '@/lib/forms/fieldPath'
import { previewDatesOf } from '@/lib/forms/schedules'
import type { FormState } from '@/lib/forms/state'
import { roundCountOf, rowCountOf } from '@/lib/forms/steps'

/**
 * ④ 확인 — **생성될 평가일정 미리보기 후 저장** (SCR-204, DOC-008 §5)
 *
 * ## 입력이 없다
 *
 * 전 단계의 값은 전부 히든으로 실려 있고(`carryNames(counts, 'CONFIRM')`이 폼의
 * 모든 이름을 준다) 이 화면은 그것을 **읽어서 보여줄 뿐**이다. 여기에 입력을 두면
 * 같은 값에 칸이 둘 생기고 어느 쪽이 제출되는지가 렌더 순서에 달린다.
 *
 * ## 저장되는 값과 보여주는 값이 같은 함수에서 나온다
 *
 * 평가일은 `previewDatesOf`, 금액은 쉼표를 지운 뒤 `won()`. 파서가 쓰는 것과 같은
 * 해석이므로 「확인 화면에서 본 것과 다른 것이 저장된다」가 구조적으로 불가능하다 —
 * 이 화면의 존재 이유가 그 성질이다.
 *
 * ## 값이 비어 있어도 렌더된다
 *
 * 검증은 계약이 한다(§6). 여기서 「필수인데 비었다」를 판정하면 규칙이 두 곳에
 * 생기고, 두 곳이 갈리면 저장 버튼이 눌리지 않는 이유를 화면이 설명하지 못한다.
 * 비면 `—`로 보이고 저장은 계약의 오류로 되돌아온다(그 단계로 이동한다).
 */

const EMPTY = '—'

export function ConfirmStep({
  state,
  assets,
}: {
  state: FormState
  assets: readonly AssetOption[]
}) {
  const { values } = state
  const rounds = roundCountOf(values)
  const dates = previewDatesOf(values)
  const rows = rowCountOf(values, 'underlyings')

  const accountType = values.accountType ?? ''
  const observation = values.kiObservation ?? ''

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">기본 정보</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Row label="상품명" value={values.name} />
          <Row label="발행사" value={values.issuer} />
          <Row label="발행일" value={isoOrEmpty(values.issueDate)} />
          <Row label="투자원금" value={wonOrEmpty(values.principal)} />
          <Row
            label="계좌유형"
            value={labelOf(ACCOUNT_TYPE_LABELS, accountType)}
          />
          <Row label="비고" value={values.note} />
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">기초자산</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {Array.from({ length: rows }, (_, index) => {
            const id = values[path('underlyings', index, 'assetId')] ?? ''
            const basePrice = values[path('underlyings', index, 'basePrice')] ?? ''
            const asset = assets.find((candidate) => candidate.id === id) ?? null
            return (
              <li key={index} className="flex justify-between gap-3">
                {/* 이름을 보여준다 — uuid는 사용자가 확인할 수 있는 값이 아니다 */}
                <span>{asset?.name ?? (id === '' ? '자산 미선택' : id)}</span>
                <span className="text-neutral-600">
                  {basePrice === '' ? EMPTY : `기준가 ${basePrice}`}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">평가 조건</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Row label="평가주기" value={monthsOrEmpty(values.evaluationPeriodMonths)} />
          <Row label="총 차수" value={roundsOrEmpty(values.totalRounds)} />
          <Row label="연쿠폰율" value={percentOrEmpty(values.annualCouponRate)} />
          <Row label="KI 배리어" value={percentOrEmpty(values.kiBarrier, '노낙인')} />
          <Row
            label="관찰방식"
            value={
              observation === ''
                ? '노낙인'
                : labelOf(KI_OBSERVATION_LABELS, observation)
            }
          />
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">생성될 평가일정</h2>
        {rounds === 0 ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            총 차수가 없어 평가일정이 비었다. ③으로 돌아가 입력한다.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-neutral-200">
            <div className="grid grid-cols-[minmax(0,0.6fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1.6fr)] gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-500">
              <span>차수</span>
              <span>평가일</span>
              <span>배리어</span>
              <span>리자드</span>
            </div>
            <ul className="divide-y divide-neutral-200 text-sm">
              {Array.from({ length: rounds }, (_, index) => {
                const barrier = values[path('schedules', index, 'barrier')] ?? ''
                const lizardBarrier =
                  values[path('schedules', index, 'lizardBarrier')] ?? ''
                const lizardRate =
                  values[path('schedules', index, 'lizardCouponRate')] ?? ''
                const noKi = (values[path('schedules', index, 'lizardRequiresNoKi')] ?? '') !== ''

                return (
                  <li
                    key={index}
                    className="grid grid-cols-[minmax(0,0.6fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1.6fr)] gap-3 px-4 py-2"
                  >
                    <span>{`${index + 1}차`}</span>
                    <span>{dates[index] == null ? EMPTY : korDate(dates[index]!)}</span>
                    <span>{percentOrEmpty(barrier)}</span>
                    <span className="text-neutral-600">
                      {lizardBarrier === ''
                        ? '없음'
                        : `${percentOrEmpty(lizardBarrier)} · 쿠폰 ${percentOrEmpty(
                            lizardRate,
                          )}${noKi ? ' · KI 미터치 요구' : ''}`}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="flex justify-between gap-3 border-b border-neutral-100 py-1">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-right">{value == null || value === '' ? EMPTY : value}</dd>
    </div>
  )
}

function labelOf(labels: Record<string, string>, value: string): string {
  // 인식하지 못한 값은 원문을 보여준다 — 조작된 값을 숨기면 계약이 왜 거부하는지
  // 화면에서 알 수 없다.
  return value === '' ? EMPTY : (labels[value] ?? value)
}

/** 금액은 쉼표를 지운 뒤 표시한다 — 파서와 같은 해석이다 */
function wonOrEmpty(raw: string | undefined): string {
  const digits = (raw ?? '').replace(/[,\s]/g, '')
  if (digits === '' || !/^\d+$/.test(digits)) return digits === '' ? EMPTY : digits
  return won(digits)
}

function percentOrEmpty(raw: string | undefined, empty = EMPTY): string {
  const value = (raw ?? '').trim()
  return value === '' ? empty : `${value}%`
}

function monthsOrEmpty(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  return value === '' ? EMPTY : `${value}개월`
}

function roundsOrEmpty(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  return value === '' ? EMPTY : `${value}차`
}

/** 형식이 아니면 원문을 보여준다 — `korDate`는 던진다 */
function isoOrEmpty(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value === '' ? EMPTY : value
  return korDate(value)
}
