import Link from 'next/link'

import { Badge } from '@/components/display/Badge'
import type { ProductListItem } from '@/lib/db/queries/map'
import {
  ACCOUNT_TYPE_LABELS,
  CONDITION_RESULT_GRADES,
  CONDITION_RESULT_LABELS,
  KI_OBSERVATION_LABELS,
  KI_STATUS_GRADES,
  KI_STATUS_LABELS,
  STATUS_GRADES,
  STATUS_LABELS,
  amount,
  barrierGap,
  dDayLabel,
  deriveDisplay,
  kiTermLabel,
  lizardLabel,
  percent,
  priceDisplay,
  stepdownLabel,
  ymd,
  type DisplayState,
} from '@/lib/format'
import { PATHS } from '@/lib/routes/paths'

/**
 * 상품 한 줄 — SCR-201의 카드이자 데스크톱 표의 행
 *
 * ## 하나의 마크업이 카드와 행 둘 다 된다
 *
 * DOC-008 §8은 모바일 카드 1열 · 태블릿 카드 2열 · **데스크톱 테이블**을 요구한다.
 * 카드용 컴포넌트와 표용 컴포넌트를 따로 두면 같은 값을 두 곳에서 렌더하게 되고,
 * 한쪽에만 필드가 추가되는 날이 온다 — 그 결함은 특정 폭에서만 보인다.
 * 그래서 `<li>` 하나를 CSS 그리드로 두고 `lg:`에서 열 배치로 바꾼다.
 * SCR-302의 `PriceRow`가 같은 형태이며, 폭마다 다른 화면을 만들지 않는 것이
 * 이 프로젝트의 기존 판단이다.
 *
 * ## ★ 테두리는 **모든 폭에서** 유지된다 (v2.0, 실사용이 정했다)
 *
 * 종전에는 데스크톱에서 테두리를 지우고(`lg:border-0 lg:rounded-none`) 목록의
 * `divide-y`에 경계를 맡겼다. 한 줄 카드에서는 성립했으나 **계약 조건 줄이 붙으며
 * 깨졌다** — 한 상품 **안**의 구분선과 상품 **사이**의 구분선이 둘 다 얇은 수평선이
 * 되어 「이 기초자산이 위 상품인가 아래 상품인가」를 보면서 헷갈리게 됐다.
 *
 * **선을 굵게 하는 것으로 고치지 않았다.** 굵기를 다르게 두면 「어느 쪽이 더
 * 굵은가」를 매번 비교해야 하고 그 비교는 두 선을 동시에 볼 때만 성립한다. 경계는
 * 비교가 아니라 **둘러싸기**로 표현한다 — 테두리 + 카드 사이의 여백이면 어느 값이
 * 어느 상품에 속하는지가 **선의 해석 없이** 결정된다. 목록 쪽의 `divide-y`도 함께
 * 여백으로 바뀌었다(`products/page.tsx`).
 *
 * `lg:items-center` → `lg:items-start`인 것도 그 결과다. 카드가 두 줄이므로 열을
 * 수직 중앙에 두면 첫 줄의 값들이 계약 조건 줄 쪽으로 밀려 내려가 머리글과 어긋난다.
 *
 * ## `deriveDisplay()`의 소비자 셋 중 하나다
 *
 * §4.2 우선순위(무결성 결함 > E-05 상환완료 > E-01 시세 없음)를 여기서 다시 정하지
 * 않는다. 세 상태는 화면에 **같은 모습으로 도달한다** — 결함 상품도 `보유중`이고
 * 워스트오브가 없다. 순서를 화면이 정하면 셋 중 하나가 뒤집는 날이 오고 그 화면만
 * 조용히 틀린다(ST-06이 막으려는 상태다).
 *
 * > 종전 머리글은 「**두 번째** 소비자」였고 SCR-202의 상세도 같은 커밋에서 자기를
 * > 「두 번째」로 적었다 — 서수를 쓰지 않는 이유다. 소비자의 정본 목록은
 * > `lib/format/derived.ts`의 머리글 표 하나다(P4.5 정정).
 *
 * ## `import type`이다
 *
 * `ProductListItem`을 값으로 가져오면 `map.ts` → `lib/domain` 전체가 번들에 실린다.
 * 린트가 막는다(컷 0d 규칙 3). 이 컴포넌트는 서버에서만 렌더되지만 규칙은 위치로
 * 걸리며, 그것이 규칙의 의도다 — 나중에 `'use client'`가 붙어도 경계가 유지된다.
 */

