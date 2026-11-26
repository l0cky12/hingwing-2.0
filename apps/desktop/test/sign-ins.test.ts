import type { GatewayUrl } from '@highwing/hermes/domain'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { keyringSeal, SIGN_INS_FILE, signInStore, type Seal } from '../src/main/sign-ins'

const HERE = 'https://hermes.example.com' as GatewayUrl
const THERE = 'http://other.example.com:9120/hermes' as GatewayUrl
const SECRET = '{"refresh":"a-refresh-token","provider":"basic"}'
const emptyDir = () => mkdtempSync(join(tmpdir(), 'highwing-sign-ins-'))
const fileIn = (dir: string) => join(dir, SIGN_INS_FILE)

const sealWith = (key: string): Seal => ({
  seal: async text => Buffer.from(`${key}:${Buffer.from(text).toString('hex')}`),
  open: async sealed => {
    const [by, hex] = sealed.toString().split(':')
    if (by !== key || hex === undefined) throw new Error('sealed by another key')
    return Buffer.from(hex, 'hex').toString()
  }
})
const keyring = (key = 'this-account') => async () => sealWith(key)
const NO_KEYRING = async () => null

describe('signInStore on a computer with a keyring', () => {
  it('reads back the sign-in it kept, after a restart too, from a file only the user can read that holds no plain secret', async () => {
    const dir = emptyDir()
    const store = signInStore(dir, keyring())
    expect(await store.load(HERE)).toBeNull()
    await store.save(HERE, SECRET)
    expect(await store.load(HERE)).toBe(SECRET)
    expect(await signInStore(dir, keyring()).load(HERE)).toBe(SECRET)

    const sealed = (await sealWith('this-account').seal(SECRET)).toString('base64')
    expect(readFileSync(fileIn(dir), 'utf8')).toBe(`{"version":1,"signIns":{"${HERE}":"${sealed}"}}\n`)
    expect(readFileSync(fileIn(dir), 'utf8')).not.toContain('a-refresh-token')
    expect(statSync(fileIn(dir)).mode & 0o777).toBe(0o600)
    expect(readdirSync(dir)).toEqual([SIGN_INS_FILE])
  })

  it('keeps one sign-in per address, and replaces the one an address had', async () => {
    const store = signInStore(emptyDir(), keyring())
    await store.save(HERE, 'first')
    await store.save(THERE, 'other')
    await store.save(HERE, 'second')
    expect([await store.load(HERE), await store.load(THERE)]).toEqual(['second', 'other'])
  })

  it('does not bring back a sign-in that a keepOnly called after its save forgot, however slow the keyring seals', async () => {
    let release = () => {}
    const sealed = new Promise<void>(resolve => { release = resolve })
    const slow: Seal = { ...sealWith('this-account'), seal: async text => { await sealed; return sealWith('this-account').seal(text) } }
    const store = signInStore(emptyDir(), async () => slow)
    const saving = store.save(THERE, 'old')
    const keeping = store.keepOnly(HERE)
    release()
    await Promise.all([saving, keeping])
    expect(await store.load(THERE)).toBeNull()
  })

  it('does the same with no keyring', async () => {
    let release = () => {}
    const asked = new Promise<null>(resolve => { release = () => resolve(null) })
    const store = signInStore(emptyDir(), () => asked)
    const saving = store.save(THERE, 'old')
    const keeping = store.keepOnly(HERE)
    release()
    await Promise.all([saving, keeping])
    expect(await store.load(THERE)).toBeNull()
  })

  it('keeps every one of several sign-ins saved at once', async () => {
    const dir = emptyDir()
    const store = signInStore(dir, keyring())
    await Promise.all([store.save(HERE, 'here'), store.save(THERE, 'there')])
    expect([await store.load(HERE), await store.load(THERE)]).toEqual(['here', 'there'])
  })

  it('forgets the sign-in of an address saved as null', async () => {
    const store = signInStore(emptyDir(), keyring())
    await store.save(HERE, SECRET)
    await store.save(THERE, 'other')
    await store.save(HERE, null)
    expect([await store.load(HERE), await store.load(THERE)]).toEqual([null, 'other'])
  })

  it.each([[HERE, [SECRET, null]], [null, [null, null]]] as const)('keeps only the sign-in of %s', async (url, left) => {
    const dir = emptyDir()
    const store = signInStore(dir, keyring())
    await store.save(HERE, SECRET)
    await store.save(THERE, 'other')
    await store.keepOnly(url)
    const restarted = signInStore(dir, keyring())
    expect([await restarted.load(HERE), await restarted.load(THERE)]).toEqual(left)
  })

  it('makes the directory when it is not there yet', async () => {
    const dir = join(emptyDir(), 'Highwing')
    await signInStore(dir, keyring()).save(HERE, SECRET)
    expect(await signInStore(dir, keyring()).load(HERE)).toBe(SECRET)
  })

  it('reads a sign-in another keyring sealed as none, and keeps a new one in its place', async () => {
    const dir = emptyDir()
    await signInStore(dir, keyring('another-account')).save(HERE, SECRET)
    const store = signInStore(dir, keyring())
    expect(await store.load(HERE)).toBeNull()
    await store.save(HERE, 'again')
    expect(await store.load(HERE)).toBe('again')
  })

  it.each([
    ['half a file', '{"version":1,"signIns":{"https://hermes.exa'],
    ['JSON that is not an object', '7'],
    ['a later version', JSON.stringify({ version: 2, signIns: { [HERE]: 'AAAA' } })],
    ['a sign-in that is not text', JSON.stringify({ version: 1, signIns: { [HERE]: 7 } })],
    ['no sign-ins', JSON.stringify({ version: 1 })]
  ])('reads %s as no sign-in, and writes over it', async (_what, content) => {
    const dir = emptyDir()
    writeFileSync(fileIn(dir), content)
    const store = signInStore(dir, keyring())
    expect(await store.load(HERE)).toBeNull()
    await store.save(HERE, SECRET)
    expect(await signInStore(dir, keyring()).load(HERE)).toBe(SECRET)
  })

  it('says it is durable once the keyring was asked, which a load or a save does and nothing else', async () => {
    let asked = 0
    const store = signInStore(emptyDir(), async () => {
      asked++
      return sealWith('this-account')
    })
    await store.keepOnly(null)
    expect([asked, store.durable]).toEqual([0, false])
    await store.load(HERE)
    await store.save(HERE, SECRET)
    expect([asked, store.durable]).toEqual([1, true])
  })
})

