/**
 * 오류 경계가 «판단»하는 것 — AQ-38 (c)
 *
 * ## 왜 떼어내는가
 *
 * `src/app/error.tsx`·`global-error.tsx`의 **동작이 한 번도 관측되지 않았다**(AQ-38).
 * 그리고 컷 10의 전수 확인이 후보 (b)를 닫았다 — **URL로 도달하면서 잡히지 않는 던짐이
 * 없다.** 세 라우트(`[id]`·`edit`·`redeem`)가 전부 `isUuid`로 가드하고 `searchParams`는
 * `lib/forms/query.ts`의 순수 파서를 지나며, 페이지 렌더 경로의 `catch`는
 * `tax/page.tsx`(`TaxSeedRangeError`) 하나뿐이다. Q-06 절단 예외는 발화가 가능해졌지만
 * **999행을 스위트에 상주시켜야 하므로** 레버로 쓸 수 없다.
 *
 * 그래서 (c)다 — **판단을 순수 함수로 옮겨 상시 스위트가 전수로 본다.**
 * `lib/cron/decide.ts`가 같은 이유로 라우트 밖에 있다(그 파일의 주석이 근거를 적는다).
 *
 * ## ★ 이것이 «덮지 않는» 것을 먼저 적는다
 *
 * **redact 동작 자체는 여전히 미검증이다.** 프로덕션에서 `Error`가 실제로 redact되어
 * `digest`만 남는지는 경계가 실행돼야 보이고, 그 실행 경로가 지금 없다. 이 파일이
 * 검증하는 것은 **「그 전제 위에서 무엇을 렌더하기로 했는가」**까지다 —
 * 전제 자체가 아니다. AQ-38이 그 잔여를 안고 열려 있다.
 *
 * ## 판단은 둘이고 둘 다 조용히 틀릴 수 있었다
 *
 * ① **`digest`가 없으면 칩을 렌더하지 않는다.** 개발 모드에서는 `digest`가 붙지 않으므로
 *    이 갈래가 개발자에게 보이는 유일한 모습이다.
 * ② **★ 빈 문자열도 없는 것으로 다룬다.** 종전 `error.digest != null &&`는 `''`를
 *    **통과시켜** 내용 없는 회색 칩을 렌더했다. 「코드와 함께 알린다」고 적어 놓고 빈 칩을
 *    보여 주는 상태이며, **화면은 정상으로 보이고 신고만 성립하지 않는다.**
 *    `env.ts`가 부재와 빈 문자열을 함께 던지는 것과 같은 규약이다.
 */

/** 경계가 렌더할 것 — 문구는 값이고 분기는 하나다 */
export type ErrorNotice = {
  readonly title: string
  readonly body: string
  /** 표시할 진단 코드. **없으면 `null`이며 빈 문자열은 없는 것으로 접는다** */
  readonly digest: string | null
}

/**
 * 문구를 여기 두는 이유는 **판단과 함께 시험하기 위해서**다.
 *
 * 「다시 시도」만 적으면 Q-06 절단 예외 같은 **의도된 신호**가 「가끔 실패하는 화면」으로
 * 읽히고 아무도 열어보지 않는다 — 그래서 `digest`를 보여 주고 신고를 권한다.
 */
const TITLE = '화면을 불러오지 못했다'
const BODY = '일시적인 문제일 수 있다. 다시 시도해도 같으면 아래 코드와 함께 알린다.'

/**
 * 루트 레이아웃이 깨진 경우 — `global-error.tsx`.
 *
 * **문구가 다른 이유는 상태가 다르기 때문이다.** 여기까지 오면 셸도 스타일도 없으므로
 * 「화면을 불러오지 못했다」가 아니라 **「앱을 시작하지 못했다」**이고, 「다시 시도」가
 * 아니라 **새로고침**이다. `digest` 판단은 «같다» — 그래서 함수를 나누지 않고
 * 문구만 인자로 가른다. 나누면 빈 문자열 갈래가 한쪽에만 고쳐지는 상태가 다시 생긴다.
 */
const GLOBAL_TITLE = '앱을 시작하지 못했다'
const GLOBAL_BODY = '새로고침해도 같으면 아래 코드와 함께 알린다.'

/**
 * ★ **인자가 `Error`가 아니라 `{ digest }`다.** 경계는 오류의 «종류»를 판별하지 않으므로
 * (운영에서 메시지도 프로토타입도 사라진다) 판단에 필요한 입력이 그것뿐이다.
 * 타입으로 좁혀 두면 **`error.message`를 읽고 싶어지는 자리가 애초에 생기지 않는다** —
 * 그 유혹을 주석이 아니라 서명이 막는다.
 */
export function errorNotice(
  error: { digest?: string | undefined },
  scope: 'page' | 'global' = 'page',
): ErrorNotice {
  const raw = error.digest
  return {
    title: scope === 'global' ? GLOBAL_TITLE : TITLE,
    body: scope === 'global' ? GLOBAL_BODY : BODY,
    digest: raw == null || raw.trim() === '' ? null : raw,
  }
}
