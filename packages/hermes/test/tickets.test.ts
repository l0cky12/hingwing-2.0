import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { DialError, liveDialer } from '../src/hub'
import type { ScenarioName } from '../src/testing/fake-host'
import { ATTACH, PROBE, SERVE, type HermesArgs, type SshRun } from '../src/wire/ssh'
import { mintWith, transcribeWith, type MintOptions, type RunHermes } from '../src/wire/tickets'
import { closing, errandGateway, host, listen } from './support/host'

const failureOf = (dial: Promise<unknown>) => dial.then(
  () => { throw new Error('the dial went through') },
  (error: unknown) => (error instanceof DialError ? { kind: error.kind, message: error.message } : { threw: String(error) })
)

const out = (reply: unknown, code = 0): SshRun => ({ ok: true, code, stdout: typeof reply === 'string' ? reply : `${JSON.stringify(reply)}\n` })
const TOO_OLD = out('', 2)
const PROBED = out({ protocol: 1, purposes: ['native-http', 'interactive'], windows_service_session: false })
const ATTACHED = out({ url: 'ws://127.0.0.1:4100/api/ws', protocols: ['hermes-gateway-v1', 'hermes-gateway-ticket.bound'], endpoint: { instance_id: 'i-1' } })
const hello = (instance: string) => JSON.stringify({ type: 'hello', protocol: 1, endpoint: { instance_id: instance } })
const served = (reply: unknown, instance = 'i-1') => out(`${hello(instance)}\n${JSON.stringify(reply)}\n`)
const TICKET = served({ id: 1, ok: true, ticket: 'everyone', expires_in: 30 })

function machine(replies: { readonly probe?: readonly SshRun[]; readonly attach?: readonly SshRun[]; readonly serve?: readonly SshRun[] }, options: Partial<MintOptions> = {}) {
  const left = { probe: [...(replies.probe ?? [PROBED])], attach: [...(replies.attach ?? [ATTACHED])], serve: [...(replies.serve ?? [TICKET])] }
  const ran: { readonly args: string; readonly input: string | undefined }[] = []
  const run: RunHermes = async (args: HermesArgs, { input }) => {
    ran.push({ args: args.join(' '), input })
    const queue = args === PROBE ? left.probe : args === SERVE ? left.serve : left.attach
    const reply = queue.length > 1 ? queue.shift() : queue[0]
    if (reply === undefined) throw new Error(`no reply is scripted for ${args.join(' ')}`)
    return reply
  }
  const forwarded: string[] = []
  const mint = mintWith(run, { machine: 'hermes-host', unprobed: 'refuse', forward: async url => (forwarded.push(url), url.replace('4100', '5200')), ...options })
  return { mint, forwarded, calls: () => ran.map(call => call.args), inputs: () => ran.map(call => call.input) }
}

const [PROBE_RAN, RETRY, START, SERVE_RAN] = [PROBE, ATTACH.retry, ATTACH.start, SERVE].map(args => args.join(' ')) as [string, string, string, string]
const BOUND = { url: 'ws://127.0.0.1:5200/api/ws', protocols: ['hermes-gateway-v1', 'hermes-gateway-ticket.bound'], reach: 'profile' }

