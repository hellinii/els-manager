import type { Metadata } from 'next'

import { signOutAction } from '@/app/(auth)/actions'

/**
 * SCR-502 설정 — P4 컷 10 (DOC-008 §5)
 *
 * ## 축소판이다 — 두 요소뿐이다
 *
 * DOC-008 §5의 주요 요소는 「로그아웃, 앱 정보·면책 고지」이고 **표시명 변경은 v1에서
 * 보류했다**(§5의 U-03 각주). DB는 이미 허용하지만(`grant update (display_name)` +
 * `users_update_self`) DOC-011 §5에 계약이 없고, 신설하면 §5.11 + V-19 + 세 스위트가
 * 따라온다 — 사용자가 3명이고 표시명은 초대 시 들어온다.
 *
 * ## 로그아웃은 지우면 안 된다
 *
 * **쿠키 삭제 경로의 유일한 소비자**다 — 갱신은 값을 덮어쓰지만 삭제는 빈 값을 싣는
 * 다른 경로이고, 그것이 깨지면 브라우저가 죽은 쿠키를 계속 보낸다. 그리고 미인증
 * 상태로 가는 유일한 수단이므로 없으면 프록시 게이트와 SCR-001을 손으로 확인할
 * 방법이 브라우저 쿠키 삭제뿐이다(컷 0b가 이 버튼을 먼저 세운 이유).
 *
 * ## 면책 고지가 여기와 SCR-401 둘에 있다
 *
 * 중복이 아니다. SCR-401의 것은 **그 화면의 숫자**에 대한 경고이고(DOC-008 §5의
 * 「표시 주의」 셋째 줄 — C-04) 여기의 것은 **앱 전체**에 대한 것이다. 세금 화면을
 * 한 번도 열지 않는 사용자도 조건 판정·예상 수령액을 보며, 그 값들도 추정이다.
 *
 * ## 조회 계약을 부르지 않는다 — 그래서 **정적으로 프리렌더된다**
 *
 * `ROUTE_QUERIES`가 이 라우트에 빈 배열을 두는 것이 그 사실이며, 어떤 변경에도 낡지
 * 않는 유일한 화면이다.
 *
 * ★ **그 결과 「기준일」을 여기 적을 수 없다 — 실측으로 확인했다.** 처음에는 앱 정보에
 * `getAsOf()`의 값을 함께 적었는데 `next build`가 이 라우트를 `○ (Static)`으로
 * 표시했다. 다른 데이터 화면이 동적인 이유는 `getQueries()`가 `cookies()`를 지나기
 * 때문이고, 이 화면은 그것을 부르지 않으므로 **`today()`가 빌드 시각에 한 번 실행되고
 * 그 문자열이 응답에 굳는다.** 오류도 빈 값도 아닌 **그럴싸한 날짜**이며, 배포하지
 * 않는 동안 매일 조용히 틀려진다.
 *
 * 즉 「기준일을 요청당 한 번 해석한다」(Q-02)는 규약은 지켜져도 **요청이 없으면 그
 * 한 번이 빌드 때**다. 날짜·시각을 표시하려는 화면이 데이터를 읽지 않으면 이 함정에
 * 걸리므로, 그런 화면은 표시를 빼거나 동적 렌더를 요구해야 한다. 여기서는 문서가
 * 요구하지 않은 표시이므로 **뺐다.**
 */

export const metadata: Metadata = {
  title: '설정 · 언제들어오나',
}

/** 앱 정보 — 값이 아니라 **성질**을 적는다. 버전 문자열은 두지 않는다(각주 참조) */
const APP_FACTS: ReadonlyArray<{ label: string; value: string }> = [
  { label: '이름', value: '언제들어오나' },
  { label: '용도', value: 'ELS 포트폴리오 관리 — 평가일정·조건 판정·세금 추정' },
  { label: '범위', value: '개인용 폐쇄형. 초대된 사용자만 로그인한다' },
]

export default function SettingsPage() {
  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">설정</h1>
        <p className="mt-1 text-sm text-neutral-600">
          앱 정보와 면책 고지, 그리고 로그아웃.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">앱 정보</h2>
        <dl className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {APP_FACTS.map((fact) => (
            <div
              key={fact.label}
              className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-4"
            >
              <dt className="w-16 shrink-0 text-xs text-neutral-500 sm:pt-0.5">
                {fact.label}
              </dt>
              <dd className="text-sm">{fact.value}</dd>
            </div>
          ))}
        </dl>
        {/*
          **버전 문자열을 두지 않는다.** `package.json`의 값을 렌더하면 그것이 배포와
          함께 올라간다는 약속이 되는데 이 프로젝트에 그 절차가 없다 — 늘 `0.1.0`인
          숫자는 정보가 아니라 **틀린 정보**다. 필요해지면 빌드 시각이나 커밋 해시를
          싣는 절차와 함께 넣는다.
        */}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">면책 고지</h2>
        <div className="flex flex-col gap-2 rounded-lg bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
          <p>
            <strong>이 앱의 모든 수치는 참고용 추정이며 투자 권유가 아니다.</strong>{' '}
            조건 충족 여부·예상 수령액은 저장된 상품 조건과 입력된 시세로 계산한 값이고,
            실제 상환은 증권사가 관측한 종가와 계약서가 정한다.
          </p>
          <p>
            <strong>세금·건강보험료도 추정이다.</strong> 실제 신고는 증권사 지급명세서와
            국세청 자료를 기준으로 하며, 건강보험료는 실제로는 세대 단위로 소득·재산을
            합산해 부과된다 — 이 앱은 세대와 재산을 다루지 않는다.
          </p>
          <p>
            시세는 <strong>사용자가 입력한 값</strong>이 정본이다. 자동 수집은 아직
            연결되어 있지 않으므로, 시세가 오래되면 그 사실을 화면이 「시세 오래됨」으로
            표시한다.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">계정</h2>
        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-100"
          >
            로그아웃
          </button>
        </form>
        <p className="text-xs text-neutral-500">
          표시명 변경은 v1에서 제공하지 않는다 — 초대 시 정해지며, 바꾸려면 관리자가
          데이터를 고친다.
        </p>
      </div>
    </section>
  )
}