export function ProductRow({ item }: { item: ProductListItem }) {
  const display = deriveDisplay(item)
  const next = item.nextEvaluation

  return (
    <li className="grid gap-2 rounded-lg border border-neutral-200 p-4 md:gap-3 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,1.5fr)] lg:items-start">
      {/* ① 상품 — 이름이 SCR-202로 가는 링크다 */}
      <div className="min-w-0">
        <Link
          href={PATHS.product(item.id)}
          className="block truncate font-medium hover:underline"
        >
          {item.name}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
          <span className="truncate">{item.ownerName}</span>
          {/*
            상환완료만 뱃지를 붙인다. 「보유중」은 목록의 기본값이므로 전 행에
            중립 뱃지를 달면 그 색이 아무것도 구분하지 않는다 — ST-05가 요구하는
            것은 **차이**의 시각화다.
          */}
          {item.status === 'REDEEMED' && (
            <Badge grade={STATUS_GRADES.REDEEMED}>{STATUS_LABELS.REDEEMED}</Badge>
          )}
          {item.accountType === 'TAX_FREE' && (
            <Badge grade="neutral">{ACCOUNT_TYPE_LABELS.TAX_FREE}</Badge>
          )}
        </p>
      </div>

      {/* ② 투자원금 */}
      <div className="flex items-baseline gap-2 lg:block lg:text-right">
        <span className="text-xs text-neutral-500 lg:hidden">투자원금</span>
        <span className="text-sm tabular-nums">{amount(item.principal)}</span>
        <span className="text-xs text-neutral-500 lg:ml-0.5">원</span>
      </div>

      {/* ③ 다음 평가일 */}
      <div className="flex items-baseline gap-2 lg:block">
        <span className="text-xs text-neutral-500 lg:hidden">다음 평가일</span>
        {next == null ? (
          /*
           * 상환 완료이거나 전 차수가 경과했다(E-07). 둘을 여기서 구분하지 않는
           * 이유는 ①의 상환완료 뱃지가 이미 그것을 말하기 때문이다 — 같은 사실을
           * 두 칸에 적으면 한쪽만 고쳐지는 날이 온다.
           */
          <span className="text-sm text-neutral-400">—</span>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm tabular-nums">{ymd(next.date)}</span>
            {/*
              D-Day는 음수가 과거다(§4.1). 표기의 뒤집음은 `dDayLabel` 하나에만
              있다 — 화면마다 하면 임박과 경과가 뒤바뀐다.
            */}
            <span
              className={`text-xs tabular-nums ${
                next.dDay < 0 ? 'text-red-700' : 'text-neutral-500'
              }`}
            >
              {dDayLabel(next.dDay)}
            </span>
            <span className="w-full text-xs text-neutral-500">
              {next.roundNo}차 · 배리어 {percent(next.barrier)}
            </span>
          </div>
        )}
      </div>

      {/* ④ 워스트오브 — 표시 상태가 이 칸의 내용을 정한다 */}
      <div className="flex items-baseline gap-2 lg:block">
        <span className="text-xs text-neutral-500 lg:hidden">워스트오브</span>
        {/* 판정은 한 번만 한다 — 칸마다 부르면 같은 우선순위가 두 번 계산된다 */}
        <WorstOfCell item={item} display={display} />
      </div>

      {/* ⑤ 판정 — 조건 충족 여부와 KI 상태 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <JudgmentCell item={item} />
      </div>

      {/* ⑧~⑫ 계약 조건 — 전 폭을 지나는 둘째 줄 */}
      <TermsLine item={item} />
    </li>
  )
}

/**
 * 계약 조건 한 줄 — DOC-008 §5 SCR-201 ⑧~⑫ (v1.9, P6 컷 2)
 *
 * ## 왜 열이 아니라 줄인가
 *
 * ①~⑦이 이미 데스크톱 5열이다. 다섯을 열로 더하면 **11열**이 되어 어느 폭에서도
 * 읽히지 않는다. 그래서 `lg:col-span-full`로 표 아래를 지나는 한 줄이 된다 —
 * 모바일에서는 위의 칸들과 함께 쌓이므로 차이가 없다(§8).
 *
 * ## 판정값과 섞지 않는다
 *
 * 이 줄에는 `worstOf`·`conditionResult`·`kiStatus`가 없다. 그 셋은 억제 규칙(D1)의
 * 대상이고 이것은 아니다 — **결함 상품도 계약 조건은 있고, 오히려 그때 화면이
 * 보여줄 것이 이것뿐이다.** 위 칸이 「시세 없음」인 상품에서도 이 줄은 온전하다.
 *
 * ## 문구를 여기서 만들지 않는다
 *
 * 스텝다운·리자드·KI 표기는 `lib/format/terms.ts`의 순수 함수가 낸다. 화면은 어떤
 * 스위트의 import 그래프에도 없으므로(AQ-23) 여기서 문자열을 조립하면 그 판단이
 * 영구 미검증이 된다.
 *
 * ## ★ 구분선이 아니라 배경이다 (v2.0)
 *
 * 종전에는 이 줄에 `border-t border-dashed`가 있었고 그것이 카드 사이의 구분선과
 * 같은 부류의 신호였다 — 어느 선이 상품의 경계인지 모호해진 원인의 절반이다.
 * **배경은 「이 블록은 위와 한 덩어리」를 말하고 선은 「여기서 갈린다」를 말한다.**
 * 카드 안쪽 여백을 음수 마진으로 되돌려 배경이 테두리까지 닿게 하므로, 이 블록이
 * 카드에 속한다는 것이 모양으로 드러난다.
 */
