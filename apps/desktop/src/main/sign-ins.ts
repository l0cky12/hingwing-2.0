import { memoryKeep, type Keep } from '@highwing/hermes'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

export const SIGN_INS_FILE = 'sign-ins.json'
const VERSION = 1

export interface Seal {
  seal(text: string): Promise<Buffer>
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

export const UNSEALED: Seal = { seal: async text => Buffer.from(text), open: async sealed => sealed.toString() }

type SignIns = Readonly<Record<string, string>>

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

  const only = (held: SignIns, keep: (url: string) => boolean): SignIns => {
    const kept = Object.entries(held).filter(([url]) => keep(url))
    return kept.length === Object.keys(held).length ? held : Object.fromEntries(kept)
  }

  let changes: Promise<void> = Promise.resolve()
  // A save sealed before a later keepOnly must land before it, or it would bring back a forgotten sign-in.
  const inTurn = (change: () => Promise<void>): Promise<void> => {
    const done = changes.then(change)
    changes = done.catch(() => {})
    return done
  }
  const rewrite = async (edit: (held: SignIns) => SignIns): Promise<void> => {
    const held = await read()
    const next = edit(held)
    if (next !== held) await write(dir, file, next)
  }

  return {
    get durable() { return durable },
    load: async url => {
      const found = await seal()
      if (found === null) return memory.load(url)
      const sealed = (await read())[url]
      return sealed === undefined ? null : found.open(Buffer.from(sealed, 'base64')).catch(() => null)
    },
    save: (url, secret) => inTurn(async () => {
      const found = await seal()
      if (found === null) return memory.save(url, secret)
      if (secret === null) return rewrite(held => only(held, at => at !== url))
      const sealed = (await found.seal(secret)).toString('base64')
      await rewrite(held => ({ ...held, [url]: sealed }))
    }),
    keepOnly: urls => inTurn(async () => {
      await memory.keepOnly(urls)
      await rewrite(held => only(held, at => urls.some(url => url === at)))
    })
  }
}
