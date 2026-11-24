/**
 * A machine for tests to reach: fake `ssh`, `tailscale` and `hermes` executables in a temp bin
 * directory. Each is a Node script that asks this process what to print and how to exit, so no
 * real ssh, Tailscale or Hermes ever runs. A fake attach mints from the `loopback()` scripted
 * gateway, which refuses an `Origin` header and a reused ticket as the real one does.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hostPart, parseSshHost, type CheckFailure, type SshHost } from '../domain/reach'
import { TICKET_PREFIX } from '../wire/link'
import type { Loopback } from './loopback'

export const FAKE_HOST = parseSshHost('hermes-host.example-tailnet.ts.net') as SshHost

/** What one run of a tool prints, and the code it exits with. `never`: it waits to be killed. */
interface Said {
  readonly stdout?: string
  readonly stderr?: string
  readonly exit: number | 'never'
}

/** A tool that prints, then reads one line of its stdin and goes on with what `then` says to it. */
interface Asks extends Omit<Said, 'exit'> { then(line: string): Said }

interface Scenario {
  /** What `tailscale status --json` says. null: the bin directory has no `tailscale`, a real ENOENT. */
  readonly tailscale: Said | null
  /** What ssh itself says. `through`: it reaches the machine and runs the command. null: no `ssh`. */
  readonly ssh: Said | 'through' | null
  /** The Hermes of both machines. `bound` mints no `interactive` ticket. `old` predates `gateway tickets`. null: none is installed. */
  readonly hermes: 'current' | 'bound' | 'old' | null
  /** What `checkTarget` makes of the far machine. null: it passes. */
  readonly verdict: CheckFailure | null
}

const status = (backend: string, peer: { readonly online: boolean } | null): Said => ({
  exit: 0,
  stdout: JSON.stringify({
    BackendState: backend,
    Peer: peer === null ? {} : {
      'nodekey:fake': { DNSName: `${hostPart(FAKE_HOST)}.`, HostName: 'hermes-host', TailscaleIPs: ['100.101.102.103'], Online: peer.online }
    }
  }, null, 2)
})

const REACHABLE = { tailscale: status('Running', { online: true }), ssh: 'through', hermes: 'current' } as const
const refusing = (stderr: string, exit: Said['exit'] = 255) => ({ ...REACHABLE, ssh: { stderr, exit } })

/** One row per way a check can end. A new `CheckFailure` does not compile until it has a row here. */
export const SCENARIOS: Readonly<Record<CheckFailure | 'ok' | 'ok-bound' | 'slow', Scenario>> = {
  ok: { ...REACHABLE, verdict: null },
  /** A Hermes that passes the check and whose sockets reach only the profile attach ran in. */
  'ok-bound': { ...REACHABLE, hermes: 'bound', verdict: null },
  /** The far machine never answers, so ssh sits silent until its deadline. */
  slow: { ...refusing('', 'never'), verdict: 'unreachable' },
  'tailscale-missing': { ...REACHABLE, tailscale: null, verdict: 'tailscale-missing' },
  'tailscale-off': { ...REACHABLE, tailscale: status('Stopped', null), verdict: 'tailscale-off' },
  'tailscale-signed-out': { ...REACHABLE, tailscale: status('NeedsLogin', null), verdict: 'tailscale-signed-out' },
  'host-not-found': { ...REACHABLE, tailscale: status('Running', null), verdict: 'host-not-found' },
  'host-offline': { ...REACHABLE, tailscale: status('Running', { online: false }), verdict: 'host-offline' },
  unreachable: { ...refusing(`ssh: connect to host ${hostPart(FAKE_HOST)} port 22: Connection timed out\r\n`), verdict: 'unreachable' },
  'ssh-missing': { ...REACHABLE, ssh: null, verdict: 'ssh-missing' },
  'ssh-denied': { ...refusing(`${FAKE_HOST}: Permission denied (publickey).\r\n`), verdict: 'ssh-denied' },
  /** Tailscale's check mode prints a link and waits for the browser. It does not fail. */
  'ssh-check': {
    ...refusing('# Tailscale SSH requires an additional check.\n# To authenticate, visit: https://login.tailscale.com/a/0123456789abcdef\n', 'never'),
    verdict: 'ssh-check'
  },
  'host-changed': {
    ...refusing('@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\r\nOffending ED25519 key in known_hosts:3\r\nHost key verification failed.\r\n'),
    verdict: 'host-changed'
  },
  'hermes-not-found': { ...REACHABLE, hermes: null, verdict: 'hermes-not-found' },
  'hermes-too-old': { ...REACHABLE, hermes: 'old', verdict: 'hermes-too-old' },
  /** The machine is fine. The save that follows the check is what fails, and the owner of the settings file makes it fail. */
  'cant-save': { ...REACHABLE, verdict: null }
}

