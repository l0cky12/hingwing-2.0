import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSshHost } from '../src/domain/reach'
import { ASK_INTERACTIVE, ATTACH, attachedOf, HERMES_PATHS, PROBE, probeOf, READ_CAP, relay, remoteHermes, runTool, SERVE, servedOf, SSH_OPTIONS, sshFailureOf, sshRead } from '../src/wire/ssh'
import { manualClock, settle } from '../src/testing/clock'

describe('sshFailureOf', () => {
  it.each([
    ['ssh: Could not resolve hostname hermes-host: Name or service not known', 'unreachable'],
    ['ssh: connect to host hermes-host port 22: Connection refused', 'unreachable'],
    ['kex_exchange_identification: Connection closed by remote host', 'unreachable'],
    ['', 'unreachable'],
    ['ada@hermes-host: Permission denied (publickey).', 'ssh-denied'],
    ['Received disconnect from 100.101.102.103 port 22:2: Too many authentication failures', 'ssh-denied'],
    ['# Tailscale SSH requires an additional check.\n# To authenticate, visit: https://login.tailscale.com/a/0123456789abcdef', 'ssh-check'],
    ['@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @\nHost key verification failed.', 'host-changed']
  ])('reads %j as %s', (stderr, failure) => {
    expect(sshFailureOf(stderr)).toBe(failure)
  })

  it('reads the host-key banner first, though it also names a key type and a denied login', () => {
    const banner = 'Offending ED25519 key in /home/ada/.ssh/known_hosts:3\nPassword authentication is disabled to avoid man-in-the-middle attacks.\nPermission denied (publickey).'
    expect(sshFailureOf(banner)).toBe('host-changed')
  })

  it('reads a check that also ended in a denied login as the check', () => {
    expect(sshFailureOf('# To authenticate, visit: https://login.tailscale.com/a/0123456789abcdef\nPermission denied (publickey).')).toBe('ssh-check')
  })
})

describe('probeOf', () => {
  it.each([
    [0, '{"protocol": 1, "purposes": ["native-http"], "windows_service_session": false}\n', { ok: true, windowsServiceSession: false, interactive: false }],
    [0, 'a banner from the shell profile\n{"protocol": 1, "purposes": [], "windows_service_session": true}\n', { ok: true, windowsServiceSession: true, interactive: false }],
    [0, '{"protocol": 1, "purposes": ["native-http", "interactive"], "later_key": 1}\n', { ok: true, windowsServiceSession: false, interactive: true }],
    [0, '{"protocol": 1, "purposes": "interactive"}\n', { ok: true, windowsServiceSession: false, interactive: false }],
    [0, '["interactive"]\n', { ok: false, failure: 'hermes-too-old' }],
    [127, '', { ok: false, failure: 'hermes-not-found' }],
    [2, '', { ok: false, failure: 'hermes-too-old' }],
    [1, '{"protocol": 1}\n', { ok: false, failure: 'hermes-too-old' }],
    [0, 'usage: hermes gateway\n', { ok: false, failure: 'hermes-too-old' }],
    [0, '', { ok: false, failure: 'hermes-too-old' }],
    [0, '7\n', { ok: false, failure: 'hermes-too-old' }]
  ])('reads exit %i with %j', (code, stdout, probe) => {
    expect(probeOf(code, stdout)).toEqual(probe)
  })
})

describe('attachedOf', () => {
  const reply = { url: 'ws://127.0.0.1:35187/api/ws', protocols: ['hermes-gateway-v1', 'hermes-gateway-ticket.t'], endpoint: { instance_id: 'i-1', profile_id: '/home' }, state: 'ready' }

  it('reads the address, the subprotocols and the gateway instance from the last line', () => {
    expect(attachedOf(`a banner\n${JSON.stringify(reply)}\n`)).toEqual({ url: reply.url, protocols: reply.protocols, instanceId: 'i-1' })
  })

  it('reads a reply that names no instance, as a Hermes older than the endpoint field sends', () => {
    expect(attachedOf(JSON.stringify({ url: reply.url, protocols: reply.protocols }))).toEqual({ url: reply.url, protocols: reply.protocols, instanceId: null })
  })

  it.each(['ready\n', '', '{"url": 7, "protocols": []}', '{"url": "ws://x", "protocols": [1]}', '{"state":"absent"}'])('reads %j as no reply', stdout => {
    expect(attachedOf(stdout)).toBeNull()
  })
})

