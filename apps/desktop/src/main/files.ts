import type { Item, Session } from '@highwing/hermes/domain'
import { appendFile, stat } from 'node:fs/promises'
import { isAbsolute, normalize, resolve } from 'node:path'
import type { FileAction, FileOutcome } from '../ipc-contract'

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i

export function* itemsOf(session: Session): Iterable<Item> {
  for (const turn of session.history) yield* turn.items
  if (session.run.state === 'running') yield* session.run.turn.items
}

const stepNamed = (session: Session, path: string) => {
  for (const item of itemsOf(session)) {
    if (item.kind === 'tool' && item.status.s === 'done' && item.status.diffs.some(diff => diff.path === path)) return true
  }
  return false
}

export function openablePath(session: Session, path: string): string | null {
  if (URL_SCHEME.test(path) || !stepNamed(session, path)) return null
  if (isAbsolute(path)) return normalize(path)
  return session.cwd !== null && isAbsolute(session.cwd) ? resolve(session.cwd, path) : null
}

export interface Opener {
  open(path: string): Promise<FileOutcome>
  show(path: string): Promise<FileOutcome>
}

const MISSING = new Set(['ENOENT', 'ENOTDIR'])

export function desktopOpener(shell: Pick<Electron.Shell, 'openPath' | 'showItemInFolder'>): Opener {
  const present = async (path: string): Promise<FileOutcome> => {
    try {
      await stat(path)
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: MISSING.has((error as NodeJS.ErrnoException).code ?? '') ? 'missing' : 'failed' }
    }
  }
  return {
    async open(path) {
      const found = await present(path)
      if (!found.ok) return found
      return (await shell.openPath(path)) === '' ? { ok: true } : { ok: false, reason: 'failed' }
    },
    async show(path) {
      const found = await present(path)
      if (found.ok) shell.showItemInFolder(path)
      return found
    }
  }
}

export function recordingOpener(logFile: string): Opener {
  const record = (action: FileAction) => async (path: string): Promise<FileOutcome> => {
    await appendFile(logFile, `${JSON.stringify({ action, path })}\n`)
    return { ok: true }
  }
  return { open: record('open'), show: record('show') }
}
