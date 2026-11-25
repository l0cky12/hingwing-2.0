import { spawnSync } from 'node:child_process'

const SECRET_SERVICE = 'org.freedesktop.secrets'
const ASK_MS = 500

/** One call to the session bus's own driver, answered as `dbus-send --print-reply` prints it. null: no answer. */
export type AskBus = (method: 'NameHasOwner' | 'ListActivatableNames', ...args: readonly string[]) => string | null

/** Asks with `dbus-send`, and only a bus this session already has: with no address, dbus-send would start one. */
export const dbusSend = (env: NodeJS.ProcessEnv): AskBus => (method, ...args) => {
  if (!env.DBUS_SESSION_BUS_ADDRESS) return null
  const sent = spawnSync(
    'dbus-send',
    ['--session', '--dest=org.freedesktop.DBus', '--type=method_call', '--print-reply', `--reply-timeout=${ASK_MS}`, '/org/freedesktop/DBus', `org.freedesktop.DBus.${method}`, ...args],
    { env, encoding: 'utf8', timeout: ASK_MS, stdio: ['ignore', 'pipe', 'ignore'] }
  )
  return sent.status === 0 ? sent.stdout : null
}

/**
 * Whether the session bus has a Secret Service, running or one the bus can start. Only the bus is
 * asked, never the service, so no keyring is started or unlocked by the question.
 */
export function hasSecretService(ask: AskBus): boolean {
  return /\bboolean true\b/.test(ask('NameHasOwner', `string:${SECRET_SERVICE}`) ?? '')
    || (ask('ListActivatableNames') ?? '').includes(`"${SECRET_SERVICE}"`)
}
