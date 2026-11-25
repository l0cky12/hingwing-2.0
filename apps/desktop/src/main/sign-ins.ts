import { memoryKeep, type Keep } from '@highwing/hermes'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

export const SIGN_INS_FILE = 'sign-ins.json'
const VERSION = 1

/** Turns a secret into bytes that only this account's keyring can turn back. */
export interface Seal {
  seal(text: string): Promise<Buffer>
  /** Rejects when this account's keyring did not seal the bytes. */
  open(sealed: Buffer): Promise<string>
}

/**
 * On Linux, Chromium encrypts with a key compiled into it when no keyring gives it one, and never
 * says so: `isAsyncEncryptionAvailable` still resolves true. Only the ciphertext tells. What that
 * key made starts with this tag, and what a keyring's key made starts with `v11` (Chromium's
 * components/os_crypt/async/browser/posix_key_provider.cc and freedesktop_secret_key_provider.cc).
 * Windows uses the same tag for a real key, so the rule is Linux's alone.
 */
const COMPILED_IN_KEY = 'v10'

/**
 * Electron's safeStorage as a `Seal`. null: it would hide nothing, because this computer has no
 * keyring Chromium can use. The first call can make the keyring ask the user to unlock it, so call
 * it only once a sign-in is at stake, and after `app` is ready.
 */
export async function keyringSeal(
  safeStorage: Pick<Electron.SafeStorage, 'isAsyncEncryptionAvailable' | 'encryptStringAsync' | 'decryptStringAsync' | 'getSelectedStorageBackend'>,
  platform: NodeJS.Platform
): Promise<Seal | null> {
  if (platform === 'linux') {
    if (safeStorage.getSelectedStorageBackend() === 'basic_text') return null
    const probe = await safeStorage.encryptStringAsync('probe')
    if (probe.subarray(0, COMPILED_IN_KEY.length).toString('latin1') === COMPILED_IN_KEY) return null
  } else if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    return null
  }
  return {
    seal: text => safeStorage.encryptStringAsync(text),
    open: async sealed => (await safeStorage.decryptStringAsync(sealed)).result
  }
}

/** A seal that hides nothing. Only a verify run of a build that is not installed uses it, to prove that a kept sign-in survives a restart. */
export const UNSEALED: Seal = { seal: async text => Buffer.from(text), open: async sealed => sealed.toString() }

type SignIns = Readonly<Record<string, string>>

/** The only code that knows the file's shape. Anything but a file this build wrote holds no sign-in. */
function parseSignIns(text: string | null): SignIns {
  let raw: unknown
  try {
    raw = text === null ? null : JSON.parse(text)
  } catch {
    return {}
  }
  if (raw === null || typeof raw !== 'object') return {}
  const { version, signIns } = raw as { readonly version?: unknown; readonly signIns?: unknown }
  if (version !== VERSION || signIns === null || typeof signIns !== 'object') return {}
  return Object.fromEntries(Object.entries(signIns).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

async function write(dir: string, file: string, signIns: SignIns): Promise<void> {
  await mkdir(dir, { recursive: true })
  const temp = await open(`${file}.tmp`, 'w', 0o600)
  try {
    await temp.writeFile(`${JSON.stringify({ version: VERSION, signIns })}\n`)
    await temp.sync()
  } finally {
    await temp.close()
  }
  await rename(`${file}.tmp`, file)
}

/**
 * The sign-ins `gatewaysByUrl` keeps between runs, in `sign-ins.json` beside the saved connection:
 * `{"version":1,"signIns":{"<GatewayUrl>":"<base64 of the sealed secret>"}}`. Only sealed bytes
 * reach the disk, in a file only the user can read, written as the settings file is. With no seal
 * a sign-in is held in memory for this run and nothing is written.
 *
 * `sealOf` is asked once, by the first load or save. `durable` is false until then, and what the
 * seal says from then on.
 */
export function signInStore(dir: string, sealOf: () => Promise<Seal | null>): Keep {
  const file = join(dir, SIGN_INS_FILE)
  const memory = memoryKeep()
  let durable = false
  let asked: Promise<Seal | null> | null = null
  const seal = () => (asked ??= sealOf().catch(() => null).then(found => {
    durable = found !== null
    return found
  }))

  const read = async () => parseSignIns(await readFile(file, 'utf8').catch(() => null))

  /** The sign-ins of the addresses `keep` takes. The object it was given when that is all of them, so nothing is written. */
  const only = (held: SignIns, keep: (url: string) => boolean): SignIns => {
    const kept = Object.entries(held).filter(([url]) => keep(url))
    return kept.length === Object.keys(held).length ? held : Object.fromEntries(kept)
  }

  let writes: Promise<void> = Promise.resolve()
  /** One change at a time, each from the file as the last one left it. */
  const rewrite = (edit: (held: SignIns) => SignIns): Promise<void> => {
    const done = writes.then(async () => {
      const held = await read()
      const next = edit(held)
      if (next !== held) await write(dir, file, next)
    })
    writes = done.catch(() => {})
    return done
  }

  return {
    get durable() { return durable },
    load: async url => {
      const found = await seal()
      if (found === null) return memory.load(url)
      const sealed = (await read())[url]
      return sealed === undefined ? null : found.open(Buffer.from(sealed, 'base64')).catch(() => null)
    },
    save: async (url, secret) => {
      const found = await seal()
      if (found === null) return memory.save(url, secret)
      if (secret === null) return rewrite(held => only(held, at => at !== url))
      const sealed = (await found.seal(secret)).toString('base64')
      await rewrite(held => ({ ...held, [url]: sealed }))
    },
    keepOnly: async url => {
      await memory.keepOnly(url)
      await rewrite(held => only(held, at => at === url))
    }
  }
}
