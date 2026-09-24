'use client'

import { useState, type ComponentProps } from 'react'

import { ProductForm } from '@/components/products/ProductForm'
import { formKeyAfter } from '@/lib/forms/importKey'

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
 * **무엇을 유지할지의 판단은 `formKeyAfter`(순수)가 한다**(DOC-008 v2.13) — 그 판단이 이 컴포넌트에
 * 있던 동안 첫 채움을 삼키는 결함이 어떤 스위트에도 보이지 않았다. 여기 남는 것은 렌더 중
 * `setState` 배선이고 그것은 클라이언트 재렌더 사이에만 있다(AQ-70).
 */
export function ImportedProductForm({
  formKey,
  keepPreviousKey,
  code,
  ...props
}: ComponentProps<typeof ProductForm> & { formKey: string; keepPreviousKey: boolean; code: string | null }) {
  const [stableKey, setStableKey] = useState(formKey)
  const key = formKeyAfter(stableKey, { code, formKey, keepPreviousKey })
  if (key !== stableKey) setStableKey(key)
  return <ProductForm key={key} {...props} />
}
