import { VAULT_MANAGERS, type ManagerSeed, type VaultScript } from './fixture'

type Obj = { readonly [key: string]: unknown }
type Name = typeof VAULT_MANAGERS[number]

/** `display_name` of each backend (agent/vault_backends/onepassword.py:33, bitwarden.py:34). */
const DISPLAY: { readonly [N in Name]: string } = { onepassword: '1Password', bitwarden: 'Bitwarden' }

interface Held {
  readonly seed: ManagerSeed
  notOptedOut: boolean
  unlocked: boolean
}

export class ScriptedVault {
  private readonly held = new Map<string, Map<Name, Held>>()

  constructor(private readonly script: VaultScript, private readonly fail: (message: string) => never) {}

  call(method: string, params: Obj, profile: string): unknown {
    const managers = this.managersOf(profile)
    const name = typeof params.name === 'string' ? params.name : ''
    const known = managers.get(name as Name)
    switch (method) {
      case 'vault.sources':
        return { sources: [{ name: 'local', display_name: 'Hermes vault', enabled: true, needs_unlock: false, unlocked: true, installed: true }, ...VAULT_MANAGERS.map(each => this.row(each, managers.get(each)))] }
      case 'vault.list': {
        const failing = VAULT_MANAGERS.map(each => managers.get(each)).find(manager => manager !== undefined && this.isOpen(manager) && manager.seed.listFails !== undefined)
        if (failing?.seed.listFails !== undefined) return this.fail(failing.seed.listFails)
        return { items: VAULT_MANAGERS.flatMap(each => this.logins(each, managers.get(each))) }
      }
      case 'vault.source.set': {
        if (!VAULT_MANAGERS.some(each => each === name)) return this.fail(`unknown vault source: ${name}`)
        const enabled = params.enabled === true
        if (known !== undefined) {
          known.notOptedOut = enabled
          if (!enabled) known.unlocked = false
        }
        return { name, enabled }
      }
      case 'vault.unlock': {
        if (known === undefined || !known.notOptedOut) return this.fail(`${name} is not an enabled password manager`)
        const password = typeof params.password === 'string' ? params.password : ''
        if (password === '') return this.fail('master password is required')
        if (known.seed.password === undefined || password !== known.seed.password) {
          return this.fail(known.seed.refuses ?? `${DISPLAY[name as Name]} unlock failed: Invalid master password.`)
        }
        known.unlocked = true
        return { name, unlocked: true }
      }
      case 'vault.lock':
        for (const [each, manager] of managers) if ((name === '' || each === name) && manager.seed.token !== true) manager.unlocked = false
        return { locked: true }
      default:
        throw new Error(`the scripted vault does not serve ${method}`)
    }
  }

  private managersOf(profile: string): Map<Name, Held> {
    const found = this.held.get(profile)
    if (found !== undefined) return found
    const seeds = this.script[profile] ?? {}
    const made = new Map(VAULT_MANAGERS.flatMap(name => {
      const seed = seeds[name]
      return seed === undefined || !seed.installed ? [] : [[name, { seed, notOptedOut: seed.enabled ?? true, unlocked: seed.unlocked ?? false }] as const]
    }))
    this.held.set(profile, made)
    return made
  }

  private isOpen(manager: Held): boolean {
    return manager.notOptedOut && (manager.unlocked || manager.seed.token === true)
  }

  private row(name: Name, manager: Held | undefined) {
    const on = manager !== undefined && manager.notOptedOut
    return { name, display_name: DISPLAY[name], enabled: on, needs_unlock: true, unlocked: on && this.isOpen(manager), installed: manager !== undefined }
  }

  private logins(name: Name, manager: Held | undefined) {
    if (manager === undefined || !this.isOpen(manager)) return []
    return (manager.seed.logins ?? []).map((label, at) => ({ id: `${name}:${at}`, kind: 'login', label, origin: `https://${label}`, backend: name }))
  }
}
