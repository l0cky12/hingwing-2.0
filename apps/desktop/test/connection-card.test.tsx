import { URL_FAILURES, type GatewayUrl, type Link, type ServerId, type SshHost, type Target, type UrlFailure } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { showsSettings, type Live, type ServerBook, type Setup } from '../src/ipc-contract'
import { cardOf } from '../src/renderer/setup/card-view'
import { ConnectionCard } from '../src/renderer/setup/ConnectionCard'
import { screenOf, type CardSetup } from '../src/renderer/setup/screens'
import { live, oneServer, SERVER } from './support/live'

const remote = (host: string): Target => ({ kind: 'remote', host: host as SshHost })
const HOST = remote('hermes-host.example-tailnet.ts.net')
const LAB = remote('hermes-lab')
const LAN: Target = { kind: 'ssh', host: '192.168.1.20' as SshHost }
const WEB: Target = { kind: 'url', url: 'https://hermes.example.com' as GatewayUrl }
const LIVE: Live = live(HOST, 1)
const ONLINE: Link = { state: 'online' }
const AT_REST: CardSetup = { at: 'form', live: LIVE, notice: null }
const waiting = (why: 'not-running' | 'dropped', message: string): Link => ({ state: 'waiting', attempt: 1, retryAt: 0, why, message })

describe('which screen the window shows', () => {
  it.each<[string, Setup, string]>([
    ['the chat', { at: 'chat', live: LIVE }, 'chat'],
    ['a fixture run', { at: 'pinned' }, 'chat'],
    ['a first run', { at: 'form', live: null, notice: 'newer' }, 'first-run'],
    ['a first run checking', { at: 'checking', live: null, target: LAB, into: 'replace', step: 'ssh' }, 'first-run'],
    ['a first run that failed', { at: 'failed', live: null, target: LAB, into: 'replace', failure: 'host-offline' }, 'first-run'],
    ['a first run that passed', { at: 'saved', live: LIVE, from: 'first-run', into: 'replace' }, 'saved'],
    ['the Settings button', AT_REST, 'settings'],
    ['a check from Settings', { at: 'checking', live: LIVE, target: LAB, into: 'replace', step: 'ssh' }, 'settings'],
    ['a check from Settings that failed', { at: 'failed', live: LIVE, target: LAB, into: 'replace', failure: 'host-offline' }, 'settings'],
    ['a check from Settings that passed', { at: 'saved', live: live(LAB, 2), from: 'settings', into: 'replace' }, 'settings']
  ])('shows %s on %j, by the rule main uses for Settings', (_what, setup, show) => {
    expect(screenOf(setup).show).toBe(show)
    expect(showsSettings(setup)).toBe(show === 'settings')
  })
})

describe('the connection row', () => {
  it('names the machine, adds the full name in mono, and shows the Online pill', () => {
    expect(cardOf(AT_REST, ONLINE, null)).toMatchObject({
      summary: { kind: 'ssh', title: 'hermes-host', host: 'hermes-host.example-tailnet.ts.net', linkMessage: null, online: true, action: null },
      editor: null,
      news: null
    })
  })

  it('shows a short name once, keeps a user@ in the mono line, and calls this computer by name', () => {
    const summaryFor = (target: Target) => cardOf({ ...AT_REST, live: live(target, 1) }, ONLINE, null).summary
    expect(summaryFor(remote('hermes-host'))).toMatchObject({ title: 'hermes-host', host: null })
    expect(summaryFor(remote('me@hermes-host'))).toMatchObject({ title: 'hermes-host', host: 'me@hermes-host' })
    expect(summaryFor({ kind: 'local' })).toMatchObject({ kind: 'local', title: 'This computer', host: null })
  })

  it('shows the link\'s own words with no pill while it waits or is blocked, with the banner\'s action', () => {
    expect(cardOf(AT_REST, waiting('not-running', "Hermes isn't running."), null).summary)
      .toMatchObject({ linkMessage: "Hermes isn't running.", online: false, action: { label: 'Start Hermes', run: [{ do: 'reconnect', start: true }] } })
    expect(cardOf(AT_REST, { state: 'blocked', why: 'auth', message: 'Hermes turned Highwing away.' }, null).summary)
      .toMatchObject({ linkMessage: 'Hermes turned Highwing away.', online: false, action: { label: 'Retry', run: [{ do: 'reconnect', start: false }] } })
    expect(cardOf(AT_REST, waiting('dropped', 'Reconnecting to Hermes.'), null).summary)
      .toMatchObject({ linkMessage: 'Reconnecting to Hermes.', online: false, action: null })
  })

  it('offers Sign in on a signed-out link, which checks the live connection in the Settings already open', () => {
    expect(cardOf(AT_REST, { state: 'blocked', why: 'signed-out', message: 'Sign in to Hermes again.' }, null).summary)
      .toMatchObject({ linkMessage: 'Sign in to Hermes again.', action: { label: 'Sign in', run: [{ do: 'checkTarget', target: HOST, into: 'replace' }] } })
  })

  it('names a gateway by its host, with the address in mono when it says more', () => {
    const summaryFor = (url: string) => cardOf({ ...AT_REST, live: live({ kind: 'url', url: url as GatewayUrl }, 1) }, ONLINE, null).summary
    expect(summaryFor('https://hermes.example.com:8443')).toMatchObject({ kind: 'url', title: 'hermes.example.com', host: 'https://hermes.example.com:8443' })
  })

  it('keeps the mono line with no pill and no action while connecting, or before the link is known', () => {
    for (const link of [{ state: 'connecting', attempt: 1 } as const, undefined]) {
      expect(cardOf(AT_REST, link, null).summary).toMatchObject({ host: 'hermes-host.example-tailnet.ts.net', linkMessage: null, online: false, action: null })
    }
  })
})

