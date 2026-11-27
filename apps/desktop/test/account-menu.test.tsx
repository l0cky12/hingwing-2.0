import { describe, expect, it } from 'vitest'
import { accountMenuOf } from '../src/renderer/chrome/account-menu'
import type { UsageView } from '../src/renderer/setup/usage-view'

const rows = (usage: UsageView, canOpenSettings = true) =>
  accountMenuOf(usage, canOpenSettings).map(group => group.map(item => `${item.label}${item.disabled ? ' (info)' : ''}`))

describe('the account menu', () => {
  it('lists the usage Hermes words, then Settings and Help, then Quit', () => {
    expect(rows({ state: 'reported', lines: ['Acme Pro', 'Week: 88% remaining (12% used)'] })).toEqual([
      ['Acme Pro (info)', 'Week: 88% remaining (12% used) (info)'],
      ['Settings', 'Help'],
      ['Quit Highwing']
    ])
  })

  it('keeps a usage gauge whole, its empty cells spaces that do not wrap', () => {
    expect(rows({ state: 'reported', lines: ['Session (5h)  [|||       ]  34% used'] })[0]).toEqual([
      'Session (5h)  [|||\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0]  34% used (info)'
    ])
  })

  it('says why it shows no usage', () => {
    expect(rows({ state: 'needs-chat' })[0]).toEqual(['Open a chat to see usage. (info)'])
    expect(rows({ state: 'reading' })[0]).toEqual(['Reading usage… (info)'])
    expect(rows({ state: 'reported', lines: [] })[0]).toEqual(['This model reports no usage limits. (info)'])
    expect(rows({ state: 'unreported' })[0]).toEqual(['This Hermes does not report usage. (info)'])
    expect(rows({ state: 'failed', message: "Highwing isn't connected to Hermes right now." })[0]).toEqual(["Highwing isn't connected to Hermes right now. (info)"])
  })

  it('leaves Settings out when there is no connection to change', () => {
    expect(rows({ state: 'needs-chat' }, false)[1]).toEqual(['Help'])
  })
})