function TermsLine({ item }: { item: ProductListItem }) {
  const { terms } = item
  const stepdown = stepdownLabel(terms.barriers)
  const lizard = lizardLabel(terms.lizards)
  const nextRound = item.nextEvaluation?.roundNo ?? null

  return (
    <dl className="-mx-4 -mb-4 mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-b-lg bg-neutral-50 px-4 py-2.5 text-xs lg:col-span-full">
      {/* ⑧ 기초자산 · 기준가격 */}
      <div className="flex min-w-0 items-baseline gap-1.5">
        <dt className="shrink-0 text-neutral-500">기초자산</dt>
        <dd className="min-w-0">
          {terms.underlyings.length === 0 ? (
            /* I-07 결함. 위 칸의 무결성 표식이 이유를 말하므로 여기서는 사실만 */
            <span className="text-neutral-400">없음</span>
          ) : (
            <span className="flex flex-wrap gap-x-2">
              {terms.underlyings.map((u) => (
                <span key={u.assetName} className="tabular-nums">
                  <span className="text-neutral-700">{u.assetName}</span>{' '}
                  {priceDisplay(u.basePrice)}
                </span>
              ))}
            </span>
          )}
        </dd>
      </div>

      {/* ⑨ 연쿠폰율 */}
      <div className="flex items-baseline gap-1.5">
        <dt className="shrink-0 text-neutral-500">연쿠폰</dt>
        <dd className="tabular-nums">{percent(terms.annualCouponRate)}</dd>
      </div>

      {/* ⑩ KI 배리어 · 관찰방식 — `null`이 노낙인이다(I-11의 짝) */}
      <div className="flex items-baseline gap-1.5">
        <dt className="shrink-0 text-neutral-500">KI</dt>
        <dd className="tabular-nums">
          {kiTermLabel(
            terms.kiBarrier,
            terms.kiObservation == null
              ? null
              : KI_OBSERVATION_LABELS[terms.kiObservation],
          )}
        </dd>
      </div>

      {/* ⑪ 조기상환 배리어(스텝다운) — 다음 차수를 강조한다 */}
      {stepdown != null && (
        <div className="flex min-w-0 items-baseline gap-1.5">
          <dt className="shrink-0 text-neutral-500">스텝다운</dt>
          <dd className="min-w-0 break-all tabular-nums">
            <StepdownCells barriers={terms.barriers} nextRound={nextRound} />
          </dd>
        </div>
      )}

      {/* ⑫ 리자드 — 붙은 차수만. 없으면 칸 자체를 그리지 않는다 */}
      {lizard != null && (
        <div className="flex items-baseline gap-1.5">
          <dt className="shrink-0 text-neutral-500">리자드</dt>
          <dd className="tabular-nums">{lizard}</dd>
        </div>
      )}
    </dl>
  )
}

/**
 * 스텝다운 수열 — **다음 차수의 배리어를 강조한다.**
 *
 * ④가 이미 그 차수를 말하고 있으므로 둘이 같은 것을 가리키고, 사용자는 「지금 어느
 * 칸을 보아야 하는가」를 세지 않아도 된다. 강조가 없으면 6개 숫자 중 어느 것이
 * 지금 걸린 조건인지 알 수 없다.
 *
 * 문자열 하나(`stepdownLabel`)로 렌더하지 않는 이유가 그 강조다. 두 경로가 갈리지
 * 않도록 **같은 함수로 토큰을 만든다** — `stepdownLabel`이 그 함수의 조립 결과이고
 * 여기서는 토큰마다 요소를 두므로, 표기 규칙이 바뀌면 둘이 함께 바뀐다.
 */
