import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface HermesInstall {
  readonly version: string
  readonly commit: string
  readonly dir: string
}

/** What `contract.version.json` records next to the vendored pair. */
export interface ContractVersion {
  readonly hermes: string
  readonly commit: string
}

/** Each vendored file: where it lives in a Hermes checkout, and its name in `wire/`. */
export const CONTRACT_FILES = [
  { hermes: 'apps/shared/src/gateway-contract.generated.ts', vendored: 'contract.generated.ts' },
  { hermes: 'apps/shared/src/gateway-contract.openrpc.json', vendored: 'contract.openrpc.json' }
] as const

export const WIRE_DIR = fileURLToPath(new URL('../packages/hermes/src/wire/', import.meta.url))
export const VERSION_FILE = join(WIRE_DIR, 'contract.version.json')

/** The Hermes on PATH, read from `hermes --version`. */
export function installedHermes(): HermesInstall {
  const out = execFileSync('hermes', ['--version'], { encoding: 'utf8' })
  const version = /^Hermes Agent v(\S+)/m.exec(out)?.[1]
  const dir = /^Install directory:\s*(.+)$/m.exec(out)?.[1]?.trim()
  if (version === undefined || dir === undefined) {
    throw new Error(`hermes --version printed no version or no "Install directory:" line:\n${out}`)
  }
  const commit = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  return { version, commit, dir }
}