describe('the editor in Settings', () => {
  it('opens on Change, from the live connection, with the note and a Cancel that folds it', () => {
    expect(cardOf(AT_REST, ONLINE, 'replace').editor).toMatchObject({ into: 'replace', seed: HOST, disabled: false, problem: null, foot: { show: 'note' }, cancel: 'fold' })
  })

  it('stays open and disabled while a check runs, with the step in the note\'s place and a Cancel that stops it', () => {
    const view = cardOf({ at: 'checking', live: LIVE, target: LAB, into: 'replace', step: 'ssh' }, ONLINE, null)
    expect(view.editor).toMatchObject({ seed: LAB, disabled: true, problem: null, foot: { show: 'progress', words: 'Connecting to hermes-lab', hint: null }, cancel: 'stop' })
    expect(view.summary).toMatchObject({ title: 'hermes-host', online: true })
  })

  it('turns Cancel off while the connection is saved', () => {
    expect(cardOf({ at: 'checking', live: LIVE, target: LAB, into: 'replace', step: 'save' }, ONLINE, null).editor)
      .toMatchObject({ disabled: true, foot: { show: 'progress', words: 'Saving this connection' }, cancel: 'saving' })
  })

  it('says why a check failed under the field, keeps the draft, and still shows the current connection online', () => {
    const view = cardOf({ at: 'failed', live: LIVE, target: LAB, into: 'replace', failure: 'host-offline' }, ONLINE, null)
    expect(view.editor).toMatchObject({
      seed: LAB, disabled: false, foot: { show: 'note' }, cancel: 'stop',
      problem: { words: 'Your tailnet lists hermes-lab, but it is offline.', fix: 'Turn that machine on, or start Tailscale on it.' }
    })
    expect(view.summary).toMatchObject({ title: 'hermes-host', online: true })
  })

  it('folds on the new machine once a check passes, and says so', () => {
    const saved: CardSetup = { at: 'saved', live: live(LAB, 2), from: 'settings', into: 'replace' }
    expect(cardOf(saved, undefined, null)).toMatchObject({ summary: { title: 'hermes-lab', host: null }, editor: null, news: 'Highwing now uses the Hermes on hermes-lab.' })
    expect(cardOf(saved, undefined, 'replace').editor).toMatchObject({ seed: LAB, cancel: 'fold' })
  })
})

