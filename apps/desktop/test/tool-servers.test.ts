import { describe, expect, it } from 'vitest'
import { EMPTY, setupOf, STATES, testedWords } from '../src/renderer/apps/tool-servers-view'

describe('what the Tool servers card says', () => {
  it('names each tool a passing server has, up to five', () => {
    expect(testedWords('files', { ok: true, tools: ['read_file', 'list_directory'] })).toBe('Connected. files has 2 tools: read_file, list_directory.')
    expect(testedWords('linear', { ok: true, tools: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).toBe('Connected. linear has 7 tools: a, b, c, d, e and 2 more.')
    expect(testedWords('empty', { ok: true, tools: [] })).toBe('Connected. empty has 0 tools.')
  })

  it('says why a server failed, and that nothing was saved', () => {
    expect(testedWords('broken', { ok: false, why: 'failed', reason: 'Connection refused.' })).toBe("Couldn't connect to broken: Connection refused. Nothing was saved.")
    expect(testedWords('notion', { ok: false, why: 'sign-in' })).toBe("notion needs a sign-in, which Highwing can't do yet. Nothing was saved.")
  })

  it('reads each state a listed server can be in', () => {
    expect(Object.entries(STATES).map(([state, words]) => [state, words(1)])).toEqual([
      ['connected', 'Connected · 1 tool'], ['connecting', 'Connecting'], ['failed', "Couldn't connect"], ['needs-sign-in', 'Needs sign-in'], ['off', 'Off'],
      ['idle', 'Starts when a chat needs it']
    ])
  })

  it('sends each argument line as typed, and no argument for an empty box or a final newline', () => {
    const command = (args: string) => setupOf({ ...EMPTY, name: 'files', kind: 'command', command: 'npx', args })
    expect(command('')).toEqual({ kind: 'command', name: 'files', command: 'npx', args: [] })
    expect(command('--separator\n \n /srv \n')).toMatchObject({ args: ['--separator', ' ', ' /srv '] })
    expect(command('-y\n\nlast')).toMatchObject({ args: ['-y', '', 'last'] })
  })
})