describe('signInStore on a computer with no keyring', () => {
  it('holds a sign-in for this run only, and writes no file', async () => {
    const dir = emptyDir()
    const store = signInStore(dir, NO_KEYRING)
    await store.save(HERE, SECRET)
    await store.save(THERE, 'other')
    expect(await store.load(HERE)).toBe(SECRET)
    expect(store.durable).toBe(false)
    await store.keepOnly(HERE)
    expect([await store.load(HERE), await store.load(THERE)]).toEqual([SECRET, null])
    await store.save(HERE, null)
    expect(await store.load(HERE)).toBeNull()

    expect(readdirSync(dir)).toEqual([])
    expect(await signInStore(dir, NO_KEYRING).load(HERE)).toBeNull()
  })

  it('treats a keyring that cannot be asked as none', async () => {
    const dir = emptyDir()
    const store = signInStore(dir, async () => { throw new Error('the keyring is locked') })
    await store.save(HERE, SECRET)
    expect([await store.load(HERE), store.durable, existsSync(fileIn(dir))]).toEqual([SECRET, false, false])
  })

  it('still forgets the sign-ins a keyring once wrote for other addresses', async () => {
    const dir = emptyDir()
    const before = signInStore(dir, keyring())
    await before.save(HERE, SECRET)
    await before.save(THERE, 'other')
    await signInStore(dir, NO_KEYRING).keepOnly(HERE)
    const after = signInStore(dir, keyring())
    expect([await after.load(HERE), await after.load(THERE)]).toEqual([SECRET, null])
  })
})

describe('keyringSeal', () => {
  const storage = (backend: ReturnType<Electron.SafeStorage['getSelectedStorageBackend']>, tag: string, available = true) => {
    const calls: string[] = []
    return {
      calls,
      getSelectedStorageBackend: () => backend,
      isAsyncEncryptionAvailable: async () => available,
      encryptStringAsync: async (text: string) => {
        calls.push('encrypt')
        return Buffer.from(tag + text)
      },
      decryptStringAsync: async (sealed: Buffer) => ({ result: sealed.toString().slice(tag.length), shouldReEncrypt: false })
    }
  }

  it('seals with the keyring Chromium found on Linux', async () => {
    const seal = await keyringSeal(storage('gnome_libsecret', 'v11'), 'linux')
    expect(await seal?.open(await seal.seal(SECRET))).toBe(SECRET)
  })

  it('is none on Linux when Chromium picked no keyring, without encrypting anything', async () => {
    const held = storage('basic_text', 'v10')
    expect(await keyringSeal(held, 'linux')).toBeNull()
    expect(held.calls).toEqual([])
  })

  it('is none on Linux when Chromium picked a keyring and still encrypts with its compiled-in key', async () => {
    expect(await keyringSeal(storage('gnome_libsecret', 'v10'), 'linux')).toBeNull()
  })

  it.each(['darwin', 'win32'] as const)('seals on %s, whose real key shares the tag of the compiled-in key of Linux', async platform => {
    const seal = await keyringSeal(storage('unknown', 'v10'), platform)
    expect(await seal?.open(await seal.seal(SECRET))).toBe(SECRET)
  })

  it('is none where encryption is not available', async () => {
    expect(await keyringSeal(storage('unknown', 'v10', false), 'darwin')).toBeNull()
  })
})