describe('the editor on a first run', () => {
  it('is open with no summary, no note and no Cancel', () => {
    expect(cardOf({ at: 'form', live: null, notice: null }, undefined, null))
      .toMatchObject({ summary: null, editor: { into: 'replace', seed: null, disabled: false, problem: null, foot: { show: 'nothing' }, cancel: null }, news: null, servers: [], ways: null })
  })

  it('puts the step in the empty slot while checking, and the failure under the field', () => {
    expect(cardOf({ at: 'checking', live: null, target: { kind: 'local' }, into: 'replace', step: 'hermes' }, undefined, null).editor)
      .toMatchObject({ disabled: true, foot: { show: 'progress', words: 'Looking for Hermes on this computer' }, cancel: null })
    expect(cardOf({ at: 'failed', live: null, target: LAB, into: 'replace', failure: 'host-not-found' }, undefined, null).editor)
      .toMatchObject({ foot: { show: 'nothing' }, cancel: null, problem: { words: 'No machine called hermes-lab is on your tailnet.' } })
  })

  it('draws the shared card with SSH picked, the SSH destination field and Connect, and no Cancel', () => {
    const markup = renderToStaticMarkup(<ConnectionCard setup={{ at: 'form', live: null, notice: null }} link={undefined} />)
    expect(markup).toMatch(/<label><input type="radio" name="[^"]+" checked=""\/><svg[^]*?<\/svg>SSH<\/label>/)
    expect(markup).toContain('This computer</label>')
    expect(markup).toContain('placeholder="192.168.1.20"')
    expect(markup).toContain('A Tailscale name, a LAN address, or a host in your SSH config. Add user@ in front to log in as someone else.')
    expect(Array.from(markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g), ([, name]) => name)).toEqual(['Connect'])
    expect(markup).not.toContain('Highwing keeps the current connection')
  })
})

