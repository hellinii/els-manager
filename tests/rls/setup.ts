import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { begin, closeClient, openClient, rollback } from './helpers/client'

/**
 * 파일별 커넥션 + 테스트별 트랜잭션 격리.
 *
 * `afterEach`의 롤백이 테스트 실패 시에도 실행되므로 잔여물이 남지 않는다.
 * 실패한 테스트가 데이터를 남기면 다음 실행이 **다른 이유로** 실패해 원인
 * 추적이 어려워진다.
 */
beforeAll(openClient)
afterAll(closeClient)
beforeEach(begin)
afterEach(rollback)
