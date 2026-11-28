import type { CommandOutcome } from '@highwing/hermes/domain'
import { mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

export interface Saver {
  /**
   * Asks where `filename` goes, or takes the fixed folder of a verify run, then has `write` put the file there. null: the user
   * cancelled, and nothing was written. Rejects when `write` does.
   */
  save(filename: string, write: (to: string) => Promise<void>): Promise<string | null>
}

const NOT_SAVED: CommandOutcome<never> = { ok: false, refusal: { kind: 'rejected', message: "Highwing couldn't write the file." } }

/** A save as the window hears of it: where the file went, null when the user cancelled, or that it could not be written. */
export const savedAs = (saving: Promise<string | null>): Promise<CommandOutcome<string | null>> => saving.then(path => ({ ok: true, value: path }), () => NOT_SAVED)

const fileNameOf = (filename: string) => basename(filename.replaceAll('\\', '/')) || 'chat'

export function dialogSaver(dialog: Pick<Electron.Dialog, 'showSaveDialog'>, folder: () => string): Saver {
  return {
    async save(filename, write) {
      const chosen = await dialog.showSaveDialog({ defaultPath: join(folder(), fileNameOf(filename)) })
      if (chosen.canceled || chosen.filePath === undefined || chosen.filePath === '') return null
      await write(chosen.filePath)
      return chosen.filePath
    }
  }
}

export function folderSaver(dir: string): Saver {
  return {
    async save(filename, write) {
      await mkdir(dir, { recursive: true })
      const path = join(dir, fileNameOf(filename))
      await write(path)
      return path
    }
  }
}