const text = (markup: string) => markup.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')
const render = (setup: CardSetup) => renderToStaticMarkup(<ConnectionCard setup={setup} link={undefined} />)
const buttons = (markup: string) => [...markup.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(([, label]) => label)

describe('the Connection page for one server with one way', () => {
  const book: ServerBook = { list: oneServer(HOST).list, current: SERVER, times: [] }

  it('is the card as it was, with Change, and the two Add buttons under it', () => {
    expect(cardOf(AT_REST, ONLINE, null, book)).toEqual({
      servers: [], ways: null, editor: null, change: true, adds: true, busy: false, news: null,
      summary: { kind: 'ssh', title: 'hermes-host', host: 'hermes-host.example-tailnet.ts.net', linkMessage: null, online: true, action: null }
    })
    const markup = renderToStaticMarkup(<ConnectionCard setup={AT_REST} link={ONLINE} book={book} />)
    expect(buttons(markup)).toEqual(['Change', 'Add a way in', 'Add a server'])
    expect(markup).not.toContain('Servers')
    expect(markup).not.toContain('Pick')
  })

  it('hides the Add buttons while an editor is open, and on a first run', () => {
    expect(cardOf(AT_REST, ONLINE, 'replace', book)).toMatchObject({ adds: false, change: false })
    expect(cardOf({ at: 'failed', live: LIVE, target: LAB, into: 'addWay', failure: 'host-offline' }, ONLINE, null, book)).toMatchObject({ adds: false })
    expect(cardOf({ at: 'form', live: null, notice: null }, undefined, null)).toMatchObject({ adds: false, change: false })
  })

  it.each([
    ['addWay', 'Add a way in to hermes-host', 'Another way in to hermes-host', 'ssh'],
    ['addServer', 'Add a server', 'Where the other Hermes runs', 'ssh'],
    ['replace', 'Change the connection', 'Where Hermes runs', 'ssh']
  ] as const)('opens the %s editor as "%s", empty unless it changes the connection', (into, title, asks, kind) => {
    expect(cardOf(AT_REST, ONLINE, into, book).editor).toMatchObject({ into, title, asks, kind, seed: into === 'replace' ? HOST : null, cancel: 'fold' })
  })

  it('keeps the editor a check was started from, through the check and its failure', () => {
    expect(cardOf({ at: 'checking', live: LIVE, target: LAN, into: 'addWay', step: 'ssh' }, ONLINE, null, book))
      .toMatchObject({ busy: true, editor: { into: 'addWay', title: 'Add a way in to hermes-host', seed: LAN, disabled: true } })
    expect(cardOf({ at: 'failed', live: LIVE, target: LAN, into: 'addServer', failure: 'unreachable' }, ONLINE, null, book))
      .toMatchObject({ busy: false, editor: { into: 'addServer', title: 'Add a server', seed: LAN, problem: { words: "Highwing can't reach 192.168.1.20 over SSH." } } })
  })

  it('sends the check with what the open editor is for', () => {
    const markup = renderToStaticMarkup(<ConnectionCard setup={{ at: 'failed', live: LIVE, target: LAN, into: 'addWay', failure: 'unreachable' }} link={ONLINE} book={book} />)
    expect(markup).toContain('<form class="edit-form" aria-label="Add a way in to hermes-host">')
    expect(markup).toMatch(/checked=""\/><svg[^]*?<\/svg>SSH<\/label>/)
    expect(markup).toContain('value="192.168.1.20"')
  })
})

describe('the Connection page for one server with several ways', () => {
  const server = { id: SERVER, name: 'hermes-host', ways: [HOST, LAN, WEB], pick: 'fastest' } as const
  const book: ServerBook = { list: [server], current: SERVER, times: [{ target: HOST, ms: 163.4 }, { target: LAN, ms: 12 }, { target: WEB, ms: null }] }
  const viaLan: CardSetup = { at: 'form', live: live(LAN, 1), notice: null }

  it('lists each way in priority order under its label, with its address, its last time and where its buttons would put it', () => {
    expect(cardOf(viaLan, ONLINE, null, book).ways).toEqual({
      pick: 'fastest', order: [HOST, LAN, WEB],
      rows: [
        { key: expect.any(String), label: 'Tailscale', host: 'hermes-host.example-tailnet.ts.net', name: 'hermes-host.example-tailnet.ts.net', time: '163 ms', inUse: false, up: null, down: [LAN, HOST, WEB], without: [LAN, WEB] },
        { key: expect.any(String), label: 'LAN', host: '192.168.1.20', name: '192.168.1.20', time: '12 ms', inUse: true, up: [LAN, HOST, WEB], down: [HOST, WEB, LAN], without: [HOST, WEB] },
        { key: expect.any(String), label: 'Web', host: 'https://hermes.example.com', name: 'https://hermes.example.com', time: 'No answer', inUse: false, up: [HOST, WEB, LAN], down: null, without: [HOST, LAN] }
      ]
    })
  })

  it('names the server once in the row, with the tile of its first way, and offers no Change', () => {
    expect(cardOf(viaLan, ONLINE, null, book)).toMatchObject({ summary: { kind: 'ssh', title: 'hermes-host', host: null, online: true }, change: false, adds: true, servers: [] })
  })

  it('marks no way In use while the link is not online, and shows no time before a timing', () => {
    const view = cardOf(viaLan, waiting('dropped', 'Reconnecting to Hermes.'), null, { ...book, times: [] })
    expect(view.ways?.rows.map(({ inUse, time }) => [inUse, time])).toEqual([[false, null], [false, null], [false, null]])
  })

  it('calls this computer by its label, which has no address', () => {
    const local = { ...server, ways: [HOST, { kind: 'local' }] } as const
    expect(cardOf(AT_REST, ONLINE, null, { list: [local], current: SERVER, times: [] }).ways?.rows[1]).toMatchObject({ label: 'This computer', host: null, name: 'This computer' })
  })

  it('draws the pick, the rows and their buttons, the first Move up and the last Move down turned off', () => {
    const markup = renderToStaticMarkup(<ConnectionCard setup={viaLan} link={ONLINE} book={book} />)
    expect(text(markup)).toContain('Pick Fastest uses the way that answers soonest. In order uses the first that answers.')
    expect(markup).toMatch(/checked=""\/><svg[^]*?<\/svg>Fastest<\/label>/)
    expect(text(markup)).toContain('LAN In use 192.168.1.20 12 ms')
    expect([...markup.matchAll(/<button type="button" class="btn[^"]*" aria-label="([^"]*)"( disabled="")?/g)].map(([, name, off]) => `${name}${off === undefined ? '' : ' (off)'}`)).toEqual([
      'Move hermes-host.example-tailnet.ts.net up (off)', 'Move hermes-host.example-tailnet.ts.net down', 'Remove hermes-host.example-tailnet.ts.net',
      'Move 192.168.1.20 up', 'Move 192.168.1.20 down', 'Remove 192.168.1.20',
      'Move https://hermes.example.com up', 'Move https://hermes.example.com down (off)', 'Remove https://hermes.example.com'
    ])
    expect(buttons(markup).slice(-2)).toEqual(['Add a way in', 'Add a server'])
  })

  it('turns every edit off while a check runs', () => {
    const markup = renderToStaticMarkup(<ConnectionCard setup={{ at: 'checking', live: live(LAN, 1), target: LAB, into: 'addWay', step: 'ssh' }} link={ONLINE} book={book} />)
    expect([...markup.matchAll(/<button type="button" class="btn[^"]*" aria-label="(?:Move|Remove)[^"]*"( disabled="")?/g)].map(([, off]) => off !== undefined)).toEqual(Array(9).fill(true))
    expect(markup).toContain('<fieldset class="control" disabled="">')
  })

  it('says which way a passed check added, by the label of the way that was checked', () => {
    const saved: CardSetup = { at: 'saved', live: live(HOST, 1), from: 'settings', into: 'addWay' }
    expect(cardOf(saved, ONLINE, null, book, LAN).news).toBe('hermes-host can now be reached over LAN.')
    expect(cardOf(saved, ONLINE, null, book).news, 'with no check seen, the way added last').toBe('hermes-host can now be reached over Web.')
  })
})

describe('the Connection page for several servers', () => {
  const book: ServerBook = {
    list: [
      { id: SERVER, name: 'hermes-host', ways: [HOST, LAN], pick: 'order' },
      { id: 'server-2' as ServerId, name: 'This computer', ways: [{ kind: 'local' }], pick: 'fastest' },
      { id: 'server-3' as ServerId, name: 'studio', ways: [WEB], pick: 'fastest' }
    ],
    current: SERVER, times: []
  }

  it('lists every server with its ways, marks the one in use, and shows that one below with its own ways', () => {
    const view = cardOf(AT_REST, ONLINE, null, book)
    expect(view.servers).toEqual([
      { id: SERVER, name: 'hermes-host', ways: 'Tailscale · LAN', current: true },
      { id: 'server-2', name: 'This computer', ways: null, current: false },
      { id: 'server-3', name: 'studio', ways: 'Web', current: false }
    ])
    expect(view).toMatchObject({ summary: { title: 'hermes-host' }, ways: { pick: 'order', order: [HOST, LAN] } })
  })

  it('offers Use and Remove on the servers that are not in use, by name', () => {
    const markup = renderToStaticMarkup(<ConnectionCard setup={AT_REST} link={ONLINE} book={book} />)
    expect(text(markup)).toContain('Servers hermes-host In use Tailscale · LAN This computer Use Remove studio Web Use Remove')
    expect([...markup.matchAll(/aria-label="((?:Use|Remove) [^"]*)"/g)].map(([, name]) => name).slice(0, 4)).toEqual(['Use This computer', 'Remove This computer', 'Use studio', 'Remove studio'])
  })

  it('says which server Highwing uses after a pick, as after a passed check', () => {
    const picked: CardSetup = { at: 'saved', live: live({ kind: 'local' }, 2, 'server-2' as ServerId), from: 'settings', into: 'replace' }
    expect(cardOf(picked, ONLINE, null, { ...book, current: 'server-2' as ServerId })).toMatchObject({
      news: 'Highwing now uses the Hermes on this computer.', summary: { title: 'This computer' }, ways: null, change: true,
      servers: [{ current: false }, { current: true }, { current: false }]
    })
  })

  it('names a picked server with several ways by its name, whichever way comes first', () => {
    const picked: CardSetup = { at: 'saved', live: live(LAN, 3), from: 'settings', into: 'replace' }
    const reordered = { ...book, list: [{ ...book.list[0]!, ways: [LAN, HOST] as const }, ...book.list.slice(1)] }
    expect(cardOf(picked, ONLINE, null, reordered).news).toBe('Highwing now uses the Hermes on hermes-host.')
  })
})

describe('the card while a check waits for a sign-in', () => {
  const waiting = (live: Live | null): CardSetup => ({ at: 'checking', live, target: HOST, into: 'replace', step: 'sign-in' })

  it('says under the step that the browser has the sign-in page, and that Highwing never sees the password', () => {
    expect(text(render(waiting(null)))).toContain(
      'Waiting for you to sign in to hermes-host in your browser Highwing opened the sign-in page in your browser. It never sees your password.'
    )
  })

  it('offers no Sign in in the row while a check runs, since the card runs one check at a time, and keeps Retry', () => {
    const signedOut: Link = { state: 'blocked', why: 'signed-out', message: 'Sign in to Hermes again.' }
    expect(cardOf(waiting(LIVE), signedOut, null).summary).toMatchObject({ linkMessage: 'Sign in to Hermes again.', action: null })
    expect(cardOf({ at: 'checking', live: LIVE, target: HOST, into: 'replace', step: 'save' }, signedOut, null).summary).toMatchObject({ action: null })
    expect(cardOf(waiting(LIVE), { state: 'blocked', why: 'auth', message: 'Hermes turned Highwing away.' }, null).summary)
      .toMatchObject({ action: { label: 'Retry', run: [{ do: 'reconnect', start: false }] } })
  })

  it('offers Stop waiting on a first run, which ends the check, and in Settings the Cancel that goes back to the form', () => {
    expect(buttons(render(waiting(null)))).toEqual(['Stop waiting', 'Connect'])
    expect(cardOf(waiting(null), undefined, null).editor).toMatchObject({ cancel: 'stop-waiting' })
    expect(buttons(render(waiting(LIVE)))).toEqual(['Cancel', 'Connect'])
    expect(cardOf(waiting(LIVE), undefined, null).editor).toMatchObject({ cancel: 'stop' })
  })

  it('offers no way out of a first run\'s check at a step that waits for no one', () => {
    const markup = render({ at: 'checking', live: null, target: HOST, into: 'replace', step: 'hermes' })
    expect(buttons(markup)).toEqual(['Connect'])
    expect(text(markup)).not.toContain('sign-in page')
  })
})

describe('the card for a gateway address', () => {
  const at = (url: string): Target => ({ kind: 'url', url: url as GatewayUrl })
  const segments = (markup: string) => [...markup.matchAll(/<label><input type="radio" name="[^"]+"( checked="")?\/><svg[^]*?<\/svg>([^<]*)<\/label>/g)]
    .map(([, checked, label]) => `${checked === undefined ? ' ' : 'x'} ${label}`)
  const fieldOf = (markup: string) => {
    const [, id, label] = /<label class="label" for="([^"]*)">([^<]*)<\/label>/.exec(markup)!
    return { label, input: new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(markup)![0] }
  }

  it('offers SSH, Web and This computer, and opens a new connection on SSH with its destination field', () => {
    const markup = render({ at: 'form', live: null, notice: null })
    expect(segments(markup)).toEqual(['x SSH', '  Web', '  This computer'])
    expect(fieldOf(markup)).toMatchObject({ label: 'SSH destination', input: expect.stringContaining('placeholder="192.168.1.20"') })
  })

  it('opens a saved tailnet machine on SSH, with its name in the SSH destination field', () => {
    const markup = render({ at: 'failed', live: LIVE, target: HOST, into: 'replace', failure: 'host-offline' })
    expect(segments(markup)).toEqual(['x SSH', '  Web', '  This computer'])
    expect(fieldOf(markup)).toMatchObject({ label: 'SSH destination', input: expect.stringContaining('value="hermes-host.example-tailnet.ts.net"') })
  })

  it("asks for the Webapp's address under the field, not the dashboard's", () => {
    const markup = text(render({ at: 'failed', live: null, target: at('https://hermes.example.com'), into: 'replace', failure: 'dashboard' }))
    expect(markup).toContain("The address of the gateway's Webapp, not the dashboard's.")
    expect(markup).toContain('webapp.public_url in ~/.hermes/config.yaml')
    expect(markup).toContain("the machine's own address with webapp.port, 9120 by default")
  })

  it('opens on the address being edited, in the Gateway address field', () => {
    const markup = render({ at: 'failed', live: null, target: at('https://hermes.example.com:8443'), into: 'replace', failure: 'url-unreachable' })
    expect(segments(markup)[1]).toBe('x Web')
    expect(fieldOf(markup)).toMatchObject({ label: 'Gateway address', input: expect.stringContaining('value="https://hermes.example.com:8443"') })
    expect(fieldOf(markup).input).toContain('placeholder="https://hermes.example.com"')
    expect(text(markup)).not.toContain('plain http')
  })

  it('warns under the field about a plain http address, and leaves Connect on', () => {
    const markup = render({ at: 'failed', live: LIVE, target: at('http://hermes.example.com:9120'), into: 'replace', failure: 'url-unreachable' })
    const warning = /<p class="caution" id="([^"]*)" role="status">([^<]*)<\/p>/.exec(markup)!
    expect(warning[2]).toBe(
      'This address uses plain http, so your Hermes sign-in and your chats travel unencrypted. Anyone on the network between here and hermes.example.com could read them. Use https if you can.'
    )
    expect(fieldOf(markup).input).toContain(warning[1])
    expect(markup).toContain('<button type="submit" class="btn primary">Connect</button>')
  })

  it.each(Object.keys(URL_FAILURES) as UrlFailure[])('shows the words and the fix of a check that failed as %s', failure => {
    const markup = text(render({ at: 'failed', live: null, target: at('https://hermes.example.com'), into: 'replace', failure }))
    expect(markup).toContain(URL_FAILURES[failure].words('hermes.example.com'))
    expect(markup).toContain(URL_FAILURES[failure].fix('hermes.example.com'))
  })
})