describe('mintWith', () => {
  it('dials the address attach named with the ticket --serve minted, which reaches every profile', async () => {
    const far = machine({})
    expect(await far.mint({ start: true })).toEqual({ url: 'ws://127.0.0.1:5200/api/ws', protocols: ['hermes-gateway-v1', 'hermes-gateway-ticket.everyone'], reach: 'host' })
    expect(far.calls()).toEqual([PROBE_RAN, START, SERVE_RAN])
    expect(far.inputs(), 'the one line --serve is sent').toEqual([undefined, undefined, '{"id":1,"purpose":"interactive"}\n'])
    expect(far.forwarded, 'the port is forwarded once, after the ticket is in hand').toEqual(['ws://127.0.0.1:4100/api/ws'])
  })

  it('probes once per answer, and mints a new ticket for every dial', async () => {
    const far = machine({})
    await far.mint({ start: true })
    await far.mint({ start: false })
    expect(far.calls()).toEqual([PROBE_RAN, START, SERVE_RAN, RETRY, SERVE_RAN])
  })

  it('dials with the ticket attach returned on a Hermes that lists no interactive ticket, and runs no --serve', async () => {
    const far = machine({ probe: [out({ protocol: 1, purposes: ['native-http'] })] })
    expect(await far.mint({ start: false })).toEqual(BOUND)
    expect(far.calls()).toEqual([PROBE_RAN, RETRY])
  })

  it('dials with the ticket attach returned when --serve answers unsupported_purpose after all', async () => {
    const far = machine({ serve: [served({ id: 1, ok: false, error: { code: 'unsupported_purpose', message: 'purpose must be one of: native-http' } })] })
    expect(await far.mint({ start: false })).toEqual(BOUND)
    expect(far.calls()).toEqual([PROBE_RAN, RETRY, SERVE_RAN])
  })

  it.each<[string, SshRun, object]>([
    ['whose hello is an error', out({ type: 'error', error: { code: 'absent', reason_code: null, message: 'gateway absent: not ready' } }, 5), { kind: 'not-running' }],
    ['whose gateway is draining', out({ type: 'error', error: { code: 'draining' } }, 6), { kind: 'draining' }],
    ['that would not mint the ticket', served({ id: 1, ok: false, error: { code: 'ticket_unavailable', message: 'gateway refused the ticket' } }), { kind: 'dropped' }],
    ['of another gateway than attach found', served({ id: 1, ok: true, ticket: 'everyone' }, 'i-2'), { kind: 'dropped' }],
    ['that ssh could not reach', { ok: false, why: 'unreachable' }, { kind: 'unreachable', message: "Highwing can't reach hermes-host over SSH." }],
    ['on a machine whose hermes is gone', out('', 127), { kind: 'hermes-missing', message: "Hermes isn't installed on hermes-host." }]
  ])('fails a dial on a --serve %s, and never falls back to the ticket attach returned', async (_what, serve, failure) => {
    const far = machine({ serve: [serve] })
    expect(await failureOf(far.mint({ start: false }))).toMatchObject(failure)
    expect(far.forwarded, 'nothing was dialed').toEqual([])
  })

  it('attaches again after a gateway that was replaced between attach and --serve', async () => {
    const far = machine({ serve: [served({ id: 1, ok: true, ticket: 'stale' }, 'i-0'), TICKET] })
    expect(await failureOf(far.mint({ start: false }))).toMatchObject({ kind: 'dropped' })
    expect(await far.mint({ start: false })).toMatchObject({ reach: 'host', protocols: ['hermes-gateway-v1', 'hermes-gateway-ticket.everyone'] })
    expect(far.calls()).toEqual([PROBE_RAN, RETRY, SERVE_RAN, RETRY, SERVE_RAN])
  })

  it('never starts a gateway from a Windows service session, and says where to start it', async () => {
    const far = machine({ probe: [out({ protocol: 1, purposes: ['interactive'], windows_service_session: true })], attach: [out({ state: 'absent' }, 5)] })
    expect(await failureOf(far.mint({ start: true }))).toEqual({ kind: 'not-running', message: "Hermes isn't running on hermes-host. Start it from a normal window on that machine's desktop." })
    expect(far.calls()).toEqual([PROBE_RAN, RETRY])
  })

  it('refuses a dial whose probe got no answer, and asks again on the next one', async () => {
    const far = machine({ probe: [TOO_OLD, PROBED] })
    expect(await failureOf(far.mint({ start: false }))).toEqual({ kind: 'incompatible', message: 'The Hermes on hermes-host is too old for Highwing.' })
    expect(await far.mint({ start: false })).toMatchObject({ reach: 'host' })
    expect(far.calls()).toEqual([PROBE_RAN, PROBE_RAN, RETRY, SERVE_RAN])
  })

  it('goes on with attach alone after a probe that got no answer, where the route says so', async () => {
    const far = machine({ probe: [TOO_OLD] }, { unprobed: 'attach' })
    expect(await far.mint({ start: true })).toEqual(BOUND)
    expect(await far.mint({ start: false })).toEqual(BOUND)
    expect(far.calls(), 'no --serve, and the probe is asked again').toEqual([PROBE_RAN, START, PROBE_RAN, RETRY])
  })

  it.each([
    [2, 'incompatible'], [3, 'incompatible'], [4, 'auth'], [5, 'not-running'], [6, 'draining'], [7, 'inaccessible'], [9, 'inaccessible']
  ])('reads exit code %i of `hermes gateway attach` as %s', async (code, kind) => {
    expect(await failureOf(machine({ attach: [out({ state: 'absent', message: 'gateway absent' }, code)] }).mint({ start: false }))).toMatchObject({ kind })
  })

  it('reads an attach that names no address as incompatible', async () => {
    expect(await failureOf(machine({ attach: [out('ready\n')] }).mint({ start: false }))).toMatchObject({ kind: 'incompatible' })
  })
})

