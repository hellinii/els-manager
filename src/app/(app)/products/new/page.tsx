import { PendingScreen } from '@/components/system/PendingScreen'

/**
 * SCR-204 ELS 등록 — 컷 4a에서 선다.
 *
 * ## 왜 컷 2에서 자리표시를 두는가
 *
 * SCR-201이 이 주소로 가는 버튼을 **둘 갖는다** — 머리글의 `+ 등록`(DOC-008 §5:
 * 「항상 노출」)과 「전체 없음」 빈 상태의 다음 행동(ST-02). 둘이 404로 가면
 * 그것은 사용자에게 **결함으로 보인다**: 「이 화면은 아직 없다」와 「이 주소는
 * 틀렸다」는 다른 사실이다(`PendingScreen`의 근거). 컷 0d가 다섯 탭에 같은 판단을
 * 했다.
 *
 * 그래서 `tests/app/invalidation.test.ts`의 `NOT_YET_BUILT`에서 이 라우트를
 * 지웠다 — 그 원장은 「파일이 없는 라우트」를 세므로 자리표시가 서면 그 단언이
 * 빨간불이 된다. **정보가 사라진 것은 아니다**: 남은 컷의 표식이 원장에서 이
 * 파일로 옮겨졌고, `placeholderRoutes()`가 그 목록을 센다(계획 §4의
 * `grep PendingScreen` 절차를 테스트로 옮긴 것이다).
 *
 * ## 이 파일이 없으면 `/products/new`가 상품 id로 해석된다
 *
 * 정적 세그먼트가 동적 세그먼트보다 우선하므로 이 파일이 있으면 여기로 온다.
 * 없으면 `[id]` 라우트가 `id = 'new'`로 받고, 그쪽의 UUID 형식 가드가 404로
 * 돌린다 — **500이 아닌 것은 그 가드 덕분이다.** 두 방어가 겹쳐 있고 어느 쪽도
 * 빠뜨려도 되는 것이 아니다: 가드가 없으면 500, 이 파일이 없으면 404다.
 */

export default function ProductNewPage() {
  return <PendingScreen screen="SCR-204" title="ELS 등록" cut="컷 4a" />
}