export type ScenarioName = keyof typeof SCENARIOS

/** A moment a tool can be held at: `tailscale status`, the probe over ssh, an attach, or a relay's first byte. */
export type Hold = 'tailscale' | 'ssh' | 'attach' | 'relay'

export interface FakeHost {
  /** The directory of the fake tools. Used as the whole PATH, it makes a tool the scenario lacks a real ENOENT. */
  readonly bin: string
  readonly ssh: string
  readonly tailscale: string
  readonly hermes: string
  /** Every hermes command that ran, on either machine, and every relay as `relay <port>`, in order. */
  readonly calls: readonly string[]
  /** How many times a tool has finished printing something it was told to print. */
  readonly printed: number
  /** The pids of the fake tools that are still alive. */
  running(): number[]
  /** Lets every held tool go on, and holds none from then on. */
  release(): void
  /** The gateway restarted. Its next attach names another port. */
  moveTo(gateway: Gateway | null): void
  close(): Promise<void>
}

/** Where the fake machine's Hermes gets its tickets. */
export type Gateway = Pick<Loopback, 'mint' | 'instanceId'>

const TOOLS = ['ssh', 'tailscale', 'hermes'] as const
type Tool = (typeof TOOLS)[number]
type Order = readonly [verb: 'stdout' | 'stderr' | 'exit' | 'pipe' | 'ask', value: string | number]
interface Asked { readonly tool: Tool; readonly argv: readonly string[]; readonly pid: number }
interface Answer { readonly at: Hold | null; say(): Said | Asks | { readonly pipe: number } }

/**
 * The script of every fake tool. It runs the orders this process sends it over a loopback socket,
 * one JSON line each and one at a time, and answers an empty line when it has printed what an
 * order said. `ask` answers the first line of the tool's stdin instead, as a JSON string.
 */
const toolScript = (tool: Tool, port: number) => `#!${process.execPath}
const net = require('node:net')
const control = net.connect(${port}, '127.0.0.1')
const printed = () => control.write('\\n')
const run = {
  stdout: text => new Promise(done => process.stdout.write(text, done)).then(printed),
  stderr: text => new Promise(done => process.stderr.write(text, done)).then(printed),
  exit: code => {
    process.exitCode = code
    control.end()
  },
  pipe: port => {
    const far = net.connect(port, '127.0.0.1')
    far.on('error', () => process.exit(255))
    far.on('close', () => process.exit(0))
    process.stdin.pipe(far).pipe(process.stdout)
  },
  ask: () => new Promise(done => {
    let held = ''
    const line = () => done(held.split('\\n')[0])
    process.stdin.setEncoding('utf8').on('end', line).on('data', chunk => {
      held += chunk
      if (held.includes('\\n')) line()
    })
  }).then(line => control.write(JSON.stringify(line) + '\\n'))
}
let text = ''
let last = Promise.resolve()
control.setEncoding('utf8')
control.on('data', chunk => {
  text += chunk
  for (let end = text.indexOf('\\n'); end !== -1; end = text.indexOf('\\n')) {
    const [verb, value] = JSON.parse(text.slice(0, end))
    text = text.slice(end + 1)
    last = last.then(() => run[verb](value))
  }
})
control.write(JSON.stringify({ tool: ${JSON.stringify(tool)}, argv: process.argv.slice(2), pid: process.pid }) + '\\n')
`

