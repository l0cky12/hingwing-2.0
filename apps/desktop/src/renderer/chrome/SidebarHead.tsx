import { COMMAND_KEY, MAC } from '../keys'
import { newChatIn, newChatKeys } from '../new-chat'
import { run, useTopic } from '../store'

const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export const SearchIcon = () => <svg {...icon}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
const Pencil = () => <svg {...icon}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>

export function SearchField({ onSearch }: { readonly onSearch: () => void }) {
  return (
    <button type="button" className="side-search" title={`Search (${COMMAND_KEY}+K)`} aria-keyshortcuts={MAC ? 'Meta+K' : 'Control+K'} onClick={onSearch}>
      <SearchIcon /><span>Search</span>
    </button>
  )
}

export function NewChatButton() {
  const open = useTopic('open')
  const keys = newChatKeys(MAC)
  return (
    <button type="button" className="pencil" aria-label="New chat" title={`New chat (${keys.shown})`} aria-keyshortcuts={keys.aria} onClick={() => void run(newChatIn(open, crypto.randomUUID()))}>
      <Pencil />
    </button>
  )
}