function StepdownCells({
  barriers,
  nextRound,
}: {
  barriers: readonly string[]
  /** 1-기반 차수. `null`이면 강조하지 않는다(상환 완료·전 차수 경과) */
  nextRound: number | null
}) {
  return (
    <>
      {barriers.map((barrier, index) => {
        const current = nextRound != null && index + 1 === nextRound
        return (
          <span key={index}>
            {index > 0 && <span className="text-neutral-300">-</span>}
            <span
              className={
                current ? 'font-semibold text-neutral-900' : 'text-neutral-600'
              }
            >
              {percent(barrier).replace('%', '')}
            </span>
          </span>
        )
      })}
      <span className="text-neutral-500">%</span>
    </>
  )
}

/**
 * §4.2 우선순위표의 표시 — 네 갈래가 **서로 다른 문구**여야 한다.
 *
 * `INTEGRITY`와 `PRICE_MISSING`을 같은 말로 적으면 사용자가 영원히 오지 않을 시세를
 * 기다린다(ST-06). 그래서 결함은 다음 행동이 **수정**이고 시세 없음은 **시세 관리**다.
 */
function WorstOfCell({
  item,
  display,
}: {
  item: ProductListItem
  display: DisplayState
}) {
  if (display.kind === 'INTEGRITY') {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge grade={display.grade}>{display.label}</Badge>
        {/*
          ST-06은 「수정 화면으로 유도한다」고 요구한다. `/products/[id]/edit`은
          컷 5에 서므로(`tests/app/invalidation.test.ts`의 `NOT_YET_BUILT`가 그
          원장이다) 지금은 상세로 보낸다 — 수정 액션이 붙는 화면이 거기고, 이름
          링크와 목적지가 같아도 **여기에 다음 행동이 있다는 사실**은 유지된다.
        */}
        <Link
          href={PATHS.product(item.id)}
          className="text-xs text-neutral-600 underline"
        >
          고치기
        </Link>
      </span>
    )
  }

  if (display.kind === 'PRICE_MISSING') {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm text-neutral-500">{display.label}</span>
        {/* §7.3 — 「SCR-201 시세 없음 표시 → SCR-302 시세 관리」 */}
        <Link href={PATHS.prices} className="text-xs text-neutral-600 underline">
          시세 입력
        </Link>
      </span>
    )
  }

  /*
   * 상환 완료 상품도 워스트오브를 표시한다 — §4.2 v0.8이 「`worstOf`·`ratio`·
   * `isWorst`는 두 축 어디에도 막히지 않는다」고 확인했다. `deriveDisplay`가
   * `REDEEMED`에 그 값을 담지 않는 이유는 없기 때문이 아니라 **판정값**이 없기
   * 때문이며, 필요한 화면은 `item.worstOf`를 그대로 읽는다(그 함수의 각주).
   */
  const worstOf = display.kind === 'VALUED' ? display.worstOf : item.worstOf
  if (worstOf == null) return <span className="text-sm text-neutral-400">—</span>

  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-sm font-medium tabular-nums">{percent(worstOf)}</span>
      {/*
        배리어까지의 거리. **적용 차수의 배리어에만** 의미가 있으므로 다음 평가일이
        없으면(상환 완료·전 차수 경과) 붙이지 않는다 — 없는 차수의 배리어와 비교한
        값은 그 차수가 도래했을 때의 결과인 척하는 값이 된다(§4.3의 같은 논거).
      */}
      {item.nextEvaluation != null && (
        <span className="text-xs tabular-nums text-neutral-500">
          배리어 {barrierGap(worstOf, item.nextEvaluation.barrier)}
        </span>
      )}
    </span>
  )
}

function JudgmentCell({ item }: { item: ProductListItem }) {
  /*
   * 두 값은 함께 죽는다(§4.2의 두 축) — 그래서 한 칸이다. 나눠 두면 「판정 없음」이
   * 두 칸에 각각 「—」로 나와 무엇이 왜 없는지가 두 번 물어진다.
   */
  if (item.conditionResult == null && item.kiStatus == null) {
    return <span className="text-sm text-neutral-400">—</span>
  }

  return (
    <>
      {item.conditionResult != null && (
        /*
         * **추정값이다.** 같은 라벨이 `redemptionType`(확정)에도 있으므로
         * (`EARLY`·`LIZARD`) ST-05가 시각적 구분을 요구한다 — 등급은
         * `CONDITION_RESULT_GRADES`가 따로 정의하고, 여기에 「예상」을 덧붙여
         * 문자로도 구분한다.
         */
        <Badge grade={CONDITION_RESULT_GRADES[item.conditionResult]}>
          예상 {CONDITION_RESULT_LABELS[item.conditionResult]}
        </Badge>
      )}
      {item.kiStatus != null && (
        <Badge grade={KI_STATUS_GRADES[item.kiStatus]}>
          {KI_STATUS_LABELS[item.kiStatus]}
        </Badge>
      )}
    </>
  )
}
