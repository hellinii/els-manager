'use client'

import { useState, type ComponentProps } from 'react'

import { ProductForm } from '@/components/products/ProductForm'

/**
 * 불러오기 화면의 `ProductForm` — **조회가 실패한 렌더에서는 직전 키를 유지한다** (DOC-008 v2.11)
 *
 * 폼의 `key`는 불러온 값이 바뀔 때 폼을 다시 세우는 수단이다(`importFormKey`). 그런데 불러온 화면에서
 * 다른 변경(자산 등록·연결)이 성공하면 페이지가 다시 그려지며 키움을 다시 부르고, 그 한 번이 일시
 * 실패하면 키가 「blank」로 바뀌어 **불러온 값과 적은 투자원금이 사라졌다**(반박 검토). 실패한 렌더는
 * 새로 채울 것이 없으므로 폼을 그대로 두는 것이 옳다 — 구획이 「조회 실패」를 말한다.
 *
 * 렌더 중 파생 상태(`setState`를 조건부로 부르는 형태)로 쓴다 — ref를 렌더 중에 읽지 않는다.
 * 첫 마운트는 받은 키 그대로다(유지할 직전 키가 없다).
 *
 * **이 동작을 증명하는 층이 없다** — 클라이언트 재렌더 사이의 키 유지는 서버 HTML에 없다(AQ-64·
 * AQ-70과 같은 자리). 무엇을 유지할지의 판단(`keepPreviousKey`)은 `importPanelOf`가 내고 상시
 * 스위트가 본다.
 */
export function ImportedProductForm({
  formKey,
  keepPreviousKey,
  ...props
}: ComponentProps<typeof ProductForm> & { formKey: string; keepPreviousKey: boolean }) {
  const [stableKey, setStableKey] = useState(formKey)
  if (!keepPreviousKey && stableKey !== formKey) setStableKey(formKey)
  return <ProductForm key={keepPreviousKey ? stableKey : formKey} {...props} />
}
