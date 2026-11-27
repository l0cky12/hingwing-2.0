import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seedDictionary } from '../src/main/dictionary'

const workDir = () => mkdtempSync(join(tmpdir(), 'highwing-dictionary-'))
const bundled = (dir: string) => {
  const source = join(dir, 'bundled.bdic')
  writeFileSync(source, 'bundled bytes')
  return source
}

describe('seedDictionary', () => {
  it('puts the bundled dictionary where Chromium looks for it in an empty user-data folder', () => {
    const dir = workDir()
    const userData = join(dir, 'user-data')
    seedDictionary(bundled(dir), userData)
    expect(readFileSync(join(userData, 'Dictionaries', 'en-US-10-2.bdic'), 'utf8')).toBe('bundled bytes')
  })

  it('leaves a dictionary that is already there unchanged', () => {
    const dir = workDir()
    const target = join(dir, 'Dictionaries', 'en-US-10-2.bdic')
    mkdirSync(join(dir, 'Dictionaries'))
    writeFileSync(target, 'chromium download')
    seedDictionary(bundled(dir), dir)
    expect(readFileSync(target, 'utf8')).toBe('chromium download')
  })
})
