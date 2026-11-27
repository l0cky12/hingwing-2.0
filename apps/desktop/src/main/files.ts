import type { Item, Session, ToolItem, ToolResult } from '@highwing/hermes/domain'
import { appendFile, stat } from 'node:fs/promises'
import { isAbsolute, normalize, resolve } from 'node:path'
import type { FileAction, FileOutcome } from '../ipc-contract'

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i

export function* itemsOf(session: Session): Iterable<Item> {
  for (const turn of session.history) yield* turn.items
  if (session.run.state === 'running') yield* session.run.turn.items
}

const WRITES: ReadonlySet<string> = new Set(['write_file', 'patch'])

/**
 * A stored step keeps no diff and reads as no error (wire/parse.ts `parseRows`), so once the chat is reloaded the proof is
 * the tool's own report: Hermes lists `files_modified` only when the write landed (tools/file_tools.py write_file_tool, patch_tool).
 */
const reported = (result: ToolResult, path: string) => {
  if (result.kind !== 'text' || result.clipped > 0) return false
  try {
    const report: unknown = JSON.parse(result.text)
    return typeof report === 'object' && report !== null && 'files_modified' in report && Array.isArray(report.files_modified) && report.files_modified.includes(path)
  } catch {
    return false
  }
}

const wrote = (item: ToolItem, path: string) => {
  if (item.status.s !== 'done') return false
  const { diffs, result } = item.status
  return diffs.some(diff => diff.path === path) || (WRITES.has(item.name) && reported(result, path))
}

const stepNamed = (session: Session, path: string) => {
  for (const item of itemsOf(session)) {
    if (item.kind === 'tool' && wrote(item, path)) return true
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
  /** A link, in the user's browser or mail app. */
  browse(url: string): Promise<void>
}

const MISSING = new Set(['ENOENT', 'ENOTDIR'])

export function desktopOpener(shell: Pick<Electron.Shell, 'openPath' | 'showItemInFolder' | 'openExternal'>): Opener {
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
    },
    browse: url => shell.openExternal(url).catch(() => {})
  }
}

export function recordingOpener(logFile: string): Opener {
  const record = (action: Exclude<FileAction, 'preview'>) => async (path: string): Promise<FileOutcome> => {
    await appendFile(logFile, `${JSON.stringify({ action, path })}\n`)
    return { ok: true }
  }
  return { open: record('open'), show: record('show'), browse: url => appendFile(logFile, `${JSON.stringify({ action: 'browse', url })}\n`) }
}