const probeReply = (purposes: readonly string[]) => `${JSON.stringify({ protocol: 1, purposes, windows_service_session: false })}\n`
/** The ticket purposes each Hermes mints (hermes_cli/gateway_runtime_tickets.py:26). An older one lists `native-http` alone. */
const PURPOSES = { current: ['native-http', 'interactive'], bound: ['native-http'] } as const
const UNKNOWN_COMMAND: Said = { stderr: "hermes gateway: error: argument gateway_command: invalid choice: 'tickets'\n", exit: 2 }
const ABSENT: Said = { stdout: '{"state":"absent","message":"gateway absent: not ready"}\n', exit: 5 }
/** The first line of `--serve` with no gateway to use, and its exit code (gateway-ssh-clients.md, "First line"). */
const SERVE_ABSENT: Said = { stdout: '{"type":"error","error":{"code":"absent","reason_code":null,"message":"gateway absent: not ready"}}\n', exit: 5 }
/** The far machine as ssh hands it a command: `sh -c '<a script with no quote in it>' hermes <args>`. */
const REMOTE_HERMES = /^sh -c '[^']+' hermes (.+)$/

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function sshCall(argv: readonly string[]): { readonly host: string | undefined; readonly forward: string | null; readonly command: string } {
  const rest: string[] = []
  let forward: string | null = null
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string
    if (arg === '-o') index++
    else if (arg === '-W') forward = argv[++index] ?? null
    else rest.push(arg)
  }
  return { host: rest[0], forward, command: rest.slice(1).join(' ') }
}

/**
 * Starts the fake machine. `gateway` is where an attach mints its ticket. null: no gateway runs.
 * `holdAt` keeps every tool that reaches that moment waiting until `release()`, which pins a
 * passing state (a check in flight, a pending attach, a stalled upgrade) without a sleep.
 */