describe('servedOf', () => {
  const hello = '{"type": "hello", "protocol": 1, "endpoint": {"api_origin": "http://127.0.0.1:35187", "instance_id": "i-1"}}'
  const absent = '{"type": "error", "error": {"code": "absent", "reason_code": null, "message": "gateway absent: not ready"}}'

  it.each([
    [0, `${hello}\n{"id": 1, "ok": true, "ticket": "t-1", "expires_in": 30}\n`, { is: 'ticket', ticket: 't-1', instanceId: 'i-1' }],
    [0, `{"type": "hello", "protocol": 1}\n{"id": 1, "ok": true, "ticket": "t-1"}\n`, { is: 'ticket', ticket: 't-1', instanceId: null }],
    [0, `${hello}\n{"id": 1, "ok": false, "error": {"code": "unsupported_purpose", "message": "purpose must be one of: native-http"}}\n`, { is: 'unsupported' }],
    [0, `${hello}\n{"id": 1, "ok": false, "error": {"code": "ticket_unavailable", "message": "gateway refused the ticket"}}\n`, { is: 'failed', kind: 'dropped' }],
    [0, `${hello}\n{"id": null, "ok": false, "error": {"code": "invalid_request", "message": "request line is not JSON"}}\n`, { is: 'failed', kind: 'dropped' }],
    [0, `${hello}\n`, { is: 'failed', kind: 'dropped' }],
    [0, `${hello}\n{"id": 1, "ok": true, "ticket": ""}\n`, { is: 'failed', kind: 'dropped' }],
    [5, `${absent}\n`, { is: 'failed', kind: 'not-running' }],
    [6, '{"type": "error", "error": {"code": "draining"}}\n', { is: 'failed', kind: 'draining' }],
    [9, `${absent}\n`, { is: 'failed', kind: 'inaccessible' }],
    [2, '', { is: 'failed', kind: 'incompatible' }],
    [0, 'usage: hermes gateway\n', { is: 'failed', kind: 'incompatible' }]
  ])('reads exit %i with %j', (code, stdout, served) => {
    expect(servedOf(code, stdout)).toEqual(served)
  })

  it('asks for the one ticket that takes no profile, on one line', () => {
    expect(JSON.parse(ASK_INTERACTIVE)).toEqual({ id: 1, purpose: 'interactive' })
    expect(ASK_INTERACTIVE.endsWith('\n') && ASK_INTERACTIVE.indexOf('\n') === ASK_INTERACTIVE.length - 1).toBe(true)
  })
})

describe('the command ssh is given', () => {
  it('names Hermes\'s install locations in its order, after the login shell\'s own hermes', () => {
    expect(HERMES_PATHS).toEqual(['$HOME/.local/bin/hermes', '/usr/local/bin/hermes', '$HOME/.hermes/hermes-agent/venv/bin/hermes'])
    expect(remoteHermes(PROBE)).toContain('for hermes in "$found" "$HOME/.local/bin/hermes" "/usr/local/bin/hermes" "$HOME/.hermes/hermes-agent/venv/bin/hermes";')
  })

  it.each([PROBE, SERVE, ATTACH.start, ATTACH.retry])('is one single-quoted script and the literal words %j', (...args) => {
    const command = remoteHermes(args as typeof PROBE)
    expect(command).toMatch(new RegExp(`^sh -c '[^'\\\\]+' hermes ${args.join(' ')}$`))
  })

  it('never lets ssh ask a question or wait for ever', () => {
    expect(SSH_OPTIONS.join(' ')).toBe('-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3')
  })
})

