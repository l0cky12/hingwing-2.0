import { describe, expect, it } from 'vitest'
import servers from '../../../fixtures/mcp/servers.json' with { type: 'json' }
import type { BotId } from '../src/domain/bots'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { maskedFrame, noAsk, scriptedDialer, type Fixture, type McpScript } from '../src/testing/fixture'
import { BOUND, callsIn, WITH_BOTS } from './support/errand'

const EMU = 'default' as BotId
const RESEARCH = 'research' as BotId
const SCRIPT = servers as McpScript

async function launched(mcp: McpScript | null = SCRIPT, fixture: Fixture = WITH_BOTS) {
  const clock = manualClock()
  const script = scriptedDialer({ ...fixture, header: { ...fixture.header, ...(mcp === null ? {} : { mcp }) } }, { clock })
  const hermes = openHermes({ ask: noAsk, dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  const run: typeof hermes.run = async command => {
    const answer = hermes.run(command)
    await clock.advance(5_000)
    return answer
  }
  return { run, calls: (method: string) => callsIn(script.received).filter(call => call.method === method) }
}

const names = (outcome: { ok: boolean; value?: unknown }) => (outcome.ok ? (outcome.value as readonly { name: string }[]).map(server => server.name) : null)

describe('tool servers', () => {
  it('lists a bot’s servers with each one’s state, and only the URL’s host and path', async () => {
    const { run } = await launched({ servers: { default: [{ name: 'keyed', url: 'https://mcp.example.com/sse?key=abc#x', status: 'failed' }, ...SCRIPT.servers.default ?? []] } })
    expect(await run({ do: 'toolServers', bot: EMU })).toEqual({
      ok: true, value: [
        { name: 'browser', where: 'npx -y @playwright/mcp', state: 'idle', tools: 0, removable: false },
        { name: 'github', where: 'https://api.githubcopilot.com/mcp/', state: 'connected', tools: 41, removable: true },
        { name: 'keyed', where: 'https://mcp.example.com/sse', state: 'failed', tools: 0, removable: true }
      ]
    })
  })

  it('reads a sign-in Hermes parked a server on as needing one, whatever its status', async () => {
    const { run } = await launched({ servers: { default: [{ name: 'notion', url: 'https://mcp.notion.example', status: 'failed', needs_auth: true }] } })
    expect(await run({ do: 'toolServers', bot: EMU })).toMatchObject({ ok: true, value: [{ name: 'notion', state: 'needs-sign-in' }] })
  })

  it('reads the launch profile’s servers when no bot is named', async () => {
    const { run, calls } = await launched()
    expect(names(await run({ do: 'toolServers', bot: null }))).toEqual(['browser', 'github'])
    expect(calls('mcp.servers.list')).toEqual([expect.objectContaining({ params: {} })])
  })

  it('keeps each bot’s servers apart', async () => {
    const { run } = await launched()
    expect(names(await run({ do: 'toolServers', bot: RESEARCH }))).toEqual([])
    await run({ do: 'addToolServer', bot: RESEARCH, setup: { kind: 'address', name: 'linear', url: 'https://mcp.linear.example', headers: [] } })
    expect(names(await run({ do: 'toolServers', bot: RESEARCH }))).toEqual(['linear'])
    expect(names(await run({ do: 'toolServers', bot: EMU }))).toEqual(['browser', 'github'])
  })

  it('keeps a server whose test passes, and sends its headers once', async () => {
    const { run, calls } = await launched()
    const added = await run({ do: 'addToolServer', bot: EMU, setup: { kind: 'address', name: 'linear', url: 'https://mcp.linear.example', headers: [{ name: 'Authorization', value: 'Bearer s3cret' }] } })
    expect(added).toMatchObject({ ok: true, value: { tested: { ok: true, tools: ['list_issues', 'get_issue', 'create_issue', 'update_issue', 'list_projects', 'list_teams', 'add_comment'] } } })
    expect(added.ok && added.value.servers.map(server => server.name)).toEqual(['browser', 'github', 'linear'])
    expect(calls('mcp.servers.add')).toEqual([expect.objectContaining({ params: { name: 'linear', config: { url: 'https://mcp.linear.example', headers: { Authorization: 'Bearer s3cret' } }, profile: 'default' } })])
    expect(JSON.stringify(added)).not.toContain('s3cret')
  })

  it('adds a command with its arguments', async () => {
    const { run, calls } = await launched()
    const added = await run({ do: 'addToolServer', bot: EMU, setup: { kind: 'command', name: 'files', command: 'npx', args: ['-y', 'server-filesystem', '/srv'] } })
    expect(added).toMatchObject({ ok: true, value: { tested: { ok: true, tools: ['read_file', 'list_directory'] } } })
    expect(added.ok && added.value.servers.find(server => server.name === 'files')?.where).toBe('npx -y server-filesystem /srv')
    expect(calls('mcp.servers.add')[0]?.params).toMatchObject({ config: { command: 'npx', args: ['-y', 'server-filesystem', '/srv'] } })
  })

  it.each([
    ['fails', 'broken', { ok: false, why: 'failed', reason: 'Connection refused' }],
    ['wants a sign-in', 'notion', { ok: false, why: 'sign-in' }]
  ])('takes a server out again when its test %s, so nothing is saved', async (_, name, tested) => {
    const { run, calls } = await launched()
    const added = await run({ do: 'addToolServer', bot: EMU, setup: { kind: 'address', name, url: `https://${name}.example`, headers: [] } })
    expect(added).toEqual({ ok: true, value: expect.objectContaining({ tested }) })
    expect(added.ok && added.value.servers.map(server => server.name)).toEqual(['browser', 'github'])
    expect(calls('mcp.servers.remove')).toEqual([expect.objectContaining({ params: { name, profile: 'default' } })])
  })

  it('refuses a name a server already has, and changes nothing', async () => {
    const { run, calls } = await launched()
    expect(await run({ do: 'addToolServer', bot: EMU, setup: { kind: 'address', name: 'github', url: 'https://other.example', headers: [] } }))
      .toEqual({ ok: false, refusal: { kind: 'rejected', message: "There's already a tool server with that name.", field: 'name' } })
    expect(calls('mcp.servers.test')).toEqual([])
    expect(calls('mcp.servers.remove')).toEqual([])
  })

  it('removes a server, and refuses one a plugin provides', async () => {
    const { run } = await launched()
    expect(names(await run({ do: 'removeToolServer', bot: EMU, name: 'github' }))).toEqual(['browser'])
    expect(await run({ do: 'removeToolServer', bot: EMU, name: 'browser' }))
      .toEqual({ ok: false, refusal: { kind: 'rejected', message: 'A plugin provides that tool server, so only the plugin can remove it.' } })
    expect(names(await run({ do: 'removeToolServer', bot: EMU, name: 'github' }))).toEqual(['browser'])
  })

  it.each([['a Hermes without them', null, WITH_BOTS], ['a socket bound to one profile', SCRIPT, BOUND]])('says %s can’t manage tool servers', async (_, mcp, fixture) => {
    const { run } = await launched(mcp, fixture)
    expect(await run({ do: 'toolServers', bot: EMU })).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't manage tool servers from Highwing." } })
  })

  it('masks header values in a frame kept for a log', () => {
    const frame = { jsonrpc: '2.0', id: 9, method: 'mcp.servers.add', params: { name: 'linear', config: { url: 'https://mcp.linear.example', headers: { Authorization: 'Bearer s3cret' } } } }
    expect(JSON.stringify(maskedFrame(frame))).not.toContain('s3cret')
    expect(JSON.stringify(maskedFrame(frame))).toContain('https://mcp.linear.example')
  })
})
