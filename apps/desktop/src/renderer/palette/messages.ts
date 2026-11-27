import type { CommandOutcome, FoundMessage, MessagesRead } from '@highwing/hermes/domain'

export type MessageSearch =
  | { readonly state: 'idle' }
  | { readonly state: 'reading'; readonly step: number; readonly found: readonly FoundMessage[]; readonly unread: number }
  | { readonly state: 'read'; readonly step: number; readonly found: readonly FoundMessage[]; readonly unread: number; readonly reach: MessagesRead['reach'] }
  | { readonly state: 'failed'; readonly step: number; readonly found: readonly FoundMessage[]; readonly unread: number; readonly words: string }

export const NOT_SEARCHED: MessageSearch = { state: 'idle' }

export const foundIn = (search: MessageSearch): readonly FoundMessage[] => (search.state === 'idle' ? [] : search.found)

export const begin = (search: MessageSearch, step: number): MessageSearch =>
  search.state === 'reading' ? search : { state: 'reading', step, found: foundIn(search), unread: search.state === 'idle' ? 0 : search.unread }

export function settle(search: MessageSearch, step: number, outcome: CommandOutcome<MessagesRead>): MessageSearch {
  if (search.state !== 'reading' || search.step !== step) return search
  if (!outcome.ok) return { ...search, state: 'failed', words: outcome.refusal.message }
  const { messages, reach, unread } = outcome.value
  return { state: 'read', step, found: [...search.found, ...messages], unread: search.unread + unread, reach }
}

export interface SearchStatus { readonly title: string; readonly detail: string | null; readonly reads: number | null }

export function statusOf(search: MessageSearch): SearchStatus | null {
  switch (search.state) {
    case 'idle': return null
    case 'reading': return { title: 'Searching messages…', detail: null, reads: null }
    case 'failed': return { title: search.words, detail: 'Try again', reads: search.step }
    case 'read':
      if (search.reach === 'more') return { title: 'Search older messages', detail: null, reads: search.step + 1 }
      return { title: search.unread === 0 ? 'Searched all messages' : 'Searched all the messages Highwing could read', detail: null, reads: null }
  }
}
