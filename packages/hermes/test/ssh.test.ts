import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSshHost } from '../src/domain/reach'
import { ATTACH, HERMES_PATHS, PROBE, probeOf, relay, remoteHermes, runTool, SSH_OPTIONS, sshFailureOf } from '../src/wire/ssh'
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
    [0, '{"protocol": 1, "purposes": ["native-http"], "windows_service_session": false}\n', { ok: true, windowsServiceSession: false }],
    [0, 'a banner from the shell profile\n{"protocol": 1, "purposes": [], "windows_service_session": true}\n', { ok: true, windowsServiceSession: true }],
    [0, '{"protocol": 1, "purposes": ["native-http"], "later_key": 1}\n', { ok: true, windowsServiceSession: false }],
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

describe('the command ssh is given', () => {
  it('names Hermes\'s install locations in its order, after the login shell\'s own hermes', () => {
    expect(HERMES_PATHS).toEqual(['$HOME/.local/bin/hermes', '/usr/local/bin/hermes', '$HOME/.hermes/hermes-agent/venv/bin/hermes'])
    expect(remoteHermes(PROBE)).toContain('for hermes in "$found" "$HOME/.local/bin/hermes" "/usr/local/bin/hermes" "$HOME/.hermes/hermes-agent/venv/bin/hermes";')
  })

  it.each([PROBE, ATTACH.start, ATTACH.retry])('is one single-quoted script and the literal words %j', (...args) => {
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

describe('relay', () => {
  it('settles when the route is disposed before the relay is listening', async () => {
    const life = new AbortController()
    const pending = relay(parseSshHost('hermes-host.example-tailnet.ts.net')!, 1, { sshBin: '/nonexistent/ssh', signal: life.signal })
    life.abort()
    await expect(pending).rejects.toThrow('before it was dialed')
  })
})
