import type { SessionId } from '@highwing/hermes/domain'
import { chatLinkIn } from '../chat-link'
import { opensNow, type ConnectionOwner } from './connection'

export interface ChatLinks {
  holdLatest(argv: readonly string[]): void
  serve(owner: Pick<ConnectionOwner, 'setup' | 'run'>, raise: () => void): () => void
}

export function chatLinks(): ChatLinks {
  let held: SessionId | null = null
  let deliver = () => {}
  return {
    holdLatest: argv => {
      const sessionId = chatLinkIn(argv)
      if (sessionId === null) return
      held = sessionId
      deliver()
    },
    serve: (owner, raise) => {
      deliver = () => {
        if (held === null || !opensNow(owner.setup.get())) return
        const sessionId = held
        held = null
        raise()
        void owner.run({ do: 'open', ref: { kind: 'link', sessionId } })
      }
      deliver()
      const unsubscribe = owner.setup.subscribe(deliver)
      return () => {
        unsubscribe()
        deliver = () => {}
      }
    }
  }
}