/**
 * The locator runs for real in `sh`, as the far machine's sshd would run it, but only ever against
 * stand-ins: the candidate paths are temp files, and `bash` is a stub ahead of the real one on PATH.
 */
describe('the locator, run by sh on a machine of stand-ins', () => {
  const machine = (loginShellFinds: 'its-own' | 'nothing' | 'an-alias') => {
    const root = mkdtempSync(join(tmpdir(), 'highwing-locator-'))
    const stub = (path: string, body: string) => {
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
      return path
    }
    const hermes = (where: string) => stub(join(root, where, 'hermes'), `echo "${where}: $*"; exit 4`)
    const found = { 'its-own': `echo "a profile banner"; echo "${join(root, 'login', 'hermes')}"`, nothing: 'exit 1', 'an-alias': "echo \"alias hermes='hermes -p work'\"" }[loginShellFinds]
    stub(join(root, 'bin', 'bash'), found)
    const run = (paths: readonly string[]) => {
      try {
        return { code: 0, stdout: execFileSync('/bin/sh', ['-c', remoteHermes(PROBE, paths)], { encoding: 'utf8', env: { HOME: join(root, 'home'), PATH: `${join(root, 'bin')}:/usr/bin:/bin` } }) }
      } catch (error) {
        const { status, stdout } = error as { readonly status: number; readonly stdout: string }
        return { code: status, stdout }
      }
    }
    return { root, hermes, run }
  }

  it('runs the hermes of the login shell, with the words unchanged and its exit code', () => {
    const { root, hermes, run } = machine('its-own')
    hermes('login')
    hermes('installed')
    expect(run([join(root, 'installed', 'hermes')])).toEqual({ code: 4, stdout: 'login: gateway tickets --probe --json\n' })
  })

  it('falls back to the first install location that holds an executable', () => {
    const { root, hermes, run } = machine('nothing')
    hermes('second')
    hermes('third')
    writeFileSync(join(root, 'first-is-not-executable'), '')
    expect(run([join(root, 'first-is-not-executable'), join(root, 'second', 'hermes'), join(root, 'third', 'hermes')]))
      .toEqual({ code: 4, stdout: 'second: gateway tickets --probe --json\n' })
  })

  it('reads a path under the home directory', () => {
    const { hermes, run } = machine('nothing')
    hermes('home/.local/bin')
    expect(run(['$HOME/.local/bin/hermes'])).toEqual({ code: 4, stdout: 'home/.local/bin: gateway tickets --probe --json\n' })
  })

  it('skips a login shell answer that is not a file', () => {
    const { root, hermes, run } = machine('an-alias')
    hermes('installed')
    expect(run([join(root, 'installed', 'hermes')])).toEqual({ code: 4, stdout: 'installed: gateway tickets --probe --json\n' })
  })

  it('exits 127 when no location holds a hermes', () => {
    const { root, run } = machine('nothing')
    expect(run([join(root, 'nowhere', 'hermes')])).toEqual({ code: 127, stdout: '' })
  })
})