describe('liveDialer, against the fake hermes of this computer', () => {
  const dialed = async (name: ScenarioName) => {
    const listening = await listen(errandGateway())
    const here = await host(name, listening)
    const socket = await liveDialer({ hermesBin: here.hermes })({ start: true })
    socket.close()
    return { reach: socket.reach, calls: here.calls, upgrades: listening.upgrades }
  }

  it('opens a socket that reaches every profile, on the ticket --serve minted', async () => {
    expect(await dialed('ok')).toEqual({
      reach: 'host',
      calls: ['gateway tickets --probe --json', 'gateway attach --json --start --timeout 75', 'gateway tickets --serve --json'],
      upgrades: [{ origin: null, ticket: 1, refused: null }]
    })
  })

  it('opens a socket bound to one profile on a Hermes that mints no interactive ticket', async () => {
    expect(await dialed('ok-bound')).toMatchObject({ reach: 'profile', calls: ['gateway tickets --probe --json', 'gateway attach --json --start --timeout 75'] })
  })

  it('still dials a Hermes too old to probe, with attach alone', async () => {
    expect(await dialed('hermes-too-old')).toMatchObject({ reach: 'profile', calls: ['gateway tickets --probe --json', 'gateway attach --json --start --timeout 75'] })
  })

  it('reads a missing hermes command as hermes-missing, and no gateway as not-running', async () => {
    const gone = await host('hermes-not-found')
    expect(await failureOf(liveDialer({ hermesBin: gone.hermes })({ start: false })), 'in the words the banner had before the probe').toEqual({ kind: 'hermes-missing', message: "Highwing can't find the hermes command." })
    const idle = await host('ok')
    expect(await failureOf(liveDialer({ hermesBin: idle.hermes })({ start: false }))).toMatchObject({ kind: 'not-running' })
  })
})

describe('transcribeWith', () => {
  const RECORDING = { mime: 'audio/webm;codecs=opus', audio: new Uint8Array([1, 2, 3]) }
  const NATIVE = out(`${JSON.stringify({ type: 'hello', protocol: 1, endpoint: { api_origin: 'http://127.0.0.1:4100', instance_id: 'i-1' } })}\n${JSON.stringify({ id: 1, ok: true, ticket: 'speech' })}\n`)

  /** A gateway's HTTP listener that answers every upload with `status` and `body`, and keeps what each request carried. */
  const listener = async (status: number, body: unknown) => {
    const asked: { readonly headers: IncomingHttpHeaders; readonly body: unknown }[] = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        asked.push({ headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
        response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    closing(server, held => held.close())
    return { asked, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
  }

  const transcriber = (serve: SshRun, origin: string) => {
    const ran: (string | undefined)[] = []
    const reached: string[] = []
    const transcribe = transcribeWith(async (args, { input }) => (ran.push(`${args.join(' ')} <- ${input?.trim()}`), serve), async from => (reached.push(from), origin))
    return { transcribe, ran, reached }
  }

  it("posts the recording with a fresh native-http ticket to the origin the hello named, and answers Hermes's text", async () => {
    const gateway = await listener(200, { ok: true, transcript: ' book a table for two ', provider: 'local' })
    const { transcribe, ran, reached } = transcriber(NATIVE, gateway.origin)
    expect(await transcribe(RECORDING)).toEqual({ ok: true, value: 'book a table for two' })
    expect(ran).toEqual([`${SERVE_RAN} <- {"id":1,"purpose":"native-http"}`])
    expect(reached).toEqual(['http://127.0.0.1:4100'])
    const [{ headers, body }] = gateway.asked as [(typeof gateway.asked)[number]]
    expect(headers['x-hermes-gateway-ticket']).toBe('speech')
    expect(headers.origin, 'the gate refuses a ticket that comes with an Origin').toBeUndefined()
    expect(body).toEqual({ data_url: 'data:audio/webm;codecs=opus;base64,AQID', mime_type: 'audio/webm;codecs=opus' })
  })

  it("passes on Hermes's own words when it cannot transcribe", async () => {
    const gateway = await listener(400, { detail: 'No STT provider available' })
    expect(await transcriber(NATIVE, gateway.origin).transcribe(RECORDING)).toEqual({
      ok: false, refusal: { kind: 'rejected', message: "Hermes couldn't turn that into text. No STT provider available." }
    })
  })

  it.each([
    ['a Hermes that mints no native-http ticket', served({ id: 1, ok: false, error: { code: 'unsupported_purpose' } }), 'unsupported'],
    ['no gateway running', out('{"type": "error", "error": {"code": "absent"}}\n', 5), 'offline'],
    ['a machine that cannot be reached', { ok: false, why: 'unreachable' } as SshRun, 'offline']
  ] as const)('refuses in plain words for %s, and posts nothing', async (_, serve, kind) => {
    const { transcribe, reached } = transcriber(serve, 'http://127.0.0.1:1')
    expect(await transcribe(RECORDING)).toMatchObject({ ok: false, refusal: { kind } })
    expect(reached).toEqual([])
  })

  it('answers that Hermes could not be reached when the post fails', async () => {
    expect(await transcriber(NATIVE, 'http://127.0.0.1:1').transcribe(RECORDING)).toMatchObject({ ok: false, refusal: { kind: 'offline' } })
  })
})