export async function fakeHost(name: ScenarioName, gateway: Gateway | null, options: { readonly holdAt?: Hold } = {}): Promise<FakeHost> {
  const scenario = SCENARIOS[name]
  const calls: string[] = []
  const pids = new Set<number>()
  const controls = new Set<Socket>()
  const tunnels = new Map<number, number>()
  const waiting: (() => void)[] = []
  let holding = options.holdAt ?? null
  let printed = 0
  let serving = gateway

  /** The ticket attach returns reaches the profile attach ran in (gateway-ssh-clients.md, "The WebSocket ticket"). */
  const attach = (reach: 'direct' | 'tunnel'): Said => {
    if (serving === null) return ABSENT
    const { url, protocols } = serving.mint('profile')
    const reply = (address: string) => ({ stdout: `${JSON.stringify({ url: address, protocols, endpoint: { instance_id: serving?.instanceId } })}\n`, exit: 0 })
    if (reach === 'direct') return reply(url)
    // A port only this fake's `ssh -W` can resolve, so a client that skips the tunnel reaches nothing.
    const hidden = tunnels.size + 1
    tunnels.set(hidden, Number(new URL(url).port))
    return reply(`ws://127.0.0.1:${hidden}/api/ws`)
  }

  /** `_reply` in hermes_cli/gateway_runtime_tickets.py:79-119, for the one purpose Highwing asks for. */
  const ticket = (line: string, purposes: readonly string[]): Said => {
    const { id, purpose } = JSON.parse(line) as { readonly id?: unknown; readonly purpose?: unknown }
    const refuse = (code: string) => ({ id, ok: false, error: { code, message: 'the fake host mints interactive tickets only' } })
    const reply = !purposes.includes(String(purpose))
      ? refuse('unsupported_purpose')
      : purpose !== 'interactive' || serving === null
        ? refuse('ticket_unavailable')
        : { id, ok: true, ticket: (serving.mint('host').protocols[1] as string).slice(TICKET_PREFIX.length), expires_in: 30 }
    return { stdout: `${JSON.stringify(reply)}\n`, exit: 0 }
  }

  const serve = (purposes: readonly string[]): Said | Asks => {
    if (serving === null) return SERVE_ABSENT
    return { stdout: `${JSON.stringify({ type: 'hello', protocol: 1, endpoint: { instance_id: serving.instanceId } })}\n`, then: line => ticket(line, purposes) }
  }

  const hermes = (args: string, reach: 'direct' | 'tunnel'): Answer => {
    calls.push(args)
    const purposes = scenario.hermes === 'current' || scenario.hermes === 'bound' ? PURPOSES[scenario.hermes] : null
    if (args === 'gateway tickets --probe --json') return { at: reach === 'tunnel' ? 'ssh' : null, say: () => (purposes === null ? UNKNOWN_COMMAND : { stdout: probeReply(purposes), exit: 0 }) }
    if (args === 'gateway tickets --serve --json' && purposes !== null) return { at: null, say: () => serve(purposes) }
    if (args.startsWith('gateway attach --json ')) return { at: 'attach', say: () => attach(reach) }
    return { at: null, say: () => UNKNOWN_COMMAND }
  }

  const ssh = (argv: readonly string[]): Answer => {
    const { host, forward, command } = sshCall(argv)
    const refuse = (said: Said): Answer => ({ at: forward === null ? 'ssh' : null, say: () => said })
    if (scenario.ssh !== 'through' && scenario.ssh !== null) return refuse(scenario.ssh)
    if (host === undefined || hostPart(host as SshHost) !== hostPart(FAKE_HOST)) return refuse({ stderr: `ssh: Could not resolve hostname ${host}: Name or service not known\r\n`, exit: 255 })
    if (forward !== null) {
      const hidden = Number(forward.split(':')[1])
      const port = tunnels.get(hidden)
      calls.push(`relay ${hidden}`)
      return { at: 'relay', say: () => (port === undefined ? { stderr: 'channel 0: open failed: connect failed: Connection refused\r\n', exit: 255 } : { pipe: port }) }
    }
    const args = REMOTE_HERMES.exec(command)?.[1]
    if (args === undefined) return refuse({ stderr: 'sh: this fake runs only the hermes locator\n', exit: 126 })
    return scenario.hermes === null ? refuse({ exit: 127 }) : hermes(args, 'tunnel')
  }

  const answers: Readonly<Record<Tool, (argv: readonly string[]) => Answer>> = {
    ssh,
    tailscale: () => ({ at: 'tailscale', say: () => scenario.tailscale ?? { exit: 127 } }),
    hermes: argv => hermes(argv.join(' '), 'direct')
  }

  const ordersOf = (said: Said | Asks | { readonly pipe: number }): Order[] => {
    if ('pipe' in said) return [['pipe', said.pipe]]
    return [
      ...(said.stderr === undefined ? [] : [['stderr', said.stderr] as const]),
      ...(said.stdout === undefined ? [] : [['stdout', said.stdout] as const]),
      ...('then' in said ? [['ask', 0] as const] : said.exit === 'never' ? [] : [['exit', said.exit] as const])
    ]
  }

  const order = (socket: Socket, said: ReturnType<Answer['say']>): Asks['then'] | null => {
    if (!socket.destroyed) for (const next of ordersOf(said)) socket.write(`${JSON.stringify(next)}\n`)
    return 'then' in said ? said.then : null
  }

  const run = async (socket: Socket, asked: Asked) => {
    pids.add(asked.pid)
    const answer = answers[asked.tool](asked.argv)
    if (answer.at !== null && answer.at === holding) await new Promise<void>(resolve => waiting.push(resolve))
    return order(socket, answer.say())
  }

  const server = createServer(socket => {
    controls.add(socket)
    let text = ''
    let running: Promise<Asks['then'] | null> | null = null
    socket.setEncoding('utf8')
    socket.on('error', () => {})
    socket.on('close', () => void controls.delete(socket))
    socket.on('data', (chunk: string) => {
      text += chunk
      for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n')) {
        const line = text.slice(0, end)
        text = text.slice(end + 1)
        // The first line is what the tool was asked to do. An empty one says it finished printing, and any other is the line it read.
        if (running === null) running = run(socket, JSON.parse(line) as Asked)
        else if (line === '') printed++
        else running = running.then(then => (then === null ? null : order(socket, then(JSON.parse(line) as string))))
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  const bin = mkdtempSync(join(tmpdir(), 'highwing-fake-host-'))
  for (const tool of TOOLS) if (scenario[tool] !== null) writeFileSync(join(bin, tool), toolScript(tool, port), { mode: 0o755 })

  return {
    bin, calls,
    get printed() { return printed },
    ssh: join(bin, 'ssh'), tailscale: join(bin, 'tailscale'), hermes: join(bin, 'hermes'),
    running: () => [...pids].filter(alive),
    release: () => {
      holding = null
      for (const go of waiting.splice(0)) go()
    },
    moveTo: next => { serving = next },
    close: () => new Promise(resolve => {
      for (const socket of controls) socket.destroy()
      server.close(() => {
        rmSync(bin, { recursive: true, force: true })
        resolve()
      })
    })
  }
}
