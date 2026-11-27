import type { SidebarRow } from '@highwing/hermes/domain'
import type { OnClose } from '../ipc-contract'

export type TrayAction =
  | { readonly do: 'raise' }
  | { readonly do: 'open'; readonly sessionId: SidebarRow['id'] }
  | { readonly do: 'quit' }

export type TrayItem =
  | { readonly kind: 'separator' }
  | { readonly kind: 'action'; readonly label: string; readonly action: TrayAction }

export interface TrayView {
  readonly count: number
  readonly tooltip: string
  readonly items: readonly TrayItem[]
}

const SHOW: TrayItem = { kind: 'action', label: 'Show Highwing', action: { do: 'raise' } }
const QUIT: TrayItem = { kind: 'action', label: 'Quit', action: { do: 'quit' } }
const SEPARATOR: TrayItem = { kind: 'separator' }

const titleOf = (title: string) => (title.trim() === '' ? 'Untitled chat' : title)

const tooltipOf = (count: number) => (count === 0 ? 'Highwing' : `${count} ${count === 1 ? 'chat' : 'chats'} waiting for your OK`)

export function trayView(rows: readonly Pick<SidebarRow, 'id' | 'title' | 'badge'>[]): TrayView {
  const asking = rows.filter(row => row.badge === 'asking')
  const chats: readonly TrayItem[] = asking.map(row => ({ kind: 'action', label: titleOf(row.title), action: { do: 'open', sessionId: row.id } }))
  return {
    count: asking.length,
    tooltip: tooltipOf(asking.length),
    items: chats.length === 0 ? [SHOW, SEPARATOR, QUIT] : [SHOW, SEPARATOR, ...chats, SEPARATOR, QUIT]
  }
}

export function decideClose({ preference, trayAlive, intent }: {
  readonly preference: OnClose
  readonly trayAlive: boolean
  readonly intent: 'window' | 'quit'
}): 'hide' | 'quit' {
  return preference === 'stay' && trayAlive && intent === 'window' ? 'hide' : 'quit'
}
