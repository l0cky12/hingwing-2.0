import { constants, copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Chromium looks for this exact versioned name in this folder, so an Electron upgrade that bumps the version needs a new file.
export const seedDictionary = (source: string, sessionData: string): void => {
  try {
    const folder = join(sessionData, 'Dictionaries')
    mkdirSync(folder, { recursive: true })
    copyFileSync(source, join(folder, 'en-US-10-2.bdic'), constants.COPYFILE_EXCL)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') console.warn('Spell check dictionary was not installed:', error)
  }
}