describe('runTool', () => {
  const never = new AbortController().signal

  it('returns the exit code and both streams', async () => {
    expect(await runTool('/bin/sh', ['-c', 'echo out; echo err >&2; exit 3'], { deadlineMs: 5_000, signal: never }))
      .toEqual({ end: 'exit', code: 3, stdout: 'out\n', stderr: 'err\n' })
  })

  it('writes its input to the command and closes it, and gives a command with none an empty stdin', async () => {
    expect(await runTool('/bin/sh', ['-c', 'cat; echo end'], { deadlineMs: 5_000, signal: never, input: 'one line\n' })).toMatchObject({ end: 'exit', code: 0, stdout: 'one line\nend\n' })
    expect(await runTool('/bin/sh', ['-c', 'cat; echo end'], { deadlineMs: 5_000, signal: never })).toMatchObject({ end: 'exit', code: 0, stdout: 'end\n' })
    expect(await runTool('/bin/sh', ['-c', 'exit 4'], { deadlineMs: 5_000, signal: never, input: 'x'.repeat(1 << 20) }), 'a command that never reads it').toMatchObject({ end: 'exit', code: 4 })
  })

  it('reads a command that is not there as missing', async () => {
    expect(await runTool(join(tmpdir(), 'no-such-tool'), [], { deadlineMs: 5_000, signal: never })).toEqual({ end: 'missing' })
  })

  it('kills a command at its deadline and keeps what it wrote to stderr', async () => {
    const clock = manualClock()
    const wrote = join(mkdtempSync(join(tmpdir(), 'highwing-tool-')), 'wrote')
    const run = runTool('/bin/sh', ['-c', `echo waiting >&2; : > ${wrote}; exec sleep 60`], { deadlineMs: 20_000, signal: never, clock })
    while (!existsSync(wrote)) await settle()
    await clock.advance(19_999)
    await clock.advance(1)
    expect(await run).toEqual({ end: 'cut', stderr: 'waiting\n' })
  })

  it('kills a command when its signal aborts, and starts none after', async () => {
    const life = new AbortController()
    const run = runTool('/bin/sh', ['-c', 'exec sleep 60'], { deadlineMs: 60_000, signal: life.signal })
    life.abort()
    expect(await run).toEqual({ end: 'cut', stderr: '' })
    expect(await runTool('/bin/sh', ['-c', 'echo ran'], { deadlineMs: 5_000, signal: life.signal })).toEqual({ end: 'cut', stderr: '' })
  })
})

describe('sshRead, through an ssh that runs its command with sh', () => {
  const root = mkdtempSync(join(tmpdir(), 'highwing-read-'))
  const ssh = join(root, 'ssh')
  writeFileSync(ssh, '#!/bin/sh\nfor arg; do last=$arg; done\nexec /bin/sh -c "$last"\n', { mode: 0o755 })
  const host = parseSshHost('hermes-host')!
  const read = (path: string, sshBin = ssh) => sshRead(host, path, { sshBin, deadlineMs: 5_000, signal: new AbortController().signal })

  it('reads a file whose path a shell would expand, and runs none of it', async () => {
    const page = join(root, "it's $(touch pwned) `touch pwned`.html")
    writeFileSync(page, '<title>Report</title>\n')
    expect(await read(page)).toEqual({ ok: true, text: '<title>Report</title>\n' })
    expect(existsSync(join(root, 'pwned'))).toBe(false)
  })

  it('says missing for no file, a folder, or a path no line can carry', async () => {
    expect(await read(join(root, 'gone.html'))).toEqual({ ok: false, why: 'missing' })
    expect(await read(root)).toEqual({ ok: false, why: 'missing' })
    expect(await read(`${join(root, 'a')}\n${join(root, 'b')}`, join(root, 'no-ssh'))).toEqual({ ok: false, why: 'missing' })
  })

  it('refuses a file over the cap', async () => {
    const big = join(root, 'big.html')
    writeFileSync(big, 'x'.repeat(READ_CAP + 1))
    expect(await read(big)).toEqual({ ok: false, why: 'too-big' })
  })

  it('names what ssh itself failed at', async () => {
    const denied = join(root, 'denied')
    writeFileSync(denied, '#!/bin/sh\necho "hermes-host: Permission denied (publickey)." >&2\nexit 255\n', { mode: 0o755 })
    expect(await read(join(root, 'x.html'), denied)).toEqual({ ok: false, why: 'ssh-denied' })
    expect(await read(join(root, 'x.html'), join(root, 'no-ssh'))).toEqual({ ok: false, why: 'ssh-missing' })
  })
})

describe('relay', () => {
  it('settles when the route is disposed before the relay is listening', async () => {
    const life = new AbortController()
    const pending = relay(parseSshHost('hermes-host.example-tailnet.ts.net')!, 1, { sshBin: '/nonexistent/ssh', signal: life.signal })
    life.abort()
    await expect(pending).rejects.toThrow('before it was dialed')
  })
})
