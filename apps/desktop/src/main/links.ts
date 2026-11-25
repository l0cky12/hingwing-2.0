import type { SessionId } from '@highwing/hermes/domain'
import { chatLinkIn } from '../chat-link'
import type { ConnectionOwner } from './connection'

export interface ChatLinks {
  holdLatest(argv: readonly string[]): void
  serve(owner: Pick<ConnectionOwner, 'setup' | 'hermes'>, raise: () => void): () => void
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
        const { hermes } = owner
        const { at } = owner.setup.get()
        const chatShows = at === 'chat' || at === 'pinned'
        if (held === null || hermes === null || !chatShows) return
        const sessionId = held
        held = null
        raise()
        void hermes.run({ do: 'open', ref: { kind: 'link', sessionId } })
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
