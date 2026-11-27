import { UNREPORTED, type UsageView } from '../setup/usage-view'
import { MENU_ICONS } from './menu-icons'
import type { PopupItem } from './PopupMenu'

export type AccountAction = 'settings' | 'help' | 'quit' | `usage-${number}`

export const HELP_URL = 'https://hermes-agent.nousresearch.com/docs/'

/** Hermes draws a usage gauge as `[|||       ]`, its empty cells spaces, so a wrap inside it would split the gauge. */
const keepBarWhole = (line: string) => line.replace(/\[[| ]+\]/g, bar => bar.replaceAll(' ', '\u00a0'))

function usageLines(usage: UsageView): readonly string[] {
  switch (usage.state) {
    case 'needs-chat': return ['Open a chat to see usage.']
    case 'reading': return ['Reading usage…']
    case 'failed': return [usage.message]
    case 'unreported': return [UNREPORTED]
    case 'reported': return usage.lines.length === 0 ? ['This model reports no usage limits.'] : usage.lines.map(keepBarWhole)
  }
}

const item = (id: AccountAction, label: string, icon: PopupItem<AccountAction>['icon']): PopupItem<AccountAction> => ({ id, label, icon })

export function accountMenuOf(usage: UsageView, canOpenSettings: boolean): readonly (readonly PopupItem<AccountAction>[])[] {
  return [
    usageLines(usage).map((line, at) => ({ ...item(`usage-${at}`, line, MENU_ICONS.gauge), disabled: true })),
    [
      ...(canOpenSettings ? [item('settings', 'Settings', MENU_ICONS.settings)] : []),
      item('help', 'Help', MENU_ICONS.help)
    ],
    [item('quit', 'Quit Highwing', MENU_ICONS.power)]
  ]
}
