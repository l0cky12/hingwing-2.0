import type { Exported } from '@highwing/hermes/domain'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export interface Saver {
  save(exported: Exported): Promise<string | null>
}

const fileNameOf = (filename: string) => basename(filename.replaceAll('\\', '/')) || 'chat'

export function dialogSaver(dialog: Pick<Electron.Dialog, 'showSaveDialog'>, folder: () => string): Saver {
  return {
    async save({ filename, content }) {
      const chosen = await dialog.showSaveDialog({ defaultPath: join(folder(), fileNameOf(filename)) })
      if (chosen.canceled || chosen.filePath === undefined || chosen.filePath === '') return null
      await writeFile(chosen.filePath, content)
      return chosen.filePath
    }
  }
}

export function folderSaver(dir: string): Saver {
  return {
    async save({ filename, content }) {
      await mkdir(dir, { recursive: true })
      const path = join(dir, fileNameOf(filename))
      await writeFile(path, content)
      return path
    }
  }
}
